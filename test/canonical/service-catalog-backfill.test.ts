import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillServiceCatalog,
  type ServiceCatalogBackfillDatabase,
  type ServiceCatalogBackfillPreparedStatement,
} from '../../scripts/canonical/backfill-service-catalog';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements ServiceCatalogBackfillPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function adapter(
  sqlite: DatabaseSync,
  controls: { failNextCatalogBatch?: boolean } = {},
): ServiceCatalogBackfillDatabase {
  return {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (let index = 0; index < statements.length; index += 1) {
          results.push(await statements[index].run());
          if (
            controls.failNextCatalogBatch
            && statements.some((statement) => (statement as Statement).sql.includes('canonical_service_catalog_items'))
            && index === 0
          ) {
            controls.failNextCatalogBatch = false;
            throw new Error('synthetic service catalog batch failure');
          }
        }
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function createFixture(controls: { failNextCatalogBatch?: boolean } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0508_canonical_service_catalog.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE billing_service_departments (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      department_code TEXT NOT NULL,
      department_name TEXT NOT NULL
    );
    CREATE TABLE billing_service_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      service_department_id INTEGER NOT NULL,
      item_code TEXT NOT NULL,
      item_name TEXT NOT NULL,
      price REAL NOT NULL,
      is_active INTEGER NOT NULL,
      created_at TEXT
    );
    CREATE TABLE billing_item_price_category_maps (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      service_item_id INTEGER NOT NULL,
      price_category_id INTEGER NOT NULL,
      price REAL NOT NULL,
      is_active INTEGER NOT NULL,
      created_at TEXT
    );
    CREATE TABLE lab_test_catalog (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      price INTEGER NOT NULL,
      is_active INTEGER NOT NULL,
      billing_service_item_id INTEGER,
      created_at TEXT
    );
    CREATE TABLE radiology_imaging_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      procedure_code TEXT NOT NULL,
      name TEXT NOT NULL,
      price_paisa INTEGER NOT NULL,
      is_active INTEGER NOT NULL,
      billing_service_item_id INTEGER,
      created_at TEXT
    );
    CREATE TABLE doctor_appointment_fees (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      appointment_type TEXT NOT NULL,
      fee INTEGER NOT NULL,
      is_active INTEGER NOT NULL,
      created_at TEXT
    );
    CREATE TABLE beds (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bed_type TEXT,
      rate_per_day REAL NOT NULL,
      status TEXT,
      created_at TEXT
    );
    CREATE TABLE ot_procedures (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      default_charge REAL NOT NULL,
      is_active INTEGER NOT NULL,
      created_at TEXT
    );
    CREATE TABLE medicines (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      generic_name TEXT,
      unit_price REAL NOT NULL,
      unit TEXT,
      is_active INTEGER NOT NULL,
      created_at TEXT
    );
  `);
  return { sqlite, db: adapter(sqlite, controls) };
}

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number(
    (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}${where}`).get() as { count: number }).count,
  );
}

const options = {
  tenantId: '1',
  runPublicId: 'run-service-catalog-1',
  currencyCode: 'BDT',
  nowUtc: '2026-07-14T03:00:00.000Z',
};

describe('canonical service catalog migration', () => {
  it('creates tenant-scoped catalog and price tables with money, currency, and FK constraints', () => {
    const { sqlite } = createFixture();
    try {
      expect(
        sqlite
          .prepare(
            `SELECT name FROM sqlite_schema
             WHERE type='table' AND name IN (
               'canonical_service_catalog_items', 'canonical_service_prices'
             ) ORDER BY name`,
          )
          .all(),
      ).toEqual([
        { name: 'canonical_service_catalog_items' },
        { name: 'canonical_service_prices' },
      ]);

      sqlite.prepare(
        `INSERT INTO canonical_service_catalog_items (
           tenant_id, service_public_id, item_kind, display_name, unit_code,
           status, source_evidence_sha256
         ) VALUES ('1','svc-1','laboratory','CBC','service','active',?)`,
      ).run('a'.repeat(64));

      expect(() =>
        sqlite.prepare(
          `INSERT INTO canonical_service_prices (
             tenant_id, price_public_id, service_public_id, price_context_type,
             amount_minor, currency_code, valid_from_utc, source_evidence_sha256
           ) VALUES ('1','price-bad','svc-1','base',100,'bdt','2026-07-14T00:00:00.000Z',?)`,
        ).run('b'.repeat(64)),
      ).toThrow(/CHECK constraint failed/);

      expect(() =>
        sqlite.prepare(
          `INSERT INTO canonical_service_prices (
             tenant_id, price_public_id, service_public_id, price_context_type,
             amount_minor, currency_code, valid_from_utc, source_evidence_sha256
           ) VALUES ('1','price-orphan','svc-missing','base',100,'BDT','2026-07-14T00:00:00.000Z',?)`,
        ).run('c'.repeat(64)),
      ).toThrow(/FOREIGN KEY constraint failed/);
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical service catalog backfill', () => {
  it('uses evidence-backed price units, reuses linked services, and records conflicts without rounding', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO billing_service_departments VALUES
        (1,'1','LAB','Laboratory'),
        (2,'1','RAD','Radiology');
      INSERT INTO billing_service_items VALUES
        (1,'1',1,'LAB-1','CBC',500,1,'2026-07-01 09:00:00'),
        (2,'1',2,'RAD-1','X-Ray',1000,1,'2026-07-01 09:00:00'),
        (3,'1',1,'DUP','Duplicate A',100,1,'2026-07-01 09:00:00'),
        (4,'1',1,'DUP','Duplicate B',110,1,'2026-07-01 09:00:00'),
        (5,'1',1,'ODD','Inexact',12.345,1,'2026-07-01 09:00:00');
      INSERT INTO lab_test_catalog VALUES
        (1,'1','CBC','CBC','Hematology',500,1,1,'2026-07-01 09:00:00'),
        (2,'1','CBC-X','CBC conflict','Hematology',550,1,1,'2026-07-01 09:00:00'),
        (3,'1','LAB-U','Unlinked Lab','Chemistry',250,1,NULL,'2026-07-01 09:00:00');
      INSERT INTO radiology_imaging_items VALUES
        (1,'1','XR-1','X-Ray',100000,1,2,'2026-07-01 09:00:00');
    `);

    try {
      const first = await backfillServiceCatalog(db, options);
      expect(first.completed).toBe(true);
      expect(count(sqlite, 'canonical_service_catalog_items')).toBe(6);
      expect(count(sqlite, 'canonical_service_prices')).toBe(5);

      expect(
        sqlite
          .prepare(
            `SELECT amount_minor FROM canonical_service_prices
             WHERE price_context_type='base' ORDER BY amount_minor`,
          )
          .all(),
      ).toEqual([
        { amount_minor: 10000 },
        { amount_minor: 11000 },
        { amount_minor: 25000 },
        { amount_minor: 50000 },
        { amount_minor: 100000 },
      ]);

      const billingItem = sqlite.prepare(
        `SELECT canonical_public_id FROM canonical_source_mappings
         WHERE entity_type='service_catalog_item'
           AND source_type='legacy_billing_service_item' AND source_public_id='1'`,
      ).get() as { canonical_public_id: string };
      const labItem = sqlite.prepare(
        `SELECT canonical_public_id FROM canonical_source_mappings
         WHERE entity_type='service_catalog_item'
           AND source_type='legacy_lab_test' AND source_public_id='1'`,
      ).get();
      expect(labItem).toEqual(billingItem);

      const billingPrice = sqlite.prepare(
        `SELECT canonical_public_id FROM canonical_source_mappings
         WHERE entity_type='service_price'
           AND source_type='legacy_billing_service_item' AND source_public_id='1'`,
      ).get();
      const labPrice = sqlite.prepare(
        `SELECT canonical_public_id FROM canonical_source_mappings
         WHERE entity_type='service_price'
           AND source_type='legacy_lab_test' AND source_public_id='1'`,
      ).get();
      expect(labPrice).toEqual(billingPrice);

      expect(
        sqlite
          .prepare(
            `SELECT mapping_status FROM canonical_source_mappings
             WHERE entity_type='service_price'
               AND source_type='legacy_billing_service_item' AND source_public_id='5'`,
          )
          .get(),
      ).toEqual({ mapping_status: 'ambiguous' });

      expect(
        sqlite
          .prepare(
            `SELECT issue_code, occurrence_count FROM canonical_processing_issues
             WHERE issue_type='service_catalog_backfill'
             ORDER BY issue_code`,
          )
          .all(),
      ).toEqual([
        { issue_code: 'SERVICE_CODE_DUPLICATE', occurrence_count: 2 },
        { issue_code: 'SERVICE_LINKED_PRICE_CONFLICT', occurrence_count: 1 },
        { issue_code: 'SERVICE_PRICE_INEXACT_MINOR_CONVERSION', occurrence_count: 1 },
      ]);

      const second = await backfillServiceCatalog(db, {
        ...options,
        runPublicId: 'run-service-catalog-2',
        nowUtc: '2026-07-14T03:01:00.000Z',
      });
      expect(second.counts).toMatchObject({
        itemsCreated: 0,
        pricesCreated: 0,
        mappingsCreated: 0,
        issuesCreated: 0,
      });
    } finally {
      sqlite.close();
    }
  });

  it('maps category, consultation, bed, procedure, and product prices with explicit conflicts', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO billing_service_departments VALUES (1,'1','GEN','General');
      INSERT INTO billing_service_items VALUES
        (1,'1',1,'GEN-1','General Service',100,1,'2026-07-01 09:00:00');
      INSERT INTO billing_item_price_category_maps VALUES
        (1,'1',1,10,120,1,'2026-07-01 09:00:00'),
        (2,'1',1,10,130,1,'2026-07-01 09:00:00');
      INSERT INTO doctor_appointment_fees VALUES
        (1,'1',7,'new',300,1,'2026-07-01 09:00:00');
      INSERT INTO beds VALUES
        (1,'1','General',1000,'available','2026-07-01 09:00:00'),
        (2,'1','General',1000,'occupied','2026-07-01 09:00:00'),
        (3,'1','General',1200,'available','2026-07-01 09:00:00');
      INSERT INTO ot_procedures VALUES
        (1,'1','Minor Procedure',500.25,1,'2026-07-01 09:00:00');
      INSERT INTO medicines VALUES
        (1,'1','Tablet A','Generic A',2.5,'tablet',1,'2026-07-01 09:00:00'),
        (2,'1','Unknown Unit','Generic B',10.999,NULL,1,'2026-07-01 09:00:00');
    `);

    try {
      await backfillServiceCatalog(db, options);

      expect(
        sqlite
          .prepare(
            `SELECT item_kind, COUNT(*) AS count
             FROM canonical_service_catalog_items GROUP BY item_kind ORDER BY item_kind`,
          )
          .all(),
      ).toEqual([
        { item_kind: 'bed', count: 1 },
        { item_kind: 'consultation', count: 1 },
        { item_kind: 'other', count: 1 },
        { item_kind: 'procedure', count: 1 },
        { item_kind: 'product', count: 2 },
      ]);

      expect(
        sqlite
          .prepare(
            `SELECT amount_minor FROM canonical_service_prices ORDER BY amount_minor`,
          )
          .all(),
      ).toEqual([
        { amount_minor: 250 },
        { amount_minor: 10000 },
        { amount_minor: 30000 },
        { amount_minor: 50025 },
        { amount_minor: 100000 },
      ]);

      expect(
        sqlite
          .prepare(
            `SELECT issue_code, COUNT(*) AS count
             FROM canonical_processing_issues
             WHERE issue_type='service_catalog_backfill'
             GROUP BY issue_code ORDER BY issue_code`,
          )
          .all(),
      ).toEqual([
        { issue_code: 'SERVICE_BED_TYPE_PRICE_CONFLICT', count: 1 },
        { issue_code: 'SERVICE_PRICE_INEXACT_MINOR_CONVERSION', count: 1 },
        { issue_code: 'SERVICE_PRICE_PERIOD_OVERLAP', count: 2 },
        { issue_code: 'SERVICE_UNIT_MISSING', count: 1 },
      ]);

      expect(
        sqlite
          .prepare(
            `SELECT mapping_status FROM canonical_source_mappings
             WHERE entity_type='service_price'
               AND source_type='legacy_medicine' AND source_public_id='2'`,
          )
          .get(),
      ).toEqual({ mapping_status: 'ambiguous' });
      expect(count(sqlite, 'canonical_service_prices', " WHERE price_context_type='price_category'")).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('keeps cross-source and duplicate consultation code claims separate', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO billing_service_departments VALUES (1,'1','GEN','General');
      INSERT INTO billing_service_items VALUES
        (1,'1',1,'SHARED','Billing Service',100,1,'2026-07-01 09:00:00');
      INSERT INTO lab_test_catalog VALUES
        (1,'1','SHARED','Unlinked Lab',NULL,100,1,NULL,'2026-07-01 09:00:00');
      INSERT INTO doctor_appointment_fees VALUES
        (1,'1',7,'new',300,1,'2026-07-01 09:00:00'),
        (2,'1',7,'new',350,1,'2026-07-02 09:00:00');
    `);

    try {
      await backfillServiceCatalog(db, options);
      expect(count(sqlite, 'canonical_service_catalog_items')).toBe(4);
      expect(count(sqlite, 'canonical_service_prices')).toBe(4);

      const consultationMappings = sqlite
        .prepare(
          `SELECT canonical_public_id FROM canonical_source_mappings
           WHERE entity_type='service_catalog_item'
             AND source_type='legacy_consultation_fee'
           ORDER BY source_public_id`,
        )
        .all() as Array<{ canonical_public_id: string }>;
      expect(consultationMappings).toHaveLength(2);
      expect(consultationMappings[0].canonical_public_id).not.toBe(
        consultationMappings[1].canonical_public_id,
      );

      expect(
        sqlite
          .prepare(
            `SELECT canonical_code FROM canonical_service_catalog_items
             WHERE item_kind='laboratory'`,
          )
          .get(),
      ).toEqual({ canonical_code: null });
      expect(
        sqlite
          .prepare(
            `SELECT mapping_status FROM canonical_source_mappings
             WHERE entity_type='service_price'
               AND source_type='legacy_consultation_fee' AND source_public_id='2'`,
          )
          .get(),
      ).toEqual({ mapping_status: 'mapped' });
      expect(
        sqlite
          .prepare(
            `SELECT issue_code FROM canonical_processing_issues
             WHERE issue_type='service_catalog_backfill'
             ORDER BY issue_code`,
          )
          .all(),
      ).toEqual([
        { issue_code: 'SERVICE_CODE_DUPLICATE' },
        { issue_code: 'SERVICE_CODE_DUPLICATE' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('queues an evidence-change issue instead of silently rewriting a mapped source', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO billing_service_departments VALUES (1,'1','GEN','General');
      INSERT INTO billing_service_items VALUES
        (1,'1',1,'SVC-1','Service One',100,1,'2026-07-01 09:00:00');
    `);

    try {
      await backfillServiceCatalog(db, options);
      sqlite.prepare('UPDATE billing_service_items SET price=150 WHERE id=1').run();
      const rerun = await backfillServiceCatalog(db, {
        ...options,
        runPublicId: 'run-evidence-change',
        nowUtc: '2026-07-14T03:02:00.000Z',
      });

      expect(rerun.counts).toMatchObject({
        itemsCreated: 0,
        pricesCreated: 0,
        mappingsCreated: 0,
        issuesCreated: 1,
      });
      expect(
        sqlite.prepare('SELECT amount_minor FROM canonical_service_prices').get(),
      ).toEqual({ amount_minor: 10000 });
      expect(
        sqlite
          .prepare(
            `SELECT issue_code FROM canonical_processing_issues
             WHERE issue_type='service_catalog_backfill'
               AND issue_code='SERVICE_SOURCE_EVIDENCE_CHANGED'`,
          )
          .get(),
      ).toEqual({ issue_code: 'SERVICE_SOURCE_EVIDENCE_CHANGED' });
    } finally {
      sqlite.close();
    }
  });

  it('rejects reuse of a failed migration run', async () => {
    const { sqlite, db } = createFixture();
    sqlite.prepare(
      `INSERT INTO canonical_migration_runs (
         tenant_id, run_public_id, migration_name, migration_kind,
         status, started_at_utc, completed_at_utc
       ) VALUES ('1','failed-service-run','0508_canonical_service_catalog.sql',
                 'backfill','failed','2026-07-14T03:00:00.000Z',
                 '2026-07-14T03:01:00.000Z')`,
    ).run();

    try {
      await expect(
        backfillServiceCatalog(db, {
          ...options,
          runPublicId: 'failed-service-run',
        }),
      ).rejects.toThrow(/terminal: failed/);
    } finally {
      sqlite.close();
    }
  });

  it('keeps identical source IDs tenant-scoped', async () => {
    const { sqlite, db } = createFixture();
    sqlite.exec(`
      INSERT INTO billing_service_departments VALUES
        (1,'1','GEN','General'), (2,'2','GEN','General');
      INSERT INTO billing_service_items VALUES
        (1,'1',1,'SVC-1','Tenant One',100,1,'2026-07-01 09:00:00'),
        (2,'2',2,'SVC-1','Tenant Two',100,1,'2026-07-01 09:00:00');
    `);

    try {
      await backfillServiceCatalog(db, options);
      await backfillServiceCatalog(db, {
        ...options,
        tenantId: '2',
        runPublicId: 'run-tenant-2',
      });
      const rows = sqlite
        .prepare(`SELECT tenant_id, service_public_id FROM canonical_service_catalog_items ORDER BY tenant_id`)
        .all() as Array<{ tenant_id: string; service_public_id: string }>;
      expect(rows).toHaveLength(2);
      expect(rows[0].service_public_id).not.toBe(rows[1].service_public_id);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back a failed source batch and resumes from the same checkpoint without duplicates', async () => {
    const controls = { failNextCatalogBatch: true };
    const { sqlite, db } = createFixture(controls);
    sqlite.exec(`
      INSERT INTO billing_service_departments VALUES (1,'1','GEN','General');
      INSERT INTO billing_service_items VALUES
        (1,'1',1,'SVC-1','Service One',100,1,'2026-07-01 09:00:00'),
        (2,'1',1,'SVC-2','Service Two',200,1,'2026-07-01 09:00:00');
    `);

    try {
      await expect(backfillServiceCatalog(db, options)).rejects.toThrow(
        /synthetic service catalog batch failure/,
      );
      expect(count(sqlite, 'canonical_service_catalog_items')).toBe(0);
      expect(count(sqlite, 'canonical_service_prices')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(0);
      expect(
        sqlite
          .prepare(
            `SELECT cursor_value FROM canonical_backfill_checkpoints
             WHERE entity_type='service_catalog'
               AND source_type='legacy_billing_service_item'`,
          )
          .get(),
      ).toEqual({ cursor_value: null });

      const resumed = await backfillServiceCatalog(db, options);
      expect(resumed.completed).toBe(true);
      expect(count(sqlite, 'canonical_service_catalog_items')).toBe(2);
      expect(count(sqlite, 'canonical_service_prices')).toBe(2);

      const replay = await backfillServiceCatalog(db, options);
      expect(replay.counts).toMatchObject({
        scanned: 0,
        itemsCreated: 0,
        pricesCreated: 0,
        mappingsCreated: 0,
        issuesCreated: 0,
      });
    } finally {
      sqlite.close();
    }
  });
});
