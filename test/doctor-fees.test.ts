import { describe, expect, it } from 'vitest';
import { normalizeConsultationFee } from '../src/lib/doctor-fees';

describe('normalizeConsultationFee', () => {
  it('keeps taka-denominated consultation fees unchanged', () => {
    expect(normalizeConsultationFee(500)).toBe(500);
    expect(normalizeConsultationFee('1000')).toBe(1000);
  });

  it('converts legacy minor-unit consultation fees to taka', () => {
    expect(normalizeConsultationFee(50000)).toBe(500);
    expect(normalizeConsultationFee(100000)).toBe(1000);
  });

  it('normalizes invalid fees to zero', () => {
    expect(normalizeConsultationFee(null)).toBe(0);
    expect(normalizeConsultationFee(-500)).toBe(0);
    expect(normalizeConsultationFee(Number.NaN)).toBe(0);
  });
});
