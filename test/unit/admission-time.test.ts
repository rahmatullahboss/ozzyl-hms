import { describe, expect, it } from 'vitest';
import { normalizeLegacyAdmissionInstantUtc } from '../../src/lib/admission-time';

describe('normalizeLegacyAdmissionInstantUtc', () => {
  it('treats near-equal naive admission and created timestamps as UTC-naive D1 values', () => {
    expect(normalizeLegacyAdmissionInstantUtc({
      admissionDate: '2026-07-29 05:46:53',
      createdAt: '2026-07-29 05:46:54',
      naiveSemantics: 'infer',
    })).toBe('2026-07-29T05:46:53.000Z');
  });

  it('treats a naive admission six hours ahead of created_at as Bangladesh wall time', () => {
    expect(normalizeLegacyAdmissionInstantUtc({
      admissionDate: '2026-07-29 11:46:53',
      createdAt: '2026-07-29 05:46:54',
      naiveSemantics: 'infer',
    })).toBe('2026-07-29T05:46:53.000Z');
  });

  it('preserves explicit UTC and numeric-offset instants', () => {
    expect(normalizeLegacyAdmissionInstantUtc({
      admissionDate: '2026-07-29T05:46:53Z',
    })).toBe('2026-07-29T05:46:53.000Z');

    expect(normalizeLegacyAdmissionInstantUtc({
      admissionDate: '2026-07-29T11:46:53+06:00',
    })).toBe('2026-07-29T05:46:53.000Z');
  });

  it('supports explicit UTC and Dhaka semantics for naive values', () => {
    expect(normalizeLegacyAdmissionInstantUtc({
      admissionDate: '2026-07-29 05:46:53',
      naiveSemantics: 'utc',
    })).toBe('2026-07-29T05:46:53.000Z');

    expect(normalizeLegacyAdmissionInstantUtc({
      admissionDate: '2026-07-29 11:46:53',
      naiveSemantics: 'asia_dhaka',
    })).toBe('2026-07-29T05:46:53.000Z');
  });

  it('interprets date-only values as Bangladesh midnight for canonical compatibility', () => {
    expect(normalizeLegacyAdmissionInstantUtc({
      admissionDate: '2026-07-29',
    })).toBe('2026-07-28T18:00:00.000Z');
  });

  it('falls back to Bangladesh wall time when historical evidence is ambiguous', () => {
    expect(normalizeLegacyAdmissionInstantUtc({
      admissionDate: '2026-07-29 11:46:53',
      createdAt: null,
      naiveSemantics: 'infer',
    })).toBe('2026-07-29T05:46:53.000Z');
  });
});
