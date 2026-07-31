import { z } from 'zod';

// ─── Shared helpers ────────────────────────────────────────────────────────────
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const monthString = z.string().regex(/^\d{4}-\d{2}$/, 'Must be YYYY-MM');
const positiveInt = z.coerce.number().int().positive();
const idempotencyKey = z.string().min(8).max(200);
const sourceEventKey = z.string().min(8).max(200);
const isoDateTime = z.string().datetime({ offset: true });

// ─── Leave Management ──────────────────────────────────────────────────────────
export const createLeaveCategorySchema = z.object({
  leaveName: z.string().min(1, 'Leave name is required'),
  description: z.string().max(500).optional(),
  maxDaysPerYear: z.number().int().min(0).default(0),
});

export const updateLeaveCategorySchema = createLeaveCategorySchema.partial();

export const createLeaveRequestSchema = z.object({
  staffId: z.number().int().positive(),
  leaveCategoryId: z.number().int().positive(),
  startDate: dateString,
  endDate: dateString,
  reason: z.string().max(500).optional(),
  requestedTo: z.number().int().positive().optional(),
}).refine((d) => d.endDate >= d.startDate, {
  message: 'End date must be on or after start date',
  path: ['endDate'],
});

export const approveLeaveSchema = z.object({
  status: z.enum(['approved', 'rejected', 'cancelled']),
  rejectionReason: z.string().max(500).optional(),
});

export const initLeaveBalanceSchema = z.object({
  staffId: z.number().int().positive(),
  year: z.number().int().min(2020).max(2100),
});

export const createLeaveRuleSchema = z.object({
  leaveCategoryId: z.number().int().positive(),
  year: z.number().int().min(2020).max(2100),
  days: z.number().min(0).max(366),
  payPercent: z.number().min(0).max(100).default(100),
  isApproved: z.boolean().default(false),
});

export const updateLeaveRuleSchema = createLeaveRuleSchema.partial().extend({
  isActive: z.boolean().optional(),
});

// ─── Attendance & Shifts ───────────────────────────────────────────────────────
export const createShiftSchema = z.object({
  shiftName: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:mm'),
  gracePeriod: z.number().int().min(0).default(0),
});

export const updateShiftSchema = createShiftSchema.partial();

export const checkInSchema = z.object({
  staffId: z.number().int().positive(),
  shiftId: z.number().int().positive().optional(),
  occurredAtUtc: isoDateTime.optional(),
  sourceEventKey: sourceEventKey.optional(),
});

export const checkOutSchema = z.object({
  staffId: z.number().int().positive(),
  occurredAtUtc: isoDateTime.optional(),
  sourceEventKey: sourceEventKey.optional(),
});

export const attendanceReportQuerySchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  staffId: positiveInt.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).refine((q) => !q.from || !q.to || q.to >= q.from, {
  message: '"to" must be on or after "from"',
  path: ['to'],
});

// ─── Payroll ───────────────────────────────────────────────────────────────────
export const createSalaryHeadSchema = z.object({
  headName: z.string().min(1),
  headType: z.enum(['earning', 'deduction']),
  isTaxable: z.boolean().default(true),
});

export const updateSalaryHeadSchema = createSalaryHeadSchema.partial();

export const setSalaryStructureSchema = z.object({
  staffId: z.number().int().positive(),
  items: z.array(
    z.object({
      salaryHeadId: z.number().int().positive(),
      amount: z.number().min(0),
      calculationType: z.enum(['fixed', 'percentage']).default('fixed'),
    })
  ).min(1, 'At least one salary component required'),
});

export const createPayrollRunSchema = z.object({
  runMonth: monthString,
});

export const payrollListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  month: monthString.optional(),
  staffId: positiveInt.optional(),
});

// ─── Duty Roster ──────────────────────────────────────────────────────────────
export const assignRosterSchema = z.object({
  staffId: positiveInt,
  shiftId: positiveInt,
  rosterDate: dateString,
  remarks: z.string().max(300).optional(),
  idempotencyKey,
});

export const bulkAssignRosterSchema = z.object({
  assignments: z.array(z.object({
    staffId: positiveInt,
    shiftId: positiveInt,
  })).min(1).max(50),
  startDate: dateString,
  endDate: dateString,
  dateMode: z.enum(['all_dates', 'configured_working_days']).default('all_dates'),
  idempotencyKey,
}).refine((value) => value.endDate >= value.startDate, {
  message: 'endDate must be on or after startDate',
  path: ['endDate'],
});

export const rosterQuerySchema = z.object({
  from: dateString,
  to: dateString,
  staffId: positiveInt.optional(),
  shiftId: positiveInt.optional(),
  department: z.string().optional(),
});

export const swapRosterSchema = z.object({
  swapWithStaffId: positiveInt,
  reason: z.string().min(3).max(300),
  idempotencyKey,
});

export const cancelRosterSchema = z.object({
  reason: z.string().min(3).max(300),
  idempotencyKey,
});

// ─── Rotation Patterns ────────────────────────────────────────────────────────
const rotationDaySchema = z.object({
  dayNumber: z.number().int().min(1),
  shiftId: positiveInt.nullable(),
  isOff: z.boolean().default(false),
}).superRefine((day, ctx) => {
  if (!day.isOff && day.shiftId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shiftId'], message: 'shiftId is required for a working day' });
  }
  if (day.isOff && day.shiftId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shiftId'], message: 'shiftId must be null for an off-day' });
  }
});

export const createRotationSchema = z.object({
  patternName: z.string().min(2).max(100),
  cycleDays: z.number().int().min(1).max(62),
  days: z.array(rotationDaySchema).min(1).max(62),
  idempotencyKey,
}).superRefine((value, ctx) => {
  const seen = new Set<number>();
  value.days.forEach((day, index) => {
    if (day.dayNumber > value.cycleDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['days', index, 'dayNumber'],
        message: `dayNumber must be within 1..${value.cycleDays}`,
      });
    }
    if (seen.has(day.dayNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['days', index, 'dayNumber'],
        message: 'dayNumber must be unique within the rotation cycle',
      });
    }
    seen.add(day.dayNumber);
  });
});

export const assignRotationSchema = z.object({
  staffId: positiveInt,
  patternId: positiveInt,
  startDate: dateString,
  endDate: dateString.optional(),
  cycleOffset: z.number().int().min(0).max(61).default(0),
  idempotencyKey,
}).refine((value) => !value.endDate || value.endDate >= value.startDate, {
  message: 'endDate must be on or after startDate',
  path: ['endDate'],
});

export const generateRosterSchema = z.object({
  startDate: dateString,
  endDate: dateString,
  replaceExisting: z.literal(false).default(false),
  idempotencyKey,
}).refine((value) => value.endDate >= value.startDate, {
  message: 'endDate must be on or after startDate',
  path: ['endDate'],
});

// ─── Biometric Devices ────────────────────────────────────────────────────────
export const registerDeviceSchema = z.object({
  deviceName: z.string().min(1).max(100),
  deviceType: z.enum(['fingerprint', 'rfid', 'face', 'card', 'combo']),
  deviceSerial: z.string().max(100).optional(),
  ipAddress: z.string().max(45).optional(),
  location: z.string().max(200).optional(),
});

export const enrollBiometricSchema = z.object({
  staffId: positiveInt,
  deviceId: positiveInt.optional(),
  enrollmentType: z.enum(['fingerprint', 'rfid', 'face', 'card', 'pin']),
  enrollmentCode: z.string().min(1).max(200),
});

// ─── Card Punch (webhook from device) ─────────────────────────────────────────
export const cardPunchSchema = z.object({
  enrollmentCode: z.string().min(1),
  punchTime: isoDateTime.optional(),
  punchType: z.enum(['in', 'out', 'break_start', 'break_end']).default('in'),
  deviceSerial: z.string().optional(),
  sourceEventKey: sourceEventKey.optional(),
  rawData: z.string().optional(),
});

export const manualPunchSchema = z.object({
  staffId: positiveInt,
  punchTime: isoDateTime,
  punchType: z.enum(['in', 'out', 'break_start', 'break_end']),
  sourceEventKey: sourceEventKey.optional(),
  reason: z.string().min(3).max(300).optional(),
  remarks: z.string().min(3).max(300).optional(),
}).superRefine((value, ctx) => {
  if (!value.reason && !value.remarks) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'A reason is required for a manual attendance correction',
    });
  }
});

export const punchQuerySchema = z.object({
  date: dateString.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  staffId: positiveInt.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Overtime ─────────────────────────────────────────────────────────────────
export const createOvertimeRuleSchema = z.object({
  ruleName: z.string().min(1).max(100),
  multiplier: z.number().min(1).max(5).default(1.5),
  minHoursBeforeOt: z.number().min(0).default(0),
  maxOtHoursPerDay: z.number().min(0).default(4),
  appliesOn: z.enum(['weekday', 'weekend', 'holiday', 'all']).default('weekday'),
});

export const approveOvertimeSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

// ─── Holidays ─────────────────────────────────────────────────────────────────
export const createHolidaySchema = z.object({
  holidayName: z.string().min(1).max(200),
  holidayDate: dateString,
  holidayType: z.enum(['public', 'optional', 'restricted']).default('public'),
});

// ─── Weekend Policy ──────────────────────────────────────────────────────────
export const createWeekendPolicySchema = z.object({
  year: z.number().int().min(2020).max(2100),
  dayOfWeek: z.enum(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
  weekPattern: z.enum(['every', 'first', 'second', 'third', 'fourth', 'first_and_third', 'second_and_fourth']).default('every'),
});

export const updateWeekendPolicySchema = z.object({
  weekPattern: z.enum(['every', 'first', 'second', 'third', 'fourth', 'first_and_third', 'second_and_fourth']).optional(),
  isActive: z.boolean().optional(),
});

export const carryForwardLeaveSchema = z.object({
  staffId: z.number().int().positive(),
  fromYear: z.number().int().min(2020).max(2100),
  toYear: z.number().int().min(2020).max(2100),
}).refine((d) => d.toYear > d.fromYear, {
  message: 'toYear must be greater than fromYear',
  path: ['toYear'],
});

export const markAbsentSchema = z.object({
  date: dateString,
  shiftId: positiveInt.optional(),
  department: z.string().max(100).optional(),
  sourceEventKey: sourceEventKey.optional(),
});

export const overtimePayrollIntegrationSchema = z.object({
  payrollRunId: positiveInt,
  staffId: positiveInt,
  includeOvertime: z.boolean().default(true),
});

export const patchPayslipSchema = z.object({
  netPay: z.number().min(0),
  reason: z.string().min(3).max(500),
});

export type PatchPayslipInput = z.infer<typeof patchPayslipSchema>;

// ─── Type exports ──────────────────────────────────────────────────────────────
export type CreateLeaveCategoryInput = z.infer<typeof createLeaveCategorySchema>;
export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>;
export type CreateLeaveRuleInput = z.infer<typeof createLeaveRuleSchema>;
export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type AttendanceReportQuery = z.infer<typeof attendanceReportQuerySchema>;
export type CreateSalaryHeadInput = z.infer<typeof createSalaryHeadSchema>;
export type SetSalaryStructureInput = z.infer<typeof setSalaryStructureSchema>;
export type PayrollListQuery = z.infer<typeof payrollListQuerySchema>;
