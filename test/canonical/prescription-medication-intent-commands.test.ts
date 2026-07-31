import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  amendCanonicalPrescription,
  createCanonicalPrescriptionDraft,
  finalizeCanonicalPrescription,
  recordCanonicalPrescriptionSafetyEvent,
  replaceCanonicalPrescriptionDraft,
  transitionCanonicalMedicationOrder,
  type CreateCanonicalPrescriptionDraftInput,
} from '../../src/lib/canonical/commands/manage-prescription-medication-intent';

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
}

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    'migrations/0505_canonical_program_foundation.sql',
    'migrations/0506_canonical_practitioners.sql',
    'migrations/0507_canonical_encounters.sql',
    'migrations/0544_canonical_tenant_patient_links.sql',
    'migrations/0545_canonical_practitioner_operational_adoption.sql',
    'migrations/0548_canonical_encounter_admission_bed_convergence.sql',
    'migrations/0554_canonical_prescription_medication_intent.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_prescription_compat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marker TEXT NOT NULL UNIQUE
    )
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
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
  seedDependencies(sqlite);
  return { sqlite, db };
}

function seedDependencies(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES ('tenant-a','patient-link-101',101,'unlinked','unverified',
              'no_link_placeholder',?,?,1)
  `).run('1'.repeat(64), '2026-07-27T08:00:00.000Z');
  sqlite.prepare(`
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
      version,source_evidence_sha256
    ) VALUES ('tenant-a','practitioner-101','internal','Doctor Example','active',1,?)
  `).run('2'.repeat(64));
  sqlite.prepare(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
      encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
    ) VALUES ('tenant-a','encounter-101',101,'patient-link-101',
              'outpatient','in_progress',1,'runtime',?,?)
  `).run('2026-07-27T08:30:00.000Z', '3'.repeat(64));
}

function createInput(
  overrides: Partial<CreateCanonicalPrescriptionDraftInput> = {},
): CreateCanonicalPrescriptionDraftInput {
  return {
    tenantId: 'tenant-a',
    prescriptionPublicId: 'prescription-101',
    versionPublicId: 'prescription-version-101-v1',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    prescribingPractitionerPublicId: 'practitioner-101',
    authoredAtUtc: '2026-07-27T09:00:00.000Z',
    contentSha256: '4'.repeat(64),
    sourceType: 'legacy_prescription',
    sourcePublicId: '501',
    sourceTable: 'prescriptions',
    sourceEvidenceSha256: '5'.repeat(64),
    medicationOrders: [
      {
        medicationOrderPublicId: 'medication-order-101',
        sourceType: 'legacy_prescription_item',
        sourcePublicId: '601',
        sourceTable: 'prescription_items',
        sourceEvidenceSha256: '6'.repeat(64),
        medicationCodeSystem: 'local-formulary',
        medicationCode: 'MED-101',
        medicationDisplay: 'Sensitive medication display',
        genericDisplay: 'Sensitive generic display',
        strengthSnapshot: '500 mg',
        doseText: 'One tablet',
        routeCode: 'oral',
        frequencyCode: 'bid',
        durationText: 'Five days',
        instructionsText: 'Sensitive instruction',
        priority: 'routine',
        intendedStartUtc: '2026-07-27T09:00:00.000Z',
        intendedEndUtc: '2026-08-01T09:00:00.000Z',
      },
    ],
    actorSystemKey: 'canonical.prescription.test',
    idempotencyKey: 'prescription-create-101',
    eventPublicId: 'prescription-outbox-create-101',
    occurredAtUtc: '2026-07-27T09:00:00.000Z',
    businessDate: '2026-07-27',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

async function createDraft(db: CanonicalBatchDatabase): Promise<void> {
  await createCanonicalPrescriptionDraft(db, createInput());
}

async function finalizeDraft(db: CanonicalBatchDatabase): Promise<void> {
  await createDraft(db);
  await finalizeCanonicalPrescription(db, {
    tenantId: 'tenant-a',
    prescriptionPublicId: 'prescription-101',
    expectedVersion: 1,
    signedSnapshotSha256: '7'.repeat(64),
    sourceEvidenceSha256: '8'.repeat(64),
    actorPractitionerPublicId: 'practitioner-101',
    actorSystemKey: 'canonical.prescription.test',
    idempotencyKey: 'prescription-finalize-101',
    eventPublicId: 'prescription-outbox-finalize-101',
    occurredAtUtc: '2026-07-27T09:10:00.000Z',
    businessDate: '2026-07-27',
  });
}

describe('canonical prescription and medication-intent commands', () => {
  it('atomically creates draft, immutable version, medication order/event, mappings, compatibility, and PHI-minimised outbox', async () => {
    const { sqlite, db } = harness();
    try {
      const compatibility = db.prepare(`
        INSERT INTO legacy_prescription_compat(marker) VALUES (?)
      `).bind('legacy-prescription-501');
      await expect(createCanonicalPrescriptionDraft(db, createInput(), {
        authoritativeStatements: [compatibility],
      })).resolves.toEqual({
        status: 'applied',
        result: {
          prescriptionPublicId: 'prescription-101',
          currentVersionPublicId: 'prescription-version-101-v1',
          currentStatus: 'draft',
          statusVersion: 1,
          medicationOrderCount: 1,
        },
      });

      expect(count(sqlite, 'canonical_prescriptions')).toBe(1);
      expect(count(sqlite, 'canonical_prescription_versions')).toBe(1);
      expect(count(sqlite, 'canonical_medication_orders')).toBe(1);
      expect(count(sqlite, 'canonical_medication_order_status_events')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(3);
      expect(count(sqlite, 'legacy_prescription_compat')).toBe(1);
      expect(sqlite.prepare(`
        SELECT patient_link_public_id,encounter_public_id,
               prescribing_practitioner_public_id,current_version_public_id,
               current_status,status_version
        FROM canonical_prescriptions
      `).get()).toEqual({
        patient_link_public_id: 'patient-link-101',
        encounter_public_id: 'encounter-101',
        prescribing_practitioner_public_id: 'practitioner-101',
        current_version_public_id: 'prescription-version-101-v1',
        current_status: 'draft',
        status_version: 1,
      });
      expect(sqlite.prepare(`
        SELECT version_number,version_status,signed_snapshot_sha256
        FROM canonical_prescription_versions
      `).get()).toEqual({ version_number: 1, version_status: 'draft', signed_snapshot_sha256: null });
      expect(sqlite.prepare(`
        SELECT current_status,status_version,prescription_public_id,prescription_version_public_id
        FROM canonical_medication_orders
      `).get()).toEqual({
        current_status: 'draft',
        status_version: 1,
        prescription_public_id: 'prescription-101',
        prescription_version_public_id: 'prescription-version-101-v1',
      });
      expect(sqlite.prepare(`
        SELECT from_status,to_status,event_version,reason_code
        FROM canonical_medication_order_status_events
      `).get()).toEqual({ from_status: null, to_status: 'draft', event_version: 1, reason_code: 'draft_created' });

      const mappings = sqlite.prepare(`
        SELECT entity_type,source_type,source_public_id,canonical_public_id
        FROM canonical_source_mappings ORDER BY entity_type
      `).all();
      expect(mappings).toEqual([
        {
          entity_type: 'medication_order',
          source_type: 'legacy_prescription_item',
          source_public_id: '601',
          canonical_public_id: 'medication-order-101',
        },
        {
          entity_type: 'prescription',
          source_type: 'legacy_prescription',
          source_public_id: '501',
          canonical_public_id: 'prescription-101',
        },
        {
          entity_type: 'prescription_version',
          source_type: 'legacy_prescription',
          source_public_id: '501:v1',
          canonical_public_id: 'prescription-version-101-v1',
        },
      ]);

      const outbox = sqlite.prepare(`
        SELECT aggregate_type,aggregate_public_id,event_type,payload_json
        FROM canonical_outbox_events
      `).get() as Record<string, string>;
      expect(outbox).toMatchObject({
        aggregate_type: 'canonical_prescription',
        aggregate_public_id: 'prescription-101',
        event_type: 'canonical.prescription.draft-created',
      });
      for (const forbidden of [
        'Sensitive medication display', 'Sensitive generic display', 'One tablet',
        'Sensitive instruction', 'patient-link-101', 'encounter-101', 'practitioner-101',
        'MED-101', '601',
      ]) expect(outbox.payload_json).not.toContain(forbidden);
      expect(JSON.parse(outbox.payload_json).event).toEqual({
        prescriptionPublicId: 'prescription-101',
        currentVersionPublicId: 'prescription-version-101-v1',
        currentStatus: 'draft',
        statusVersion: 1,
        medicationOrderCount: 1,
      });
    } finally {
      sqlite.close();
    }
  });

  it('uses deterministic IDs, replays identical requests, and rejects conflicting replay', async () => {
    const { sqlite, db } = harness();
    try {
      const request = createInput({
        prescriptionPublicId: undefined,
        versionPublicId: undefined,
        eventPublicId: undefined,
        medicationOrders: createInput().medicationOrders.map((order) => ({
          ...order,
          medicationOrderPublicId: undefined,
        })),
        idempotencyKey: 'prescription-create-deterministic-501',
      });
      const first = await createCanonicalPrescriptionDraft(db, request);
      expect(first.result.prescriptionPublicId).toMatch(/^rx_[0-9A-HJKMNP-TV-Z]{26}$/);
      expect(first.result.currentVersionPublicId).toMatch(/^rxver_[0-9A-HJKMNP-TV-Z]{26}$/);
      await expect(createCanonicalPrescriptionDraft(db, request)).resolves.toEqual({
        status: 'replayed',
        result: first.result,
      });
      await expect(createCanonicalPrescriptionDraft(db, {
        ...request,
        contentSha256: '9'.repeat(64),
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      expect(count(sqlite, 'canonical_prescriptions')).toBe(1);
      expect(count(sqlite, 'canonical_medication_orders')).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('fails closed for missing or mismatched patient, encounter, practitioner, and source mapping', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(createCanonicalPrescriptionDraft(db, createInput({
        prescriptionPublicId: 'prescription-missing-patient',
        versionPublicId: 'version-missing-patient',
        patientLinkPublicId: 'missing-patient-link',
        idempotencyKey: 'prescription-missing-patient',
        eventPublicId: 'prescription-outbox-missing-patient',
        sourcePublicId: '502',
      }))).rejects.toThrow(/patient link not found/);

      sqlite.prepare(`
        UPDATE canonical_encounters SET patient_link_public_id=NULL
        WHERE tenant_id='tenant-a' AND encounter_public_id='encounter-101'
      `).run();
      await expect(createCanonicalPrescriptionDraft(db, createInput({
        prescriptionPublicId: 'prescription-mismatch-encounter',
        versionPublicId: 'version-mismatch-encounter',
        idempotencyKey: 'prescription-mismatch-encounter',
        eventPublicId: 'prescription-outbox-mismatch-encounter',
        sourcePublicId: '503',
      }))).rejects.toThrow(/encounter.*patient link/i);
      sqlite.prepare(`
        UPDATE canonical_encounters SET patient_link_public_id='patient-link-101'
        WHERE tenant_id='tenant-a' AND encounter_public_id='encounter-101'
      `).run();

      sqlite.prepare(`
        UPDATE canonical_practitioners SET status='inactive'
        WHERE tenant_id='tenant-a' AND practitioner_public_id='practitioner-101'
      `).run();
      await expect(createCanonicalPrescriptionDraft(db, createInput({
        prescriptionPublicId: 'prescription-inactive-practitioner',
        versionPublicId: 'version-inactive-practitioner',
        idempotencyKey: 'prescription-inactive-practitioner',
        eventPublicId: 'prescription-outbox-inactive-practitioner',
        sourcePublicId: '504',
      }))).rejects.toThrow(/active practitioner/);
      sqlite.prepare(`
        UPDATE canonical_practitioners SET status='active'
        WHERE tenant_id='tenant-a' AND practitioner_public_id='practitioner-101'
      `).run();

      sqlite.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES ('tenant-a','prescription','prescription-other','legacy_prescription','505',
                  'prescriptions','mapped',1,?)
      `).run('a'.repeat(64));
      await expect(createCanonicalPrescriptionDraft(db, createInput({
        prescriptionPublicId: 'prescription-source-conflict',
        versionPublicId: 'version-source-conflict',
        idempotencyKey: 'prescription-source-conflict',
        eventPublicId: 'prescription-outbox-source-conflict',
        sourcePublicId: '505',
      }))).rejects.toThrow(/source mapping already belongs/);
      expect(count(sqlite, 'canonical_prescriptions')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back every canonical fact and mapping when compatibility fails', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`INSERT INTO legacy_prescription_compat(marker) VALUES ('duplicate')`).run();
      const duplicate = db.prepare(`INSERT INTO legacy_prescription_compat(marker) VALUES ('duplicate')`);
      await expect(createCanonicalPrescriptionDraft(db, createInput(), {
        authoritativeStatements: [duplicate],
      })).rejects.toThrow(/UNIQUE constraint failed/);
      for (const table of [
        'canonical_prescriptions', 'canonical_prescription_versions',
        'canonical_medication_orders', 'canonical_medication_order_status_events',
        'canonical_source_mappings', 'canonical_outbox_events',
      ]) expect(count(sqlite, table)).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('replaces only a draft by creating a new immutable version and explicit order replacement events', async () => {
    const { sqlite, db } = harness();
    try {
      await createDraft(db);
      await expect(replaceCanonicalPrescriptionDraft(db, {
        tenantId: 'tenant-a',
        prescriptionPublicId: 'prescription-101',
        expectedVersion: 1,
        versionPublicId: 'prescription-version-101-v2',
        contentSha256: 'b'.repeat(64),
        sourceType: 'legacy_prescription_version',
        sourcePublicId: '501:v2',
        sourceTable: 'prescription_versions',
        sourceEvidenceSha256: 'c'.repeat(64),
        medicationOrders: [
          {
            medicationOrderPublicId: 'medication-order-102',
            sourceType: 'legacy_prescription_item',
            sourcePublicId: '602',
            sourceTable: 'prescription_items',
            sourceEvidenceSha256: 'd'.repeat(64),
            medicationDisplay: 'Replacement medication',
            doseText: 'Replacement dose',
            routeCode: 'oral',
            frequencyCode: 'od',
            priority: 'routine',
            intendedStartUtc: '2026-07-27T09:05:00.000Z',
          },
        ],
        actorSystemKey: 'canonical.prescription.test',
        idempotencyKey: 'prescription-replace-101',
        eventPublicId: 'prescription-outbox-replace-101',
        occurredAtUtc: '2026-07-27T09:05:00.000Z',
        businessDate: '2026-07-27',
      })).resolves.toMatchObject({
        status: 'applied',
        result: {
          prescriptionPublicId: 'prescription-101',
          currentVersionPublicId: 'prescription-version-101-v2',
          currentStatus: 'draft',
          statusVersion: 2,
          medicationOrderCount: 1,
        },
      });
      expect(count(sqlite, 'canonical_prescription_versions')).toBe(2);
      expect(sqlite.prepare(`
        SELECT current_status,status_version FROM canonical_medication_orders
        WHERE medication_order_public_id='medication-order-101'
      `).get()).toEqual({ current_status: 'entered_in_error', status_version: 2 });
      expect(sqlite.prepare(`
        SELECT current_status,status_version FROM canonical_medication_orders
        WHERE medication_order_public_id='medication-order-102'
      `).get()).toEqual({ current_status: 'draft', status_version: 1 });
      expect(count(sqlite, 'canonical_medication_order_status_events')).toBe(3);
      await expect(replaceCanonicalPrescriptionDraft(db, {
        tenantId: 'tenant-a',
        prescriptionPublicId: 'prescription-101',
        expectedVersion: 1,
        versionPublicId: 'prescription-version-stale-v3',
        contentSha256: 'e'.repeat(64),
        sourceType: 'legacy_prescription_version',
        sourcePublicId: '501:stale-v3',
        sourceTable: 'prescription_versions',
        sourceEvidenceSha256: 'f'.repeat(64),
        medicationOrders: [],
        actorSystemKey: 'canonical.prescription.test',
        idempotencyKey: 'prescription-replace-stale-101',
        eventPublicId: 'prescription-outbox-replace-stale-101',
        occurredAtUtc: '2026-07-27T09:06:00.000Z',
        businessDate: '2026-07-27',
      })).rejects.toThrow(/expectedVersion 1 does not match current version 2/);
    } finally {
      sqlite.close();
    }
  });

  it('finalizes once, activates draft orders, preserves signed evidence, and replays before state validation', async () => {
    const { sqlite, db } = harness();
    try {
      await createDraft(db);
      const request = {
        tenantId: 'tenant-a',
        prescriptionPublicId: 'prescription-101',
        expectedVersion: 1,
        signedSnapshotSha256: '7'.repeat(64),
        sourceEvidenceSha256: '8'.repeat(64),
        actorPractitionerPublicId: 'practitioner-101',
        actorSystemKey: 'canonical.prescription.test',
        idempotencyKey: 'prescription-finalize-101',
        eventPublicId: 'prescription-outbox-finalize-101',
        occurredAtUtc: '2026-07-27T09:10:00.000Z',
        businessDate: '2026-07-27',
      } as const;
      const first = await finalizeCanonicalPrescription(db, request);
      expect(first.result).toMatchObject({ currentStatus: 'final', statusVersion: 2, medicationOrderCount: 1 });
      expect(sqlite.prepare(`
        SELECT current_status,status_version,finalized_at_utc FROM canonical_prescriptions
      `).get()).toEqual({
        current_status: 'final',
        status_version: 2,
        finalized_at_utc: '2026-07-27T09:10:00.000Z',
      });
      expect(sqlite.prepare(`
        SELECT version_status,signed_snapshot_sha256,signing_practitioner_public_id
        FROM canonical_prescription_versions
      `).get()).toEqual({
        version_status: 'final',
        signed_snapshot_sha256: '7'.repeat(64),
        signing_practitioner_public_id: 'practitioner-101',
      });
      expect(sqlite.prepare(`
        SELECT current_status,status_version FROM canonical_medication_orders
      `).get()).toEqual({ current_status: 'active', status_version: 2 });
      await expect(finalizeCanonicalPrescription(db, request)).resolves.toEqual({ status: 'replayed', result: first.result });
      await expect(replaceCanonicalPrescriptionDraft(db, {
        tenantId: 'tenant-a',
        prescriptionPublicId: 'prescription-101',
        expectedVersion: 2,
        versionPublicId: 'prescription-version-illegal',
        contentSha256: 'e'.repeat(64),
        sourceType: 'legacy_prescription_version',
        sourcePublicId: '501:illegal',
        sourceTable: 'prescription_versions',
        sourceEvidenceSha256: 'f'.repeat(64),
        medicationOrders: [],
        actorSystemKey: 'canonical.prescription.test',
        idempotencyKey: 'prescription-replace-final-illegal',
        occurredAtUtc: '2026-07-27T09:11:00.000Z',
        businessDate: '2026-07-27',
      })).rejects.toThrow(/draft prescription/);
    } finally {
      sqlite.close();
    }
  });

  it('amends final history by superseding the signed version and stopping replaced active orders', async () => {
    const { sqlite, db } = harness();
    try {
      await finalizeDraft(db);
      await expect(amendCanonicalPrescription(db, {
        tenantId: 'tenant-a',
        prescriptionPublicId: 'prescription-101',
        expectedVersion: 2,
        versionPublicId: 'prescription-version-101-v2',
        contentSha256: 'a'.repeat(64),
        signedSnapshotSha256: 'b'.repeat(64),
        sourceType: 'legacy_prescription_version',
        sourcePublicId: '501:v2',
        sourceTable: 'prescription_versions',
        sourceEvidenceSha256: 'c'.repeat(64),
        medicationOrders: [
          {
            medicationOrderPublicId: 'medication-order-102',
            sourceType: 'legacy_prescription_item',
            sourcePublicId: '602',
            sourceTable: 'prescription_items',
            sourceEvidenceSha256: 'd'.repeat(64),
            medicationDisplay: 'Amended medication',
            doseText: 'Amended dose',
            routeCode: 'oral',
            frequencyCode: 'tid',
            priority: 'urgent',
            intendedStartUtc: '2026-07-27T09:20:00.000Z',
          },
        ],
        actorPractitionerPublicId: 'practitioner-101',
        actorSystemKey: 'canonical.prescription.test',
        idempotencyKey: 'prescription-amend-101',
        eventPublicId: 'prescription-outbox-amend-101',
        occurredAtUtc: '2026-07-27T09:20:00.000Z',
        businessDate: '2026-07-27',
      })).resolves.toMatchObject({
        status: 'applied',
        result: {
          currentStatus: 'amended',
          statusVersion: 3,
          currentVersionPublicId: 'prescription-version-101-v2',
          medicationOrderCount: 1,
        },
      });
      expect(sqlite.prepare(`
        SELECT version_number,version_status,supersedes_version_public_id
        FROM canonical_prescription_versions
        WHERE version_public_id='prescription-version-101-v2'
      `).get()).toEqual({
        version_number: 2,
        version_status: 'amendment',
        supersedes_version_public_id: 'prescription-version-101-v1',
      });
      expect(sqlite.prepare(`
        SELECT current_status FROM canonical_medication_orders
        WHERE medication_order_public_id='medication-order-101'
      `).get()).toEqual({ current_status: 'stopped' });
      expect(sqlite.prepare(`
        SELECT current_status FROM canonical_medication_orders
        WHERE medication_order_public_id='medication-order-102'
      `).get()).toEqual({ current_status: 'active' });
    } finally {
      sqlite.close();
    }
  });

  it('applies reviewed order transitions and immutable safety events without administration or fulfilment mutation', async () => {
    const { sqlite, db } = harness();
    try {
      await finalizeDraft(db);
      await expect(transitionCanonicalMedicationOrder(db, {
        tenantId: 'tenant-a',
        medicationOrderPublicId: 'medication-order-101',
        toStatus: 'on_hold',
        expectedVersion: 2,
        reasonCode: 'clinical_hold',
        sourceEvidenceSha256: 'e'.repeat(64),
        actorPractitionerPublicId: 'practitioner-101',
        actorSystemKey: 'canonical.prescription.test',
        idempotencyKey: 'medication-order-hold-101',
        eventPublicId: 'medication-order-outbox-hold-101',
        occurredAtUtc: '2026-07-27T09:15:00.000Z',
        businessDate: '2026-07-27',
      })).resolves.toMatchObject({
        status: 'applied',
        result: { currentStatus: 'on_hold', statusVersion: 3 },
      });
      await expect(transitionCanonicalMedicationOrder(db, {
        tenantId: 'tenant-a',
        medicationOrderPublicId: 'medication-order-101',
        toStatus: 'draft',
        expectedVersion: 3,
        reasonCode: 'illegal_rewind',
        sourceEvidenceSha256: 'f'.repeat(64),
        actorSystemKey: 'canonical.prescription.test',
        idempotencyKey: 'medication-order-illegal-101',
        occurredAtUtc: '2026-07-27T09:16:00.000Z',
        businessDate: '2026-07-27',
      })).rejects.toThrow(/transition on_hold -> draft is not allowed/);

      await expect(recordCanonicalPrescriptionSafetyEvent(db, {
        tenantId: 'tenant-a',
        prescriptionPublicId: 'prescription-101',
        prescriptionVersionPublicId: 'prescription-version-101-v1',
        medicationOrderPublicId: 'medication-order-101',
        eventPublicId: 'prescription-safety-101',
        eventType: 'override',
        outcome: 'overridden',
        severity: 'high',
        evidenceCode: 'reviewed_clinical_override',
        sourceEvidenceSha256: 'a'.repeat(64),
        actorPractitionerPublicId: 'practitioner-101',
        actorSystemKey: 'canonical.prescription.test',
        idempotencyKey: 'prescription-safety-101',
        outboxEventPublicId: 'prescription-safety-outbox-101',
        occurredAtUtc: '2026-07-27T09:17:00.000Z',
        businessDate: '2026-07-27',
      })).resolves.toMatchObject({
        status: 'applied',
        result: { eventPublicId: 'prescription-safety-101', outcome: 'overridden' },
      });
      await expect(recordCanonicalPrescriptionSafetyEvent(db, {
        tenantId: 'tenant-a',
        prescriptionPublicId: 'prescription-101',
        eventType: 'override',
        outcome: 'overridden',
        evidenceCode: 'missing_practitioner',
        sourceEvidenceSha256: 'b'.repeat(64),
        actorSystemKey: 'canonical.prescription.test',
        idempotencyKey: 'prescription-safety-missing-practitioner',
        occurredAtUtc: '2026-07-27T09:18:00.000Z',
        businessDate: '2026-07-27',
      })).rejects.toThrow(/override.*practitioner/i);

      expect(count(sqlite, 'canonical_prescription_safety_events')).toBe(1);
      expect(count(sqlite, 'canonical_medication_order_status_events')).toBe(3);
      for (const absent of ['mar_administrations', 'medication_orders', 'medication_order_items', 'pharmacy_sales']) {
        const found = sqlite.prepare(`
          SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name=?
        `).get(absent) as { count: number };
        expect(found.count).toBe(0);
      }
    } finally {
      sqlite.close();
    }
  });
});
