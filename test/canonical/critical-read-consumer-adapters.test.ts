import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';
import {
  CriticalReadShadowBatchError,
  observeReceptionPatientContextCriticalReads,
  runCriticalReadShadowBatch,
  type CriticalReadConsumerDependencies,
} from '../../src/lib/canonical/critical-read-consumer-adapters';
import { provideCompensationAccrualRead } from '../../src/lib/canonical/contracts/compensation-accrual-provider';
import type { AdmissionBedProviderProjection } from '../../src/lib/canonical/admission-bed-provider';
import type { AppointmentProviderProjection } from '../../src/lib/canonical/appointment-provider';
import type { EncounterProviderProjection } from '../../src/lib/canonical/encounter-provider';
import type { PatientIdentityProviderProjection } from '../../src/lib/canonical/patient-identity-provider';
import type { PractitionerProviderProjection } from '../../src/lib/canonical/practitioner-provider';

function harness() {
  const h = createSqliteD1Harness();
  h.sqlite.exec(`
    CREATE TABLE canonical_feature_flags (
      tenant_id TEXT NOT NULL,
      flag_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      PRIMARY KEY (tenant_id,flag_key)
    );
    CREATE TABLE canonical_source_mappings (
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      canonical_public_id TEXT,
      source_type TEXT NOT NULL,
      source_public_id TEXT NOT NULL,
      source_table TEXT NOT NULL,
      mapping_status TEXT NOT NULL,
      mapping_version INTEGER NOT NULL,
      PRIMARY KEY (tenant_id,entity_type,source_type,source_public_id)
    );
    CREATE TABLE canonical_reconciliation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      run_public_id TEXT NOT NULL,
      migration_run_id INTEGER,
      domain TEXT NOT NULL,
      reconciliation_type TEXT NOT NULL,
      status TEXT NOT NULL,
      scanned_count INTEGER NOT NULL,
      matched_count INTEGER NOT NULL,
      mismatch_count INTEGER NOT NULL,
      exception_count INTEGER NOT NULL,
      expected_total_minor INTEGER,
      actual_total_minor INTEGER,
      variance_minor INTEGER,
      currency_code TEXT,
      evidence_sha256 TEXT,
      result_summary_json TEXT,
      started_at_utc TEXT NOT NULL,
      completed_at_utc TEXT,
      created_at_utc TEXT,
      updated_at_utc TEXT,
      UNIQUE (tenant_id,run_public_id)
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      canonical_source_key TEXT,
      doctor_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL,
      accrued_date TEXT,
      commission_amount REAL NOT NULL,
      earned_commission_amount REAL NOT NULL,
      doctor_waiver_amount REAL NOT NULL,
      payable_commission_amount REAL NOT NULL,
      paid_amount REAL NOT NULL,
      balance_amount REAL NOT NULL
    );
    CREATE TABLE canonical_compensation_accruals (
      tenant_id TEXT NOT NULL,
      accrual_public_id TEXT NOT NULL,
      practitioner_public_id TEXT,
      practitioner_role TEXT NOT NULL,
      accrual_stage TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      earned_minor INTEGER NOT NULL,
      adjusted_minor INTEGER NOT NULL,
      settled_minor INTEGER NOT NULL,
      payable_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      business_date TEXT NOT NULL,
      PRIMARY KEY (tenant_id,accrual_public_id)
    );
    INSERT INTO canonical_feature_flags VALUES (
      'tenant-a','canonical_compensation_accrual_provider_v1','shadow',1
    );
    INSERT INTO doctor_commission_accruals VALUES (
      6,'tenant-a','acc-source-6',7,'lab_test','approved','2026-07-30',
      120.50,120.50,20.25,100.25,0,100.25
    );
    INSERT INTO canonical_source_mappings VALUES (
      'tenant-a','compensation_accrual','compacc-6','legacy_doctor_commission_accrual',
      'acc-source-6','doctor_commission_accruals','mapped',1
    );
    INSERT INTO canonical_compensation_accruals VALUES (
      'tenant-a','compacc-6','pract-2','performing','commission','BDT',
      12050,2025,0,10025,'accrued','2026-07-30'
    );
  `);
  return h;
}

function dependencies(encounterParity = true): CriticalReadConsumerDependencies {
  const patient = {
    mode: 'shadow',
    legacy: { legacyPatientId: 1, patientCode: 'P-1', uhid: null, name: 'Sensitive' },
    relationship: { patientLinkPublicId: 'ptl-1', legacyPatientId: 1 },
    parity: {
      ok: true,
      exactTenantPatientLink: true,
      legacyPatientAgreement: true,
      activeRelationship: true,
      effectiveInterval: true,
      positiveVersion: true,
    },
  } as PatientIdentityProviderProjection;
  const practitioner = {
    mode: 'shadow',
    practitionerPublicId: 'pract-2',
    legacy: { sourceType: 'legacy_doctor', legacyId: 2 },
    displayName: 'Sensitive Doctor',
    parity: {
      ok: true,
      mapping: true,
      kind: true,
      status: true,
      identifier: true,
      specialties: true,
      departments: true,
      userLink: true,
      employeeLink: true,
    },
  } as PractitionerProviderProjection;
  const appointment = {
    mode: 'shadow',
    appointmentPublicId: 'appt-3',
    legacy: { sourceType: 'legacy_appointment', legacyId: 3 },
    parity: {
      ok: true,
      mapping: true,
      patientLink: true,
      practitioner: true,
      kind: true,
      modality: true,
      channel: true,
      interval: true,
      businessDate: true,
      token: true,
      status: true,
      lineage: true,
      encounterLink: true,
    },
  } as AppointmentProviderProjection;
  const encounter = {
    mode: 'shadow',
    encounterPublicId: 'enc-4',
    legacy: { sourceType: 'legacy_visit', legacyId: 4 },
    parity: {
      ok: encounterParity,
      mapping: true,
      patientLink: true,
      practitioner: true,
      type: true,
      status: encounterParity,
      interval: true,
      participants: true,
      careLocation: true,
    },
  } as EncounterProviderProjection;
  const admission = {
    mode: 'shadow',
    admissionPublicId: 'adm-5',
    legacy: { legacyAdmissionId: 5, legacyPatientId: 1, legacyBedId: 9, legacyPatientBedInfoId: 10 },
    parity: {
      ok: true,
      mapping: true,
      patientLink: true,
      identity: true,
      lifecycle: true,
      latestEvent: true,
      openStayCardinality: true,
      bedMapping: true,
      derivedOccupancy: true,
      bedOperationalState: true,
    },
  } as AdmissionBedProviderProjection;

  return {
    identity: {
      patient: async () => patient,
      practitioner: async () => practitioner,
      appointment: async () => appointment,
      encounter: async () => encounter,
      admissionBed: async () => admission,
    },
    compensation: provideCompensationAccrualRead,
  };
}

const input = {
  tenantId: 'tenant-a',
  observedAtUtc: '2026-07-30T00:00:00.000Z',
  latencyBudgetMs: 100,
  buildSha: 'build-040c',
  records: [
    { provider: 'patient_identity' as const, legacyId: 1, elapsedMs: 1 },
    { provider: 'practitioner' as const, legacyId: 2, elapsedMs: 2 },
    { provider: 'appointment' as const, legacyId: 3, timezone: 'Asia/Dhaka', elapsedMs: 3 },
    { provider: 'encounter' as const, legacyId: 4, elapsedMs: 4 },
    { provider: 'admission_bed' as const, legacyId: 5, elapsedMs: 5 },
    { provider: 'compensation_accrual' as const, legacyId: 6, elapsedMs: 6 },
  ],
};

describe('CDB-V1-040C critical read consumer adapters', () => {
  it('runs six bounded shadow scopes with exact row keys, zero variance and legacy rollback', async () => {
    const h = harness();
    const result = await runCriticalReadShadowBatch(h.db as never, input, dependencies());
    expect(result).toMatchObject({
      checkpoint: 'CDB-V1-040C',
      recordCount: 6,
      parity: true,
      varianceIds: [],
      rollbackMode: 'legacy',
    });
    expect(result.rows.map((row) => row.provider)).toEqual([
      'patient_identity',
      'practitioner',
      'appointment',
      'encounter',
      'admission_bed',
      'compensation_accrual',
    ]);
    expect(result.rows.every((row) => row.canonicalRowKey.length > 0)).toBe(true);

    const receipts = h.sqlite.prepare(`
      SELECT status,result_summary_json
      FROM canonical_reconciliation_runs
      ORDER BY id
    `).all() as Array<{ status: string; result_summary_json: string }>;
    expect(receipts).toHaveLength(6);
    expect(receipts.every((row) => row.status === 'passed')).toBe(true);
    expect(JSON.stringify(receipts)).toContain('build-040c');
    expect(JSON.stringify(receipts)).not.toMatch(/Sensitive|Sensitive Doctor/);
  });

  it('rejects duplicate provider/source scopes before executing a provider', async () => {
    const h = harness();
    await expect(runCriticalReadShadowBatch(h.db as never, {
      ...input,
      records: [input.records[0], input.records[0]],
    }, dependencies())).rejects.toMatchObject({ code: 'DUPLICATE_SCOPE' });
  });

  it('fails closed when any identity/episode comparison has unexplained variance', async () => {
    const h = harness();
    await expect(runCriticalReadShadowBatch(h.db as never, {
      ...input,
      records: [input.records[3]],
    }, dependencies(false))).rejects.toBeInstanceOf(CriticalReadShadowBatchError);
    await expect(runCriticalReadShadowBatch(h.db as never, {
      ...input,
      records: [input.records[3]],
    }, dependencies(false))).rejects.toMatchObject({ code: 'UNEXPLAINED_VARIANCE' });
  });

  it('builds the bounded Reception patient-context shadow scopes from enabled provider modes', async () => {
    const h = harness();
    h.sqlite.exec(`
      INSERT INTO canonical_feature_flags VALUES ('tenant-a','canonical_patient_identity_provider_v1','shadow',1);
      INSERT INTO canonical_feature_flags VALUES ('tenant-a','canonical_practitioner_provider_v1','shadow',1);
      INSERT INTO canonical_feature_flags VALUES ('tenant-a','canonical_appointment_provider_v1','shadow',1);
      INSERT INTO canonical_feature_flags VALUES ('tenant-a','canonical_encounter_provider_v1','shadow',1);
      INSERT INTO canonical_feature_flags VALUES ('tenant-a','canonical_admission_bed_provider_v1','shadow',1);
    `);
    const result = await observeReceptionPatientContextCriticalReads(h.db as never, {
      tenantId: 'tenant-a',
      patientId: 1,
      visits: [{ id: 4, doctorId: 2, appointmentId: 3 }],
      activeAdmission: { id: 5, doctorId: 2 },
      timezone: 'Asia/Dhaka',
      observedAtUtc: '2026-07-30T00:00:00.000Z',
      latencyBudgetMs: 100,
      buildSha: 'build-040c',
    }, dependencies());
    expect(result?.recordCount).toBe(5);
    expect(result?.rows.map((row) => row.provider)).toEqual([
      'patient_identity', 'practitioner', 'appointment', 'encounter', 'admission_bed',
    ]);
  });

  it('blocks Canonical response promotion for the legacy Reception patient-context contract', async () => {
    const h = harness();
    h.sqlite.exec(`
      INSERT INTO canonical_feature_flags VALUES ('tenant-a','canonical_patient_identity_provider_v1','canonical',1);
    `);
    await expect(observeReceptionPatientContextCriticalReads(h.db as never, {
      tenantId: 'tenant-a',
      patientId: 1,
      visits: [],
      activeAdmission: null,
      timezone: 'Asia/Dhaka',
      observedAtUtc: '2026-07-30T00:00:00.000Z',
      latencyBudgetMs: 100,
      buildSha: 'build-040c',
    }, dependencies())).rejects.toMatchObject({ code: 'CANONICAL_MODE_BLOCKED' });
  });
});
