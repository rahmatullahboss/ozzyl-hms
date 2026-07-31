import type { ReactElement } from 'react';
import { Banknote, Activity } from 'lucide-react';

export type AuditGroupKey = 'cash' | 'other';

export interface RawAuditEntry {
  id: number;
  user_id: number | null;
  user_name?: string;
  action: string;
  table_name?: string | null;
  record_id?: string | number | null;
  old_value?: string | null;
  new_value?: string | null;
  ip_address?: string | null;
  created_at: string;
  billStatus?: unknown;
  billTotal?: unknown;
  billPaid?: unknown;
  billDue?: unknown;
  expenseStatus?: unknown;
  expenseAmount?: unknown;
  expenseCategory?: unknown;
  expenseDescription?: unknown;
  transferNo?: unknown;
  transferStatus?: unknown;
  transferAmount?: unknown;
  transferReceivedAmount?: unknown;
  transferDueAmount?: unknown;
  transferDestinationType?: unknown;
  transferCustodyLabel?: unknown;
  transferByName?: unknown;
  transferToName?: unknown;
}

export type BillPaymentStatus = 'paid' | 'partially_paid' | 'open' | 'cancelled' | 'refunded' | 'draft' | 'unknown';

export interface AuditEntry {
  id: number;
  user_id: number | null;
  user_name?: string;
  action: string;
  actionLabel: string;
  entity: string;
  entityLabel: string;
  groupKey: AuditGroupKey;
  groupLabel: string;
  entity_id: string | number | null;
  details: string;
  amount?: number;
  amountSign?: 'in' | 'out';
  paymentStatus?: BillPaymentStatus;
  paymentPaid?: number;
  paymentDue?: number;
  paymentTotal?: number;
  created_at: string;
}

export interface AuditGroup {
  key: AuditGroupKey;
  labelKey: string;
  descriptionKey: string;
  color: 'emerald' | 'blue';
  icon: ReactElement;
  entities: string[];
}

const CASH_TABLES = new Set<string>([
  'bills',
  'billing',
  'billing_deposits',
  'billing_counter_sessions',
  'billing_counter_cash_transfers',
  'billing_handovers',
  'cash_drawer_movements',
  'expenses',
  'payments',
  'emp_cash_transactions',
]);

export const AUDIT_GROUPS: AuditGroup[] = [
  {
    key: 'cash',
    labelKey: 'dashboard:auditGroup.cash.label',
    descriptionKey: 'dashboard:auditGroup.cash.description',
    color: 'emerald',
    icon: <Banknote className="w-4 h-4" />,
    entities: [...CASH_TABLES],
  },
  {
    key: 'other',
    labelKey: 'dashboard:auditGroup.other.label',
    descriptionKey: 'dashboard:auditGroup.other.description',
    color: 'blue',
    icon: <Activity className="w-4 h-4" />,
    entities: [],
  },
];

const GROUP_LABELS: Record<AuditGroupKey, string> = {
  cash: 'Cash & Transactions',
  other: 'Other Activity',
};

export function getAuditGroup(tableName: string | null | undefined): AuditGroupKey {
  return CASH_TABLES.has(normalizeKey(tableName)) ? 'cash' : 'other';
}

export const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700',
  insert: 'bg-emerald-100 text-emerald-700',
  upsert: 'bg-emerald-100 text-emerald-700',
  payment: 'bg-blue-100 text-blue-700',
  update: 'bg-blue-100 text-blue-700',
  delete: 'bg-red-100 text-red-700',
  login: 'bg-gray-100 text-gray-600',
  logout: 'bg-gray-100 text-gray-600',
  cancel: 'bg-red-100 text-red-700',
  approve: 'bg-emerald-100 text-emerald-700',
  reject: 'bg-red-100 text-red-700',
};

export const ENTITY_LABELS: Record<string, string> = {
  patients: 'Patient',
  bills: 'Invoice/Bill',
  billing: 'Invoice/Bill',
  cash_drawer_movements: 'Cash Drawer Movement',
  expenses: 'Expense',
  billing_counter_sessions: 'Billing Counter Session',
  billing_counter_cash_transfers: 'Cash Custody Transfer',
  billing_handovers: 'Cash Handover',
  prescriptions: 'Prescription',
  admissions: 'Admission',
  lab_orders: 'Lab Order',
  pharmacy: 'Pharmacy',
  staff: 'Staff',
  users: 'User Access',
  discharge_summaries: 'Discharge Summary',
  doctor_schedules: 'Doctor Schedule',
  settings: 'Settings',
};

export const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  insert: 'Created',
  upsert: 'Saved',
  update: 'Updated',
  delete: 'Deleted',
  cancel: 'Cancelled',
  approve: 'Approved',
  reject: 'Rejected',
  login: 'Logged in',
  logout: 'Logged out',
  payment: 'PAYMENT',
};

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatAuditDetails(row: RawAuditEntry): string {
  const next = parseJsonObject(row.new_value);
  const previous = parseJsonObject(row.old_value);
  const parts: string[] = [];
  const entity = normalizeKey(row.table_name);

  if (entity === 'billing_counter_cash_transfers') {
    const transferNo = row.transferNo ?? next.transferNo ?? next.transfer_no;
    if (transferNo) parts.push(`Transfer: ${String(transferNo)}`);
    const fromName = row.transferByName ?? next.transferByName ?? next.transfer_by_name;
    if (fromName) parts.push(`From: ${String(fromName)}`);
    const toName = row.transferToName ?? next.transferToName ?? next.transfer_to_name;
    if (toName) parts.push(`To: ${String(toName)}`);
    const transferStatus = row.transferStatus ?? next.status ?? previous.status;
    if (transferStatus) parts.push(`Status: ${String(transferStatus)}`);
    const due = toFiniteNumber(row.transferDueAmount ?? next.dueAmount ?? next.due_amount);
    if (due !== undefined) parts.push(`Due: ৳${due.toLocaleString()}`);
    const received = toFiniteNumber(row.transferReceivedAmount ?? next.receivedAmount ?? next.received_amount);
    if (received !== undefined) parts.push(`Received: ৳${received.toLocaleString()}`);
    const destination = row.transferCustodyLabel ?? next.custodyLabel ?? next.custody_label ?? row.transferDestinationType;
    if (destination) parts.push(`Destination: ${String(destination)}`);
    if (parts.length > 0) return parts.join(' · ');
  }

  const reason = next.reason ?? next.cancel_reason ?? previous.reason;
  if (reason) parts.push(`Reason: ${String(reason)}`);

  const status = next.status ?? next.payment_status ?? row.expenseStatus;
  if (status) parts.push(`Status: ${String(status)}`);

  const amount = next.amount ?? next.handover_amount ?? row.expenseAmount;
  const numericAmount = typeof amount === 'number' ? amount : Number(amount);
  if (Number.isFinite(numericAmount)) {
    parts.push(`Amount: ৳${numericAmount.toLocaleString()}`);
  }

  const total = next.total ?? next.total_amount;
  const numericTotal = typeof total === 'number' ? total : Number(total);
  if (Number.isFinite(numericTotal)) {
    parts.push(`Total: ৳${numericTotal.toLocaleString()}`);
  }

  const invoice = next.invoiceNo ?? next.invoice_no ?? next.bill_no;
  if (invoice) parts.push(`Invoice: ${String(invoice)}`);

  const category = next.category ?? row.expenseCategory;
  if (category) parts.push(`Category: ${String(category)}`);

  const description = next.description ?? row.expenseDescription;
  if (description) parts.push(`Description: ${String(description)}`);

  if (parts.length > 0) return parts.join(' · ');
  if (row.ip_address) return `IP: ${row.ip_address}`;
  return 'No extra details';
}

function parseAmountFromValue(value: string | null | undefined): number | undefined {
  const obj = parseJsonObject(value);
  const candidates = [obj.amount, obj.total, obj.total_amount, obj.handover_amount];
  for (const raw of candidates) {
    if (raw === undefined || raw === null) continue;
    const numeric = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function resolveCashAmount(
  row: RawAuditEntry,
  entity: string,
  action: string
): number | undefined {
  if (entity === 'bills' || entity === 'billing') {
    if (action !== 'payment') return undefined;
    const next = parseJsonObject(row.new_value);
    return toFiniteNumber(next.amount ?? next.paymentAmount ?? next.payment_amount);
  }

  if (entity === 'expenses') {
    return parseAmountFromValue(row.new_value)
      ?? parseAmountFromValue(row.old_value)
      ?? toFiniteNumber(row.expenseAmount);
  }

  if (entity === 'billing_counter_cash_transfers') {
    return toFiniteNumber(row.transferAmount)
      ?? parseAmountFromValue(row.new_value)
      ?? parseAmountFromValue(row.old_value);
  }

  return parseAmountFromValue(row.new_value) ?? parseAmountFromValue(row.old_value);
}

function getAmountSign(
  entity: string,
  action: string,
  parsed: Record<string, unknown>
): 'in' | 'out' | undefined {
  if (entity === 'cash_drawer_movements') {
    const movementType = String(parsed.movementType ?? '').toLowerCase();
    if (movementType === 'cash_in') return 'in';
    if (movementType === 'cash_out' || movementType === 'cash_out_refund') return 'out';
  }
  if (entity === 'expenses') return 'out';
  if (entity === 'billing_counter_cash_transfers') {
    const status = String(parsed.status ?? '').toLowerCase();
    if (status === 'received') return undefined;
    return 'out';
  }
  if (entity === 'billing_handovers' || entity === 'handover_transactions') return 'out';
  if (entity === 'emp_cash_transactions') return 'in';
  if (entity === 'billing_deposits') {
    const t = String(parsed.transaction_type ?? '').toLowerCase();
    if (t === 'refund' || t === 'withdraw' || t === 'adjustment') return 'out';
    return 'in';
  }
  if (entity === 'bills' || entity === 'billing' || entity === 'payments') {
    if (action === 'cancel' || action === 'delete' || action === 'refund') return 'out';
    if (action === 'payment' || action === 'create') return 'in';
  }
  return undefined;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeBillStatus(value: unknown): BillPaymentStatus {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'paid') return 'paid';
  if (raw === 'partially_paid' || raw === 'partial' || raw === 'partial_paid') return 'partially_paid';
  if (raw === 'open' || raw === 'unpaid' || raw === 'pending') return 'open';
  if (raw === '') return 'unknown';
  if (raw === 'cancelled' || raw === 'canceled') return 'cancelled';
  if (raw === 'refunded') return 'refunded';
  if (raw === 'draft') return 'draft';
  return 'unknown';
}

function resolvePaymentInfo(
  row: RawAuditEntry,
  entity: string
): { status: BillPaymentStatus; paid?: number; due?: number; total?: number } {
  if (entity !== 'bills' && entity !== 'billing') return { status: 'unknown' };

  const next = parseJsonObject(row.new_value);
  const previous = parseJsonObject(row.old_value);

  const enrichedStatus = row.billStatus;
  const enrichedTotal = toFiniteNumber(row.billTotal);
  const enrichedPaid = toFiniteNumber(row.billPaid);
  const enrichedDue = toFiniteNumber(row.billDue);

  if (enrichedStatus !== undefined && enrichedStatus !== null) {
    const status = normalizeBillStatus(enrichedStatus);
    const reconciledPaid = enrichedTotal !== undefined && enrichedDue !== undefined
      && (status === 'partially_paid' || status === 'paid')
      ? Math.max(0, enrichedTotal - Math.min(enrichedTotal, Math.max(0, enrichedDue)))
      : undefined;

    return {
      status,
      paid: reconciledPaid === undefined
        ? enrichedPaid
        : Math.max(enrichedPaid ?? 0, reconciledPaid),
      due: enrichedDue,
      total: enrichedTotal,
    };
  }

  const status = normalizeBillStatus(next.status ?? next.payment_status ?? previous.status);
  const total = toFiniteNumber(next.total ?? next.total_amount) ?? toFiniteNumber(previous.total);
  const paid = toFiniteNumber(next.paid ?? next.newPaid) ?? toFiniteNumber(previous.paid);
  const due = toFiniteNumber(next.due ?? next.newDue) ?? toFiniteNumber(previous.due);

  if (status === 'unknown' && !total && !paid && !due) return { status: 'unknown' };
  return { status, paid, due, total };
}

export function toAuditEntry(row: RawAuditEntry): AuditEntry {
  const action = normalizeKey(row.action);
  const entity = normalizeKey(row.table_name) || 'unknown';
  const entityLabel = ENTITY_LABELS[entity] ?? humanize(entity);
  const actionLabel = ACTION_LABELS[action] ?? humanize(action);
  const groupKey = getAuditGroup(entity);

  const next = parseJsonObject(row.new_value);
  const previous = parseJsonObject(row.old_value);
  const parsed = Object.keys(next).length > 0 ? next : previous;

  const amount = resolveCashAmount(row, entity, action);
  const amountSign = amount !== undefined && groupKey === 'cash' ? getAmountSign(entity, action, parsed) : undefined;
  const payment = resolvePaymentInfo(row, entity);

  return {
    id: row.id,
    user_id: row.user_id,
    user_name: row.user_name,
    action,
    actionLabel,
    entity,
    entityLabel,
    groupKey,
    groupLabel: GROUP_LABELS[groupKey],
    entity_id: row.record_id ?? null,
    details: formatAuditDetails(row),
    amount,
    amountSign,
    paymentStatus: payment.status,
    paymentPaid: payment.paid,
    paymentDue: payment.due,
    paymentTotal: payment.total,
    created_at: row.created_at,
  };
}
