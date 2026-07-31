export type DiagnosticPaymentStatus =
  | 'not_required'
  | 'pending_selection'
  | 'approved_credit'
  | 'paid'
  | 'partially_paid'
  | 'unpaid'
  | 'cancelled'
  | 'refunded'
  | 'unknown';

export interface DiagnosticBillingRow {
  billId?: number | string | null;
  bill_id?: number | string | null;
  billStatus?: string | null;
  bill_status?: string | null;
  billTotal?: number | string | null;
  bill_total?: number | string | null;
  billPaid?: number | string | null;
  bill_paid?: number | string | null;
  diagnosticBillingStatus?: string | null;
  diagnostic_billing_status?: string | null;
}

export interface DiagnosticBillingClearance {
  cleared: boolean;
  paymentStatus: DiagnosticPaymentStatus;
  billId: number | null;
  total: number;
  paid: number;
  outstanding: number;
}

function asNumber(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function asBillId(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeBillStatus(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export function getDiagnosticBillingClearance(row: DiagnosticBillingRow): DiagnosticBillingClearance {
  const billId = asBillId(row.billId ?? row.bill_id);
  const diagnosticStatus = normalizeBillStatus(row.diagnosticBillingStatus ?? row.diagnostic_billing_status);
  const billStatus = normalizeBillStatus(row.billStatus ?? row.bill_status);
  const total = Math.max(0, asNumber(row.billTotal ?? row.bill_total));
  const paid = Math.max(0, asNumber(row.billPaid ?? row.bill_paid));
  const outstanding = Math.max(0, total - paid);

  if (diagnosticStatus === 'pending_selection') {
    return { cleared: false, paymentStatus: 'pending_selection', billId, total, paid, outstanding };
  }

  if (!billId || total === 0) {
    return { cleared: true, paymentStatus: 'not_required', billId, total, paid, outstanding: 0 };
  }

  if (billStatus === 'cancelled') {
    return { cleared: false, paymentStatus: 'cancelled', billId, total, paid, outstanding };
  }

  if (billStatus === 'refunded') {
    return { cleared: false, paymentStatus: 'refunded', billId, total, paid, outstanding };
  }

  if (diagnosticStatus === 'approved_credit' || diagnosticStatus === 'approved_unpaid') {
    return { cleared: true, paymentStatus: 'approved_credit', billId, total, paid, outstanding };
  }

  if (billStatus === 'paid' || paid >= total) {
    return { cleared: true, paymentStatus: 'paid', billId, total, paid: Math.max(paid, total), outstanding: 0 };
  }

  if (paid > 0) {
    return { cleared: false, paymentStatus: 'partially_paid', billId, total, paid, outstanding };
  }

  if (billStatus === 'open' || billStatus === 'partially_paid' || billStatus === '') {
    return { cleared: false, paymentStatus: 'unpaid', billId, total, paid, outstanding };
  }

  return { cleared: false, paymentStatus: 'unknown', billId, total, paid, outstanding };
}

export function getDiagnosticBillingColumns(orderAlias: string): string {
  return [
    `${orderAlias}.bill_id as bill_id`,
    `${orderAlias}.billing_status as diagnostic_billing_status`,
    'b.status as bill_status',
    'b.total as bill_total',
    'b.paid as bill_paid',
  ].join(', ');
}

export function getDiagnosticBillingJoin(orderAlias: string): string {
  return `LEFT JOIN bills b ON b.id = ${orderAlias}.bill_id AND b.tenant_id = ${orderAlias}.tenant_id`;
}

export function getDiagnosticBillPaidUpdateSql(table: 'lab_orders' | 'radiology_requisitions'): string {
  return `
    UPDATE ${table}
    SET billing_status = 'paid', payment_cleared_at = datetime('now'), updated_at = datetime('now')
    WHERE bill_id = ? AND tenant_id = ?
  `;
}
