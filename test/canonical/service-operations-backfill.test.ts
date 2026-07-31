import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  backfillServiceOperations,
  type ServiceOperationsBackfillDatabase,
  type ServiceOperationsPreparedStatement,
} from '../../scripts/canonical/backfill-service-operations';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements ServiceOperationsPreparedStatement {
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
  controls: { failNextOperationBatch?: boolean } = {},
): ServiceOperationsBackfillDatabase {
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
            controls.failNextOperationBatch
            && statements.some((statement) =>
              (statement as Statement).sql.includes('canonical_service_requests'))
            && index === 0
          ) {
            controls.failNextOperationBatch = false;
            throw new Error('synthetic service operation batch failure');
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

function createFixture(controls: { failNextOperationBatch?: boolean } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(readFileSync('migrations/0505_canonical_program_foundation.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0506_canonical_practitioners.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0507_canonical_encounters.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0508_canonical_service_catalog.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0509_canonical_service_requests_events.sql', 'utf8'));
  sqlite.exec(`
    CREATE TABLE lab_orders (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER, ordered_by INTEGER, order_date TEXT, status TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, lab_order_id INTEGER NOT NULL,
      lab_test_id INTEGER NOT NULL, status TEXT, completed_at TEXT,
      processed_by INTEGER, verified_by INTEGER, verified_at TEXT,
      result_status TEXT, updated_at TEXT
    );
    CREATE TABLE radiology_requisitions (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER, admission_id INTEGER, imaging_item_id INTEGER,
      prescriber_id INTEGER, order_status TEXT, is_report_saved INTEGER,
      is_scanned INTEGER, scanned_by TEXT, scanned_on TEXT, is_active INTEGER,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE consultations (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, doctor_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL, scheduled_at TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE doctor_appointment_fees (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, doctor_id INTEGER NOT NULL,
      appointment_type TEXT NOT NULL, fee INTEGER NOT NULL, is_active INTEGER NOT NULL,
      created_at TEXT
    );
    CREATE TABLE procedure_orders (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      visit_id INTEGER, service_item_id INTEGER, ordered_by INTEGER,
      performed_by INTEGER, status TEXT, ordered_at TEXT, performed_at TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE bed_reservations (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      bed_id INTEGER NOT NULL, reserved_from TEXT NOT NULL, reserved_to TEXT,
      status TEXT NOT NULL, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE patient_bed_infos (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      admission_id INTEGER NOT NULL, bed_id INTEGER NOT NULL, started_on TEXT NOT NULL,
      ended_on TEXT, days INTEGER, created_at TEXT
    );
    CREATE TABLE prescriptions (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      doctor_id INTEGER, appointment_id INTEGER, admission_id INTEGER,
      status TEXT, dispense_status TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE prescription_items (
      id INTEGER PRIMARY KEY, prescription_id INTEGER NOT NULL, medicine_id INTEGER,
      quantity INTEGER, dispensed_qty INTEGER
    );
  `);
  return { sqlite, db: adapter(sqlite, controls) };
}

function seedCanonical(sqlite: DatabaseSync, tenantId = '1'): void {
  sqlite.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id, practitioner_public_id, practitioner_kind, display_name, status
    ) VALUES (?, 'prc-1', 'internal', 'Synthetic Practitioner', 'active')
  `).run(tenantId);
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id, encounter_public_id, legacy_patient_id, encounter_type, status,
      started_at_utc, source_evidence_sha256
    ) VALUES (?, 'enc-1', 10, 'outpatient', 'completed',
              '2026-07-01T03:00:00.000Z', ?)
  `).run(tenantId, 'a'.repeat(64));
  for (const [id, kind, code, unit] of [
    ['svc-lab', 'laboratory', 'LAB-1', 'service'],
    ['svc-rad', 'radiology', 'RAD-1', 'service'],
    ['svc-consult', 'consultation', 'CONSULT-1-NEW', 'encounter'],
    ['svc-proc', 'procedure', 'PROC-1', 'procedure'],
    ['svc-bed', 'bed', null, 'day'],
    ['svc-med', 'product', null, 'tablet'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_service_catalog_items (
        tenant_id, service_public_id, item_kind, canonical_code, display_name,
        unit_code, status, source_evidence_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(tenantId, id, kind, code, `Synthetic ${kind}`, unit, 'b'.repeat(64));
  }
  const consultationFeeId = tenantId === '1' ? '31' : '32';
  const mappings = [
    ['practitioner', 'prc-1', 'legacy_doctor', '1', 'doctors'],
    ['encounter', 'enc-1', 'legacy_visit', '100', 'visits'],
    ['encounter', 'enc-1', 'legacy_admission', '200', 'admissions'],
    ['encounter', 'enc-1', 'legacy_consultation', '1', 'consultations'],
    ['service_catalog_item', 'svc-lab', 'legacy_lab_test', '11', 'lab_test_catalog'],
    ['service_catalog_item', 'svc-rad', 'legacy_radiology_item', '21', 'radiology_imaging_items'],
    ['service_catalog_item', 'svc-consult', 'legacy_consultation_fee', consultationFeeId, 'doctor_appointment_fees'],
    ['service_catalog_item', 'svc-proc', 'legacy_billing_service_item', '41', 'billing_service_items'],
    ['service_catalog_item', 'svc-bed', 'legacy_bed', '51', 'beds'],
    ['service_catalog_item', 'svc-med', 'legacy_medicine', '61', 'medicines'],
  ];
  for (const [entityType, canonicalId, sourceType, sourceId, sourceTable] of mappings) {
    sqlite.prepare(`
      INSERT INTO canonical_source_mappings (
        tenant_id, entity_type, canonical_public_id, source_type,
        source_public_id, source_table, mapping_status, mapping_version,
        evidence_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, 'mapped', 1, ?)
    `).run(tenantId, entityType, canonicalId, sourceType, sourceId, sourceTable, 'c'.repeat(64));
  }
  sqlite.prepare(`
    INSERT INTO doctor_appointment_fees (
      id, tenant_id, doctor_id, appointment_type, fee, is_active, created_at
    ) VALUES (?, ?, 1, 'new', 500, 1, '2026-07-01 09:00:00')
  `).run(Number(consultationFeeId), tenantId);
}

function count(sqlite: DatabaseSync, table: string, where = ''): number {
  return Number(
    (sqlite.prepare(`SELECT COUNT(*) count FROM ${table}${where}`).get() as { count: number }).count,
  );
}

const options = {
  tenantId: '1',
  runPublicId: 'run-service-operations-1',
  nowUtc: '2026-07-14T06:00:00.000Z',
};

describe('canonical service-operation migration', () => {
  it('creates request, event, and typed participant tables', () => {
    const { sqlite } = createFixture();
    try {
      expect(
        sqlite.prepare(`
          SELECT name FROM sqlite_schema
          WHERE type='table' AND name IN (
            'canonical_service_requests',
            'canonical_service_events',
            'canonical_service_participants'
          ) ORDER BY name
        `).all(),
      ).toEqual([
        { name: 'canonical_service_events' },
        { name: 'canonical_service_participants' },
        { name: 'canonical_service_requests' },
      ]);
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical service-operation backfill', () => {
  it('creates lab requests, only evidence-backed completion events, and explicit roles', async () => {
    const { sqlite, db } = createFixture();
    seedCanonical(sqlite);
    sqlite.exec(`
      INSERT INTO lab_orders VALUES
        (1,'1',10,100,1,'2026-07-01','pending','2026-07-01 09:00:00','2026-07-01 10:00:00'),
        (2,'1',10,100,1,'2026-07-01','completed','2026-07-01 09:00:00','2026-07-01 11:00:00');
      INSERT INTO lab_order_items VALUES
        (1,'1',1,11,'pending',NULL,NULL,NULL,NULL,'pending','2026-07-01 10:00:00'),
        (2,'1',2,11,'verified','2026-07-01 10:30:00',1,1,'2026-07-01 11:00:00','verified','2026-07-01 11:00:00');
    `);

    try {
      const result = await backfillServiceOperations(db, options);
      expect(result.completed).toBe(true);
      expect(count(sqlite, 'canonical_service_requests')).toBe(2);
      expect(count(sqlite, 'canonical_service_events')).toBe(1);
      expect(
        sqlite.prepare(`SELECT status FROM canonical_service_requests ORDER BY status`).all(),
      ).toEqual([{ status: 'active' }, { status: 'fulfilled' }]);
      expect(
        sqlite.prepare(`SELECT event_type, status FROM canonical_service_events`).get(),
      ).toEqual({ event_type: 'completed', status: 'posted' });
      expect(
        sqlite.prepare(`
          SELECT participant_role, COUNT(*) count
          FROM canonical_service_participants
          GROUP BY participant_role ORDER BY participant_role
        `).all(),
      ).toEqual([
        { participant_role: 'approving', count: 1 },
        { participant_role: 'ordering', count: 2 },
        { participant_role: 'performing', count: 1 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('keeps pending radiology/procedure as requests and completed consultation as an event', async () => {
    const { sqlite, db } = createFixture();
    seedCanonical(sqlite);
    sqlite.exec(`
      INSERT INTO radiology_requisitions VALUES
        (1,'1',10,100,NULL,21,1,'pending',0,0,NULL,NULL,1,'2026-07-01 09:00:00','2026-07-01 09:00:00');
      INSERT INTO procedure_orders VALUES
        (1,'1',10,100,41,1,NULL,'ordered','2026-07-01 09:00:00',NULL,'2026-07-01 09:00:00','2026-07-01 09:00:00');
      INSERT INTO consultations VALUES
        (1,'1',1,10,'2026-07-01 09:00:00','completed','2026-07-01 08:00:00','2026-07-01 10:00:00');
    `);

    try {
      await backfillServiceOperations(db, options);
      expect(count(sqlite, 'canonical_service_requests')).toBe(3);
      expect(count(sqlite, 'canonical_service_events')).toBe(1);
      expect(
        sqlite.prepare(`SELECT item_kind, COUNT(*) count
          FROM canonical_service_requests r
          JOIN canonical_service_catalog_items s
            ON s.tenant_id=r.tenant_id AND s.service_public_id=r.service_public_id
          GROUP BY item_kind ORDER BY item_kind`).all(),
      ).toEqual([
        { item_kind: 'consultation', count: 1 },
        { item_kind: 'procedure', count: 1 },
        { item_kind: 'radiology', count: 1 },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('creates bed reservation requests, bed-stay events, and partial medicine dispense events', async () => {
    const { sqlite, db } = createFixture();
    seedCanonical(sqlite);
    sqlite.exec(`
      INSERT INTO bed_reservations VALUES
        (1,'1',10,51,'2026-07-01 09:00:00','2026-07-02 09:00:00','reserved','2026-07-01 08:00:00','2026-07-01 08:00:00');
      INSERT INTO patient_bed_infos VALUES
        (1,'1',10,200,51,'2026-07-01 09:00:00','2026-07-03 09:00:00',2,'2026-07-01 09:00:00');
      INSERT INTO prescriptions VALUES
        (1,'1',10,1,NULL,NULL,'final','partial','2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO prescription_items VALUES (1,1,61,10,4);
    `);

    try {
      await backfillServiceOperations(db, options);
      expect(count(sqlite, 'canonical_service_requests')).toBe(2);
      expect(count(sqlite, 'canonical_service_events')).toBe(2);
      expect(
        sqlite.prepare(`SELECT event_type, quantity FROM canonical_service_events ORDER BY event_type`).all(),
      ).toEqual([
        { event_type: 'dispensed', quantity: 4 },
        { event_type: 'occupied', quantity: 2 },
      ]);
      expect(
        sqlite.prepare(`SELECT status FROM canonical_service_requests WHERE requested_quantity=10`).get(),
      ).toEqual({ status: 'partially_fulfilled' });
    } finally {
      sqlite.close();
    }
  });

  it('queues ambiguous consultation and medicine mappings instead of guessing', async () => {
    const { sqlite, db } = createFixture();
    seedCanonical(sqlite);
    sqlite.exec(`
      INSERT INTO doctor_appointment_fees VALUES
        (32,'1',1,'followup',300,1,'2026-07-01 09:00:00');
      INSERT INTO consultations VALUES
        (1,'1',1,10,'2026-07-01 09:00:00','completed','2026-07-01 08:00:00','2026-07-01 10:00:00');
      INSERT INTO prescriptions VALUES
        (1,'1',10,1,NULL,NULL,'final','pending','2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO prescription_items VALUES (1,1,NULL,10,0);
    `);

    try {
      await backfillServiceOperations(db, options);
      expect(count(sqlite, 'canonical_service_requests')).toBe(0);
      expect(
        sqlite.prepare(`
          SELECT issue_code FROM canonical_processing_issues
          WHERE issue_type='service_operations_backfill'
          ORDER BY issue_code
        `).all(),
      ).toEqual([
        { issue_code: 'SERVICE_OPERATION_CATALOG_AMBIGUOUS' },
        { issue_code: 'SERVICE_OPERATION_CATALOG_UNRESOLVED' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('detects source evidence drift and keeps tenant-scoped identities', async () => {
    const { sqlite, db } = createFixture();
    seedCanonical(sqlite, '1');
    seedCanonical(sqlite, '2');
    sqlite.exec(`
      INSERT INTO lab_orders VALUES
        (1,'1',10,100,1,'2026-07-01','pending','2026-07-01 09:00:00','2026-07-01 10:00:00'),
        (2,'2',10,100,1,'2026-07-01','pending','2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO lab_order_items VALUES
        (1,'1',1,11,'pending',NULL,NULL,NULL,NULL,'pending','2026-07-01 10:00:00'),
        (2,'2',2,11,'pending',NULL,NULL,NULL,NULL,'pending','2026-07-01 10:00:00');
    `);

    try {
      await backfillServiceOperations(db, options);
      await backfillServiceOperations(db, {
        ...options,
        tenantId: '2',
        runPublicId: 'run-tenant-2',
      });
      const ids = sqlite.prepare(`SELECT request_public_id FROM canonical_service_requests ORDER BY tenant_id`).all() as Array<{request_public_id:string}>;
      expect(ids).toHaveLength(2);
      expect(ids[0].request_public_id).not.toBe(ids[1].request_public_id);

      sqlite.prepare(`UPDATE lab_order_items SET status='completed', completed_at='2026-07-01 11:00:00' WHERE id=1`).run();
      const drift = await backfillServiceOperations(db, {
        ...options,
        runPublicId: 'run-drift',
        nowUtc: '2026-07-14T06:01:00.000Z',
      });
      expect(drift.counts.issuesCreated).toBe(1);
      expect(count(sqlite, 'canonical_service_events', " WHERE tenant_id='1'")).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back a failed batch, resumes checkpoints, and reruns without duplicates', async () => {
    const controls = { failNextOperationBatch: true };
    const { sqlite, db } = createFixture(controls);
    seedCanonical(sqlite);
    sqlite.exec(`
      INSERT INTO lab_orders VALUES
        (1,'1',10,100,1,'2026-07-01','pending','2026-07-01 09:00:00','2026-07-01 10:00:00');
      INSERT INTO lab_order_items VALUES
        (1,'1',1,11,'pending',NULL,NULL,NULL,NULL,'pending','2026-07-01 10:00:00');
    `);

    try {
      await expect(backfillServiceOperations(db, options)).rejects.toThrow(
        /synthetic service operation batch failure/,
      );
      expect(count(sqlite, 'canonical_service_requests')).toBe(0);
      expect(count(sqlite, 'canonical_source_mappings', " WHERE entity_type IN ('service_request','service_event')")).toBe(0);
      expect(
        sqlite.prepare(`SELECT cursor_value FROM canonical_backfill_checkpoints
          WHERE entity_type='service_operations' AND source_type='legacy_lab_order_item'`).get(),
      ).toEqual({ cursor_value: null });

      await backfillServiceOperations(db, options);
      const replay = await backfillServiceOperations(db, options);
      expect(replay.counts).toMatchObject({
        scanned: 0,
        requestsCreated: 0,
        eventsCreated: 0,
        participantsCreated: 0,
        mappingsCreated: 0,
        issuesCreated: 0,
      });
    } finally {
      sqlite.close();
    }
  });
});
