import type { PaymentTenderType } from './commands/collect-payment';
import { toMinorUnits } from './money';

export type PharmacySaleSourceKind = 'provisional_conversion' | 'prescription_dispense';
export type PharmacyPaymentMode = 'cash' | 'card' | 'credit' | 'mobile' | 'deposit';

export interface PharmacyCanonicalInventoryAuthority {
  itemPublicId: string;
  servicePublicId: string;
  lotPublicId: string;
  locationPublicId: string;
  baseUnitCode: string;
  conversionNumerator: number;
  conversionDenominator: number;
  balanceBeforeBase: number;
  balanceVersion: number;
}

export interface PharmacySaleItemContext {
  lineNumber: number;
  duplicateOrdinal: number;
  sourceItemId: number;
  pharmacyItemId: number;
  stockId: number | null;
  itemName: string;
  batchNo: string | null;
  expiryDate: string | null;
  sourceUnitCode: string | null;
  quantity: number;
  mrp: number;
  price: number;
  salePrice: number;
  discountPct: number;
  vatPct: number;
  subtotal: number;
  total: number;
  costPrice: number;
  legacyAvailableBefore: number;
  canonical: PharmacyCanonicalInventoryAuthority | null;
}

export interface PharmacySaleContext {
  tenantId: string;
  userId: number;
  patientId: number;
  patientVisitId: number | null;
  prescriberId: number | null;
  counterId: number | null;
  sourceKind: PharmacySaleSourceKind;
  sourceDocumentId: number;
  invoiceNo: string;
  businessDate: string;
  occurredAtUtc: string;
  paymentMode: PharmacyPaymentMode;
  externalTransactionId: string | null;
  tender: number;
  subtotal: number;
  sourceDiscountPct: number;
  discountAmount: number;
  total: number;
  paidAmount: number;
  creditAmount: number;
  depositDeductAmount: number;
  remarks: string | null;
  items: readonly PharmacySaleItemContext[];
}

export interface PharmacyMinorSettlement {
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  paidMinor: number;
  creditMinor: number;
  depositMinor: number;
}

export function pharmacyMoneyMinor(value: number, label: string): number {
  try {
    return Number(toMinorUnits(value));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new (error instanceof RangeError ? RangeError : TypeError)(`${label}: ${message}`, { cause: error });
  }
}

export function positivePharmacyQuantity(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeMinor(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

export function validatePharmacyPaymentIdentity(input: {
  totalMinor: number;
  paidMinor: number;
  depositMinor: number;
  creditMinor: number;
}): { settledMinor: number; dueMinor: number } {
  const totalMinor = nonNegativeMinor(input.totalMinor, 'totalMinor');
  const paidMinor = nonNegativeMinor(input.paidMinor, 'paidMinor');
  const depositMinor = nonNegativeMinor(input.depositMinor, 'depositMinor');
  const creditMinor = nonNegativeMinor(input.creditMinor, 'creditMinor');
  const settled = BigInt(paidMinor) + BigInt(depositMinor);
  const accounted = settled + BigInt(creditMinor);
  if (accounted !== BigInt(totalMinor)) {
    throw new RangeError('Pharmacy payment split must equal the invoice total');
  }
  if (settled > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Pharmacy settled amount exceeds the safe integer range');
  }
  return { settledMinor: Number(settled), dueMinor: creditMinor };
}

export function pharmacyTender(mode: PharmacyPaymentMode): {
  tenderType: PaymentTenderType;
  methodCode: string;
} {
  if (mode === 'cash') return { tenderType: 'cash', methodCode: 'cash' };
  if (mode === 'card') return { tenderType: 'card', methodCode: 'card' };
  if (mode === 'mobile') return { tenderType: 'mobile_wallet', methodCode: 'mobile' };
  return { tenderType: 'other', methodCode: mode };
}

export function pharmacyMinorSettlement(context: Pick<
  PharmacySaleContext,
  'subtotal' | 'discountAmount' | 'total' | 'paidAmount' | 'creditAmount' | 'depositDeductAmount'
>): PharmacyMinorSettlement {
  const result = {
    subtotalMinor: pharmacyMoneyMinor(context.subtotal, 'subtotal'),
    discountMinor: pharmacyMoneyMinor(context.discountAmount, 'discountAmount'),
    totalMinor: pharmacyMoneyMinor(context.total, 'total'),
    paidMinor: pharmacyMoneyMinor(context.paidAmount, 'paidAmount'),
    creditMinor: pharmacyMoneyMinor(context.creditAmount, 'creditAmount'),
    depositMinor: pharmacyMoneyMinor(context.depositDeductAmount, 'depositDeductAmount'),
  };
  if (result.subtotalMinor - result.discountMinor !== result.totalMinor) {
    throw new RangeError('Pharmacy subtotal less discount must equal total');
  }
  validatePharmacyPaymentIdentity({
    totalMinor: result.totalMinor,
    paidMinor: result.paidMinor,
    depositMinor: result.depositMinor,
    creditMinor: result.creditMinor,
  });
  return result;
}
