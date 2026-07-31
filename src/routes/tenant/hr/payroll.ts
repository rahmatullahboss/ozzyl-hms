import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { assertAccountingPeriodOpen } from '../../../lib/accounting-hardening';
import { recordAndQueueDirectExpenseAccountingEvent } from '../../../lib/direct-finance-accounting';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createSalaryHeadSchema,
  updateSalaryHeadSchema,
  setSalaryStructureSchema,
  createPayrollRunSchema,
  payrollListQuerySchema,
  overtimePayrollIntegrationSchema,
  patchPayslipSchema,
} from '../../../schemas/hr';

const payrollRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

type SalaryStructureRow = {
  staff_id: number;
  salary_head_id: number;
  amount: number;
  calculation_type: 'fixed' | 'percentage';
  head_type: 'earning' | 'deduction';
  head_name: string;
};

type AttendanceSummary = {
  present: number;
  late: number;
  absent: number;
  leave: number;
  half_day: number;
  payable_days: number;
  leave_deduction: number;
};

function daysInPayrollMonth(runMonth: string): number {
  const [year, month] = runMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

function payrollMonthRange(runMonth: string): { start: string; end: string } {
  const [year, month] = runMonth.split('-').map(Number);
  const endDay = daysInPayrollMonth(runMonth);
  return {
    start: `${runMonth}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SALARY HEADS (Basic, HRA, PF Deduction, Tax, etc.)
// ═══════════════════════════════════════════════════════════════════════

// GET /api/hr/payroll/salary-heads
payrollRoutes.get('/salary-heads', async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM hr_salary_heads WHERE tenant_id = ? AND is_active = 1 ORDER BY head_type, head_name'
  ).bind(tenantId).all();

  return c.json({ data: results });
});

// POST /api/hr/payroll/salary-heads
payrollRoutes.post('/salary-heads', zValidator('json', createSalaryHeadSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await c.env.DB.prepare(`
    INSERT INTO hr_salary_heads (tenant_id, head_name, head_type, is_taxable)
    VALUES (?, ?, ?, ?)
  `).bind(tenantId, data.headName, data.headType, data.isTaxable ? 1 : 0).run();

  return c.json({ message: 'Salary head created', id: result.meta.last_row_id }, 201);
});

// PUT /api/hr/payroll/salary-heads/:id
payrollRoutes.put('/salary-heads/:id', zValidator('json', updateSalaryHeadSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM hr_salary_heads WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Salary head not found' });

  await c.env.DB.prepare(`
    UPDATE hr_salary_heads
    SET head_name = ?, head_type = ?, is_taxable = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(
    data.headName ?? existing.head_name,
    data.headType ?? existing.head_type,
    data.isTaxable !== undefined ? (data.isTaxable ? 1 : 0) : existing.is_taxable,
    id,
    tenantId,
  ).run();

  return c.json({ message: 'Salary head updated' });
});

// DELETE /api/hr/payroll/salary-heads/:id (soft delete)
payrollRoutes.delete('/salary-heads/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const result = await c.env.DB.prepare(
    'UPDATE hr_salary_heads SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();
  if (result.meta.changes === 0) throw new HTTPException(404, { message: 'Salary head not found' });

  return c.json({ message: 'Salary head deactivated' });
});

// ═══════════════════════════════════════════════════════════════════════
// STAFF SALARY STRUCTURE
// ═══════════════════════════════════════════════════════════════════════

// GET /api/hr/payroll/structure/:staffId
payrollRoutes.get('/structure/:staffId', async (c) => {
  const tenantId = requireTenantId(c);
  const staffId = Number(c.req.param('staffId'));

  const { results } = await c.env.DB.prepare(`
    SELECT ss.*, sh.head_name, sh.head_type
    FROM hr_staff_salary_structure ss
    JOIN hr_salary_heads sh ON ss.salary_head_id = sh.id
    WHERE ss.tenant_id = ? AND ss.staff_id = ? AND ss.is_active = 1
    ORDER BY sh.head_type, sh.head_name
  `).bind(tenantId, staffId).all();

  // Calculate totals
  let totalEarning = 0;
  let totalDeduction = 0;
  for (const item of results as { head_type: string; amount: number }[]) {
    if (item.head_type === 'earning') totalEarning += item.amount;
    else totalDeduction += item.amount;
  }

  return c.json({
    data: results,
    summary: {
      totalEarning,
      totalDeduction,
      netPay: totalEarning - totalDeduction,
    },
  });
});

// POST /api/hr/payroll/structure — Set/replace salary structure for a staff member
payrollRoutes.post('/structure', zValidator('json', setSalaryStructureSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const { staffId, items } = c.req.valid('json');

  // Atomic: delete old structure + insert new
  const stmts = [
    c.env.DB.prepare(
      'DELETE FROM hr_staff_salary_structure WHERE tenant_id = ? AND staff_id = ?'
    ).bind(tenantId, staffId),
    ...items.map((item) =>
      c.env.DB.prepare(`
        INSERT INTO hr_staff_salary_structure (tenant_id, staff_id, salary_head_id, amount, calculation_type)
        VALUES (?, ?, ?, ?, ?)
      `).bind(tenantId, staffId, item.salaryHeadId, item.amount, item.calculationType)
    ),
  ];

  await c.env.DB.batch(stmts);

  return c.json({ message: 'Salary structure updated' });
});

// ═══════════════════════════════════════════════════════════════════════
// PAYROLL RUNS (Monthly batch processing)
// ═══════════════════════════════════════════════════════════════════════

// GET /api/hr/payroll/runs?page=&limit=
payrollRoutes.get('/runs', zValidator('query', payrollListQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const query = c.req.valid('query');
  const offset = (query.page - 1) * query.limit;

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM hr_payroll_runs
    WHERE tenant_id = ?
    ORDER BY run_month DESC
    LIMIT ? OFFSET ?
  `).bind(tenantId, query.limit, offset).all();

  const countRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS total FROM hr_payroll_runs WHERE tenant_id = ?'
  ).bind(tenantId).first<{ total: number }>();

  return c.json({
    data: results,
    pagination: { page: query.page, limit: query.limit, total: countRow?.total ?? 0 },
  });
});

// GET /api/hr/payroll/runs/:id
payrollRoutes.get('/runs/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));

  const run = await c.env.DB.prepare(
    'SELECT * FROM hr_payroll_runs WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!run) throw new HTTPException(404, { message: 'Payroll run not found' });

  const { results: payslips } = await c.env.DB.prepare(`
    SELECT ps.*, s.name as staff_name, s.position, s.bank_account
    FROM hr_payslips ps
    JOIN staff s ON ps.staff_id = s.id
    WHERE ps.payroll_run_id = ? AND ps.tenant_id = ?
    ORDER BY s.name
  `).bind(id, tenantId).all();

  return c.json({ data: { ...run, payslips } });
});

// POST /api/hr/payroll/runs — Create DRAFT payroll run + generate payslips
payrollRoutes.post('/runs', zValidator('json', createPayrollRunSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { runMonth } = c.req.valid('json');

  // Idempotent: check if run already exists
  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM hr_payroll_runs WHERE tenant_id = ? AND run_month = ?'
  ).bind(tenantId, runMonth).first();

  if (existing) {
    return c.json({ data: existing, message: 'Payroll run already exists for this month' });
  }

  // 1. Create the payroll run
  const runResult = await c.env.DB.prepare(`
    INSERT INTO hr_payroll_runs (tenant_id, run_month, status, created_by)
    VALUES (?, ?, 'draft', ?)
  `).bind(tenantId, runMonth, userId).run();

  const payrollRunId = runResult.meta.last_row_id;

  // 2. Fetch all active staff with salary structures
  const { results: structures } = await c.env.DB.prepare(`
    SELECT ss.staff_id, ss.salary_head_id, ss.amount, ss.calculation_type, sh.head_type, sh.head_name
    FROM hr_staff_salary_structure ss
    JOIN hr_salary_heads sh ON ss.salary_head_id = sh.id
    JOIN staff s ON ss.staff_id = s.id
    WHERE ss.tenant_id = ? AND ss.is_active = 1 AND s.status = 'active'
    ORDER BY ss.staff_id, sh.head_type
  `).bind(tenantId).all() as { results: SalaryStructureRow[] };

  if (!structures || structures.length === 0) {
    return c.json({
      message: 'Payroll run created but no staff with salary structure found',
      id: payrollRunId,
    }, 201);
  }

  // 3. Group by staff
  const staffMap = new Map<number, { rows: SalaryStructureRow[] }>();

  for (const row of structures) {
    if (!staffMap.has(row.staff_id)) {
      staffMap.set(row.staff_id, { rows: [] });
    }
    staffMap.get(row.staff_id)!.rows.push(row);
  }

  const staffIds = Array.from(staffMap.keys());
  const { start, end } = payrollMonthRange(runMonth);
  const daysInMonth = daysInPayrollMonth(runMonth);

  const attendanceByStaff = new Map<number, Partial<AttendanceSummary>>();
  if (staffIds.length > 0) {
    const placeholders = staffIds.map(() => '?').join(', ');
    const { results: attendanceRows } = await c.env.DB.prepare(`
      SELECT staff_id,
        SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END) as late,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent,
        SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END) as leave,
        SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) as half_day
      FROM hr_attendance
      WHERE tenant_id = ? AND date >= ? AND date <= ? AND staff_id IN (${placeholders})
      GROUP BY staff_id
    `).bind(tenantId, start, end, ...staffIds).all<Partial<AttendanceSummary> & { staff_id: number }>();

    for (const row of attendanceRows) {
      attendanceByStaff.set(Number(row.staff_id), row);
    }
  }

  const leaveDeductionDaysByStaff = new Map<number, number>();
  if (staffIds.length > 0) {
    const placeholders = staffIds.map(() => '?').join(', ');
    const { results: leaveRows } = await c.env.DB.prepare(`
      SELECT lr.staff_id, lr.total_days, COALESCE(r.pay_percent, 100) as pay_percent
      FROM hr_leave_requests lr
      LEFT JOIN hr_leave_rules r
        ON r.tenant_id = lr.tenant_id
       AND r.leave_category_id = lr.leave_category_id
       AND r.year = CAST(strftime('%Y', lr.start_date) AS INTEGER)
       AND r.is_active = 1
      WHERE lr.tenant_id = ?
        AND lr.status = 'approved'
        AND lr.start_date <= ?
        AND lr.end_date >= ?
        AND lr.staff_id IN (${placeholders})
    `).bind(tenantId, end, start, ...staffIds).all<{ staff_id: number; total_days: number; pay_percent: number }>();

    for (const row of leaveRows) {
      const unpaidDays = Number(row.total_days || 0) * Math.max(0, 100 - Number(row.pay_percent ?? 100)) / 100;
      leaveDeductionDaysByStaff.set(row.staff_id, (leaveDeductionDaysByStaff.get(row.staff_id) || 0) + unpaidDays);
    }
  }

  // 4. Generate payslips in batch
  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;

  const payslipStmts = [];
  for (const [staffId, data] of staffMap.entries()) {
    const fixedEarningsBase = data.rows
      .filter((row) => row.head_type === 'earning' && row.calculation_type !== 'percentage')
      .reduce((sum, row) => sum + Number(row.amount || 0), 0);

    let earning = 0;
    let deduction = 0;
    const components: { head: string; type: string; amount: number; calculationType: string; configuredAmount: number }[] = [];

    for (const row of data.rows) {
      const configuredAmount = Number(row.amount || 0);
      const amount = row.calculation_type === 'percentage'
        ? Number((fixedEarningsBase * configuredAmount / 100).toFixed(2))
        : configuredAmount;
      components.push({
        head: row.head_name,
        type: row.head_type,
        amount,
        calculationType: row.calculation_type,
        configuredAmount,
      });
      if (row.head_type === 'earning') earning += amount;
      else deduction += amount;
    }

    const attendanceRow = attendanceByStaff.get(staffId) || {};
    const absentDays = Number(attendanceRow.absent || 0) + Number(attendanceRow.half_day || 0) * 0.5;
    const leaveDeductionDays = leaveDeductionDaysByStaff.get(staffId) || 0;
    const dailyRate = daysInMonth > 0 ? earning / daysInMonth : 0;
    const leaveDeduction = Number((dailyRate * (absentDays + leaveDeductionDays)).toFixed(2));
    const attendanceSummary: AttendanceSummary = {
      present: Number(attendanceRow.present || 0),
      late: Number(attendanceRow.late || 0),
      absent: Number(attendanceRow.absent || 0),
      leave: Number(attendanceRow.leave || 0),
      half_day: Number(attendanceRow.half_day || 0),
      payable_days: Math.max(0, daysInMonth - absentDays - leaveDeductionDays),
      leave_deduction: leaveDeduction,
    };

    const totalDeductionForStaff = deduction + leaveDeduction;
    const net = earning - totalDeductionForStaff;
    totalGross += earning;
    totalDeductions += totalDeductionForStaff;
    totalNet += net;

    payslipStmts.push(
      c.env.DB.prepare(`
        INSERT INTO hr_payslips (
          tenant_id, payroll_run_id, staff_id, month, total_earning, total_deduction, net_pay,
          breakdown_json, attendance_summary_json, leave_deduction, payable_days
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        payrollRunId,
        staffId,
        runMonth,
        earning,
        totalDeductionForStaff,
        net,
        JSON.stringify({ components }),
        JSON.stringify(attendanceSummary),
        leaveDeduction,
        attendanceSummary.payable_days,
      )
    );
  }

  // Update run summary
  payslipStmts.push(
    c.env.DB.prepare(`
      UPDATE hr_payroll_runs
      SET total_employees = ?, total_gross = ?, total_deductions = ?, total_net = ?
      WHERE id = ?
    `).bind(staffMap.size, totalGross, totalDeductions, totalNet, payrollRunId)
  );

  // Batch insert (chunk to 50 for D1 limits)
  const chunkSize = 50;
  for (let i = 0; i < payslipStmts.length; i += chunkSize) {
    await c.env.DB.batch(payslipStmts.slice(i, i + chunkSize));
  }

  return c.json({
    message: `Payroll generated for ${staffMap.size} employees`,
    id: payrollRunId,
    summary: { totalEmployees: staffMap.size, totalGross, totalDeductions, totalNet },
  }, 201);
});

// POST /api/hr/payroll/runs/:id/lock — DRAFT → LOCKED
payrollRoutes.post('/runs/:id/lock', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const userId = requireUserId(c);

  const run = await c.env.DB.prepare(
    'SELECT status FROM hr_payroll_runs WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ status: string }>();

  if (!run) throw new HTTPException(404, { message: 'Payroll run not found' });
  if (run.status !== 'draft') throw new HTTPException(409, { message: `Cannot lock run with status: ${run.status}` });

  await c.env.DB.prepare(`
    UPDATE hr_payroll_runs
    SET status = 'locked', locked_by = ?, locked_on = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, id, tenantId).run();

  return c.json({ message: 'Payroll run locked' });
});

// POST /api/hr/payroll/runs/:id/approve — LOCKED → APPROVED
payrollRoutes.post('/runs/:id/approve', async (c) => {
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  const userId = requireUserId(c);

  const run = await c.env.DB.prepare(
    'SELECT id, status, run_month, total_net, expense_id FROM hr_payroll_runs WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; status: string; run_month: string; total_net: number; expense_id?: number | null }>();

  if (!run) throw new HTTPException(404, { message: 'Payroll run not found' });
  if (run.status !== 'locked') throw new HTTPException(409, { message: `Cannot approve run with status: ${run.status}` });

  const runAccountingDate = `${run.run_month}-01`;
  await assertAccountingPeriodOpen(c.env.DB, tenantId, runAccountingDate, 'Payroll run approval');

  let expenseId = run.expense_id || null;
  const totalNet = Number(run.total_net || 0);
  if (totalNet <= 0) {
    throw new HTTPException(409, { message: 'Payroll net payable must be greater than zero before approval' });
  }
  if (!expenseId) {
    const expenseDescription = `Payroll salary expense for ${run.run_month}`;
    const expenseResult = await c.env.DB.prepare(`
      INSERT INTO expenses (
        date, category, amount, description, status, approved_by, approved_at,
        tenant_id, created_by, source_type, source_id, reference_no
      ) VALUES (?, 'salary', ?, ?, 'approved', ?, datetime('now', '+6 hours'), ?, ?, 'payroll_run', ?, ?)
    `).bind(
      runAccountingDate,
      totalNet,
      expenseDescription,
      userId,
      tenantId,
      userId,
      id,
      `PAYROLL-${run.run_month}`,
    ).run();
    expenseId = Number(expenseResult.meta.last_row_id);

    await recordAndQueueDirectExpenseAccountingEvent(c, {
      tenantId,
      userId,
      expenseId,
      date: runAccountingDate,
      category: 'salary',
      amount: totalNet,
      paymentMethod: 'bank',
      description: expenseDescription,
    });
  }

  await c.env.DB.prepare(`
    UPDATE hr_payroll_runs
    SET status = 'approved', approved_by = ?, approved_on = datetime('now', '+6 hours'), expense_id = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, expenseId, id, tenantId).run();

  return c.json({ message: 'Payroll run approved', expense_id: expenseId });
});

// ─── Individual Payslip Lookup ────────────────────────────────────────────────

// GET /api/hr/payroll/payslips/:staffId?month=
payrollRoutes.get('/payslips/:staffId', async (c) => {
  const tenantId = requireTenantId(c);
  const staffId = Number(c.req.param('staffId'));
  const month = c.req.query('month');

  let query = `
    SELECT ps.*, pr.run_month, pr.status as run_status
    FROM hr_payslips ps
    JOIN hr_payroll_runs pr ON ps.payroll_run_id = pr.id
    WHERE ps.tenant_id = ? AND ps.staff_id = ?
  `;
  const params: (string | number)[] = [tenantId, staffId];

  if (month) {
    query += ' AND ps.month = ?';
    params.push(month);
  }

  query += ' ORDER BY ps.month DESC';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();

  return c.json({ data: results });
});

// ─── HR Dashboard Stats ───────────────────────────────────────────────────────

// GET /api/hr/payroll/dashboard
payrollRoutes.get('/dashboard', async (c) => {
  const tenantId = requireTenantId(c);

  const totalStaff = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM staff WHERE tenant_id = ? AND status = 'active'"
  ).bind(tenantId).first<{ count: number }>();

  const today = new Date().toISOString().split('T')[0];
  const presentToday = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM hr_attendance WHERE tenant_id = ? AND date = ? AND status IN ('present', 'late')"
  ).bind(tenantId, today).first<{ count: number }>();

  const pendingLeaves = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM hr_leave_requests WHERE tenant_id = ? AND status = 'pending'"
  ).bind(tenantId).first<{ count: number }>();

  const currentMonth = new Date().toISOString().slice(0, 7);
  const latestRun = await c.env.DB.prepare(
    'SELECT * FROM hr_payroll_runs WHERE tenant_id = ? AND run_month = ?'
  ).bind(tenantId, currentMonth).first();

  return c.json({
    totalStaff: totalStaff?.count ?? 0,
    presentToday: presentToday?.count ?? 0,
    pendingLeaves: pendingLeaves?.count ?? 0,
    currentPayrollRun: latestRun ?? null,
  });
});

payrollRoutes.post('/overtime-integrate', zValidator('json', overtimePayrollIntegrationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const { payrollRunId, staffId, includeOvertime } = c.req.valid('json');
  if (!includeOvertime) return c.json({ message: 'Overtime skipped', overtimePay: 0, overtimeHours: 0 });
  const run = await c.env.DB.prepare('SELECT run_month FROM hr_payroll_runs WHERE id = ? AND tenant_id = ?').bind(payrollRunId, tenantId).first<{ run_month: string }>();
  if (!run) throw new HTTPException(404, { message: 'Payroll run not found' });
  const { start, end } = payrollMonthRange(run.run_month);
  const { results: otEntries } = await c.env.DB.prepare(`SELECT overtime_hours, multiplier FROM hr_overtime_log WHERE tenant_id = ? AND staff_id = ? AND status = 'approved' AND date >= ? AND date <= ?`).bind(tenantId, staffId, start, end).all<{ overtime_hours: number; multiplier: number }>();
  if (otEntries.length === 0) return c.json({ message: 'No approved overtime', overtimePay: 0, overtimeHours: 0 });
  const payslip = await c.env.DB.prepare('SELECT total_earning, overtime_amount, total_deduction FROM hr_payslips WHERE payroll_run_id = ? AND staff_id = ? AND tenant_id = ?').bind(payrollRunId, staffId, tenantId).first<{ total_earning: number; overtime_amount: number; total_deduction: number }>();
  if (!payslip) throw new HTTPException(404, { message: 'Payslip not found' });
  const daysInMonth = daysInPayrollMonth(run.run_month);
  const baseEarning = Number(payslip.total_earning) - Number(payslip.overtime_amount || 0);
  const baseDailyRate = daysInMonth > 0 ? baseEarning / daysInMonth : 0;
  let totalOTPay = 0;
  let totalOTHrs = 0;
  for (const e of otEntries) { const h = Number(e.overtime_hours); totalOTPay += h * baseDailyRate * Number(e.multiplier); totalOTHrs += h; }
  totalOTPay = Math.round(totalOTPay * 100) / 100;
  await c.env.DB.prepare(`UPDATE hr_payslips SET overtime_amount = ?, overtime_hours = ?, total_earning = ?, net_pay = ? WHERE payroll_run_id = ? AND staff_id = ? AND tenant_id = ?`).bind(totalOTPay, totalOTHrs, baseEarning + totalOTPay, baseEarning + totalOTPay - Number(payslip.total_deduction || 0), payrollRunId, staffId, tenantId).run();
  const totals = await c.env.DB.prepare(`SELECT SUM(total_earning) as gross, SUM(net_pay) as net FROM hr_payslips WHERE payroll_run_id = ? AND tenant_id = ?`).bind(payrollRunId, tenantId).first<{ gross: number; net: number }>();
  await c.env.DB.prepare(`UPDATE hr_payroll_runs SET total_gross = ?, total_net = ? WHERE id = ? AND tenant_id = ?`).bind(totals?.gross ?? 0, totals?.net ?? 0, payrollRunId, tenantId).run();
  return c.json({ message: 'Overtime integrated', overtimePay: totalOTPay, overtimeHours: totalOTHrs, entriesCount: otEntries.length });
});

// PATCH /api/hr/payroll/payslips/:id — adjust net_pay in a DRAFT run, audited
payrollRoutes.patch('/payslips/:id', zValidator('json', patchPayslipSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const payslipId = Number(c.req.param('id'));
  const { netPay, reason } = c.req.valid('json');

  const payslip = await c.env.DB.prepare(`
    SELECT id, staff_id, payroll_run_id, net_pay, total_earning
    FROM hr_payslips
    WHERE id = ? AND tenant_id = ?
  `).bind(payslipId, tenantId).first<{ id: number; staff_id: number; payroll_run_id: number; net_pay: number; total_earning: number }>();

  if (!payslip) throw new HTTPException(404, { message: 'Payslip not found' });

  const run = await c.env.DB.prepare(`
    SELECT status FROM hr_payroll_runs WHERE id = ? AND tenant_id = ?
  `).bind(payslip.payroll_run_id, tenantId).first<{ status: string }>();

  if (!run) throw new HTTPException(404, { message: 'Payroll run not found' });
  if (run.status !== 'draft') {
    throw new HTTPException(409, { message: `Cannot edit payslip in ${run.status} run. Re-generate the month to adjust.` });
  }
  if (netPay > payslip.total_earning) {
    throw new HTTPException(400, { message: `netPay (${netPay}) cannot exceed total_earning (${payslip.total_earning})` });
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE hr_payslips
      SET net_pay = ?, total_deduction = MAX(0, total_earning - ?)
      WHERE id = ? AND tenant_id = ?
    `).bind(netPay, netPay, payslipId, tenantId),
    c.env.DB.prepare(`
      INSERT INTO hr_payslip_adjustments
        (tenant_id, payslip_id, payroll_run_id, staff_id, old_net_pay, new_net_pay, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(tenantId, payslipId, payslip.payroll_run_id, payslip.staff_id, payslip.net_pay, netPay, reason, userId),
    c.env.DB.prepare(`
      UPDATE hr_payroll_runs
      SET total_net = (SELECT COALESCE(SUM(net_pay), 0) FROM hr_payslips WHERE payroll_run_id = ? AND tenant_id = ?),
          total_deductions = (SELECT COALESCE(SUM(total_deduction), 0) FROM hr_payslips WHERE payroll_run_id = ? AND tenant_id = ?)
      WHERE id = ? AND tenant_id = ?
    `).bind(payslip.payroll_run_id, tenantId, payslip.payroll_run_id, tenantId, payslip.payroll_run_id, tenantId),
  ]);

  return c.json({ message: 'Net pay updated', oldNet: payslip.net_pay, newNet: netPay });
});

export default payrollRoutes;
