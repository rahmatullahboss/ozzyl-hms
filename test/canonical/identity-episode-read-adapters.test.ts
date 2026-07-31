import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  readAdmissionBedAdapter,
  readAppointmentAdapter,
  readEncounterAdapter,
  readPatientIdentityAdapter,
  readPractitionerAdapter,
  type IdentityEpisodeReadAdapterDependencies,
} from '../../src/lib/canonical/identity-episode-read-adapters';
import type { AdmissionBedProviderProjection } from '../../src/lib/canonical/admission-bed-provider';
import type { AppointmentProviderProjection } from '../../src/lib/canonical/appointment-provider';
import type { EncounterProviderProjection } from '../../src/lib/canonical/encounter-provider';
import type { PatientIdentityProviderProjection } from '../../src/lib/canonical/patient-identity-provider';
import type { PractitionerProviderProjection } from '../../src/lib/canonical/practitioner-provider';

const db = { prepare: () => { throw new Error('database should be resolved by fake provider'); } };
const evidence = {
  observedAtUtc: '2026-07-27T00:00:00.000Z',
  elapsedMs: 10,
  errorCount: 0,
  latencyBudgetMs: 100,
  acceptedExceptionIds: [],
};

function dependencies(modes: {
  patient?: 'legacy' | 'shadow' | 'canonical';
  practitioner?: 'legacy' | 'shadow' | 'canonical';
  appointment?: 'legacy' | 'shadow' | 'canonical';
  encounter?: 'legacy' | 'shadow' | 'canonical';
  admission?: 'legacy' | 'shadow' | 'canonical';
} = {}): IdentityEpisodeReadAdapterDependencies {
  const patient = {
    mode: modes.patient ?? 'legacy',
    legacy: { legacyPatientId: 101, patientCode: 'P-101', uhid: null, name: 'Sensitive Patient' },
    relationship: { patientLinkPublicId: 'ptl-101', legacyPatientId: 101 },
    ...(modes.patient === 'shadow' ? { parity: {
      ok: true, exactTenantPatientLink: true, legacyPatientAgreement: true,
      activeRelationship: true, effectiveInterval: true, positiveVersion: true,
    } } : {}),
  } as PatientIdentityProviderProjection;
  const practitioner = {
    mode: modes.practitioner ?? 'legacy',
    practitionerPublicId: 'practitioner-101',
    legacy: { sourceType: 'legacy_doctor', legacyId: 101 },
    displayName: 'Sensitive Doctor',
    ...(modes.practitioner === 'shadow' ? { parity: {
      ok: true, mapping: true, kind: true, status: true, identifier: true,
      specialties: true, departments: true, userLink: true, employeeLink: true,
    } } : {}),
  } as PractitionerProviderProjection;
  const appointment = {
    mode: modes.appointment ?? 'legacy',
    appointmentPublicId: 'appointment-101',
    legacy: { sourceType: 'legacy_appointment', legacyId: 101 },
    ...(modes.appointment === 'shadow' ? { parity: {
      ok: true, mapping: true, patientLink: true, practitioner: true, kind: true,
      modality: true, channel: true, interval: true, businessDate: true,
      token: true, status: true, lineage: true, encounterLink: true,
    } } : {}),
  } as AppointmentProviderProjection;
  const encounter = {
    mode: modes.encounter ?? 'legacy',
    encounterPublicId: 'encounter-101',
    legacy: { sourceType: 'legacy_visit', legacyId: 101 },
    ...(modes.encounter === 'shadow' ? { parity: {
      ok: true, mapping: true, patientLink: true, practitioner: true, type: true,
      status: true, interval: true, participants: true, careLocation: true,
    } } : {}),
  } as EncounterProviderProjection;
  const admission = {
    mode: modes.admission ?? 'legacy',
    admissionPublicId: 'admission-101',
    legacy: { legacyAdmissionId: 101, legacyPatientId: 101, legacyBedId: 1, legacyPatientBedInfoId: 1 },
    ...(modes.admission === 'shadow' ? { parity: {
      ok: true, mapping: true, patientLink: true, identity: true, lifecycle: true,
      latestEvent: true, openStayCardinality: true, bedMapping: true,
      derivedOccupancy: true, bedOperationalState: true,
    } } : {}),
  } as AdmissionBedProviderProjection;

  return {
    patient: async () => patient,
    practitioner: async () => practitioner,
    appointment: async () => appointment,
    encounter: async () => encounter,
    admissionBed: async () => admission,
  };
}

describe('CDB-113F identity/episode read adapters', () => {
  it('preserves legacy-default provider projections for all five families', async () => {
    const deps = dependencies();
    const results = await Promise.all([
      readPatientIdentityAdapter(db as never, { tenantId: 'tenant-a', legacyPatientId: 101 }, evidence, deps),
      readPractitionerAdapter(db as never, {
        tenantId: 'tenant-a', sourceType: 'legacy_doctor', legacyId: 101,
      }, evidence, deps),
      readAppointmentAdapter(db as never, {
        tenantId: 'tenant-a', sourceType: 'legacy_appointment', legacyId: 101, timezone: 'Asia/Dhaka',
      }, evidence, deps),
      readEncounterAdapter(db as never, {
        tenantId: 'tenant-a', sourceType: 'legacy_visit', legacyId: 101,
      }, evidence, deps),
      readAdmissionBedAdapter(db as never, {
        tenantId: 'tenant-a', legacyAdmissionId: 101,
      }, evidence, deps),
    ]);

    expect(results.map((result) => result.provider)).toEqual([
      'patient_identity', 'practitioner', 'appointment', 'encounter', 'admission_bed',
    ]);
    expect(results.every((result) => result.projection.mode === 'legacy')).toBe(true);
    expect(results.every((result) => result.shadowEvidence === null)).toBe(true);
    expect(results.every((result) => result.rollbackMode === 'legacy')).toBe(true);
  });

  it('returns PHI-minimised shadow evidence without changing provider projections', async () => {
    const deps = dependencies({
      patient: 'shadow', practitioner: 'shadow', appointment: 'shadow', encounter: 'shadow', admission: 'shadow',
    });
    const results = await Promise.all([
      readPatientIdentityAdapter(db as never, { tenantId: 'tenant-a', legacyPatientId: 101 }, evidence, deps),
      readPractitionerAdapter(db as never, {
        tenantId: 'tenant-a', sourceType: 'legacy_doctor', legacyId: 101,
      }, evidence, deps),
      readAppointmentAdapter(db as never, {
        tenantId: 'tenant-a', sourceType: 'legacy_appointment', legacyId: 101, timezone: 'Asia/Dhaka',
      }, evidence, deps),
      readEncounterAdapter(db as never, {
        tenantId: 'tenant-a', sourceType: 'legacy_visit', legacyId: 101,
      }, evidence, deps),
      readAdmissionBedAdapter(db as never, { tenantId: 'tenant-a', legacyAdmissionId: 101 }, evidence, deps),
    ]);

    expect(results.every((result) => result.projection.mode === 'shadow')).toBe(true);
    expect(results.every((result) => result.shadowEvidence?.parity === true)).toBe(true);
    expect(results.every((result) => result.shadowEvidence?.rollbackMode === 'legacy')).toBe(true);
    const receipts = JSON.stringify(results.map((result) => result.shadowEvidence));
    expect(receipts).not.toMatch(/Sensitive Patient|Sensitive Doctor|tenant-a|Asia\/Dhaka/);
  });

  it('maps provider parity failures to reviewed variance classes', async () => {
    const deps = dependencies({ encounter: 'shadow' });
    deps.encounter = async () => ({
      ...(await dependencies({ encounter: 'shadow' }).encounter(db as never, {
        tenantId: 'tenant-a', sourceType: 'legacy_visit', legacyId: 101,
      })),
      parity: {
        ok: false,
        mapping: false,
        patientLink: true,
        practitioner: true,
        type: true,
        status: false,
        interval: true,
        participants: false,
        careLocation: false,
      },
    } as EncounterProviderProjection);

    const result = await readEncounterAdapter(db as never, {
      tenantId: 'tenant-a', sourceType: 'legacy_visit', legacyId: 101,
    }, evidence, deps);
    expect(result.shadowEvidence?.varianceClasses).toEqual([
      'MAPPING_MISSING', 'STATUS_MISMATCH', 'PARTICIPANT_MISMATCH', 'LOCATION_MISMATCH',
    ]);
    expect(result.shadowEvidence?.criticalUnexplainedVarianceCount).toBe(4);
  });

  it('passes canonical provider failures through without fallback or silent legacy reads', async () => {
    const deps = dependencies({ appointment: 'canonical' });
    deps.appointment = async () => {
      throw new Error('explicit appointment mapping is required for canonical mode');
    };
    await expect(readAppointmentAdapter(db as never, {
      tenantId: 'tenant-a', sourceType: 'legacy_appointment', legacyId: 101, timezone: 'Asia/Dhaka',
    }, evidence, deps)).rejects.toThrow(/mapping is required for canonical mode/);
  });

  it('imports provider modules and contains no private canonical table queries', () => {
    const source = readFileSync('src/lib/canonical/identity-episode-read-adapters.ts', 'utf8');
    for (const module of [
      './patient-identity-provider', './practitioner-provider', './appointment-provider',
      './encounter-provider', './admission-bed-provider',
    ]) expect(source).toContain(module);
    expect(source).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i);
    expect(source).not.toContain('canonical_tenant_patient_links');
    expect(source).not.toContain('canonical_encounters');
    expect(source).not.toContain('canonical_admissions');
  });
});
