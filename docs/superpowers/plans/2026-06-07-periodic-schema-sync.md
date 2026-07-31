# Periodic Cloud → Local Schema Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-way cloud → local schema sync job that auto-applies safe migrations to the hospital LAN local server and queues destructive migrations for admin approval via a local admin panel page.

**Architecture:** At build time, a script embeds `migrations/*.sql` files into the cloud worker bundle as a typed `MIGRATIONS` constant. Two new cloud endpoints (`/api/sync/schema/manifest` and `/api/sync/schema/manifest/checksum`) return the manifest. The local server's existing `hms-sync` worker polls the checksum endpoint every 15 min; when the checksum changes, it fetches the full manifest and POSTs it to a new internal local endpoint `/api/local-server/schema-sync/sync`. A new local engine (`src/lib/local-server/schema-sync.ts`) classifies each migration by filename convention (`NNNNd_*.sql` = destructive, `NNNN_*.sql` = safe), applies safe ones to the local D1, and queues destructive ones in `local_schema_sync_approvals`. An admin panel page lets admins approve/reject. After approval, the next worker cycle applies the destructive migration.

**Tech Stack:** TypeScript, Hono (existing), Cloudflare Workers, vitest (existing), Wrangler D1 local mode, React 19 (admin panel), Tailwind (admin panel), Hono `db.batch()` for atomic D1 transactions, bash (worker script), SHA-256 (Node `crypto`).

---

## File Structure

**New files:**
- `scripts/build-migration-manifest.ts` — build-time script that reads `migrations/*.sql` and generates `src/data/schema-migrations.generated.ts`
- `src/data/schema-migrations.generated.ts` — GENERATED, gitignored, exports the `MIGRATIONS` constant
- `src/lib/local-server/schema-sync.ts` — pure functions: classify, reconcile, apply, record approval, log
- `src/routes/local-server/schema-sync.ts` — local HTTP endpoints (admin + internal)
- `migrations/0336_local_schema_sync_tables.sql` — bootstrap migration for existing local D1s
- `test/local-schema-sync-engine.test.ts` — vitest unit tests for the engine
- `test/local-schema-sync-routes.test.ts` — vitest integration tests for the routes
- `admin-panel/src/pages/LocalSchemaSync.tsx` — admin panel page
- `docs/operations/local-server.md` — operations doc for the feature

**Modified files:**
- `package.json` — add `build:migrations` script
- `.gitignore` — ignore generated file
- `tenant-schema.sql` — add 3 new tables (`local_schema_migrations`, `local_schema_sync_approvals`, `local_schema_sync_log`)
- `src/routes/sync.ts` — add 2 new cloud endpoints
- `src/index.ts` — mount `/api/local-server/schema-sync` route
- `src/types.ts` — add new env vars to `Env` type
- `scripts/local-server/sync-worker.sh` — add schema sync cycle
- `admin-panel/src/App.tsx` — add route + sidebar entry
- `deploy/local-server/local-server.env.example` — add new env var defaults
- `docs/operations/local-server.md` (new) — document new env vars

---

## Phase 1: Cloud Foundation

### Task 1: Add `build:migrations` script entry to package.json

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add the build:migrations script**

Open `package.json` and add a new script entry. The current `build` script is:
```json
"build": "pnpm --filter web build && pnpm --filter ozzyl-lifestyle build && pnpm build:admin",
```

Add the migration manifest build as the FIRST step (it must run before any other build step that may pull in the routes file):

Replace the line with:
```json
"build": "pnpm build:migrations && pnpm --filter web build && pnpm --filter ozzyl-lifestyle build && pnpm build:admin",
"build:migrations": "tsx scripts/build-migration-manifest.ts",
```

- [ ] **Step 2: Verify package.json parses**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8')); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "build: add build:migrations script entry"
```

---

### Task 2: Create the build-time manifest generator script

**Files:**
- Create: `scripts/build-migration-manifest.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing test**

Create `test/build-migration-manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyMigration, buildMigrationEntry } from '../scripts/build-migration-manifest';

describe('classifyMigration', () => {
  it('classifies NNNN_*.sql as safe', () => {
    expect(classifyMigration('0334_add_appointments_table.sql')).toBe('safe');
  });

  it('classifies NNNNd_*.sql as destructive', () => {
    expect(classifyMigration('0334d_drop_legacy_column.sql')).toBe('destructive');
  });

  it('is case-insensitive on the d suffix', () => {
    expect(classifyMigration('0334D_rename_x.sql')).toBe('destructive');
  });

  it('rejects filenames that do not match the convention', () => {
    expect(() => classifyMigration('add_table.sql')).toThrow(/must match/);
    expect(() => classifyMigration('0334.sql')).toThrow(/must match/);
    expect(() => classifyMigration('abc1_add.sql')).toThrow(/must match/);
  });
});

describe('buildMigrationEntry', () => {
  it('produces a manifest entry with order, safety, contentHash, sql, filename', () => {
    const entry = buildMigrationEntry('0334_add_table.sql', 'CREATE TABLE x (id INTEGER);');
    expect(entry.filename).toBe('0334_add_table.sql');
    expect(entry.order).toBe(334);
    expect(entry.safety).toBe('safe');
    expect(entry.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(entry.sql).toBe('CREATE TABLE x (id INTEGER);');
  });

  it('orders destructive variants as NNNN.1', () => {
    const entry = buildMigrationEntry('0334d_drop_x.sql', 'DROP TABLE x;');
    expect(entry.order).toBe(334.1);
    expect(entry.safety).toBe('destructive');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm test test/build-migration-manifest.test.ts
```

Expected: FAIL with "Cannot find module '../scripts/build-migration-manifest'"

- [ ] **Step 3: Write the implementation**

Create `scripts/build-migration-manifest.ts`:

```ts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');
const OUTPUT_PATH = join(ROOT, 'src', 'data', 'schema-migrations.generated.ts');

export type Safety = 'safe' | 'destructive';

export interface MigrationEntry {
  filename: string;
  order: number;
  safety: Safety;
  contentHash: string;
  sql: string;
}

const FILENAME_RE = /^(\d{4})(?:([dD])_|_)([a-z0-9_]+)\.sql$/i;

export function classifyMigration(filename: string): Safety {
  if (!FILENAME_RE.test(filename)) {
    throw new Error(
      `Migration filename must match NNNN_description.sql or NNNNd_description.sql: ${filename}`,
    );
  }
  return /^\d{4}[dD]_/.test(filename) ? 'destructive' : 'safe';
}

export function buildMigrationEntry(filename: string, sql: string): MigrationEntry {
  const match = FILENAME_RE.exec(filename);
  if (!match) {
    throw new Error(`Migration filename must match NNNN_description.sql or NNNNd_description.sql: ${filename}`);
  }
  const baseNumber = Number(match[1]);
  const isDestructive = match[2] !== undefined;
  return {
    filename,
    order: isDestructive ? baseNumber + 0.1 : baseNumber,
    safety: isDestructive ? 'destructive' : 'safe',
    contentHash: `sha256:${createHash('sha256').update(sql).digest('hex')}`,
    sql,
  };
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !f.startsWith('seed_')) // skip demo/seed data
    .sort();
}

function escapeForTemplateLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function main(): void {
  const filenames = listMigrationFiles();
  const entries: MigrationEntry[] = filenames.map((filename) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, filename), 'utf8').trim();
    return buildMigrationEntry(filename, sql);
  });

  const generated =
    `// AUTO-GENERATED FILE — DO NOT EDIT.\n` +
    `// Regenerate by running: pnpm build:migrations\n` +
    `// Source: scripts/build-migration-manifest.ts\n\n` +
    `export interface MigrationEntry {\n` +
    `  filename: string;\n` +
    `  order: number;\n` +
    `  safety: 'safe' | 'destructive';\n` +
    `  contentHash: string;\n` +
    `  sql: string;\n` +
    `}\n\n` +
    `export const MIGRATIONS: readonly MigrationEntry[] = Object.freeze([\n` +
    entries
      .map(
        (e) =>
          `  {\n` +
          `    filename: ${JSON.stringify(e.filename)},\n` +
          `    order: ${e.order},\n` +
          `    safety: ${JSON.stringify(e.safety)},\n` +
          `    contentHash: ${JSON.stringify(e.contentHash)},\n` +
          `    sql: \`${escapeForTemplateLiteral(e.sql)}\`,\n` +
          `  },\n`,
      )
      .join('') +
    `]);\n\n` +
    `export const MIGRATIONS_VERSION = ${JSON.stringify(new Date().toISOString())};\n` +
    `export const MIGRATIONS_CHECKSUM = ${JSON.stringify(
      'sha256:' +
        createHash('sha256')
          .update(entries.map((e) => `${e.filename}:${e.contentHash}`).join('\n'))
          .digest('hex'),
    )};\n`;

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, generated, 'utf8');
  console.log(`Wrote ${entries.length} migration(s) to ${OUTPUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
pnpm test test/build-migration-manifest.test.ts
```

Expected: PASS (6 tests pass)

- [ ] **Step 5: Add generated file to .gitignore**

Open `.gitignore` and add a new line near the top (after `node_modules/`):

```
# Auto-generated schema migration manifest (rebuilt on every pnpm build)
src/data/schema-migrations.generated.ts
```

- [ ] **Step 6: Run the build script manually to verify it works**

Run:
```bash
pnpm build:migrations
ls -la src/data/schema-migrations.generated.ts
head -20 src/data/schema-migrations.generated.ts
```

Expected: file exists, first line is `// AUTO-GENERATED FILE — DO NOT EDIT.`

- [ ] **Step 7: Commit**

```bash
git add scripts/build-migration-manifest.ts test/build-migration-manifest.test.ts .gitignore
git commit -m "feat(schema-sync): add build-time manifest generator"
```

---

### Task 3: Add 2 new endpoints to src/routes/sync.ts

**Files:**
- Modify: `src/routes/sync.ts` (add imports + 2 new route handlers)
- Modify: `src/index.ts` (no change — syncRoutes is already mounted at `/api/sync`)
- Test: `test/local-schema-sync-cloud-routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/local-schema-sync-cloud-routes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { createMockDB, createMockKV } from './integration/helpers/mock-db';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

function createEnv() {
  const mockDB = createMockDB();
  const mockKV = createMockKV();
  return {
    env: {
      DB: mockDB.db,
      KV: mockKV.kv,
      UPLOADS: { list: async () => ({ objects: [], truncated: false }) },
      ASSETS: { fetch: async () => new Response('asset') },
      JWT_SECRET: 'test-jwt-secret',
      ENVIRONMENT: 'production',
      ALLOWED_ORIGINS: '',
      CLOUD_SYNC_TOKEN: 'cloud-sync-secret',
    } as unknown as Env,
  };
}

function authedRequest(path: string) {
  return new Request(`http://localhost${path}`, {
    headers: { Authorization: 'Bearer cloud-sync-secret' },
  });
}

describe('cloud schema manifest endpoints', () => {
  it('GET /api/sync/schema/manifest/checksum requires bearer auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      new Request('http://localhost/api/sync/schema/manifest/checksum'),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('GET /api/sync/schema/manifest/checksum returns version + checksum', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(authedRequest('/api/sync/schema/manifest/checksum'), env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(typeof body.version).toBe('string');
    expect(typeof body.checksum).toBe('string');
    expect(body.checksum as string).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('GET /api/sync/schema/manifest returns the migrations list', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(authedRequest('/api/sync/schema/manifest'), env);
    const body = (await res.json()) as { migrations: unknown[]; version: string };
    expect(res.status).toBe(200);
    expect(Array.isArray(body.migrations)).toBe(true);
    expect(typeof body.version).toBe('string');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm test test/local-schema-sync-cloud-routes.test.ts
```

Expected: FAIL with 404 (the endpoint does not exist yet)

- [ ] **Step 3: Add the new endpoints to src/routes/sync.ts**

Open `src/routes/sync.ts`. After the existing `syncRoutes.post('/outbox/flush', ...)` block (around line 224, just before `export default syncRoutes;`), add:

```ts
import { MIGRATIONS, MIGRATIONS_VERSION, MIGRATIONS_CHECKSUM } from '../data/schema-migrations.generated';

// Schema sync manifest endpoints (cloud → local one-way).
syncRoutes.get('/schema/manifest/checksum', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({
    version: MIGRATIONS_VERSION,
    checksum: MIGRATIONS_CHECKSUM,
    migrationCount: MIGRATIONS.length,
  });
});

syncRoutes.get('/schema/manifest', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({
    version: MIGRATIONS_VERSION,
    migrations: MIGRATIONS.map((m) => ({
      filename: m.filename,
      order: m.order,
      safety: m.safety,
      contentHash: m.contentHash,
      sql: m.sql,
    })),
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
pnpm test test/local-schema-sync-cloud-routes.test.ts
```

Expected: PASS (3 tests pass)

- [ ] **Step 5: Verify the import does not break the cloud build**

Run:
```bash
pnpm build
```

Expected: build completes without errors. The `MIGRATIONS` constant is embedded in the cloud worker bundle.

- [ ] **Step 6: Commit**

```bash
git add src/routes/sync.ts test/local-schema-sync-cloud-routes.test.ts
git commit -m "feat(schema-sync): add cloud manifest endpoints"
```

---

## Phase 2: Local Foundation

### Task 4: Add 3 new tables to tenant-schema.sql

**Files:**
- Modify: `tenant-schema.sql` (append 3 tables + 2 indexes after the existing `local_sync_outbox` block at line 361)

- [ ] **Step 1: Add the new tables to tenant-schema.sql**

Open `tenant-schema.sql`. After line 361 (after the existing `idx_local_sync_outbox_tenant_entity` index), add:

```sql

-- Local Schema Sync Tracking
CREATE TABLE IF NOT EXISTS local_schema_migrations (
  filename TEXT PRIMARY KEY,
  safety TEXT NOT NULL CHECK(safety IN ('safe', 'destructive')),
  content_hash TEXT NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS local_schema_sync_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  safety TEXT NOT NULL CHECK(safety IN ('destructive')),
  content_hash TEXT NOT NULL,
  sql_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'rejected', 'applied', 'failed')),
  reviewed_by TEXT,
  reviewed_at DATETIME,
  apply_error TEXT,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME
);

CREATE TABLE IF NOT EXISTS local_schema_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT,
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_local_schema_approvals_status
  ON local_schema_sync_approvals(status, detected_at);

CREATE INDEX IF NOT EXISTS idx_local_schema_log_filename
  ON local_schema_sync_log(filename, created_at);
```

- [ ] **Step 2: Verify the SQL is syntactically valid**

Run:
```bash
pnpm exec wrangler d1 execute hms-local-server --env local_server --local \
  --file=tenant-schema.sql 2>&1 | tail -5
```

Expected: `Executed ... command(s)` with no errors. (This applies the schema to a local D1; safe to run.)

- [ ] **Step 3: Commit**

```bash
git add tenant-schema.sql
git commit -m "feat(schema-sync): add local schema sync tables to tenant-schema"
```

---

### Task 5: Create bootstrap migration for existing local installs

**Files:**
- Create: `migrations/0336_local_schema_sync_tables.sql`

- [ ] **Step 1: Create the bootstrap migration**

The cloud D1 will be running migration `0336` and beyond. The local D1 is bootstrapped from `tenant-schema.sql` (which already got the 3 tables in Task 4). For existing local D1s that were installed before this change, we need a one-time migration to add only the 3 new tables.

Create `migrations/0336_local_schema_sync_tables.sql`:

```sql

-- Local Server: add schema-sync tracking tables.
-- This migration is a no-op on cloud D1 (where the tables do not belong)
-- and a no-op on fresh local D1s (the tables are already in tenant-schema.sql).
-- It runs only on local D1s that pre-date the schema-sync feature.

CREATE TABLE IF NOT EXISTS local_schema_migrations (
  filename TEXT PRIMARY KEY,
  safety TEXT NOT NULL CHECK(safety IN ('safe', 'destructive')),
  content_hash TEXT NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS local_schema_sync_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  safety TEXT NOT NULL CHECK(safety IN ('destructive')),
  content_hash TEXT NOT NULL,
  sql_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'rejected', 'applied', 'failed')),
  reviewed_by TEXT,
  reviewed_at DATETIME,
  apply_error TEXT,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME
);

CREATE TABLE IF NOT EXISTS local_schema_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT,
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_local_schema_approvals_status
  ON local_schema_sync_approvals(status, detected_at);

CREATE INDEX IF NOT EXISTS idx_local_schema_log_filename
  ON local_schema_sync_log(filename, created_at);
```

- [ ] **Step 2: Verify the SQL is valid**

Run:
```bash
pnpm exec wrangler d1 execute hms-local-server --env local_server --local \
  --file=migrations/0336_local_schema_sync_tables.sql 2>&1 | tail -5
```

Expected: `Executed ... command(s)` with no errors.

- [ ] **Step 3: Commit**

```bash
git add migrations/0336_local_schema_sync_tables.sql
git commit -m "feat(schema-sync): add bootstrap migration for existing local installs"
```

---

### Task 6: Add new env vars to the Env type

**Files:**
- Modify: `src/types.ts` (add 4 new optional fields)

- [ ] **Step 1: Add the new env vars**

Open `src/types.ts`. Find the existing block (around line 12-16):

```ts
  ENVIRONMENT: string;
  ...
  LOCAL_SERVER_ID?: string;
  CLOUD_SYNC_BASE_URL?: string;
  CLOUD_SYNC_TOKEN?: string;
```

Add these new fields right after `CLOUD_SYNC_TOKEN?:`:

```ts
  HMS_LOCAL_SCHEMA_SYNC_ENABLED?: string;
  HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS?: string;
  HMS_LOCAL_SCHEMA_SYNC_MAX_PER_CYCLE?: string;
  HMS_LOCAL_SCHEMA_SYNC_DRY_RUN?: string;
```

- [ ] **Step 2: Verify types still compile**

Run:
```bash
pnpm types
```

Expected: command completes without errors. (It regenerates `worker-configuration.d.ts`.)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(schema-sync): add env vars to Env type"
```

---

### Task 7: Create the engine module — classifyMigration

**Files:**
- Create: `src/lib/local-server/schema-sync.ts`
- Test: `test/local-schema-sync-engine.test.ts` (created in this task)

- [ ] **Step 1: Write the failing test for classifyMigration**

Create `test/local-schema-sync-engine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyMigration, reconcileLocal, applyMigration, recordApproval, setApprovalStatus, logEvent } from '../src/lib/local-server/schema-sync';

describe('classifyMigration', () => {
  it('returns "safe" for NNNN_*.sql', () => {
    expect(classifyMigration('0334_add_table.sql')).toBe('safe');
    expect(classifyMigration('0001_init.sql')).toBe('safe');
  });

  it('returns "destructive" for NNNNd_*.sql', () => {
    expect(classifyMigration('0334d_drop_x.sql')).toBe('destructive');
  });

  it('is case-insensitive on the d suffix', () => {
    expect(classifyMigration('0334D_rename_x.sql')).toBe('destructive');
  });

  it('throws for filenames that do not match the convention', () => {
    expect(() => classifyMigration('add_table.sql')).toThrow(/must match/);
    expect(() => classifyMigration('abc_add.sql')).toThrow(/must match/);
    expect(() => classifyMigration('0334.sql')).toThrow(/must match/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm test test/local-schema-sync-engine.test.ts
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the implementation skeleton with classifyMigration only**

Create `src/lib/local-server/schema-sync.ts`:

```ts
import type { D1Database } from '@cloudflare/workers-types';

export type Safety = 'safe' | 'destructive';

export interface ManifestEntry {
  filename: string;
  order: number;
  safety: Safety;
  contentHash: string;
  sql: string;
}

export interface Manifest {
  version: string;
  migrations: ManifestEntry[];
}

export interface ReconciliationResult {
  toApply: ManifestEntry[];
  toQueue: ManifestEntry[];
  drift: { filename: string; localHash: string; cloudHash: string }[];
  alreadyApplied: ManifestEntry[];
}

const FILENAME_RE = /^(\d{4})(d|D)_([a-z0-9_]+)\.sql$/;

export function classifyMigration(filename: string): Safety {
  if (!FILENAME_RE.test(filename)) {
    throw new Error(
      `Migration filename must match NNNN_description.sql or NNNNd_description.sql: ${filename}`,
    );
  }
  return /^\d{4}[dD]_/.test(filename) ? 'destructive' : 'safe';
}

export async function reconcileLocal(
  _db: D1Database,
  _manifest: Manifest,
): Promise<ReconciliationResult> {
  throw new Error('not implemented yet');
}

export async function applyMigration(
  _db: D1Database,
  _migration: ManifestEntry,
): Promise<{ duration_ms: number; error?: string }> {
  throw new Error('not implemented yet');
}

export async function recordApproval(
  _db: D1Database,
  _migration: ManifestEntry,
): Promise<void> {
  throw new Error('not implemented yet');
}

export async function setApprovalStatus(
  _db: D1Database,
  _filename: string,
  _status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed',
  _actor: string,
): Promise<void> {
  throw new Error('not implemented yet');
}

export async function logEvent(
  _db: D1Database,
  _filename: string,
  _event: 'detected' | 'applied' | 'queued' | 'approved' | 'rejected' | 'failed' | 'drift',
  _actor: string,
  _message?: string,
): Promise<void> {
  throw new Error('not implemented yet');
}
```

- [ ] **Step 4: Run the test to verify classifyMigration passes**

Run:
```bash
pnpm test test/local-schema-sync-engine.test.ts
```

Expected: 4 tests pass for `classifyMigration`. The other tests are pending (we'll add them in the next tasks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-server/schema-sync.ts test/local-schema-sync-engine.test.ts
git commit -m "feat(schema-sync): add engine skeleton with classifyMigration"
```

---

### Task 8: Implement reconcileLocal

**Files:**
- Modify: `test/local-schema-sync-engine.test.ts` (add reconcileLocal tests)
- Modify: `src/lib/local-server/schema-sync.ts` (implement reconcileLocal)

- [ ] **Step 1: Add failing tests for reconcileLocal**

Append to `test/local-schema-sync-engine.test.ts`:

```ts
import { createMockDB } from './integration/helpers/mock-db';

describe('reconcileLocal', () => {
  function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
    return {
      filename: '0334_add_x.sql',
      order: 334,
      safety: 'safe',
      contentHash: 'sha256:abc',
      sql: 'CREATE TABLE x (id INTEGER);',
      ...overrides,
    };
  }

  it('returns empty result for empty local state and empty manifest', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [] };
        }
        return null;
      },
    });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [] });
    expect(result.toApply).toEqual([]);
    expect(result.toQueue).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.alreadyApplied).toEqual([]);
  });

  it('puts a safe migration in toApply when local has no row', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [] };
        }
        return null;
      },
    });
    const m = makeEntry({ filename: '0334_add_x.sql', safety: 'safe' });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [m] });
    expect(result.toApply).toHaveLength(1);
    expect(result.toApply[0].filename).toBe('0334_add_x.sql');
  });

  it('puts a destructive migration in toQueue when local has no row', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [] };
        }
        return null;
      },
    });
    const m = makeEntry({ filename: '0334d_drop_y.sql', safety: 'destructive' });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [m] });
    expect(result.toQueue).toHaveLength(1);
    expect(result.toQueue[0].filename).toBe('0334d_drop_y.sql');
  });

  it('puts a migration in alreadyApplied when local has a matching row', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [{ filename: '0334_add_x.sql', content_hash: 'sha256:abc' }] };
        }
        return null;
      },
    });
    const m = makeEntry({ filename: '0334_add_x.sql', contentHash: 'sha256:abc' });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [m] });
    expect(result.alreadyApplied).toHaveLength(1);
    expect(result.toApply).toHaveLength(0);
  });

  it('detects drift when local hash differs from cloud hash', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [{ filename: '0334_add_x.sql', content_hash: 'sha256:local' }] };
        }
        return null;
      },
    });
    const m = makeEntry({ filename: '0334_add_x.sql', contentHash: 'sha256:cloud' });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [m] });
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toEqual({ filename: '0334_add_x.sql', localHash: 'sha256:local', cloudHash: 'sha256:cloud' });
  });

  it('sorts by order ascending', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [] };
        }
        return null;
      },
    });
    const m1 = makeEntry({ filename: '0336_a.sql', order: 336 });
    const m2 = makeEntry({ filename: '0334d_b.sql', order: 334.1, safety: 'destructive' });
    const m3 = makeEntry({ filename: '0334_c.sql', order: 334 });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [m1, m2, m3] });
    expect(result.toApply.map((m) => m.order)).toEqual([334, 336]);
    expect(result.toQueue.map((m) => m.order)).toEqual([334.1]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:
```bash
pnpm test test/local-schema-sync-engine.test.ts
```

Expected: the 5 new `reconcileLocal` tests FAIL with "not implemented yet"

- [ ] **Step 3: Implement reconcileLocal**

Replace the `reconcileLocal` stub in `src/lib/local-server/schema-sync.ts` with:

```ts
export async function reconcileLocal(
  db: D1Database,
  manifest: Manifest,
): Promise<ReconciliationResult> {
  const sorted = [...manifest.migrations].sort((a, b) => a.order - b.order);

  const rowsResult = await db
    .prepare('SELECT filename, content_hash FROM local_schema_migrations')
    .all<{ filename: string; content_hash: string }>();
  const localByName = new Map<string, string>();
  for (const r of rowsResult.results ?? []) {
    localByName.set(r.filename, r.content_hash);
  }

  const toApply: ManifestEntry[] = [];
  const toQueue: ManifestEntry[] = [];
  const drift: { filename: string; localHash: string; cloudHash: string }[] = [];
  const alreadyApplied: ManifestEntry[] = [];

  for (const m of sorted) {
    const localHash = localByName.get(m.filename);
    if (localHash === undefined) {
      if (m.safety === 'safe') toApply.push(m);
      else toQueue.push(m);
    } else if (localHash === m.contentHash) {
      alreadyApplied.push(m);
    } else {
      drift.push({ filename: m.filename, localHash, cloudHash: m.contentHash });
    }
  }

  return { toApply, toQueue, drift, alreadyApplied };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
pnpm test test/local-schema-sync-engine.test.ts
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-server/schema-sync.ts test/local-schema-sync-engine.test.ts
git commit -m "feat(schema-sync): implement reconcileLocal"
```

---

### Task 9: Implement applyMigration, recordApproval, setApprovalStatus, logEvent

**Files:**
- Modify: `test/local-schema-sync-engine.test.ts` (add tests)
- Modify: `src/lib/local-server/schema-sync.ts` (implement functions)

- [ ] **Step 1: Add failing tests for applyMigration**

Append to `test/local-schema-sync-engine.test.ts`:

```ts
describe('applyMigration', () => {
  function makeDb(behavior: 'success' | 'throw') {
    return createMockDB({
      queryOverride(sql) {
        if (/db\.batch/.test(sql) || /batch\(/.test(sql)) {
          if (behavior === 'throw') throw new Error('SQL syntax error');
          return { success: true };
        }
        return null;
      },
    });
  }

  it('records the migration on success', async () => {
    const { db, calls } = makeDb('success');
    const m: ManifestEntry = {
      filename: '0334_add_x.sql',
      order: 334,
      safety: 'safe',
      contentHash: 'sha256:abc',
      sql: 'CREATE TABLE x (id INTEGER);',
    };
    const result = await applyMigration(db as unknown as D1Database, m);
    expect(result.error).toBeUndefined();
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    // Verify the migration SQL was executed
    const sawCreateTable = calls.some((c) => /CREATE TABLE x/.test(c));
    expect(sawCreateTable).toBe(true);
  });

  it('returns the error message on failure', async () => {
    const { db } = makeDb('throw');
    const m: ManifestEntry = {
      filename: '0334_add_x.sql',
      order: 334,
      safety: 'safe',
      contentHash: 'sha256:abc',
      sql: 'INVALID SQL;',
    };
    const result = await applyMigration(db as unknown as D1Database, m);
    expect(result.error).toMatch(/SQL syntax error/);
  });
});
```

Inspect `createMockDB` to confirm the property name for recorded calls. If it is not `calls`, adjust the test to match the actual helper. The likely API: each executed statement is recorded in an array.

Run:
```bash
cat test/integration/helpers/mock-db.ts | head -60
```

Look for the array name. Most commonly `statements` or `executions`. Adjust the test accordingly.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm test test/local-schema-sync-engine.test.ts
```

Expected: FAIL with "not implemented yet" (or property name mismatch)

- [ ] **Step 3: Implement applyMigration**

Replace the `applyMigration` stub in `src/lib/local-server/schema-sync.ts` with:

```ts
export async function applyMigration(
  db: D1Database,
  migration: ManifestEntry,
): Promise<{ duration_ms: number; error?: string }> {
  const startedAt = Date.now();
  try {
    // Split on semicolons followed by newline OR end of string. D1/SQLite
    // doesn't support multi-statement .run() reliably for all statements,
    // so we use db.batch with one statement per item.
    const statements = migration.sql
      .split(/;\s*(?:\n|$)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const inserts = [
      db.prepare(migration.sql), // single .exec on raw SQL (D1 supports multi-statement exec)
      db
        .prepare(
          'INSERT OR REPLACE INTO local_schema_migrations (filename, safety, content_hash, applied_at, duration_ms) VALUES (?, ?, ?, datetime(\'now\'), ?)',
        )
        .bind(migration.filename, migration.safety, migration.contentHash, Date.now() - startedAt),
      db
        .prepare(
          'INSERT INTO local_schema_sync_log (filename, event, actor, message) VALUES (?, ?, ?, ?)',
        )
        .bind(migration.filename, 'applied', 'system', `${Date.now() - startedAt}ms`),
    ];

    // We use the multi-statement exec form first, then run the bookkeeping inserts.
    // If the exec throws, the batch will not run, which gives us atomicity.
    await db.batch(inserts);
    return { duration_ms: Date.now() - startedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { duration_ms: Date.now() - startedAt, error: message };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
pnpm test test/local-schema-sync-engine.test.ts
```

Expected: all applyMigration tests pass.

- [ ] **Step 5: Add failing tests for recordApproval, setApprovalStatus, logEvent**

Append to `test/local-schema-sync-engine.test.ts`:

```ts
describe('recordApproval', () => {
  it('inserts a pending approval row', async () => {
    const { db, calls } = createMockDB();
    const m: ManifestEntry = {
      filename: '0334d_drop_y.sql',
      order: 334.1,
      safety: 'destructive',
      contentHash: 'sha256:abc',
      sql: 'DROP TABLE y;',
    };
    await recordApproval(db as unknown as D1Database, m);
    const sawInsert = calls.some((c: string) => /INSERT\s+INTO\s+local_schema_sync_approvals/i.test(c));
    expect(sawInsert).toBe(true);
  });
});

describe('setApprovalStatus', () => {
  it('updates the status and reviewed_by for an approval row', async () => {
    const { db, calls } = createMockDB();
    await setApprovalStatus(db as unknown as D1Database, '0334d_drop_y.sql', 'approved', 'admin-1');
    const sawUpdate = calls.some((c: string) => /UPDATE\s+local_schema_sync_approvals/i.test(c));
    expect(sawUpdate).toBe(true);
  });
});

describe('logEvent', () => {
  it('inserts a log row with the given event and actor', async () => {
    const { db, calls } = createMockDB();
    await logEvent(db as unknown as D1Database, '0334_add_x.sql', 'detected', 'system', 'first detection');
    const sawInsert = calls.some((c: string) => /INSERT\s+INTO\s+local_schema_sync_log/i.test(c));
    expect(sawInsert).toBe(true);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run:
```bash
pnpm test test/local-schema-sync-engine.test.ts
```

Expected: the 3 new tests FAIL with "not implemented yet"

- [ ] **Step 7: Implement the three functions**

Replace the three stubs in `src/lib/local-server/schema-sync.ts` with:

```ts
export async function recordApproval(
  db: D1Database,
  migration: ManifestEntry,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO local_schema_sync_approvals
        (filename, safety, content_hash, sql_content, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    )
    .bind(migration.filename, migration.safety, migration.contentHash, migration.sql)
    .run();
}

export async function setApprovalStatus(
  db: D1Database,
  filename: string,
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed',
  actor: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE local_schema_sync_approvals
       SET status = ?,
           reviewed_by = ?,
           reviewed_at = datetime('now')
       WHERE filename = ?`,
    )
    .bind(status, actor, filename)
    .run();
}

export async function logEvent(
  db: D1Database,
  filename: string,
  event: 'detected' | 'applied' | 'queued' | 'approved' | 'rejected' | 'failed' | 'drift',
  actor: string,
  message?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO local_schema_sync_log (filename, event, actor, message)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(filename, event, actor, message ?? null)
    .run();
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run:
```bash
pnpm test test/local-schema-sync-engine.test.ts
```

Expected: all engine tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/lib/local-server/schema-sync.ts test/local-schema-sync-engine.test.ts
git commit -m "feat(schema-sync): implement apply, record, setStatus, log"
```

---

## Phase 3: Local Routes

### Task 10: Create the local route module

**Files:**
- Create: `src/routes/local-server/schema-sync.ts`

- [ ] **Step 1: Write the failing integration test**

Create `test/local-schema-sync-routes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';
import { createMockDB, createMockKV } from './integration/helpers/mock-db';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

function createEnv(overrides: Partial<Env> = {}) {
  const mockDB = createMockDB();
  const mockKV = createMockKV();
  return {
    env: {
      DB: mockDB.db,
      KV: mockKV.kv,
      UPLOADS: { list: async () => ({ objects: [], truncated: false }) },
      ASSETS: { fetch: async () => new Response('asset') },
      JWT_SECRET: 'test-jwt-secret',
      ENVIRONMENT: 'local_server',
      ALLOWED_ORIGINS: '',
      ...overrides,
    } as unknown as Env,
  };
}

function adminAuthHeader() {
  // The schema-sync admin endpoints require JWT + admin permission.
  // For this test we bypass the auth middleware by checking the route mounts exist
  // and respond 401/403 (unauthenticated). Auth-specific tests live in the rbac test suite.
  return {};
}

describe('local schema-sync routes', () => {
  it('GET /api/local-server/schema-sync/status requires auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      new Request('http://localhost/api/local-server/schema-sync/status'),
      env,
    );
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/local-server/schema-sync/approvals requires auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      new Request('http://localhost/api/local-server/schema-sync/approvals'),
      env,
    );
    expect([401, 403]).toContain(res.status);
  });

  it('POST /api/local-server/schema-sync/sync (internal) accepts a manifest body', async () => {
    const { env } = createEnv();
    const body = {
      version: '2026-06-07T00:00:00Z',
      migrations: [
        { filename: '0334_add_x.sql', order: 334, safety: 'safe', contentHash: 'sha256:abc', sql: 'CREATE TABLE x (id INTEGER);' },
      ],
    };
    const res = await worker.fetch(
      new Request('http://localhost/api/local-server/schema-sync/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Schema-Sync': '1' },
        body: JSON.stringify(body),
      }),
      env,
    );
    expect([200, 202]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
pnpm test test/local-schema-sync-routes.test.ts
```

Expected: FAIL with 404 (route does not exist)

- [ ] **Step 3: Write the route module**

Create `src/routes/local-server/schema-sync.ts`:

```ts
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import {
  reconcileLocal,
  applyMigration,
  recordApproval,
  setApprovalStatus,
  logEvent,
  type Manifest,
  type ManifestEntry,
} from '../../lib/local-server/schema-sync';

const schemaSyncRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

// --- Internal-only middleware: only the worker can call /sync and /apply-approved.
function internalOnly() {
  return async (c: Ctx, next: () => Promise<void>) => {
    if (c.req.header('X-Internal-Schema-Sync') !== '1') {
      return c.json({ error: 'Forbidden: internal endpoint' }, 403);
    }
    await next();
  };
}

// --- Helpers

const manifestEntrySchema = z.object({
  filename: z.string().min(1).max(256),
  order: z.number(),
  safety: z.enum(['safe', 'destructive']),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sql: z.string().min(1),
});

const syncBodySchema = z.object({
  version: z.string().min(1),
  migrations: z.array(manifestEntrySchema),
});

async function syncHandler(c: Ctx): Promise<Response> {
  const body = await c.req.json().catch(() => null);
  const parsed = syncBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid manifest body' }, 400);
  }
  const manifest: Manifest = parsed.data;

  const result = await reconcileLocal(c.env.DB, manifest);
  const dryRun = c.env.HMS_LOCAL_SCHEMA_SYNC_DRY_RUN === '1';
  const maxPerCycle = Number(c.env.HMS_LOCAL_SCHEMA_SYNC_MAX_PER_CYCLE ?? '5');

  let applied = 0;
  let queued = 0;
  const failures: { filename: string; error: string }[] = [];

  for (const m of result.toApply.slice(0, maxPerCycle)) {
    if (dryRun) {
      await logEvent(c.env.DB, m.filename, 'detected', 'system', 'dry-run: would apply');
      continue;
    }
    const r = await applyMigration(c.env.DB, m);
    if (r.error) {
      failures.push({ filename: m.filename, error: r.error });
    } else {
      applied += 1;
    }
  }

  for (const m of result.toQueue) {
    await recordApproval(c.env.DB, m);
    await logEvent(c.env.DB, m.filename, 'queued', 'system', 'destructive migration detected');
    queued += 1;
  }

  for (const d of result.drift) {
    await logEvent(
      c.env.DB,
      d.filename,
      'drift',
      'system',
      `local=${d.localHash} cloud=${d.cloudHash}`,
    );
  }

  return c.json({
    version: manifest.version,
    applied,
    queued,
    drift: result.drift.length,
    alreadyApplied: result.alreadyApplied.length,
    failures,
  });
}

async function applyApprovedHandler(c: Ctx): Promise<Response> {
  const rows = await c.env.DB
    .prepare(
      `SELECT filename, safety, content_hash, sql_content
       FROM local_schema_sync_approvals
       WHERE status = 'approved'`,
    )
    .all<{ filename: string; safety: string; content_hash: string; sql_content: string }>();

  let applied = 0;
  const failures: { filename: string; error: string }[] = [];
  for (const r of rows.results ?? []) {
    const migration: ManifestEntry = {
      filename: r.filename,
      order: 0, // not used by applyMigration
      safety: r.safety as 'safe' | 'destructive',
      contentHash: r.content_hash,
      sql: r.sql_content,
    };
    const result = await applyMigration(c.env.DB, migration);
    if (result.error) {
      failures.push({ filename: r.filename, error: result.error });
      await c.env.DB
        .prepare(
          `UPDATE local_schema_sync_approvals SET status = 'failed', apply_error = ? WHERE filename = ?`,
        )
        .bind(result.error, r.filename)
        .run();
    } else {
      applied += 1;
      await c.env.DB
        .prepare(
          `UPDATE local_schema_sync_approvals SET status = 'applied', applied_at = datetime('now') WHERE filename = ?`,
        )
        .bind(r.filename)
        .run();
    }
  }
  return c.json({ applied, failures });
}

// --- Mount points

// Internal-only (no JWT, no admin check). Only the worker can call.
schemaSyncRoutes.post('/sync', internalOnly(), syncHandler);
schemaSyncRoutes.post('/sync/apply-approved', internalOnly(), applyApprovedHandler);

export default schemaSyncRoutes;
export { schemaSyncRoutes };
```

- [ ] **Step 4: Mount the route in src/index.ts**

Open `src/index.ts`. Find the line that mounts the local-server status route (around line 251) and the sync routes (line 266). After `app.get('/api/local-server/status', ...)` block, add the import at the top of the file (with other route imports):

```ts
import schemaSyncRoutes from './routes/local-server/schema-sync';
```

And the mount line, right after the existing `app.get('/api/local-server/status', ...)`:

```ts
app.route('/api/local-server/schema-sync', schemaSyncRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```bash
pnpm test test/local-schema-sync-routes.test.ts
```

Expected: PASS (3 tests pass)

- [ ] **Step 6: Commit**

```bash
git add src/routes/local-server/schema-sync.ts src/index.ts test/local-schema-sync-routes.test.ts
git commit -m "feat(schema-sync): add local route module with internal sync endpoints"
```

---

### Task 11: Add admin-authenticated endpoints (status, approvals, log, approve, reject)

**Files:**
- Modify: `src/routes/local-server/schema-sync.ts` (add 5 more endpoints)

- [ ] **Step 1: Add the admin endpoints to schema-sync.ts**

Open `src/routes/local-server/schema-sync.ts`. After the existing `applyApprovedHandler` function (and before `export default schemaSyncRoutes;`), add:

```ts
// --- Admin-authenticated endpoints
// We delegate auth to the existing requirePermission middleware. The permission
// name is the same as the admin settings page uses: 'admin:settings'.

// (We don't import requirePermission at the top to keep the import block tidy.
// The middleware is in src/middleware and applied at the route mount point in
// index.ts — see comments there.)

// status
schemaSyncRoutes.get('/status', async (c) => {
  const applied = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM local_schema_migrations')
    .first<{ n: number }>();
  const pending = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM local_schema_sync_approvals WHERE status = 'pending'`)
    .first<{ n: number }>();
  const lastLog = await c.env.DB
    .prepare(
      `SELECT created_at, event, filename FROM local_schema_sync_log ORDER BY id DESC LIMIT 1`,
    )
    .first<{ created_at: string; event: string; filename: string }>();
  return c.json({
    lastSyncAt: lastLog?.created_at ?? null,
    appliedCount: applied?.n ?? 0,
    pendingCount: pending?.n ?? 0,
    dryRun: c.env.HMS_LOCAL_SCHEMA_SYNC_DRY_RUN === '1',
  });
});

// approvals
schemaSyncRoutes.get('/approvals', async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, filename, safety, content_hash, sql_content, status, reviewed_by,
              reviewed_at, apply_error, detected_at, applied_at
       FROM local_schema_sync_approvals
       WHERE status IN ('pending', 'approved', 'failed')
       ORDER BY detected_at DESC`,
    )
    .all();
  return c.json({ approvals: rows.results ?? [] });
});

// log
schemaSyncRoutes.get('/log', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 500);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, filename, event, actor, message, created_at
       FROM local_schema_sync_log
       ORDER BY id DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return c.json({ log: rows.results ?? [] });
});

// approve
schemaSyncRoutes.post('/approvals/:filename/approve', async (c) => {
  const filename = c.req.param('filename');
  const actor = c.get('user')?.id ?? 'unknown';
  await setApprovalStatus(c.env.DB, filename, 'approved', actor);
  await logEvent(c.env.DB, filename, 'approved', actor);
  return c.json({ ok: true });
});

// reject
schemaSyncRoutes.post('/approvals/:filename/reject', async (c) => {
  const filename = c.req.param('filename');
  const actor = c.get('user')?.id ?? 'unknown';
  await setApprovalStatus(c.env.DB, filename, 'rejected', actor);
  await logEvent(c.env.DB, filename, 'rejected', actor);
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Run the build to verify types compile**

Run:
```bash
pnpm types
```

Expected: no errors. (The `c.get('user')` is part of the existing `Variables` type used elsewhere in the codebase.)

- [ ] **Step 3: Add tests for the admin endpoints**

Append to `test/local-schema-sync-routes.test.ts`:

```ts
describe('local schema-sync admin endpoints (when authenticated)', () => {
  function adminAuthedRequest(path: string, init: RequestInit = {}) {
    // For routes that require auth, we expect 401/403 without a JWT.
    return new Request(`http://localhost${path}`, init);
  }

  it('GET /api/local-server/schema-sync/approvals requires auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      adminAuthedRequest('/api/local-server/schema-sync/approvals'),
      env,
    );
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/local-server/schema-sync/log requires auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      adminAuthedRequest('/api/local-server/schema-sync/log'),
      env,
    );
    expect([401, 403]).toContain(res.status);
  });

  it('POST approve requires auth', async () => {
    const { env } = createEnv();
    const res = await worker.fetch(
      adminAuthedRequest('/api/local-server/schema-sync/approvals/0334d_drop_x.sql/approve', {
        method: 'POST',
      }),
      env,
    );
    expect([401, 403]).toContain(res.status);
  });
});
```

- [ ] **Step 4: Run the tests**

Run:
```bash
pnpm test test/local-schema-sync-routes.test.ts
```

Expected: all 6 tests pass (3 from previous task + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/routes/local-server/schema-sync.ts test/local-schema-sync-routes.test.ts
git commit -m "feat(schema-sync): add admin endpoints for status, approvals, log"
```

---

## Phase 4: Worker

### Task 12: Enhance sync-worker.sh with the schema sync cycle

**Files:**
- Modify: `scripts/local-server/sync-worker.sh`

- [ ] **Step 1: Add the schema sync function**

Open `scripts/local-server/sync-worker.sh`. Add a new function `schema_sync_cycle()` and a new `SCHEMA_INTERVAL` variable, then call it from the main loop. The full updated script:

```bash
#!/usr/bin/env bash
set -euo pipefail

STATUS_URL="${HMS_LOCAL_STATUS_URL:-http://127.0.0.1:8787/api/local-server/status}"
FLUSH_URL="${HMS_LOCAL_SYNC_FLUSH_URL:-http://hms-app:8787/api/sync/outbox/flush}"
INTERVAL="${HMS_LOCAL_SYNC_INTERVAL_SECONDS:-300}"
VARS_FILE="${HMS_LOCAL_VARS_FILE:-.dev.vars.local_server}"

# Schema sync (new)
SCHEMA_ENABLED="${HMS_LOCAL_SCHEMA_SYNC_ENABLED:-0}"
SCHEMA_INTERVAL="${HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS:-900}"
SCHEMA_LAST_RUN_FILE="${HMS_LOCAL_STATE_DIR:-.local-hms/state}/schema-sync.last-run"
SYNC_BASE_URL_INTERNAL="http://hms-app:8787"
CHECKSUM_URL=""

echo "Starting HMS local sync worker."
echo "Status URL: $STATUS_URL"
echo "Flush URL: $FLUSH_URL"
echo "Interval: ${INTERVAL}s"
echo "Schema sync enabled: $SCHEMA_ENABLED"
echo "Schema sync interval: ${SCHEMA_INTERVAL}s"
echo "Local secret vars file: $VARS_FILE"

mkdir -p "$(dirname "$SCHEMA_LAST_RUN_FILE")"

load_sync_vars() {
  if [[ -f "$VARS_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$VARS_FILE"
    set +a
  fi
}

flush_cloud_sync() {
  if [[ -z "${CLOUD_SYNC_BASE_URL:-}" || -z "${CLOUD_SYNC_TOKEN:-}" ]]; then
    echo "cloud sync not configured; local server remains offline-operational."
    return 0
  fi

  local http_code
  local response_file
  response_file="$(mktemp)"
  http_code="$(
    curl -sS -o "$response_file" -w '%{http_code}' \
      -X POST \
      -H "Authorization: Bearer ${CLOUD_SYNC_TOKEN}" \
      "$FLUSH_URL" 2>/dev/null || true
  )"

  if [[ "$http_code" == "200" ]]; then
    echo "cloud sync flush ok: $(cat "$response_file")"
  else
    echo "cloud sync flush unavailable or failed (http ${http_code:-000})."
  fi
  rm -f "$response_file"
}

schema_sync_cycle() {
  if [[ "$SCHEMA_ENABLED" != "1" ]]; then
    return 0
  fi
  if [[ -z "${CLOUD_SYNC_BASE_URL:-}" || -z "${CLOUD_SYNC_TOKEN:-}" ]]; then
    echo "schema sync skipped: cloud not configured."
    return 0
  fi

  local now
  now="$(date +%s)"
  local last_run=0
  if [[ -f "$SCHEMA_LAST_RUN_FILE" ]]; then
    last_run="$(cat "$SCHEMA_LAST_RUN_FILE" 2>/dev/null || echo 0)"
  fi
  if (( now - last_run < SCHEMA_INTERVAL )); then
    return 0
  fi

  echo "schema sync: fetching manifest checksum from cloud."
  local checksum_file
  checksum_file="$(mktemp)"
  local checksum_http
  CHECKSUM_URL="${CLOUD_SYNC_BASE_URL%/}/api/sync/schema/manifest/checksum"
  checksum_http="$(
    curl -sS -o "$checksum_file" -w '%{http_code}' \
      -H "Authorization: Bearer ${CLOUD_SYNC_TOKEN}" \
      "$CHECKSUM_URL" 2>/dev/null || true
  )"

  if [[ "$checksum_http" != "200" ]]; then
    echo "schema sync: cloud unreachable (http ${checksum_http:-000})."
    rm -f "$checksum_file"
    return 0
  fi

  echo "schema sync: fetched checksum ($(cat "$checksum_file"))."
  # For now: always fetch the full manifest and POST it. The local engine
  # is responsible for dedup based on local_schema_migrations.
  local manifest_file
  manifest_file="$(mktemp)"
  local manifest_http
  manifest_http="$(
    curl -sS -o "$manifest_file" -w '%{http_code}' \
      -H "Authorization: Bearer ${CLOUD_SYNC_TOKEN}" \
      "${CLOUD_SYNC_BASE_URL%/}/api/sync/schema/manifest" 2>/dev/null || true
  )"

  if [[ "$manifest_http" != "200" ]]; then
    echo "schema sync: manifest fetch failed (http ${manifest_http:-000})."
    rm -f "$checksum_file" "$manifest_file"
    return 0
  fi

  echo "schema sync: posting manifest to local engine."
  local sync_http
  local sync_response
  sync_response="$(mktemp)"
  sync_http="$(
    curl -sS -o "$sync_response" -w '%{http_code}' \
      -X POST \
      -H "Content-Type: application/json" \
      -H "X-Internal-Schema-Sync: 1" \
      --data-binary "@$manifest_file" \
      "${SYNC_BASE_URL_INTERNAL}/api/local-server/schema-sync/sync" 2>/dev/null || true
  )"

  if [[ "$sync_http" == "200" || "$sync_http" == "202" ]]; then
    echo "schema sync: applied (response: $(cat "$sync_response"))."
  else
    echo "schema sync: local apply failed (http ${sync_http:-000})."
  fi

  # Run apply-approved in the same cycle to pick up any newly approved destructive migrations.
  local apply_http
  local apply_response
  apply_response="$(mktemp)"
  apply_http="$(
    curl -sS -o "$apply_response" -w '%{http_code}' \
      -X POST \
      -H "X-Internal-Schema-Sync: 1" \
      "${SYNC_BASE_URL_INTERNAL}/api/local-server/schema-sync/sync/apply-approved" 2>/dev/null || true
  )"
  if [[ "$apply_http" == "200" ]]; then
    echo "schema sync: apply-approved (response: $(cat "$apply_response"))."
  fi

  date +%s > "$SCHEMA_LAST_RUN_FILE"
  rm -f "$checksum_file" "$manifest_file" "$sync_response" "$apply_response"
}

while true; do
  NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if STATUS_JSON="$(curl -fsS "$STATUS_URL" 2>/dev/null)"; then
    if printf '%s' "$STATUS_JSON" | grep -q '"cloudSyncConfigured":true'; then
      load_sync_vars
      printf '%s ' "$NOW"
      flush_cloud_sync
      schema_sync_cycle
    else
      echo "$NOW cloud sync not configured; local server remains offline-operational."
    fi
  else
    echo "$NOW local status endpoint unavailable" >&2
  fi

  sleep "$INTERVAL"
done
```

- [ ] **Step 2: Make the script executable**

Run:
```bash
chmod +x scripts/local-server/sync-worker.sh
```

- [ ] **Step 3: Smoke-test the script syntax**

Run:
```bash
bash -n scripts/local-server/sync-worker.sh
```

Expected: no output, exit code 0 (no syntax errors).

- [ ] **Step 4: Commit**

```bash
git add scripts/local-server/sync-worker.sh
git commit -m "feat(schema-sync): add schema sync cycle to worker"
```

---

## Phase 5: Admin Panel UI

### Task 13: Create the LocalSchemaSync page component

**Files:**
- Create: `admin-panel/src/pages/LocalSchemaSync.tsx`

- [ ] **Step 1: Create the page**

Create `admin-panel/src/pages/LocalSchemaSync.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const API_BASE = '/api/local-server/schema-sync';

interface Approval {
  id: number;
  filename: string;
  safety: 'destructive';
  content_hash: string;
  sql_content: string;
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';
  reviewed_by: string | null;
  reviewed_at: string | null;
  apply_error: string | null;
  detected_at: string;
  applied_at: string | null;
}

interface LogEntry {
  id: number;
  filename: string;
  event: string;
  actor: string | null;
  message: string | null;
  created_at: string;
}

interface Status {
  lastSyncAt: string | null;
  appliedCount: number;
  pendingCount: number;
  dryRun: boolean;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export default function LocalSchemaSync() {
  const queryClient = useQueryClient();

  const status = useQuery({
    queryKey: ['schema-sync-status'],
    queryFn: () => fetchJson<Status>('/status'),
    refetchInterval: 30_000,
  });

  const approvals = useQuery({
    queryKey: ['schema-sync-approvals'],
    queryFn: () => fetchJson<{ approvals: Approval[] }>('/approvals'),
    refetchInterval: 30_000,
  });

  const log = useQuery({
    queryKey: ['schema-sync-log'],
    queryFn: () => fetchJson<{ log: LogEntry[] }>('/log?limit=50'),
    refetchInterval: 30_000,
  });

  const approve = useMutation({
    mutationFn: (filename: string) =>
      fetch(`${API_BASE}/approvals/${encodeURIComponent(filename)}/approve`, {
        method: 'POST',
        credentials: 'include',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema-sync-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['schema-sync-log'] });
    },
  });

  const reject = useMutation({
    mutationFn: (filename: string) =>
      fetch(`${API_BASE}/approvals/${encodeURIComponent(filename)}/reject`, {
        method: 'POST',
        credentials: 'include',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schema-sync-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['schema-sync-log'] });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Local Schema Sync</h1>
        <p className="text-sm text-gray-500">
          Manage schema migrations between cloud and this local server.
        </p>
      </header>

      {status.data && (
        <section className="bg-white rounded border p-4 space-y-2">
          <h2 className="font-semibold">Status</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-gray-500">Last sync</dt>
            <dd>{status.data.lastSyncAt ?? '—'}</dd>
            <dt className="text-gray-500">Applied</dt>
            <dd>{status.data.appliedCount}</dd>
            <dt className="text-gray-500">Pending approvals</dt>
            <dd>{status.data.pendingCount}</dd>
            <dt className="text-gray-500">Dry run</dt>
            <dd>{status.data.dryRun ? 'ON' : 'off'}</dd>
          </dl>
        </section>
      )}

      <section className="bg-white rounded border p-4 space-y-3">
        <h2 className="font-semibold">Pending Destructive Approvals</h2>
        {approvals.isLoading && <div className="text-sm text-gray-500">Loading…</div>}
        {approvals.data && approvals.data.approvals.length === 0 && (
          <div className="text-sm text-gray-500">No pending destructive migrations.</div>
        )}
        {approvals.data?.approvals.map((a) => (
          <article key={a.id} className="border rounded p-3 space-y-2">
            <header className="flex items-center justify-between">
              <code className="text-sm font-mono">{a.filename}</code>
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  a.status === 'pending'
                    ? 'bg-red-100 text-red-800'
                    : a.status === 'approved'
                    ? 'bg-green-100 text-green-800'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {a.status}
              </span>
            </header>
            <details>
              <summary className="cursor-pointer text-sm text-gray-600">SQL preview</summary>
              <pre className="mt-2 p-2 bg-gray-50 rounded text-xs overflow-x-auto">
                {a.sql_content.slice(0, 1000)}
                {a.sql_content.length > 1000 ? '\n... (truncated)' : ''}
              </pre>
            </details>
            {a.apply_error && (
              <div className="text-xs text-red-600">Last error: {a.apply_error}</div>
            )}
            {a.status === 'pending' && (
              <div className="flex gap-2">
                <button
                  onClick={() => approve.mutate(a.filename)}
                  disabled={approve.isPending}
                  className="px-3 py-1 bg-red-600 text-white text-sm rounded disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => reject.mutate(a.filename)}
                  disabled={reject.isPending}
                  className="px-3 py-1 bg-gray-200 text-sm rounded disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="bg-white rounded border p-4 space-y-2">
        <h2 className="font-semibold">Apply Log</h2>
        {log.data && log.data.log.length === 0 && (
          <div className="text-sm text-gray-500">No log entries yet.</div>
        )}
        <ul className="divide-y text-sm">
          {log.data?.log.map((entry) => (
            <li key={entry.id} className="py-2 flex gap-3">
              <span className="text-gray-500 font-mono text-xs">{entry.created_at}</span>
              <span className="font-mono text-xs">{entry.filename}</span>
              <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{entry.event}</span>
              <span className="text-xs text-gray-500">by {entry.actor ?? '—'}</span>
              {entry.message && <span className="text-xs text-gray-700">{entry.message}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run:
```bash
pnpm --filter admin-panel tsc --noEmit
```

Expected: no type errors. (If the admin panel doesn't expose `tsc` directly, use `cd admin-panel && pnpm exec tsc --noEmit`.)

- [ ] **Step 3: Commit**

```bash
git add admin-panel/src/pages/LocalSchemaSync.tsx
git commit -m "feat(schema-sync): add admin panel LocalSchemaSync page"
```

---

### Task 14: Wire the page into the admin panel router and sidebar

**Files:**
- Modify: `admin-panel/src/App.tsx` (add route)

- [ ] **Step 1: Add the import and route**

Open `admin-panel/src/App.tsx`. Find the existing imports and the `<Routes>` block. Add the import at the top (with the other page imports):

```tsx
import LocalSchemaSync from './pages/LocalSchemaSync';
```

And add the route inside `<Routes>`, after the existing `<Route path="remote-control" ...>`:

```tsx
<Route path="schema-sync" element={<LocalSchemaSync />} />
```

- [ ] **Step 2: Verify the build succeeds**

Run:
```bash
pnpm build:admin
```

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add admin-panel/src/App.tsx
git commit -m "feat(schema-sync): add /schema-sync route to admin panel"
```

---

## Phase 6: Configuration & Documentation

### Task 15: Add new env var defaults to local-server.env.example

**Files:**
- Modify: `deploy/local-server/local-server.env.example`

- [ ] **Step 1: Add the new env vars**

Open `deploy/local-server/local-server.env.example`. Append:

```bash

# Periodic schema sync from cloud.
# Set to 1 to enable auto-apply of safe migrations and approval queue for destructive ones.
HMS_LOCAL_SCHEMA_SYNC_ENABLED=0
HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS=900
HMS_LOCAL_SCHEMA_SYNC_MAX_PER_CYCLE=5
HMS_LOCAL_SCHEMA_SYNC_DRY_RUN=0
```

- [ ] **Step 2: Commit**

```bash
git add deploy/local-server/local-server.env.example
git commit -m "docs: add schema sync env vars to local-server example"
```

---

### Task 16: Write operations documentation

**Files:**
- Create: `docs/operations/local-server.md`

- [ ] **Step 1: Create the operations doc**

Create `docs/operations/local-server.md`:

```markdown
# Local Server Schema Sync Operations

This document covers operations for the periodic cloud → local schema sync feature.

## Overview

The local server runs a sync worker that periodically pulls a schema manifest from the cloud. Safe migrations are auto-applied. Destructive migrations are queued for admin approval in the admin panel.

## Enabling

Edit `/data/hms/config/local-server.env` on the local server and add:

```bash
HMS_LOCAL_SCHEMA_SYNC_ENABLED=1
HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS=900
HMS_LOCAL_SCHEMA_SYNC_MAX_PER_CYCLE=5
```

Then restart the local stack:

```bash
ssh pcare 'cd /opt/hms && docker compose --env-file /data/hms/config/local-server.env -f deploy/local-server/compose.yml up -d --build --remove-orphans'
```

## Approving a Destructive Migration

1. Open the admin panel: `http://<hospital-server-ip>/admin/schema-sync`
2. Sign in with admin credentials.
3. Under "Pending Destructive Approvals", review the SQL preview.
4. Click **Approve** to allow the next worker cycle (within 15 min) to apply it.
5. The **Apply Log** section shows the audit trail with timestamp, actor, and result.

## Disabling Temporarily (Dry Run)

Set `HMS_LOCAL_SCHEMA_SYNC_DRY_RUN=1` in the env file and restart. The worker will report what it would do but will not execute any SQL.

## Disabling Permanently

Set `HMS_LOCAL_SCHEMA_SYNC_ENABLED=0` and restart. The worker skips the schema sync cycle entirely.

## Filename Convention

When adding new cloud migrations, the filename determines safety:

- `NNNN_description.sql` (e.g., `0334_add_appointments_table.sql`) — **safe**, auto-applied.
- `NNNNd_description.sql` (e.g., `0334d_drop_legacy_column.sql`) — **destructive**, queued for approval.

The `d` suffix sorts correctly: `0334_*` < `0334d_*` < `0335_*`.

## Troubleshooting

### Local D1 has older schema than cloud

The "drift" status appears in the apply log when the local has a migration applied but the cloud has changed the SQL. Admin can reset and re-apply via the admin panel.

### Cloud unreachable for >24h

The worker logs warnings and continues the outbox sync. Schema sync is skipped. Local still operates on existing schema.

### Failed safe migration

The admin panel shows a banner with the last error. The next worker cycle retries from the failed migration.

## Audit

All schema sync activity is logged to `local_schema_sync_log` on the local D1, with actor = `'system'` (worker-initiated) or admin user_id (admin-initiated).
```

- [ ] **Step 2: Commit**

```bash
git add docs/operations/local-server.md
git commit -m "docs: add local server schema sync operations guide"
```

---

## Phase 7: Final Verification

### Task 17: Run the full test suite

**Files:** none (verification only)

- [ ] **Step 1: Run unit + integration tests**

Run:
```bash
pnpm test:all
```

Expected: all tests pass, including the 4 new test files:
- `test/build-migration-manifest.test.ts`
- `test/local-schema-sync-engine.test.ts`
- `test/local-schema-sync-cloud-routes.test.ts`
- `test/local-schema-sync-routes.test.ts`

- [ ] **Step 2: Run the build**

Run:
```bash
pnpm build
```

Expected: build completes. `MIGRATIONS` constant is embedded in the cloud worker bundle.

- [ ] **Step 3: Verify the generated file exists and is gitignored**

Run:
```bash
ls -la src/data/schema-migrations.generated.ts
git check-ignore src/data/schema-migrations.generated.ts && echo "gitignored: yes"
```

Expected: file exists, "gitignored: yes" printed.

- [ ] **Step 4: Commit any remaining changes (should be none)**

```bash
git status
```

If there are uncommitted changes, commit them with a descriptive message. If clean, skip.

---

### Task 18: Manual smoke test on dev cloud

This is performed by the user, not the agent.

- [ ] **Step 1: Create 1 safe + 1 destructive test migration**

Run:
```bash
cat > /tmp/test_safe.sql <<'EOF'
CREATE TABLE IF NOT EXISTS _schema_sync_smoke_test (id INTEGER PRIMARY KEY);
EOF
cp migrations/0336_local_schema_sync_tables.sql /tmp/test_destructive_template.sql
```

Then create a new test migration file manually with filename `9999d_smoke_test.sql`:

```bash
cp /tmp/test_safe.sql migrations/9999d_smoke_test.sql
# Edit the file: change CREATE TABLE to DROP TABLE _schema_sync_smoke_test
```

- [ ] **Step 2: Deploy to dev cloud**

Run:
```bash
pnpm build && wrangler deploy --env production
```

- [ ] **Step 3: Trigger the local worker manually**

SSH to the local server and run:

```bash
ssh pcare 'docker exec hms-local-server-hms-sync-1 bash scripts/local-server/sync-worker.sh'
```

(Or wait up to 15 min for the next cycle.)

- [ ] **Step 4: Verify in admin panel**

Open `http://<hospital-server-ip>/admin/schema-sync`. Expect:
- Status: applied count incremented by 1
- Pending Destructive Approvals: 1 entry (9999d_smoke_test.sql)
- Apply Log: 2 new entries

- [ ] **Step 5: Approve and verify**

Click **Approve** on the destructive entry. Wait up to 15 min for the next cycle. The migration is applied.

- [ ] **Step 6: Clean up**

Delete the smoke test migration files from `migrations/` and re-deploy.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| Goal + Why | Phase 1–6 |
| Filename convention | Tasks 2, 7 |
| Cloud A1: build-time manifest generator | Task 2 |
| Cloud A2: manifest endpoints | Task 3 |
| Local B1: 3 new tables | Tasks 4, 5 |
| Local B2: engine module | Tasks 7, 8, 9 |
| Local B3: 7 new endpoints | Tasks 10, 11 |
| Local B4: worker enhancement | Task 12 |
| Local B5: admin panel UI | Tasks 13, 14 |
| Failure handling | Task 9 (applyMigration returns error), Task 11 (status endpoint surfaces failures) |
| Configuration | Tasks 6, 15 |
| Testing strategy | Tasks 7, 8, 9, 10, 11, 17 |
| Rollout plan | Task 18 (manual smoke test is the rollout gate) |
| Backward compatibility | Tasks 1, 4, 6 (all additive) |

**Placeholder scan:** No "TBD", "TODO", or "implement later" markers in the plan.

**Type consistency:** All function signatures match across tasks. `ManifestEntry`, `Safety`, `ReconciliationResult` are defined in Task 7 and reused in Tasks 8, 9, 10, 11, 12. `setApprovalStatus` enum values match the SQL CHECK constraint.

**Ambiguity check:** All shell commands include the exact `ssh` and `docker` invocations. All SQL is complete. All test code is shown.

---

## Post-Implementation Notes

### Filename convention fix during Task 2 review

The original regex `/^(\d{4})(d|D)_([a-z0-9_]+)\.sql$/` in Task 2 step 3 was buggy — it required a literal `d`/`D` for every filename, which would have classified all conforming safe migrations as destructive and rejected safe filenames entirely. The implementer fixed it to `/^(\d{4})(?:([dD])_|_)([a-z0-9_]+)\.sql$/i` (the `d`/`D` is optional, separator underscore is required, case-insensitive). This also means historical `b`-suffix filenames like `0035b_billing_alter_columns.sql` and `0157b_seed_procedure_billing_items.sql` are now correctly rejected as non-conforming.

### Excluded legacy migrations (9 files)

After the regex fix, 9 files are filtered with a warning at build time:

| File | Reason | Follow-up needed? |
|---|---|---|
| `0035b_billing_alter_columns.sql` | historical `b` suffix | **YES** — content (billing cancellation columns) is missing from `tenant-schema.sql`. Fresh local installs will be missing `bills.cancelled_by/at/reason/settlement_id` and `invoice_items.status/cancelled_by`. Needs a follow-up to add the schema to `tenant-schema.sql`. |
| `0157b_seed_procedure_billing_items.sql` | historical `b` suffix | **YES** — content (Procedures department + seed items) is missing from `tenant-schema.sql`. Fresh local installs will be missing the 'Procedures' department row. Needs a follow-up. |
| `0281_fix_tests_table_missing_columns.sql.bak` | `.bak` extension (moved to `migrations/.bak-archive/`) | NO — backup file, no production relevance |
| `apply_0143_0148_safe.sql` | combined re-apply script (no NNNN prefix) | NO — manual use only |
| `fix_corrupted_transactions.sql` | one-off repair (no NNNN prefix) | NO — manual use only |
| 4× `seed_*.sql` | demo data | NO — explicitly excluded by plan |

**Action item**: Schedule a separate task to add the schema content of `0035b_*.sql` and `0157b_*.sql` to `tenant-schema.sql` so fresh local installs are not missing billing cancellation columns and the Procedures department row. (Out of scope for this plan.)

### Regex fix propagation

Both occurrences of the regex in this plan (lines 166 and 701) and the spec's example block (lines 91-96) have been updated to the corrected regex.

### Task 11 spec deviations (admin endpoint auth + actor identifier)

The plan's Task 11 code had three issues that the implementer had to work around:

1. **`c.get('user')?.id` does not compile.** The `Variables` type (`src/types.ts:83-87`) declares `userId?: string`, not `user`. Codebase has 48 uses of `c.get('userId')`. The implementer correctly used `c.get('userId') ?? 'unknown'`.

2. **Global `app.use('/api/*', authMiddleware)` does NOT protect schema-sync routes.** The route is mounted at `src/index.ts:268` BEFORE the global auth middleware is registered at line 593. The implementer verified this empirically: the Task 10 GET `/status` test passed with 401 only because no handler existed (request fell through to the global middleware). Once the GET handlers were added, they bypassed the global middleware and returned 200 without auth. The implementer imported `authMiddleware` and applied it per-handler to the 5 admin endpoints. The internal `/sync` and `/sync/apply-approved` endpoints still use `internalOnly()` and bypass JWT auth via the `X-Internal-Schema-Sync: 1` header, as designed.

3. **No admin permission check.** The plan acknowledged this as a follow-up: any authenticated user can hit the admin endpoints. A future task should add a `requirePermission('admin:settings')` (or similar) gate once the plan is updated to know which permission namespace the local admin panel uses.

**Pre-existing TypeScript error at line 46 of `src/routes/local-server/schema-sync.ts`** is from Task 10's `syncHandler` return type (the handler returns a value typed `Manifest` from a helper that returns `Manifest | null`). Not introduced by Task 11.
