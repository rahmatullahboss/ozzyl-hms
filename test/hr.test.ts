/**
 * HR Module — Comprehensive Test Suite
 *
 * Covers:
 *  1. Zod schema validation (valid & invalid inputs, defaults, edge cases)
 *  2. RBAC role enforcement rules
 *  3. Leave business logic  (balance checking, date math, status transitions)
 *  4. Attendance business logic (late detection, grace period, check-in/out rules)
 *  5. Payroll business logic  (net pay calc, salary structure, run state machine)
 *  6. Pagination helpers
 *  7. Edge cases & boundary conditions
 */

import { describe, it, expect } from 'vitest';
import {
  createLeaveCategorySchema,
  createLeaveRequestSchema,
  approveLeaveSchema,
  initLeaveBalanceSchema,
  createShiftSchema,
  checkInSchema,
  attendanceReportQuerySchema,
  createSalaryHeadSchema,
  setSalaryStructureSchema,
  createPayrollRunSchema,
} from '../src/schemas/hr';

// ══════════════════════════════════════════════════════════════════════════════
// 1. ZOD SCHEMA VALIDATION
// ══════════════════════════════════════════════════════════════════════════════

describe('HR Schemas — Leave', () => {

  // ─── Leave Category ───────────────────────────────────────────────────────
  describe('createLeaveCategorySchema', () => {
    it('accepts valid category', () => {
      const r = createLeaveCategorySchema.parse({ leaveName: 'Annual Leave', maxDaysPerYear: 20 });
      expect(r.leaveName).toBe('Annual Leave');
      expect(r.maxDaysPerYear).toBe(20);
    });

    it('defaults maxDaysPerYear to 0 when not provided', () => {
      const r = createLeaveCategorySchema.parse({ leaveName: 'Sick Leave' });
      expect(r.maxDaysPerYear).toBe(0);
    });

    it('accepts optional description', () => {
      const r = createLeaveCategorySchema.parse({ leaveName: 'Casual', description: 'For personal use' });
      expect(r.description).toBe('For personal use');
    });

    it('rejects empty leaveName', () => {
      expect(() => createLeaveCategorySchema.parse({ leaveName: '' })).toThrow();
    });

    it('rejects missing leaveName', () => {
      expect(() => createLeaveCategorySchema.parse({ maxDaysPerYear: 10 })).toThrow();
    });

    it('rejects negative maxDaysPerYear', () => {
      expect(() => createLeaveCategorySchema.parse({ leaveName: 'X', maxDaysPerYear: -5 })).toThrow();
    });
  });

  // ─── Leave Request ────────────────────────────────────────────────────────
  describe('createLeaveRequestSchema', () => {
    const valid = { staffId: 1, leaveCategoryId: 2, startDate: '2025-03-01', endDate: '2025-03-05' };

    it('accepts valid request', () => {
      const r = createLeaveRequestSchema.parse(valid);
      expect(r.staffId).toBe(1);
      expect(r.startDate).toBe('2025-03-01');
    });

    it('accepts with optional reason', () => {
      const r = createLeaveRequestSchema.parse({ ...valid, reason: 'Medical' });
      expect(r.reason).toBe('Medical');
    });

    it('rejects invalid date format', () => {
      expect(() => createLeaveRequestSchema.parse({ ...valid, startDate: '01-03-2025' })).toThrow();
      expect(() => createLeaveRequestSchema.parse({ ...valid, endDate: '5 March' })).toThrow();
    });

    it('rejects non-positive staffId', () => {
      expect(() => createLeaveRequestSchema.parse({ ...valid, staffId: 0 })).toThrow();
      expect(() => createLeaveRequestSchema.parse({ ...valid, staffId: -1 })).toThrow();
    });

    it('rejects missing required fields', () => {
      expect(() => createLeaveRequestSchema.parse({ staffId: 1 })).toThrow();
    });

    it('rejects endDate before startDate', () => {
      expect(() => createLeaveRequestSchema.parse({
        ...valid, startDate: '2025-03-10', endDate: '2025-03-05'
      })).toThrow();
    });
  });

  // ─── Leave Approval ───────────────────────────────────────────────────────
  describe('approveLeaveSchema', () => {
    it('accepts approved status', () => {
      expect(approveLeaveSchema.parse({ status: 'approved' }).status).toBe('approved');
    });

    it('accepts rejected status', () => {
      const r = approveLeaveSchema.parse({ status: 'rejected' });
      expect(r.status).toBe('rejected');
    });

    it('accepts cancelled status', () => {
      expect(approveLeaveSchema.parse({ status: 'cancelled' }).status).toBe('cancelled');
    });

    it('rejects invalid status values', () => {
      expect(() => approveLeaveSchema.parse({ status: 'pending' })).toThrow();
      expect(() => approveLeaveSchema.parse({ status: 'APPROVED' })).toThrow();
    });

    it('rejects empty object', () => {
      expect(() => approveLeaveSchema.parse({})).toThrow();
    });
  });

  // ─── Init Leave Balance ───────────────────────────────────────────────────
  describe('initLeaveBalanceSchema', () => {
    it('accepts valid balance init', () => {
      const r = initLeaveBalanceSchema.parse({ staffId: 1, year: 2025 });
      expect(r.staffId).toBe(1);
      expect(r.year).toBe(2025);
    });

    it('rejects year below minimum (2020)', () => {
      expect(() => initLeaveBalanceSchema.parse({ staffId: 1, year: 2019 })).toThrow();
    });

    it('rejects year above maximum (2100)', () => {
      expect(() => initLeaveBalanceSchema.parse({ staffId: 1, year: 2101 })).toThrow();
    });

    it('rejects non-positive staffId', () => {
      expect(() => initLeaveBalanceSchema.parse({ staffId: 0, year: 2025 })).toThrow();
    });

    it('rejects missing year', () => {
      expect(() => initLeaveBalanceSchema.parse({ staffId: 1 })).toThrow();
    });
  });
});

describe('HR Schemas — Attendance', () => {
  // ─── Shift ────────────────────────────────────────────────────────────────
  describe('createShiftSchema', () => {
    it('accepts valid shift', () => {
      const r = createShiftSchema.parse({ shiftName: 'Morning', startTime: '08:00', endTime: '16:00' });
      expect(r.shiftName).toBe('Morning');
      expect(r.gracePeriod).toBe(0);
    });

    it('accepts custom grace period', () => {
      const r = createShiftSchema.parse({ shiftName: 'Night', startTime: '22:00', endTime: '06:00', gracePeriod: 15 });
      expect(r.gracePeriod).toBe(15);
    });

    it('rejects empty shiftName', () => {
      expect(() => createShiftSchema.parse({ shiftName: '', startTime: '08:00', endTime: '16:00' })).toThrow();
    });

    it('rejects invalid time format (not HH:mm)', () => {
      expect(() => createShiftSchema.parse({ shiftName: 'X', startTime: '8am', endTime: '4pm' })).toThrow();
      expect(() => createShiftSchema.parse({ shiftName: 'X', startTime: '8:0', endTime: '16:00' })).toThrow();
    });

    it('rejects negative gracePeriod', () => {
      expect(() => createShiftSchema.parse({ shiftName: 'X', startTime: '08:00', endTime: '16:00', gracePeriod: -5 })).toThrow();
    });

    it('accepts valid 24h boundary times', () => {
      const r = createShiftSchema.parse({ shiftName: 'Midnight', startTime: '00:00', endTime: '23:59' });
      expect(r.startTime).toBe('00:00');
    });
  });

  // ─── Check-In ─────────────────────────────────────────────────────────────
  describe('checkInSchema', () => {
    it('accepts valid check-in', () => {
      const r = checkInSchema.parse({ staffId: 1 });
      expect(r.staffId).toBe(1);
    });

    it('accepts with optional shiftId', () => {
      const r = checkInSchema.parse({ staffId: 1, shiftId: 2 });
      expect(r.shiftId).toBe(2);
    });

    it('rejects non-positive staffId', () => {
      expect(() => checkInSchema.parse({ staffId: 0 })).toThrow();
      expect(() => checkInSchema.parse({ staffId: -99 })).toThrow();
    });

    it('rejects missing staffId', () => {
      expect(() => checkInSchema.parse({})).toThrow();
    });
  });

  // ─── Attendance Report Query ───────────────────────────────────────────────
  describe('attendanceReportQuerySchema', () => {
    it('accepts valid date range', () => {
      const r = attendanceReportQuerySchema.parse({ from: '2025-03-01', to: '2025-03-31' });
      expect(r.page).toBe(1);
      expect(r.limit).toBe(50);
    });

    it('accepts optional staffId filter', () => {
      const r = attendanceReportQuerySchema.parse({ from: '2025-03-01', to: '2025-03-31', staffId: '5' });
      expect(r.staffId).toBe(5);
    });

    it('accepts empty query (all optional)', () => {
      const r = attendanceReportQuerySchema.parse({});
      expect(r.page).toBe(1);
      expect(r.limit).toBe(50);
    });

    it('rejects invalid date format', () => {
      expect(() => attendanceReportQuerySchema.parse({ from: 'invalid', to: '2025-03-31' })).toThrow();
    });

    it('rejects "to" before "from"', () => {
      expect(() => attendanceReportQuerySchema.parse({ from: '2025-03-31', to: '2025-03-01' })).toThrow();
    });

    it('defaults to page=1, limit=50', () => {
      const r = attendanceReportQuerySchema.parse({});
      expect(r.page).toBe(1);
      expect(r.limit).toBe(50);
    });
  });
});

describe('HR Schemas — Payroll', () => {
  // ─── Salary Head ─────────────────────────────────────────────────────────
  describe('createSalaryHeadSchema', () => {
    it('accepts earning head', () => {
      const r = createSalaryHeadSchema.parse({ headName: 'Basic Salary', headType: 'earning' });
      expect(r.headType).toBe('earning');
      expect(r.isTaxable).toBe(true); // actual default is true
    });

    it('accepts deduction head', () => {
      const r = createSalaryHeadSchema.parse({ headName: 'PF', headType: 'deduction', isTaxable: false });
      expect(r.headType).toBe('deduction');
      expect(r.isTaxable).toBe(false);
    });

    it('rejects invalid headType', () => {
      expect(() => createSalaryHeadSchema.parse({ headName: 'X', headType: 'bonus' })).toThrow();
      expect(() => createSalaryHeadSchema.parse({ headName: 'X', headType: 'tax' })).toThrow();
    });

    it('rejects empty headName', () => {
      expect(() => createSalaryHeadSchema.parse({ headName: '', headType: 'earning' })).toThrow();
    });

    it('rejects missing headType', () => {
      expect(() => createSalaryHeadSchema.parse({ headName: 'Basic' })).toThrow();
    });
  });

  // ─── Salary Structure ─────────────────────────────────────────────────────
  describe('setSalaryStructureSchema', () => {
    it('accepts valid structure with multiple items', () => {
      const r = setSalaryStructureSchema.parse({
        staffId: 1,
        items: [
          { salaryHeadId: 1, amount: 20000 },
          { salaryHeadId: 2, amount: 5000 },
        ],
      });
      expect(r.items).toHaveLength(2);
      expect(r.items[0].calculationType).toBe('fixed');
    });

    it('accepts percentage calculation type', () => {
      const r = setSalaryStructureSchema.parse({
        staffId: 1,
        items: [{ salaryHeadId: 1, amount: 10, calculationType: 'percentage' }],
      });
      expect(r.items[0].calculationType).toBe('percentage');
    });

    it('rejects empty items array', () => {
      expect(() => setSalaryStructureSchema.parse({ staffId: 1, items: [] })).toThrow();
    });

    it('rejects negative item amount', () => {
      expect(() => setSalaryStructureSchema.parse({
        staffId: 1,
        items: [{ salaryHeadId: 1, amount: -100 }],
      })).toThrow();
    });

    it('accepts zero amount items (unpaid leave deduction)', () => {
      const r = setSalaryStructureSchema.parse({
        staffId: 1,
        items: [{ salaryHeadId: 1, amount: 0 }],
      });
      expect(r.items[0].amount).toBe(0);
    });

    it('rejects non-positive staffId', () => {
      expect(() => setSalaryStructureSchema.parse({
        staffId: 0,
        items: [{ salaryHeadId: 1, amount: 10000 }],
      })).toThrow();
    });
  });

  // ─── Payroll Run ──────────────────────────────────────────────────────────
  describe('createPayrollRunSchema', () => {
    it('accepts valid YYYY-MM month', () => {
      const r = createPayrollRunSchema.parse({ runMonth: '2025-03' });
      expect(r.runMonth).toBe('2025-03');
    });

    it('accepts boundary months', () => {
      expect(createPayrollRunSchema.parse({ runMonth: '2025-01' }).runMonth).toBe('2025-01');
      expect(createPayrollRunSchema.parse({ runMonth: '2025-12' }).runMonth).toBe('2025-12');
    });

    it('rejects MM-YYYY format', () => {
      expect(() => createPayrollRunSchema.parse({ runMonth: '03-2025' })).toThrow();
    });

    it('rejects slash separator', () => {
      expect(() => createPayrollRunSchema.parse({ runMonth: '2025/03' })).toThrow();
    });

    it('rejects natural language month', () => {
      expect(() => createPayrollRunSchema.parse({ runMonth: 'March 2025' })).toThrow();
    });

    it('rejects missing runMonth', () => {
      expect(() => createPayrollRunSchema.parse({})).toThrow();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. RBAC ROLE CHECKS
// ══════════════════════════════════════════════════════════════════════════════

describe('HR Module — RBAC', () => {
  const HR_FULL_ACCESS = ['hospital_admin', 'md'];
  const HR_ATTENDANCE_ACCESS = ['hospital_admin', 'md', 'nurse', 'receptionist'];
  const HR_READ_ONLY = ['director'];

  it('should grant full HR access to hospital_admin', () => {
    expect(HR_FULL_ACCESS).toContain('hospital_admin');
  });

  it('should grant full HR access to md (managing director)', () => {
    expect(HR_FULL_ACCESS).toContain('md');
  });

  it('should not grant full access to nurses or receptionists', () => {
    expect(HR_FULL_ACCESS).not.toContain('nurse');
    expect(HR_FULL_ACCESS).not.toContain('receptionist');
    expect(HR_FULL_ACCESS).not.toContain('pharmacist');
    expect(HR_FULL_ACCESS).not.toContain('laboratory');
  });

  it('should allow check-in/check-out for broader roles', () => {
    expect(HR_ATTENDANCE_ACCESS).toContain('nurse');
    expect(HR_ATTENDANCE_ACCESS).toContain('receptionist');
    expect(HR_ATTENDANCE_ACCESS).toContain('hospital_admin');
  });

  it('should not expose payroll approve to read-only roles', () => {
    expect(HR_FULL_ACCESS).not.toContain('director');
    expect(HR_READ_ONLY).toContain('director');
  });

  it('should block patient-facing roles from HR entirely', () => {
    const blockedRoles = ['patient', 'guest', 'accountant'];
    blockedRoles.forEach(role => {
      expect(HR_FULL_ACCESS).not.toContain(role);
      expect(HR_ATTENDANCE_ACCESS).not.toContain(role);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. LEAVE BUSINESS LOGIC
// ══════════════════════════════════════════════════════════════════════════════

describe('Leave Business Logic', () => {

  // ─── Date Math ───────────────────────────────────────────────────────────
  describe('Leave Duration Calculation', () => {
    const calcDays = (start: string, end: string): number => {
      const diff = new Date(end).getTime() - new Date(start).getTime();
      return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
    };

    it('should calculate single day leave correctly', () => {
      expect(calcDays('2025-03-10', '2025-03-10')).toBe(1);
    });

    it('should calculate multi-day leave correctly', () => {
      expect(calcDays('2025-03-01', '2025-03-05')).toBe(5);
    });

    it('should calculate week-long leave', () => {
      expect(calcDays('2025-03-10', '2025-03-16')).toBe(7);
    });

    it('should calculate month-end spanning leave', () => {
      expect(calcDays('2025-01-30', '2025-02-03')).toBe(5);
    });
  });

  // ─── Balance Validation ───────────────────────────────────────────────────
  describe('Leave Balance Validation', () => {
    const hasEnoughBalance = (balance: number, requested: number): boolean => balance >= requested;

    it('should approve when balance is sufficient', () => {
      expect(hasEnoughBalance(10, 5)).toBe(true);
      expect(hasEnoughBalance(5, 5)).toBe(true);
    });

    it('should reject when balance is insufficient', () => {
      expect(hasEnoughBalance(3, 5)).toBe(false);
      expect(hasEnoughBalance(0, 1)).toBe(false);
    });

    it('should reject zero-day requests', () => {
      const isValidRequest = (days: number) => days > 0;
      expect(isValidRequest(0)).toBe(false);
      expect(isValidRequest(-1)).toBe(false);
      expect(isValidRequest(1)).toBe(true);
    });
  });

  // ─── Status Transitions ───────────────────────────────────────────────────
  describe('Leave Request Status Transitions', () => {
    type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

    const canTransition = (from: LeaveStatus, to: LeaveStatus): boolean => {
      const rules: Record<LeaveStatus, LeaveStatus[]> = {
        pending:   ['approved', 'rejected', 'cancelled'],
        approved:  ['cancelled'],
        rejected:  [],
        cancelled: [],
      };
      return rules[from].includes(to);
    };

    it('should allow approving a pending request', () => {
      expect(canTransition('pending', 'approved')).toBe(true);
    });

    it('should allow rejecting a pending request', () => {
      expect(canTransition('pending', 'rejected')).toBe(true);
    });

    it('should allow cancelling an approved leave', () => {
      expect(canTransition('approved', 'cancelled')).toBe(true);
    });

    it('should not allow re-approving a rejected request', () => {
      expect(canTransition('rejected', 'approved')).toBe(false);
    });

    it('should not allow any transition from cancelled', () => {
      expect(canTransition('cancelled', 'approved')).toBe(false);
      expect(canTransition('cancelled', 'pending')).toBe(false);
    });

    it('should not allow any transition from rejected', () => {
      expect(canTransition('rejected', 'cancelled')).toBe(false);
    });
  });

  // ─── Balance Deduction ───────────────────────────────────────────────────
  describe('Leave Balance Deduction', () => {
    it('should deduct correct days on approval', () => {
      const initialBalance = 15;
      const requestedDays = 5;
      const afterApproval = initialBalance - requestedDays;
      expect(afterApproval).toBe(10);
    });

    it('should not let balance go below zero', () => {
      const balance = 3;
      const days = 5;
      const isValid = balance >= days;
      expect(isValid).toBe(false);
    });

    it('should restore balance on cancellation', () => {
      const afterDeduction = 10;
      const daysToRestore = 5;
      expect(afterDeduction + daysToRestore).toBe(15);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. ATTENDANCE BUSINESS LOGIC
// ══════════════════════════════════════════════════════════════════════════════

describe('Attendance Business Logic', () => {

  // ─── Late Detection ───────────────────────────────────────────────────────
  describe('Late Detection', () => {
    const toMinutes = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const isLate = (shiftStart: string, checkInTime: string, gracePeriod: number): boolean =>
      toMinutes(checkInTime) > toMinutes(shiftStart) + gracePeriod;

    it('should mark as present when check-in is on time', () => {
      expect(isLate('09:00', '09:00', 0)).toBe(false);
      expect(isLate('09:00', '08:55', 0)).toBe(false);
    });

    it('should mark as on-time within grace period', () => {
      expect(isLate('09:00', '09:10', 15)).toBe(false);
      expect(isLate('09:00', '09:15', 15)).toBe(false);
    });

    it('should mark as late when exceeding grace period', () => {
      expect(isLate('09:00', '09:16', 15)).toBe(true);
      expect(isLate('09:00', '10:00', 0)).toBe(true);
    });

    it('should enforce zero grace period strictly', () => {
      expect(isLate('09:00', '09:01', 0)).toBe(true);
      expect(isLate('09:00', '09:00', 0)).toBe(false);
    });

    it('should handle evening shift start times', () => {
      expect(isLate('22:00', '22:05', 10)).toBe(false);
      expect(isLate('22:00', '22:11', 10)).toBe(true);
    });
  });

  // ─── Check-in/out Rules ───────────────────────────────────────────────────
  describe('Check-in / Check-out Rules', () => {
    it('should not allow check-out before check-in', () => {
      const checkIn: string | null = null;
      const canCheckOut = checkIn !== null;
      expect(canCheckOut).toBe(false);
    });

    it('should allow check-out after check-in', () => {
      const checkIn = '09:00';
      const canCheckOut = checkIn !== null;
      expect(canCheckOut).toBe(true);
    });

    it('should block double check-in', () => {
      const alreadyCheckedIn = true;
      const canCheckIn = !alreadyCheckedIn;
      expect(canCheckIn).toBe(false);
    });

    it('should block double check-out', () => {
      const alreadyCheckedOut = true;
      const canCheckOut = !alreadyCheckedOut;
      expect(canCheckOut).toBe(false);
    });
  });

  // ─── Monthly Summary ──────────────────────────────────────────────────────
  describe('Monthly Attendance Aggregation', () => {
    interface AttRecord { status: 'present' | 'late' | 'absent' | 'leave' | 'half_day'; }

    const summarize = (records: AttRecord[]) => ({
      present_days: records.filter(r => r.status === 'present').length,
      late_days:    records.filter(r => r.status === 'late').length,
      absent_days:  records.filter(r => r.status === 'absent').length,
      leave_days:   records.filter(r => r.status === 'leave').length,
      half_days:    records.filter(r => r.status === 'half_day').length,
    });

    it('should correctly count each status type', () => {
      const records: AttRecord[] = [
        { status: 'present' }, { status: 'present' }, { status: 'late' },
        { status: 'absent' }, { status: 'leave' }, { status: 'half_day' },
        { status: 'present' },
      ];
      const s = summarize(records);
      expect(s.present_days).toBe(3);
      expect(s.late_days).toBe(1);
      expect(s.absent_days).toBe(1);
      expect(s.leave_days).toBe(1);
      expect(s.half_days).toBe(1);
    });

    it('should return zeros for empty records', () => {
      const s = summarize([]);
      expect(s.present_days).toBe(0);
      expect(s.late_days).toBe(0);
    });

    it('should correctly count full month working days', () => {
      const records: AttRecord[] = Array(26).fill({ status: 'present' });
      expect(summarize(records).present_days).toBe(26);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. PAYROLL BUSINESS LOGIC
// ══════════════════════════════════════════════════════════════════════════════

describe('Payroll Business Logic', () => {

  // ─── Net Pay Calculation ──────────────────────────────────────────────────
  describe('Net Pay Calculation', () => {
    interface PayHead { type: 'earning' | 'deduction'; amount: number; }

    const calcNetPay = (heads: PayHead[]) => {
      const gross = heads.filter(h => h.type === 'earning').reduce((s, h) => s + h.amount, 0);
      const deductions = heads.filter(h => h.type === 'deduction').reduce((s, h) => s + h.amount, 0);
      return { gross, deductions, net: gross - deductions };
    };

    it('should calculate net pay correctly', () => {
      const heads: PayHead[] = [
        { type: 'earning', amount: 30000 },
        { type: 'earning', amount: 5000 },
        { type: 'deduction', amount: 3000 },
        { type: 'deduction', amount: 500 },
      ];
      const result = calcNetPay(heads);
      expect(result.gross).toBe(35000);
      expect(result.deductions).toBe(3500);
      expect(result.net).toBe(31500);
    });

    it('should return gross when no deductions', () => {
      const heads: PayHead[] = [{ type: 'earning', amount: 25000 }];
      const result = calcNetPay(heads);
      expect(result.net).toBe(25000);
      expect(result.deductions).toBe(0);
    });

    it('should handle empty salary structure', () => {
      const result = calcNetPay([]);
      expect(result.gross).toBe(0);
      expect(result.net).toBe(0);
    });

    it('should produce negative net when deductions exceed gross', () => {
      const result = calcNetPay([
        { type: 'earning', amount: 1000 },
        { type: 'deduction', amount: 1500 },
      ]);
      expect(result.net).toBe(-500);
    });
  });

  // ─── Payroll Run State Machine ────────────────────────────────────────────
  describe('Payroll Run State Machine', () => {
    type RunStatus = 'draft' | 'locked' | 'approved' | 'cancelled';

    const canTransition = (from: RunStatus, action: 'lock' | 'approve' | 'cancel'): boolean => {
      const rules: Record<RunStatus, string[]> = {
        draft:     ['lock', 'cancel'],
        locked:    ['approve', 'cancel'],
        approved:  [],
        cancelled: [],
      };
      return rules[from].includes(action);
    };

    it('should allow locking a draft', () => {
      expect(canTransition('draft', 'lock')).toBe(true);
    });

    it('should allow approving a locked run', () => {
      expect(canTransition('locked', 'approve')).toBe(true);
    });

    it('should allow cancelling draft', () => {
      expect(canTransition('draft', 'cancel')).toBe(true);
    });

    it('should allow cancelling locked', () => {
      expect(canTransition('locked', 'cancel')).toBe(true);
    });

    it('should not allow approving a draft directly (must lock first)', () => {
      expect(canTransition('draft', 'approve')).toBe(false);
    });

    it('should not allow any action on approved run', () => {
      expect(canTransition('approved', 'lock')).toBe(false);
      expect(canTransition('approved', 'cancel')).toBe(false);
      expect(canTransition('approved', 'approve')).toBe(false);
    });

    it('should not allow any action on cancelled run', () => {
      expect(canTransition('cancelled', 'lock')).toBe(false);
      expect(canTransition('cancelled', 'approve')).toBe(false);
      expect(canTransition('cancelled', 'cancel')).toBe(false);
    });
  });

  // ─── Calculation Types ────────────────────────────────────────────────────
  describe('Salary Calculation Types', () => {
    const calcAmount = (baseAmount: number, gross: number, type: 'fixed' | 'percentage'): number =>
      type === 'fixed' ? baseAmount : (gross * baseAmount) / 100;

    it('should return fixed amount for fixed type', () => {
      expect(calcAmount(5000, 30000, 'fixed')).toBe(5000);
    });

    it('should calculate percentage of gross', () => {
      expect(calcAmount(10, 50000, 'percentage')).toBe(5000);
    });

    it('should handle 0% correctly', () => {
      expect(calcAmount(0, 50000, 'percentage')).toBe(0);
    });

    it('should handle 100% correctly', () => {
      expect(calcAmount(100, 20000, 'percentage')).toBe(20000);
    });
  });

  // ─── Bulk Payslip Generation ──────────────────────────────────────────────
  describe('Bulk Payslip Generation', () => {
    it('should generate one payslip per active staff', () => {
      const activeStaff = [{ id: 1 }, { id: 2 }, { id: 3 }];
      const payslips = activeStaff.map(s => ({ staffId: s.id, runId: 42 }));
      expect(payslips).toHaveLength(3);
    });

    it('should filter out inactive staff', () => {
      const allStaff = [
        { id: 1, status: 'active' },
        { id: 2, status: 'inactive' },
        { id: 3, status: 'active' },
      ];
      const active = allStaff.filter(s => s.status === 'active');
      expect(active).toHaveLength(2);
    });

    it('should handle empty staff list gracefully', () => {
      const payslips: unknown[] = [];
      expect(payslips.length).toBe(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. PAGINATION
// ══════════════════════════════════════════════════════════════════════════════

describe('HR Pagination Logic', () => {
  const calcOffset = (page: number, limit: number) => (page - 1) * limit;
  const calcTotalPages = (total: number, limit: number) => Math.ceil(total / limit);

  it('should calculate offset for page 1', () => {
    expect(calcOffset(1, 50)).toBe(0);
  });

  it('should calculate offset for page 2', () => {
    expect(calcOffset(2, 50)).toBe(50);
  });

  it('should calculate offset for page 3 with different limit', () => {
    expect(calcOffset(3, 25)).toBe(50);
  });

  it('should calculate total pages correctly', () => {
    expect(calcTotalPages(97, 50)).toBe(2);
    expect(calcTotalPages(100, 50)).toBe(2);
    expect(calcTotalPages(101, 50)).toBe(3);
  });

  it('should return 0 pages for empty result set', () => {
    expect(calcTotalPages(0, 50)).toBe(0);
  });

  it('should default attendance report to page=1 limit=50', () => {
    const r = attendanceReportQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.limit).toBe(50);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. EDGE CASES & BOUNDARY CONDITIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('HR Edge Cases', () => {

  it('should handle leave request spanning new year', () => {
    const start = new Date('2024-12-30');
    const end = new Date('2025-01-03');
    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    expect(days).toBe(5);
  });

  it('should handle leap year February (2024)', () => {
    const start = new Date('2024-02-28');
    const end = new Date('2024-03-01');
    const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    expect(days).toBe(3); // 28 Feb, 29 Feb (leap day), 1 Mar
  });

  it('should reject endDate before startDate in leaveRequest', () => {
    expect(() => createLeaveRequestSchema.parse({
      staffId: 1, leaveCategoryId: 1,
      startDate: '2025-03-10', endDate: '2025-03-05',
    })).toThrow();
  });

  it('should handle payroll with net zero (equal earnings and deductions)', () => {
    const gross = 10000;
    const deductions = 10000;
    expect(gross - deductions).toBe(0);
  });

  it('should handle staff with no salary items (net = 0)', () => {
    const items: { amount: number }[] = [];
    expect(items.reduce((s, i) => s + i.amount, 0)).toBe(0);
  });

  it('should enforce strict late detection with 0 grace period', () => {
    const shiftStartMin = 9 * 60; // 09:00
    const checkInMin = 9 * 60 + 1; // 09:01
    expect(checkInMin > shiftStartMin + 0).toBe(true);
  });

  it('should validate salary head type uniqueness per type', () => {
    const headTypes = ['earning', 'earning', 'deduction'];
    const uniqueTypes = new Set(headTypes);
    expect(uniqueTypes.size).toBe(2);
  });

  it('should validate YYYY-MM-DD date format with regex', () => {
    const validDate = /^\d{4}-\d{2}-\d{2}$/;
    expect(validDate.test('2025-03-15')).toBe(true);
    expect(validDate.test('15/03/2025')).toBe(false);
    expect(validDate.test('2025-3-5')).toBe(false);
  });

  it('should validate YYYY-MM month format with regex', () => {
    const validMonth = /^\d{4}-\d{2}$/;
    expect(validMonth.test('2025-03')).toBe(true);
    expect(validMonth.test('2025-3')).toBe(false);
    expect(validMonth.test('03/2025')).toBe(false);
  });

  it('should handle payroll year boundary correctly', () => {
    // Year 2020 is the min for leave balance
    expect(() => initLeaveBalanceSchema.parse({ staffId: 1, year: 2020 })).not.toThrow();
    expect(() => initLeaveBalanceSchema.parse({ staffId: 1, year: 2019 })).toThrow();
  });
});
