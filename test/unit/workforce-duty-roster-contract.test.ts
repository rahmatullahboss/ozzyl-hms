import { describe, expect, it } from 'vitest';
import {
  assignRosterSchema,
  bulkAssignRosterSchema,
  generateRosterSchema,
  createRotationSchema,
  assignRotationSchema,
  createHolidaySchema,
  createOvertimeRuleSchema,
} from '../../src/schemas/hr';

export const rosterContractFixtures = {
  assign: {
    staffId: 21,
    shiftId: 3,
    rosterDate: '2026-07-27',
    remarks: 'ICU coverage',
    idempotencyKey: 'roster:assign:21:2026-07-27:3',
  },
  bulk: {
    assignments: [{ staffId: 21, shiftId: 3 }],
    startDate: '2026-07-27',
    endDate: '2026-07-31',
    dateMode: 'all_dates',
    idempotencyKey: 'roster:bulk:icu:2026-07-27:2026-07-31',
  },
  generate: {
    startDate: '2026-07-27',
    endDate: '2026-07-31',
    replaceExisting: false,
    idempotencyKey: 'roster:generate:2026-07-27:2026-07-31',
  },
  rotation: {
    patternName: 'ICU weekly',
    cycleDays: 7,
    days: [
      { dayNumber: 1, shiftId: 3, isOff: false },
      { dayNumber: 2, shiftId: null, isOff: true },
    ],
    idempotencyKey: 'rotation:create:icu-weekly',
  },
  rotationAssign: {
    staffId: 21,
    patternId: 5,
    startDate: '2026-07-27',
    cycleOffset: 0,
    idempotencyKey: 'rotation:assign:21:5:2026-07-27',
  },
  holiday: {
    holidayName: 'Victory Day',
    holidayDate: '2026-12-16',
    holidayType: 'public',
  },
  overtime: {
    ruleName: 'Weekday overtime',
    multiplier: 1.5,
    minHoursBeforeOt: 8,
    maxOtHoursPerDay: 4,
    appliesOn: 'weekday',
  },
} as const;

describe('workforce duty-roster public contracts', () => {
  it('preserves every documented request fixture exactly', () => {
    expect(assignRosterSchema.parse(rosterContractFixtures.assign)).toEqual(rosterContractFixtures.assign);
    expect(bulkAssignRosterSchema.parse(rosterContractFixtures.bulk)).toEqual(rosterContractFixtures.bulk);
    expect(generateRosterSchema.parse(rosterContractFixtures.generate)).toEqual(rosterContractFixtures.generate);
    expect(createRotationSchema.parse(rosterContractFixtures.rotation)).toEqual(rosterContractFixtures.rotation);
    expect(assignRotationSchema.parse(rosterContractFixtures.rotationAssign)).toEqual(rosterContractFixtures.rotationAssign);
    expect(createHolidaySchema.parse(rosterContractFixtures.holiday)).toEqual(rosterContractFixtures.holiday);
    expect(createOvertimeRuleSchema.parse(rosterContractFixtures.overtime)).toEqual(rosterContractFixtures.overtime);
  });
});
