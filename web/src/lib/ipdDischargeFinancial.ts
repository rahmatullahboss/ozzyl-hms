export type IpdPendingSummary = {
  provisional_total?: number | null;
  package_total?: number | null;
  bed_total?: number | null;
  grand_total?: number | null;
  running_total?: number | null;
  deposit_balance?: number | null;
  net_payable?: number | null;
  refund_available?: number | null;
  pending_service_amount?: number | null;
};

export type AdmissionBillingStatus = {
  pending?: {
    total?: number | null;
    provisional_amount?: number | null;
    pending_service_amount?: number | null;
    due_amount?: number | null;
  } | null;
  deposit_balance?: number | null;
  net_payable?: number | null;
} | null;

export type IpdOutstandingInvoiceCategoryApi = {
  code: string;
  label: string;
  amount: number;
};

export type IpdOutstandingInvoiceApi = {
  invoice_number: string;
  issued_at?: string | null;
  currency_code?: string | null;
  total: number;
  paid: number;
  credited?: number | null;
  due: number;
  legacy_bill_id?: number | null;
  canonical_invoice_public_id?: string | null;
  admission_id?: number | null;
  visit_id?: number | null;
  source_label?: string | null;
  categories?: IpdOutstandingInvoiceCategoryApi[] | null;
};

export type IpdFinancialClearanceApi = {
  authority_mode?: 'legacy' | 'shadow' | 'canonical' | string;
  currency_code?: string | null;
  total_outstanding?: number | null;
  invoice_count?: number | null;
  inline_settlement_supported?: boolean | null;
  invoices?: IpdOutstandingInvoiceApi[] | null;
};

export type DischargeOutstandingInvoice = {
  invoiceNumber: string;
  issuedAt: string | null;
  currencyCode: string;
  total: number;
  paid: number;
  credited: number;
  due: number;
  legacyBillId: number | null;
  canonicalInvoicePublicId: string | null;
  admissionId: number | null;
  visitId: number | null;
  sourceLabel: string;
  categories: Array<{ code: string; label: string; amount: number }>;
};

export type DischargeFinancialSummary = {
  totalCharges: number;
  discountPercent: number;
  afterDiscount: number;
  depositBalance: number;
  netPayable: number;
  refundAmount: number;
  otherOutstanding: number;
  totalPayableBeforeClearance: number;
  outstandingInvoices: DischargeOutstandingInvoice[];
  inlineSettlementSupported: boolean;
  authorityMode: string;
  unresolvedServiceAmount: number;
};

function toAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.max(0, amount) : 0;
}

export function getIpdPendingTotal(summary?: IpdPendingSummary | null): number {
  if (!summary) return 0;

  const runningTotal = toAmount(summary.running_total);
  if (runningTotal > 0) return runningTotal;

  const grandTotal = toAmount(summary.grand_total);
  if (grandTotal > 0) return grandTotal;

  return toAmount(summary.provisional_total) + toAmount(summary.package_total) + toAmount(summary.bed_total);
}

function mapOutstandingInvoices(clearance?: IpdFinancialClearanceApi | null): DischargeOutstandingInvoice[] {
  return (clearance?.invoices ?? []).filter((invoice) => toAmount(invoice.due) > 0).map((invoice) => ({
    invoiceNumber: String(invoice.invoice_number || 'Invoice'),
    issuedAt: invoice.issued_at ? String(invoice.issued_at) : null,
    currencyCode: String(invoice.currency_code || clearance?.currency_code || 'BDT'),
    total: toAmount(invoice.total),
    paid: toAmount(invoice.paid),
    credited: toAmount(invoice.credited),
    due: toAmount(invoice.due),
    legacyBillId: invoice.legacy_bill_id == null ? null : Number(invoice.legacy_bill_id),
    canonicalInvoicePublicId: invoice.canonical_invoice_public_id == null ? null : String(invoice.canonical_invoice_public_id),
    admissionId: invoice.admission_id == null ? null : Number(invoice.admission_id),
    visitId: invoice.visit_id == null ? null : Number(invoice.visit_id),
    sourceLabel: String(invoice.source_label || 'Other invoice'),
    categories: (invoice.categories ?? []).map((category) => ({
      code: String(category.code || 'other'),
      label: String(category.label || 'Other'),
      amount: toAmount(category.amount),
    })),
  }));
}

export function buildDischargeFinancial({
  pendingSummary,
  billingStatus,
  financialClearance,
}: {
  pendingSummary?: IpdPendingSummary | null;
  billingStatus?: AdmissionBillingStatus;
  financialClearance?: IpdFinancialClearanceApi | null;
}): DischargeFinancialSummary {
  const pendingTotal = getIpdPendingTotal(pendingSummary);
  const fallbackTotal = toAmount(billingStatus?.pending?.total);
  const totalCharges = pendingSummary ? pendingTotal : fallbackTotal;
  const depositBalance = pendingSummary
    ? toAmount(pendingSummary.deposit_balance)
    : toAmount(billingStatus?.deposit_balance);
  const netPayable = pendingSummary
    ? toAmount(pendingSummary.net_payable)
    : toAmount(billingStatus?.net_payable);
  const refundAmount = pendingSummary?.refund_available != null
    ? toAmount(pendingSummary.refund_available)
    : Math.max(0, depositBalance - totalCharges);
  const outstandingInvoices = mapOutstandingInvoices(financialClearance);
  const summedOtherOutstanding = outstandingInvoices.reduce((sum, invoice) => sum + invoice.due, 0);
  const otherOutstanding = financialClearance?.total_outstanding == null
    ? summedOtherOutstanding
    : toAmount(financialClearance.total_outstanding);

  return {
    totalCharges,
    discountPercent: 0,
    afterDiscount: totalCharges,
    depositBalance,
    netPayable,
    refundAmount,
    otherOutstanding,
    totalPayableBeforeClearance: netPayable + otherOutstanding,
    outstandingInvoices,
    inlineSettlementSupported: financialClearance?.inline_settlement_supported !== false,
    authorityMode: String(financialClearance?.authority_mode || 'legacy'),
    unresolvedServiceAmount: pendingSummary?.pending_service_amount != null
      ? toAmount(pendingSummary.pending_service_amount)
      : toAmount(billingStatus?.pending?.pending_service_amount),
  };
}
