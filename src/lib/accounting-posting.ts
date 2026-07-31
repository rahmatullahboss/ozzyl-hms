import type { D1Database } from '@cloudflare/workers-types';
import { isPeriodClosed, calculateVoucherHash } from './accounting-hardening';

export const ACCOUNTING_EVENT_TYPES = {
  billCreated: 'bill_created',
  billCancelled: 'bill_cancelled',
  creditNoteIssued: 'credit_note_issued',
  paymentReceived: 'payment_received',
  patientDepositReceived: 'patient_deposit_received',
  patientDepositAdjusted: 'patient_deposit_adjusted',
  patientDepositRefunded: 'patient_deposit_refunded',
  settlementDiscount: 'settlement_discount',
  commissionAccrued: 'commission_accrued',
  commissionCancelled: 'commission_cancelled',
  commissionSettled: 'commission_settled',
  agentCommissionAccrued: 'agent_commission_accrued',
  agentCommissionCancelled: 'agent_commission_cancelled',
  agentCommissionSettled: 'agent_commission_settled',
  supplierPayment: 'supplier_payment',
  pharmacyPurchase: 'pharmacy_purchase',
  pharmacySaleCogs: 'pharmacy_sale_cogs',
  inventoryPurchase: 'inventory_purchase',
  inventoryReturn: 'inventory_return',
  inventoryConsumption: 'inventory_consumption',
  profitDistributionDeclared: 'profit_distribution_declared',
  shareholderDividendPaid: 'shareholder_dividend_paid',
  directIncomeReceived: 'direct_income_received',
  directExpensePaid: 'direct_expense_paid',
  cashHandover: 'cash_handover',
  bankDepositCustody: 'bank_deposit_custody',
  bankDepositConfirmed: 'bank_deposit_confirmed',
  manualJournal: 'manual_journal',
} as const;

export type AccountingEventType = typeof ACCOUNTING_EVENT_TYPES[keyof typeof ACCOUNTING_EVENT_TYPES];

export type AccountMappingKey =
  | 'cash'
  | 'bank'
  | 'card_clearing'
  | 'bkash_wallet'
  | 'nagad_wallet'
  | 'rocket_wallet'
  | 'bank_transfer_clearing'
  | 'cheque_clearing'
  | 'other_payment_clearing'
  | 'accounts_receivable'
  | 'employee_dispute_receivable'
  | 'lab_revenue'
  | 'doctor_visit_revenue'
  | 'admission_revenue'
  | 'operation_revenue'
  | 'pharmacy_revenue'
  | 'other_revenue'
  | 'discount_allowed'
  | 'doctor_commission_expense'
  | 'doctor_commission_payable'
  | 'doctor_advance_receivable'
  | 'doctor_settlement_adjustment'
  | 'rounding_adjustment'
  | 'agent_commission_expense'
  | 'agent_commission_payable'
  | 'patient_deposit_liability'
  | 'pharmacy_inventory'
  | 'pharmacy_cogs'
  | 'general_inventory'
  | 'inventory_expense'
  | 'expense_salary'
  | 'expense_medicine'
  | 'expense_rent'
  | 'expense_electricity'
  | 'expense_water'
  | 'expense_communication'
  | 'expense_maintenance'
  | 'expense_supplies'
  | 'expense_marketing'
  | 'expense_bank_charges'
  | 'general_expense'
  | 'accounts_payable'
  | 'retained_earnings'
  | 'shareholder_payable'
  | 'withholding_payable'
  | 'admin_cash';

export type ResolvedAccountMappings = Partial<Record<AccountMappingKey, number>>;

export interface JournalLineInput {
  accountId: number;
  debit: number;
  credit: number;
  memo: string;
}

export interface DiscountAccountingAllocationPayload {
  allocationType: string;
  amount: number;
}

export interface BillCreatedPayload {
  total: number;
  discount: number;
  testBill: number;
  doctorVisitBill: number;
  admissionBill: number;
  operationBill: number;
  medicineBill: number;
  appointmentDoctorPayable?: number;
  appointmentDoctorDiscount?: number;
  doctorCommissionWaiverDiscount?: number;
  discountAllocations?: DiscountAccountingAllocationPayload[];
}

export interface CreditNoteIssuedPayload {
  total: number;
  testBill: number;
  doctorVisitBill: number;
  admissionBill: number;
  operationBill: number;
  medicineBill: number;
  receivableReduction: number;
  cashRefund: number;
  paymentMethod?: string | null;
}

export interface PaymentReceivedPayload {
  amount: number;
  paymentMethod?: string | null;
}

export interface CommissionAmountPayload {
  amount: number;
  doctorCommissionWaiverDiscount?: number;
  discountAllocations?: DiscountAccountingAllocationPayload[];
}

export interface CommissionSettlementPayload extends CommissionAmountPayload {
  paymentMethod?: string | null;
  grossCommissionAmount?: number;
  advanceDeduction?: number;
  clawbackDeduction?: number;
  otherAdjustment?: number;
  roundingAdjustment?: number;
  netPaidAmount?: number;
}

export interface MoneyMovementPayload {
  amount: number;
  paymentMethod?: string | null;
}

export interface PharmacyPurchasePayload {
  totalAmount: number;
  supplierId: number;
  paymentMethod?: string | null;
  isCredit?: boolean;
}

export interface PharmacySaleCogsPayload {
  cogsAmount: number;
}

export interface SupplierPaymentPayload {
  amount: number;
  paymentMethod?: string | null;
}

export interface ShareholderDividendPayload {
  amount: number;
  paymentMethod?: string | null;
  withheldAmount?: number | null;
  netPayable?: number | null;
}

export interface DirectIncomePayload {
  amount: number;
  paymentMethod?: string | null;
}

export interface DirectExpensePayload {
  amount: number;
  paymentMethod?: string | null;
  category?: string | null;
}

export interface CashHandoverPayload {
  amount: number;
}

export interface BankDepositPayload {
  amount: number;
}

export interface InventoryPurchasePayload {
  totalAmount: number;
  supplierId?: number;
  vendorId?: number;
  paymentMethod?: string | null;
  isCredit?: boolean;
}

export interface InventoryConsumptionPayload {
  totalCost: number;
  departmentId?: number | null;
}

export interface InventoryReturnPayload {
  totalAmount: number;
  vendorId?: number;
  reason?: string;
}

export interface ManualJournalPayload {
  lines: Array<{
    accountId: number;
    debit: number;
    credit: number;
    memo: string;
  }>;
}

export interface RecordAccountingPostingEventInput {
  tenantId: string;
  sourceType: string;
  sourceId: string | number;
  eventType: AccountingEventType;
  eventDate: string;
  createdBy: string | number;
  payload: Record<string, unknown>;
}

interface AccountingPostingEventRow {
  id: number;
  tenant_id: string;
  source_event_key: string;
  source_type: string;
  source_id: string;
  event_type: AccountingEventType;
  event_date: string;
  payload_json: string;
  status: string;
  attempts: number | null;
  posted_voucher_id?: number | null;
  updated_at?: string | null;
  created_by: string | null;
}

interface FiscalYearRow {
  id: number;
  fiscal_year_name: string;
}

interface VoucherTypeRow {
  id: number;
}

interface PostingDimensions {
  patientId: number | null;
  doctorId: number | null;
  supplierId: number | null;
  departmentId: number | null;
  branchId: number | null;
}

export interface AccountingPostResult {
  posted: boolean;
  voucherId?: number;
  voucherNumber?: string;
  skippedReason?: string;
}

function requireMapping(mappings: ResolvedAccountMappings, key: AccountMappingKey): number {
  const accountId = mappings[key];
  if (!accountId) {
    throw new Error(`Missing accounting account mapping: ${key}`);
  }
  return accountId;
}

function normalizeAmount(value: number): number {
  return Math.max(0, Math.round(Number(value || 0) * 100) / 100);
}

function normalizeSignedAmount(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100) / 100;
}

function sumDoctorWaiverAllocations(allocations?: DiscountAccountingAllocationPayload[] | null): number {
  if (!Array.isArray(allocations)) return 0;
  return normalizeAmount(allocations.reduce((sum, allocation) => {
    if (allocation?.allocationType !== 'doctor_commission_waiver') return sum;
    return sum + Number(allocation.amount ?? 0);
  }, 0));
}

function resolveDoctorWaiverDiscount(payload: {
  discount?: number;
  amount?: number;
  appointmentDoctorDiscount?: number;
  doctorCommissionWaiverDiscount?: number;
  discountAllocations?: DiscountAccountingAllocationPayload[] | null;
}): number {
  const totalDiscount = normalizeAmount(Number(payload.discount ?? payload.amount ?? 0));
  const appointmentDoctorDiscount = normalizeAmount(Number(payload.appointmentDoctorDiscount ?? 0));
  const explicitWaiver = normalizeAmount(Number(payload.doctorCommissionWaiverDiscount ?? 0));
  const allocationWaiver = sumDoctorWaiverAllocations(payload.discountAllocations);
  const requestedWaiver = normalizeAmount(explicitWaiver + allocationWaiver);
  return Math.min(Math.max(0, totalDiscount - appointmentDoctorDiscount), requestedWaiver);
}

function normalizePaymentMethod(paymentMethod: string | null | undefined): string {
  return String(paymentMethod ?? 'cash').trim().toLowerCase().replace(/\s+/g, '_');
}

export function getPaymentAssetMappingKey(paymentMethod: string | null | undefined): AccountMappingKey {
  const method = normalizePaymentMethod(paymentMethod);
  switch (method) {
    case 'cash':
      return 'cash';
    case 'card':
      return 'card_clearing';
    case 'bkash':
      return 'bkash_wallet';
    case 'nagad':
      return 'nagad_wallet';
    case 'rocket':
      return 'rocket_wallet';
    case 'bank_transfer':
      return 'bank_transfer_clearing';
    case 'cheque':
      return 'cheque_clearing';
    case 'bank':
      return 'bank';
    default:
      return 'other_payment_clearing';
  }
}

function normalizeExpenseCategory(category: string | null | undefined): string {
  return String(category ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export function getExpenseCategoryMappingKey(category: string | null | undefined): AccountMappingKey {
  switch (normalizeExpenseCategory(category)) {
    case 'SALARY':
      return 'expense_salary';
    case 'MEDICINE':
      return 'expense_medicine';
    case 'RENT':
      return 'expense_rent';
    case 'ELECTRICITY':
      return 'expense_electricity';
    case 'WATER':
      return 'expense_water';
    case 'COMMUNICATION':
      return 'expense_communication';
    case 'MAINTENANCE':
      return 'expense_maintenance';
    case 'SUPPLIES':
      return 'expense_supplies';
    case 'MARKETING':
      return 'expense_marketing';
    case 'BANK':
      return 'expense_bank_charges';
    default:
      return 'general_expense';
  }
}

function getPaymentAssetMemo(paymentMethod: string | null | undefined, action: string): string {
  const method = normalizePaymentMethod(paymentMethod).replace(/_/g, ' ');
  return `${method.charAt(0).toUpperCase()}${method.slice(1)} ${action}`;
}

export function isBalancedJournal(lines: JournalLineInput[]): boolean {
  const totalDebit = lines.reduce((sum, line) => sum + normalizeAmount(line.debit), 0);
  const totalCredit = lines.reduce((sum, line) => sum + normalizeAmount(line.credit), 0);
  return totalDebit === totalCredit;
}

export function validateJournalLines(lines: JournalLineInput[]): void {
  if (lines.length < 2) {
    throw new Error('Accounting voucher must contain at least two journal lines');
  }

  for (const line of lines) {
    const debit = normalizeAmount(line.debit);
    const credit = normalizeAmount(line.credit);
    if (!line.accountId) {
      throw new Error('Accounting journal line is missing accountId');
    }
    if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
      throw new Error('Accounting journal line must contain exactly one debit or credit amount');
    }
  }

  if (!isBalancedJournal(lines)) {
    throw new Error('Accounting voucher is unbalanced');
  }
}

export function buildBillCreatedLines(
  payload: BillCreatedPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  const receivable = normalizeAmount(payload.total);
  const discount = normalizeAmount(payload.discount);
  const appointmentDoctorPayable = normalizeAmount(payload.appointmentDoctorPayable ?? 0);
  const appointmentDoctorDiscount = normalizeAmount(payload.appointmentDoctorDiscount ?? 0);
  const doctorWaiverDiscount = resolveDoctorWaiverDiscount(payload);
  const accountingDiscount = Math.max(0, discount - appointmentDoctorDiscount - doctorWaiverDiscount);

  if (receivable > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'accounts_receivable'),
      debit: receivable,
      credit: 0,
      memo: 'Patient accounts receivable',
    });
  }

  if (accountingDiscount > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'discount_allowed'),
      debit: accountingDiscount,
      credit: 0,
      memo: 'Billing discount allowed',
    });
  }

  if (doctorWaiverDiscount > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'doctor_commission_payable'),
      debit: doctorWaiverDiscount,
      credit: 0,
      memo: 'Doctor commission waiver applied to patient bill',
    });
  }

  if (appointmentDoctorPayable > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'doctor_commission_payable'),
      debit: 0,
      credit: appointmentDoctorPayable,
      memo: 'Appointment doctor payable',
    });
  }

  const revenueLines: Array<[number, AccountMappingKey, string]> = [
    [payload.testBill, 'lab_revenue', 'Laboratory revenue'],
    [Math.max(0, payload.doctorVisitBill - appointmentDoctorPayable), 'doctor_visit_revenue', 'Doctor visit revenue'],
    [payload.admissionBill, 'admission_revenue', 'Admission revenue'],
    [payload.operationBill, 'operation_revenue', 'Operation revenue'],
    [payload.medicineBill, 'pharmacy_revenue', 'Pharmacy revenue'],
  ];

  let knownRevenue = 0;
  for (const [rawAmount, mappingKey, memo] of revenueLines) {
    const amount = normalizeAmount(rawAmount);
    knownRevenue += amount;
    if (amount > 0) {
      lines.push({
        accountId: requireMapping(mappings, mappingKey),
        debit: 0,
        credit: amount,
        memo,
      });
    }
  }

  const expectedRevenue = receivable + accountingDiscount + doctorWaiverDiscount - appointmentDoctorPayable;
  const otherRevenue = expectedRevenue - knownRevenue;
  if (otherRevenue > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'other_revenue'),
      debit: 0,
      credit: otherRevenue,
      memo: 'Other revenue',
    });
  }

  validateJournalLines(lines);
  return lines;
}

export function buildBillCancelledLines(
  payload: BillCreatedPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  const receivable = normalizeAmount(payload.total);
  const discount = normalizeAmount(payload.discount);
  const appointmentDoctorPayable = normalizeAmount(payload.appointmentDoctorPayable ?? 0);
  const appointmentDoctorDiscount = normalizeAmount(payload.appointmentDoctorDiscount ?? 0);
  const doctorWaiverDiscount = resolveDoctorWaiverDiscount(payload);
  const accountingDiscount = Math.max(0, discount - appointmentDoctorDiscount - doctorWaiverDiscount);

  const revenueLines: Array<[number, AccountMappingKey, string]> = [
    [payload.testBill, 'lab_revenue', 'Reverse laboratory revenue'],
    [Math.max(0, payload.doctorVisitBill - appointmentDoctorPayable), 'doctor_visit_revenue', 'Reverse doctor visit revenue'],
    [payload.admissionBill, 'admission_revenue', 'Reverse admission revenue'],
    [payload.operationBill, 'operation_revenue', 'Reverse operation revenue'],
    [payload.medicineBill, 'pharmacy_revenue', 'Reverse pharmacy revenue'],
  ];

  let knownRevenue = 0;
  for (const [rawAmount, mappingKey, memo] of revenueLines) {
    const amount = normalizeAmount(rawAmount);
    knownRevenue += amount;
    if (amount > 0) {
      lines.push({
        accountId: requireMapping(mappings, mappingKey),
        debit: amount,
        credit: 0,
        memo,
      });
    }
  }

  const expectedRevenue = receivable + accountingDiscount + doctorWaiverDiscount - appointmentDoctorPayable;
  const otherRevenue = expectedRevenue - knownRevenue;
  if (otherRevenue > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'other_revenue'),
      debit: otherRevenue,
      credit: 0,
      memo: 'Reverse other revenue',
    });
  }

  if (receivable > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'accounts_receivable'),
      debit: 0,
      credit: receivable,
      memo: 'Reverse patient accounts receivable',
    });
  }

  if (appointmentDoctorPayable > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'doctor_commission_payable'),
      debit: appointmentDoctorPayable,
      credit: 0,
      memo: 'Reverse appointment doctor payable',
    });
  }

  if (doctorWaiverDiscount > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'doctor_commission_payable'),
      debit: 0,
      credit: doctorWaiverDiscount,
      memo: 'Reverse doctor commission waiver applied to patient bill',
    });
  }

  if (accountingDiscount > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'discount_allowed'),
      debit: 0,
      credit: accountingDiscount,
      memo: 'Reverse billing discount allowed',
    });
  }

  validateJournalLines(lines);
  return lines;
}

export function buildCreditNoteIssuedLines(
  payload: CreditNoteIssuedPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  const total = normalizeAmount(payload.total);
  const receivableReduction = normalizeAmount(payload.receivableReduction);
  const cashRefund = normalizeAmount(payload.cashRefund);

  const revenueLines: Array<[number, AccountMappingKey, string]> = [
    [payload.testBill, 'lab_revenue', 'Reverse laboratory revenue by credit note'],
    [payload.doctorVisitBill, 'doctor_visit_revenue', 'Reverse doctor visit revenue by credit note'],
    [payload.admissionBill, 'admission_revenue', 'Reverse admission revenue by credit note'],
    [payload.operationBill, 'operation_revenue', 'Reverse operation revenue by credit note'],
    [payload.medicineBill, 'pharmacy_revenue', 'Reverse pharmacy revenue by credit note'],
  ];

  let knownRevenue = 0;
  for (const [rawAmount, mappingKey, memo] of revenueLines) {
    const amount = normalizeAmount(rawAmount);
    knownRevenue += amount;
    if (amount > 0) {
      lines.push({
        accountId: requireMapping(mappings, mappingKey),
        debit: amount,
        credit: 0,
        memo,
      });
    }
  }

  const otherRevenue = total - knownRevenue;
  if (otherRevenue > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'other_revenue'),
      debit: otherRevenue,
      credit: 0,
      memo: 'Reverse other revenue by credit note',
    });
  }

  if (receivableReduction > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'accounts_receivable'),
      debit: 0,
      credit: receivableReduction,
      memo: 'Reduce patient accounts receivable by credit note',
    });
  }

  if (cashRefund > 0) {
    const methodKey = getPaymentAssetMappingKey(payload.paymentMethod);
    lines.push({
      accountId: requireMapping(mappings, methodKey),
      debit: 0,
      credit: cashRefund,
      memo: getPaymentAssetMemo(payload.paymentMethod, 'refund for credit note'),
    });
  }

  validateJournalLines(lines);
  return lines;
}

export function buildPaymentReceivedLines(
  payload: PaymentReceivedPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);

  const lines = [
    {
      accountId: requireMapping(mappings, paymentAssetKey),
      debit: amount,
      credit: 0,
      memo: getPaymentAssetMemo(payload.paymentMethod, 'receipt'),
    },
    {
      accountId: requireMapping(mappings, 'accounts_receivable'),
      debit: 0,
      credit: amount,
      memo: 'Reduce patient accounts receivable',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildCommissionAccruedLines(
  payload: CommissionAmountPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const lines = [
    {
      accountId: requireMapping(mappings, 'doctor_commission_expense'),
      debit: amount,
      credit: 0,
      memo: 'Doctor commission expense',
    },
    {
      accountId: requireMapping(mappings, 'doctor_commission_payable'),
      debit: 0,
      credit: amount,
      memo: 'Doctor commission payable',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildCommissionCancelledLines(
  payload: CommissionAmountPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const lines = [
    {
      accountId: requireMapping(mappings, 'doctor_commission_payable'),
      debit: amount,
      credit: 0,
      memo: 'Reverse doctor commission payable',
    },
    {
      accountId: requireMapping(mappings, 'doctor_commission_expense'),
      debit: 0,
      credit: amount,
      memo: 'Reverse doctor commission expense',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildCommissionSettledLines(
  payload: CommissionSettlementPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const grossCommissionAmount = normalizeAmount(payload.grossCommissionAmount ?? payload.amount);
  const advanceDeduction = normalizeAmount(payload.advanceDeduction ?? 0);
  const clawbackDeduction = normalizeAmount(payload.clawbackDeduction ?? 0);
  const otherAdjustment = normalizeSignedAmount(payload.otherAdjustment);
  const roundingAdjustment = normalizeSignedAmount(payload.roundingAdjustment);
  const calculatedNetPaidAmount = normalizeSignedAmount(
    grossCommissionAmount
      - advanceDeduction
      - clawbackDeduction
      + otherAdjustment
      + roundingAdjustment,
  );
  const netPaidAmount = normalizeAmount(payload.netPaidAmount ?? payload.amount);
  if (Math.abs(calculatedNetPaidAmount - netPaidAmount) > 0.009) {
    throw new Error(
      `Doctor commission settlement payload is unbalanced: expected net ${calculatedNetPaidAmount}, received ${netPaidAmount}`,
    );
  }

  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'doctor_commission_payable'),
      debit: grossCommissionAmount,
      credit: 0,
      memo: 'Clear doctor commission payable',
    },
  ];

  if (netPaidAmount > 0) {
    lines.push({
      accountId: requireMapping(mappings, paymentAssetKey),
      debit: 0,
      credit: netPaidAmount,
      memo: getPaymentAssetMemo(payload.paymentMethod, 'commission payout'),
    });
  }
  if (advanceDeduction > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'doctor_advance_receivable'),
      debit: 0,
      credit: advanceDeduction,
      memo: 'Recover doctor advance from commission settlement',
    });
  }
  if (clawbackDeduction > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'doctor_advance_receivable'),
      debit: 0,
      credit: clawbackDeduction,
      memo: 'Recover doctor commission clawback from settlement',
    });
  }
  if (otherAdjustment > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'doctor_settlement_adjustment'),
      debit: otherAdjustment,
      credit: 0,
      memo: 'Increase doctor payout by approved settlement adjustment',
    });
  } else if (otherAdjustment < 0) {
    lines.push({
      accountId: requireMapping(mappings, 'doctor_settlement_adjustment'),
      debit: 0,
      credit: Math.abs(otherAdjustment),
      memo: 'Reduce doctor payout by approved settlement adjustment',
    });
  }
  if (roundingAdjustment > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'rounding_adjustment'),
      debit: roundingAdjustment,
      credit: 0,
      memo: 'Doctor settlement rounding increase',
    });
  } else if (roundingAdjustment < 0) {
    lines.push({
      accountId: requireMapping(mappings, 'rounding_adjustment'),
      debit: 0,
      credit: Math.abs(roundingAdjustment),
      memo: 'Doctor settlement rounding decrease',
    });
  }

  validateJournalLines(lines);
  return lines;
}

export function buildAgentCommissionAccruedLines(
  payload: CommissionAmountPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const lines = [
    {
      accountId: requireMapping(mappings, 'agent_commission_expense'),
      debit: amount,
      credit: 0,
      memo: 'Agent/referral commission expense',
    },
    {
      accountId: requireMapping(mappings, 'agent_commission_payable'),
      debit: 0,
      credit: amount,
      memo: 'Agent/referral commission payable',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildAgentCommissionCancelledLines(
  payload: CommissionAmountPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const lines = [
    {
      accountId: requireMapping(mappings, 'agent_commission_payable'),
      debit: amount,
      credit: 0,
      memo: 'Reverse agent/referral commission payable',
    },
    {
      accountId: requireMapping(mappings, 'agent_commission_expense'),
      debit: 0,
      credit: amount,
      memo: 'Reverse agent/referral commission expense',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildAgentCommissionSettledLines(
  payload: CommissionAmountPayload & { paymentMethod?: string | null },
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);
  const lines = [
    {
      accountId: requireMapping(mappings, 'agent_commission_payable'),
      debit: amount,
      credit: 0,
      memo: 'Clear agent/referral commission payable',
    },
    {
      accountId: requireMapping(mappings, paymentAssetKey),
      debit: 0,
      credit: amount,
      memo: getPaymentAssetMemo(payload.paymentMethod, 'agent commission payout'),
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildDepositReceivedLines(
  payload: MoneyMovementPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);

  const lines = [
    {
      accountId: requireMapping(mappings, paymentAssetKey),
      debit: amount,
      credit: 0,
      memo: getPaymentAssetMemo(payload.paymentMethod, 'patient deposit'),
    },
    {
      accountId: requireMapping(mappings, 'patient_deposit_liability'),
      debit: 0,
      credit: amount,
      memo: 'Patient deposit liability',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildDepositAdjustedLines(
  payload: CommissionAmountPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const lines = [
    {
      accountId: requireMapping(mappings, 'patient_deposit_liability'),
      debit: amount,
      credit: 0,
      memo: 'Apply patient deposit liability',
    },
    {
      accountId: requireMapping(mappings, 'accounts_receivable'),
      debit: 0,
      credit: amount,
      memo: 'Reduce patient accounts receivable',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildDepositRefundedLines(
  payload: MoneyMovementPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);

  const lines = [
    {
      accountId: requireMapping(mappings, 'patient_deposit_liability'),
      debit: amount,
      credit: 0,
      memo: 'Refund patient deposit liability',
    },
    {
      accountId: requireMapping(mappings, paymentAssetKey),
      debit: 0,
      credit: amount,
      memo: getPaymentAssetMemo(payload.paymentMethod, 'deposit refund'),
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildSettlementDiscountLines(
  payload: CommissionAmountPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const doctorWaiverDiscount = resolveDoctorWaiverDiscount(payload);
  const discountAllowed = Math.max(0, amount - doctorWaiverDiscount);
  const lines: JournalLineInput[] = [];

  if (discountAllowed > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'discount_allowed'),
      debit: discountAllowed,
      credit: 0,
      memo: 'Settlement discount allowed',
    });
  }

  if (doctorWaiverDiscount > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'doctor_commission_payable'),
      debit: doctorWaiverDiscount,
      credit: 0,
      memo: 'Doctor commission waiver applied to settlement discount',
    });
  }

  if (amount > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'accounts_receivable'),
      debit: 0,
      credit: amount,
      memo: 'Reduce patient accounts receivable for settlement discount',
    });
  }

  validateJournalLines(lines);
  return lines;
}

export function buildPharmacyPurchaseLines(
  payload: PharmacyPurchasePayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.totalAmount);
  const isCredit = payload.isCredit ?? false;
  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);

  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'pharmacy_inventory'),
      debit: amount,
      credit: 0,
      memo: 'Pharmacy purchase inventory receipt',
    },
    {
      accountId: isCredit
        ? requireMapping(mappings, 'accounts_payable')
        : requireMapping(mappings, paymentAssetKey),
      debit: 0,
      credit: amount,
      memo: isCredit ? 'Supplier accounts payable' : getPaymentAssetMemo(payload.paymentMethod, 'purchase payment'),
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildInventoryPurchaseLines(
  payload: InventoryPurchasePayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.totalAmount);
  const isCredit = payload.isCredit ?? false;
  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);

  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'general_inventory'),
      debit: amount,
      credit: 0,
      memo: 'General inventory receipt',
    },
    {
      accountId: isCredit
        ? requireMapping(mappings, 'accounts_payable')
        : requireMapping(mappings, paymentAssetKey),
      debit: 0,
      credit: amount,
      memo: isCredit ? 'Supplier accounts payable' : getPaymentAssetMemo(payload.paymentMethod, 'inventory purchase'),
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildInventoryReturnLines(
  payload: InventoryReturnPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.totalAmount);
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'accounts_payable'),
      debit: amount,
      credit: 0,
      memo: `Supplier payable reduced — return${payload.reason ? `: ${payload.reason}` : ''}`,
    },
    {
      accountId: requireMapping(mappings, 'general_inventory'),
      debit: 0,
      credit: amount,
      memo: 'Inventory returned to vendor',
    },
  ];
  validateJournalLines(lines);
  return lines;
}

export function buildPharmacySaleCogsLines(
  payload: PharmacySaleCogsPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.cogsAmount);
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'pharmacy_cogs'),
      debit: amount,
      credit: 0,
      memo: 'Pharmacy cost of goods sold',
    },
    {
      accountId: requireMapping(mappings, 'pharmacy_inventory'),
      debit: 0,
      credit: amount,
      memo: 'Reduce pharmacy inventory for sale',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildSupplierPaymentLines(
  payload: SupplierPaymentPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'accounts_payable'),
      debit: amount,
      credit: 0,
      memo: 'Clear supplier accounts payable',
    },
    {
      accountId: requireMapping(mappings, paymentAssetKey),
      debit: 0,
      credit: amount,
      memo: getPaymentAssetMemo(payload.paymentMethod, 'supplier payout'),
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildProfitDistributionDeclaredLines(
  payload: ShareholderDividendPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const grossAmount = normalizeAmount(payload.amount);
  const withheldAmount = Math.min(grossAmount, normalizeAmount(payload.withheldAmount ?? 0));
  const netShareholderPayable = normalizeAmount(payload.netPayable ?? (grossAmount - withheldAmount));
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'retained_earnings'),
      debit: grossAmount,
      credit: 0,
      memo: 'Declare gross shareholder dividend from retained earnings',
    },
  ];

  if (netShareholderPayable > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'shareholder_payable'),
      debit: 0,
      credit: netShareholderPayable,
      memo: 'Shareholder dividend payable net of withholding',
    });
  }

  if (withheldAmount > 0) {
    lines.push({
      accountId: requireMapping(mappings, 'withholding_payable'),
      debit: 0,
      credit: withheldAmount,
      memo: 'Dividend withholding payable',
    });
  }

  validateJournalLines(lines);
  return lines;
}

export function buildShareholderDividendPaidLines(
  payload: ShareholderDividendPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'shareholder_payable'),
      debit: amount,
      credit: 0,
      memo: 'Clear shareholder dividend payable',
    },
    {
      accountId: requireMapping(mappings, paymentAssetKey),
      debit: 0,
      credit: amount,
      memo: getPaymentAssetMemo(payload.paymentMethod, 'shareholder dividend payout'),
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildDirectIncomeReceivedLines(
  payload: DirectIncomePayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, paymentAssetKey),
      debit: amount,
      credit: 0,
      memo: getPaymentAssetMemo(payload.paymentMethod, 'direct income'),
    },
    {
      accountId: requireMapping(mappings, 'other_revenue'),
      debit: 0,
      credit: amount,
      memo: 'Direct other income',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildDirectExpensePaidLines(
  payload: DirectExpensePayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const paymentAssetKey = getPaymentAssetMappingKey(payload.paymentMethod);
  const expenseAccountKey = getExpenseCategoryMappingKey(payload.category);
  const expenseMemo = normalizeExpenseCategory(payload.category).toLowerCase().replace(/_/g, ' ') || 'operating';
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, expenseAccountKey),
      debit: amount,
      credit: 0,
      memo: `Direct ${expenseMemo} expense`,
    },
    {
      accountId: requireMapping(mappings, paymentAssetKey),
      debit: 0,
      credit: amount,
      memo: getPaymentAssetMemo(payload.paymentMethod, 'expense payment'),
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildCashHandoverLines(
  payload: CashHandoverPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'admin_cash'),
      debit: amount,
      credit: 0,
      memo: 'Admin/main cash received from cashier',
    },
    {
      accountId: requireMapping(mappings, 'cash'),
      debit: 0,
      credit: amount,
      memo: 'Cashier cash handed over',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildBankDepositCustodyLines(
  payload: BankDepositPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'admin_cash'),
      debit: amount,
      credit: 0,
      memo: 'Cash received into finance custody',
    },
    {
      accountId: requireMapping(mappings, 'cash'),
      debit: 0,
      credit: amount,
      memo: 'Cash removed from counter drawer',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildBankDepositConfirmedLines(
  payload: BankDepositPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.amount);
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'bank'),
      debit: amount,
      credit: 0,
      memo: 'Bank deposit confirmed',
    },
    {
      accountId: requireMapping(mappings, 'admin_cash'),
      debit: 0,
      credit: amount,
      memo: 'Finance custody cleared to bank',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildInventoryConsumptionLines(
  payload: InventoryConsumptionPayload,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  const amount = normalizeAmount(payload.totalCost);
  const lines: JournalLineInput[] = [
    {
      accountId: requireMapping(mappings, 'inventory_expense'),
      debit: amount,
      credit: 0,
      memo: 'General inventory consumption expense',
    },
    {
      accountId: requireMapping(mappings, 'general_inventory'),
      debit: 0,
      credit: amount,
      memo: 'Reduce general inventory for consumption',
    },
  ];

  validateJournalLines(lines);
  return lines;
}

export function buildManualJournalLines(
  payload: ManualJournalPayload,
): JournalLineInput[] {
  const lines = payload.lines.map(line => ({
    accountId: line.accountId,
    debit: normalizeAmount(line.debit),
    credit: normalizeAmount(line.credit),
    memo: line.memo || 'Manual journal entry',
  }));

  validateJournalLines(lines);
  return lines;
}

export async function resolveAccountMappings(
  db: D1Database,
  tenantId: string,
  keys: AccountMappingKey[],
): Promise<ResolvedAccountMappings> {
  const uniqueKeys = [...new Set(keys)];
  if (uniqueKeys.length === 0) return {};

  const placeholders = uniqueKeys.map(() => '?').join(', ');
  const rows = await db.prepare(`
    SELECT mapping_key, account_id
    FROM accounting_account_mappings
    WHERE tenant_id = ?
      AND mapping_key IN (${placeholders})
      AND is_active = 1
  `).bind(tenantId, ...uniqueKeys).all<{ mapping_key: AccountMappingKey; account_id: number }>();

  const mappings: ResolvedAccountMappings = {};
  for (const row of rows.results ?? []) {
    mappings[row.mapping_key] = row.account_id;
  }

  const missing = uniqueKeys.filter((key) => !mappings[key]);
  if (missing.length > 0) {
    throw new Error(`Missing accounting account mapping: ${missing.join(', ')}`);
  }

  return mappings;
}

export function createPostingEventKey(sourceType: string, sourceId: string | number, eventType: AccountingEventType): string {
  return `${sourceType}:${sourceId}:${eventType}`;
}

export async function recordAccountingPostingEvent(
  db: D1Database,
  input: RecordAccountingPostingEventInput,
): Promise<string> {
  const sourceEventKey = createPostingEventKey(input.sourceType, input.sourceId, input.eventType);

  await db.prepare(`
    INSERT OR IGNORE INTO accounting_posting_events
      (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.tenantId,
    sourceEventKey,
    input.sourceType,
    input.sourceId,
    input.eventType,
    input.eventDate,
    JSON.stringify(input.payload),
    String(input.createdBy),
  ).run();

  return sourceEventKey;
}

export async function recordAndPostAccountingEvent(
  db: D1Database,
  input: RecordAccountingPostingEventInput,
): Promise<AccountingPostResult> {
  const sourceEventKey = await recordAccountingPostingEvent(db, input);
  return postAccountingEventBySourceKey(db, input.tenantId, sourceEventKey);
}

function parsePostingPayload(event: AccountingPostingEventRow): Record<string, unknown> {
  try {
    return JSON.parse(event.payload_json || '{}') as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid accounting posting payload for ${event.source_event_key}`);
  }
}

function getVoucherTypeCode(eventType: AccountingEventType, payload: Record<string, unknown>): string {
  if (eventType === ACCOUNTING_EVENT_TYPES.creditNoteIssued) {
    return Number(payload.cashRefund ?? 0) > 0 ? 'PMTV' : 'JV';
  }
  if (
    eventType === ACCOUNTING_EVENT_TYPES.paymentReceived
    || eventType === ACCOUNTING_EVENT_TYPES.patientDepositReceived
  ) return 'RCPT';
  if (
    eventType === ACCOUNTING_EVENT_TYPES.commissionSettled
    || eventType === ACCOUNTING_EVENT_TYPES.agentCommissionSettled
    || eventType === ACCOUNTING_EVENT_TYPES.patientDepositRefunded
    || eventType === ACCOUNTING_EVENT_TYPES.supplierPayment
    || eventType === ACCOUNTING_EVENT_TYPES.shareholderDividendPaid
    || eventType === ACCOUNTING_EVENT_TYPES.directExpensePaid
  ) return 'PMTV';
  if (eventType === ACCOUNTING_EVENT_TYPES.directIncomeReceived) return 'RCPT';
  if (
    eventType === ACCOUNTING_EVENT_TYPES.pharmacyPurchase
    || eventType === ACCOUNTING_EVENT_TYPES.inventoryPurchase
  ) {
    return (payload.isCredit ?? false) ? 'JV' : 'PMTV';
  }
  return 'JV';
}

function toBillPayload(payload: Record<string, unknown>): BillCreatedPayload {
  return {
    total: Number(payload.total ?? 0),
    discount: Number(payload.discount ?? 0),
    testBill: Number(payload.testBill ?? 0),
    doctorVisitBill: Number(payload.doctorVisitBill ?? 0),
    admissionBill: Number(payload.admissionBill ?? 0),
    operationBill: Number(payload.operationBill ?? 0),
    medicineBill: Number(payload.medicineBill ?? 0),
    appointmentDoctorPayable: Number(payload.appointmentDoctorPayable ?? 0),
    appointmentDoctorDiscount: Number(payload.appointmentDoctorDiscount ?? 0),
    doctorCommissionWaiverDiscount: Number(payload.doctorCommissionWaiverDiscount ?? 0),
    discountAllocations: Array.isArray(payload.discountAllocations)
      ? payload.discountAllocations as DiscountAccountingAllocationPayload[]
      : undefined,
  };
}

function toCommissionAmountPayload(payload: Record<string, unknown>): CommissionAmountPayload {
  return {
    amount: Number(payload.amount ?? 0),
    doctorCommissionWaiverDiscount: Number(payload.doctorCommissionWaiverDiscount ?? 0),
    discountAllocations: Array.isArray(payload.discountAllocations)
      ? payload.discountAllocations as DiscountAccountingAllocationPayload[]
      : undefined,
  };
}

function toCreditNotePayload(payload: Record<string, unknown>): CreditNoteIssuedPayload {
  return {
    total: Number(payload.total ?? 0),
    testBill: Number(payload.testBill ?? 0),
    doctorVisitBill: Number(payload.doctorVisitBill ?? 0),
    admissionBill: Number(payload.admissionBill ?? 0),
    operationBill: Number(payload.operationBill ?? 0),
    medicineBill: Number(payload.medicineBill ?? 0),
    receivableReduction: Number(payload.receivableReduction ?? 0),
    cashRefund: Number(payload.cashRefund ?? 0),
    paymentMethod: String(payload.paymentMethod ?? 'cash'),
  };
}

function optionalPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getPostingDimensions(payload: Record<string, unknown>): PostingDimensions {
  return {
    patientId: optionalPositiveNumber(payload.patientId),
    doctorId: optionalPositiveNumber(payload.doctorId),
    supplierId: optionalPositiveNumber(payload.supplierId ?? payload.vendorId),
    departmentId: optionalPositiveNumber(payload.departmentId),
    branchId: optionalPositiveNumber(payload.branchId),
  };
}

function getRequiredMappingKeys(
  eventType: AccountingEventType,
  payload: Record<string, unknown>,
): AccountMappingKey[] {
  if (
    eventType === ACCOUNTING_EVENT_TYPES.billCreated
    || eventType === ACCOUNTING_EVENT_TYPES.billCancelled
  ) {
    const billPayload = toBillPayload(payload);
    const keys: AccountMappingKey[] = [];
    const appointmentDoctorPayable = normalizeAmount(billPayload.appointmentDoctorPayable ?? 0);
    const appointmentDoctorDiscount = normalizeAmount(billPayload.appointmentDoctorDiscount ?? 0);
    const doctorWaiverDiscount = resolveDoctorWaiverDiscount(billPayload);
    const accountingDiscount = Math.max(0, billPayload.discount - appointmentDoctorDiscount - doctorWaiverDiscount);
    const doctorVisitRevenue = Math.max(0, billPayload.doctorVisitBill - appointmentDoctorPayable);
    if (billPayload.total > 0) keys.push('accounts_receivable');
    if (accountingDiscount > 0) keys.push('discount_allowed');
    if (appointmentDoctorPayable > 0 || doctorWaiverDiscount > 0) keys.push('doctor_commission_payable');
    if (billPayload.testBill > 0) keys.push('lab_revenue');
    if (doctorVisitRevenue > 0) keys.push('doctor_visit_revenue');
    if (billPayload.admissionBill > 0) keys.push('admission_revenue');
    if (billPayload.operationBill > 0) keys.push('operation_revenue');
    if (billPayload.medicineBill > 0) keys.push('pharmacy_revenue');

    const knownRevenue = billPayload.testBill + doctorVisitRevenue + billPayload.admissionBill
      + billPayload.operationBill + billPayload.medicineBill;
    if ((billPayload.total + accountingDiscount + doctorWaiverDiscount - appointmentDoctorPayable - knownRevenue) > 0) keys.push('other_revenue');
    return keys;
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.creditNoteIssued) {
    const creditPayload = toCreditNotePayload(payload);
    const keys: AccountMappingKey[] = [];
    if (creditPayload.testBill > 0) keys.push('lab_revenue');
    if (creditPayload.doctorVisitBill > 0) keys.push('doctor_visit_revenue');
    if (creditPayload.admissionBill > 0) keys.push('admission_revenue');
    if (creditPayload.operationBill > 0) keys.push('operation_revenue');
    if (creditPayload.medicineBill > 0) keys.push('pharmacy_revenue');
    const knownRevenue = creditPayload.testBill + creditPayload.doctorVisitBill + creditPayload.admissionBill
      + creditPayload.operationBill + creditPayload.medicineBill;
    if (creditPayload.total - knownRevenue > 0) keys.push('other_revenue');
    if (creditPayload.receivableReduction > 0) keys.push('accounts_receivable');
    if (creditPayload.cashRefund > 0) {
      keys.push(getPaymentAssetMappingKey(creditPayload.paymentMethod));
    }
    return keys;
  }

  if (
    eventType === ACCOUNTING_EVENT_TYPES.paymentReceived
    || eventType === ACCOUNTING_EVENT_TYPES.patientDepositReceived
  ) {
    const targetKey = eventType === ACCOUNTING_EVENT_TYPES.paymentReceived
      ? 'accounts_receivable'
      : 'patient_deposit_liability';
    return [getPaymentAssetMappingKey(String(payload.paymentMethod ?? 'cash')), targetKey];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.patientDepositAdjusted) {
    return ['patient_deposit_liability', 'accounts_receivable'];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.patientDepositRefunded) {
    return ['patient_deposit_liability', getPaymentAssetMappingKey(String(payload.paymentMethod ?? 'cash'))];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.settlementDiscount) {
    const settlementDiscount = toCommissionAmountPayload(payload);
    const doctorWaiverDiscount = resolveDoctorWaiverDiscount(settlementDiscount);
    const keys: AccountMappingKey[] = ['accounts_receivable'];
    if (settlementDiscount.amount - doctorWaiverDiscount > 0) keys.push('discount_allowed');
    if (doctorWaiverDiscount > 0) keys.push('doctor_commission_payable');
    return keys;
  }

  if (
    eventType === ACCOUNTING_EVENT_TYPES.commissionAccrued
    || eventType === ACCOUNTING_EVENT_TYPES.commissionCancelled
  ) {
    return ['doctor_commission_expense', 'doctor_commission_payable'];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.commissionSettled) {
    const keys: AccountMappingKey[] = [
      'doctor_commission_payable',
      getPaymentAssetMappingKey(String(payload.paymentMethod ?? 'cash')),
    ];
    if (normalizeAmount(Number(payload.advanceDeduction ?? 0)) > 0
      || normalizeAmount(Number(payload.clawbackDeduction ?? 0)) > 0) {
      keys.push('doctor_advance_receivable');
    }
    if (normalizeSignedAmount(payload.otherAdjustment) !== 0) keys.push('doctor_settlement_adjustment');
    if (normalizeSignedAmount(payload.roundingAdjustment) !== 0) keys.push('rounding_adjustment');
    return keys;
  }

  if (
    eventType === ACCOUNTING_EVENT_TYPES.agentCommissionAccrued
    || eventType === ACCOUNTING_EVENT_TYPES.agentCommissionCancelled
  ) {
    return ['agent_commission_expense', 'agent_commission_payable'];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.agentCommissionSettled) {
    return ['agent_commission_payable', getPaymentAssetMappingKey(String(payload.paymentMethod ?? 'cash'))];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.supplierPayment) {
    return ['accounts_payable', getPaymentAssetMappingKey(String(payload.paymentMethod ?? 'cash'))];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.profitDistributionDeclared) {
    const withheldAmount = Number(payload.withheldAmount ?? 0);
    const keys: AccountMappingKey[] = ['retained_earnings', 'shareholder_payable'];
    if (withheldAmount > 0) keys.push('withholding_payable');
    return keys;
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.shareholderDividendPaid) {
    return ['shareholder_payable', getPaymentAssetMappingKey(String(payload.paymentMethod ?? 'cash'))];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.directIncomeReceived) {
    return [getPaymentAssetMappingKey(String(payload.paymentMethod ?? 'cash')), 'other_revenue'];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.directExpensePaid) {
    return [getExpenseCategoryMappingKey(String(payload.category ?? 'MISC')), getPaymentAssetMappingKey(String(payload.paymentMethod ?? 'cash'))];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.cashHandover) {
    return ['admin_cash', 'cash'];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.bankDepositCustody) {
    return ['admin_cash', 'cash'];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.bankDepositConfirmed) {
    return ['bank', 'admin_cash'];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.pharmacyPurchase) {
    const isCredit = payload.isCredit ?? false;
    return [
      'pharmacy_inventory',
      isCredit ? 'accounts_payable' : getPaymentAssetMappingKey(String(payload.paymentMethod ?? 'cash')),
    ];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.inventoryPurchase) {
    const isCredit = payload.isCredit ?? false;
    return [
      'general_inventory',
      isCredit ? 'accounts_payable' : getPaymentAssetMappingKey(String(payload.paymentMethod ?? 'cash')),
    ];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.inventoryReturn) {
    return ['accounts_payable', 'general_inventory'];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.pharmacySaleCogs) {
    return ['pharmacy_cogs', 'pharmacy_inventory'];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.inventoryConsumption) {
    return ['inventory_expense', 'general_inventory'];
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.manualJournal) {
    return []; // No fixed mappings required for manual journal
  }

  throw new Error(`Unsupported accounting event type: ${eventType}`);
}

function buildJournalLinesForEvent(
  eventType: AccountingEventType,
  payload: Record<string, unknown>,
  mappings: ResolvedAccountMappings,
): JournalLineInput[] {
  if (eventType === ACCOUNTING_EVENT_TYPES.billCreated) {
    return buildBillCreatedLines(toBillPayload(payload), mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.billCancelled) {
    return buildBillCancelledLines(toBillPayload(payload), mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.creditNoteIssued) {
    return buildCreditNoteIssuedLines(toCreditNotePayload(payload), mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.paymentReceived) {
    return buildPaymentReceivedLines({
      amount: Number(payload.amount ?? 0),
      paymentMethod: String(payload.paymentMethod ?? 'cash'),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.commissionAccrued) {
    return buildCommissionAccruedLines({ amount: Number(payload.amount ?? 0) }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.commissionCancelled) {
    return buildCommissionCancelledLines({ amount: Number(payload.amount ?? 0) }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.commissionSettled) {
    return buildCommissionSettledLines({
      amount: Number(payload.amount ?? 0),
      grossCommissionAmount: Number(payload.grossCommissionAmount ?? payload.amount ?? 0),
      advanceDeduction: Number(payload.advanceDeduction ?? 0),
      clawbackDeduction: Number(payload.clawbackDeduction ?? 0),
      otherAdjustment: Number(payload.otherAdjustment ?? 0),
      roundingAdjustment: Number(payload.roundingAdjustment ?? 0),
      netPaidAmount: Number(payload.netPaidAmount ?? payload.amount ?? 0),
      paymentMethod: String(payload.paymentMethod ?? 'cash'),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.agentCommissionAccrued) {
    return buildAgentCommissionAccruedLines({ amount: Number(payload.amount ?? 0) }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.agentCommissionCancelled) {
    return buildAgentCommissionCancelledLines({ amount: Number(payload.amount ?? 0) }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.agentCommissionSettled) {
    return buildAgentCommissionSettledLines({
      amount: Number(payload.amount ?? 0),
      paymentMethod: String(payload.paymentMethod ?? 'cash'),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.patientDepositReceived) {
    return buildDepositReceivedLines({
      amount: Number(payload.amount ?? 0),
      paymentMethod: String(payload.paymentMethod ?? 'cash'),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.patientDepositAdjusted) {
    return buildDepositAdjustedLines({ amount: Number(payload.amount ?? 0) }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.patientDepositRefunded) {
    return buildDepositRefundedLines({
      amount: Number(payload.amount ?? 0),
      paymentMethod: String(payload.paymentMethod ?? 'cash'),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.settlementDiscount) {
    return buildSettlementDiscountLines({ amount: Number(payload.amount ?? 0) }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.supplierPayment) {
    return buildSupplierPaymentLines({
      amount: Number(payload.amount ?? 0),
      paymentMethod: String(payload.paymentMethod ?? 'cash'),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.profitDistributionDeclared) {
    return buildProfitDistributionDeclaredLines({
      amount: Number(payload.amount ?? 0),
      withheldAmount: Number(payload.withheldAmount ?? 0),
      netPayable: Number(payload.netPayable ?? 0),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.shareholderDividendPaid) {
    return buildShareholderDividendPaidLines({
      amount: Number(payload.amount ?? 0),
      paymentMethod: String(payload.paymentMethod ?? 'cash'),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.directIncomeReceived) {
    return buildDirectIncomeReceivedLines({
      amount: Number(payload.amount ?? 0),
      paymentMethod: String(payload.paymentMethod ?? 'cash'),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.directExpensePaid) {
    return buildDirectExpensePaidLines({
      amount: Number(payload.amount ?? 0),
      paymentMethod: String(payload.paymentMethod ?? 'cash'),
      category: String(payload.category ?? 'MISC'),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.cashHandover) {
    return buildCashHandoverLines({
      amount: Number(payload.amount ?? 0),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.bankDepositCustody) {
    return buildBankDepositCustodyLines({
      amount: Number(payload.amount ?? 0),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.bankDepositConfirmed) {
    return buildBankDepositConfirmedLines({
      amount: Number(payload.amount ?? 0),
    }, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.pharmacyPurchase) {
    return buildPharmacyPurchaseLines(payload as unknown as PharmacyPurchasePayload, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.inventoryPurchase) {
    return buildInventoryPurchaseLines(payload as unknown as InventoryPurchasePayload, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.inventoryReturn) {
    return buildInventoryReturnLines(payload as unknown as InventoryReturnPayload, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.pharmacySaleCogs) {
    return buildPharmacySaleCogsLines(payload as unknown as PharmacySaleCogsPayload, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.inventoryConsumption) {
    return buildInventoryConsumptionLines(payload as unknown as InventoryConsumptionPayload, mappings);
  }

  if (eventType === ACCOUNTING_EVENT_TYPES.manualJournal) {
    return buildManualJournalLines(payload as unknown as ManualJournalPayload);
  }

  throw new Error(`Unsupported accounting event type: ${eventType}`);
}

function describeAccountingEvent(event: AccountingPostingEventRow, payload: Record<string, unknown>): string {
  if (event.event_type === ACCOUNTING_EVENT_TYPES.billCreated) {
    return `Bill created ${String(payload.invoiceNo ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.billCancelled) {
    return `Bill cancelled ${String(payload.invoiceNo ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.creditNoteIssued) {
    return `Credit note issued ${String(payload.creditNoteNo ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.paymentReceived) {
    return `Payment received ${String(payload.receiptNo ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.patientDepositReceived) {
    return `Patient deposit received ${String(payload.receiptNo ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.patientDepositAdjusted) {
    return `Patient deposit adjusted ${String(payload.receiptNo ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.patientDepositRefunded) {
    return `Patient deposit refunded ${String(payload.receiptNo ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.settlementDiscount) {
    return `Settlement discount ${String(payload.receiptNo ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.commissionAccrued) {
    return `Doctor commission accrued ${String(payload.accrualId ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.commissionCancelled) {
    return `Doctor commission cancelled ${String(payload.accrualId ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.commissionSettled) {
    return `Doctor commission settled ${String(payload.settlementId ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.agentCommissionAccrued) {
    return `Agent/referral commission accrued ${String(payload.commissionId ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.agentCommissionCancelled) {
    return `Agent/referral commission cancelled ${String(payload.commissionId ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.agentCommissionSettled) {
    return `Agent/referral commission settled ${String(payload.commissionId ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.supplierPayment) {
    return `Supplier payment ${String(payload.paymentId ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.profitDistributionDeclared) {
    return `Profit distribution declared ${String(payload.distributionId ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.shareholderDividendPaid) {
    return `Shareholder dividend paid ${String(payload.distributionId ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.directIncomeReceived) {
    return `Direct income received ${event.source_id}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.directExpensePaid) {
    return `Direct expense paid ${event.source_id}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.cashHandover) {
    return `Cash handover ${event.source_id}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.bankDepositCustody) {
    return `Bank deposit custody ${event.source_id}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.bankDepositConfirmed) {
    return `Bank deposit confirmed ${event.source_id}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.pharmacyPurchase) {
    return `Pharmacy purchase receipt ${String(payload.invoiceNo ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.inventoryPurchase) {
    return `Inventory purchase receipt ${String(payload.invoiceNo ?? event.source_id)}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.inventoryReturn) {
    return `Inventory return to vendor ${event.source_id}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.pharmacySaleCogs) {
    return `Pharmacy COGS for sale ${event.source_id}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.inventoryConsumption) {
    return `Inventory consumption ${event.source_id}`;
  }
  if (event.event_type === ACCOUNTING_EVENT_TYPES.manualJournal) {
    return `Manual journal entry ${event.source_id}`;
  }
  return `${event.source_type} ${event.source_id}`;
}

async function getActiveFiscalYearForDate(
  db: D1Database,
  tenantId: string,
  eventDate: string,
): Promise<FiscalYearRow> {
  const fiscalYear = await db.prepare(`
    SELECT id, fiscal_year_name
    FROM fiscal_years
    WHERE tenant_id = ?
      AND is_active = 1
      AND is_closed = 0
      AND start_date <= ?
      AND end_date >= ?
    ORDER BY start_date DESC
    LIMIT 1
  `).bind(tenantId, eventDate, eventDate).first<FiscalYearRow>();

  if (!fiscalYear) {
    throw new Error(`No active open fiscal year for ${eventDate}`);
  }

  return fiscalYear;
}

async function getOrCreateVoucherType(
  db: D1Database,
  tenantId: string,
  code: string,
): Promise<VoucherTypeRow> {
  const existing = await db.prepare(`
    SELECT id
    FROM voucher_types
    WHERE tenant_id = ?
      AND code = ?
      AND is_active = 1
    LIMIT 1
  `).bind(tenantId, code).first<VoucherTypeRow>();

  if (existing) return existing;

  const names: Record<string, string> = {
    JV: 'Journal Voucher',
    RCPT: 'Receipt Voucher',
    PMTV: 'Payment Voucher',
  };
  const result = await db.prepare(`
    INSERT INTO voucher_types (tenant_id, code, name, allow_verification)
    VALUES (?, ?, ?, 1)
  `).bind(tenantId, code, names[code] ?? `${code} Voucher`).run();

  return { id: Number(result.meta.last_row_id) };
}

async function generateAccountingVoucherNumber(
  db: D1Database,
  tenantId: string,
  voucherTypeId: number,
  voucherTypeCode: string,
  fiscalYear: FiscalYearRow,
): Promise<string> {
  let numbering = await db.prepare(`
    SELECT last_number
    FROM voucher_numbering
    WHERE tenant_id = ?
      AND voucher_type_id = ?
      AND fiscal_year_id = ?
  `).bind(tenantId, voucherTypeId, fiscalYear.id).first<{ last_number: number }>();

  if (!numbering) {
    await db.prepare(`
      INSERT INTO voucher_numbering (tenant_id, voucher_type_id, fiscal_year_id, last_number)
      VALUES (?, ?, ?, 0)
    `).bind(tenantId, voucherTypeId, fiscalYear.id).run();
    numbering = { last_number: 0 };
  }

  const nextNumber = Number(numbering.last_number || 0) + 1;
  await db.prepare(`
    UPDATE voucher_numbering
    SET last_number = ?
    WHERE tenant_id = ?
      AND voucher_type_id = ?
      AND fiscal_year_id = ?
  `).bind(nextNumber, tenantId, voucherTypeId, fiscalYear.id).run();

  return `${voucherTypeCode}-${fiscalYear.fiscal_year_name}-${String(nextNumber).padStart(3, '0')}`;
}

const DEAD_LETTER_MAX_ATTEMPTS = 5;
const BALANCE_TOLERANCE = 0.01;

async function markEventProcessing(
  db: D1Database,
  eventId: number,
): Promise<boolean> {
  const result = await db.prepare(`
    UPDATE accounting_posting_events
    SET status = 'processing',
        last_error = NULL,
        updated_at = datetime('now', '+6 hours')
    WHERE id = ?
      AND status IN ('pending', 'failed')
      AND COALESCE(attempts, 0) < 5
  `).bind(eventId).run();

  return Number(result.meta.changes ?? 0) === 1;
}

async function markEventPosted(
  db: D1Database,
  eventId: number,
  voucherId: number,
): Promise<void> {
  await db.prepare(`
    UPDATE accounting_posting_events
    SET status = 'posted',
        posted_voucher_id = ?,
        posted_at = datetime('now', '+6 hours'),
        updated_at = datetime('now', '+6 hours')
    WHERE id = ?
  `).bind(voucherId, eventId).run();
}

async function markPostingEventFailed(
  db: D1Database,
  eventId: number,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.prepare(`
    UPDATE accounting_posting_events
    SET status = 'failed',
        attempts = COALESCE(attempts, 0) + 1,
        last_error = ?,
        updated_at = datetime('now', '+6 hours')
    WHERE id = ?
  `).bind(message.slice(0, 1000), eventId).run();
}

async function markPostingEventDeadLetter(
  db: D1Database,
  eventId: number,
): Promise<void> {
  await db.prepare(`
    UPDATE accounting_posting_events
    SET status = 'dead_letter',
        updated_at = datetime('now', '+6 hours')
    WHERE id = ?
      AND status != 'dead_letter'
  `).bind(eventId).run();
}

async function getVoucherTotals(
  db: D1Database,
  tenantId: string,
  voucherId: number,
): Promise<{ lineCount: number; totalDebit: number; totalCredit: number }> {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS line_count,
      COALESCE(SUM(debit_amount), 0) AS total_debit,
      COALESCE(SUM(credit_amount), 0) AS total_credit
    FROM accounting_journal_lines
    WHERE tenant_id = ? AND voucher_id = ?
  `).bind(tenantId, voucherId).first<{ line_count: number; total_debit: number; total_credit: number }>();

  return {
    lineCount: Number(row?.line_count ?? 0),
    totalDebit: Number(row?.total_debit ?? 0),
    totalCredit: Number(row?.total_credit ?? 0),
  };
}

async function isExistingVoucherBalanced(
  db: D1Database,
  tenantId: string,
  voucherId: number,
): Promise<boolean> {
  const { lineCount, totalDebit, totalCredit } = await getVoucherTotals(db, tenantId, voucherId);
  if (lineCount < 2) return false;
  return Math.abs(totalDebit - totalCredit) < BALANCE_TOLERANCE;
}

async function buildSubLedgerInsertStatements(
  db: D1Database,
  tenantId: string,
  voucherId: number,
  lines: JournalLineInput[],
  dimensions: PostingDimensions,
  mappings: ResolvedAccountMappings,
): Promise<Array<{ sql: string; params: unknown[] }>> {
  const subLedgerInfo: Array<{ id: number; dr: number; cr: number }> = [];

  if (dimensions.supplierId) {
    const sl = await db.prepare(`
      SELECT id FROM sub_ledgers
      WHERE tenant_id = ? AND code = ? AND type = 'vendor' AND is_active = 1
      LIMIT 1
    `).bind(tenantId, String(dimensions.supplierId)).first<{ id: number }>();
    if (sl && mappings.accounts_payable) {
      const dr = lines.filter(l => l.accountId === mappings.accounts_payable).reduce((s, l) => s + l.debit, 0);
      const cr = lines.filter(l => l.accountId === mappings.accounts_payable).reduce((s, l) => s + l.credit, 0);
      if (dr > 0 || cr > 0) subLedgerInfo.push({ id: sl.id, dr, cr });
    }
  }

  if (dimensions.doctorId) {
    const sl = await db.prepare(`
      SELECT id FROM sub_ledgers
      WHERE tenant_id = ? AND code = ? AND type = 'consultant' AND is_active = 1
      LIMIT 1
    `).bind(tenantId, String(dimensions.doctorId)).first<{ id: number }>();
    if (sl) {
      const dr = lines.filter(l => l.accountId === mappings.doctor_commission_payable).reduce((s, l) => s + l.debit, 0);
      const cr = lines.filter(l => l.accountId === mappings.doctor_commission_payable).reduce((s, l) => s + l.credit, 0);
      if (dr > 0 || cr > 0) subLedgerInfo.push({ id: sl.id, dr, cr });
    }
  }

  if (dimensions.patientId) {
    const sl = await db.prepare(`
      SELECT id FROM sub_ledgers
      WHERE tenant_id = ? AND code = ? AND type = 'customer' AND is_active = 1
      LIMIT 1
    `).bind(tenantId, String(dimensions.patientId)).first<{ id: number }>();
    if (sl) {
      const dr = lines.filter(l => l.accountId === mappings.accounts_receivable || l.accountId === mappings.patient_deposit_liability).reduce((s, l) => s + l.debit, 0);
      const cr = lines.filter(l => l.accountId === mappings.accounts_receivable || l.accountId === mappings.patient_deposit_liability).reduce((s, l) => s + l.credit, 0);
      if (dr > 0 || cr > 0) subLedgerInfo.push({ id: sl.id, dr, cr });
    }
  }

  return subLedgerInfo.map((info) => ({
    sql: `
      INSERT INTO sub_ledger_transactions (tenant_id, sub_ledger_id, dr_amount, cr_amount, voucher_id, journal_entry_id)
      VALUES (?, ?, ?, ?, ?, -1)
    `,
    params: [tenantId, info.id, info.dr, info.cr, voucherId],
  }));
}

async function ensureSubLedgerTransactionsForVoucher(
  db: D1Database,
  tenantId: string,
  voucherId: number,
  lines: JournalLineInput[],
  dimensions: PostingDimensions,
  mappings: ResolvedAccountMappings,
): Promise<void> {
  const expectedStatements = await buildSubLedgerInsertStatements(
    db,
    tenantId,
    voucherId,
    lines,
    dimensions,
    mappings,
  );

  if (expectedStatements.length === 0) return;

  const missingStatements: Array<{ sql: string; params: unknown[] }> = [];
  for (const statement of expectedStatements) {
    const subLedgerId = Number(statement.params[1] ?? 0);
    if (!subLedgerId) continue;

    const existing = await db.prepare(`
      SELECT id
      FROM sub_ledger_transactions
      WHERE tenant_id = ?
        AND voucher_id = ?
        AND sub_ledger_id = ?
      LIMIT 1
    `).bind(tenantId, voucherId, subLedgerId).first<{ id: number }>();

    if (!existing) {
      missingStatements.push(statement);
    }
  }

  if (missingStatements.length > 0) {
    await db.batch(missingStatements.map(s => db.prepare(s.sql).bind(...s.params)));
  }
}

async function getPostedAccountingEventResult(
  db: D1Database,
  tenantId: string,
  event: AccountingPostingEventRow,
): Promise<AccountingPostResult> {
  const postedVoucherId = Number(event.posted_voucher_id ?? 0);
  if (!postedVoucherId) {
    return { posted: false, skippedReason: 'partial_voucher' };
  }

  const postedVoucher = await db.prepare(`
    SELECT voucher_number
    FROM accounting_vouchers
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `).bind(tenantId, postedVoucherId).first<{ voucher_number: string }>();

  return {
    posted: true,
    voucherId: postedVoucherId,
    voucherNumber: postedVoucher?.voucher_number,
  };
}

async function getAccountingPostingEvent(
  db: D1Database,
  tenantId: string,
  sourceEventKey: string,
): Promise<AccountingPostingEventRow | null> {
  return db.prepare(`
    SELECT *
    FROM accounting_posting_events
    WHERE tenant_id = ?
      AND source_event_key = ?
    LIMIT 1
  `).bind(tenantId, sourceEventKey).first<AccountingPostingEventRow>();
}

async function recoverStaleProcessingEvent(
  db: D1Database,
  tenantId: string,
  sourceEventKey: string,
): Promise<void> {
  await db.prepare(`
    UPDATE accounting_posting_events
    SET status = 'failed',
        last_error = 'Recovered stale processing event',
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND source_event_key = ?
      AND status = 'processing'
      AND updated_at < datetime('now', '+6 hours', '-15 minutes')
  `).bind(tenantId, sourceEventKey).run();
}

export async function postAccountingEventBySourceKey(
  db: D1Database,
  tenantId: string,
  sourceEventKey: string,
): Promise<AccountingPostResult> {
  const event = await getAccountingPostingEvent(db, tenantId, sourceEventKey);

  if (!event) {
    return { posted: false, skippedReason: 'posting_event_not_found' };
  }

  const currentAttempts = Number(event.attempts ?? 0);
  if (event.status === 'posted') {
    return getPostedAccountingEventResult(db, tenantId, event);
  }

  if (event.status === 'dead_letter') {
    return { posted: false, skippedReason: 'dead_letter' };
  }

  if (currentAttempts >= DEAD_LETTER_MAX_ATTEMPTS) {
    await markPostingEventDeadLetter(db, event.id);
    return { posted: false, skippedReason: 'dead_letter' };
  }

  if (event.status === 'processing') {
    return { posted: false, skippedReason: 'already_processing' };
  }

  // Idempotency: if a voucher already exists for this event, only mark posted when it is balanced.
  const existingVoucher = await db.prepare(`
    SELECT id, voucher_number
    FROM accounting_vouchers
    WHERE tenant_id = ?
      AND source_event_key = ?
    LIMIT 1
  `).bind(tenantId, sourceEventKey).first<{ id: number; voucher_number: string }>();

  if (existingVoucher) {
    const balanced = await isExistingVoucherBalanced(db, tenantId, existingVoucher.id);
    if (balanced) {
      try {
        const payload = parsePostingPayload(event);
        const mappings = await resolveAccountMappings(db, tenantId, getRequiredMappingKeys(event.event_type, payload));
        const lines = buildJournalLinesForEvent(event.event_type, payload, mappings);
        const dimensions = getPostingDimensions(payload);
        await ensureSubLedgerTransactionsForVoucher(
          db,
          tenantId,
          existingVoucher.id,
          lines,
          dimensions,
          mappings,
        );
        await markEventPosted(db, event.id, existingVoucher.id);
        return { posted: true, voucherId: existingVoucher.id, voucherNumber: existingVoucher.voucher_number };
      } catch (error) {
        await markPostingEventFailed(db, event.id, error);
        throw error;
      }
    }
    await markPostingEventFailed(
      db,
      event.id,
      new Error(`Existing voucher ${existingVoucher.id} is partial or unbalanced — manual review required`),
    );
    return { posted: false, skippedReason: 'partial_voucher' };
  }

  // Period locking: closed periods cannot post. Use COALESCE-safe attempts increment.
  if (await isPeriodClosed(db, tenantId, event.event_date)) {
    await markPostingEventFailed(
      db,
      event.id,
      new Error('Period is closed for this date'),
    );
    return { posted: false, skippedReason: 'period_closed' };
  }

  // State-machine + batched critical writes.
  try {
    const claimed = await markEventProcessing(db, event.id);
    if (!claimed) {
      const latestEvent = await getAccountingPostingEvent(db, tenantId, sourceEventKey);
      const latestAttempts = Number(latestEvent?.attempts ?? 0);

      if (latestEvent?.status === 'posted') {
        return getPostedAccountingEventResult(db, tenantId, latestEvent);
      }

      if (latestEvent?.status === 'dead_letter' || latestAttempts >= DEAD_LETTER_MAX_ATTEMPTS) {
        if (latestEvent) {
          await markPostingEventDeadLetter(db, latestEvent.id);
        }
        return { posted: false, skippedReason: 'dead_letter' };
      }

      return { posted: false, skippedReason: 'already_processing' };
    }

    const payload = parsePostingPayload(event);
    const fiscalYear = await getActiveFiscalYearForDate(db, tenantId, event.event_date);
    const voucherTypeCode = getVoucherTypeCode(event.event_type, payload);
    const voucherType = await getOrCreateVoucherType(db, tenantId, voucherTypeCode);
    const mappings = await resolveAccountMappings(db, tenantId, getRequiredMappingKeys(event.event_type, payload));
    const lines = buildJournalLinesForEvent(event.event_type, payload, mappings);
    const dimensions = getPostingDimensions(payload);
    const voucherNumber = await generateAccountingVoucherNumber(db, tenantId, voucherType.id, voucherTypeCode, fiscalYear);
    const description = describeAccountingEvent(event, payload);

    const previousVoucher = await db.prepare(`
      SELECT verification_hash FROM accounting_vouchers
      WHERE tenant_id = ? AND verification_hash IS NOT NULL
      ORDER BY id DESC LIMIT 1
    `).bind(tenantId).first<{ verification_hash: string }>();

    const previousHash = previousVoucher?.verification_hash || 'GENESIS';
    const hash = await calculateVoucherHash({
      id: 0,
      tenant_id: tenantId,
      voucher_number: voucherNumber,
      entry_date: event.event_date,
      lines: lines.map(l => ({ account_id: l.accountId, debit: l.debit, credit: l.credit })),
    }, previousHash);

    const voucherResult = await db.prepare(`
      INSERT INTO accounting_vouchers
        (tenant_id, fiscal_year_id, voucher_type_id, voucher_number, entry_date,
         source_event_key, source_type, source_id, event_type, description, status,
         verification_hash, previous_hash, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?)
    `).bind(
      tenantId,
      fiscalYear.id,
      voucherType.id,
      voucherNumber,
      event.event_date,
      sourceEventKey,
      event.source_type,
      event.source_id,
      event.event_type,
      description,
      hash,
      previousHash,
      event.created_by,
    ).run();
    const voucherId = Number(voucherResult.meta.last_row_id);

    // Atomic: insert all journal lines for this voucher in a single batch.
    const journalLineStatements = lines.map((line, index) => db.prepare(`
      INSERT INTO accounting_journal_lines
        (tenant_id, voucher_id, account_id, debit_amount, credit_amount, memo, line_no,
         patient_id, doctor_id, supplier_id, department_id, branch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      voucherId,
      line.accountId,
      line.debit,
      line.credit,
      line.memo,
      index + 1,
      dimensions.patientId,
      dimensions.doctorId,
      dimensions.supplierId,
      dimensions.departmentId,
      dimensions.branchId,
    ));
    await db.batch(journalLineStatements);

    // Re-read the voucher to validate balance. This is the application-level guard.
    const { lineCount, totalDebit, totalCredit } = await getVoucherTotals(db, tenantId, voucherId);
    if (lineCount < 2 || Math.abs(totalDebit - totalCredit) >= BALANCE_TOLERANCE) {
      throw new Error(
        `Voucher ${voucherId} failed balance check: lineCount=${lineCount} debit=${totalDebit} credit=${totalCredit}`,
      );
    }

    // Atomic: insert sub-ledger transactions in a single batch.
    await ensureSubLedgerTransactionsForVoucher(
      db,
      tenantId,
      voucherId,
      lines,
      dimensions,
      mappings,
    );

    // Final state move: mark posted. DB trigger 0300 provides a last-resort safety net.
    await markEventPosted(db, event.id, voucherId);

    return { posted: true, voucherId, voucherNumber };
  } catch (error) {
    await markPostingEventFailed(db, event.id, error);
    throw error;
  }
}

export async function postPendingAccountingEvents(
  db: D1Database,
  tenantId?: string,
  limit = 25,
): Promise<AccountingPostResult[]> {
  const tenantClause = tenantId ? 'AND tenant_id = ?' : '';
  const params = tenantId ? [tenantId, limit] : [limit];
  const rows = await db.prepare(`
    SELECT source_event_key, tenant_id, status
    FROM accounting_posting_events
    WHERE (
        status = 'pending'
        OR (status = 'failed' AND COALESCE(attempts, 0) < 5)
        OR (
          status = 'processing'
          AND updated_at < datetime('now', '+6 hours', '-15 minutes')
        )
      )
      ${tenantClause}
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(...params).all<{ source_event_key: string; tenant_id: string; status?: string }>();

  const results: AccountingPostResult[] = [];
  for (const row of rows.results ?? []) {
    try {
      if (row.status === 'processing') {
        await recoverStaleProcessingEvent(db, row.tenant_id, row.source_event_key);
      }
      results.push(await postAccountingEventBySourceKey(db, row.tenant_id, row.source_event_key));
    } catch {
      results.push({
        posted: false,
        skippedReason: 'posting_failed',
      });
    }
  }

  return results;
}
