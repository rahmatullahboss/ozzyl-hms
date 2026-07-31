import type { FinalizeIpdDischargeBillingInput } from './commands/finalize-ipd-discharge-billing';
import { buildProvisionalSettlementProjection } from './live-provisional-billing';
import { toMinorUnits } from './money';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';
import { toUtcIso } from './time';

export type IpdDischargeMode = 'settled' | 'credit_pending';

export interface IpdDischargeProjectionItem {
  id: number;
  patientId: number;
  category: string;
  description: string;
  department?: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  totalAmount: number;
  doctorId?: number | null;
  doctorName?: string | null;
  referenceId?: number | null;
}

export interface IpdDischargePackageSnapshot {
  packageId: number;
  name: string;
  amount: number;
}

export interface IpdDischargeBedSegmentSnapshot {
  patientBedInfoId: number;
  bedId: number;
  description: string;
  amount: number;
}

export interface BuildIpdDischargeBillingProjectionInput {
  tenantId: string;
  patientId: number;
  admissionId: number;
  invoiceNo: string;
  issuedAtUtc: string;
  businessDate: string;
  dischargeMode: IpdDischargeMode;
  finalTotal: number;
  globalDiscount: number;
  provisionalItems: readonly IpdDischargeProjectionItem[];
  package?: IpdDischargePackageSnapshot | null;
  bedSegments: readonly IpdDischargeBedSegmentSnapshot[];
  requestedDepositAmount: number;
  depositAppliedAmount: number;
  depositRefundAmount: number;
  paymentAmount: number;
  paymentMethod: string;
  receiptNo?: string | null;
  depositAdjustmentNo?: string | null;
  refundReceiptNo?: string | null;
  externalTransactionId?: string | null;
  collectorId?: number | null;
  counterId?: number | null;
  counterSessionId?: number | null;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return exact(value, label);
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function moneyMinor(value: number, label: string): number {
  const minor = Number(toMinorUnits(value));
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new RangeError(`${label} must be non-negative money`);
  }
  return minor;
}

function syntheticId(namespace: 'package' | 'bed', id: number): number {
  const base = namespace === 'package' ? 1_000_000_000_000 : 2_000_000_000_000;
  const value = base + positive(id, `${namespace} source id`);
  if (!Number.isSafeInteger(value)) throw new RangeError(`${namespace} source id exceeds safe integer range`);
  return value;
}

export async function buildIpdDischargeBillingProjection(
  input: BuildIpdDischargeBillingProjectionInput,
): Promise<FinalizeIpdDischargeBillingInput> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const patientId = positive(input.patientId, 'patientId');
  const admissionId = positive(input.admissionId, 'admissionId');
  const invoiceNo = exact(input.invoiceNo, 'invoiceNo');
  const issuedAtUtc = toUtcIso(input.issuedAtUtc);
  const requestedDepositMinor = moneyMinor(input.requestedDepositAmount, 'requestedDepositAmount');
  const depositAppliedMinor = moneyMinor(input.depositAppliedAmount, 'depositAppliedAmount');
  const depositRefundMinor = moneyMinor(input.depositRefundAmount, 'depositRefundAmount');
  const paymentMinor = moneyMinor(input.paymentAmount, 'paymentAmount');
  const finalTotalMinor = moneyMinor(input.finalTotal, 'finalTotal');
  if (depositAppliedMinor + depositRefundMinor !== requestedDepositMinor) {
    throw new RangeError('IPD deposit application and refund do not reconcile to requested deposit');
  }
  if (depositAppliedMinor + paymentMinor > finalTotalMinor) {
    throw new RangeError('IPD settlement exceeds invoice total');
  }
  const dueMinor = finalTotalMinor - depositAppliedMinor - paymentMinor;
  if (input.dischargeMode === 'settled' && dueMinor !== 0) {
    throw new RangeError('Settled IPD discharge must have zero due');
  }
  if (input.dischargeMode === 'credit_pending' && dueMinor <= 0) {
    throw new RangeError('Credit-pending IPD discharge must retain positive due');
  }

  const seenProvisional = new Set<number>();
  const items = input.provisionalItems.map((item) => {
    const id = positive(item.id, 'provisional item id');
    if (seenProvisional.has(id)) throw new RangeError('duplicate provisional item');
    seenProvisional.add(id);
    if (positive(item.patientId, 'provisional item patientId') !== patientId) {
      throw new Error('IPD provisional item patient mismatch');
    }
    return {
      provisionalItemId: id,
      patientId,
      admissionId,
      category: exact(item.category, 'provisional item category'),
      description: exact(item.description, 'provisional item description'),
      department: item.department ?? null,
      quantity: positive(item.quantity, 'provisional item quantity'),
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      totalAmount: item.totalAmount,
      doctorId: item.doctorId ?? null,
      doctorName: item.doctorName ?? null,
      referenceId: item.referenceId ?? item.doctorId ?? null,
      isManual: false,
    };
  });

  if (input.package) {
    const packageId = positive(input.package.packageId, 'package.packageId');
    items.push({
      provisionalItemId: syntheticId('package', packageId),
      patientId,
      admissionId,
      category: 'ipd_package',
      description: exact(input.package.name, 'package.name'),
      department: 'IPD',
      quantity: 1,
      unitPrice: input.package.amount,
      discountAmount: 0,
      totalAmount: input.package.amount,
      doctorId: null,
      doctorName: null,
      referenceId: packageId,
      isManual: false,
    });
  }

  const seenBeds = new Set<number>();
  for (const segment of input.bedSegments) {
    const patientBedInfoId = positive(segment.patientBedInfoId, 'bed.patientBedInfoId');
    if (seenBeds.has(patientBedInfoId)) throw new RangeError('duplicate IPD bed segment');
    seenBeds.add(patientBedInfoId);
    const bedId = positive(segment.bedId, 'bed.bedId');
    items.push({
      provisionalItemId: syntheticId('bed', patientBedInfoId),
      patientId,
      admissionId,
      category: 'ipd_bed',
      description: exact(segment.description, 'bed.description'),
      department: 'IPD',
      quantity: 1,
      unitPrice: segment.amount,
      discountAmount: 0,
      totalAmount: segment.amount,
      doctorId: null,
      doctorName: null,
      referenceId: bedId,
      isManual: false,
    });
  }
  if (items.length === 0) throw new RangeError('IPD discharge invoice must contain billable items');

  const invoiceSettlement = await buildProvisionalSettlementProjection({
    tenantId,
    patientId,
    invoiceNo,
    issuedAtUtc,
    businessDate: exact(input.businessDate, 'businessDate'),
    globalDiscount: input.globalDiscount,
    items,
    paymentAmount: input.paymentAmount,
    depositAmount: input.depositAppliedAmount,
    paymentMethod: input.paymentMethod,
    receiptNo: input.receiptNo ?? null,
    depositAdjustmentNo: input.depositAdjustmentNo ?? null,
    externalTransactionId: input.externalTransactionId ?? null,
    collectorId: input.collectorId ?? null,
    counterId: input.counterId ?? null,
    counterSessionId: input.counterSessionId ?? null,
  });
  const projectedTotalMinor = invoiceSettlement.invoice.lines.reduce(
    (sum, line) => sum + line.unitAmountMinor,
    0,
  );
  if (projectedTotalMinor !== finalTotalMinor) {
    throw new RangeError('Projected IPD invoice total does not match final legacy bill total');
  }

  const encounterEvidence = await createSourceEvidenceSha256({
    sourceType: 'legacy_admission_discharge',
    sourcePublicId: String(admissionId),
    sourceTable: 'admissions',
    admissionId,
    patientId,
    invoiceNo,
    completedAtUtc: issuedAtUtc,
    dischargeMode: input.dischargeMode,
    finalTotalMinor,
    requestedDepositMinor,
    depositAppliedMinor,
    depositRefundMinor,
    paymentMinor,
  });

  let depositRefund: FinalizeIpdDischargeBillingInput['depositRefund'] = null;
  if (depositRefundMinor > 0) {
    const refundReceiptNo = optionalExact(input.refundReceiptNo, 'refundReceiptNo');
    if (!refundReceiptNo) throw new TypeError('refundReceiptNo is required when excess deposit refund exists');
    const sourceType = 'legacy_live_deposit_refund' as const;
    const evidence = await createSourceEvidenceSha256({
      sourceType,
      sourcePublicId: refundReceiptNo,
      sourceTable: 'billing_deposits',
      admissionId,
      patientId,
      invoiceNo,
      amountMinor: depositRefundMinor,
      requestedDepositMinor,
      depositAppliedMinor,
      completedAtUtc: issuedAtUtc,
    });
    depositRefund = {
      operationPublicId: await createDeterministicSourceId(
        'deprefop', tenantId, sourceType, refundReceiptNo,
      ),
      amountMinor: depositRefundMinor,
      refundReceiptNumber: refundReceiptNo,
      tenderType: 'cash',
      methodCode: 'cash',
      sourceType,
      sourcePublicId: refundReceiptNo,
      sourceTable: 'billing_deposits',
      sourceEvidenceSha256: evidence,
      outboxEventPublicId: await createDeterministicSourceId(
        'outevt', tenantId, sourceType, refundReceiptNo,
      ),
    };
  }

  return {
    tenantId,
    commandIdempotencyKey: `ipd_discharge_finalize:${invoiceNo}:${input.receiptNo ?? 'none'}:${input.depositAdjustmentNo ?? 'none'}:${input.refundReceiptNo ?? 'none'}`,
    invoiceSettlement,
    encounter: {
      legacyAdmissionId: admissionId,
      legacyPatientId: patientId,
      completedAtUtc: issuedAtUtc,
      sourceType: 'legacy_admission_discharge',
      sourcePublicId: String(admissionId),
      sourceTable: 'admissions',
      sourceEvidenceSha256: encounterEvidence,
      eventPublicId: await createDeterministicSourceId(
        'outevt', tenantId, 'legacy_admission_discharge', String(admissionId),
      ),
    },
    depositRefund,
  };
}
