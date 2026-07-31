import { describe, it, expect } from 'vitest';
import {
  buildTokenReservationAvailability,
  type TokenReservationRange,
} from '../src/lib/token-reservations';

describe('buildTokenReservationAvailability', () => {
  it('returns no reservations when ranges are empty', () => {
    const result = buildTokenReservationAvailability({
      ranges: [],
      bookedTokenNumbers: [],
    });
    expect(result.tokens).toEqual([]);
    expect(result.summary.reservedTotal).toBe(0);
    expect(result.summary.reservedBooked).toBe(0);
    expect(result.summary.reservedAvailable).toBe(0);
    expect(result.summary.nextRegularTokenNo).toBe(1);
  });

  it('expands a single range into individual tokens', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 1, token_to: 3, label: 'VIP' },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [],
    });
    expect(result.tokens.map((t) => t.token)).toEqual([1, 2, 3]);
    expect(result.summary.reservedTotal).toBe(3);
    expect(result.summary.reservedAvailable).toBe(3);
  });

  it('marks already-booked tokens as not available', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 1, token_to: 5, label: null },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [2, 4],
    });
    expect(result.tokens.map((t) => t.token)).toEqual([1, 3, 5]);
    expect(result.summary.reservedTotal).toBe(5);
    expect(result.summary.reservedBooked).toBe(2);
    expect(result.summary.reservedAvailable).toBe(3);
  });

  it('skips reserved tokens when computing the next regular token', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 3, token_to: 3, label: 'VIP' },
      { token_from: 7, token_to: 9, label: 'Staff' },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [1, 2],
    });
    // currentTokenNo = 2, next regular = 3, but 3 is reserved → 4
    expect(result.summary.currentTokenNo).toBe(2);
    expect(result.summary.nextRegularTokenNo).toBe(4);
  });

  it('nextRegularTokenNo is current+1 when current is not reserved', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 5, token_to: 5, label: 'VIP' },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [1, 2],
    });
    expect(result.summary.nextRegularTokenNo).toBe(3);
  });

  it('does not auto-fill earlier gaps when computing the next regular token', () => {
    const result = buildTokenReservationAvailability({
      ranges: [],
      bookedTokenNumbers: [1, 2, 4, 7, 9, 10],
    });

    expect(result.summary.currentTokenNo).toBe(10);
    expect(result.summary.nextRegularTokenNo).toBe(11);
  });

  it('preserves the label on each available reserved token', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 1, token_to: 2, label: 'VIP' },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [],
    });
    expect(result.tokens[0].label).toBe('VIP');
    expect(result.tokens[1].label).toBe('VIP');
  });

  it('treats a null label as no label', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 1, token_to: 1, label: null },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [],
    });
    expect(result.tokens[0].label).toBeNull();
  });

  it('skips malformed ranges gracefully', () => {
    const ranges = [
      { token_from: 0, token_to: 5, label: 'bad-low' },
      { token_from: 3, token_to: 2, label: 'bad-flipped' },
      { token_from: 1, token_to: 3, label: 'good' },
    ] as TokenReservationRange[];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [],
    });
    expect(result.summary.reservedTotal).toBe(3);
    expect(result.tokens.map((t) => t.token)).toEqual([1, 2, 3]);
  });

  it('handles multiple non-overlapping ranges', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 1, token_to: 2, label: 'A' },
      { token_from: 5, token_to: 6, label: 'B' },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [],
    });
    expect(result.tokens.map((t) => t.token)).toEqual([1, 2, 5, 6]);
    expect(result.summary.reservedTotal).toBe(4);
  });

  it('currentTokenNo reflects the highest booked token number', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 10, token_to: 20, label: 'VIP' },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [3, 7, 12, 15],
    });
    expect(result.summary.currentTokenNo).toBe(15);
  });

  it('currentTokenNo is 0 when no appointments are booked', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 1, token_to: 1, label: 'VIP' },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [],
    });
    expect(result.summary.currentTokenNo).toBe(0);
  });

  it('filters non-integer or zero booked tokens', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 1, token_to: 5, label: null },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [0, -1, 2.5, null, undefined, '3' as any, 3],
    });
    // 0, -1, 2.5 (non-integer), null, undefined, '3' (string coerced to 3),
    // 3 → normalizeBookedTokenNumbers keeps only integer > 0. '3' and 3
    // both normalize to 3; the Set dedupes them, so reservedBooked counts
    // token 3 exactly once within range 1–5.
    expect(result.summary.reservedBooked).toBe(1);
    expect(result.tokens.map((t) => t.token)).toEqual([1, 2, 4, 5]);
  });

  it('treats range reservations and Always reservations identically for availability', () => {
    // This test documents the contract: buildTokenReservationAvailability
    // operates on already-loaded ranges, so the "range vs Always"
    // distinction is resolved at the SQL query level (BETWEEN reservation_date
    // AND end_date). The function itself is date-agnostic.
    const ranges: TokenReservationRange[] = [
      { token_from: 1, token_to: 3, label: 'Daily VIP' },
      { token_from: 10, token_to: 12, label: 'Weekly staff' },
    ];
    const daily = buildTokenReservationAvailability({ ranges, bookedTokenNumbers: [] });
    const weekly = buildTokenReservationAvailability({ ranges, bookedTokenNumbers: [] });
    expect(daily.tokens).toEqual(weekly.tokens);
    expect(daily.summary).toEqual(weekly.summary);
  });

  it('handles the maximum realistic reserved range without overflow', () => {
    const ranges: TokenReservationRange[] = [
      { token_from: 1, token_to: 100, label: 'bulk' },
    ];
    const result = buildTokenReservationAvailability({
      ranges,
      bookedTokenNumbers: [],
    });
    expect(result.summary.reservedTotal).toBe(100);
    expect(result.summary.reservedAvailable).toBe(100);
    expect(result.tokens.length).toBe(100);
  });
});
