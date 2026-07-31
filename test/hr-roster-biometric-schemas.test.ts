import { describe, it, expect } from 'vitest';
import {
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
} from '../src/schemas/hr';

const HR_IDEMPOTENCY_KEY = 'hr-contract-test-20260727';

/* ------------------------------------------------------------------ */
/*  1. assignRosterSchema                                              */
/* ------------------------------------------------------------------ */
describe('assignRosterSchema', () => {
  it('accepts valid minimal input', () => {
    const result = assignRosterSchema.safeParse({
      staffId: 1,
      shiftId: 2,
      rosterDate: '2025-04-07',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with remarks', () => {
    const result = assignRosterSchema.safeParse({
      staffId: 5,
      shiftId: 3,
      rosterDate: '2025-12-25',
      remarks: 'Holiday cover',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.remarks).toBe('Holiday cover');
    }
  });

  it('rejects missing staffId', () => {
    const result = assignRosterSchema.safeParse({
      shiftId: 2,
      rosterDate: '2025-04-07',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format', () => {
    const result = assignRosterSchema.safeParse({
      staffId: 1,
      shiftId: 2,
      rosterDate: '07-04-2025',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative shiftId', () => {
    const result = assignRosterSchema.safeParse({
      staffId: 1,
      shiftId: -1,
      rosterDate: '2025-04-07',
    });
    expect(result.success).toBe(false);
  });

  it('rejects zero staffId', () => {
    const result = assignRosterSchema.safeParse({
      staffId: 0,
      shiftId: 2,
      rosterDate: '2025-04-07',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  2. bulkAssignRosterSchema                                          */
/* ------------------------------------------------------------------ */
describe('bulkAssignRosterSchema', () => {
  it('accepts valid input with multiple assignments', () => {
    const result = bulkAssignRosterSchema.safeParse({
      assignments: [
        { staffId: 1, shiftId: 2 },
        { staffId: 3, shiftId: 4 },
      ],
      startDate: '2025-04-07',
      endDate: '2025-04-14',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with single assignment', () => {
    const result = bulkAssignRosterSchema.safeParse({
      assignments: [{ staffId: 10, shiftId: 5 }],
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty assignments array', () => {
    const result = bulkAssignRosterSchema.safeParse({
      assignments: [],
      startDate: '2025-04-07',
      endDate: '2025-04-14',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing startDate', () => {
    const result = bulkAssignRosterSchema.safeParse({
      assignments: [{ staffId: 1, shiftId: 2 }],
      endDate: '2025-04-14',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing endDate', () => {
    const result = bulkAssignRosterSchema.safeParse({
      assignments: [{ staffId: 1, shiftId: 2 }],
      startDate: '2025-04-07',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  3. rosterQuerySchema                                               */
/* ------------------------------------------------------------------ */
describe('rosterQuerySchema', () => {
  it('accepts valid input with all fields', () => {
    const result = rosterQuerySchema.safeParse({
      from: '2025-04-01',
      to: '2025-04-30',
      staffId: 5,
      shiftId: 2,
      department: 'Cardiology',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with only required fields', () => {
    const result = rosterQuerySchema.safeParse({
      from: '2025-04-01',
      to: '2025-04-30',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing from', () => {
    const result = rosterQuerySchema.safeParse({
      to: '2025-04-30',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing to', () => {
    const result = rosterQuerySchema.safeParse({
      from: '2025-04-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format for from', () => {
    const result = rosterQuerySchema.safeParse({
      from: 'not-a-date',
      to: '2025-04-30',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  4. swapRosterSchema                                                */
/* ------------------------------------------------------------------ */
describe('swapRosterSchema', () => {
  it('accepts valid input', () => {
    const result = swapRosterSchema.safeParse({
      swapWithStaffId: 7,
      reason: 'Approved shift exchange',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing reason', () => {
    const result = swapRosterSchema.safeParse({
      swapWithStaffId: 7,
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing swapWithStaffId', () => {
    const result = swapRosterSchema.safeParse({
      reason: 'Approved shift exchange',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive swapWithStaffId', () => {
    const result = swapRosterSchema.safeParse({
      swapWithStaffId: 0,
      reason: 'Approved shift exchange',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  5. createRotationSchema                                            */
/* ------------------------------------------------------------------ */
describe('createRotationSchema', () => {
  it('accepts valid pattern', () => {
    const result = createRotationSchema.safeParse({
      patternName: 'Morning-Evening Rotation',
      cycleDays: 7,
      days: [
        { dayNumber: 1, shiftId: 1, isOff: false },
        { dayNumber: 2, shiftId: 2, isOff: false },
      ],
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
  });

  it('defaults isOff to false when omitted', () => {
    const result = createRotationSchema.safeParse({
      patternName: 'Simple Rotation',
      cycleDays: 3,
      days: [
        { dayNumber: 1, shiftId: 1 },
      ],
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.days[0].isOff).toBe(false);
    }
  });

  it('accepts cycleDays at boundary (1)', () => {
    const result = createRotationSchema.safeParse({
      patternName: 'Single Day',
      cycleDays: 1,
      days: [{ dayNumber: 1, shiftId: 1 }],
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
  });

  it('accepts cycleDays at boundary (62)', () => {
    const result = createRotationSchema.safeParse({
      patternName: 'Max Cycle',
      cycleDays: 62,
      days: [{ dayNumber: 1, shiftId: 1 }],
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
  });

  it('rejects cycleDays > 62', () => {
    const result = createRotationSchema.safeParse({
      patternName: 'Too Long',
      cycleDays: 63,
      days: [{ dayNumber: 1, shiftId: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty days array', () => {
    const result = createRotationSchema.safeParse({
      patternName: 'No Days',
      cycleDays: 7,
      days: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing patternName', () => {
    const result = createRotationSchema.safeParse({
      cycleDays: 7,
      days: [{ dayNumber: 1, shiftId: 1 }],
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  6. assignRotationSchema                                            */
/* ------------------------------------------------------------------ */
describe('assignRotationSchema', () => {
  it('accepts valid input and defaults cycleOffset to 0', () => {
    const result = assignRotationSchema.safeParse({
      staffId: 3,
      patternId: 1,
      startDate: '2025-04-07',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cycleOffset).toBe(0);
    }
  });

  it('accepts valid input with endDate', () => {
    const result = assignRotationSchema.safeParse({
      staffId: 3,
      patternId: 1,
      startDate: '2025-04-07',
      endDate: '2025-06-30',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.endDate).toBe('2025-06-30');
    }
  });

  it('accepts explicit cycleOffset', () => {
    const result = assignRotationSchema.safeParse({
      staffId: 3,
      patternId: 1,
      startDate: '2025-04-07',
      cycleOffset: 5,
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cycleOffset).toBe(5);
    }
  });

  it('rejects missing staffId', () => {
    const result = assignRotationSchema.safeParse({
      patternId: 1,
      startDate: '2025-04-07',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing patternId', () => {
    const result = assignRotationSchema.safeParse({
      staffId: 3,
      startDate: '2025-04-07',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  7. generateRosterSchema                                            */
/* ------------------------------------------------------------------ */
describe('generateRosterSchema', () => {
  it('accepts valid date range', () => {
    const result = generateRosterSchema.safeParse({
      startDate: '2025-04-07',
      endDate: '2025-04-14',
      idempotencyKey: HR_IDEMPOTENCY_KEY,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid startDate', () => {
    const result = generateRosterSchema.safeParse({
      startDate: 'invalid',
      endDate: '2025-04-14',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid endDate', () => {
    const result = generateRosterSchema.safeParse({
      startDate: '2025-04-07',
      endDate: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing startDate', () => {
    const result = generateRosterSchema.safeParse({
      endDate: '2025-04-14',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing endDate', () => {
    const result = generateRosterSchema.safeParse({
      startDate: '2025-04-07',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  8. registerDeviceSchema                                            */
/* ------------------------------------------------------------------ */
describe('registerDeviceSchema', () => {
  it('accepts valid minimal input', () => {
    const result = registerDeviceSchema.safeParse({
      deviceName: 'Main Entrance Reader',
      deviceType: 'fingerprint',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with all fields', () => {
    const result = registerDeviceSchema.safeParse({
      deviceName: 'Ward A Scanner',
      deviceType: 'card',
      deviceSerial: 'SN-12345',
      ipAddress: '192.168.1.100',
      location: 'Building B, Floor 2',
    });
    expect(result.success).toBe(true);
  });

  it('accepts face deviceType', () => {
    const result = registerDeviceSchema.safeParse({
      deviceName: 'Lobby Face Scanner',
      deviceType: 'face',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid deviceType', () => {
    const result = registerDeviceSchema.safeParse({
      deviceName: 'Test Device',
      deviceType: 'retina',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing deviceName', () => {
    const result = registerDeviceSchema.safeParse({
      deviceType: 'fingerprint',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing deviceType', () => {
    const result = registerDeviceSchema.safeParse({
      deviceName: 'Some Device',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  9. enrollBiometricSchema                                           */
/* ------------------------------------------------------------------ */
describe('enrollBiometricSchema', () => {
  it('accepts valid input', () => {
    const result = enrollBiometricSchema.safeParse({
      staffId: 5,
      enrollmentType: 'fingerprint',
      enrollmentCode: 'FP-001',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with deviceId', () => {
    const result = enrollBiometricSchema.safeParse({
      staffId: 5,
      deviceId: 3,
      enrollmentType: 'card',
      enrollmentCode: 'CARD-ABC-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts face enrollmentType', () => {
    const result = enrollBiometricSchema.safeParse({
      staffId: 8,
      enrollmentType: 'face',
      enrollmentCode: 'FACE-008',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid enrollmentType', () => {
    const result = enrollBiometricSchema.safeParse({
      staffId: 5,
      enrollmentType: 'iris',
      enrollmentCode: 'IRIS-001',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing enrollmentCode', () => {
    const result = enrollBiometricSchema.safeParse({
      staffId: 5,
      enrollmentType: 'fingerprint',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing staffId', () => {
    const result = enrollBiometricSchema.safeParse({
      enrollmentType: 'fingerprint',
      enrollmentCode: 'FP-001',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  10. cardPunchSchema                                                */
/* ------------------------------------------------------------------ */
describe('cardPunchSchema', () => {
  it('accepts valid minimal input and defaults punchType to in', () => {
    const result = cardPunchSchema.safeParse({
      enrollmentCode: 'FP-001',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.punchType).toBe('in');
    }
  });

  it('accepts valid input with all fields', () => {
    const result = cardPunchSchema.safeParse({
      enrollmentCode: 'FP-001',
      punchTime: '2025-04-07T08:00:00Z',
      punchType: 'out',
      deviceSerial: 'SN-12345',
      rawData: '{"scanResult":"ok"}',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.punchType).toBe('out');
    }
  });

  it('accepts punchType in', () => {
    const result = cardPunchSchema.safeParse({
      enrollmentCode: 'CARD-100',
      punchType: 'in',
      reason: 'Manual attendance correction',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty enrollmentCode', () => {
    const result = cardPunchSchema.safeParse({
      enrollmentCode: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing enrollmentCode', () => {
    const result = cardPunchSchema.safeParse({
      punchType: 'in',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  11. manualPunchSchema                                              */
/* ------------------------------------------------------------------ */
describe('manualPunchSchema', () => {
  it('accepts valid input with punchType in', () => {
    const result = manualPunchSchema.safeParse({
      staffId: 3,
      punchTime: '2025-04-07T08:00:00Z',
      punchType: 'in',
      reason: 'Manual attendance correction',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with punchType out', () => {
    const result = manualPunchSchema.safeParse({
      staffId: 3,
      punchTime: '2025-04-07T17:00:00Z',
      punchType: 'out',
      reason: 'Manual attendance correction',
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid input with remarks', () => {
    const result = manualPunchSchema.safeParse({
      staffId: 3,
      punchTime: '2025-04-07T08:00:00Z',
      punchType: 'in',
      remarks: 'Forgot badge at home',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.remarks).toBe('Forgot badge at home');
    }
  });

  it('rejects invalid punchType', () => {
    const result = manualPunchSchema.safeParse({
      staffId: 3,
      punchTime: '2025-04-07T08:00:00Z',
      punchType: 'break',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing punchTime', () => {
    const result = manualPunchSchema.safeParse({
      staffId: 3,
      punchType: 'in',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  12. punchQuerySchema                                               */
/* ------------------------------------------------------------------ */
describe('punchQuerySchema', () => {
  it('accepts empty input and applies defaults', () => {
    const result = punchQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(50);
    }
  });

  it('accepts valid input with all fields', () => {
    const result = punchQuerySchema.safeParse({
      date: '2025-04-07',
      from: '2025-04-01',
      to: '2025-04-30',
      staffId: 3,
      page: 2,
      limit: 25,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.limit).toBe(25);
    }
  });

  it('rejects page < 1', () => {
    const result = punchQuerySchema.safeParse({
      page: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects limit > 200', () => {
    const result = punchQuerySchema.safeParse({
      limit: 201,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative page', () => {
    const result = punchQuerySchema.safeParse({
      page: -5,
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  13. createOvertimeRuleSchema                                       */
/* ------------------------------------------------------------------ */
describe('createOvertimeRuleSchema', () => {
  it('accepts valid input with defaults', () => {
    const result = createOvertimeRuleSchema.safeParse({
      ruleName: 'Standard OT',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.multiplier).toBe(1.5);
      expect(result.data.minHoursBeforeOt).toBe(0);
      expect(result.data.maxOtHoursPerDay).toBe(4);
      expect(result.data.appliesOn).toBe('weekday');
    }
  });

  it('accepts valid input with explicit values', () => {
    const result = createOvertimeRuleSchema.safeParse({
      ruleName: 'Weekend OT',
      multiplier: 2.0,
      minHoursBeforeOt: 8,
      maxOtHoursPerDay: 6,
      appliesOn: 'weekend',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.multiplier).toBe(2.0);
      expect(result.data.appliesOn).toBe('weekend');
    }
  });

  it('accepts holiday appliesOn', () => {
    const result = createOvertimeRuleSchema.safeParse({
      ruleName: 'Holiday OT',
      appliesOn: 'holiday',
    });
    expect(result.success).toBe(true);
  });

  it('rejects multiplier > 5', () => {
    const result = createOvertimeRuleSchema.safeParse({
      ruleName: 'Too High',
      multiplier: 5.1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid appliesOn', () => {
    const result = createOvertimeRuleSchema.safeParse({
      ruleName: 'Bad Rule',
      appliesOn: 'anytime',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing ruleName', () => {
    const result = createOvertimeRuleSchema.safeParse({
      multiplier: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  14. approveOvertimeSchema                                          */
/* ------------------------------------------------------------------ */
describe('approveOvertimeSchema', () => {
  it('accepts approved status', () => {
    const result = approveOvertimeSchema.safeParse({
      status: 'approved',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('approved');
    }
  });

  it('accepts rejected status', () => {
    const result = approveOvertimeSchema.safeParse({
      status: 'rejected',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('rejected');
    }
  });

  it('rejects invalid status', () => {
    const result = approveOvertimeSchema.safeParse({
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing status', () => {
    const result = approveOvertimeSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty string status', () => {
    const result = approveOvertimeSchema.safeParse({
      status: '',
    });
    expect(result.success).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  15. createHolidaySchema                                            */
/* ------------------------------------------------------------------ */
describe('createHolidaySchema', () => {
  it('accepts valid input and defaults type to public', () => {
    const result = createHolidaySchema.safeParse({
      holidayName: 'Independence Day',
      holidayDate: '2025-07-04',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.holidayType).toBe('public');
    }
  });

  it('accepts valid input with explicit holidayType', () => {
    const result = createHolidaySchema.safeParse({
      holidayName: 'Company Anniversary',
      holidayDate: '2025-09-15',
      holidayType: 'restricted',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.holidayType).toBe('restricted');
    }
  });

  it('accepts optional holidayType', () => {
    const result = createHolidaySchema.safeParse({
      holidayName: 'Eid',
      holidayDate: '2025-03-31',
      holidayType: 'optional',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty holidayName', () => {
    const result = createHolidaySchema.safeParse({
      holidayName: '',
      holidayDate: '2025-07-04',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid holidayType', () => {
    const result = createHolidaySchema.safeParse({
      holidayName: 'Bad Holiday',
      holidayDate: '2025-07-04',
      holidayType: 'custom',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing holidayDate', () => {
    const result = createHolidaySchema.safeParse({
      holidayName: 'No Date Holiday',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid date format for holidayDate', () => {
    const result = createHolidaySchema.safeParse({
      holidayName: 'Bad Date',
      holidayDate: 'July 4th',
    });
    expect(result.success).toBe(false);
  });
});
