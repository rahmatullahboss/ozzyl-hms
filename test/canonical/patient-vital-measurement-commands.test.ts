import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  correctCanonicalVitalObservationSet,
  enterCanonicalVitalObservationSetInError,
  recordCanonicalVitalObservationSet,
  reviewCanonicalVitalObservationSet,
  type RecordCanonicalVitalObservationSetInput,
} from '../../src/lib/canonical/commands/manage-vital-observations';

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
    'migrations/0556_canonical_patient_vital_measurement.sql',
  ]) sqlite.exec(readFileSync(migration, 'utf8'));
  sqlite.exec(`
    CREATE TABLE legacy_vital_compat (
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
  for (const [tenantId, patientLinkPublicId, legacyPatientId, hash] of [
    ['tenant-a', 'patient-link-101', 101, '1'],
    ['tenant-b', 'patient-link-201', 201, '2'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_tenant_patient_links (
        tenant_id,patient_link_public_id,legacy_patient_id,link_status,
        verification_level,evidence_type,evidence_sha256,effective_from_utc,version
      ) VALUES (?, ?, ?, 'unlinked', 'unverified', 'no_link_placeholder', ?, ?, 1)
    `).run(tenantId, patientLinkPublicId, legacyPatientId, hash.repeat(64), '2026-07-28T08:00:00.000Z');
  }
  for (const [tenantId, practitionerId, name, hash] of [
    ['tenant-a', 'practitioner-101', 'Recorder', '3'],
    ['tenant-a', 'practitioner-102', 'Reviewer', '4'],
    ['tenant-b', 'practitioner-201', 'Other tenant', '5'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status,
        version,source_evidence_sha256
      ) VALUES (?,?,'internal',?,'active',1,?)
    `).run(tenantId, practitionerId, name, hash.repeat(64));
  }
  for (const [tenantId, encounterId, patientId, patientLinkId, hash] of [
    ['tenant-a', 'encounter-101', 101, 'patient-link-101', '6'],
    ['tenant-b', 'encounter-201', 201, 'patient-link-201', '7'],
  ] as const) {
    sqlite.prepare(`
      INSERT INTO canonical_encounters (
        tenant_id,encounter_public_id,legacy_patient_id,patient_link_public_id,
        encounter_type,status,encounter_version,source_kind,started_at_utc,source_evidence_sha256
      ) VALUES (?,?,?,?, 'outpatient','in_progress',1,'runtime',?,?)
    `).run(tenantId, encounterId, patientId, patientLinkId, '2026-07-28T08:30:00.000Z', hash.repeat(64));
  }
}

function recordInput(
  overrides: Partial<RecordCanonicalVitalObservationSetInput> = {},
): RecordCanonicalVitalObservationSetInput {
  return {
    tenantId: 'tenant-a',
    observationSetPublicId: 'vital-set-101',
    patientLinkPublicId: 'patient-link-101',
    encounterPublicId: 'encounter-101',
    practitionerPublicId: 'practitioner-101',
    sourceKind: 'practitioner_entered',
    effectiveAtUtc: '2026-07-28T09:00:00.000Z',
    recordedAtUtc: '2026-07-28T09:01:00.000Z',
    components: [
      {
        componentPublicId: 'vital-temperature-101',
        measurementCode: 'body_temperature',
        numericValue: 98.6,
        unitCode: '[degF]',
        sourceEvidenceSha256: '8'.repeat(64),
      },
      {
        componentPublicId: 'vital-bp-systolic-101',
        measurementCode: 'blood_pressure_systolic',
        numericValue: 120,
        unitCode: 'mm[Hg]',
        sourceEvidenceSha256: '9'.repeat(64),
      },
      {
        componentPublicId: 'vital-bp-diastolic-101',
        measurementCode: 'blood_pressure_diastolic',
        numericValue: 80,
        unitCode: 'mm[Hg]',
        sourceEvidenceSha256: 'a'.repeat(64),
      },
      {
        componentPublicId: 'vital-weight-101',
        measurementCode: 'body_weight',
        numericValue: 72,
        unitCode: 'kg',
        sourceEvidenceSha256: 'b'.repeat(64),
      },
      {
        componentPublicId: 'vital-height-101',
        measurementCode: 'body_height',
        numericValue: 180,
        unitCode: 'cm',
        sourceEvidenceSha256: 'c'.repeat(64),
      },
    ],
    sourceType: 'clinical_vitals',
    sourcePublicId: '501',
    sourceTable: 'clinical_vitals',
    sourceEvidenceSha256: 'd'.repeat(64),
    actorSystemKey: 'canonical.vitals.test',
    idempotencyKey: 'vital-record-101',
    eventPublicId: 'vital-outbox-record-101',
    occurredAtUtc: '2026-07-28T09:01:00.000Z',
    businessDate: '2026-07-28',
    ...overrides,
  };
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
}

async function recordAndVerify(db: CanonicalBatchDatabase): Promise<void> {
  await recordCanonicalVitalObservationSet(db, recordInput());
  await reviewCanonicalVitalObservationSet(db, {
    tenantId: 'tenant-a',
    observationSetPublicId: 'vital-set-101',
    expectedVersion: 1,
    reviewerPractitionerPublicId: 'practitioner-102',
    toReviewStatus: 'verified',
    reasonCode: 'clinician_verified',
    sourceEvidenceSha256: 'e'.repeat(64),
    actorSystemKey: 'canonical.vitals.test',
    idempotencyKey: 'vital-review-101',
    eventPublicId: 'vital-outbox-review-101',
    occurredAtUtc: '2026-07-28T09:02:00.000Z',
    businessDate: '2026-07-28',
  });
}

describe('canonical patient vital measurement commands', () => {
  it('atomically records typed components, Fahrenheit conversion, derived BMI, mapping, compatibility write, and PHI-minimised outbox', async () => {
    const { sqlite, db } = harness();
    try {
      const compatibility = db.prepare(`INSERT INTO legacy_vital_compat(marker) VALUES (?)`).bind('clinical-vital-501');
      await expect(recordCanonicalVitalObservationSet(db, recordInput(), {
        authoritativeStatements: [compatibility],
      })).resolves.toEqual({
        status: 'applied',
        result: {
          observationSetPublicId: 'vital-set-101',
          reviewStatus: 'pending_review',
          statusVersion: 1,
          componentCount: 6,
          derivedComponentCount: 1,
        },
      });

      expect(count(sqlite, 'canonical_vital_observation_sets')).toBe(1);
      expect(count(sqlite, 'canonical_vital_observation_components')).toBe(6);
      expect(count(sqlite, 'canonical_vital_observation_status_events')).toBe(1);
      expect(count(sqlite, 'canonical_source_mappings')).toBe(1);
      expect(count(sqlite, 'legacy_vital_compat')).toBe(1);
      expect(sqlite.prepare(`
        SELECT numeric_value,canonical_unit_code,source_numeric_value,source_unit_code
        FROM canonical_vital_observation_components
        WHERE measurement_code='body_temperature'
      `).get()).toEqual({
        numeric_value: 37,
        canonical_unit_code: 'Cel',
        source_numeric_value: 98.6,
        source_unit_code: '[degF]',
      });
      const bmi = sqlite.prepare(`
        SELECT numeric_value,canonical_unit_code,is_derived,derivation_formula_key,derivation_formula_version
        FROM canonical_vital_observation_components
        WHERE measurement_code='body_mass_index'
      `).get() as Record<string, unknown>;
      expect(Number(bmi.numeric_value)).toBeCloseTo(22.22, 2);
      expect(bmi).toMatchObject({
        canonical_unit_code: 'kg/m2',
        is_derived: 1,
        derivation_formula_key: 'bmi_weight_kg_height_m_v1',
        derivation_formula_version: '1',
      });
      const outbox = sqlite.prepare(`SELECT event_type,payload_json FROM canonical_outbox_events`).get() as Record<string, string>;
      expect(outbox.event_type).toBe('canonical.vital-observation.recorded');
      for (const forbidden of [
        'patient-link-101', 'encounter-101', 'practitioner-101', 'clinical_vitals', '98.6',
      ]) expect(outbox.payload_json).not.toContain(forbidden);
    } finally {
      sqlite.close();
    }
  });

  it('uses deterministic IDs, replays before validation, rejects conflicting replay, and rolls back the whole batch', async () => {
    const { sqlite, db } = harness();
    try {
      const deterministic = recordInput({
        observationSetPublicId: undefined,
        eventPublicId: undefined,
        components: recordInput().components.map((component) => ({ ...component, componentPublicId: undefined })),
      });
      const first = await recordCanonicalVitalObservationSet(db, deterministic);
      const second = await recordCanonicalVitalObservationSet(db, deterministic);
      expect(first.status).toBe('applied');
      expect(second).toEqual({ status: 'replayed', result: first.result });
      expect(first.result.observationSetPublicId).toMatch(/^vitalset_/);
      await expect(recordCanonicalVitalObservationSet(db, {
        ...deterministic,
        recordedAtUtc: '2026-07-28T09:02:00.000Z',
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);

      const rollback = harness();
      try {
        const compatibility = rollback.db.prepare(`INSERT INTO legacy_vital_compat(marker) VALUES (?)`).bind('must-rollback');
        await expect(recordCanonicalVitalObservationSet(rollback.db, recordInput({
          idempotencyKey: 'vital-record-rollback',
          eventPublicId: 'vital-outbox-record-rollback',
        }), {
          authoritativeStatements: [compatibility, rollback.db.prepare('INSERT INTO missing_table(x) VALUES (1)')],
        })).rejects.toThrow();
        expect(count(rollback.sqlite, 'canonical_vital_observation_sets')).toBe(0);
        expect(count(rollback.sqlite, 'canonical_outbox_events')).toBe(0);
        expect(count(rollback.sqlite, 'legacy_vital_compat')).toBe(0);
      } finally {
        rollback.sqlite.close();
      }
    } finally {
      sqlite.close();
    }
  });

  it('fails closed for cross-tenant scope, incomplete BP, invalid units, and manual BMI input', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(recordCanonicalVitalObservationSet(db, recordInput({
        encounterPublicId: 'encounter-201',
      }))).rejects.toThrow(/encounter not found|mismatch/i);
      await expect(recordCanonicalVitalObservationSet(db, recordInput({
        idempotencyKey: 'vital-record-bp-incomplete',
        eventPublicId: 'vital-outbox-bp-incomplete',
        components: recordInput().components.filter((component) => component.measurementCode !== 'blood_pressure_diastolic'),
      }))).rejects.toThrow(/paired blood pressure/i);
      await expect(recordCanonicalVitalObservationSet(db, recordInput({
        idempotencyKey: 'vital-record-unit-invalid',
        eventPublicId: 'vital-outbox-unit-invalid',
        components: recordInput().components.map((component) => component.measurementCode === 'body_weight'
          ? { ...component, unitCode: 'lb' }
          : component),
      }))).rejects.toThrow(/unit/i);
      await expect(recordCanonicalVitalObservationSet(db, recordInput({
        idempotencyKey: 'vital-record-manual-bmi',
        eventPublicId: 'vital-outbox-manual-bmi',
        components: [
          ...recordInput().components,
          {
            measurementCode: 'body_mass_index',
            numericValue: 22,
            unitCode: 'kg/m2',
            sourceEvidenceSha256: 'f'.repeat(64),
          },
        ],
      }))).rejects.toThrow(/BMI.*derived/i);
    } finally {
      sqlite.close();
    }
  });

  it('reviews with optimistic versioning and matching immutable status evidence', async () => {
    const { sqlite, db } = harness();
    try {
      await recordCanonicalVitalObservationSet(db, recordInput());
      await expect(reviewCanonicalVitalObservationSet(db, {
        tenantId: 'tenant-a',
        observationSetPublicId: 'vital-set-101',
        expectedVersion: 1,
        reviewerPractitionerPublicId: 'practitioner-102',
        toReviewStatus: 'verified',
        reasonCode: 'clinician_verified',
        sourceEvidenceSha256: 'e'.repeat(64),
        actorSystemKey: 'canonical.vitals.test',
        idempotencyKey: 'vital-review-101',
        eventPublicId: 'vital-outbox-review-101',
        occurredAtUtc: '2026-07-28T09:02:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toEqual({
        status: 'applied',
        result: {
          observationSetPublicId: 'vital-set-101',
          reviewStatus: 'verified',
          statusVersion: 2,
        },
      });
      expect(sqlite.prepare(`
        SELECT review_status,status_version FROM canonical_vital_observation_sets
        WHERE observation_set_public_id='vital-set-101'
      `).get()).toEqual({ review_status: 'verified', status_version: 2 });
      expect(count(sqlite, 'canonical_vital_observation_status_events')).toBe(2);
      await expect(reviewCanonicalVitalObservationSet(db, {
        tenantId: 'tenant-a',
        observationSetPublicId: 'vital-set-101',
        expectedVersion: 1,
        reviewerPractitionerPublicId: 'practitioner-102',
        toReviewStatus: 'rejected',
        reasonCode: 'wrong_version',
        sourceEvidenceSha256: 'f'.repeat(64),
        actorSystemKey: 'canonical.vitals.test',
        idempotencyKey: 'vital-review-stale',
        eventPublicId: 'vital-outbox-review-stale',
        occurredAtUtc: '2026-07-28T09:03:00.000Z',
        businessDate: '2026-07-28',
      })).rejects.toThrow(/version conflict/i);
    } finally {
      sqlite.close();
    }
  });

  it('corrects by creating a replacement set and superseding the original without rewriting components', async () => {
    const { sqlite, db } = harness();
    try {
      await recordAndVerify(db);
      const originalTemperature = sqlite.prepare(`
        SELECT numeric_value FROM canonical_vital_observation_components
        WHERE observation_set_public_id='vital-set-101' AND measurement_code='body_temperature'
      `).get();
      await expect(correctCanonicalVitalObservationSet(db, {
        tenantId: 'tenant-a',
        observationSetPublicId: 'vital-set-101',
        expectedVersion: 2,
        replacementObservationSetPublicId: 'vital-set-102',
        correctingPractitionerPublicId: 'practitioner-102',
        effectiveAtUtc: '2026-07-28T09:00:00.000Z',
        recordedAtUtc: '2026-07-28T09:04:00.000Z',
        components: recordInput().components.map((component) => component.measurementCode === 'body_temperature'
          ? { ...component, componentPublicId: 'vital-temperature-102', numericValue: 99.5 }
          : { ...component, componentPublicId: `${component.componentPublicId}-replacement` }),
        sourceType: 'clinical_vitals_correction',
        sourcePublicId: '501:correction:1',
        sourceTable: 'clinical_vitals',
        sourceEvidenceSha256: '1'.repeat(64),
        reasonCode: 'corrected_temperature',
        actorSystemKey: 'canonical.vitals.test',
        idempotencyKey: 'vital-correct-101',
        eventPublicId: 'vital-outbox-correct-101',
        occurredAtUtc: '2026-07-28T09:04:00.000Z',
        businessDate: '2026-07-28',
      })).resolves.toEqual({
        status: 'applied',
        result: {
          observationSetPublicId: 'vital-set-101',
          reviewStatus: 'superseded',
          statusVersion: 3,
          replacementObservationSetPublicId: 'vital-set-102',
          replacementReviewStatus: 'pending_review',
          replacementStatusVersion: 1,
        },
      });
      expect(sqlite.prepare(`
        SELECT review_status,status_version FROM canonical_vital_observation_sets
        WHERE observation_set_public_id='vital-set-101'
      `).get()).toEqual({ review_status: 'superseded', status_version: 3 });
      expect(sqlite.prepare(`
        SELECT review_status,status_version,supersedes_observation_set_public_id
        FROM canonical_vital_observation_sets
        WHERE observation_set_public_id='vital-set-102'
      `).get()).toEqual({
        review_status: 'pending_review',
        status_version: 1,
        supersedes_observation_set_public_id: 'vital-set-101',
      });
      expect(sqlite.prepare(`
        SELECT numeric_value FROM canonical_vital_observation_components
        WHERE observation_set_public_id='vital-set-101' AND measurement_code='body_temperature'
      `).get()).toEqual(originalTemperature);
      expect(count(sqlite, 'canonical_vital_observation_status_events')).toBe(4);
    } finally {
      sqlite.close();
    }
  });

  it('enters an observation in error through an immutable event and supports replay after terminal state', async () => {
    const { sqlite, db } = harness();
    try {
      await recordCanonicalVitalObservationSet(db, recordInput());
      const command = {
        tenantId: 'tenant-a',
        observationSetPublicId: 'vital-set-101',
        expectedVersion: 1,
        reasonCode: 'wrong_patient_chart',
        sourceEvidenceSha256: '2'.repeat(64),
        actorSystemKey: 'canonical.vitals.test',
        idempotencyKey: 'vital-error-101',
        eventPublicId: 'vital-outbox-error-101',
        occurredAtUtc: '2026-07-28T09:03:00.000Z',
        businessDate: '2026-07-28',
      } as const;
      const first = await enterCanonicalVitalObservationSetInError(db, command);
      const second = await enterCanonicalVitalObservationSetInError(db, command);
      expect(first).toEqual({
        status: 'applied',
        result: {
          observationSetPublicId: 'vital-set-101',
          reviewStatus: 'entered_in_error',
          statusVersion: 2,
        },
      });
      expect(second).toEqual({ status: 'replayed', result: first.result });
      expect(sqlite.prepare(`
        SELECT review_status,status_version FROM canonical_vital_observation_sets
        WHERE observation_set_public_id='vital-set-101'
      `).get()).toEqual({ review_status: 'entered_in_error', status_version: 2 });
      expect(count(sqlite, 'canonical_vital_observation_status_events')).toBe(2);
    } finally {
      sqlite.close();
    }
  });
});
