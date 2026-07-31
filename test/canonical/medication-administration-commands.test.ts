import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  cancelCanonicalMedicationReconciliation,
  correctCanonicalMedicationAdministrationEvent,
  createCanonicalMedicationReconciliationDraft,
  enterCanonicalMedicationAdministrationInError,
  finalizeCanonicalMedicationReconciliation,
  recordCanonicalMedicationAdministrationEvent,
  replaceCanonicalMedicationReconciliationDraft,
  type CreateCanonicalMedicationReconciliationDraftInput,
  type RecordCanonicalMedicationAdministrationEventInput,
} from '../../src/lib/canonical/commands/manage-medication-administration';

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
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nSQL:${this.sql}\nPARAMS:${JSON.stringify(this.params)}`, { cause: error });
    }
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
    'migrations/0556_canonical_patient_vital_measurement.sql',
    'migrations/0557_canonical_medication_administration.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_medication_compat (
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
  for (const [tenantId, patientLink, legacyPatientId, hash] of [
    ['tenant-a', 'patient-link-101', 101, '1'],
    ['tenant-b', 'patient-link-201', 201, '2'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_tenant_patient_links (
        tenant_id,patient_link_public_id,legacy_patient_id,link_status,
        verification_level,evidence_type,evidence_sha256,effective_from_utc,version
      ) VALUES (?,?,?,'unlinked','unverified','no_link_placeholder',?,?,1)
    `).run(tenantId, patientLink, legacyPatientId, hash.repeat(64), '2026-07-28T00:00:00.000Z');
  }
  for (const [tenantId, practitioner, name, hash] of [
    ['tenant-a', 'practitioner-101', 'Prescriber', '3'],
    ['tenant-a', 'practitioner-102', 'Administering nurse', '4'],
    ['tenant-a', 'practitioner-103', 'Reconciliation reviewer', '5'],
    ['tenant-b', 'practitioner-201', 'Other tenant', '6'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
        version,source_evidence_sha256
      ) VALUES (?,?,'internal',?,'active',1,?)
    `).run(tenantId, practitioner, name, hash.repeat(64));
  }
  for (const [tenantId, encounter, patientLink, legacyPatient, hash] of [
    ['tenant-a', 'encounter-101', 'patient-link-101', 101, '7'],
    ['tenant-b', 'encounter-201', 'patient-link-201', 201, '8'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_encounters (
        tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
        encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
      ) VALUES (?,?,?,?, 'inpatient','in_progress',1,'runtime',?,?)
    `).run(tenantId, encounter, legacyPatient, patientLink, '2026-07-28T08:00:00.000Z', hash.repeat(64));
  }
  seedMedicationOrder(sqlite, 'tenant-a', 'med-order-101', 'patient-link-101', 'encounter-101', 'practitioner-101', '9');
  seedMedicationOrder(sqlite, 'tenant-b', 'med-order-201', 'patient-link-201', 'encounter-201', 'practitioner-201', 'a', false);
}

function seedMedicationOrder(
  sqlite: DatabaseSync,
  tenantId: string,
  orderId: string,
  patientLink: string,
  encounter: string,
  practitioner: string,
  hash: string,
  includeStatusEvents = true,
): void {
  sqlite.prepare(`
    INSERT INTO canonical_medication_orders (
      tenant_id,medication_order_public_id,patient_link_public_id,encounter_public_id,
      prescribing_practitioner_public_id,medication_display,dose_text,route_code,
      frequency_code,priority,intended_start_utc,current_status,status_version,
      idempotency_key,request_fingerprint_sha256,source_evidence_sha256
    ) VALUES (?,?,?,?,?,'Ceftriaxone','1 g','IV','OD','routine',?,
              'active',2,?,?,?)
  `).run(
    tenantId, orderId, patientLink, encounter, practitioner,
    '2026-07-28T08:30:00.000Z', `seed-${orderId}`, hash.repeat(64), hash.repeat(64),
  );
  if (!includeStatusEvents) return;
  sqlite.prepare(`
    INSERT INTO canonical_medication_order_status_events (
      tenant_id,event_public_id,medication_order_public_id,from_status,to_status,
      event_version,reason_code,actor_practitioner_public_id,actor_system_key,
      idempotency_key,source_evidence_sha256,occurred_at_utc
    ) VALUES
      (?,?,?,NULL,'draft',1,'created',?,'commands.test',?,?,?),
      (?,?,?,'draft','active',2,'activated',?,'commands.test',?,?,?)
  `).run(
    tenantId, `${orderId}-event-v1`, orderId, practitioner,
    `${orderId}-event-v1`, 'b'.repeat(64), '2026-07-28T08:30:00.000Z',
    tenantId, `${orderId}-event-v2`, orderId, practitioner,
    `${orderId}-event-v2`, 'c'.repeat(64), '2026-07-28T08:31:00.000Z',
  );
}

function administrationInput(
  overrides: Partial<RecordCanonicalMedicationAdministrationEventInput> = {},
): RecordCanonicalMedicationAdministrationEventInput {
  return {
    tenantId: 'tenant-a',
    administrationEventPublicId: 'administration-101',
    medicationOrderPublicId: 'med-order-101',
    medicationOrderStatusVersion: 2,
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    administeringPractitionerPublicId: 'practitioner-102',
    scheduledAtUtc: '2026-07-28T09:00:00.000Z',
    occurredAtUtc: '2026-07-28T09:03:00.000Z',
    recordedAtUtc: '2026-07-28T09:04:00.000Z',
    outcomeCode: 'given',
    administeredDoseValueDecimal: '1.00',
    administeredDoseUnitCode: 'g',
    routeCode: 'IV',
    siteCode: 'left_arm',
    sourceType: 'legacy_mar',
    sourcePublicId: '501',
    sourceTable: 'nur_medication_admin',
    sourceEvidenceSha256: 'd'.repeat(64),
    actorSystemKey: 'canonical.medication.test',
    idempotencyKey: 'administration-record-101',
    eventPublicId: 'administration-outbox-record-101',
    commandOccurredAtUtc: '2026-07-28T09:04:00.000Z',
    businessDate: '2026-07-28',
    ...overrides,
  };
}

function reconciliationInput(
  overrides: Partial<CreateCanonicalMedicationReconciliationDraftInput> = {},
): CreateCanonicalMedicationReconciliationDraftInput {
  return {
    tenantId: 'tenant-a',
    reconciliationPublicId: 'reconciliation-101',
    versionPublicId: 'reconciliation-version-101-v1',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    reconciliationType: 'discharge',
    creatingPractitionerPublicId: 'practitioner-103',
    items: [
      {
        itemPublicId: 'reconciliation-item-101',
        sourceKind: 'inpatient',
        decisionCode: 'continue',
        medicationOrderPublicId: 'med-order-101',
        medicationDescriptionSnapshot: 'Ceftriaxone',
        priorDoseSnapshot: '1 g',
        priorRouteSnapshot: 'IV',
        priorFrequencySnapshot: 'OD',
        reasonCode: 'continue_on_discharge',
        sourceEvidenceSha256: 'e'.repeat(64),
      },
    ],
    sourceSummarySha256: 'f'.repeat(64),
    sourceType: 'legacy_medication_reconciliation',
    sourcePublicId: '701',
    sourceTable: 'cln_medication_reconciliation',
    sourceEvidenceSha256: '0'.repeat(64),
    actorSystemKey: 'canonical.medication.test',
    idempotencyKey: 'reconciliation-create-101',
    eventPublicId: 'reconciliation-outbox-create-101',
    occurredAtUtc: '2026-07-28T10:00:00.000Z',
    businessDate: '2026-07-28',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

async function createDraft(db: CanonicalBatchDatabase): Promise<void> {
  await createCanonicalMedicationReconciliationDraft(db, reconciliationInput());
}

describe('canonical medication administration and reconciliation commands', () => {
  it('atomically records administration with canonical decimal dose, source mapping, compatibility write, and PHI-minimised outbox', async () => {
    const { sqlite, db } = harness();
    try {
      const compatibility = db.prepare(`INSERT INTO legacy_medication_compat(marker) VALUES (?)`).bind('mar-501');
      await expect(recordCanonicalMedicationAdministrationEvent(db, administrationInput(), {
        authoritativeStatements: [compatibility],
      })).resolves.toEqual({
        status: 'applied',
        result: {
          administrationEventPublicId: 'administration-101',
          eventKind: 'administration',
          outcomeCode: 'given',
          medicationOrderStatusVersion: 2,
        },
      });
      expect(sqlite.prepare(`
        SELECT administered_dose_value_decimal,administered_dose_unit_code,route_code
        FROM canonical_medication_administration_events
      `).get()).toEqual({
        administered_dose_value_decimal: '1',
        administered_dose_unit_code: 'g',
        route_code: 'IV',
      });
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'legacy_medication_compat')).toBe(1);
      const outbox = sqlite.prepare(`SELECT event_type,payload_json FROM canonical_outbox_events`).get() as Record<string, string>;
      expect(outbox.event_type).toBe('canonical.medication-administration.recorded');
      for (const forbidden of ['patient-link-101','encounter-101','practitioner-102','med-order-101','Ceftriaxone','1.00']) {
        expect(outbox.payload_json).not.toContain(forbidden);
      }
    } finally { sqlite.close(); }
  });

  it('replays before validation, rejects conflict/cross-tenant/order-version errors, validates outcomes, and rolls back atomically', async () => {
    const { sqlite, db } = harness();
    try {
      const deterministic = administrationInput({ administrationEventPublicId: undefined, eventPublicId: undefined });
      const first = await recordCanonicalMedicationAdministrationEvent(db, deterministic);
      const second = await recordCanonicalMedicationAdministrationEvent(db, deterministic);
      expect(first.status).toBe('applied');
      expect(second).toEqual({ status: 'replayed', result: first.result });
      expect(first.result.administrationEventPublicId).toMatch(/^medadmin_/);
      await expect(recordCanonicalMedicationAdministrationEvent(db, {
        ...deterministic,
        recordedAtUtc: '2026-07-28T09:05:00.000Z',
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
      await expect(recordCanonicalMedicationAdministrationEvent(db, administrationInput({
        idempotencyKey: 'administration-cross-tenant',
        eventPublicId: 'administration-cross-tenant-outbox',
        medicationOrderPublicId: 'med-order-201',
      }))).rejects.toThrow(/medication order not found|scope mismatch/i);
      await expect(recordCanonicalMedicationAdministrationEvent(db, administrationInput({
        idempotencyKey: 'administration-stale-version',
        eventPublicId: 'administration-stale-version-outbox',
        medicationOrderStatusVersion: 1,
      }))).rejects.toThrow(/status version/i);
      await expect(recordCanonicalMedicationAdministrationEvent(db, administrationInput({
        idempotencyKey: 'administration-refused-no-reason',
        eventPublicId: 'administration-refused-no-reason-outbox',
        outcomeCode: 'refused',
        administeredDoseValueDecimal: null,
        administeredDoseUnitCode: null,
        routeCode: null,
        siteCode: null,
        reasonCode: null,
      }))).rejects.toThrow(/reason/i);

      const rollback = harness();
      try {
        const compatibility = rollback.db.prepare(`INSERT INTO legacy_medication_compat(marker) VALUES (?)`).bind('must-rollback');
        await expect(recordCanonicalMedicationAdministrationEvent(rollback.db, administrationInput({
          idempotencyKey: 'administration-rollback',
          eventPublicId: 'administration-rollback-outbox',
        }), {
          authoritativeStatements: [compatibility, rollback.db.prepare('INSERT INTO missing_table(x) VALUES (1)')],
        })).rejects.toThrow();
        expect(count(rollback.sqlite, 'canonical_medication_administration_events')).toBe(0);
        expect(count(rollback.sqlite, 'canonical_outbox_events')).toBe(0);
        expect(count(rollback.sqlite, 'legacy_medication_compat')).toBe(0);
      } finally { rollback.sqlite.close(); }
    } finally { sqlite.close(); }
  });

  it('corrects and enters administration in error through immutable replacement events without rewriting the original', async () => {
    const { sqlite, db } = harness();
    try {
      await recordCanonicalMedicationAdministrationEvent(db, administrationInput());
      const original = sqlite.prepare(`
        SELECT administered_dose_value_decimal,outcome_code FROM canonical_medication_administration_events
        WHERE administration_event_public_id='administration-101'
      `).get();
      await expect(correctCanonicalMedicationAdministrationEvent(db, {
        tenantId: 'tenant-a',
        administrationEventPublicId: 'administration-101',
        replacementAdministrationEventPublicId: 'administration-102',
        administeringPractitionerPublicId: 'practitioner-102',
        occurredAtUtc: '2026-07-28T09:03:00.000Z',
        recordedAtUtc: '2026-07-28T09:10:00.000Z',
        outcomeCode: 'partially_given',
        administeredDoseValueDecimal: '0.5',
        administeredDoseUnitCode: 'g',
        routeCode: 'IV',
        siteCode: 'left_arm',
        reasonCode: 'dose_documentation_corrected',
        sourceType: 'legacy_mar_correction',
        sourcePublicId: '501:correction:1',
        sourceTable: 'nur_medication_admin',
        sourceEvidenceSha256: '1'.repeat(64),
        actorSystemKey: 'canonical.medication.test',
        idempotencyKey: 'administration-correct-101',
        eventPublicId: 'administration-outbox-correct-101',
        commandOccurredAtUtc: '2026-07-28T09:10:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toEqual({
        status: 'applied',
        result: {
          administrationEventPublicId: 'administration-102',
          eventKind: 'correction',
          outcomeCode: 'partially_given',
          supersedesAdministrationEventPublicId: 'administration-101',
        },
      });
      expect(sqlite.prepare(`
        SELECT administered_dose_value_decimal,outcome_code FROM canonical_medication_administration_events
        WHERE administration_event_public_id='administration-101'
      `).get()).toEqual(original);
      await expect(enterCanonicalMedicationAdministrationInError(db, {
        tenantId: 'tenant-a',
        administrationEventPublicId: 'administration-102',
        errorEventPublicId: 'administration-103',
        administeringPractitionerPublicId: 'practitioner-103',
        reasonCode: 'wrong_patient_chart',
        sourceType: 'legacy_mar_error',
        sourcePublicId: '501:error:1',
        sourceTable: 'nur_medication_admin',
        sourceEvidenceSha256: '2'.repeat(64),
        actorSystemKey: 'canonical.medication.test',
        idempotencyKey: 'administration-error-102',
        eventPublicId: 'administration-outbox-error-102',
        occurredAtUtc: '2026-07-28T09:11:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toEqual({
        status: 'applied',
        result: {
          administrationEventPublicId: 'administration-103',
          eventKind: 'entered_in_error',
          outcomeCode: null,
          supersedesAdministrationEventPublicId: 'administration-102',
        },
      });
      expect(count(sqlite, 'canonical_medication_administration_events')).toBe(3);
    } finally { sqlite.close(); }
  });

  it('creates a reconciliation header, immutable draft version/items, initial status event, pointer, mapping, and outbox in one batch', async () => {
    const { sqlite, db } = harness();
    try {
      const created = await createCanonicalMedicationReconciliationDraft(db, reconciliationInput());
      expect(created).toEqual({
        status: 'applied',
        result: {
          reconciliationPublicId: 'reconciliation-101',
          versionPublicId: 'reconciliation-version-101-v1',
          currentStatus: 'draft',
          statusVersion: 1,
          versionNumber: 1,
          itemCount: 1,
        },
      });
      expect(sqlite.prepare(`
        SELECT current_version_public_id,current_status,status_version
        FROM canonical_medication_reconciliations
      `).get()).toEqual({
        current_version_public_id: 'reconciliation-version-101-v1',
        current_status: 'draft',
        status_version: 1,
      });
      expect(count(sqlite, 'canonical_medication_reconciliation_versions')).toBe(1);
      expect(count(sqlite, 'canonical_medication_reconciliation_items')).toBe(1);
      expect(count(sqlite, 'canonical_medication_reconciliation_status_events')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      const outbox = sqlite.prepare(`SELECT payload_json FROM canonical_outbox_events`).get() as { payload_json: string };
      for (const forbidden of ['patient-link-101','encounter-101','practitioner-103','Ceftriaxone','med-order-101']) {
        expect(outbox.payload_json).not.toContain(forbidden);
      }
    } finally { sqlite.close(); }
  });

  it('replaces a draft with a new immutable version and deterministic item sequence without mutating the old version', async () => {
    const { sqlite, db } = harness();
    try {
      await createDraft(db);
      const oldVersion = sqlite.prepare(`
        SELECT version_status,content_sha256 FROM canonical_medication_reconciliation_versions
        WHERE version_public_id='reconciliation-version-101-v1'
      `).get();
      await expect(replaceCanonicalMedicationReconciliationDraft(db, {
        tenantId: 'tenant-a',
        reconciliationPublicId: 'reconciliation-101',
        expectedStatusVersion: 1,
        versionPublicId: 'reconciliation-version-101-v2',
        authoringPractitionerPublicId: 'practitioner-103',
        items: [
          {
            itemPublicId: 'reconciliation-item-102',
            sourceKind: 'inpatient',
            decisionCode: 'modify',
            medicationOrderPublicId: 'med-order-101',
            medicationDescriptionSnapshot: 'Ceftriaxone',
            priorDoseSnapshot: '1 g',
            proposedDoseSnapshot: '500 mg',
            proposedRouteSnapshot: 'IV',
            proposedFrequencySnapshot: 'OD',
            reasonCode: 'dose_reduced',
            sourceEvidenceSha256: '3'.repeat(64),
          },
        ],
        sourceSummarySha256: '4'.repeat(64),
        sourceEvidenceSha256: '5'.repeat(64),
        actorSystemKey: 'canonical.medication.test',
        idempotencyKey: 'reconciliation-replace-101',
        eventPublicId: 'reconciliation-outbox-replace-101',
        occurredAtUtc: '2026-07-28T10:05:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toEqual({
        status: 'applied',
        result: {
          reconciliationPublicId: 'reconciliation-101',
          versionPublicId: 'reconciliation-version-101-v2',
          currentStatus: 'draft',
          statusVersion: 2,
          versionNumber: 2,
          itemCount: 1,
        },
      });
      expect(sqlite.prepare(`
        SELECT version_status,content_sha256 FROM canonical_medication_reconciliation_versions
        WHERE version_public_id='reconciliation-version-101-v1'
      `).get()).toEqual(oldVersion);
      expect(sqlite.prepare(`
        SELECT current_version_public_id,current_status,status_version
        FROM canonical_medication_reconciliations
      `).get()).toEqual({
        current_version_public_id: 'reconciliation-version-101-v2',
        current_status: 'draft',
        status_version: 2,
      });
      expect(count(sqlite, 'canonical_medication_reconciliation_versions')).toBe(2);
    } finally { sqlite.close(); }
  });

  it('finalizes a draft with matching content signature and optimistic status evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await createDraft(db);
      const content = sqlite.prepare(`
        SELECT content_sha256 FROM canonical_medication_reconciliation_versions
        WHERE version_public_id='reconciliation-version-101-v1'
      `).get() as { content_sha256: string };
      await expect(finalizeCanonicalMedicationReconciliation(db, {
        tenantId: 'tenant-a',
        reconciliationPublicId: 'reconciliation-101',
        expectedStatusVersion: 1,
        versionPublicId: 'reconciliation-version-101-v1',
        finalizingPractitionerPublicId: 'practitioner-103',
        signedContentSha256: content.content_sha256,
        reasonCode: 'clinician_finalized',
        sourceEvidenceSha256: '6'.repeat(64),
        actorSystemKey: 'canonical.medication.test',
        idempotencyKey: 'reconciliation-finalize-101',
        eventPublicId: 'reconciliation-outbox-finalize-101',
        occurredAtUtc: '2026-07-28T10:10:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toEqual({
        status: 'applied',
        result: {
          reconciliationPublicId: 'reconciliation-101',
          versionPublicId: 'reconciliation-version-101-v1',
          currentStatus: 'final',
          statusVersion: 2,
          versionNumber: 1,
          itemCount: 1,
        },
      });
      expect(sqlite.prepare(`
        SELECT version_status,signed_content_sha256,finalizing_practitioner_public_id
        FROM canonical_medication_reconciliation_versions
      `).get()).toEqual({
        version_status: 'final',
        signed_content_sha256: content.content_sha256,
        finalizing_practitioner_public_id: 'practitioner-103',
      });
      await expect(finalizeCanonicalMedicationReconciliation(db, {
        tenantId: 'tenant-a',
        reconciliationPublicId: 'reconciliation-101',
        expectedStatusVersion: 1,
        versionPublicId: 'reconciliation-version-101-v1',
        finalizingPractitionerPublicId: 'practitioner-103',
        signedContentSha256: '7'.repeat(64),
        reasonCode: 'stale',
        sourceEvidenceSha256: '8'.repeat(64),
        actorSystemKey: 'canonical.medication.test',
        idempotencyKey: 'reconciliation-finalize-stale',
        eventPublicId: 'reconciliation-outbox-finalize-stale',
        occurredAtUtc: '2026-07-28T10:11:00.000Z',
        businessDate: '2026-07-28',
      })).rejects.toThrow(/version conflict|draft/i);
    } finally { sqlite.close(); }
  });

  it('cancels only an active draft through immutable version/status evidence and supports replay', async () => {
    const { sqlite, db } = harness();
    try {
      await createDraft(db);
      const command = {
        tenantId: 'tenant-a',
        reconciliationPublicId: 'reconciliation-101',
        expectedStatusVersion: 1,
        versionPublicId: 'reconciliation-version-101-v1',
        cancellingPractitionerPublicId: 'practitioner-103',
        reasonCode: 'duplicate_reconciliation',
        sourceEvidenceSha256: '9'.repeat(64),
        actorSystemKey: 'canonical.medication.test',
        idempotencyKey: 'reconciliation-cancel-101',
        eventPublicId: 'reconciliation-outbox-cancel-101',
        occurredAtUtc: '2026-07-28T10:06:00.000Z',
        businessDate: '2026-07-28',
      } as const;
      const first = await cancelCanonicalMedicationReconciliation(db, command);
      const second = await cancelCanonicalMedicationReconciliation(db, command);
      expect(first).toEqual({
        status: 'applied',
        result: {
          reconciliationPublicId: 'reconciliation-101',
          versionPublicId: 'reconciliation-version-101-v1',
          currentStatus: 'cancelled',
          statusVersion: 2,
          versionNumber: 1,
          itemCount: 1,
        },
      });
      expect(second).toEqual({ status: 'replayed', result: first.result });
      expect(sqlite.prepare(`
        SELECT current_status,status_version FROM canonical_medication_reconciliations
      `).get()).toEqual({ current_status: 'cancelled', status_version: 2 });
      expect(sqlite.prepare(`
        SELECT version_status FROM canonical_medication_reconciliation_versions
      `).get()).toEqual({ version_status: 'cancelled' });
    } finally { sqlite.close(); }
  });
});
