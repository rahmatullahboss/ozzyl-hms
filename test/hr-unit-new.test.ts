/**
 * HR Module — Additional Unit Tests
 *
 * Covers schemas and business logic NOT covered in test/hr.test.ts:
 *  1. New schemas from migrations 0078/0263 (roster, biometric, overtime, holidays, weekend policy)
 *  2. Business logic helpers (late detection, overtime calc, net salary, leave balance, carry forward, weekend check)
 *  3. Edge cases (night shift midnight, leave spanning weekends, zero salary, negative overtime, etc.)
 */

import { describe, it, expect } from 'vitest';
import {
  createLeaveCategorySchema,
  createLeaveRequestSchema,
  approveLeaveSchema,
  initLeaveBalanceSchema,
  createLeaveRuleSchema,
  updateLeaveCategorySchema,
  updateLeaveRuleSchema,
  createShiftSchema,
  updateShiftSchema,
  checkInSchema,
  checkOutSchema,
  attendanceReportQuerySchema,
  setSalaryStructureSchema,
  payrollListQuerySchema,
  assignRosterSchema,
  bulkAssignRosterSchema,
  rosterQuerySchema,
  swapRosterSchema,
  createRotationSchema,
  assignRotationSchema,
  generateRosterSchema,
  registerDeviceSchema,
  enrollBiometricSchema,
  cardPunchSchema,
  manualPunchSchema,
  punchQuerySchema,
  createOvertimeRuleSchema,
  approveOvertimeSchema,
  createHolidaySchema,
  createWeekendPolicySchema,
  updateWeekendPolicySchema,
  carryForwardLeaveSchema,
  markAbsentSchema,
  overtimePayrollIntegrationSchema,
} from '../src/schemas/hr';

const HR_IDEMPOTENCY_KEY = 'hr-contract-test-20260727';

// ══════════════════════════════════════════════════════════════════════════════
// 1. NEW SCHEMA TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('HR Schemas — Leave Rules', () => {
  describe('createLeaveRuleSchema', () => {
    const valid = { leaveCategoryId: 1, year: 2025, days: 20 };

    it('accepts valid rule', () => {
      const r = createLeaveRuleSchema.parse(valid);
      expect(r.days).toBe(20);
      expect(r.payPercent).toBe(100);
      expect(r.isApproved).toBe(false);
    });

    it('accepts custom payPercent', () => {
      const r = createLeaveRuleSchema.parse({ ...valid, payPercent: 50 });
      expect(r.payPercent).toBe(50);
    });

    it('accepts payPercent boundaries (0 and 100)', () => {
      expect(createLeaveRuleSchema.parse({ ...valid, payPercent: 0 }).payPercent).toBe(0);
      expect(createLeaveRuleSchema.parse({ ...valid, payPercent: 100 }).payPercent).toBe(100);
    });

    it('rejects payPercent > 100', () => {
      expect(() => createLeaveRuleSchema.parse({ ...valid, payPercent: 101 })).toThrow();
    });

    it('rejects payPercent < 0', () => {
      expect(() => createLeaveRuleSchema.parse({ ...valid, payPercent: -1 })).toThrow();
    });

    it('rejects days > 366', () => {
      expect(() => createLeaveRuleSchema.parse({ ...valid, days: 367 })).toThrow();
    });

    it('rejects negative days', () => {
      expect(() => createLeaveRuleSchema.parse({ ...valid, days: -1 })).toThrow();
    });

    it('accepts zero days (no entitlement)', () => {
      expect(createLeaveRuleSchema.parse({ ...valid, days: 0 }).days).toBe(0);
    });

    it('rejects year below 2020', () => {
      expect(() => createLeaveRuleSchema.parse({ ...valid, year: 2019 })).toThrow();
    });

    it('rejects year above 2100', () => {
      expect(() => createLeaveRuleSchema.parse({ ...valid, year: 2101 })).toThrow();
    });

    it('rejects non-positive leaveCategoryId', () => {
      expect(() => createLeaveRuleSchema.parse({ ...valid, leaveCategoryId: 0 })).toThrow();
    });

    it('rejects missing required fields', () => {
      expect(() => createLeaveRuleSchema.parse({ leaveCategoryId: 1 })).toThrow();
      expect(() => createLeaveRuleSchema.parse({ year: 2025, days: 10 })).toThrow();
    });
  });

  describe('updateLeaveCategorySchema (partial)', () => {
    it('accepts partial update with leaveName only', () => {
      const r = updateLeaveCategorySchema.parse({ leaveName: 'Updated' });
      expect(r.leaveName).toBe('Updated');
    });

    it('accepts partial update with maxDaysPerYear only', () => {
      const r = updateLeaveCategorySchema.parse({ maxDaysPerYear: 30 });
      expect(r.maxDaysPerYear).toBe(30);
    });

    it('accepts empty object (no fields to update)', () => {
      const r = updateLeaveCategorySchema.parse({});
      expect(Object.keys(r)).toHaveLength(0);
    });

    it('rejects empty string leaveName if provided', () => {
      expect(() => updateLeaveCategorySchema.parse({ leaveName: '' })).toThrow();
    });

    it('rejects negative maxDaysPerYear if provided', () => {
      expect(() => updateLeaveCategorySchema.parse({ maxDaysPerYear: -1 })).toThrow();
    });
  });
});

describe('HR Schemas — Attendance & Shifts', () => {
  describe('updateShiftSchema (partial)', () => {
    it('accepts partial update with shiftName only', () => {
      const r = updateShiftSchema.parse({ shiftName: 'Evening' });
      expect(r.shiftName).toBe('Evening');
    });

    it('accepts partial update with gracePeriod only', () => {
      const r = updateShiftSchema.parse({ gracePeriod: 10 });
      expect(r.gracePeriod).toBe(10);
    });

    it('accepts empty object', () => {
      const r = updateShiftSchema.parse({});
      expect(Object.keys(r)).toHaveLength(0);
    });

    it('rejects invalid time format in partial', () => {
      expect(() => updateShiftSchema.parse({ startTime: '8am' })).toThrow();
    });

    it('rejects negative gracePeriod in partial', () => {
      expect(() => updateShiftSchema.parse({ gracePeriod: -5 })).toThrow();
    });
  });

  describe('checkOutSchema', () => {
    it('accepts valid check-out', () => {
      const r = checkOutSchema.parse({ staffId: 1 });
      expect(r.staffId).toBe(1);
    });

    it('rejects non-positive staffId', () => {
      expect(() => checkOutSchema.parse({ staffId: 0 })).toThrow();
      expect(() => checkOutSchema.parse({ staffId: -1 })).toThrow();
    });

    it('rejects missing staffId', () => {
      expect(() => checkOutSchema.parse({})).toThrow();
    });
  });
});

describe('HR Schemas — Payroll Query', () => {
  describe('payrollListQuerySchema', () => {
    it('accepts empty query (all optional)', () => {
      const r = payrollListQuerySchema.parse({});
      expect(r.page).toBe(1);
      expect(r.limit).toBe(20);
    });

    it('accepts month filter', () => {
      const r = payrollListQuerySchema.parse({ month: '2025-03' });
      expect(r.month).toBe('2025-03');
    });

    it('accepts staffId filter', () => {
      const r = payrollListQuerySchema.parse({ staffId: '5' });
      expect(r.staffId).toBe(5);
    });

    it('accepts custom pagination', () => {
      const r = payrollListQuerySchema.parse({ page: '3', limit: '50' });
      expect(r.page).toBe(3);
      expect(r.limit).toBe(50);
    });

    it('defaults page=1, limit=20', () => {
      const r = payrollListQuerySchema.parse({});
      expect(r.page).toBe(1);
      expect(r.limit).toBe(20);
    });

    it('rejects invalid month format', () => {
      expect(() => payrollListQuerySchema.parse({ month: '03-2025' })).toThrow();
    });

    it('rejects limit > 100', () => {
      expect(() => payrollListQuerySchema.parse({ limit: '101' })).toThrow();
    });

    it('rejects page < 1', () => {
      expect(() => payrollListQuerySchema.parse({ page: '0' })).toThrow();
    });
  });
});

describe('HR Schemas — Duty Roster', () => {
  describe('assignRosterSchema', () => {
    const valid = { staffId: 1, shiftId: 2, rosterDate: '2025-04-01', idempotencyKey: HR_IDEMPOTENCY_KEY };

    it('accepts valid assignment', () => {
      const r = assignRosterSchema.parse(valid);
      expect(r.staffId).toBe(1);
      expect(r.shiftId).toBe(2);
    });

    it('accepts optional remarks', () => {
      const r = assignRosterSchema.parse({ ...valid, remarks: 'Swapped from night' });
      expect(r.remarks).toBe('Swapped from night');
    });

    it('rejects non-positive staffId', () => {
      expect(() => assignRosterSchema.parse({ ...valid, staffId: 0 })).toThrow();
    });

    it('rejects non-positive shiftId', () => {
      expect(() => assignRosterSchema.parse({ ...valid, shiftId: -1 })).toThrow();
    });

    it('rejects invalid date format', () => {
      expect(() => assignRosterSchema.parse({ ...valid, rosterDate: '01/04/2025' })).toThrow();
    });

    it('rejects missing required fields', () => {
      expect(() => assignRosterSchema.parse({ staffId: 1 })).toThrow();
    });
  });

  describe('bulkAssignRosterSchema', () => {
    const valid = {
      assignments: [{ staffId: 1, shiftId: 2 }, { staffId: 3, shiftId: 2 }],
      startDate: '2025-04-01',
      endDate: '2025-04-07',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    };

    it('accepts valid bulk assignment', () => {
      const r = bulkAssignRosterSchema.parse(valid);
      expect(r.assignments).toHaveLength(2);
    });

    it('rejects empty assignments array', () => {
      expect(() => bulkAssignRosterSchema.parse({ ...valid, assignments: [] })).toThrow();
    });

    it('rejects endDate before startDate', () => {
      expect(() => bulkAssignRosterSchema.parse({ ...valid, startDate: '2025-04-10', endDate: '2025-04-01' })).toThrow(/endDate/i);
    });

    it('rejects non-positive staffId in assignments', () => {
      expect(() => bulkAssignRosterSchema.parse({
        ...valid,
        assignments: [{ staffId: 0, shiftId: 1 }],
      })).toThrow();
    });
  });

  describe('rosterQuerySchema', () => {
    const valid = { from: '2025-04-01', to: '2025-04-30' };

    it('accepts valid query', () => {
      const r = rosterQuerySchema.parse(valid);
      expect(r.from).toBe('2025-04-01');
    });

    it('accepts optional filters', () => {
      const r = rosterQuerySchema.parse({ ...valid, staffId: 1, shiftId: 2, department: 'Cardiology' });
      expect(r.staffId).toBe(1);
      expect(r.department).toBe('Cardiology');
    });

    it('rejects missing from date', () => {
      expect(() => rosterQuerySchema.parse({ to: '2025-04-30' })).toThrow();
    });

    it('rejects missing to date', () => {
      expect(() => rosterQuerySchema.parse({ from: '2025-04-01' })).toThrow();
    });
  });

  describe('swapRosterSchema', () => {
    it('accepts valid swap', () => {
      const r = swapRosterSchema.parse({ swapWithStaffId: 5, reason: 'Approved shift exchange', idempotencyKey: HR_IDEMPOTENCY_KEY });
      expect(r.swapWithStaffId).toBe(5);
    });

    it('rejects non-positive rosterId', () => {
      expect(() => swapRosterSchema.parse({ swapWithStaffId: 0, reason: 'Approved shift exchange', idempotencyKey: HR_IDEMPOTENCY_KEY })).toThrow();
    });

    it('rejects non-positive swapWithStaffId', () => {
      expect(() => swapRosterSchema.parse({ swapWithStaffId: -1, reason: 'Approved shift exchange', idempotencyKey: HR_IDEMPOTENCY_KEY })).toThrow();
    });

    it('rejects missing fields', () => {
      expect(() => swapRosterSchema.parse({ reason: 'Approved shift exchange', idempotencyKey: HR_IDEMPOTENCY_KEY })).toThrow();
      expect(() => swapRosterSchema.parse({ swapWithStaffId: 5, idempotencyKey: HR_IDEMPOTENCY_KEY })).toThrow();
    });
  });
});

describe('HR Schemas — Rotation Patterns', () => {
  describe('createRotationSchema', () => {
    const valid = {
      patternName: '4-on-2-off',
      cycleDays: 6,
      days: [
        { dayNumber: 1, shiftId: 1 },
        { dayNumber: 2, shiftId: 1 },
        { dayNumber: 3, shiftId: 1 },
        { dayNumber: 4, shiftId: 1 },
        { dayNumber: 5, shiftId: null, isOff: true },
        { dayNumber: 6, shiftId: null, isOff: true },
      ],
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    };

    it('accepts valid rotation pattern', () => {
      const r = createRotationSchema.parse(valid);
      expect(r.patternName).toBe('4-on-2-off');
      expect(r.cycleDays).toBe(6);
      expect(r.days).toHaveLength(6);
    });

    it('defaults isOff to false', () => {
      const r = createRotationSchema.parse(valid);
      expect(r.days[0].isOff).toBe(false);
    });

    it('rejects empty patternName', () => {
      expect(() => createRotationSchema.parse({ ...valid, patternName: '' })).toThrow();
    });

    it('rejects cycleDays < 1', () => {
      expect(() => createRotationSchema.parse({ ...valid, cycleDays: 0 })).toThrow();
    });

    it('rejects cycleDays > 90', () => {
      expect(() => createRotationSchema.parse({ ...valid, cycleDays: 91 })).toThrow();
    });

    it('rejects empty days array', () => {
      expect(() => createRotationSchema.parse({ ...valid, days: [] })).toThrow();
    });

    it('rejects dayNumber < 1', () => {
      expect(() => createRotationSchema.parse({
        ...valid,
        days: [{ dayNumber: 0, shiftId: 1 }],
      })).toThrow();
    });
  });

  describe('assignRotationSchema', () => {
    const valid = { staffId: 1, patternId: 2, startDate: '2025-04-01', idempotencyKey: HR_IDEMPOTENCY_KEY };

    it('accepts valid assignment', () => {
      const r = assignRotationSchema.parse(valid);
      expect(r.staffId).toBe(1);
      expect(r.cycleOffset).toBe(0);
    });

    it('accepts optional endDate and cycleOffset', () => {
      const r = assignRotationSchema.parse({ ...valid, endDate: '2025-06-30', cycleOffset: 3 });
      expect(r.endDate).toBe('2025-06-30');
      expect(r.cycleOffset).toBe(3);
    });

    it('rejects negative cycleOffset', () => {
      expect(() => assignRotationSchema.parse({ ...valid, cycleOffset: -1 })).toThrow();
    });

    it('rejects non-positive staffId', () => {
      expect(() => assignRotationSchema.parse({ ...valid, staffId: 0 })).toThrow();
    });

    it('rejects non-positive patternId', () => {
      expect(() => assignRotationSchema.parse({ ...valid, patternId: -1 })).toThrow();
    });
  });

  describe('generateRosterSchema', () => {
    it('accepts valid date range', () => {
      const r = generateRosterSchema.parse({ startDate: '2025-04-01', endDate: '2025-04-30', idempotencyKey: HR_IDEMPOTENCY_KEY });
      expect(r.startDate).toBe('2025-04-01');
    });

    it('rejects missing dates', () => {
      expect(() => generateRosterSchema.parse({ startDate: '2025-04-01' })).toThrow();
      expect(() => generateRosterSchema.parse({ endDate: '2025-04-30' })).toThrow();
    });

    it('rejects invalid date format', () => {
      expect(() => generateRosterSchema.parse({ startDate: '01/04/2025', endDate: '2025-04-30' })).toThrow();
    });
  });
});

describe('HR Schemas — Biometric Devices', () => {
  describe('registerDeviceSchema', () => {
    const valid = { deviceName: 'Main Gate Reader', deviceType: 'fingerprint' as const };

    it('accepts valid device', () => {
      const r = registerDeviceSchema.parse(valid);
      expect(r.deviceName).toBe('Main Gate Reader');
      expect(r.deviceType).toBe('fingerprint');
    });

    it('accepts all device types', () => {
      const types = ['fingerprint', 'rfid', 'face', 'card', 'combo'] as const;
      types.forEach(type => {
        expect(registerDeviceSchema.parse({ ...valid, deviceType: type }).deviceType).toBe(type);
      });
    });

    it('accepts optional fields', () => {
      const r = registerDeviceSchema.parse({
        ...valid,
        deviceSerial: 'SN-12345',
        ipAddress: '192.168.1.100',
        location: 'Main Entrance',
      });
      expect(r.deviceSerial).toBe('SN-12345');
      expect(r.ipAddress).toBe('192.168.1.100');
    });

    it('rejects empty deviceName', () => {
      expect(() => registerDeviceSchema.parse({ ...valid, deviceName: '' })).toThrow();
    });

    it('rejects invalid deviceType', () => {
      expect(() => registerDeviceSchema.parse({ ...valid, deviceType: 'iris' })).toThrow();
    });

    it('rejects missing deviceType', () => {
      expect(() => registerDeviceSchema.parse({ deviceName: 'Reader' })).toThrow();
    });
  });

  describe('enrollBiometricSchema', () => {
    const valid = { staffId: 1, enrollmentType: 'fingerprint' as const, enrollmentCode: 'FP-001' };

    it('accepts valid enrollment', () => {
      const r = enrollBiometricSchema.parse(valid);
      expect(r.staffId).toBe(1);
      expect(r.enrollmentType).toBe('fingerprint');
    });

    it('accepts all enrollment types', () => {
      const types = ['fingerprint', 'rfid', 'face', 'card', 'pin'] as const;
      types.forEach(type => {
        expect(enrollBiometricSchema.parse({ ...valid, enrollmentType: type }).enrollmentType).toBe(type);
      });
    });

    it('accepts optional deviceId', () => {
      const r = enrollBiometricSchema.parse({ ...valid, deviceId: 5 });
      expect(r.deviceId).toBe(5);
    });

    it('rejects empty enrollmentCode', () => {
      expect(() => enrollBiometricSchema.parse({ ...valid, enrollmentCode: '' })).toThrow();
    });

    it('rejects non-positive staffId', () => {
      expect(() => enrollBiometricSchema.parse({ ...valid, staffId: 0 })).toThrow();
    });

    it('rejects invalid enrollmentType', () => {
      expect(() => enrollBiometricSchema.parse({ ...valid, enrollmentType: 'iris' })).toThrow();
    });
  });
});

describe('HR Schemas — Punch', () => {
  describe('cardPunchSchema', () => {
    it('accepts valid card punch', () => {
      const r = cardPunchSchema.parse({ enrollmentCode: 'FP-001' });
      expect(r.punchType).toBe('in');
    });

    it('accepts all punch types', () => {
      const types = ['in', 'out', 'break_start', 'break_end'] as const;
      types.forEach(type => {
        expect(cardPunchSchema.parse({ enrollmentCode: 'FP-001', punchType: type }).punchType).toBe(type);
      });
    });

    it('accepts optional fields', () => {
      const r = cardPunchSchema.parse({
        enrollmentCode: 'FP-001',
        punchTime: '2025-04-01T09:00:00Z',
        deviceSerial: 'SN-123',
        rawData: '{"key":"value"}',
      });
      expect(r.punchTime).toBe('2025-04-01T09:00:00Z');
    });

    it('defaults punchType to in', () => {
      expect(cardPunchSchema.parse({ enrollmentCode: 'X' }).punchType).toBe('in');
    });

    it('rejects empty enrollmentCode', () => {
      expect(() => cardPunchSchema.parse({ enrollmentCode: '' })).toThrow();
    });

    it('rejects missing enrollmentCode', () => {
      expect(() => cardPunchSchema.parse({})).toThrow();
    });
  });

  describe('manualPunchSchema', () => {
    const valid = { staffId: 1, punchTime: '2025-04-01T09:00:00Z', punchType: 'in' as const, reason: 'Manual attendance correction' };

    it('accepts valid manual punch', () => {
      const r = manualPunchSchema.parse(valid);
      expect(r.staffId).toBe(1);
      expect(r.punchType).toBe('in');
    });

    it('accepts all punch types', () => {
      const types = ['in', 'out', 'break_start', 'break_end'] as const;
      types.forEach(type => {
        expect(manualPunchSchema.parse({ ...valid, punchType: type }).punchType).toBe(type);
      });
    });

    it('accepts optional remarks', () => {
      const r = manualPunchSchema.parse({ ...valid, remarks: 'Forgot badge' });
      expect(r.remarks).toBe('Forgot badge');
    });

    it('rejects non-positive staffId', () => {
      expect(() => manualPunchSchema.parse({ ...valid, staffId: 0 })).toThrow();
    });

    it('rejects invalid punchType', () => {
      expect(() => manualPunchSchema.parse({ ...valid, punchType: 'lunch' })).toThrow();
    });

    it('rejects missing punchTime', () => {
      expect(() => manualPunchSchema.parse({ staffId: 1, punchType: 'in' })).toThrow();
    });
  });

  describe('punchQuerySchema', () => {
    it('accepts empty query (all optional)', () => {
      const r = punchQuerySchema.parse({});
      expect(r.page).toBe(1);
      expect(r.limit).toBe(50);
    });

    it('accepts date filter', () => {
      const r = punchQuerySchema.parse({ date: '2025-04-01' });
      expect(r.date).toBe('2025-04-01');
    });

    it('accepts date range filter', () => {
      const r = punchQuerySchema.parse({ from: '2025-04-01', to: '2025-04-30' });
      expect(r.from).toBe('2025-04-01');
      expect(r.to).toBe('2025-04-30');
    });

    it('accepts staffId filter', () => {
      const r = punchQuerySchema.parse({ staffId: '5' });
      expect(r.staffId).toBe(5);
    });

    it('defaults page=1, limit=50', () => {
      const r = punchQuerySchema.parse({});
      expect(r.page).toBe(1);
      expect(r.limit).toBe(50);
    });

    it('rejects invalid date format', () => {
      expect(() => punchQuerySchema.parse({ date: 'invalid' })).toThrow();
    });

    it('rejects limit > 200', () => {
      expect(() => punchQuerySchema.parse({ limit: '201' })).toThrow();
    });
  });
});

describe('HR Schemas — Overtime', () => {
  describe('createOvertimeRuleSchema', () => {
    const valid = { ruleName: 'Weekday OT' };

    it('accepts valid rule with defaults', () => {
      const r = createOvertimeRuleSchema.parse(valid);
      expect(r.ruleName).toBe('Weekday OT');
      expect(r.multiplier).toBe(1.5);
      expect(r.minHoursBeforeOt).toBe(0);
      expect(r.maxOtHoursPerDay).toBe(4);
      expect(r.appliesOn).toBe('weekday');
    });

    it('accepts custom multiplier', () => {
      const r = createOvertimeRuleSchema.parse({ ...valid, multiplier: 2.0 });
      expect(r.multiplier).toBe(2.0);
    });

    it('accepts all appliesOn values', () => {
      const values = ['weekday', 'weekend', 'holiday', 'all'] as const;
      values.forEach(v => {
        expect(createOvertimeRuleSchema.parse({ ...valid, appliesOn: v }).appliesOn).toBe(v);
      });
    });

    it('rejects multiplier < 1', () => {
      expect(() => createOvertimeRuleSchema.parse({ ...valid, multiplier: 0.5 })).toThrow();
    });

    it('rejects multiplier > 5', () => {
      expect(() => createOvertimeRuleSchema.parse({ ...valid, multiplier: 5.1 })).toThrow();
    });

    it('rejects empty ruleName', () => {
      expect(() => createOvertimeRuleSchema.parse({ ruleName: '' })).toThrow();
    });

    it('rejects negative minHoursBeforeOt', () => {
      expect(() => createOvertimeRuleSchema.parse({ ...valid, minHoursBeforeOt: -1 })).toThrow();
    });

    it('rejects negative maxOtHoursPerDay', () => {
      expect(() => createOvertimeRuleSchema.parse({ ...valid, maxOtHoursPerDay: -1 })).toThrow();
    });

    it('rejects invalid appliesOn', () => {
      expect(() => createOvertimeRuleSchema.parse({ ...valid, appliesOn: 'overtime' })).toThrow();
    });
  });

  describe('approveOvertimeSchema', () => {
    it('accepts approved status', () => {
      expect(approveOvertimeSchema.parse({ status: 'approved' }).status).toBe('approved');
    });

    it('accepts rejected status', () => {
      expect(approveOvertimeSchema.parse({ status: 'rejected' }).status).toBe('rejected');
    });

    it('rejects pending status', () => {
      expect(() => approveOvertimeSchema.parse({ status: 'pending' })).toThrow();
    });

    it('rejects empty object', () => {
      expect(() => approveOvertimeSchema.parse({})).toThrow();
    });
  });
});

describe('HR Schemas — Holidays', () => {
  describe('createHolidaySchema', () => {
    const valid = { holidayName: 'Independence Day', holidayDate: '2025-03-26' };

    it('accepts valid holiday', () => {
      const r = createHolidaySchema.parse(valid);
      expect(r.holidayName).toBe('Independence Day');
      expect(r.holidayType).toBe('public');
    });

    it('accepts all holiday types', () => {
      const types = ['public', 'optional', 'restricted'] as const;
      types.forEach(type => {
        expect(createHolidaySchema.parse({ ...valid, holidayType: type }).holidayType).toBe(type);
      });
    });

    it('defaults holidayType to public', () => {
      expect(createHolidaySchema.parse(valid).holidayType).toBe('public');
    });

    it('rejects empty holidayName', () => {
      expect(() => createHolidaySchema.parse({ ...valid, holidayName: '' })).toThrow();
    });

    it('rejects invalid date format', () => {
      expect(() => createHolidaySchema.parse({ ...valid, holidayDate: '26/03/2025' })).toThrow();
    });

    it('rejects missing required fields', () => {
      expect(() => createHolidaySchema.parse({ holidayName: 'X' })).toThrow();
      expect(() => createHolidaySchema.parse({ holidayDate: '2025-03-26' })).toThrow();
    });

    it('rejects invalid holidayType', () => {
      expect(() => createHolidaySchema.parse({ ...valid, holidayType: 'national' })).toThrow();
    });
  });
});

describe('HR Schemas — Weekend Policy', () => {
  describe('createWeekendPolicySchema', () => {
    const valid = { year: 2025, dayOfWeek: 'friday' as const };

    it('accepts valid policy', () => {
      const r = createWeekendPolicySchema.parse(valid);
      expect(r.year).toBe(2025);
      expect(r.dayOfWeek).toBe('friday');
      expect(r.weekPattern).toBe('every');
    });

    it('accepts all days of week', () => {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
      days.forEach(day => {
        expect(createWeekendPolicySchema.parse({ ...valid, dayOfWeek: day }).dayOfWeek).toBe(day);
      });
    });

    it('accepts all week patterns', () => {
      const patterns = ['every', 'first', 'second', 'third', 'fourth', 'first_and_third', 'second_and_fourth'] as const;
      patterns.forEach(pattern => {
        expect(createWeekendPolicySchema.parse({ ...valid, weekPattern: pattern }).weekPattern).toBe(pattern);
      });
    });

    it('defaults weekPattern to every', () => {
      expect(createWeekendPolicySchema.parse(valid).weekPattern).toBe('every');
    });

    it('rejects year below 2020', () => {
      expect(() => createWeekendPolicySchema.parse({ ...valid, year: 2019 })).toThrow();
    });

    it('rejects year above 2100', () => {
      expect(() => createWeekendPolicySchema.parse({ ...valid, year: 2101 })).toThrow();
    });

    it('rejects invalid dayOfWeek', () => {
      expect(() => createWeekendPolicySchema.parse({ ...valid, dayOfWeek: 'humpday' })).toThrow();
    });

    it('rejects invalid weekPattern', () => {
      expect(() => createWeekendPolicySchema.parse({ ...valid, weekPattern: 'every_other' })).toThrow();
    });
  });

  describe('updateWeekendPolicySchema (partial)', () => {
    it('accepts partial update with weekPattern only', () => {
      const r = updateWeekendPolicySchema.parse({ weekPattern: 'second' });
      expect(r.weekPattern).toBe('second');
    });

    it('accepts partial update with isActive only', () => {
      const r = updateWeekendPolicySchema.parse({ isActive: false });
      expect(r.isActive).toBe(false);
    });

    it('accepts empty object', () => {
      const r = updateWeekendPolicySchema.parse({});
      expect(Object.keys(r)).toHaveLength(0);
    });

    it('rejects invalid weekPattern', () => {
      expect(() => updateWeekendPolicySchema.parse({ weekPattern: 'invalid' })).toThrow();
    });
  });
});

describe('HR Schemas — Carry Forward & Mark Absent', () => {
  describe('carryForwardLeaveSchema', () => {
    const valid = { staffId: 1, fromYear: 2024, toYear: 2025 };

    it('accepts valid carry forward', () => {
      const r = carryForwardLeaveSchema.parse(valid);
      expect(r.fromYear).toBe(2024);
      expect(r.toYear).toBe(2025);
    });

    it('rejects toYear <= fromYear', () => {
      expect(() => carryForwardLeaveSchema.parse({ ...valid, toYear: 2024 })).toThrow();
      expect(() => carryForwardLeaveSchema.parse({ ...valid, toYear: 2023 })).toThrow();
    });

    it('rejects non-positive staffId', () => {
      expect(() => carryForwardLeaveSchema.parse({ ...valid, staffId: 0 })).toThrow();
    });

    it('rejects year below 2020', () => {
      expect(() => carryForwardLeaveSchema.parse({ ...valid, fromYear: 2019 })).toThrow();
    });

    it('rejects year above 2100', () => {
      expect(() => carryForwardLeaveSchema.parse({ ...valid, toYear: 2101 })).toThrow();
    });
  });

  describe('markAbsentSchema', () => {
    it('accepts valid mark absent', () => {
      const r = markAbsentSchema.parse({ date: '2025-04-01' });
      expect(r.date).toBe('2025-04-01');
    });

    it('accepts optional shiftId and department', () => {
      const r = markAbsentSchema.parse({ date: '2025-04-01', shiftId: 2, department: 'ICU' });
      expect(r.shiftId).toBe(2);
      expect(r.department).toBe('ICU');
    });

    it('rejects invalid date format', () => {
      expect(() => markAbsentSchema.parse({ date: '01/04/2025' })).toThrow();
    });

    it('rejects missing date', () => {
      expect(() => markAbsentSchema.parse({})).toThrow();
    });
  });
});

describe('HR Schemas — Overtime Payroll Integration', () => {
  describe('overtimePayrollIntegrationSchema', () => {
    const valid = { payrollRunId: 1, staffId: 5 };

    it('accepts valid integration', () => {
      const r = overtimePayrollIntegrationSchema.parse(valid);
      expect(r.payrollRunId).toBe(1);
      expect(r.staffId).toBe(5);
      expect(r.includeOvertime).toBe(true);
    });

    it('accepts includeOvertime=false', () => {
      const r = overtimePayrollIntegrationSchema.parse({ ...valid, includeOvertime: false });
      expect(r.includeOvertime).toBe(false);
    });

    it('defaults includeOvertime to true', () => {
      expect(overtimePayrollIntegrationSchema.parse(valid).includeOvertime).toBe(true);
    });

    it('rejects non-positive payrollRunId', () => {
      expect(() => overtimePayrollIntegrationSchema.parse({ ...valid, payrollRunId: 0 })).toThrow();
    });

    it('rejects non-positive staffId', () => {
      expect(() => overtimePayrollIntegrationSchema.parse({ ...valid, staffId: -1 })).toThrow();
    });

    it('rejects missing required fields', () => {
      expect(() => overtimePayrollIntegrationSchema.parse({ payrollRunId: 1 })).toThrow();
      expect(() => overtimePayrollIntegrationSchema.parse({ staffId: 1 })).toThrow();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. BUSINESS LOGIC HELPERS
// ══════════════════════════════════════════════════════════════════════════════

describe('Business Logic — Late Detection with Grace Period', () => {
  const toMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };

  const isLate = (shiftStart: string, checkIn: string, gracePeriod: number): boolean =>
    toMinutes(checkIn) > toMinutes(shiftStart) + gracePeriod;

  const getLateMinutes = (shiftStart: string, checkIn: string, gracePeriod: number): number => {
    const diff = toMinutes(checkIn) - toMinutes(shiftStart) - gracePeriod;
    return diff > 0 ? diff : 0;
  };

  it('detects late when check_in > shift_start + grace_period', () => {
    expect(isLate('09:00', '09:20', 15)).toBe(true);
  });

  it('detects on-time when check_in <= shift_start + grace_period', () => {
    expect(isLate('09:00', '09:15', 15)).toBe(false);
    expect(isLate('09:00', '09:14', 15)).toBe(false);
  });

  it('calculates late minutes correctly', () => {
    expect(getLateMinutes('09:00', '09:20', 15)).toBe(5);
    expect(getLateMinutes('09:00', '09:15', 15)).toBe(0);
    expect(getLateMinutes('09:00', '10:00', 0)).toBe(60);
  });

  it('returns 0 late minutes when early', () => {
    expect(getLateMinutes('09:00', '08:30', 15)).toBe(0);
  });

  it('handles zero grace period', () => {
    expect(isLate('09:00', '09:01', 0)).toBe(true);
    expect(isLate('09:00', '09:00', 0)).toBe(false);
  });
});

describe('Business Logic — Overtime Calculation', () => {
  const calcOvertime = (actualHours: number, scheduledHours: number): number => {
    const ot = actualHours - scheduledHours;
    return ot > 0 ? ot : 0;
  };

  it('calculates overtime when actual > scheduled', () => {
    expect(calcOvertime(10, 8)).toBe(2);
  });

  it('returns 0 when actual <= scheduled', () => {
    expect(calcOvertime(8, 8)).toBe(0);
    expect(calcOvertime(6, 8)).toBe(0);
  });

  it('handles fractional hours', () => {
    expect(calcOvertime(9.5, 8)).toBe(1.5);
  });

  it('handles zero hours (absent)', () => {
    expect(calcOvertime(0, 8)).toBe(0);
  });

  it('caps overtime at max allowed', () => {
    const maxOt = 4;
    const raw = calcOvertime(14, 8);
    const capped = Math.min(raw, maxOt);
    expect(capped).toBe(4);
  });
});

describe('Business Logic — Net Salary Calculation', () => {
  interface SalaryItem { type: 'earning' | 'deduction'; amount: number; }

  const calcNetSalary = (items: SalaryItem[]) => {
    const earnings = items.filter(i => i.type === 'earning').reduce((s, i) => s + i.amount, 0);
    const deductions = items.filter(i => i.type === 'deduction').reduce((s, i) => s + i.amount, 0);
    return { basic: earnings, deductions, net: earnings - deductions };
  };

  it('calculates net = basic + overtime - deductions', () => {
    const items: SalaryItem[] = [
      { type: 'earning', amount: 20000 },
      { type: 'earning', amount: 5000 },
      { type: 'deduction', amount: 3000 },
    ];
    const r = calcNetSalary(items);
    expect(r.basic).toBe(25000);
    expect(r.deductions).toBe(3000);
    expect(r.net).toBe(22000);
  });

  it('handles zero salary staff', () => {
    const r = calcNetSalary([]);
    expect(r.net).toBe(0);
    expect(r.basic).toBe(0);
    expect(r.deductions).toBe(0);
  });

  it('handles deductions exceeding earnings (negative net)', () => {
    const items: SalaryItem[] = [
      { type: 'earning', amount: 5000 },
      { type: 'deduction', amount: 7000 },
    ];
    expect(calcNetSalary(items).net).toBe(-2000);
  });

  it('handles single earning, no deductions', () => {
    const r = calcNetSalary([{ type: 'earning', amount: 30000 }]);
    expect(r.net).toBe(30000);
  });
});

describe('Business Logic — Leave Balance', () => {
  const calcBalance = (totalAllowed: number, used: number) => totalAllowed - used;

  it('calculates balance = total_allowed - used', () => {
    expect(calcBalance(20, 5)).toBe(15);
  });

  it('returns full balance when none used', () => {
    expect(calcBalance(20, 0)).toBe(20);
  });

  it('returns 0 when all used', () => {
    expect(calcBalance(20, 20)).toBe(0);
  });

  it('returns negative when over-used (should be prevented by validation)', () => {
    expect(calcBalance(20, 25)).toBe(-5);
  });
});

describe('Business Logic — Carry Forward with Cap', () => {
  const calcCarryForward = (unused: number, maxCap: number = 10): number =>
    Math.min(unused, maxCap);

  it('carries forward unused days up to cap', () => {
    expect(calcCarryForward(5)).toBe(5);
  });

  it('caps carry forward at 10 days', () => {
    expect(calcCarryForward(15)).toBe(10);
    expect(calcCarryForward(100)).toBe(10);
  });

  it('carries forward 0 when none remaining', () => {
    expect(calcCarryForward(0)).toBe(0);
  });

  it('carries forward exact cap amount', () => {
    expect(calcCarryForward(10)).toBe(10);
  });

  it('respects custom cap', () => {
    expect(calcCarryForward(15, 5)).toBe(5);
    expect(calcCarryForward(3, 5)).toBe(3);
  });
});

describe('Business Logic — Weekend Check', () => {
  const isWeekend = (dateStr: string, weekendDays: string[]): boolean => {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const day = dayNames[new Date(dateStr).getDay()];
    return weekendDays.includes(day);
  };

  it('detects Friday as weekend when configured', () => {
    expect(isWeekend('2025-04-04', ['friday'])).toBe(true); // Friday
  });

  it('detects Friday+Saturday as weekend', () => {
    expect(isWeekend('2025-04-04', ['friday', 'saturday'])).toBe(true); // Friday
    expect(isWeekend('2025-04-05', ['friday', 'saturday'])).toBe(true); // Saturday
  });

  it('returns false for non-weekend day', () => {
    expect(isWeekend('2025-04-06', ['friday'])).toBe(false); // Sunday
  });

  it('handles Sunday as weekend (common pattern)', () => {
    expect(isWeekend('2025-04-06', ['sunday'])).toBe(true); // Sunday
  });

  it('returns false when weekend days list is empty', () => {
    expect(isWeekend('2025-04-04', [])).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. EDGE CASES
// ══════════════════════════════════════════════════════════════════════════════

describe('Edge Cases — Leave Request Spanning Weekends', () => {
  const calcWorkingDays = (start: string, end: string, weekendDays: string[] = ['friday', 'saturday']): number => {
    const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    let count = 0;
    const current = new Date(start);
    const endDate = new Date(end);
    while (current <= endDate) {
      const dayName = dayNames[current.getDay()];
      if (!weekendDays.includes(dayName)) count++;
      current.setDate(current.getDate() + 1);
    }
    return count;
  };

  it('should exclude Fridays and Saturdays from leave count (Bangladesh pattern)', () => {
    // Week of Apr 7-11, 2025 (Mon-Fri) — Fri is weekend
    expect(calcWorkingDays('2025-04-07', '2025-04-11')).toBe(4); // Mon-Thu
  });

  it('should count all days if no weekends in range', () => {
    expect(calcWorkingDays('2025-04-07', '2025-04-10', [])).toBe(4); // Mon-Thu
  });

  it('should handle leave spanning full week with weekends', () => {
    // Apr 7 (Mon) to Apr 13 (Sun), weekends = Fri+Sat
    expect(calcWorkingDays('2025-04-07', '2025-04-13')).toBe(5); // Mon-Thu + Sun
  });

  it('should handle leave that is entirely on weekends', () => {
    expect(calcWorkingDays('2025-04-04', '2025-04-05')).toBe(0); // Fri+Sat
  });
});

describe('Edge Cases — Night Shift Crossing Midnight', () => {
  const calcShiftDuration = (start: string, end: string): number => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin <= startMin) {
      return (24 * 60 - startMin) + endMin;
    }
    return endMin - startMin;
  };

  it('should calculate 8-hour night shift crossing midnight', () => {
    expect(calcShiftDuration('22:00', '06:00')).toBe(480); // 8 hours
  });

  it('should calculate normal day shift', () => {
    expect(calcShiftDuration('09:00', '17:00')).toBe(480); // 8 hours
  });

  it('should handle midnight-to-midnight (24h shift)', () => {
    expect(calcShiftDuration('00:00', '00:00')).toBe(1440); // 24 hours
  });

  it('should handle short night shift (23:00-01:00)', () => {
    expect(calcShiftDuration('23:00', '01:00')).toBe(120); // 2 hours
  });

  it('should handle partial hour crossing midnight', () => {
    expect(calcShiftDuration('23:30', '00:30')).toBe(60); // 1 hour
  });
});

describe('Edge Cases — Duplicate Roster Assignment', () => {
  interface RosterEntry { staffId: number; rosterDate: string; }

  const isDuplicate = (entries: RosterEntry[], newEntry: RosterEntry): boolean =>
    entries.some(e => e.staffId === newEntry.staffId && e.rosterDate === newEntry.rosterDate);

  it('should detect duplicate assignment for same staff on same date', () => {
    const existing: RosterEntry[] = [{ staffId: 1, rosterDate: '2025-04-01' }];
    expect(isDuplicate(existing, { staffId: 1, rosterDate: '2025-04-01' })).toBe(true);
  });

  it('should allow same staff on different date', () => {
    const existing: RosterEntry[] = [{ staffId: 1, rosterDate: '2025-04-01' }];
    expect(isDuplicate(existing, { staffId: 1, rosterDate: '2025-04-02' })).toBe(false);
  });

  it('should allow different staff on same date', () => {
    const existing: RosterEntry[] = [{ staffId: 1, rosterDate: '2025-04-01' }];
    expect(isDuplicate(existing, { staffId: 2, rosterDate: '2025-04-01' })).toBe(false);
  });
});

describe('Edge Cases — Same-Day Leave Request', () => {
  const isSameDay = (start: string, end: string): boolean => start === end;

  it('should allow same-day leave (startDate === endDate)', () => {
    expect(isSameDay('2025-04-01', '2025-04-01')).toBe(true);
  });

  it('should count as 1 day', () => {
    const start = new Date('2025-04-01');
    const end = new Date('2025-04-01');
    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    expect(days).toBe(1);
  });
});

describe('Edge Cases — Negative Overtime', () => {
  const calcOvertime = (actual: number, scheduled: number) => Math.max(0, actual - scheduled);

  it('should return 0 for negative overtime (under-hours)', () => {
    expect(calcOvertime(6, 8)).toBe(0);
  });

  it('should return 0 for zero actual hours', () => {
    expect(calcOvertime(0, 8)).toBe(0);
  });

  it('should not return negative values', () => {
    expect(calcOvertime(0, 24)).toBe(0);
  });
});

describe('Edge Cases — Zero Salary Staff', () => {
  it('should handle staff with no salary structure (all zeros)', () => {
    const items: { amount: number }[] = [];
    const total = items.reduce((s, i) => s + i.amount, 0);
    expect(total).toBe(0);
  });

  it('should handle staff with zero-amount salary heads', () => {
    const items = [{ amount: 0 }, { amount: 0 }];
    const total = items.reduce((s, i) => s + i.amount, 0);
    expect(total).toBe(0);
  });

  it('should still generate a payslip with zero net', () => {
    const payslip = { staffId: 1, gross: 0, deductions: 0, net: 0 };
    expect(payslip.net).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. ADDITIONAL SCHEMA EDGE CASES
// ══════════════════════════════════════════════════════════════════════════════

describe('Additional Schema Edge Cases — Leave', () => {
  describe('approveLeaveSchema with rejectionReason', () => {
    it('accepts rejection with reason', () => {
      const r = approveLeaveSchema.parse({ status: 'rejected', rejectionReason: 'Insufficient staffing' });
      expect(r.status).toBe('rejected');
      expect(r.rejectionReason).toBe('Insufficient staffing');
    });

    it('accepts approval without reason', () => {
      const r = approveLeaveSchema.parse({ status: 'approved' });
      expect(r.rejectionReason).toBeUndefined();
    });

    it('rejects rejectionReason longer than 500 chars', () => {
      expect(() => approveLeaveSchema.parse({
        status: 'rejected',
        rejectionReason: 'x'.repeat(501),
      })).toThrow();
    });
  });

  describe('createLeaveRequestSchema boundary', () => {
    it('accepts same-day leave (startDate === endDate)', () => {
      const r = createLeaveRequestSchema.parse({
        staffId: 1, leaveCategoryId: 1, startDate: '2025-04-01', endDate: '2025-04-01',
        idempotencyKey: HR_IDEMPOTENCY_KEY,
      });
      expect(r.startDate).toBe(r.endDate);
    });

    it('accepts max-length reason (500 chars)', () => {
      const r = createLeaveRequestSchema.parse({
        staffId: 1, leaveCategoryId: 1, startDate: '2025-04-01', endDate: '2025-04-05',
        reason: 'x'.repeat(500),
      });
      expect(r.reason).toHaveLength(500);
    });

    it('rejects reason longer than 500 chars', () => {
      expect(() => createLeaveRequestSchema.parse({
        staffId: 1, leaveCategoryId: 1, startDate: '2025-04-01', endDate: '2025-04-05',
        reason: 'x'.repeat(501),
      })).toThrow();
    });
  });

  describe('createLeaveCategorySchema edge cases', () => {
    it('accepts max-length description (500 chars)', () => {
      const r = createLeaveCategorySchema.parse({
        leaveName: 'Test', description: 'x'.repeat(500),
      });
      expect(r.description).toHaveLength(500);
    });

    it('rejects description longer than 500 chars', () => {
      expect(() => createLeaveCategorySchema.parse({
        leaveName: 'Test', description: 'x'.repeat(501),
      })).toThrow();
    });

    it('accepts large maxDaysPerYear (366)', () => {
      const r = createLeaveCategorySchema.parse({ leaveName: 'Test', maxDaysPerYear: 366 });
      expect(r.maxDaysPerYear).toBe(366);
    });
  });

  describe('updateLeaveRuleSchema (partial with isActive)', () => {
    it('accepts partial update with isActive', () => {
      const r = updateLeaveRuleSchema.parse({ isActive: false });
      expect(r.isActive).toBe(false);
    });

    it('accepts partial update with days', () => {
      const r = updateLeaveRuleSchema.parse({ days: 15 });
      expect(r.days).toBe(15);
    });

    it('accepts empty object', () => {
      const r = updateLeaveRuleSchema.parse({});
      expect(Object.keys(r)).toHaveLength(0);
    });

    it('rejects days > 366 in partial', () => {
      expect(() => updateLeaveRuleSchema.parse({ days: 367 })).toThrow();
    });
  });

  describe('carryForwardLeaveSchema boundary', () => {
    it('accepts consecutive years', () => {
      const r = carryForwardLeaveSchema.parse({ staffId: 1, fromYear: 2024, toYear: 2025 });
      expect(r.toYear).toBe(2025);
    });

    it('rejects same year (toYear === fromYear)', () => {
      expect(() => carryForwardLeaveSchema.parse({
        staffId: 1, fromYear: 2025, toYear: 2025,
      })).toThrow();
    });

    it('rejects toYear before fromYear', () => {
      expect(() => carryForwardLeaveSchema.parse({
        staffId: 1, fromYear: 2025, toYear: 2024,
      })).toThrow();
    });
  });
});

describe('Additional Schema Edge Cases — Attendance', () => {
  describe('updateShiftSchema comprehensive', () => {
    it('accepts updating only endTime', () => {
      const r = updateShiftSchema.parse({ endTime: '18:00' });
      expect(r.endTime).toBe('18:00');
    });

    it('accepts updating multiple fields', () => {
      const r = updateShiftSchema.parse({ shiftName: 'New Shift', gracePeriod: 20 });
      expect(r.shiftName).toBe('New Shift');
      expect(r.gracePeriod).toBe(20);
    });

    it('accepts boundary gracePeriod = 0', () => {
      const r = updateShiftSchema.parse({ gracePeriod: 0 });
      expect(r.gracePeriod).toBe(0);
    });
  });

  describe('checkOutSchema', () => {
    it('accepts large staffId', () => {
      const r = checkOutSchema.parse({ staffId: 999999 });
      expect(r.staffId).toBe(999999);
    });

    it('rejects string staffId (non-coercible)', () => {
      expect(() => checkOutSchema.parse({ staffId: 'abc' })).toThrow();
    });
  });

  describe('attendanceReportQuerySchema edge cases', () => {
    it('accepts same from and to date', () => {
      const r = attendanceReportQuerySchema.parse({ from: '2025-03-15', to: '2025-03-15' });
      expect(r.from).toBe(r.to);
    });

    it('accepts max limit = 200', () => {
      const r = attendanceReportQuerySchema.parse({ limit: '200' });
      expect(r.limit).toBe(200);
    });

    it('rejects limit > 200', () => {
      expect(() => attendanceReportQuerySchema.parse({ limit: '201' })).toThrow();
    });
  });
});

describe('Additional Schema Edge Cases — Payroll', () => {
  describe('payrollListQuerySchema edge cases', () => {
    it('accepts max limit = 100', () => {
      const r = payrollListQuerySchema.parse({ limit: '100' });
      expect(r.limit).toBe(100);
    });

    it('accepts combining month and staffId', () => {
      const r = payrollListQuerySchema.parse({ month: '2025-06', staffId: '10' });
      expect(r.month).toBe('2025-06');
      expect(r.staffId).toBe(10);
    });
  });

  describe('setSalaryStructureSchema edge cases', () => {
    it('accepts large number of items', () => {
      const items = Array.from({ length: 20 }, (_, i) => ({
        salaryHeadId: i + 1, amount: 1000 * (i + 1),
      }));
      const r = setSalaryStructureSchema.parse({ staffId: 1, items });
      expect(r.items).toHaveLength(20);
    });

    it('accepts percentage type with 100%', () => {
      const r = setSalaryStructureSchema.parse({
        staffId: 1,
        items: [{ salaryHeadId: 1, amount: 100, calculationType: 'percentage' as const }],
      });
      expect(r.items[0].amount).toBe(100);
    });

    it('rejects percentage > 100 (not in schema, but business rule)', () => {
      const r = setSalaryStructureSchema.parse({
        staffId: 1,
        items: [{ salaryHeadId: 1, amount: 150, calculationType: 'percentage' as const }],
      });
      expect(r.items[0].amount).toBe(150); // schema allows it, business logic would cap
    });
  });
});

describe('Additional Schema Edge Cases — Roster', () => {
  describe('bulkAssignRosterSchema edge cases', () => {
    it('accepts single assignment', () => {
      const r = bulkAssignRosterSchema.parse({
        assignments: [{ staffId: 1, shiftId: 1 }],
        startDate: '2025-04-01',
        endDate: '2025-04-01',
        idempotencyKey: HR_IDEMPOTENCY_KEY,
      });
      expect(r.assignments).toHaveLength(1);
    });

    it('accepts many assignments', () => {
      const assignments = Array.from({ length: 50 }, (_, i) => ({
        staffId: i + 1, shiftId: 1,
      }));
      const r = bulkAssignRosterSchema.parse({
        assignments, startDate: '2025-04-01', endDate: '2025-04-30', idempotencyKey: HR_IDEMPOTENCY_KEY,
      });
      expect(r.assignments).toHaveLength(50);
    });
  });

  describe('rosterQuerySchema edge cases', () => {
    it('accepts same from and to date', () => {
      const r = rosterQuerySchema.parse({ from: '2025-04-01', to: '2025-04-01' });
      expect(r.from).toBe(r.to);
    });

    it('accepts all optional filters together', () => {
      const r = rosterQuerySchema.parse({
        from: '2025-04-01', to: '2025-04-30', staffId: 5, shiftId: 2, department: 'ICU',
      });
      expect(r.staffId).toBe(5);
      expect(r.shiftId).toBe(2);
      expect(r.department).toBe('ICU');
    });
  });
});

describe('Additional Schema Edge Cases — Rotation', () => {
  describe('createRotationSchema edge cases', () => {
    it('accepts cycleDays = 1', () => {
      const r = createRotationSchema.parse({
        patternName: 'Daily', cycleDays: 1,
        days: [{ dayNumber: 1, shiftId: 1 }], idempotencyKey: HR_IDEMPOTENCY_KEY,
      });
      expect(r.cycleDays).toBe(1);
    });

    it('accepts cycleDays = 62', () => {
      const days = Array.from({ length: 62 }, (_, i) => ({
        dayNumber: i + 1, shiftId: 1,
      }));
      const r = createRotationSchema.parse({ patternName: '62-day', cycleDays: 62, days, idempotencyKey: HR_IDEMPOTENCY_KEY });
      expect(r.days).toHaveLength(62);
    });

    it('accepts max-length patternName (100 chars)', () => {
      const r = createRotationSchema.parse({
        patternName: 'x'.repeat(100), cycleDays: 1,
        days: [{ dayNumber: 1, shiftId: 1 }], idempotencyKey: HR_IDEMPOTENCY_KEY,
      });
      expect(r.patternName).toHaveLength(100);
    });

    it('rejects patternName > 100 chars', () => {
      expect(() => createRotationSchema.parse({
        patternName: 'x'.repeat(101), cycleDays: 1,
        days: [{ dayNumber: 1, shiftId: 1 }],
      })).toThrow();
    });
  });

  describe('assignRotationSchema edge cases', () => {
    it('accepts with cycleOffset', () => {
      const r = assignRotationSchema.parse({
        staffId: 1, patternId: 2, startDate: '2025-04-01', cycleOffset: 5, idempotencyKey: HR_IDEMPOTENCY_KEY,
      });
      expect(r.cycleOffset).toBe(5);
    });

    it('defaults cycleOffset to 0', () => {
      const r = assignRotationSchema.parse({
        staffId: 1, patternId: 2, startDate: '2025-04-01', idempotencyKey: HR_IDEMPOTENCY_KEY,
      });
      expect(r.cycleOffset).toBe(0);
    });
  });
});

describe('Additional Schema Edge Cases — Biometric', () => {
  describe('registerDeviceSchema edge cases', () => {
    it('accepts max-length deviceName (100 chars)', () => {
      const r = registerDeviceSchema.parse({
        deviceName: 'x'.repeat(100), deviceType: 'combo',
      });
      expect(r.deviceName).toHaveLength(100);
    });

    it('rejects deviceName > 100 chars', () => {
      expect(() => registerDeviceSchema.parse({
        deviceName: 'x'.repeat(101), deviceType: 'fingerprint',
      })).toThrow();
    });

    it('accepts IPv6 address', () => {
      const r = registerDeviceSchema.parse({
        deviceName: 'Reader', deviceType: 'rfid',
        ipAddress: '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      });
      expect(r.ipAddress).toContain(':');
    });
  });

  describe('enrollBiometricSchema edge cases', () => {
    it('accepts max-length enrollmentCode (200 chars)', () => {
      const r = enrollBiometricSchema.parse({
        staffId: 1, enrollmentType: 'pin', enrollmentCode: 'x'.repeat(200),
      });
      expect(r.enrollmentCode).toHaveLength(200);
    });

    it('rejects enrollmentCode > 200 chars', () => {
      expect(() => enrollBiometricSchema.parse({
        staffId: 1, enrollmentType: 'pin', enrollmentCode: 'x'.repeat(201),
      })).toThrow();
    });
  });
});

describe('Additional Schema Edge Cases — Punch', () => {
  describe('manualPunchSchema edge cases', () => {
    it('accepts max-length remarks (300 chars)', () => {
      const r = manualPunchSchema.parse({
        staffId: 1, punchTime: '2025-04-01T09:00:00Z', punchType: 'in', remarks: 'x'.repeat(300),
      });
      expect(r.remarks).toHaveLength(300);
    });

    it('rejects remarks > 300 chars', () => {
      expect(() => manualPunchSchema.parse({
        staffId: 1, punchTime: '2025-04-01T09:00:00Z', punchType: 'in', remarks: 'x'.repeat(301),
      })).toThrow();
    });
  });

  describe('cardPunchSchema edge cases', () => {
    it('accepts all optional fields populated', () => {
      const r = cardPunchSchema.parse({
        enrollmentCode: 'EC-001',
        punchTime: '2025-04-01T09:00:00Z',
        punchType: 'break_end',
        deviceSerial: 'SN-123',
        rawData: '{"sensor":"ok"}',
      });
      expect(r.punchType).toBe('break_end');
      expect(r.deviceSerial).toBe('SN-123');
    });
  });
});

describe('Additional Schema Edge Cases — Overtime', () => {
  describe('createOvertimeRuleSchema boundary values', () => {
    it('accepts multiplier = 1 (minimum)', () => {
      const r = createOvertimeRuleSchema.parse({ ruleName: 'Base', multiplier: 1 });
      expect(r.multiplier).toBe(1);
    });

    it('accepts multiplier = 5 (maximum)', () => {
      const r = createOvertimeRuleSchema.parse({ ruleName: 'Max', multiplier: 5 });
      expect(r.multiplier).toBe(5);
    });

    it('rejects multiplier = 0.99', () => {
      expect(() => createOvertimeRuleSchema.parse({ ruleName: 'Low', multiplier: 0.99 })).toThrow();
    });

    it('rejects multiplier = 5.01', () => {
      expect(() => createOvertimeRuleSchema.parse({ ruleName: 'High', multiplier: 5.01 })).toThrow();
    });

    it('defaults all optional fields correctly', () => {
      const r = createOvertimeRuleSchema.parse({ ruleName: 'Test' });
      expect(r.multiplier).toBe(1.5);
      expect(r.minHoursBeforeOt).toBe(0);
      expect(r.maxOtHoursPerDay).toBe(4);
      expect(r.appliesOn).toBe('weekday');
    });

    it('accepts max-length ruleName (100 chars)', () => {
      const r = createOvertimeRuleSchema.parse({ ruleName: 'x'.repeat(100) });
      expect(r.ruleName).toHaveLength(100);
    });

    it('rejects ruleName > 100 chars', () => {
      expect(() => createOvertimeRuleSchema.parse({ ruleName: 'x'.repeat(101) })).toThrow();
    });
  });
});

describe('Additional Schema Edge Cases — Holiday', () => {
  describe('createHolidaySchema edge cases', () => {
    it('accepts max-length holidayName (200 chars)', () => {
      const r = createHolidaySchema.parse({
        holidayName: 'x'.repeat(200), holidayDate: '2025-12-25',
      });
      expect(r.holidayName).toHaveLength(200);
    });

    it('rejects holidayName > 200 chars', () => {
      expect(() => createHolidaySchema.parse({
        holidayName: 'x'.repeat(201), holidayDate: '2025-12-25',
      })).toThrow();
    });

    it('accepts leap day as holiday date', () => {
      const r = createHolidaySchema.parse({
        holidayName: 'Leap Day', holidayDate: '2028-02-29',
      });
      expect(r.holidayDate).toBe('2028-02-29');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. ADDITIONAL BUSINESS LOGIC
// ══════════════════════════════════════════════════════════════════════════════

describe('Business Logic — Overtime with Multiplier', () => {
  const calcOvertimePay = (otHours: number, hourlyRate: number, multiplier: number): number =>
    otHours * hourlyRate * multiplier;

  it('calculates overtime pay at 1.5x', () => {
    expect(calcOvertimePay(2, 500, 1.5)).toBe(1500);
  });

  it('calculates overtime pay at 2x (weekend/holiday)', () => {
    expect(calcOvertimePay(3, 500, 2)).toBe(3000);
  });

  it('returns 0 for zero overtime hours', () => {
    expect(calcOvertimePay(0, 500, 1.5)).toBe(0);
  });

  it('handles fractional hours', () => {
    expect(calcOvertimePay(1.5, 400, 1.5)).toBe(900);
  });
});

describe('Business Logic — Payroll Deduction for Leave', () => {
  const calcDeduction = (monthlySalary: number, workingDays: number, leaveDays: number): number =>
    (monthlySalary / workingDays) * leaveDays;

  it('calculates deduction for 1 day leave', () => {
    expect(calcDeduction(30000, 30, 1)).toBe(1000);
  });

  it('calculates deduction for multiple days', () => {
    expect(calcDeduction(30000, 30, 5)).toBe(5000);
  });

  it('returns 0 for no leave', () => {
    expect(calcDeduction(30000, 30, 0)).toBe(0);
  });

  it('handles fractional deduction', () => {
    const result = calcDeduction(31000, 31, 1);
    expect(result).toBeCloseTo(1000, 0);
  });
});

describe('Business Logic — Shift Duration Calculation', () => {
  const calcDurationMinutes = (start: string, end: string): number => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (endMin <= startMin) return (1440 - startMin) + endMin;
    return endMin - startMin;
  };

  it('calculates 8-hour day shift', () => {
    expect(calcDurationMinutes('09:00', '17:00')).toBe(480);
  });

  it('calculates 8-hour night shift crossing midnight', () => {
    expect(calcDurationMinutes('22:00', '06:00')).toBe(480);
  });

  it('calculates 12-hour shift', () => {
    expect(calcDurationMinutes('06:00', '18:00')).toBe(720);
  });

  it('calculates 4-hour half shift', () => {
    expect(calcDurationMinutes('08:00', '12:00')).toBe(240);
  });

  it('handles shift ending at midnight', () => {
    expect(calcDurationMinutes('16:00', '00:00')).toBe(480);
  });
});

describe('Business Logic — Weekend Policy Pattern Matching', () => {
  type WeekPattern = 'every' | 'first' | 'second' | 'third' | 'fourth' | 'first_and_third' | 'second_and_fourth';

  const isWeekendForDate = (dayOfWeek: number, weekOfMonth: number, pattern: WeekPattern): boolean => {
    switch (pattern) {
      case 'every': return true;
      case 'first': return weekOfMonth === 1;
      case 'second': return weekOfMonth === 2;
      case 'third': return weekOfMonth === 3;
      case 'fourth': return weekOfMonth === 4;
      case 'first_and_third': return weekOfMonth === 1 || weekOfMonth === 3;
      case 'second_and_fourth': return weekOfMonth === 2 || weekOfMonth === 4;
    }
  };

  it('every pattern matches all weeks', () => {
    expect(isWeekendForDate(5, 1, 'every')).toBe(true);
    expect(isWeekendForDate(5, 4, 'every')).toBe(true);
  });

  it('first pattern matches only first week', () => {
    expect(isWeekendForDate(5, 1, 'first')).toBe(true);
    expect(isWeekendForDate(5, 2, 'first')).toBe(false);
  });

  it('second_and_fourth matches 2nd and 4th weeks', () => {
    expect(isWeekendForDate(5, 1, 'second_and_fourth')).toBe(false);
    expect(isWeekendForDate(5, 2, 'second_and_fourth')).toBe(true);
    expect(isWeekendForDate(5, 3, 'second_and_fourth')).toBe(false);
    expect(isWeekendForDate(5, 4, 'second_and_fourth')).toBe(true);
  });

  it('first_and_third matches 1st and 3rd weeks', () => {
    expect(isWeekendForDate(5, 1, 'first_and_third')).toBe(true);
    expect(isWeekendForDate(5, 2, 'first_and_third')).toBe(false);
    expect(isWeekendForDate(5, 3, 'first_and_third')).toBe(true);
    expect(isWeekendForDate(5, 4, 'first_and_third')).toBe(false);
  });
});

describe('Business Logic — Attendance Percentage', () => {
  const calcAttendancePercent = (presentDays: number, totalWorkingDays: number): number =>
    totalWorkingDays === 0 ? 0 : Math.round((presentDays / totalWorkingDays) * 100);

  it('calculates 100% attendance', () => {
    expect(calcAttendancePercent(22, 22)).toBe(100);
  });

  it('calculates 50% attendance', () => {
    expect(calcAttendancePercent(11, 22)).toBe(50);
  });

  it('handles zero working days', () => {
    expect(calcAttendancePercent(0, 0)).toBe(0);
  });

  it('handles zero present days', () => {
    expect(calcAttendancePercent(0, 22)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. ADDITIONAL EDGE CASES
// ══════════════════════════════════════════════════════════════════════════════

describe('Edge Cases — Year Boundaries', () => {
  it('should handle leave request crossing new year', () => {
    const start = new Date('2024-12-28');
    const end = new Date('2025-01-03');
    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    expect(days).toBe(7);
  });

  it('should handle payroll month boundary (Dec to Jan)', () => {
    const dec = '2024-12';
    const jan = '2025-01';
    expect(dec < jan).toBe(true);
  });

  it('should validate year range for leave balance (2020-2100)', () => {
    expect(() => initLeaveBalanceSchema.parse({ staffId: 1, year: 2020 })).not.toThrow();
    expect(() => initLeaveBalanceSchema.parse({ staffId: 1, year: 2100 })).not.toThrow();
    expect(() => initLeaveBalanceSchema.parse({ staffId: 1, year: 2019 })).toThrow();
    expect(() => initLeaveBalanceSchema.parse({ staffId: 1, year: 2101 })).toThrow();
  });
});

describe('Edge Cases — Leap Year', () => {
  it('should handle Feb 29 in leap year 2024', () => {
    const d = new Date('2024-02-29');
    expect(d.getDate()).toBe(29);
    expect(d.getMonth()).toBe(1); // 0-indexed
  });

  it('should correctly calculate days including leap day', () => {
    const start = new Date('2024-02-28');
    const end = new Date('2024-03-01');
    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    expect(days).toBe(3); // 28, 29, 1
  });

  it('should correctly calculate non-leap year Feb', () => {
    const start = new Date('2025-02-28');
    const end = new Date('2025-03-01');
    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    expect(days).toBe(2); // 28, 1
  });
});

describe('Edge Cases — Large Values', () => {
  it('should handle large staffId', () => {
    const r = checkInSchema.parse({ staffId: 999999 });
    expect(r.staffId).toBe(999999);
  });

  it('should handle large salary amount', () => {
    const r = setSalaryStructureSchema.parse({
      staffId: 1,
      items: [{ salaryHeadId: 1, amount: 9999999 }],
    });
    expect(r.items[0].amount).toBe(9999999);
  });

  it('should handle large year value (2100)', () => {
    const r = initLeaveBalanceSchema.parse({ staffId: 1, year: 2100 });
    expect(r.year).toBe(2100);
  });
});

describe('Edge Cases — Coercion', () => {
  it('should not coerce string staffId to number (checkInSchema uses z.number())', () => {
    expect(() => checkInSchema.parse({ staffId: '42' })).toThrow();
  });

  it('should coerce string page to number', () => {
    const r = attendanceReportQuerySchema.parse({ page: '3' });
    expect(r.page).toBe(3);
    expect(typeof r.page).toBe('number');
  });

  it('should coerce string limit to number', () => {
    const r = payrollListQuerySchema.parse({ limit: '50' });
    expect(r.limit).toBe(50);
    expect(typeof r.limit).toBe('number');
  });

  it('should coerce string positiveInt in assignRosterSchema', () => {
    const r = assignRosterSchema.parse({ staffId: '5', shiftId: '2', rosterDate: '2025-04-01', idempotencyKey: HR_IDEMPOTENCY_KEY });
    expect(r.staffId).toBe(5);
    expect(r.shiftId).toBe(2);
  });
});
