import { describe, expect, it } from 'vitest';
import { calculateAdmissionPackageBilling } from '../src/lib/bed-charges';

const CALENDAR_POLICY = {
  dayCountMode: 'calendar_day_inclusive' as const,
  graceHours: 0,
  partialDayMode: 'full_day' as const,
  halfDayAfterHours: 0,
  halfDayRatio: 0.5,
  checkInHour: 11,
  earlyCheckInGraceHours: 0,
};

describe('IPD package bed charges', () => {
  it('charges only extra bed days beyond package-included days', () => {
    const result = calculateAdmissionPackageBilling({
      packageInfo: {
        totalPrice: 25000,
        packageType: 'package_included_days',
        includedBedDays: 2,
        extraBedRate: 9999,
      },
      provisionalTotal: 500,
      bedChargePolicy: CALENDAR_POLICY,
      beds: [
        {
          id: 1,
          ratePerDay: 3000,
          startedOn: '2026-06-01T00:00:00.000Z',
          endedOn: '2026-06-04T00:00:00.000Z',
        },
      ],
    });

    expect(result.packageTotal).toBe(25000);
    expect(result.bedTotal).toBe(19998);
    expect(result.grandTotal).toBe(45498);
    expect(result.bedChargeSegments[0]).toMatchObject({
      days: 4,
      chargeable_days: 2,
      charge_amount: 19998,
      included_days_used: 2,
      extra_days: 2,
    });
  });

  it('charges package-plus-bed admissions from the configured package bed rate', () => {
    const result = calculateAdmissionPackageBilling({
      packageInfo: {
        totalPrice: 12000,
        packageType: 'package_plus_bed',
        includedBedDays: 0,
        extraBedRate: 9999,
      },
      provisionalTotal: 0,
      bedChargePolicy: CALENDAR_POLICY,
      beds: [
        {
          id: 2,
          ratePerDay: 1500,
          startedOn: '2026-06-01T00:00:00.000Z',
          endedOn: '2026-06-03T00:00:00.000Z',
        },
      ],
    });

    expect(result.packageTotal).toBe(12000);
    expect(result.bedTotal).toBe(29997);
    expect(result.grandTotal).toBe(41997);
    expect(result.bedChargeSegments[0]).toMatchObject({
      days: 3,
      chargeable_days: 3,
      charge_amount: 29997,
      included_days_used: 0,
      extra_days: 3,
    });
  });
});
