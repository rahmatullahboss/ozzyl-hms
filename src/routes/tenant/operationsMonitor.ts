import { Hono } from 'hono';
import { requireRole } from '../../middleware/rbac';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { getTodayGMT6 } from '../../lib/date-utils';

const operationsMonitorRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const OPERATIONS_MONITOR_ROLES = ['hospital_admin', 'md', 'director', 'manager'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLOSED_TASK_STATUSES = new Set(['completed', 'verified', 'resolved', 'closed', 'cancelled', 'waived', 'discharged', 'approved']);

const DISCHARGE_CHECKLIST_ITEMS = [
  'vitals_stable', 'medications_reconciled', 'prescriptions_printed', 'lab_results_reviewed',
  'pending_tests_cleared', 'diet_instructions_given', 'wound_care_instructions', 'follow_up_scheduled',
  'referrals_arranged', 'insurance_clearance', 'billing_cleared', 'belongings_returned',
  'transport_arranged', 'patient_education_done', 'consent_forms_signed',
] as const;

type Db = ReturnType<typeof getDb>;

type AttentionItem = {
  id: string;
  source: 'attendance' | 'housekeeping' | 'helpdesk' | 'mrd' | 'discharge' | 'cash';
  sourceId: number | string | null;
  title: string;
  department?: string | null;
  assignedTo?: string | number | null;
  priority?: string | null;
  status: string;
  dueAt?: string | null;
  isOverdue?: boolean;
  requiresProof?: boolean;
  proofMissing?: boolean;
  requiresVerification?: boolean;
  link?: string;
};

type RosterRow = {
  id: number;
  staff_id: number;
  staff_name?: string | null;
  department?: string | null;
  shift_name?: string | null;
  shift_start?: string | null;
  shift_end?: string | null;
  roster_date: string;
  status?: string | null;
};

type AttendanceRow = {
  id?: number;
  staff_id: number;
  staff_name?: string | null;
  department?: string | null;
  date: string;
  check_in?: string | null;
  check_out?: string | null;
  status?: string | null;
};

type HousekeepingRow = {
  id: number;
  task_number?: string | null;
  area_name?: string | null;
  task_type?: string | null;
  priority?: string | null;
  status?: string | null;
  scheduled_date: string;
  scheduled_time?: string | null;
  assigned_to?: string | null;
  assigned_to_id?: number | null;
  completed_at?: string | null;
  verified_at?: string | null;
};

type HelpdeskRow = {
  id: number;
  ticket_no?: string | null;
  title?: string | null;
  category?: string | null;
  priority?: string | null;
  status?: string | null;
  assigned_to_id?: number | null;
  assigned_to_name?: string | null;
  due_at?: string | null;
  created_at?: string | null;
};

type MrdTaskRow = {
  id: number;
  task_type?: string | null;
  status?: string | null;
  assigned_to?: number | string | null;
  due_date?: string | null;
  patient_id?: number | null;
  admission_id?: number | null;
  medical_record_id?: number | null;
};

type DischargeRow = Record<string, unknown> & {
  id: number;
  admission_id?: number | null;
  patient_id?: number | null;
  patient_name?: string | null;
  status?: string | null;
  planned_discharge_date?: string | null;
};

type ExpenseRow = {
  id: number;
  date?: string | null;
  category?: string | null;
  description?: string | null;
  amount?: number | string | null;
  status?: string | null;
  receipt_key?: string | null;
  created_by?: number | string | null;
};

type HandoverRow = {
  id: number;
  handover_amount?: number | string | null;
  due_amount?: number | string | null;
  amount?: number | string | null;
  status?: string | null;
  handover_type?: string | null;
  created_at?: string | null;
};

function isTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function asStatus(value: unknown): string {
  return String(value || 'pending').toLowerCase();
}

function isClosed(status: unknown): boolean {
  return CLOSED_TASK_STATUSES.has(asStatus(status));
}

function parseLocalDateTime(date: string, time?: string | null): Date | null {
  if (!DATE_RE.test(date)) return null;
  if (!time) return new Date(`${date}T23:59:59+06:00`);
  const cleanTime = /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : null;
  if (!cleanTime) return null;
  return new Date(`${date}T${cleanTime}:00+06:00`);
}

function isBeforeNow(value: string | null | undefined, fallbackDate?: string): boolean {
  const candidate = value || fallbackDate;
  if (!candidate) return false;
  const date = candidate.length === 10 ? new Date(`${candidate}T23:59:59+06:00`) : new Date(candidate);
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

async function safeAll<T>(db: Db, sql: string, params: unknown[], unavailable: Set<string>, module: string): Promise<T[]> {
  try {
    const { results } = await db.$client.prepare(sql).bind(...params).all<T>();
    return results ?? [];
  } catch {
    unavailable.add(module);
    return [];
  }
}

function addAttention(items: AttentionItem[], item: AttentionItem): void {
  items.push(item);
}

function sortAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  });
}

operationsMonitorRoutes.use('/*', requireRole(...OPERATIONS_MONITOR_ROLES));

operationsMonitorRoutes.get('/today', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();

  if (!DATE_RE.test(date)) {
    return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  }

  const unavailable = new Set<string>();
  const attentionItems: AttentionItem[] = [];

  const rosterRows = await safeAll<RosterRow>(db, `
    SELECT
      r.id, r.staff_id, s.name AS staff_name, s.department,
      sh.shift_name, sh.start_time AS shift_start, sh.end_time AS shift_end,
      r.roster_date, r.status
    FROM hr_duty_roster r
    LEFT JOIN staff s ON s.id = r.staff_id AND s.tenant_id = r.tenant_id
    LEFT JOIN hr_shifts sh ON sh.id = r.shift_id AND sh.tenant_id = r.tenant_id
    WHERE r.tenant_id = ?
      AND r.roster_date = ?
      AND COALESCE(r.status, 'scheduled') != 'cancelled'
    ORDER BY sh.start_time ASC, s.name ASC
  `, [tenantId, date], unavailable, 'attendance');

  const attendanceRows = await safeAll<AttendanceRow>(db, `
    SELECT
      a.id, a.staff_id, s.name AS staff_name, s.department,
      a.date, a.check_in, a.check_out, a.status
    FROM hr_attendance a
    LEFT JOIN staff s ON s.id = a.staff_id AND s.tenant_id = a.tenant_id
    WHERE a.tenant_id = ?
      AND a.date = ?
  `, [tenantId, date], unavailable, 'attendance');

  const attendanceByStaff = new Map(attendanceRows.map((row) => [Number(row.staff_id), row]));
  const rosteredStaffIds = new Set(rosterRows.map((row) => Number(row.staff_id)));
  const noCheckInRows = rosterRows.filter((row) => {
    const att = attendanceByStaff.get(Number(row.staff_id));
    return !att || asStatus(att.status) === 'absent';
  });
  const checkedInWithoutRoster = attendanceRows.filter((row) => !rosteredStaffIds.has(Number(row.staff_id)) && asStatus(row.status) !== 'absent');

  for (const row of noCheckInRows) {
    addAttention(attentionItems, {
      id: `attendance:no-check-in:${row.staff_id}`,
      source: 'attendance',
      sourceId: row.staff_id,
      title: `${row.staff_name ?? 'Staff'} has no check-in for ${row.shift_name ?? 'scheduled shift'}`,
      department: row.department,
      assignedTo: row.staff_name ?? row.staff_id,
      priority: 'high',
      status: 'no_check_in',
      dueAt: parseLocalDateTime(date, row.shift_start)?.toISOString() ?? null,
      isOverdue: true,
      link: '/hr/attendance',
    });
  }

  const attendance = {
    scheduled: rosterRows.length,
    checkedIn: attendanceRows.filter((row) => asStatus(row.status) !== 'absent').length,
    present: attendanceRows.filter((row) => asStatus(row.status) === 'present').length,
    late: attendanceRows.filter((row) => asStatus(row.status) === 'late').length,
    absent: attendanceRows.filter((row) => asStatus(row.status) === 'absent').length + noCheckInRows.length,
    noCheckIn: noCheckInRows.length,
    checkedInWithoutRoster: checkedInWithoutRoster.length,
    roster: rosterRows.slice(0, 50),
  };

  const housekeepingRows = await safeAll<HousekeepingRow>(db, `
    SELECT id, task_number, area_name, task_type, priority, status, scheduled_date, scheduled_time,
           assigned_to, assigned_to_id, completed_at, verified_at
    FROM housekeeping_tasks
    WHERE tenant_id = ?
      AND scheduled_date = ?
      AND COALESCE(status, 'pending') != 'cancelled'
    ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
             scheduled_time ASC
    LIMIT 100
  `, [tenantId, date], unavailable, 'housekeeping');

  const housekeeping = {
    total: housekeepingRows.length,
    pending: housekeepingRows.filter((row) => asStatus(row.status) === 'pending').length,
    inProgress: housekeepingRows.filter((row) => asStatus(row.status) === 'in_progress').length,
    completed: housekeepingRows.filter((row) => asStatus(row.status) === 'completed').length,
    verified: housekeepingRows.filter((row) => asStatus(row.status) === 'verified').length,
    verificationPending: housekeepingRows.filter((row) => asStatus(row.status) === 'completed' && !row.verified_at).length,
    overdue: 0,
  };

  for (const row of housekeepingRows) {
    const due = parseLocalDateTime(row.scheduled_date, row.scheduled_time);
    const overdue = Boolean(due && due.getTime() < Date.now() && !isClosed(row.status));
    if (overdue) housekeeping.overdue += 1;
    if (overdue || (asStatus(row.status) === 'completed' && !row.verified_at)) {
      addAttention(attentionItems, {
        id: `housekeeping:${row.id}`,
        source: 'housekeeping',
        sourceId: row.id,
        title: `${row.task_number ?? 'Housekeeping task'} — ${row.area_name ?? row.task_type ?? 'Task'}`,
        department: 'Housekeeping',
        assignedTo: row.assigned_to ?? row.assigned_to_id ?? null,
        priority: row.priority ?? 'normal',
        status: asStatus(row.status),
        dueAt: due?.toISOString() ?? null,
        isOverdue: overdue,
        requiresVerification: asStatus(row.status) === 'completed' && !row.verified_at,
        link: '/housekeeping',
      });
    }
  }

  const helpdeskRows = await safeAll<HelpdeskRow>(db, `
    SELECT id, ticket_no, title, category, priority, status, assigned_to_id, assigned_to_name, due_at, created_at
    FROM helpdesk_tickets
    WHERE tenant_id = ?
      AND is_active = 1
      AND status IN ('open', 'in_progress', 'escalated')
    ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
             due_at ASC
    LIMIT 100
  `, [tenantId], unavailable, 'helpdesk');

  const helpdesk = {
    open: helpdeskRows.filter((row) => asStatus(row.status) === 'open').length,
    inProgress: helpdeskRows.filter((row) => asStatus(row.status) === 'in_progress').length,
    escalated: helpdeskRows.filter((row) => asStatus(row.status) === 'escalated').length,
    critical: helpdeskRows.filter((row) => row.priority === 'critical').length,
    overdue: 0,
  };

  for (const row of helpdeskRows) {
    const overdue = isBeforeNow(row.due_at);
    if (overdue) helpdesk.overdue += 1;
    if (overdue || row.priority === 'critical' || asStatus(row.status) === 'escalated') {
      addAttention(attentionItems, {
        id: `helpdesk:${row.id}`,
        source: 'helpdesk',
        sourceId: row.id,
        title: `${row.ticket_no ?? 'Ticket'} — ${row.title ?? row.category ?? 'Helpdesk issue'}`,
        department: row.category ?? 'Helpdesk',
        assignedTo: row.assigned_to_name ?? row.assigned_to_id ?? null,
        priority: row.priority ?? 'medium',
        status: asStatus(row.status),
        dueAt: row.due_at ?? null,
        isOverdue: overdue,
        link: '/helpdesk',
      });
    }
  }

  const mrdRows = await safeAll<MrdTaskRow>(db, `
    SELECT id, task_type, status, assigned_to, due_date, patient_id, admission_id, medical_record_id
    FROM mrd_chart_completion_tasks
    WHERE tenant_id = ?
      AND status IN ('pending', 'in_progress')
      AND (due_date IS NULL OR due_date <= ?)
    ORDER BY due_date ASC, id DESC
    LIMIT 100
  `, [tenantId, date], unavailable, 'mrd');

  const mrd = {
    pending: mrdRows.filter((row) => asStatus(row.status) === 'pending').length,
    inProgress: mrdRows.filter((row) => asStatus(row.status) === 'in_progress').length,
    overdue: 0,
  };

  for (const row of mrdRows) {
    const overdue = Boolean(row.due_date && row.due_date < date);
    if (overdue) mrd.overdue += 1;
    addAttention(attentionItems, {
      id: `mrd:${row.id}`,
      source: 'mrd',
      sourceId: row.id,
      title: `MRD ${String(row.task_type ?? 'chart task').replace(/_/g, ' ')}`,
      department: 'MRD',
      assignedTo: row.assigned_to ?? null,
      priority: overdue ? 'high' : 'normal',
      status: asStatus(row.status),
      dueAt: row.due_date ?? null,
      isOverdue: overdue,
      link: '/medical-records',
    });
  }

  const dischargeRows = await safeAll<DischargeRow>(db, `
    SELECT dc.*, p.name AS patient_name
    FROM discharge_checklists dc
    LEFT JOIN patients p ON p.id = dc.patient_id AND p.tenant_id = dc.tenant_id
    WHERE dc.tenant_id = ?
      AND dc.status IN ('in_progress', 'ready')
      AND (dc.planned_discharge_date IS NULL OR dc.planned_discharge_date <= ?)
    ORDER BY dc.planned_discharge_date ASC, dc.updated_at DESC
    LIMIT 100
  `, [tenantId, date], unavailable, 'discharge');

  const discharge = {
    inProgress: dischargeRows.filter((row) => asStatus(row.status) === 'in_progress').length,
    ready: dischargeRows.filter((row) => asStatus(row.status) === 'ready').length,
    pendingChecklistItems: 0,
    overdue: 0,
  };

  for (const row of dischargeRows) {
    const incomplete = DISCHARGE_CHECKLIST_ITEMS.filter((item) => !isTruthy(row[item]));
    discharge.pendingChecklistItems += incomplete.length;
    const overdue = Boolean(row.planned_discharge_date && row.planned_discharge_date < date && incomplete.length > 0);
    if (overdue) discharge.overdue += 1;
    if (incomplete.length > 0 || overdue) {
      addAttention(attentionItems, {
        id: `discharge:${row.id}`,
        source: 'discharge',
        sourceId: row.id,
        title: `Discharge checklist pending${row.patient_name ? ` — ${row.patient_name}` : ''}`,
        department: 'IPD',
        assignedTo: null,
        priority: overdue ? 'high' : 'normal',
        status: asStatus(row.status),
        dueAt: row.planned_discharge_date ?? null,
        isOverdue: overdue,
        requiresVerification: incomplete.length > 0,
        link: '/discharge-planning',
      });
    }
  }

  const expenseRows = await safeAll<ExpenseRow>(db, `
    SELECT id, date, category, description, amount, status, receipt_key, created_by
    FROM expenses
    WHERE tenant_id = ?
      AND date(date) = date(?)
    ORDER BY date DESC, id DESC
    LIMIT 100
  `, [tenantId, date], unavailable, 'cash');

  const handoverRows = await safeAll<HandoverRow>(db, `
    SELECT id, handover_amount, due_amount, status, handover_type, created_at
    FROM billing_handovers
    WHERE tenant_id = ?
      AND handover_type = 'counter'
      AND status IN ('pending', 'partial')
    ORDER BY created_at DESC
    LIMIT 100
  `, [tenantId], unavailable, 'cash');

  const transferRows = await safeAll<HandoverRow>(db, `
    SELECT id, amount, due_amount, status, created_at
    FROM billing_counter_cash_transfers
    WHERE tenant_id = ?
      AND status IN ('pending', 'partial', 'disputed')
    ORDER BY created_at DESC
    LIMIT 100
  `, [tenantId], unavailable, 'cash');

  const proofMissingExpenses = expenseRows.filter((row) => !String(row.receipt_key ?? '').trim());
  const cash = {
    expenses: expenseRows.length,
    pendingExpenses: expenseRows.filter((row) => asStatus(row.status) === 'pending').length,
    proofMissing: proofMissingExpenses.length,
    pendingHandovers: handoverRows.length + transferRows.length,
    pendingHandoverAmount: [...handoverRows, ...transferRows].reduce((sum, row) => {
      const value = Number(row.due_amount ?? row.handover_amount ?? row.amount ?? 0);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0),
  };

  for (const row of proofMissingExpenses) {
    addAttention(attentionItems, {
      id: `cash:expense-receipt:${row.id}`,
      source: 'cash',
      sourceId: row.id,
      title: `Expense receipt missing${row.description ? ` — ${row.description}` : ''}`,
      department: 'Accounts',
      assignedTo: row.created_by ?? null,
      priority: asStatus(row.status) === 'pending' ? 'high' : 'normal',
      status: asStatus(row.status),
      dueAt: row.date ?? date,
      requiresProof: true,
      proofMissing: true,
      isOverdue: row.date ? row.date < date : false,
      link: '/md/expenses',
    });
  }

  for (const row of [...handoverRows, ...transferRows]) {
    addAttention(attentionItems, {
      id: `cash:handover:${row.id}`,
      source: 'cash',
      sourceId: row.id,
      title: 'Cash handover pending final action',
      department: 'Cash',
      assignedTo: null,
      priority: asStatus(row.status) === 'disputed' ? 'critical' : 'high',
      status: asStatus(row.status),
      dueAt: row.created_at ?? null,
      isOverdue: isBeforeNow(row.created_at),
      link: '/reception/cash-operations',
    });
  }

  const sortedAttentionItems = sortAttention(attentionItems).slice(0, 100);
  const summary = {
    pending: housekeeping.pending + helpdesk.open + mrd.pending + discharge.inProgress + cash.pendingExpenses + cash.pendingHandovers + attendance.noCheckIn,
    inProgress: housekeeping.inProgress + helpdesk.inProgress + mrd.inProgress,
    overdue: sortedAttentionItems.filter((item) => item.isOverdue).length,
    proofMissing: cash.proofMissing,
    verificationPending: housekeeping.verificationPending + discharge.pendingChecklistItems,
    critical: sortedAttentionItems.filter((item) => item.priority === 'critical' || item.priority === 'urgent').length,
  };

  return c.json({
    date,
    generatedAt: new Date().toISOString(),
    unavailableModules: [...unavailable].sort(),
    summary,
    attendance,
    modules: {
      housekeeping,
      helpdesk,
      mrd,
      discharge,
      cash,
    },
    attentionItems: sortedAttentionItems,
  });
});

export default operationsMonitorRoutes;
