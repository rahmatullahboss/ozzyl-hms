import { describe, it, expect } from 'vitest';
import { buildTokenReservationAvailability } from '../src/lib/token-reservations';

// ─── Token Reservation System Tests ──────────────────────────────────────────
// Covers: src/routes/tenant/reception.ts (token reservation CRUD)
//         src/routes/tenant/appointments.ts (token generation with skip logic)
// Receptionist reserves token ranges (e.g., 1-10) for VIPs/staff.
// Regular auto-assigned tokens skip reserved ranges.

describe('Token Reservation System', () => {

  // ─── Schema Validation ─────────────────────────────────────────────────────
  describe('Reservation Schema Validation', () => {
    interface TokenReservationInput {
      doctorId?: number | null;
      reservationDate: string;
      tokenFrom: number;
      tokenTo: number;
      label?: string | null;
    }

    function isValidReservation(input: TokenReservationInput): { valid: boolean; error?: string } {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.reservationDate)) {
        return { valid: false, error: 'Invalid date format' };
      }
      if (input.tokenFrom < 1) {
        return { valid: false, error: 'tokenFrom must be >= 1' };
      }
      if (input.tokenTo < 1) {
        return { valid: false, error: 'tokenTo must be >= 1' };
      }
      if (input.tokenTo < input.tokenFrom) {
        return { valid: false, error: 'tokenTo must be >= tokenFrom' };
      }
      return { valid: true };
    }

    it('should accept valid reservation with range 1-10', () => {
      const result = isValidReservation({
        reservationDate: '2026-06-04',
        tokenFrom: 1,
        tokenTo: 10,
      });
      expect(result.valid).toBe(true);
    });

    it('should accept single token reservation (from === to)', () => {
      const result = isValidReservation({
        reservationDate: '2026-06-04',
        tokenFrom: 5,
        tokenTo: 5,
      });
      expect(result.valid).toBe(true);
    });

    it('should reject tokenFrom < 1', () => {
      const result = isValidReservation({
        reservationDate: '2026-06-04',
        tokenFrom: 0,
        tokenTo: 10,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('tokenFrom must be >= 1');
    });

    it('should reject tokenTo < tokenFrom', () => {
      const result = isValidReservation({
        reservationDate: '2026-06-04',
        tokenFrom: 10,
        tokenTo: 5,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('tokenTo must be >= tokenFrom');
    });

    it('should reject invalid date format', () => {
      const result = isValidReservation({
        reservationDate: '04-06-2026',
        tokenFrom: 1,
        tokenTo: 10,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid date format');
    });

    it('should accept reservation with label', () => {
      const result = isValidReservation({
        reservationDate: '2026-06-04',
        tokenFrom: 1,
        tokenTo: 10,
        label: 'VIP',
      });
      expect(result.valid).toBe(true);
    });

    it('should accept reservation with null doctorId (all doctors)', () => {
      const result = isValidReservation({
        doctorId: null,
        reservationDate: '2026-06-04',
        tokenFrom: 1,
        tokenTo: 5,
      });
      expect(result.valid).toBe(true);
    });
  });

  // ─── Token Generation Skip Logic ───────────────────────────────────────────
  describe('Token Generation — Skip Reserved Ranges', () => {
    interface ReservedRange {
      token_from: number;
      token_to: number;
    }

    function getNextAvailableToken(
      currentMax: number,
      reservedRanges: ReservedRange[],
    ): number {
      let candidate = currentMax + 1;
      if (reservedRanges.length === 0) return candidate;

      while (true) {
        const isReserved = reservedRanges.some(
          r => candidate >= r.token_from && candidate <= r.token_to,
        );
        if (!isReserved) return candidate;
        candidate++;
      }
    }

    it('should return 1 when no reservations and no existing tokens', () => {
      expect(getNextAvailableToken(0, [])).toBe(1);
    });

    it('should return next sequential when no reservations', () => {
      expect(getNextAvailableToken(5, [])).toBe(6);
    });

    it('should skip reserved range 1-10 and return 11', () => {
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 10 }];
      expect(getNextAvailableToken(0, ranges)).toBe(11);
    });

    it('should skip reserved range and return first available', () => {
      // Existing max = 3, reserved 1-5 → should return 6
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 5 }];
      expect(getNextAvailableToken(3, ranges)).toBe(6);
    });

    it('should skip multiple reserved ranges', () => {
      // Reserved: 1-5 and 8-10, current max = 0 → should return 6
      const ranges: ReservedRange[] = [
        { token_from: 1, token_to: 5 },
        { token_from: 8, token_to: 10 },
      ];
      expect(getNextAvailableToken(0, ranges)).toBe(6);
    });

    it('should skip multiple reserved ranges with gap', () => {
      // Reserved: 1-3 and 7-9, current max = 0 → should return 4
      const ranges: ReservedRange[] = [
        { token_from: 1, token_to: 3 },
        { token_from: 7, token_to: 9 },
      ];
      expect(getNextAvailableToken(0, ranges)).toBe(4);
    });

    it('should handle reservation that starts after current max', () => {
      // Reserved: 20-30, current max = 5 → should return 6 (no conflict)
      const ranges: ReservedRange[] = [{ token_from: 20, token_to: 30 }];
      expect(getNextAvailableToken(5, ranges)).toBe(6);
    });

    it('should handle current max inside reserved range', () => {
      // Reserved: 1-10, current max = 7 → should return 11
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 10 }];
      expect(getNextAvailableToken(7, ranges)).toBe(11);
    });

    it('should handle adjacent reserved ranges covering all low numbers', () => {
      // Reserved: 1-3, 4-6, 7-9 → should return 10
      const ranges: ReservedRange[] = [
        { token_from: 1, token_to: 3 },
        { token_from: 4, token_to: 6 },
        { token_from: 7, token_to: 9 },
      ];
      expect(getNextAvailableToken(0, ranges)).toBe(10);
    });
  });

  // ─── Overlap Detection ─────────────────────────────────────────────────────
  describe('Reservation Overlap Detection', () => {
    interface ExistingReservation {
      id: number;
      token_from: number;
      token_to: number;
    }

    function hasOverlap(
      existing: ExistingReservation[],
      newFrom: number,
      newTo: number,
    ): ExistingReservation | null {
      for (const r of existing) {
        if (r.token_from <= newTo && r.token_to >= newFrom) {
          return r;
        }
      }
      return null;
    }

    it('should detect exact overlap', () => {
      const existing: ExistingReservation[] = [{ id: 1, token_from: 1, token_to: 10 }];
      const result = hasOverlap(existing, 1, 10);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(1);
    });

    it('should detect partial overlap (new range starts inside existing)', () => {
      const existing: ExistingReservation[] = [{ id: 1, token_from: 1, token_to: 10 }];
      const result = hasOverlap(existing, 5, 15);
      expect(result).not.toBeNull();
    });

    it('should detect partial overlap (new range ends inside existing)', () => {
      const existing: ExistingReservation[] = [{ id: 1, token_from: 5, token_to: 15 }];
      const result = hasOverlap(existing, 1, 10);
      expect(result).not.toBeNull();
    });

    it('should detect overlap when new range contains existing', () => {
      const existing: ExistingReservation[] = [{ id: 1, token_from: 3, token_to: 7 }];
      const result = hasOverlap(existing, 1, 10);
      expect(result).not.toBeNull();
    });

    it('should NOT detect overlap when ranges are adjacent (no gap)', () => {
      const existing: ExistingReservation[] = [{ id: 1, token_from: 1, token_to: 5 }];
      const result = hasOverlap(existing, 6, 10);
      expect(result).toBeNull();
    });

    it('should NOT detect overlap when ranges are separate', () => {
      const existing: ExistingReservation[] = [{ id: 1, token_from: 1, token_to: 5 }];
      const result = hasOverlap(existing, 20, 30);
      expect(result).toBeNull();
    });

    it('should detect overlap with multiple existing reservations', () => {
      const existing: ExistingReservation[] = [
        { id: 1, token_from: 1, token_to: 5 },
        { id: 2, token_from: 15, token_to: 20 },
      ];
      const result = hasOverlap(existing, 3, 17);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(1); // overlaps with first
    });

    it('should return null when no overlap with multiple reservations', () => {
      const existing: ExistingReservation[] = [
        { id: 1, token_from: 1, token_to: 5 },
        { id: 2, token_from: 15, token_to: 20 },
      ];
      const result = hasOverlap(existing, 8, 12);
      expect(result).toBeNull();
    });
  });

  // ─── Available Reserved Tokens Calculation ─────────────────────────────────
  describe('Available Reserved Tokens', () => {
    interface ReservedRange {
      token_from: number;
      token_to: number;
      label?: string | null;
    }

    function getAvailableReservedTokens(
      ranges: ReservedRange[],
      bookedTokens: Set<number>,
    ): Array<{ token: number; label: string | null }> {
      const available: Array<{ token: number; label: string | null }> = [];
      for (const range of ranges) {
        for (let t = range.token_from; t <= range.token_to; t++) {
          if (!bookedTokens.has(t)) {
            available.push({ token: t, label: range.label ?? null });
          }
        }
      }
      return available;
    }

    it('should return all tokens when none are booked', () => {
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 5 }];
      const result = getAvailableReservedTokens(ranges, new Set());
      expect(result).toHaveLength(5);
      expect(result.map(r => r.token)).toEqual([1, 2, 3, 4, 5]);
    });

    it('should exclude booked tokens', () => {
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 5 }];
      const booked = new Set([2, 4]);
      const result = getAvailableReservedTokens(ranges, booked);
      expect(result).toHaveLength(3);
      expect(result.map(r => r.token)).toEqual([1, 3, 5]);
    });

    it('should return empty when all tokens are booked', () => {
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 3 }];
      const booked = new Set([1, 2, 3]);
      const result = getAvailableReservedTokens(ranges, booked);
      expect(result).toHaveLength(0);
    });

    it('should handle multiple ranges', () => {
      const ranges: ReservedRange[] = [
        { token_from: 1, token_to: 3, label: 'VIP' },
        { token_from: 10, token_to: 12, label: 'Staff' },
      ];
      const booked = new Set([2, 11]);
      const result = getAvailableReservedTokens(ranges, booked);
      expect(result).toHaveLength(4);
      expect(result.map(r => r.token)).toEqual([1, 3, 10, 12]);
    });

    it('should preserve labels from ranges', () => {
      const ranges: ReservedRange[] = [
        { token_from: 1, token_to: 2, label: 'VIP' },
        { token_from: 5, token_to: 5, label: 'Staff' },
      ];
      const result = getAvailableReservedTokens(ranges, new Set());
      expect(result[0].label).toBe('VIP');
      expect(result[1].label).toBe('VIP');
      expect(result[2].label).toBe('Staff');
    });

    it('should handle null labels', () => {
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 2 }];
      const result = getAvailableReservedTokens(ranges, new Set());
      expect(result[0].label).toBeNull();
      expect(result[1].label).toBeNull();
    });

    it('should summarize current serial and remaining reserved seats for the appointment modal', () => {
      const result = buildTokenReservationAvailability({
        ranges: [{ token_from: 1, token_to: 10, label: 'Reserved' }],
        bookedTokenNumbers: [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
      });

      expect(result.summary).toEqual({
        currentTokenNo: 25,
        nextRegularTokenNo: 26,
        reservedTotal: 10,
        reservedBooked: 5,
        reservedAvailable: 5,
      });
      expect(result.tokens.map((token) => token.token_no)).toEqual([6, 7, 8, 9, 10]);
    });
  });

  // ─── Requested Token Validation ────────────────────────────────────────────
  describe('Requested Token Validation', () => {
    interface ReservedRange {
      token_from: number;
      token_to: number;
    }

    function isTokenInReservedRange(
      token: number,
      ranges: ReservedRange[],
    ): boolean {
      return ranges.some(r => token >= r.token_from && token <= r.token_to);
    }

    it('should accept token inside reserved range', () => {
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 10 }];
      expect(isTokenInReservedRange(5, ranges)).toBe(true);
    });

    it('should accept token at start of reserved range', () => {
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 10 }];
      expect(isTokenInReservedRange(1, ranges)).toBe(true);
    });

    it('should accept token at end of reserved range', () => {
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 10 }];
      expect(isTokenInReservedRange(10, ranges)).toBe(true);
    });

    it('should reject token outside reserved range', () => {
      const ranges: ReservedRange[] = [{ token_from: 1, token_to: 10 }];
      expect(isTokenInReservedRange(15, ranges)).toBe(false);
    });

    it('should reject token below reserved range', () => {
      const ranges: ReservedRange[] = [{ token_from: 5, token_to: 10 }];
      expect(isTokenInReservedRange(3, ranges)).toBe(false);
    });

    it('should check across multiple ranges', () => {
      const ranges: ReservedRange[] = [
        { token_from: 1, token_to: 5 },
        { token_from: 20, token_to: 25 },
      ];
      expect(isTokenInReservedRange(3, ranges)).toBe(true);
      expect(isTokenInReservedRange(22, ranges)).toBe(true);
      expect(isTokenInReservedRange(10, ranges)).toBe(false);
    });

    it('should reject token when no ranges exist', () => {
      expect(isTokenInReservedRange(5, [])).toBe(false);
    });
  });
});
