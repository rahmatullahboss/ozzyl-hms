export type InvoiceInspectorReconciliationStatus = 'reconciled' | 'warning';

export interface InvoiceInspectorSummary {
  billId: number;
  invoiceNo: string;
  status: string;
  patientId: number | null;
  patientName: string | null;
  createdAt: string | null;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  paidAmount: number;
  depositAppliedAmount: number;
  dueAmount: number;
  [key: string]: unknown;
}

export interface InvoiceInspectorItem {
  id: number | string;
  category: string;
  description: string;
  quantity: number;
  rate: number;
  lineTotal: number;
  [key: string]: unknown;
}

export interface InvoiceInspectorPayment {
  id: number | string;
  amount: number;
  [key: string]: unknown;
}

export interface InvoiceInspectorDeposit {
  id: number | string;
  amount: number;
  adjustmentType: string;
  [key: string]: unknown;
}

export interface InvoiceInspectorDiscountAllocation {
  id: number | string;
  amount: number;
  [key: string]: unknown;
}

export interface InvoiceInspectorCompensation {
  id: number | string;
  doctorId: number | null;
  doctorName: string | null;
  sourceType: string;
  grossAmount: number;
  discountAmount: number;
  performerReserveAmount: number;
  eligibleBaseAmount: number;
  earnedAmount: number;
  waiverAmount: number;
  adjustmentAmount: number;
  payableAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
  reasonCode: string;
  [key: string]: unknown;
}

export interface InvoiceInspectorAuditEvent {
  id: number | string;
  occurredAt?: string | null;
  [key: string]: unknown;
}

export interface InvoiceInspectorActions {
  fullBillingUrl?: string | null;
  printUrl?: string | null;
  pdfUrl?: string | null;
}

export interface InvoiceInspectorResponse {
  summary: InvoiceInspectorSummary;
  items: InvoiceInspectorItem[];
  payments: InvoiceInspectorPayment[];
  deposits: InvoiceInspectorDeposit[];
  discounts: InvoiceInspectorDiscountAllocation[];
  compensation: InvoiceInspectorCompensation[];
  audit: InvoiceInspectorAuditEvent[];
  reconciliation: {
    invoice: {
      grossAmount: number;
      discountAmount: number;
      expectedNetAmount: number;
      netAmount: number;
      difference: number;
      status: InvoiceInspectorReconciliationStatus;
    };
    settlement: {
      paymentAmount: number;
      depositAppliedAmount: number;
      settledAmount: number;
      expectedSettledAmount: number;
      dueAmount: number;
      difference: number;
      status: InvoiceInspectorReconciliationStatus;
    };
    compensation: {
      payableAmount: number;
      paidAmount: number;
      outstandingAmount: number;
      difference: number;
      status: InvoiceInspectorReconciliationStatus;
    };
  };
  warnings: string[];
  actions: InvoiceInspectorActions;
}

export interface BuildInvoiceInspectorResponseInput {
  summary: Record<string, unknown> & {
    billId: unknown;
    invoiceNo: unknown;
    status: unknown;
  };
  items?: readonly Record<string, unknown>[];
  payments?: readonly Record<string, unknown>[];
  deposits?: readonly Record<string, unknown>[];
  discounts?: readonly Record<string, unknown>[];
  compensation?: readonly Record<string, unknown>[];
  audit?: readonly Record<string, unknown>[];
  warnings?: readonly string[];
  actions?: InvoiceInspectorActions;
}

const TOLERANCE = 0.01;

export function normalizeInvoiceMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function normalizedDifference(left: number, right: number): number {
  return normalizeInvoiceMoney(left - right);
}

function statusForDifference(difference: number): InvoiceInspectorReconciliationStatus {
  return Math.abs(difference) <= TOLERANCE ? 'reconciled' : 'warning';
}

function normalizeSummary(raw: BuildInvoiceInspectorResponseInput['summary']): InvoiceInspectorSummary {
  return {
    ...raw,
    billId: Math.max(0, Math.trunc(Number(raw.billId ?? 0))),
    invoiceNo: String(raw.invoiceNo ?? ''),
    status: String(raw.status ?? 'unknown'),
    patientId: raw.patientId === null || raw.patientId === undefined ? null : Number(raw.patientId),
    patientName: raw.patientName === null || raw.patientName === undefined ? null : String(raw.patientName),
    createdAt: raw.createdAt === null || raw.createdAt === undefined ? null : String(raw.createdAt),
    grossAmount: normalizeInvoiceMoney(raw.grossAmount),
    discountAmount: normalizeInvoiceMoney(raw.discountAmount),
    netAmount: normalizeInvoiceMoney(raw.netAmount),
    paidAmount: normalizeInvoiceMoney(raw.paidAmount),
    depositAppliedAmount: normalizeInvoiceMoney(raw.depositAppliedAmount),
    dueAmount: normalizeInvoiceMoney(raw.dueAmount),
  };
}

function normalizeItems(rows: readonly Record<string, unknown>[] | undefined): InvoiceInspectorItem[] {
  return (rows ?? []).map((row, index) => ({
    ...row,
    id: (row.id as number | string | undefined) ?? index + 1,
    category: String(row.category ?? 'other'),
    description: String(row.description ?? ''),
    quantity: normalizeInvoiceMoney(row.quantity),
    rate: normalizeInvoiceMoney(row.rate),
    lineTotal: normalizeInvoiceMoney(row.lineTotal),
  }));
}

function normalizePayments(rows: readonly Record<string, unknown>[] | undefined): InvoiceInspectorPayment[] {
  return (rows ?? []).map((row, index) => ({
    ...row,
    id: (row.id as number | string | undefined) ?? index + 1,
    amount: normalizeInvoiceMoney(row.amount),
  }));
}

function normalizeDeposits(rows: readonly Record<string, unknown>[] | undefined): InvoiceInspectorDeposit[] {
  return (rows ?? []).map((row, index) => ({
    ...row,
    id: (row.id as number | string | undefined) ?? index + 1,
    amount: normalizeInvoiceMoney(row.amount),
    adjustmentType: String(row.adjustmentType ?? 'unknown'),
  }));
}

function normalizeDiscounts(rows: readonly Record<string, unknown>[] | undefined): InvoiceInspectorDiscountAllocation[] {
  return (rows ?? []).map((row, index) => ({
    ...row,
    id: (row.id as number | string | undefined) ?? index + 1,
    amount: normalizeInvoiceMoney(row.amount),
  }));
}

function normalizeCompensation(rows: readonly Record<string, unknown>[] | undefined): InvoiceInspectorCompensation[] {
  return (rows ?? []).map((row, index) => ({
    ...row,
    id: (row.id as number | string | undefined) ?? index + 1,
    doctorId: row.doctorId === null || row.doctorId === undefined ? null : Number(row.doctorId),
    doctorName: row.doctorName === null || row.doctorName === undefined ? null : String(row.doctorName),
    sourceType: String(row.sourceType ?? 'other'),
    grossAmount: normalizeInvoiceMoney(row.grossAmount),
    discountAmount: normalizeInvoiceMoney(row.discountAmount),
    performerReserveAmount: normalizeInvoiceMoney(row.performerReserveAmount),
    eligibleBaseAmount: normalizeInvoiceMoney(row.eligibleBaseAmount),
    earnedAmount: normalizeInvoiceMoney(row.earnedAmount),
    waiverAmount: normalizeInvoiceMoney(row.waiverAmount),
    adjustmentAmount: normalizeInvoiceMoney(row.adjustmentAmount),
    payableAmount: normalizeInvoiceMoney(row.payableAmount),
    paidAmount: normalizeInvoiceMoney(row.paidAmount),
    outstandingAmount: normalizeInvoiceMoney(row.outstandingAmount),
    status: String(row.status ?? 'unknown'),
    reasonCode: String(row.reasonCode ?? 'held_for_review'),
  }));
}

export function buildInvoiceInspectorResponse(
  input: BuildInvoiceInspectorResponseInput,
): InvoiceInspectorResponse {
  const summary = normalizeSummary(input.summary);
  const items = normalizeItems(input.items);
  const payments = normalizePayments(input.payments);
  const deposits = normalizeDeposits(input.deposits);
  const discounts = normalizeDiscounts(input.discounts);
  const compensation = normalizeCompensation(input.compensation);
  const audit = [...(input.audit ?? [])] as InvoiceInspectorAuditEvent[];
  const warnings = [...(input.warnings ?? [])];

  const expectedNetAmount = normalizeInvoiceMoney(summary.grossAmount - summary.discountAmount);
  const invoiceDifference = normalizedDifference(expectedNetAmount, summary.netAmount);
  const invoiceStatus = statusForDifference(invoiceDifference);
  if (invoiceStatus === 'warning') {
    warnings.push(`Invoice gross less discount differs from net by BDT ${Math.abs(invoiceDifference).toFixed(2)}.`);
  }

  const paymentAmount = payments.length > 0
    ? normalizeInvoiceMoney(payments.reduce((sum, row) => sum + row.amount, 0))
    : summary.paidAmount;
  const depositAppliedAmount = deposits.length > 0
    ? normalizeInvoiceMoney(deposits
      .filter((row) => row.adjustmentType.toLowerCase() === 'applied')
      .reduce((sum, row) => sum + row.amount, 0))
    : summary.depositAppliedAmount;
  const settledAmount = normalizeInvoiceMoney(paymentAmount + depositAppliedAmount);
  const expectedSettledAmount = normalizeInvoiceMoney(summary.netAmount - summary.dueAmount);
  const settlementDifference = normalizedDifference(settledAmount, expectedSettledAmount);
  const settlementStatus = statusForDifference(settlementDifference);
  if (settlementStatus === 'warning') {
    warnings.push(`Payments plus applied deposits differ from settled amount by BDT ${Math.abs(settlementDifference).toFixed(2)}.`);
  }

  const payableAmount = normalizeInvoiceMoney(compensation.reduce((sum, row) => sum + row.payableAmount, 0));
  const paidAmount = normalizeInvoiceMoney(compensation.reduce((sum, row) => sum + row.paidAmount, 0));
  const outstandingAmount = normalizeInvoiceMoney(compensation.reduce((sum, row) => sum + row.outstandingAmount, 0));
  const compensationDifference = normalizedDifference(payableAmount, paidAmount + outstandingAmount);
  const compensationStatus = statusForDifference(compensationDifference);
  if (compensationStatus === 'warning') {
    warnings.push(`Doctor payable differs from paid plus outstanding by BDT ${Math.abs(compensationDifference).toFixed(2)}.`);
  }

  return {
    summary,
    items,
    payments,
    deposits,
    discounts,
    compensation,
    audit,
    reconciliation: {
      invoice: {
        grossAmount: summary.grossAmount,
        discountAmount: summary.discountAmount,
        expectedNetAmount,
        netAmount: summary.netAmount,
        difference: invoiceDifference,
        status: invoiceStatus,
      },
      settlement: {
        paymentAmount,
        depositAppliedAmount,
        settledAmount,
        expectedSettledAmount,
        dueAmount: summary.dueAmount,
        difference: settlementDifference,
        status: settlementStatus,
      },
      compensation: {
        payableAmount,
        paidAmount,
        outstandingAmount,
        difference: compensationDifference,
        status: compensationStatus,
      },
    },
    warnings,
    actions: { ...(input.actions ?? {}) },
  };
}
