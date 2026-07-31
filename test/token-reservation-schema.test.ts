import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Re-define the schema here for testing purposes. Kept in sync with
// src/routes/tenant/reception.ts `createTokenReservationSchema`. If the
// production schema changes, this test file must be updated.
const createTokenReservationSchema = z.object({
  doctorId: z.number().int().positive().nullable().optional(),
  reservationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  tokenFrom: z.number().int().min(1),
  tokenTo: z.number().int().min(1),
  label: z.string().trim().max(200).optional().nullable(),
}).refine(d => !d.endDate || d.endDate >= d.reservationDate, {
  message: 'endDate must be on or after reservationDate',
  path: ['endDate'],
}).refine(d => d.tokenTo >= d.tokenFrom, {
  message: 'tokenTo must be >= tokenFrom',
  path: ['tokenTo'],
});

describe('createTokenReservationSchema', () => {
  it('accepts a single-day reservation (no endDate)', () => {
    const result = createTokenReservationSchema.safeParse({
      doctorId: 1,
      reservationDate: '2026-06-05',
      tokenFrom: 1,
      tokenTo: 10,
      label: 'VIP',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a range reservation (endDate > reservationDate)', () => {
    const result = createTokenReservationSchema.safeParse({
      doctorId: null,
      reservationDate: '2026-06-05',
      endDate: '2026-06-12',
      tokenFrom: 1,
      tokenTo: 5,
      label: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an Always reservation (endDate = 2099-12-31)', () => {
    const result = createTokenReservationSchema.safeParse({
      doctorId: 7,
      reservationDate: '2026-06-05',
      endDate: '2099-12-31',
      tokenFrom: 11,
      tokenTo: 20,
      label: 'Staff daily',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a range where endDate equals reservationDate (single day explicit)', () => {
    const result = createTokenReservationSchema.safeParse({
      doctorId: 1,
      reservationDate: '2026-06-05',
      endDate: '2026-06-05',
      tokenFrom: 1,
      tokenTo: 1,
    });
    expect(result.success).toBe(true);
  });

  it('accepts doctorId = null (all doctors)', () => {
    const result = createTokenReservationSchema.safeParse({
      doctorId: null,
      reservationDate: '2026-06-05',
      tokenFrom: 1,
      tokenTo: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects endDate before reservationDate', () => {
    const result = createTokenReservationSchema.safeParse({
      doctorId: 1,
      reservationDate: '2026-06-10',
      endDate: '2026-06-05',
      tokenFrom: 1,
      tokenTo: 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const endDateError = result.error.issues.find(i => i.path.includes('endDate'));
      expect(endDateError).toBeDefined();
      expect(endDateError?.message).toBe('endDate must be on or after reservationDate');
    }
  });

  it('rejects tokenTo < tokenFrom', () => {
    const result = createTokenReservationSchema.safeParse({
      doctorId: 1,
      reservationDate: '2026-06-05',
      tokenFrom: 10,
      tokenTo: 5,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const tokenToError = result.error.issues.find(i => i.path.includes('tokenTo'));
      expect(tokenToError).toBeDefined();
      expect(tokenToError?.message).toBe('tokenTo must be >= tokenFrom');
    }
  });

  it('rejects tokenFrom < 1', () => {
    const result = createTokenReservationSchema.safeParse({
      doctorId: 1,
      reservationDate: '2026-06-05',
      tokenFrom: 0,
      tokenTo: 5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed reservationDate', () => {
    const result = createTokenReservationSchema.safeParse({
      doctorId: 1,
      reservationDate: '06/05/2026',
      tokenFrom: 1,
      tokenTo: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative or zero doctorId', () => {
    const r1 = createTokenReservationSchema.safeParse({
      doctorId: 0,
      reservationDate: '2026-06-05',
      tokenFrom: 1,
      tokenTo: 1,
    });
    const r2 = createTokenReservationSchema.safeParse({
      doctorId: -3,
      reservationDate: '2026-06-05',
      tokenFrom: 1,
      tokenTo: 1,
    });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
  });

  it('accepts label = null and undefined', () => {
    const r1 = createTokenReservationSchema.safeParse({
      doctorId: 1,
      reservationDate: '2026-06-05',
      tokenFrom: 1,
      tokenTo: 1,
      label: null,
    });
    const r2 = createTokenReservationSchema.safeParse({
      doctorId: 1,
      reservationDate: '2026-06-05',
      tokenFrom: 1,
      tokenTo: 1,
    });
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it('rejects label longer than 200 chars', () => {
    const result = createTokenReservationSchema.safeParse({
      doctorId: 1,
      reservationDate: '2026-06-05',
      tokenFrom: 1,
      tokenTo: 1,
      label: 'x'.repeat(201),
    });
    expect(result.success).toBe(false);
  });
});

describe('Token reservation overlap detection (pure logic)', () => {
  // Mirrors the SQL pattern used in reception.ts POST handler:
  //   NOT (end_date < newStart OR reservation_date > newEnd)
  //   AND NOT (token_to < token_from_new OR token_from > token_to_new)
  function overlaps(
    existing: { start: string; end: string; tokenFrom: number; tokenTo: number },
    incoming: { start: string; end: string; tokenFrom: number; tokenTo: number },
  ): boolean {
    const dateOverlap = !(existing.end < incoming.start || existing.start > incoming.end);
    const tokenOverlap = !(existing.tokenTo < incoming.tokenFrom || existing.tokenFrom > incoming.tokenTo);
    return dateOverlap && tokenOverlap;
  }

  it('detects overlap when new single day falls inside existing range', () => {
    expect(overlaps(
      { start: '2026-06-01', end: '2026-06-10', tokenFrom: 1, tokenTo: 10 },
      { start: '2026-06-05', end: '2026-06-05', tokenFrom: 1, tokenTo: 10 },
    )).toBe(true);
  });

  it('no overlap when dates do not touch', () => {
    expect(overlaps(
      { start: '2026-06-01', end: '2026-06-05', tokenFrom: 1, tokenTo: 10 },
      { start: '2026-06-06', end: '2026-06-10', tokenFrom: 1, tokenTo: 10 },
    )).toBe(false);
  });

  it('no overlap when token ranges do not intersect', () => {
    expect(overlaps(
      { start: '2026-06-01', end: '2026-06-10', tokenFrom: 1, tokenTo: 5 },
      { start: '2026-06-05', end: '2026-06-05', tokenFrom: 6, tokenTo: 10 },
    )).toBe(false);
  });

  it('detects overlap on adjacent dates (overlap is inclusive on both sides)', () => {
    // Reservation 1: 1-5, Reservation 2: 5-10 — they share day 5, so they overlap.
    expect(overlaps(
      { start: '2026-06-01', end: '2026-06-05', tokenFrom: 1, tokenTo: 10 },
      { start: '2026-06-05', end: '2026-06-10', tokenFrom: 1, tokenTo: 10 },
    )).toBe(true);
  });

  it('detects overlap on adjacent token ranges (inclusive)', () => {
    // Tokens 1-5 and 5-10 share token 5.
    expect(overlaps(
      { start: '2026-06-05', end: '2026-06-05', tokenFrom: 1, tokenTo: 5 },
      { start: '2026-06-05', end: '2026-06-05', tokenFrom: 5, tokenTo: 10 },
    )).toBe(true);
  });

  it('Always (end=2099-12-31) overlaps with any future date', () => {
    expect(overlaps(
      { start: '2026-06-05', end: '2099-12-31', tokenFrom: 1, tokenTo: 10 },
      { start: '2030-01-01', end: '2030-01-01', tokenFrom: 11, tokenTo: 20 },
    )).toBe(false); // tokens don't overlap
    expect(overlaps(
      { start: '2026-06-05', end: '2099-12-31', tokenFrom: 1, tokenTo: 10 },
      { start: '2030-01-01', end: '2030-01-01', tokenFrom: 5, tokenTo: 15 },
    )).toBe(true); // tokens overlap
  });

  it('two Always reservations with different token ranges do not overlap', () => {
    expect(overlaps(
      { start: '2026-06-05', end: '2099-12-31', tokenFrom: 1, tokenTo: 10 },
      { start: '2026-06-05', end: '2099-12-31', tokenFrom: 11, tokenTo: 20 },
    )).toBe(false);
  });

  it('two Always reservations with overlapping token ranges overlap', () => {
    expect(overlaps(
      { start: '2026-06-05', end: '2099-12-31', tokenFrom: 1, tokenTo: 10 },
      { start: '2026-06-05', end: '2099-12-31', tokenFrom: 5, tokenTo: 15 },
    )).toBe(true);
  });
});
