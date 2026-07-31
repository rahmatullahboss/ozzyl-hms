import { describe, expect, it } from 'vitest';
import { formatDoctorDisplayName, stripDoctorPrefix } from './doctorName';

describe('doctor name display normalization', () => {
  it('adds exactly one doctor prefix', () => {
    expect(formatDoctorDisplayName('Dr. Rahman')).toBe('Dr. Rahman');
    expect(formatDoctorDisplayName('Dr Dr. Rahman')).toBe('Dr. Rahman');
    expect(formatDoctorDisplayName('Dr. Dr Rahman')).toBe('Dr. Rahman');
    expect(formatDoctorDisplayName('Rahman')).toBe('Dr. Rahman');
  });

  it('returns null for a missing or prefix-only name', () => {
    expect(formatDoctorDisplayName(null)).toBeNull();
    expect(stripDoctorPrefix('Dr.')).toBeNull();
  });
});
