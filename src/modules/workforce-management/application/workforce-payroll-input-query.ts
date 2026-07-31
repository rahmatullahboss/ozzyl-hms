import type { AttendanceStatus } from '../domain/attendance';
import { WorkforceError } from '../domain/errors';
import type { WorkforcePayrollInput } from '../domain/overtime';

export type PayrollInputAttendanceFact = {
  staffId: number;
  status: AttendanceStatus;
};

export type PayrollInputLeaveFact = {
  staffId: number;
  workingDays: number;
  payPercent: number;
};

export type PayrollInputOvertimeFact = {
  staffId: number;
  approvedHours: number;
  multiplierSnapshot: number;
};

export interface WorkforcePayrollInputRepository {
  listAttendanceFacts(tenantId: string, startDate: string, endDate: string): Promise<PayrollInputAttendanceFact[]>;
  listApprovedLeaveFacts(tenantId: string, startDate: string, endDate: string): Promise<PayrollInputLeaveFact[]>;
  listApprovedOvertimeFacts(tenantId: string, startDate: string, endDate: string): Promise<PayrollInputOvertimeFact[]>;
}

function monthRange(month: string): { startDate: string; endDate: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) {
    throw new WorkforceError('INVALID_DATE_RANGE', 'month must use YYYY-MM format', 422);
  }
  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (!Number.isInteger(year) || monthNumber < 1 || monthNumber > 12) {
    throw new WorkforceError('INVALID_DATE_RANGE', 'month must use a valid YYYY-MM value', 422);
  }
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    startDate: `${match[1]}-${match[2]}-01`,
    endDate: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

function emptyInput(staffId: number): WorkforcePayrollInput {
  return {
    staffId,
    presentDays: 0,
    lateDays: 0,
    absentDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    halfDays: 0,
    approvedOvertimeHours: 0,
    overtimeMultiplierSnapshots: [],
  };
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function createWorkforcePayrollInputQuery(dependencies: {
  repository: WorkforcePayrollInputRepository;
}) {
  const { repository } = dependencies;
  return {
    async getMonthlyInputs(tenantId: string, month: string): Promise<WorkforcePayrollInput[]> {
      const { startDate, endDate } = monthRange(month);
      const [attendanceFacts, leaveFacts, overtimeFacts] = await Promise.all([
        repository.listAttendanceFacts(tenantId, startDate, endDate),
        repository.listApprovedLeaveFacts(tenantId, startDate, endDate),
        repository.listApprovedOvertimeFacts(tenantId, startDate, endDate),
      ]);

      const byStaff = new Map<number, WorkforcePayrollInput>();
      const get = (staffId: number) => {
        const existing = byStaff.get(staffId);
        if (existing) return existing;
        const created = emptyInput(staffId);
        byStaff.set(staffId, created);
        return created;
      };

      for (const fact of attendanceFacts) {
        const summary = get(fact.staffId);
        if (fact.status === 'present') summary.presentDays += 1;
        else if (fact.status === 'late') summary.lateDays += 1;
        else if (fact.status === 'absent') summary.absentDays += 1;
        else if (fact.status === 'half_day') summary.halfDays += 1;
      }

      for (const fact of leaveFacts) {
        const summary = get(fact.staffId);
        const payRatio = Math.min(100, Math.max(0, fact.payPercent)) / 100;
        summary.paidLeaveDays = rounded(summary.paidLeaveDays + fact.workingDays * payRatio);
        summary.unpaidLeaveDays = rounded(summary.unpaidLeaveDays + fact.workingDays * (1 - payRatio));
      }

      for (const fact of overtimeFacts) {
        const summary = get(fact.staffId);
        summary.approvedOvertimeHours = rounded(summary.approvedOvertimeHours + fact.approvedHours);
        summary.overtimeMultiplierSnapshots.push(fact.multiplierSnapshot);
      }

      return [...byStaff.values()].sort((left, right) => left.staffId - right.staffId);
    },
  };
}
