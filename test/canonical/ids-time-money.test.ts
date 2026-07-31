import { describe, expect, it } from 'vitest';
import { createPublicId } from '../../src/lib/canonical/ids';
import { deriveBusinessDate, toUtcIso } from '../../src/lib/canonical/time';
import { toMinorUnits, toSignedMinorUnits } from '../../src/lib/canonical/money';

describe('canonical public IDs', () => {
  it('creates Crockford-base32 IDs that remain unique and monotonic within one millisecond', () => {
    const ids = Array.from({ length: 100 }, () => createPublicId(1_700_000_000_000));

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('sorts by timestamp and survives a backwards clock without decreasing', () => {
    const first = createPublicId(1_800_000_000_000);
    const second = createPublicId(1_800_000_000_001);
    const clockRollback = createPublicId(1_799_999_999_000);

    expect(first < second).toBe(true);
    expect(second < clockRollback).toBe(true);
  });

  it('rejects invalid timestamp inputs instead of producing ambiguous IDs', () => {
    expect(() => createPublicId(-1)).toThrow(/timestamp/i);
    expect(() => createPublicId(1.5)).toThrow(/timestamp/i);
    expect(() => createPublicId(2 ** 48)).toThrow(/timestamp/i);
  });
});

describe('canonical UTC and business dates', () => {
  it('normalizes UTC timestamps with millisecond precision', () => {
    expect(toUtcIso('2026-07-13T17:59:59.123Z')).toBe('2026-07-13T17:59:59.123Z');
    expect(toUtcIso(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('derives Bangladesh business dates across the UTC midnight boundary', () => {
    expect(deriveBusinessDate('2026-07-13T17:59:59.999Z', 'Asia/Dhaka')).toBe('2026-07-13');
    expect(deriveBusinessDate('2026-07-13T18:00:00.000Z', 'Asia/Dhaka')).toBe('2026-07-14');
  });

  it('supports other IANA zones without embedding a fixed offset', () => {
    expect(deriveBusinessDate('2026-01-01T04:59:59.000Z', 'America/New_York')).toBe('2025-12-31');
    expect(deriveBusinessDate('2026-01-01T05:00:00.000Z', 'America/New_York')).toBe('2026-01-01');
  });

  it('rejects invalid timestamps and time zones', () => {
    expect(() => toUtcIso('not-a-date')).toThrow(/timestamp/i);
    expect(() => toUtcIso('2026-02-30T00:00:00.000Z')).toThrow(/calendar|timestamp/i);
    expect(() => toUtcIso(0.5)).toThrow(/integer|timestamp/i);
    expect(() => deriveBusinessDate('2026-07-13T18:00:00.000Z', 'Not/AZone')).toThrow(/time zone/i);
  });
});

describe('canonical minor-unit money', () => {
  it('converts decimal strings and ordinary decimal numbers exactly', () => {
    expect(toMinorUnits('0')).toBe(0);
    expect(toMinorUnits('0.01')).toBe(1);
    expect(toMinorUnits('12.3')).toBe(1230);
    expect(toMinorUnits('12.34')).toBe(1234);
    expect(toMinorUnits(12.34)).toBe(1234);
  });

  it('accepts the largest safe minor-unit value and rejects overflow', () => {
    expect(toMinorUnits('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => toMinorUnits('90071992547409.92')).toThrow(/safe integer|overflow/i);
  });

  it('rejects negative, malformed, non-finite, excessive-scale, and accumulated floating-point values', () => {
    for (const value of ['-1', '1.001', '1e3', '', '  ', Number.NaN, Number.POSITIVE_INFINITY, 0.1 + 0.2]) {
      expect(() => toMinorUnits(value as string | number)).toThrow();
    }
  });

  it('permits negatives only through the explicitly signed reversal conversion', () => {
    expect(toSignedMinorUnits('-12.34')).toBe(-1234);
    expect(toSignedMinorUnits('12.34')).toBe(1234);
    expect(() => toSignedMinorUnits('-90071992547409.92')).toThrow(/safe integer|overflow/i);
  });
});
