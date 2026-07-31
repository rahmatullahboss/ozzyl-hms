import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  prepareAcceptedAndCancelledServiceRouteBatch,
  prepareAcceptedServiceRouteBatch,
  prepareProtectedConsultationService,
  prepareServiceRouteCancellationBatch,
} from '../../src/lib/canonical/service-delivery-route-integration';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => value === undefined ? null : value) as SqlValue[],
    );
  }

  async run() {
    try {
      const result = this.database.prepare(this.sql).run(...this.params);
      return {
        success: true,
        meta: {
          changes: Number(result.changes ?? 0),
          last_row_id: Number(result.lastInsertRowid ?? 0),
        },
      };
    } catch (error) {
      throw new Error(`statement failed: ${this.sql}`, { cause: error });
    }
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0508_canonical_service_catalog.sql',
    'migrations/0509_canonical_service_requests_events.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE visit_services (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      visit_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      service_item_id INTEGER,
      status TEXT NOT NULL,
      canonical_source_key TEXT
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    );
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  seed(sqlite);
  return { sqlite, db };
}

function seed(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links(
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','ptl-101',101,'unlinked','unverified','no_link_placeholder',
      ?,'2026-07-29T00:00:00.000Z',1)
  `).run('a'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_encounters(
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,started_at_utc,source_kind,
      source_evidence_sha256
    ) VALUES ('tenant-a','enc-10',101,'ptl-101','outpatient','in_progress',1,
      '2026-07-29T01:00:00.000Z','runtime',?)
  `).run('b'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_service_catalog_items(
      tenant_id,service_public_id,item_kind,canonical_code,display_name,
      unit_code,status,source_evidence_sha256
    ) VALUES ('tenant-a','svc-consult','consultation','CONSULT','Consultation',
      'service','active',?)
  `).run('c'.repeat(64));
  sqlite.exec(`
    INSERT INTO canonical_practitioners(
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('tenant-a','practitioner-1','internal','Doctor One','active');
  `);
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

function acceptanceInput(db: CanonicalBatchDatabase, overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    legacyPatientId: 101,
    encounterPublicId: 'enc-10',
    servicePublicId: 'svc-consult',
    sourceType: 'legacy_visit_service',
    sourcePublicId: '501',
    sourceTable: 'visit_services',
    quantity: 1,
    occurredAtUtc: '2026-07-29T01:10:00.000Z',
    sourceEvidence: { visitServiceId: 501, visitId: 10, amountMinor: 120000 },
    participant: {
      practitionerPublicId: 'practitioner-1',
      role: 'performing' as const,
      evidenceType: 'legacy_consultation_doctor' as const,
    },
    idempotencyKey: 'route:visit-service:501',
    businessDate: '2026-07-29',
    authoritativeStatements: [
      db.prepare(`
        INSERT INTO visit_services(
          id,tenant_id,visit_id,patient_id,service_item_id,status,canonical_source_key
        ) VALUES (501,'tenant-a',10,101,NULL,'pending','visit-service-501')
      `),
      db.prepare(`INSERT INTO audit_logs(marker) VALUES ('visit-service-501')`),
    ],
    ...overrides,
  };
}

describe('service delivery route integration', () => {
  it('prepares one deterministic protected consultation service without a second price authority', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`DELETE FROM canonical_service_catalog_items`);
      const prepared = await prepareProtectedConsultationService(db, 'tenant-a');
      expect(prepared.statements.length).toBeGreaterThan(0);
      await db.batch([...prepared.statements]);
      expect(sqlite.prepare(`
        SELECT item_kind,canonical_code,display_name,unit_code,status
        FROM canonical_service_catalog_items WHERE service_public_id=?
      `).get(prepared.servicePublicId)).toEqual({
        item_kind: 'consultation',
        canonical_code: 'PROTECTED-CONSULTATION',
        display_name: 'Consultation',
        unit_code: 'service',
        status: 'active',
      });
      expect(sqlite.prepare(`
        SELECT canonical_public_id,mapping_status
        FROM canonical_source_mappings
        WHERE entity_type='service_catalog_item'
      `).get()).toEqual({ canonical_public_id: prepared.servicePublicId, mapping_status: 'mapped' });
      const replay = await prepareProtectedConsultationService(db, 'tenant-a');
      expect(replay.servicePublicId).toBe(prepared.servicePublicId);
      expect(replay.statements).toHaveLength(0);
    } finally {
      sqlite.close();
    }
  });

  it('accepts exact protected service evidence prepared in the same outer batch', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`DELETE FROM canonical_service_catalog_items`);
      const service = await prepareProtectedConsultationService(db, 'tenant-a');
      const prepared = await prepareAcceptedServiceRouteBatch(db, acceptanceInput(db, {
        servicePublicId: service.servicePublicId,
        preparedService: {
          servicePublicId: service.servicePublicId,
          sourceEvidenceSha256: service.sourceEvidenceSha256,
        },
        authoritativeStatements: [
          ...service.statements,
          db.prepare(`
            INSERT INTO visit_services(
              id,tenant_id,visit_id,patient_id,service_item_id,status,canonical_source_key
            ) VALUES (501,'tenant-a',10,101,NULL,'pending','visit-service-501')
          `),
        ],
      }));
      await db.batch([...prepared.statements]);
      expect(sqlite.prepare(`SELECT service_public_id FROM canonical_service_events`).get())
        .toEqual({ service_public_id: service.servicePublicId });
    } finally {
      sqlite.close();
    }
  });

  it('accepts a planned service without an encounter when one exact active patient link exists', async () => {
    const { sqlite, db } = harness();
    try {
      const prepared = await prepareAcceptedServiceRouteBatch(db, acceptanceInput(db, {
        encounterPublicId: null,
        sourcePublicId: 'planned-501',
        idempotencyKey: 'route:planned-service:501',
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO visit_services(
              id,tenant_id,visit_id,patient_id,service_item_id,status,canonical_source_key
            ) VALUES (501,'tenant-a',10,101,NULL,'pending','visit-service-501')
          `),
        ],
      }));
      await db.batch([...prepared.statements]);
      expect(sqlite.prepare(`SELECT encounter_public_id,status FROM canonical_service_requests`).get())
        .toEqual({ encounter_public_id: null, status: 'active' });
      expect(sqlite.prepare(`SELECT encounter_public_id,event_type FROM canonical_service_events`).get())
        .toEqual({ encounter_public_id: null, event_type: 'accepted' });
    } finally {
      sqlite.close();
    }
  });

  it('prepares one atomic compatibility, request, accepted-event, mapping and outbox batch', async () => {
    const { sqlite, db } = harness();
    try {
      const prepared = await prepareAcceptedServiceRouteBatch(db, acceptanceInput(db));
      expect(prepared.status).toBe('prepared');
      await db.batch([...prepared.statements]);

      expect(count(sqlite, 'visit_services')).toBe(1);
      expect(count(sqlite, 'audit_logs')).toBe(1);
      expect(sqlite.prepare(`
        SELECT status,fulfilled_quantity,last_event_public_id
        FROM canonical_service_requests
      `).get()).toEqual({
        status: 'active',
        fulfilled_quantity: 0,
        last_event_public_id: prepared.eventPublicId,
      });
      expect(sqlite.prepare(`
        SELECT event_type,status,quantity,encounter_public_id,service_public_id
        FROM canonical_service_events
      `).get()).toEqual({
        event_type: 'accepted',
        status: 'posted',
        quantity: 1,
        encounter_public_id: 'enc-10',
        service_public_id: 'svc-consult',
      });
      expect(count(sqlite, 'canonical_service_participants')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(2);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('replays identical acceptance, conflicts on changed evidence and rolls back all statements', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await prepareAcceptedServiceRouteBatch(db, acceptanceInput(db));
      await db.batch([...first.statements]);
      const replay = await prepareAcceptedServiceRouteBatch(db, acceptanceInput(db, {
        authoritativeStatements: [],
      }));
      expect(replay.status).toBe('replayed');
      expect(replay.statements).toHaveLength(0);

      await expect(prepareAcceptedServiceRouteBatch(db, acceptanceInput(db, {
        sourceEvidence: { visitServiceId: 501, visitId: 10, amountMinor: 130000 },
        authoritativeStatements: [],
      }))).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);

      const failed = await prepareAcceptedServiceRouteBatch(db, acceptanceInput(db, {
        sourcePublicId: '502',
        idempotencyKey: 'route:visit-service:502',
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO visit_services(
              id,tenant_id,visit_id,patient_id,service_item_id,status,canonical_source_key
            ) VALUES (502,'tenant-a',10,101,NULL,'pending','visit-service-502')
          `),
          db.prepare(`INSERT INTO audit_logs(marker) VALUES ('visit-service-501')`),
        ],
      }));
      await expect(db.batch([...failed.statements])).rejects.toThrow();
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM visit_services WHERE id=502`).get())
        .toEqual({ count: 0 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_service_requests
        WHERE request_public_id=?
      `).get(failed.requestPublicId)).toEqual({ count: 0 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_outbox_events
        WHERE idempotency_key LIKE 'route:visit-service:502:%'
      `).get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('accepts exact encounter evidence prepared in the same outer batch', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`DELETE FROM canonical_encounters`);
      const prepared = await prepareAcceptedServiceRouteBatch(db, acceptanceInput(db, {
        encounterPublicId: 'enc-pending',
        preparedEncounter: {
          encounterPublicId: 'enc-pending',
          legacyPatientId: 101,
        },
        authoritativeStatements: [
          db.prepare(`
            INSERT INTO canonical_encounters(
              tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
              encounter_type,status,encounter_version,started_at_utc,source_kind,
              source_evidence_sha256
            ) VALUES ('tenant-a','enc-pending',101,'ptl-101','outpatient','in_progress',1,
              '2026-07-29T01:00:00.000Z','runtime',?)
          `).bind('d'.repeat(64)),
          db.prepare(`
            INSERT INTO visit_services(
              id,tenant_id,visit_id,patient_id,service_item_id,status,canonical_source_key
            ) VALUES (501,'tenant-a',10,101,NULL,'pending','visit-service-501')
          `),
        ],
      }));
      await db.batch([...prepared.statements]);
      expect(sqlite.prepare(`SELECT encounter_public_id FROM canonical_service_events`).get())
        .toEqual({ encounter_public_id: 'enc-pending' });
    } finally {
      sqlite.close();
    }
  });

  it('bootstraps an unmapped accepted event then cancels it with compatibility in one batch', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO visit_services(
          id,tenant_id,visit_id,patient_id,service_item_id,status,canonical_source_key
        ) VALUES (503,'tenant-a',10,101,NULL,'pending','visit-service-503');
      `);
      const prepared = await prepareAcceptedAndCancelledServiceRouteBatch(db, {
        tenantId: 'tenant-a',
        legacyPatientId: 101,
        encounterPublicId: 'enc-10',
        servicePublicId: 'svc-consult',
        sourceType: 'legacy_visit_service',
        sourcePublicId: '503',
        sourceTable: 'visit_services',
        quantity: 1,
        occurredAtUtc: '2026-07-29T01:10:00.000Z',
        acceptedSourceEvidence: { visitServiceId: 503, status: 'pending' },
        cancelledAtUtc: '2026-07-29T01:20:00.000Z',
        cancellationSourceEvidence: { visitServiceId: 503, reasonCode: 'entered_in_error' },
        acceptanceIdempotencyKey: 'route:visit-service:503',
        cancellationIdempotencyKey: 'route:visit-service-cancel:503',
        businessDate: '2026-07-29',
        cancellationStatements: [
          db.prepare(`UPDATE visit_services SET status='cancelled' WHERE id=503 AND tenant_id='tenant-a' AND status='pending'`),
          db.prepare(`INSERT INTO audit_logs(marker) VALUES ('visit-service-cancel-503')`),
        ],
      });
      expect(prepared.status).toBe('prepared');
      await db.batch([...prepared.statements]);

      expect(sqlite.prepare(`SELECT status FROM visit_services WHERE id=503`).get())
        .toEqual({ status: 'cancelled' });
      expect(sqlite.prepare(`SELECT event_type,status,cancelled_at_utc FROM canonical_service_events`).get())
        .toEqual({
          event_type: 'accepted',
          status: 'cancelled',
          cancelled_at_utc: '2026-07-29T01:20:00.000Z',
        });
      expect(sqlite.prepare(`SELECT status,fulfilled_quantity,last_event_public_id FROM canonical_service_requests`).get())
        .toEqual({ status: 'active', fulfilled_quantity: 0, last_event_public_id: null });
      expect(count(sqlite, 'canonical_outbox_events')).toBe(3);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('cancels the current accepted event with compatibility and audit in the same batch', async () => {
    const { sqlite, db } = harness();
    try {
      const accepted = await prepareAcceptedServiceRouteBatch(db, acceptanceInput(db));
      await db.batch([...accepted.statements]);

      const cancellation = await prepareServiceRouteCancellationBatch(db, {
        tenantId: 'tenant-a',
        sourceType: 'legacy_visit_service',
        sourcePublicId: '501',
        cancelledAtUtc: '2026-07-29T01:20:00.000Z',
        sourceEvidence: { visitServiceId: 501, reasonCode: 'entered_in_error' },
        idempotencyKey: 'route:visit-service-cancel:501',
        businessDate: '2026-07-29',
        authoritativeStatements: [
          db.prepare(`UPDATE visit_services SET status='cancelled' WHERE id=501 AND tenant_id='tenant-a' AND status='pending'`),
          db.prepare(`INSERT INTO audit_logs(marker) VALUES ('visit-service-cancel-501')`),
        ],
      });
      expect(cancellation.status).toBe('prepared');
      await db.batch([...cancellation.statements]);

      expect(sqlite.prepare(`SELECT status FROM visit_services WHERE id=501`).get())
        .toEqual({ status: 'cancelled' });
      expect(sqlite.prepare(`SELECT status,cancelled_at_utc FROM canonical_service_events`).get())
        .toEqual({ status: 'cancelled', cancelled_at_utc: '2026-07-29T01:20:00.000Z' });
      expect(sqlite.prepare(`
        SELECT status,fulfilled_quantity,last_event_public_id
        FROM canonical_service_requests
      `).get()).toEqual({ status: 'active', fulfilled_quantity: 0, last_event_public_id: null });
      expect(count(sqlite, 'canonical_outbox_events')).toBe(3);
      expect(count(sqlite, 'audit_logs')).toBe(2);
    } finally {
      sqlite.close();
    }
  });
});
