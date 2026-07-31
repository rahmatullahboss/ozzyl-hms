import { describe, expect, it } from 'vitest';
import { buildLocalSyncPatientPayload } from '../src/lib/local-sync-patient-payload';

describe('local sync patient payload', () => {
  it('preserves required demographic fields instead of letting cloud updates blank them', () => {
    const payload = buildLocalSyncPatientPayload({
      id: 123,
      tenantId: 'tenant-1',
      name: 'Patient Name',
      fatherHusband: 'Guardian Name',
      address: 'Village, District',
      mobile: '01700000123',
      email: 'patient@example.test',
      patientCode: 'P-000123',
      uhid: 'UHID-123',
      nationalId: 'NID-123',
      dateOfBirth: '1990-01-02',
      gender: 'male',
      age: 36,
      createdAt: '2026-07-11 08:00:00',
    });

    expect(payload).toEqual({
      id: 123,
      tenant_id: 'tenant-1',
      name: 'Patient Name',
      father_husband: 'Guardian Name',
      address: 'Village, District',
      mobile: '01700000123',
      email: 'patient@example.test',
      patient_code: 'P-000123',
      uhid: 'UHID-123',
      national_id: 'NID-123',
      date_of_birth: '1990-01-02',
      gender: 'male',
      age: 36,
      created_at: '2026-07-11 08:00:00',
    });
  });

  it('omits the numeric ID before a new local patient row has been resolved', () => {
    const payload = buildLocalSyncPatientPayload({
      tenantId: 'tenant-1',
      name: 'New Emergency Patient',
      fatherHusband: '',
      address: 'Dhaka',
      patientCode: 'P-000321',
    });

    expect(payload).not.toHaveProperty('id');
    expect(payload).toMatchObject({
      tenant_id: 'tenant-1',
      patient_code: 'P-000321',
      name: 'New Emergency Patient',
    });
  });

  it('uses explicit nulls for optional fields while retaining required empty-string demographics', () => {
    const payload = buildLocalSyncPatientPayload({
      id: 7,
      tenantId: 'tenant-1',
      name: 'Minimal Patient',
      fatherHusband: '',
      address: '',
    });

    expect(payload).toMatchObject({
      id: 7,
      tenant_id: 'tenant-1',
      name: 'Minimal Patient',
      father_husband: '',
      address: '',
      mobile: null,
      email: null,
      patient_code: null,
      uhid: null,
      national_id: null,
      date_of_birth: null,
      gender: null,
      age: null,
      created_at: null,
    });
  });
});
