import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertSchemaGovernance,
  checkSchemaGovernance,
  type GovernanceIssueCode,
} from '../../scripts/canonical/check-schema-governance';

const roots: string[] = [];

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function createValidFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'hms-governance-'));
  roots.push(root);

  write(
    root,
    'docs/database/canonical-source-of-truth.yaml',
    JSON.stringify(
      {
        version: 1,
        governanceStartMigration: 1,
        canonicalTables: [
          {
            name: 'canonical_orders',
            tenantOwned: true,
            schemaModule: 'src/db/schema/canonical/orders.ts',
            authority: 'order command',
          },
        ],
        metrics: [{ key: 'orders.total_minor', source: 'canonical_orders.total_minor' }],
        financialCommands: [
          {
            path: 'src/lib/canonical/commands/create-order.ts',
            owner: 'finance-platform',
          },
        ],
      },
      null,
      2,
    ),
  );
  write(
    root,
    'docs/database/legacy-table-disposition.yaml',
    JSON.stringify(
      {
        version: 1,
        tables: [
          {
            name: 'legacy_orders',
            owner: 'billing-team',
            disposition: 'active_legacy',
            writePolicy: 'allowed_until_cutover',
            removalPhase: 'P05',
            reason: 'Legacy billing remains authoritative before invoice cutover.',
          },
        ],
        directWriteAllowlist: [],
        duplicateMigrationNumbers: [],
        destructiveMigrations: [],
      },
      null,
      2,
    ),
  );
  write(
    root,
    'migrations/0001_canonical_orders.sql',
    `CREATE TABLE IF NOT EXISTS canonical_orders (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      total_minor INTEGER NOT NULL,
      created_at_utc TEXT NOT NULL
    );`,
  );
  write(
    root,
    'src/db/schema/canonical/orders.ts',
    `export const canonicalOrders = sqliteTable('canonical_orders', {
      tenantId: text('tenant_id').notNull(),
      totalMinor: integer('total_minor').notNull(),
    });`,
  );
  write(root, 'src/db/schema/canonical/index.ts', `export * from './orders';\n`);
  write(root, 'src/db/schema/index.ts', `export * from './canonical';\n`);
  write(
    root,
    'src/lib/canonical/commands/create-order.ts',
    `export async function createOrder(db, idempotencyKey, event) {
      return runCanonicalBatch(db, { idempotencyKey, event });
    }`,
  );
  write(root, 'src/reports/orders.ts', `canonicalMetric('orders.total_minor');\n`);
  return root;
}

function codes(root: string): GovernanceIssueCode[] {
  return checkSchemaGovernance({ root }).issues.map((issue) => issue.code);
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('canonical schema governance checker', () => {
  it('rejects canonical REAL money, missing tenant ownership, and generic references with stable codes', () => {
    const root = createValidFixture();
    write(
      root,
      'migrations/0001_canonical_orders.sql',
      `CREATE TABLE IF NOT EXISTS canonical_orders (id INTEGER PRIMARY KEY, "total_amount" REAL NOT NULL, "reference_id" TEXT, created_at_utc TEXT NOT NULL);`,
    );

    expect(codes(root)).toEqual(
      expect.arrayContaining([
        'GOV_CANONICAL_REAL_MONEY',
        'GOV_TENANT_ID_REQUIRED',
        'GOV_GENERIC_REFERENCE',
      ]),
    );
  });

  it('rejects canonical REAL money declared only in the Drizzle schema module', () => {
    const root = createValidFixture();
    write(
      root,
      'src/db/schema/canonical/orders.ts',
      `export const canonicalOrders = sqliteTable('canonical_orders', {
        tenantId: text('tenant_id').notNull(),
        totalMinor: real('total_minor').notNull(),
      });`,
    );

    expect(codes(root)).toContain('GOV_CANONICAL_REAL_MONEY');
  });

  it('allows exact registry-approved non-money REAL measurement columns', () => {
    const root = createValidFixture();
    const registryPath = join(root, 'docs/database/canonical-source-of-truth.yaml');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    registry.canonicalTables[0].nonMoneyRealColumns = ['numeric_value', 'source_numeric_value'];
    write(root, 'docs/database/canonical-source-of-truth.yaml', JSON.stringify(registry, null, 2));
    write(
      root,
      'migrations/0001_canonical_orders.sql',
      `CREATE TABLE IF NOT EXISTS canonical_orders (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        numeric_value REAL NOT NULL,
        source_numeric_value REAL,
        total_minor INTEGER NOT NULL,
        created_at_utc TEXT NOT NULL
      );`,
    );
    write(
      root,
      'src/db/schema/canonical/orders.ts',
      `export const canonicalOrders = sqliteTable('canonical_orders', {
        tenantId: text('tenant_id').notNull(),
        numericValue: real('numeric_value').notNull(),
        sourceNumericValue: real('source_numeric_value'),
        totalMinor: integer('total_minor').notNull(),
      });`,
    );

    expect(codes(root)).not.toContain('GOV_CANONICAL_REAL_MONEY');
  });

  it('rejects duplicate governed migration numbers and unapproved destructive SQL', () => {
    const root = createValidFixture();
    write(root, 'migrations/0001_duplicate.sql', `CREATE TABLE canonical_duplicate (id INTEGER);`);
    write(root, 'migrations/0002_drop_orders.sql', `DROP TABLE canonical_orders;`);

    expect(codes(root)).toEqual(
      expect.arrayContaining([
        'GOV_DUPLICATE_MIGRATION_NUMBER',
        'GOV_DESTRUCTIVE_SQL_UNAPPROVED',
      ]),
    );
  });

  it('accepts an exact immutable production duplicate migration history approval', () => {
    const root = createValidFixture();
    write(root, 'migrations/0001_duplicate.sql', `CREATE TABLE canonical_duplicate (id INTEGER);`);
    const registryPath = join(root, 'docs/database/legacy-table-disposition.yaml');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    registry.duplicateMigrationNumbers = [
      {
        number: 1,
        filenames: ['0001_canonical_orders.sql', '0001_duplicate.sql'],
        owner: 'database-platform',
        reason: 'Both full filenames were already applied in production before the duplicate-number invariant was enforced.',
        recordedAtUtc: '2026-07-18T19:03:28Z',
      },
    ];
    writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

    expect(codes(root)).not.toContain('GOV_DUPLICATE_MIGRATION_NUMBER');
  });

  it('treats bulk delete and destructive object removal as approval-gated migration SQL', () => {
    const root = createValidFixture();
    write(root, 'migrations/0002_bulk_delete.sql', `DELETE FROM canonical_orders;`);
    write(root, 'migrations/0003_drop_view.sql', `DROP VIEW canonical_order_summary;`);

    const resultCodes = codes(root);
    expect(resultCodes.filter((code) => code === 'GOV_DESTRUCTIVE_SQL_UNAPPROVED')).toHaveLength(2);
  });

  it('rejects schema registry drift, missing metric contracts, and incomplete financial commands', () => {
    const root = createValidFixture();
    write(
      root,
      'migrations/0002_unregistered.sql',
      `CREATE TABLE IF NOT EXISTS canonical_unregistered (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL
      );`,
    );
    write(root, 'src/reports/unregistered.ts', `canonicalMetric('dashboard.unregistered');\n`);
    write(root, 'src/lib/canonical/commands/create-order.ts', `export function createOrder() { return 'unsafe'; }`);

    expect(codes(root)).toEqual(
      expect.arrayContaining([
        'GOV_SCHEMA_REGISTRY_DRIFT',
        'GOV_METRIC_CONTRACT_MISSING',
        'GOV_FINANCIAL_COMMAND_CONTRACT',
      ]),
    );
  });

  it('rejects duplicate canonical table registry contracts', () => {
    const root = createValidFixture();
    const registryPath = join(root, 'docs/database/canonical-source-of-truth.yaml');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    registry.canonicalTables.push({ ...registry.canonicalTables[0] });
    write(root, 'docs/database/canonical-source-of-truth.yaml', JSON.stringify(registry, null, 2));

    expect(codes(root)).toContain('GOV_REGISTRY_INVALID');
  });

  it('rejects incomplete legacy disposition and direct writes to read-only legacy tables unless narrowly allowlisted', () => {
    const root = createValidFixture();
    write(
      root,
      'docs/database/legacy-table-disposition.yaml',
      JSON.stringify(
        {
          version: 1,
          tables: [
            {
              name: 'legacy_orders',
              disposition: 'read_only',
              writePolicy: 'forbidden',
              reason: 'Canonical cutover complete.',
            },
          ],
          directWriteAllowlist: [],
          destructiveMigrations: [],
        },
        null,
        2,
      ),
    );
    write(root, 'src/routes/orders.ts', `await db.prepare('UPDATE legacy_orders SET status = ?').bind('paid').run();`);

    expect(codes(root)).toEqual(
      expect.arrayContaining([
        'GOV_LEGACY_ALLOWLIST_INCOMPLETE',
        'GOV_DIRECT_LEGACY_WRITE',
      ]),
    );

    write(
      root,
      'docs/database/legacy-table-disposition.yaml',
      JSON.stringify(
        {
          version: 1,
          tables: [
            {
              name: 'legacy_orders',
              owner: 'billing-team',
              disposition: 'read_only',
              writePolicy: 'forbidden',
              removalPhase: 'P05',
              reason: 'Canonical cutover complete.',
            },
          ],
          directWriteAllowlist: [
            {
              path: 'src/routes/orders.ts',
              table: 'legacy_orders',
              owner: 'billing-team',
              removalPhase: 'P05',
              reason: 'Emergency compatibility route pending removal.',
              lifecycleStatus: 'legacy_authority',
              retirementBlocker: 'Production canonical cutover and observation are incomplete.',
              retirementTask: 'CDB-105B',
              reviewedAtUtc: '2026-07-25T00:00:00Z',
            },
          ],
          destructiveMigrations: [],
        },
        null,
        2,
      ),
    );

    expect(codes(root)).not.toContain('GOV_DIRECT_LEGACY_WRITE');
    expect(codes(root)).not.toContain('GOV_LEGACY_ALLOWLIST_INCOMPLETE');

    write(root, 'src/routes/unused-legacy-allowance.ts', `export const noLegacyWrite = true;`);
    const registry = JSON.parse(
      readFileSync(join(root, 'docs/database/legacy-table-disposition.yaml'), 'utf8'),
    );
    registry.directWriteAllowlist.push({
      path: 'src/routes/unused-legacy-allowance.ts',
      table: 'legacy_orders',
      owner: 'billing-team',
      removalPhase: 'P05',
      reason: 'Stale allowance should be rejected.',
    });
    write(
      root,
      'docs/database/legacy-table-disposition.yaml',
      JSON.stringify(registry, null, 2),
    );
    expect(codes(root)).toContain('GOV_LEGACY_ALLOWLIST_INCOMPLETE');
  });

  it('requires lifecycle evidence for every exact direct legacy-write allowance', () => {
    const root = createValidFixture();
    write(root, 'src/routes/orders.ts', `await db.prepare('UPDATE legacy_orders SET status = ?').bind('paid').run();`);
    const registryPath = join(root, 'docs/database/legacy-table-disposition.yaml');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    registry.directWriteAllowlist = [
      {
        path: 'src/routes/orders.ts',
        table: 'legacy_orders',
        owner: 'billing-team',
        removalPhase: 'P05',
        reason: 'Compatibility write remains required before cutover.',
      },
    ];
    writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

    expect(codes(root)).toContain('GOV_LEGACY_ALLOWLIST_INCOMPLETE');
  });

  it('rejects invalid lifecycle status and non-UTC review evidence', () => {
    const root = createValidFixture();
    write(root, 'src/routes/orders.ts', `await db.prepare('UPDATE legacy_orders SET status = ?').bind('paid').run();`);
    const registryPath = join(root, 'docs/database/legacy-table-disposition.yaml');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    registry.directWriteAllowlist = [
      {
        path: 'src/routes/orders.ts',
        table: 'legacy_orders',
        owner: 'billing-team',
        removalPhase: 'P05',
        reason: 'Compatibility write remains required before cutover.',
        lifecycleStatus: 'temporary',
        retirementBlocker: 'Production canonical cutover and observation are incomplete.',
        retirementTask: 'CDB-105B',
        reviewedAtUtc: '2026-07-25 00:00:00',
      },
    ];
    writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

    expect(codes(root)).toContain('GOV_LEGACY_ALLOWLIST_INCOMPLETE');
  });

  it('accepts complete lifecycle evidence for an exact direct legacy-write allowance', () => {
    const root = createValidFixture();
    write(root, 'src/routes/orders.ts', `await db.prepare('UPDATE legacy_orders SET status = ?').bind('paid').run();`);
    const registryPath = join(root, 'docs/database/legacy-table-disposition.yaml');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    registry.directWriteAllowlist = [
      {
        path: 'src/routes/orders.ts',
        table: 'legacy_orders',
        owner: 'billing-team',
        removalPhase: 'P05',
        reason: 'Compatibility write remains required before cutover.',
        lifecycleStatus: 'canonical_compatibility',
        retirementBlocker: 'Production canonical cutover and observation are incomplete.',
        retirementTask: 'CDB-105B',
        reviewedAtUtc: '2026-07-25T00:00:00Z',
      },
    ];
    writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');

    expect(codes(root)).not.toContain('GOV_LEGACY_ALLOWLIST_INCOMPLETE');
  });

  it('passes a valid fixture and throws one deterministic summary for invalid input', () => {
    const root = createValidFixture();
    expect(checkSchemaGovernance({ root })).toMatchObject({ ok: true, issues: [] });
    expect(() => assertSchemaGovernance({ root })).not.toThrow();

    write(root, 'migrations/0002_bad.sql', `DROP TABLE canonical_orders;`);
    expect(() => assertSchemaGovernance({ root })).toThrow(/GOV_DESTRUCTIVE_SQL_UNAPPROVED/);
  });

  it('passes the real repository governance registry', () => {
    const result = checkSchemaGovernance({ root: process.cwd() });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});
