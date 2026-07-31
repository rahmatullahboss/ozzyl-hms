import { describe, expect, it } from 'vitest';
import {
  buildEmergencyAdmissionPayload,
  emergencyPatientDetailsPath,
} from './emergencyAdmissionFlow';

describe('emergency IPD admission request', () => {
  it('builds an emergency canonical-continuity admission request with a stable idempotency key', () => {
    expect(buildEmergencyAdmissionPayload({
      patientId: 45,
      erPatientNumber: 'ER-000045',
      conditionOnArrival: 'Severe breathing difficulty',
      admissionReason: '',
      department: 'Medicine',
      notes: 'Oxygen started in ER',
      idempotencyKey: 'er-admit-45-12345678',
    })).toEqual({
      patient_id: 45,
      admission_type: 'emergency',
      admit_source: 'emergency',
      is_emergency: true,
      billing_mode: 'emergency',
      admission_reason: 'Severe breathing difficulty',
      department: 'Medicine',
      notes: 'Emergency case ER-000045. Oxygen started in ER',
      idempotencyKey: 'er-admit-45-12345678',
    });
  });

  it('routes detail completion to the same patient master record', () => {
    expect(emergencyPatientDetailsPath(45)).toBe('../patients/45');
  });
});
