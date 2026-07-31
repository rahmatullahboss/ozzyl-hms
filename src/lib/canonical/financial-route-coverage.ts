import type { StrictFinancialBoundary } from './strict-financial-boundaries';

export type FinancialRouteCoverageStatus = 'integrated' | 'blocked_in_strict';

export interface FinancialRouteCoverage {
  boundary: StrictFinancialBoundary;
  status: FinancialRouteCoverageStatus;
  routeFile: `src/routes/tenant/${string}.ts`;
  canonicalCommand: string | null;
  reason: string;
}

export const FINANCIAL_ROUTE_COVERAGE: Record<StrictFinancialBoundary, FinancialRouteCoverage> = {
  'billing.create': {
    boundary: 'billing.create',
    status: 'integrated',
    routeFile: 'src/routes/tenant/billing.ts',
    canonicalCommand: 'issueInvoice',
    reason: 'The billing route executes issueInvoice through executeStrictFinancialMutation.',
  },
  'billing-counter.invoice.create': {
    boundary: 'billing-counter.invoice.create',
    status: 'integrated',
    routeFile: 'src/routes/tenant/billingCounter.legacy.ts',
    canonicalCommand: 'issueInvoice',
    reason: 'The billing-counter route executes issueInvoice through executeStrictFinancialMutation.',
  },
  'billing.payment.collect': {
    boundary: 'billing.payment.collect',
    status: 'integrated',
    routeFile: 'src/routes/tenant/billing.ts',
    canonicalCommand: 'collectPayment',
    reason: 'The payment route executes collectPayment through executeStrictFinancialMutation.',
  },
  'doctor-compensation.accrue': {
    boundary: 'doctor-compensation.accrue',
    status: 'integrated',
    routeFile: 'src/routes/tenant/billing.ts',
    canonicalCommand: 'executeLiveDoctorCommissionAccrual',
    reason: 'Billing finalization and payout reserve flows execute legacy and canonical compensation accruals through the shared strict financial mutation boundary.',
  },
  'doctor-compensation.adjust': {
    boundary: 'doctor-compensation.adjust',
    status: 'integrated',
    routeFile: 'src/routes/tenant/billingCancellation.ts',
    canonicalCommand: 'prepareCompensationAdjustment',
    reason: 'Unpaid performer-reserve cancellation commits guarded compatibility, audit, canonical adjustment, idempotency and outbox evidence through one strict financial mutation boundary.',
  },
  'doctor-compensation.settle': {
    boundary: 'doctor-compensation.settle',
    status: 'integrated',
    routeFile: 'src/routes/tenant/receptionDoctorPayouts.ts',
    canonicalCommand: 'executeLiveCompensationSettlement',
    reason: 'Doctor and performer payouts commit the legacy settlement and canonical allocations through one strict financial mutation boundary.',
  },
  'doctor-compensation.reverse': {
    boundary: 'doctor-compensation.reverse',
    status: 'integrated',
    routeFile: 'src/routes/tenant/receptionDoctorPayouts.ts',
    canonicalCommand: 'executeLiveCancelledCompensationSettlementReversal',
    reason: 'Performer payout cancellation reverses legacy cash and canonical settlement facts through one strict financial mutation boundary.',
  },
  'doctor-compensation.refund-reserve': {
    boundary: 'doctor-compensation.refund-reserve',
    status: 'integrated',
    routeFile: 'src/routes/tenant/approvals.ts',
    canonicalCommand: 'executeLiveRefundCompensationReservation',
    reason: 'Refund requests reserve unpaid legacy and canonical practitioner compensation through one strict financial mutation boundary.',
  },
  'doctor-compensation.refund-release': {
    boundary: 'doctor-compensation.refund-release',
    status: 'integrated',
    routeFile: 'src/routes/tenant/refundDisputes.ts',
    canonicalCommand: 'executeLiveRefundCompensationRelease',
    reason: 'Refund dispute recovery restores legacy compensation and records an immutable canonical adjustment reversal through one strict financial mutation boundary.',
  },
  'deposit.collect': {
    boundary: 'deposit.collect',
    status: 'integrated',
    routeFile: 'src/routes/tenant/deposits.ts',
    canonicalCommand: 'recordDeposit',
    reason: 'Deposit collection executes recordDeposit through executeStrictFinancialMutation.',
  },
  'reception.admission.deposit.collect': {
    boundary: 'reception.admission.deposit.collect',
    status: 'integrated',
    routeFile: 'src/routes/tenant/reception.ts',
    canonicalCommand: 'recordDeposit',
    reason: 'Conditional admission, dependent legacy deposit authority and canonical deposit commit through one guarded strict financial mutation.',
  },
  'deposit.refund': {
    boundary: 'deposit.refund',
    status: 'integrated',
    routeFile: 'src/routes/tenant/deposits.ts',
    canonicalCommand: 'refundAvailableDeposits',
    reason: 'Deposit refund allocates oldest available canonical liabilities through one strict mutation batch.',
  },
  'deposit.apply': {
    boundary: 'deposit.apply',
    status: 'integrated',
    routeFile: 'src/routes/tenant/deposits.ts',
    canonicalCommand: 'applyAvailableDeposits',
    reason: 'Deposit application allocates oldest available liabilities and updates the mapped invoice in one strict batch.',
  },
  'credit-note.approve': {
    boundary: 'credit-note.approve',
    status: 'integrated',
    routeFile: 'src/routes/tenant/creditNotes.ts',
    canonicalCommand: 'issueCreditNote',
    reason: 'Receivable-only credit notes commit approval and canonical credit facts in one strict batch.',
  },
  'credit-note.cash-refund': {
    boundary: 'credit-note.cash-refund',
    status: 'integrated',
    routeFile: 'src/routes/tenant/approvals.ts',
    canonicalCommand: 'issueCreditNoteWithCashRefund',
    reason: 'Direct and held credit-note cash payouts use deterministic receipt, allocation, and original-tender lineage in one strict mutation batch.',
  },
  'credit-note.cash-refund.reverse': {
    boundary: 'credit-note.cash-refund.reverse',
    status: 'integrated',
    routeFile: 'src/routes/tenant/approvals.ts',
    canonicalCommand: 'reverseCreditNoteCashRefund',
    reason: 'Executed refund rejection atomically reverses canonical and compatibility finance, restores commission and invoice projections, and resolves physical cash through either verified return or an open dispute.',
  },
  'cash-custody.movement': {
    boundary: 'cash-custody.movement',
    status: 'integrated',
    routeFile: 'src/routes/tenant/billingCounter.ts',
    canonicalCommand: 'recordCashCustodyMovement',
    reason: 'Counter handover and reviewed refund cash movements preserve the legacy drawer statement while recording exact integer-minor-unit custody movement evidence through one strict command boundary.',
  },
  'payment.reverse': {
    boundary: 'payment.reverse',
    status: 'integrated',
    routeFile: 'src/routes/tenant/approvals.ts',
    canonicalCommand: 'reversePayment',
    reason: 'Approved payment voids resolve one mapped receipt, tender and allocation before one strict mutation batch.',
  },
  'bill.cancel.unpaid': {
    boundary: 'bill.cancel.unpaid',
    status: 'integrated',
    routeFile: 'src/routes/tenant/approvals.ts',
    canonicalCommand: 'cancelUnpaidInvoice',
    reason: 'Approved unpaid bill cancellation commits guarded legacy cancellation and the canonical invoice cancellation lifecycle through one strict financial mutation boundary.',
  },
  'appointment.billing.finalize': {
    boundary: 'appointment.billing.finalize',
    status: 'integrated',
    routeFile: 'src/routes/tenant/appointments.ts',
    canonicalCommand: 'issueInvoice / issueInvoiceWithFullPayment',
    reason: 'Appointment due approval and pay-now commit row-count-guarded legacy invoice authority with canonical invoice or full-payment authority through one strict financial mutation boundary.',
  },
  'billing-provisional.finalize': {
    boundary: 'billing-provisional.finalize',
    status: 'integrated',
    routeFile: 'src/routes/tenant/billingProvisional.ts',
    canonicalCommand: 'issueInvoiceWithSettlement',
    reason: 'Provisional invoice, optional direct payment and oldest-first deposit applications commit with row-count-guarded legacy authority through one strict financial mutation boundary.',
  },
  'ipd-discharge.billing.finalize': {
    boundary: 'ipd-discharge.billing.finalize',
    status: 'integrated',
    routeFile: 'src/routes/tenant/ipBilling.ts',
    canonicalCommand: 'finalizeIpdDischargeBilling',
    reason: 'IPD discharge invoice settlement, deposit application/refund, inpatient encounter completion and row-count-guarded legacy discharge authority commit through one strict canonical mutation boundary.',
  },
  'lab.billing.create': {
    boundary: 'lab.billing.create',
    status: 'integrated',
    routeFile: 'src/routes/tenant/lab.ts',
    canonicalCommand: 'createLabOrderBilling',
    reason: 'Lab order, bill, invoice items and visit services commit with row-count-guarded legacy authority plus canonical active service requests, accepted service events and invoice authority through one strict financial mutation boundary.',
  },
  'payment-gateway.verify': {
    boundary: 'payment-gateway.verify',
    status: 'integrated',
    routeFile: 'src/routes/tenant/payments.ts',
    canonicalCommand: 'settleGatewayPayment',
    reason: 'Gateway verification preserves the original legacy settlement in disabled and shadow modes while strict mode atomically commits guarded legacy payment, optional advance deposit, gateway success, accounting events, and canonical payment/deposit authority.',
  },
  'patient-chart.lab-billing.create': {
    boundary: 'patient-chart.lab-billing.create',
    status: 'integrated',
    routeFile: 'src/routes/tenant/patients.ts',
    canonicalCommand: 'createLabOrderBilling',
    reason: 'Patient-chart quick lab ordering preserves the original legacy workflow in disabled and shadow modes while strict mode atomically commits guarded order, bill and invoice-item authority with canonical service requests, accepted service events and invoice authority.',
  },
  'patient-chart.radiology-billing.create': {
    boundary: 'patient-chart.radiology-billing.create',
    status: 'integrated',
    routeFile: 'src/routes/tenant/patients.ts',
    canonicalCommand: 'createRadiologyRequisitionBilling',
    reason: 'Patient-chart quick radiology ordering preserves free-text and zero-value legacy behavior in disabled and shadow modes while strict mode atomically commits guarded requisition, bill and invoice-item authority with canonical service-request, accepted-event and invoice authority.',
  },
  'pharmacy.billing.finalize': {
    boundary: 'pharmacy.billing.finalize',
    status: 'integrated',
    routeFile: 'src/routes/tenant/pharmacy/advanced.ts',
    canonicalCommand: 'settlePharmacySale',
    reason: 'Provisional conversion and prescription dispense preserve their original stock-first legacy workflows in disabled and shadow modes while strict mode atomically commits guarded pharmacy invoice, stock, optional deposit, source-status and canonical service, settlement and inventory authority.',
  },
  'radiology.billing.create': {
    boundary: 'radiology.billing.create',
    status: 'integrated',
    routeFile: 'src/routes/tenant/radiology/orders.ts',
    canonicalCommand: 'createRadiologyRequisitionBilling',
    reason: 'Primary RIS requisition creation preserves the original free-text and zero-value legacy workflow in disabled and shadow modes while strict mode atomically commits guarded full-shape requisition, bill and invoice-item authority with canonical service-request, accepted-event and invoice authority.',
  },
  'reception.visit-billing.create': {
    boundary: 'reception.visit-billing.create',
    status: 'integrated',
    routeFile: 'src/routes/tenant/reception.ts',
    canonicalCommand: 'createReceptionVisitBilling',
    reason: 'Reception visit-service billing preserves the original conditional claim, bill, allocation, invoice-item, lab-link and failed-claim reset workflow in disabled and shadow modes while strict mode atomically commits guarded compatibility authority with canonical service requests, accepted events and discount-aware invoice authority.',
  },
  'settlement.finalize': {
    boundary: 'settlement.finalize',
    status: 'integrated',
    routeFile: 'src/routes/tenant/settlements.ts',
    canonicalCommand: 'finalizeSettlement',
    reason: 'Multi-bill settlement preserves the original cash, deposit, discount, accounting-event and audit workflow in disabled and shadow modes while strict mode atomically commits guarded settlement compatibility authority with canonical payment receipts, FIFO deposit applications, credit notes and invoice balances.',
  },
  'settlement.cancel': {
    boundary: 'settlement.cancel',
    status: 'integrated',
    routeFile: 'src/routes/tenant/settlements.ts',
    canonicalCommand: 'cancelSettlement',
    reason: 'Settlement cancellation preserves the reviewed legacy prefix and discount-fallback workflow in disabled and shadow modes while strict mode requires exact payment, deposit, discount, accounting and compensation evidence and atomically commits guarded legacy rollback with canonical reversals and invoice restoration.',
  },
};

export function getFinancialRouteCoverage(boundary: string): FinancialRouteCoverage | null {
  return Object.prototype.hasOwnProperty.call(FINANCIAL_ROUTE_COVERAGE, boundary)
    ? FINANCIAL_ROUTE_COVERAGE[boundary as StrictFinancialBoundary]
    : null;
}

export function isStrictFinancialBoundaryIntegrated(boundary: string): boolean {
  return getFinancialRouteCoverage(boundary)?.status === 'integrated';
}
