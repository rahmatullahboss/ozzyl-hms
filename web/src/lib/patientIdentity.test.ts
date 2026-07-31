import { describe, expect, it } from 'vitest';
import { formatPatientAgeLabel, formatPatientIdentityText } from './patientIdentity';

describe('patient identity formatting', () => {
  it('prefers date-of-birth age and formats identity segments without language-specific prefixes', () => {
    const referenceDate = new Date('2026-07-03T12:00:00+06:00');
    expect(formatPatientAgeLabel(99, '2025-06-03', referenceDate)).toBe('1y 1m');
    expect(formatPatientIdentityText({
      id: 2,
      patient_code: 'P-000002',
      age: 99,
      date_of_birth: '2025-06-03',
      mobile: '01700000000',
    }, undefined, referenceDate)).toBe('P-000002 · 1y 1m · 01700000000');
  });

  it('uses stored age when date of birth is missing and omits unavailable segments', () => {
    expect(formatPatientIdentityText({
      id: 1,
      patient_code: 'P-000001',
      age: 32,
      mobile: '01739416661',
    })).toBe('P-000001 · 32y · 01739416661');
    expect(formatPatientIdentityText({ id: 3 })).toBe('Patient #3');
  });
});
