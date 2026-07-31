import { describe, expect, it } from 'vitest';
import {
  createWorkforcePayrollInputQuery,
  type WorkforcePayrollInputRepository,
} from '../../../src/modules/workforce-management/application/workforce-payroll-input-query';
import { createD1OvertimeRepository } from '../../../src/modules/workforce-management/infrastructure/d1-overtime-repository';

function createRepository(): WorkforcePayrollInputRepository {
  return {
    async listAttendanceFacts() {
      return [
        { staffId: 1, status: 'present' },
        { staffId: 1, status: 'late' },
        { staffId: 1, status: 'half_day' },
        { staffId: 2, status: 'absent' },
      ];
    },
    async listApprovedLeaveFacts() {
      return [
        { staffId: 1, workingDays: 2, payPercent: 50 },
        { staffId: 2, workingDays: 1, payPercent: 0 },
      ];
    },
    async listApprovedOvertimeFacts() {
      return [
        { staffId: 1, approvedHours: 3, multiplierSnapshot: 1.5 },
        { staffId: 1, approvedHours: 2, multiplierSnapshot: 2 },
      ];
    },
  };
}

describe('finance-safe workforce payroll input query', () => {
  it('combines attendance, proportional paid leave, unpaid leave, and approved overtime by staff', async () => {
    const query = createWorkforcePayrollInputQuery({ repository: createRepository() });

    await expect(query.getMonthlyInputs('100', '2026-07')).resolves.toEqual([
      {
        staffId: 1,
        presentDays: 1,
        lateDays: 1,
        absentDays: 0,
        paidLeaveDays: 1,
        unpaidLeaveDays: 1,
        halfDays: 1,
        approvedOvertimeHours: 5,
        overtimeMultiplierSnapshots: [1.5, 2],
      },
      {
        staffId: 2,
        presentDays: 0,
        lateDays: 0,
        absentDays: 1,
        paidLeaveDays: 0,
        unpaidLeaveDays: 1,
        halfDays: 0,
        approvedOvertimeHours: 0,
        overtimeMultiplierSnapshots: [],
      },
    ]);
  });

  it('rejects an invalid month before querying repositories', async () => {
    const query = createWorkforcePayrollInputQuery({ repository: createRepository() });
    await expect(query.getMonthlyInputs('100', '2026-13'))
      .rejects.toMatchObject({ code: 'INVALID_DATE_RANGE', httpStatus: 422 });
  });

  it('uses read-only workforce tables and never prepares payroll, expense, cash, bank, custody, or accounting SQL', async () => {
    const statements: string[] = [];
    const db = {
      prepare(sql: string) {
        statements.push(sql);
        const statement = {
          bind() { return statement; },
          async all() { return { results: [] }; },
          async first() { return null; },
          async run() { throw new Error('write method must never be used by payroll input query'); },
        };
        return statement;
      },
    } as unknown as D1Database;

    const repository = createD1OvertimeRepository(db);
    await repository.listAttendanceFacts('100', '2026-07-01', '2026-07-31');
    await repository.listApprovedLeaveFacts('100', '2026-07-01', '2026-07-31');
    await repository.listApprovedOvertimeFacts('100', '2026-07-01', '2026-07-31');

    expect(statements).toHaveLength(3);
    for (const sql of statements) {
      expect(sql.trim()).toMatch(/^(SELECT|WITH)\b/i);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT)\b/i);
      expect(sql).not.toMatch(/\b(hr_payroll_runs|hr_payslips|expenses|accounting|cash|bank|custody)\b/i);
    }
  });
});
