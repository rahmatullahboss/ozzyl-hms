import { describe, it, expect } from 'vitest';
import {
  calculateBedDays,
  recalculateBedCharge,
  buildRecalculateBedChargesSQL,
  calculatePackageBedCharge,
  calculateAdmissionPackageBilling,
} from '../../src/lib/bed-charges';

const CALENDAR_POLICY = {
  dayCountMode: 'calendar_day_inclusive' as const,
  graceHours: 0,
  partialDayMode: 'full_day' as const,
  halfDayAfterHours: 0,
  halfDayRatio: 0.5,
  checkInHour: 11,
  earlyCheckInGraceHours: 0,
};

describe('bed-charges', () => {
  describe('calculateBedDays', () => {
    it('returns 1 for same-day admission and discharge', () => {
      expect(calculateBedDays('2024-01-15T10:00:00Z', '2024-01-15T18:00:00Z')).toBe(1);
    });

    it('returns 1 for admission and discharge on consecutive hours crossing midnight', () => {
      // Admitted 11pm, discharged 1am next day = 2 days (midnight-normalized)
      expect(calculateBedDays('2024-01-15T23:00:00Z', '2024-01-16T01:00:00Z', CALENDAR_POLICY)).toBe(2);
    });

    it('returns 2 for 2 calendar days', () => {
      expect(calculateBedDays('2024-01-15T08:00:00Z', '2024-01-16T08:00:00Z', CALENDAR_POLICY)).toBe(2);
    });

    it('returns 3 for 3 calendar days', () => {
      expect(calculateBedDays('2024-01-15T08:00:00Z', '2024-01-17T08:00:00Z', CALENDAR_POLICY)).toBe(3);
    });

    it('returns minimum 1 day even for very short stays', () => {
      expect(calculateBedDays('2024-01-15T10:00:00Z', '2024-01-15T10:30:00Z')).toBe(1);
    });

    it('uses current date when endedOn is null', () => {
      const result = calculateBedDays('2024-01-15T08:00:00Z', null);
      // Should be at least 1 day
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('uses current date when endedOn is undefined', () => {
      const result = calculateBedDays('2024-01-15T08:00:00Z');
      expect(result).toBeGreaterThanOrEqual(1);
    });

    it('handles dates at midnight correctly', () => {
      expect(calculateBedDays('2024-01-15T00:00:00Z', '2024-01-15T00:00:00Z')).toBe(1);
    });

    it('handles multi-day stays correctly under calendar policy', () => {
      expect(calculateBedDays('2024-01-15T08:00:00Z', '2024-01-20T08:00:00Z', CALENDAR_POLICY)).toBe(6);
    });

    it('uses hotel-style default with 3 hours checkout grace', () => {
      expect(calculateBedDays('2024-01-15T11:00:00', '2024-01-16T14:00:00')).toBe(1);
      expect(calculateBedDays('2024-01-15T11:00:00', '2024-01-16T14:01:00')).toBe(2);
    });

    it('applies early check-in grace before the configured check-in hour', () => {
      expect(calculateBedDays('2024-01-15T09:00:00', '2024-01-16T14:00:00')).toBe(1);
      expect(calculateBedDays('2024-01-15T08:59:00', '2024-01-16T14:00:00')).toBe(2);
    });
  });

  describe('recalculateBedCharge', () => {
    it('calculates charge for same-day stay', () => {
      const result = recalculateBedCharge(1200, '2024-01-15T10:00:00Z', '2024-01-15T18:00:00Z');
      expect(result).toEqual({ days: 1, chargeAmount: 1200 });
    });

    it('calculates charge for 2-day stay', () => {
      const result = recalculateBedCharge(1500, '2024-01-15T08:00:00Z', '2024-01-16T08:00:00Z', CALENDAR_POLICY);
      expect(result).toEqual({ days: 2, chargeAmount: 3000 });
    });

    it('calculates charge for 3-day stay', () => {
      const result = recalculateBedCharge(2000, '2024-01-15T08:00:00Z', '2024-01-17T08:00:00Z', CALENDAR_POLICY);
      expect(result).toEqual({ days: 3, chargeAmount: 6000 });
    });

    it('handles zero rate', () => {
      const result = recalculateBedCharge(0, '2024-01-15T08:00:00Z', '2024-01-16T08:00:00Z', CALENDAR_POLICY);
      expect(result).toEqual({ days: 2, chargeAmount: 0 });
    });

    it('handles fractional rate', () => {
      const result = recalculateBedCharge(1250.50, '2024-01-15T08:00:00Z', '2024-01-16T08:00:00Z', CALENDAR_POLICY);
      expect(result).toEqual({ days: 2, chargeAmount: 2501 });
    });

    it('uses current date when endedOn is null', () => {
      const result = recalculateBedCharge(1000, '2024-01-15T08:00:00Z', null);
      expect(result.days).toBeGreaterThanOrEqual(1);
      expect(result.chargeAmount).toBeGreaterThanOrEqual(1000);
    });
  });

  describe('buildRecalculateBedChargesSQL', () => {
    it('returns valid SQL with correct parameters', () => {
      const result = buildRecalculateBedChargesSQL('tenant-1', 42);
      expect(result.sql).toContain('UPDATE patient_bed_infos');
      expect(result.sql).toContain('WHERE tenant_id = ? AND admission_id = ? AND is_billed = 0');
      expect(result.params).toEqual(['tenant-1', 42]);
    });

    it('uses GMT+6 timezone in SQL', () => {
      const result = buildRecalculateBedChargesSQL('tenant-1', 42);
      expect(result.sql).toContain("datetime('now', '+6 hours')");
      expect(result.sql).not.toContain("datetime('now')");
    });

    it('calculates days using julianday', () => {
      const result = buildRecalculateBedChargesSQL('tenant-1', 42);
      expect(result.sql).toContain('julianday');
    });
  });

  describe('calculatePackageBedCharge', () => {
    it('returns 0 charge when stay is within included days', () => {
      // Package: 3 included days, rate 1500/day, extra rate 1500/day
      // Stay: 2 days → all covered by package
      const result = calculatePackageBedCharge({
        ratePerDay: 1500,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-02T10:00:00',
        includedBedDays: 3,
        extraBedRate: 1500,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(2);
      expect(result.chargeableDays).toBe(0);
      expect(result.chargeAmount).toBe(0);
      expect(result.includedDaysUsed).toBe(2);
      expect(result.extraDays).toBe(0);
    });

    it('charges extra days beyond included days', () => {
      // Package: 3 included days, rate 1500/day, extra rate 1500/day
      // Stay: 5 days → 3 included + 2 extra
      const result = calculatePackageBedCharge({
        ratePerDay: 1500,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-05T10:00:00',
        includedBedDays: 3,
        extraBedRate: 1500,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(5);
      expect(result.chargeableDays).toBe(2);
      expect(result.chargeAmount).toBe(3000);
      expect(result.includedDaysUsed).toBe(3);
      expect(result.extraDays).toBe(2);
    });

    it('charges all days when included days is 0 (standard package)', () => {
      const result = calculatePackageBedCharge({
        ratePerDay: 1500,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-03T10:00:00',
        includedBedDays: 0,
        extraBedRate: 0,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(3);
      expect(result.chargeableDays).toBe(3);
      expect(result.chargeAmount).toBe(4500);
      expect(result.includedDaysUsed).toBe(0);
      expect(result.extraDays).toBe(3);
    });

    it('charges at extra_bed_rate for extra days (different from regular rate)', () => {
      // Package: 3 included days, regular rate 2000/day, extra rate 1500/day
      // Stay: 5 days → 3 included + 2 extra at 1500
      const result = calculatePackageBedCharge({
        ratePerDay: 2000,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-05T10:00:00',
        includedBedDays: 3,
        extraBedRate: 1500,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(5);
      expect(result.chargeableDays).toBe(2);
      expect(result.chargeAmount).toBe(3000); // 2 * 1500, NOT 2 * 2000
      expect(result.includedDaysUsed).toBe(3);
      expect(result.extraDays).toBe(2);
    });

    it('handles same-day discharge within included days', () => {
      const result = calculatePackageBedCharge({
        ratePerDay: 1500,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-01T18:00:00',
        includedBedDays: 3,
        extraBedRate: 1500,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(1);
      expect(result.chargeableDays).toBe(0);
      expect(result.chargeAmount).toBe(0);
    });

    it('handles stay exactly equal to included days', () => {
      const result = calculatePackageBedCharge({
        ratePerDay: 1500,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-03T10:00:00',
        includedBedDays: 3,
        extraBedRate: 1500,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(3);
      expect(result.chargeableDays).toBe(0);
      expect(result.chargeAmount).toBe(0);
      expect(result.includedDaysUsed).toBe(3);
      expect(result.extraDays).toBe(0);
    });

    it('handles null endedOn (still admitted) using current date', () => {
      const result = calculatePackageBedCharge({
        ratePerDay: 1500,
        startedOn: '2026-06-01T10:00:00',
        endedOn: null,
        includedBedDays: 3,
        extraBedRate: 1500,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBeGreaterThanOrEqual(1);
      expect(result.chargeableDays).toBeGreaterThanOrEqual(0);
      expect(result.chargeAmount).toBeGreaterThanOrEqual(0);
    });

    it('falls back to ratePerDay when extraBedRate is 0', () => {
      // Standard package: no included days, no extra rate → use regular rate
      const result = calculatePackageBedCharge({
        ratePerDay: 1500,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-03T10:00:00',
        includedBedDays: 0,
        extraBedRate: 0,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(3);
      expect(result.chargeableDays).toBe(3);
      expect(result.chargeAmount).toBe(4500); // uses ratePerDay when extraBedRate is 0
    });

    it('handles 1-day stay with 3 included days', () => {
      const result = calculatePackageBedCharge({
        ratePerDay: 2000,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-01T18:00:00',
        includedBedDays: 3,
        extraBedRate: 1500,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(1);
      expect(result.includedDaysUsed).toBe(1);
      expect(result.extraDays).toBe(0);
      expect(result.chargeAmount).toBe(0);
    });

    it('handles 10-day stay with 3 included days and different extra rate', () => {
      const result = calculatePackageBedCharge({
        ratePerDay: 3000,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-10T10:00:00',
        includedBedDays: 3,
        extraBedRate: 2000,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(10);
      expect(result.includedDaysUsed).toBe(3);
      expect(result.extraDays).toBe(7);
      expect(result.chargeAmount).toBe(14000); // 7 * 2000
    });

    it('handles very long stay with package', () => {
      const result = calculatePackageBedCharge({
        ratePerDay: 1500,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-07-01T10:00:00',
        includedBedDays: 3,
        extraBedRate: 1500,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(31);
      expect(result.includedDaysUsed).toBe(3);
      expect(result.extraDays).toBe(28);
      expect(result.chargeAmount).toBe(42000); // 28 * 1500
    });

    it('handles package with 1 included day (overnight package)', () => {
      const result = calculatePackageBedCharge({
        ratePerDay: 2000,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-02T10:00:00',
        includedBedDays: 1,
        extraBedRate: 1500,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(2);
      expect(result.includedDaysUsed).toBe(1);
      expect(result.extraDays).toBe(1);
      expect(result.chargeAmount).toBe(1500); // 1 * 1500
    });

    it('handles package where extra_bed_rate is less than rate_per_day', () => {
      // Discounted extra rate for loyal patients
      const result = calculatePackageBedCharge({
        ratePerDay: 3000,
        startedOn: '2026-06-01T10:00:00',
        endedOn: '2026-06-05T10:00:00',
        includedBedDays: 2,
        extraBedRate: 1000,
        bedChargePolicy: CALENDAR_POLICY,
      });
      expect(result.days).toBe(5);
      expect(result.includedDaysUsed).toBe(2);
      expect(result.extraDays).toBe(3);
      expect(result.chargeAmount).toBe(3000); // 3 * 1000 (discounted rate)
    });
  });

  describe('calculateAdmissionPackageBilling', () => {
    it('adds package price and only charges bed days beyond included days', () => {
      const result = calculateAdmissionPackageBilling({
        packageInfo: {
          totalPrice: 25000,
          packageType: 'package_included_days',
          includedBedDays: 3,
          extraBedRate: 1500,
        },
        provisionalTotal: 2000,
        beds: [{
          id: 1,
          ratePerDay: 2000,
          startedOn: '2026-06-01T10:00:00',
          endedOn: '2026-06-05T10:00:00',
        }],
      });

      expect(result.packageTotal).toBe(25000);
      expect(result.bedTotal).toBe(1500);
      expect(result.grandTotal).toBe(28500);
      expect(result.bedChargeSegments[0]).toMatchObject({
        days: 4,
        included_days_used: 3,
        extra_days: 1,
        charge_amount: 1500,
      });
    });

    it('uses configured per-day bed rate for package plus bed', () => {
      const result = calculateAdmissionPackageBilling({
        packageInfo: {
          totalPrice: 10000,
          packageType: 'package_plus_bed',
          includedBedDays: 0,
          extraBedRate: 1200,
        },
        provisionalTotal: 0,
        beds: [{
          id: 1,
          ratePerDay: 2000,
          startedOn: '2026-06-01T10:00:00',
          endedOn: '2026-06-02T10:00:00',
        }],
      });

      expect(result.packageTotal).toBe(10000);
      expect(result.bedTotal).toBe(1200);
      expect(result.grandTotal).toBe(11200);
      expect(result.bedChargeSegments[0]).toMatchObject({
        days: 1,
        charge_amount: 1200,
      });
    });
  });
});
