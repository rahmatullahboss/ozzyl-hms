import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LOCAL_SERVER_CORE_OUTBOX_GAPS,
  LOCAL_SERVER_DURABLE_STAGED_PATIENT_WRITE_PATHS,
  LOCAL_SERVER_ENTITY_ID_MAPPING_GAPS,
  LOCAL_SERVER_EXPLICIT_OUTBOX_ENTITY_TYPES,
  LOCAL_SERVER_NON_ATOMIC_OUTBOX_ENTITY_TYPES,
  LOCAL_SERVER_PARTIAL_WRITE_PATH_COVERAGE_TYPES,
  LOCAL_SERVER_ATOMIC_PATIENT_WRITE_PATHS,
  LOCAL_SERVER_PATIENT_WRITE_PATH_GAPS,
  LOCAL_SYNC_CLOUD_APPLY_ENTITY_TYPES,
  supportsLocalSyncCloudApply,
} from '../src/lib/local-sync-coverage';

const syncSource = readFileSync('src/routes/sync.ts', 'utf8');
const roundSource = readFileSync('src/lib/ipd-doctor-rounds.ts', 'utf8');
const medicineSource = readFileSync('src/routes/tenant/ePrescribing.ts', 'utf8');
const patientSource = readFileSync('src/routes/tenant/patients.ts', 'utf8');

describe('hospital local-server sync coverage registry', () => {
  it('requires every explicit local outbox emitter to have a cloud apply mapper', () => {
    for (const entityType of LOCAL_SERVER_EXPLICIT_OUTBOX_ENTITY_TYPES) {
      expect(supportsLocalSyncCloudApply(entityType)).toBe(true);
      expect(LOCAL_SYNC_CLOUD_APPLY_ENTITY_TYPES).toContain(entityType);
    }
  });

  it('keeps declared core write-path gaps out of the explicit emitter list', () => {
    for (const entityType of LOCAL_SERVER_CORE_OUTBOX_GAPS) {
      expect(LOCAL_SERVER_EXPLICIT_OUTBOX_ENTITY_TYPES).not.toContain(entityType as never);
    }
  });

  it('keeps the cloud mapper source aligned with the registry', () => {
    for (const entityType of LOCAL_SYNC_CLOUD_APPLY_ENTITY_TYPES) {
      expect(syncSource).toContain(`event.entityType === '${entityType}'`);
    }
    expect(syncSource).toContain('supportsLocalSyncCloudApply(event.entityType)');
  });

  it('tracks known non-atomic emitters and numeric-ID mapping gaps separately from missing emitters', () => {
    expect(LOCAL_SERVER_NON_ATOMIC_OUTBOX_ENTITY_TYPES).toEqual([
      'patients',
      'global_patient_identity',
      'patient_health_links',
    ]);
    expect(LOCAL_SERVER_PARTIAL_WRITE_PATH_COVERAGE_TYPES).toEqual(['patients']);
    expect(LOCAL_SERVER_ENTITY_ID_MAPPING_GAPS).toEqual(expect.arrayContaining([
      'appointments',
      'bills',
      'payments',
    ]));
    expect(LOCAL_SERVER_ENTITY_ID_MAPPING_GAPS).not.toContain('patients');
    for (const entityType of LOCAL_SERVER_NON_ATOMIC_OUTBOX_ENTITY_TYPES) {
      expect(LOCAL_SERVER_EXPLICIT_OUTBOX_ENTITY_TYPES).toContain(entityType);
    }
  });

  it('publishes atomic patient write paths separately from remaining patient route gaps', () => {
    expect(LOCAL_SERVER_ATOMIC_PATIENT_WRITE_PATHS).toEqual(expect.arrayContaining([
      'patients:update',
      'emergency:create-patient',
      'patient-portal:register',
      'referrals:accept-create-patient',
      'reception:quick-admit',
    ]));
    expect(LOCAL_SERVER_DURABLE_STAGED_PATIENT_WRITE_PATHS).toEqual([
      'patients:link-global',
      'referrals:accept-health-link',
    ]);
    expect(LOCAL_SERVER_PATIENT_WRITE_PATH_GAPS).toEqual(expect.arrayContaining([
      'patients:create-global-link',
      'marketplace-patient:create',
      'fhir:patient-import',
      'health-record:patient-import',
      'settings-import-export:patient-import',
    ]));
  });

  it('finds the currently declared explicit emitters at their write boundaries', () => {
    expect(roundSource).toContain("'ipd_doctor_round'");
    expect(roundSource).toContain("'billing_provisional_doctor_round'");
    expect(medicineSource).toContain("entityType: 'medicine_catalog_entry'");
    expect(patientSource).toContain("entityType: 'patients'");
    expect(patientSource).toContain("entityType: 'global_patient_identity'");
    expect(patientSource).toContain("entityType: 'patient_health_links'");
  });
});
