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
  billType?: string | null;
  patientCode?: string | null;
  patientIdentityRedacted?: boolean;
}

export interface InvoiceInspectorItem {
  id: number | string;
  category: string;
  description: string;
  quantity: number;
  rate: number;
  lineTotal: number;
  orderingDoctorName?: string | null;
  referringDoctorName?: string | null;
  performingDoctorName?: string | null;
  verifyingDoctorName?: string | null;
}

export interface InvoiceInspectorPayment {
  id: number | string;
  amount: number;
  receiptNo?: string | null;
  method?: string | null;
  paymentType?: string | null;
  collectorName?: string | null;
  counterName?: string | null;
  paidAt?: string | null;
  status?: string | null;
}

export interface InvoiceInspectorDeposit {
  id: number | string;
  amount: number;
  adjustmentType: string;
  paymentMethod?: string | null;
  referenceNo?: string | null;
  occurredAt?: string | null;
  status?: string | null;
}

export interface InvoiceInspectorDiscountAllocation {
  id: number | string;
  amount: number;
  referenceName?: string | null;
  reason?: string | null;
  sourceType?: string | null;
  funderType?: string | null;
  doctorId?: number | null;
  doctorName?: string | null;
  status?: string | null;
}

export interface InvoiceInspectorCompensation {
  id: number | string;
  doctorId: number | null;
  doctorName: string | null;
  sourceType: string;
  incentiveType?: string | null;
  ruleId?: number | string | null;
  ruleVersion?: number | null;
  grossAmount: number;
  discountAmount: number;
  performerReserveAmount: number;
  eligibleBaseAmount: number;
  rateLabel?: string | null;
  earnedAmount: number;
  waiverAmount: number;
  adjustmentAmount: number;
  payableAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
  reasonCode: string;
  reasonLabel?: string | null;
  settlementNo?: string | null;
}

export interface InvoiceInspectorAuditEvent {
  id: number | string;
  occurredAt?: string | null;
  eventType?: string | null;
  actorName?: string | null;
  referenceNo?: string | null;
  status?: string | null;
  description?: string | null;
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
  actions: {
    fullBillingUrl?: string | null;
    printUrl?: string | null;
    pdfUrl?: string | null;
  };
}
