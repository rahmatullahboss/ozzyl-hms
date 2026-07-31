import { describe, expect, it } from 'vitest';
import {
  bucketPatientAge,
  calculateCompletedAgeAtService,
  resolvePatientAgeAtService,
  type PatientAgeBucket,
} from '../../src/services/dashboard/patientAge';

describe('patient age at service', () => {
  it('treats a newborn on the service date as age zero', () => {
    expect(calculateCompletedAgeAtService('2026-07-28', '2026-07-28')).toBe(0);
    expect(resolvePatientAgeAtService('2026-07-28', '2026-07-28')).toEqual({
      ageAtService: 0,
      bucket: '0_5',
    });
  });

  it.each<[number, PatientAgeBucket]>([
    [5, '0_5'],
    [6, '6_17'],
    [17, '6_17'],
    [18, '18_30'],
    [30, '18_30'],
    [31, '31_45'],
    [45, '31_45'],
    [46, '46_60'],
    [60, '46_60'],
    [61, '61_plus'],
    [105, '61_plus'],
  ])('maps age %i to %s', (age, expected) => {
    expect(bucketPatientAge(age)).toBe(expected);
  });

  it('increments age on the birthday service date', () => {
    expect(calculateCompletedAgeAtService('2000-07-28', '2026-07-28')).toBe(26);
  });

  it('does not increment age the day before the birthday', () => {
    expect(calculateCompletedAgeAtService('2000-07-28', '2026-07-27')).toBe(25);
  });

  it('handles leap-day birthdays in leap years', () => {
    expect(calculateCompletedAgeAtService('2000-02-29', '2024-02-28')).toBe(23);
    expect(calculateCompletedAgeAtService('2000-02-29', '2024-02-29')).toBe(24);
  });

  it('uses 28 February as the leap-day anniversary in non-leap years', () => {
    expect(calculateCompletedAgeAtService('2000-02-29', '2023-02-27')).toBe(22);
    expect(calculateCompletedAgeAtService('2000-02-29', '2023-02-28')).toBe(23);
  });

  it.each([
    null,
    undefined,
    '',
    'not-a-date',
    '2026-02-30',
    '2027-01-01',
  ])('groups invalid, missing, impossible, or future DOB %s as unknown', (dateOfBirth) => {
    expect(calculateCompletedAgeAtService(dateOfBirth, '2026-07-28')).toBeNull();
    expect(resolvePatientAgeAtService(dateOfBirth, '2026-07-28')).toEqual({
      ageAtService: null,
      bucket: 'unknown',
    });
  });

  it.each([null, undefined, '', 'invalid', '2026-02-30'])('rejects invalid service date %s', (serviceDate) => {
    expect(calculateCompletedAgeAtService('2000-01-01', serviceDate)).toBeNull();
  });

  it('never infers a date from free-text age values', () => {
    expect(calculateCompletedAgeAtService('35 years', '2026-07-28')).toBeNull();
    expect(bucketPatientAge(Number.NaN)).toBe('unknown');
    expect(bucketPatientAge(-1)).toBe('unknown');
  });
});
