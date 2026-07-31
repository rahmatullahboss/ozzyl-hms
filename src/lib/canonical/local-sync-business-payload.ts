import { stableCanonicalJson } from './idempotency';
import type { CanonicalSyncEnvelope, CanonicalSyncOperation } from './local-sync-protocol';

export type CanonicalSyncBusinessMutationKind =
  | 'encounter_started'
  | 'encounter_completed'
  | 'encounter_cancelled'
  | 'service_request_created'
  | 'service_request_cancelled'
  | 'service_event_recorded'
  | 'service_event_cancelled'
  | 'invoice_issued'
  | 'invoice_cancelled'
  | 'payment_receipt_recorded'
  | 'payment_reversed'
  | 'deposit_recorded'
  | 'deposit_applied'
  | 'deposit_refunded'
  | 'compensation_accrued'
  | 'compensation_adjusted'
  | 'inventory_movement_recorded';

export interface CanonicalSyncMutationBase {
  kind: CanonicalSyncBusinessMutationKind;
  entityPublicId: string;
}

export interface EncounterStartedMutation extends CanonicalSyncMutationBase {
  kind: 'encounter_started';
  patientSyncKey: string;
  encounterType: 'outpatient' | 'inpatient' | 'teleconsultation' | 'emergency' | 'other';
  startedAtUtc: string;
  sourceEvidenceSha256: string;
}

export interface EncounterCompletedMutation extends CanonicalSyncMutationBase {
  kind: 'encounter_completed';
  encounterType: EncounterStartedMutation['encounterType'];
  startedAtUtc: string;
  completedAtUtc: string;
  sourceEvidenceSha256: string;
}

export interface EncounterCancelledMutation extends CanonicalSyncMutationBase {
  kind: 'encounter_cancelled';
  encounterType: EncounterStartedMutation['encounterType'];
  startedAtUtc: string;
  cancelledAtUtc: string;
  sourceEvidenceSha256: string;
}

export interface ServiceRequestCreatedMutation extends CanonicalSyncMutationBase {
  kind: 'service_request_created';
  patientSyncKey: string;
  encounterPublicId: string | null;
  servicePublicId: string;
  requestedQuantity: number;
  requestedAtUtc: string;
  sourceEvidenceSha256: string;
}

export interface ServiceRequestCancelledMutation extends CanonicalSyncMutationBase {
  kind: 'service_request_cancelled';
  encounterPublicId: string | null;
  servicePublicId: string;
  requestedQuantity: number;
  fulfilledQuantity: number;
  requestedAtUtc: string;
  cancelledAtUtc: string;
  sourceEvidenceSha256: string;
}

export interface ServiceEventRecordedMutation extends CanonicalSyncMutationBase {
  kind: 'service_event_recorded';
  requestPublicId: string;
  encounterPublicId: string | null;
  servicePublicId: string;
  serviceEventType: 'accepted' | 'delivered' | 'completed' | 'dispensed' | 'occupied';
  quantity: number;
  requestStatusAfter: 'active' | 'partially_fulfilled' | 'fulfilled';
  occurredAtUtc: string;
  sourceEvidenceSha256: string;
}

export interface ServiceEventCancelledMutation extends CanonicalSyncMutationBase {
  kind: 'service_event_cancelled';
  requestPublicId: string;
  encounterPublicId: string | null;
  servicePublicId: string;
  serviceEventType: ServiceEventRecordedMutation['serviceEventType'];
  quantity: number;
  requestedQuantity: number;
  fulfilledQuantityBefore: number;
  fulfilledQuantityAfter: number;
  requestStatusBefore: ServiceEventRecordedMutation['requestStatusAfter'];
  requestStatusAfter: ServiceEventRecordedMutation['requestStatusAfter'];
  previousEventPublicId: string | null;
  occurredAtUtc: string;
  cancelledAtUtc: string;
  sourceEvidenceSha256: string;
}

export interface InvoiceLineMutation {
  linePublicId: string;
  lineType: 'service' | 'discount' | 'tax' | 'rounding' | 'surcharge' | 'waiver' | 'other_adjustment';
  serviceEventPublicId: string | null;
  adjustmentCode: string | null;
  quantity: number;
  unitAmountMinor: number;
  lineAmountMinor: number;
  sourceEvidenceSha256: string;
}

export interface InvoiceEncounterLinkMutation {
  encounterPublicId: string;
  admissionNo: string;
  linkType: 'discharge_invoice';
  sourceEvidenceSha256: string;
}

export interface InvoiceIssuedMutation extends CanonicalSyncMutationBase {
  kind: 'invoice_issued';
  invoiceNumber: string;
  patientSyncKey: string;
  currencyCode: string;
  subtotalMinor: number;
  adjustmentTotalMinor: number;
  totalMinor: number;
  issuedAtUtc: string;
  sourceEvidenceSha256: string;
  encounterLink: InvoiceEncounterLinkMutation | null;
  lines: InvoiceLineMutation[];
}

export interface CompensationAdjustmentMutation {
  adjustmentPublicId: string;
  accrualPublicId: string;
  adjustmentType: string;
  reasonCode: string;
  amountMinor: number;
  adjustedBeforeMinor: number;
  adjustedAfterMinor: number;
  settledBeforeMinor: number;
  settledAfterMinor: number;
  payableBeforeMinor: number;
  payableAfterMinor: number;
  statusBefore: string;
  statusAfter: string;
  occurredAtUtc: string;
  businessDate: string;
  sourceEvidenceSha256: string;
}

export interface InvoiceCancelledMutation extends CanonicalSyncMutationBase {
  kind: 'invoice_cancelled';
  totalMinor: number;
  cancelledAtUtc: string;
  compensationAdjustments: CompensationAdjustmentMutation[];
}

export interface PaymentTenderMutation {
  tenderPublicId: string;
  tenderType: 'cash' | 'card' | 'mobile_wallet' | 'bank_transfer' | 'gateway' | 'other';
  methodCode: string;
  amountMinor: number;
  status: 'verifying' | 'captured' | 'failed';
  externalTransactionId: string | null;
  capturedAtUtc: string | null;
  failedAtUtc: string | null;
  sourceEvidenceSha256: string;
}

export interface PaymentAllocationMutation {
  allocationPublicId: string;
  invoicePublicId: string;
  invoiceLinePublicId: string | null;
  amountMinor: number;
  invoiceDueBeforeMinor: number;
  invoiceDueAfterMinor: number;
  allocatedAtUtc: string;
  sourceEvidenceSha256: string;
}

export interface PaymentReceiptRecordedMutation extends CanonicalSyncMutationBase {
  kind: 'payment_receipt_recorded';
  receiptNumber: string;
  patientSyncKey: string;
  currencyCode: string;
  totalMinor: number;
  allocatedTotalMinor: number;
  unallocatedMinor: number;
  status: 'pending' | 'posted' | 'failed';
  receivedAtUtc: string;
  businessDate: string;
  externalTransactionId: string | null;
  postedAtUtc: string | null;
  failedAtUtc: string | null;
  sourceEvidenceSha256: string;
  tenders: PaymentTenderMutation[];
  allocations: PaymentAllocationMutation[];
}

export interface PaymentReversedMutation extends CanonicalSyncMutationBase {
  kind: 'payment_reversed';
  reversalPublicId: string;
  refundPublicId: string;
  receiptPublicId: string;
  tenderPublicId: string;
  allocationPublicId: string;
  invoicePublicId: string;
  amountMinor: number;
  reasonCode: string;
  tenderType: PaymentTenderMutation['tenderType'];
  methodCode: string;
  reversedAtUtc: string;
  businessDate: string;
  allocationReversedBeforeMinor: number;
  allocationReversedAfterMinor: number;
  tenderReversedBeforeMinor: number;
  tenderReversedAfterMinor: number;
  receiptRefundedBeforeMinor: number;
  receiptRefundedAfterMinor: number;
  invoicePaidBeforeMinor: number;
  invoicePaidAfterMinor: number;
  invoiceDueBeforeMinor: number;
  invoiceDueAfterMinor: number;
  invoiceNetDueBeforeMinor: number;
  invoiceNetDueAfterMinor: number;
  sourceEvidenceSha256: string;
  refundSourceEvidenceSha256: string;
}

export interface DepositRecordedMutation extends CanonicalSyncMutationBase {
  kind: 'deposit_recorded';
  depositNumber: string;
  receiptPublicId: string;
  patientSyncKey: string;
  currencyCode: string;
  amountMinor: number;
  receivedAtUtc: string;
  businessDate: string;
  postedAtUtc: string;
  sourceEvidenceSha256: string;
}

export interface DepositAppliedMutation extends CanonicalSyncMutationBase {
  kind: 'deposit_applied';
  applicationPublicId: string;
  invoicePublicId: string;
  invoiceLinePublicId: string | null;
  amountMinor: number;
  depositAvailableBeforeMinor: number;
  depositAvailableAfterMinor: number;
  invoicePaidBeforeMinor: number;
  invoicePaidAfterMinor: number;
  invoiceDueBeforeMinor: number;
  invoiceDueAfterMinor: number;
  invoiceNetDueBeforeMinor: number;
  invoiceNetDueAfterMinor: number;
  appliedAtUtc: string;
  businessDate: string;
  sourceEvidenceSha256: string;
}

export interface DepositRefundedMutation extends CanonicalSyncMutationBase {
  kind: 'deposit_refunded';
  refundPublicId: string;
  amountMinor: number;
  tenderType: PaymentTenderMutation['tenderType'];
  methodCode: string;
  refundedAtUtc: string;
  businessDate: string;
  depositAvailableBeforeMinor: number;
  depositAvailableAfterMinor: number;
  depositRefundedBeforeMinor: number;
  depositRefundedAfterMinor: number;
  depositSourceEvidenceSha256: string;
  refundSourceEvidenceSha256: string;
}

export interface CompensationAccruedMutation extends CanonicalSyncMutationBase {
  kind: 'compensation_accrued';
  invoicePublicId: string;
  invoiceLinePublicId: string;
  serviceEventPublicId: string | null;
  practitionerPublicId: string | null;
  practitionerRole: 'performing' | 'referring' | 'prescribing' | 'treating' | 'reporting';
  accrualStage: 'performer_reserve' | 'commission' | 'professional_fee';
  rulePublicId: string;
  ruleVersion: number;
  calculationBasis: 'gross' | 'net_after_discount' | 'remaining_after_performer' | 'collected';
  rateType: 'fixed' | 'basis_points';
  rateValue: number;
  currencyCode: string;
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  performerReserveMinor: number;
  eligibleBaseMinor: number;
  earnedMinor: number;
  initialStatus: 'unassigned' | 'accrued';
  accruedAtUtc: string;
  businessDate: string;
  sourceEvidenceSha256: string;
}

export interface CompensationAdjustedMutation extends CanonicalSyncMutationBase {
  kind: 'compensation_adjusted';
  adjustment: CompensationAdjustmentMutation;
}

export interface InventoryMovementRecordedMutation extends CanonicalSyncMutationBase {
  kind: 'inventory_movement_recorded';
  itemPublicId: string;
  locationPublicId: string;
  lotPublicId: string;
  movementType: string;
  direction: 'in' | 'out';
  sourceQuantity: number;
  sourceUnitCode: string;
  conversionNumerator: number;
  conversionDenominator: number;
  quantityBase: number;
  signedQuantityBase: number;
  balanceBeforeBase: number;
  balanceAfterBase: number;
  balanceVersionBefore: number;
  balanceVersionAfter: number;
  transferPublicId: string | null;
  serviceEventPublicId: string | null;
  invoicePublicId: string | null;
  invoiceLinePublicId: string | null;
  reversalOfMovementPublicId: string | null;
  sourceType: string;
  sourcePublicId: string;
  sourceLinePublicId: string;
  sourceTable: string;
  occurredAtUtc: string;
  businessDate: string;
  sourceEvidenceSha256: string;
}

export type CanonicalSyncMutationV1 =
  | EncounterStartedMutation
  | EncounterCompletedMutation
  | EncounterCancelledMutation
  | ServiceRequestCreatedMutation
  | ServiceRequestCancelledMutation
  | ServiceEventRecordedMutation
  | ServiceEventCancelledMutation
  | InvoiceIssuedMutation
  | InvoiceCancelledMutation
  | PaymentReceiptRecordedMutation
  | PaymentReversedMutation
  | DepositRecordedMutation
  | DepositAppliedMutation
  | DepositRefundedMutation
  | CompensationAccruedMutation
  | CompensationAdjustedMutation
  | InventoryMovementRecordedMutation;

export interface CanonicalSyncBusinessPayloadV1 extends Record<string, unknown> {
  schemaVersion: 1;
  event: Record<string, unknown>;
  mutation: CanonicalSyncMutationV1;
}

export class CanonicalSyncBusinessPayloadError extends Error {
  readonly code = 'CANONICAL_SYNC_BUSINESS_PAYLOAD';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CanonicalSyncBusinessPayloadError';
  }
}

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CanonicalSyncBusinessPayloadError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalSyncBusinessPayloadError(`${label} must be a plain object`);
  }
  try {
    stableCanonicalJson(value);
  } catch (error) {
    throw new CanonicalSyncBusinessPayloadError(`${label} is not canonically serializable`, { cause: error });
  }
  return value as Record<string, unknown>;
}

function exact(value: unknown, label: string, maxLength = 256): string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > maxLength
  ) {
    throw new CanonicalSyncBusinessPayloadError(
      `${label} must be non-empty without surrounding whitespace and at most ${maxLength} characters`,
    );
  }
  return value;
}

function publicId(value: unknown, label: string, maxLength = 192): string {
  const result = exact(value, label, maxLength);
  if (/^\d+$/.test(result)) {
    throw new CanonicalSyncBusinessPayloadError(`${label} must be a stable public identity, not a raw numeric ID`);
  }
  return result;
}

function utc(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new CanonicalSyncBusinessPayloadError(`${label} must be a valid ISO-8601 UTC timestamp`);
  }
  return value;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new CanonicalSyncBusinessPayloadError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function integer(value: unknown, label: string, options: { positive?: boolean; signed?: boolean } = {}): number {
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalSyncBusinessPayloadError(`${label} must be a safe integer`);
  }
  const number = Number(value);
  if (options.positive && number <= 0) {
    throw new CanonicalSyncBusinessPayloadError(`${label} must be positive`);
  }
  if (!options.signed && number < 0) {
    throw new CanonicalSyncBusinessPayloadError(`${label} cannot be negative`);
  }
  return number;
}

function currency(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CURRENCY_PATTERN.test(value)) {
    throw new CanonicalSyncBusinessPayloadError(`${label} must be an uppercase three-letter currency code`);
  }
  return value;
}

interface MutationContract {
  kind: CanonicalSyncBusinessMutationKind;
  operation: CanonicalSyncOperation;
}

const CONTRACTS = new Map<string, MutationContract>([
  ['encounter\u0000canonical.encounter.started', { kind: 'encounter_started', operation: 'upsert' }],
  ['encounter\u0000canonical.encounter.completed', { kind: 'encounter_completed', operation: 'upsert' }],
  ['encounter\u0000canonical.encounter.cancelled', { kind: 'encounter_cancelled', operation: 'upsert' }],
  ['service_request\u0000canonical.service_request.created', { kind: 'service_request_created', operation: 'upsert' }],
  ['service_request\u0000canonical.service_request.cancelled', { kind: 'service_request_cancelled', operation: 'upsert' }],
  ['service_event\u0000canonical.service_event.recorded', { kind: 'service_event_recorded', operation: 'upsert' }],
  ['service_event\u0000canonical.service_event.cancelled', { kind: 'service_event_cancelled', operation: 'upsert' }],
  ['invoice\u0000canonical.invoice.issued', { kind: 'invoice_issued', operation: 'upsert' }],
  ['invoice\u0000canonical.invoice.cancelled', { kind: 'invoice_cancelled', operation: 'tombstone' }],
  ['payment_receipt\u0000canonical.payment.receipt.posted', { kind: 'payment_receipt_recorded', operation: 'upsert' }],
  ['payment_receipt\u0000canonical.payment.receipt.pending', { kind: 'payment_receipt_recorded', operation: 'upsert' }],
  ['payment_receipt\u0000canonical.payment.receipt.failed', { kind: 'payment_receipt_recorded', operation: 'upsert' }],
  ['payment_receipt\u0000canonical.payment.reversed', { kind: 'payment_reversed', operation: 'tombstone' }],
  ['deposit\u0000canonical.deposit.recorded', { kind: 'deposit_recorded', operation: 'upsert' }],
  ['deposit\u0000canonical.deposit.applied', { kind: 'deposit_applied', operation: 'upsert' }],
  ['deposit\u0000canonical.deposit.refunded', { kind: 'deposit_refunded', operation: 'upsert' }],
  ['compensation_accrual\u0000canonical.compensation.accrued', { kind: 'compensation_accrued', operation: 'upsert' }],
  ['compensation_accrual\u0000canonical.compensation.performer-reserve.accrued', { kind: 'compensation_accrued', operation: 'upsert' }],
  ['compensation_accrual\u0000canonical.compensation.adjusted', { kind: 'compensation_adjusted', operation: 'upsert' }],
  ['inventory_movement\u0000canonical.inventory.stock_movement.recorded', { kind: 'inventory_movement_recorded', operation: 'upsert' }],
  ['inventory_movement\u0000canonical.inventory.movement.posted', { kind: 'inventory_movement_recorded', operation: 'upsert' }],
]);

function validateEncounterStarted(mutation: Record<string, unknown>): void {
  publicId(mutation.entityPublicId, 'mutation.entityPublicId');
  publicId(mutation.patientSyncKey, 'mutation.patientSyncKey');
  const encounterType = exact(mutation.encounterType, 'mutation.encounterType', 32);
  if (!['outpatient', 'inpatient', 'teleconsultation', 'emergency', 'other'].includes(encounterType)) {
    throw new CanonicalSyncBusinessPayloadError('mutation.encounterType is unsupported');
  }
  utc(mutation.startedAtUtc, 'mutation.startedAtUtc');
  hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
}

function validateCompensationAdjustment(
  value: unknown,
  label: string,
): CompensationAdjustmentMutation {
  const adjustment = plainObject(value, label);
  const amountMinor = integer(adjustment.amountMinor, `${label}.amountMinor`, { positive: true });
  const adjustedBeforeMinor = integer(adjustment.adjustedBeforeMinor, `${label}.adjustedBeforeMinor`);
  const adjustedAfterMinor = integer(adjustment.adjustedAfterMinor, `${label}.adjustedAfterMinor`);
  const settledBeforeMinor = integer(adjustment.settledBeforeMinor, `${label}.settledBeforeMinor`);
  const settledAfterMinor = integer(adjustment.settledAfterMinor, `${label}.settledAfterMinor`);
  const payableBeforeMinor = integer(adjustment.payableBeforeMinor, `${label}.payableBeforeMinor`);
  const payableAfterMinor = integer(adjustment.payableAfterMinor, `${label}.payableAfterMinor`);
  if (
    adjustedAfterMinor !== adjustedBeforeMinor + amountMinor
    || settledAfterMinor !== settledBeforeMinor
    || payableBeforeMinor !== amountMinor
    || payableAfterMinor !== 0
  ) {
    throw new CanonicalSyncBusinessPayloadError(`${label} balances do not match cancellation semantics`);
  }
  const statusBefore = exact(adjustment.statusBefore, `${label}.statusBefore`, 32);
  const statusAfter = exact(adjustment.statusAfter, `${label}.statusAfter`, 32);
  if (!['unassigned', 'accrued'].includes(statusBefore) || statusAfter !== 'reversed') {
    throw new CanonicalSyncBusinessPayloadError(`${label} status transition is unsupported`);
  }
  const businessDate = exact(adjustment.businessDate, `${label}.businessDate`, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new CanonicalSyncBusinessPayloadError(`${label}.businessDate must use YYYY-MM-DD`);
  }
  return {
    adjustmentPublicId: publicId(adjustment.adjustmentPublicId, `${label}.adjustmentPublicId`),
    accrualPublicId: publicId(adjustment.accrualPublicId, `${label}.accrualPublicId`),
    adjustmentType: exact(adjustment.adjustmentType, `${label}.adjustmentType`, 64),
    reasonCode: exact(adjustment.reasonCode, `${label}.reasonCode`, 128),
    amountMinor,
    adjustedBeforeMinor,
    adjustedAfterMinor,
    settledBeforeMinor,
    settledAfterMinor,
    payableBeforeMinor,
    payableAfterMinor,
    statusBefore,
    statusAfter,
    occurredAtUtc: utc(adjustment.occurredAtUtc, `${label}.occurredAtUtc`),
    businessDate,
    sourceEvidenceSha256: hash(adjustment.sourceEvidenceSha256, `${label}.sourceEvidenceSha256`),
  };
}

function validateInvoiceLine(value: unknown, index: number): InvoiceLineMutation {
  const line = plainObject(value, `mutation.lines[${index}]`);
  const linePublicId = publicId(line.linePublicId, `mutation.lines[${index}].linePublicId`);
  const lineType = exact(line.lineType, `mutation.lines[${index}].lineType`, 32) as InvoiceLineMutation['lineType'];
  if (!['service', 'discount', 'tax', 'rounding', 'surcharge', 'waiver', 'other_adjustment'].includes(lineType)) {
    throw new CanonicalSyncBusinessPayloadError(`mutation.lines[${index}].lineType is unsupported`);
  }
  const serviceEventPublicId = line.serviceEventPublicId == null
    ? null
    : publicId(line.serviceEventPublicId, `mutation.lines[${index}].serviceEventPublicId`);
  const adjustmentCode = line.adjustmentCode == null
    ? null
    : exact(line.adjustmentCode, `mutation.lines[${index}].adjustmentCode`, 128);
  const quantity = integer(line.quantity, `mutation.lines[${index}].quantity`, { positive: true });
  const unitAmountMinor = integer(line.unitAmountMinor, `mutation.lines[${index}].unitAmountMinor`, { signed: true });
  const lineAmountMinor = integer(line.lineAmountMinor, `mutation.lines[${index}].lineAmountMinor`, { signed: true });
  if (lineType === 'service') {
    if (!serviceEventPublicId || adjustmentCode !== null || unitAmountMinor < 0 || lineAmountMinor !== quantity * unitAmountMinor) {
      throw new CanonicalSyncBusinessPayloadError(`mutation.lines[${index}] has invalid service-line authority`);
    }
  } else if (serviceEventPublicId !== null || !adjustmentCode || quantity !== 1 || lineAmountMinor !== unitAmountMinor) {
    throw new CanonicalSyncBusinessPayloadError(`mutation.lines[${index}] has invalid adjustment-line authority`);
  }
  if (['discount', 'waiver'].includes(lineType) && lineAmountMinor > 0) {
    throw new CanonicalSyncBusinessPayloadError(`mutation.lines[${index}] discount/waiver amount cannot be positive`);
  }
  if (['tax', 'surcharge'].includes(lineType) && lineAmountMinor < 0) {
    throw new CanonicalSyncBusinessPayloadError(`mutation.lines[${index}] tax/surcharge amount cannot be negative`);
  }
  return {
    linePublicId,
    lineType,
    serviceEventPublicId,
    adjustmentCode,
    quantity,
    unitAmountMinor,
    lineAmountMinor,
    sourceEvidenceSha256: hash(line.sourceEvidenceSha256, `mutation.lines[${index}].sourceEvidenceSha256`),
  };
}

function validatePaymentTender(
  value: unknown,
  index: number,
  receiptStatus: PaymentReceiptRecordedMutation['status'],
  receivedAtUtc: string,
): PaymentTenderMutation {
  const label = `mutation.tenders[${index}]`;
  const tender = plainObject(value, label);
  const tenderType = exact(tender.tenderType, `${label}.tenderType`, 32) as PaymentTenderMutation['tenderType'];
  if (!['cash', 'card', 'mobile_wallet', 'bank_transfer', 'gateway', 'other'].includes(tenderType)) {
    throw new CanonicalSyncBusinessPayloadError(`${label}.tenderType is unsupported`);
  }
  const expectedStatus = receiptStatus === 'posted'
    ? 'captured'
    : receiptStatus === 'pending'
      ? 'verifying'
      : 'failed';
  if (tender.status !== expectedStatus) {
    throw new CanonicalSyncBusinessPayloadError(`${label}.status does not match receipt status`);
  }
  const capturedAtUtc = tender.capturedAtUtc == null ? null : utc(tender.capturedAtUtc, `${label}.capturedAtUtc`);
  const failedAtUtc = tender.failedAtUtc == null ? null : utc(tender.failedAtUtc, `${label}.failedAtUtc`);
  if (
    (expectedStatus === 'captured' && (capturedAtUtc !== receivedAtUtc || failedAtUtc !== null))
    || (expectedStatus === 'failed' && (failedAtUtc !== receivedAtUtc || capturedAtUtc !== null))
    || (expectedStatus === 'verifying' && (capturedAtUtc !== null || failedAtUtc !== null))
  ) {
    throw new CanonicalSyncBusinessPayloadError(`${label} timestamps do not match tender status`);
  }
  return {
    tenderPublicId: publicId(tender.tenderPublicId, `${label}.tenderPublicId`),
    tenderType,
    methodCode: exact(tender.methodCode, `${label}.methodCode`, 128),
    amountMinor: integer(tender.amountMinor, `${label}.amountMinor`, { positive: true }),
    status: expectedStatus,
    externalTransactionId: tender.externalTransactionId == null
      ? null
      : exact(tender.externalTransactionId, `${label}.externalTransactionId`, 256),
    capturedAtUtc,
    failedAtUtc,
    sourceEvidenceSha256: hash(tender.sourceEvidenceSha256, `${label}.sourceEvidenceSha256`),
  };
}

function validatePaymentAllocation(
  value: unknown,
  index: number,
  receivedAtUtc: string,
): PaymentAllocationMutation {
  const label = `mutation.allocations[${index}]`;
  const allocation = plainObject(value, label);
  const amountMinor = integer(allocation.amountMinor, `${label}.amountMinor`, { positive: true });
  const invoiceDueBeforeMinor = integer(
    allocation.invoiceDueBeforeMinor,
    `${label}.invoiceDueBeforeMinor`,
  );
  const invoiceDueAfterMinor = integer(
    allocation.invoiceDueAfterMinor,
    `${label}.invoiceDueAfterMinor`,
  );
  if (invoiceDueBeforeMinor < amountMinor || invoiceDueAfterMinor !== invoiceDueBeforeMinor - amountMinor) {
    throw new CanonicalSyncBusinessPayloadError(`${label} invoice due balances do not reconcile`);
  }
  const allocatedAtUtc = utc(allocation.allocatedAtUtc, `${label}.allocatedAtUtc`);
  if (allocatedAtUtc !== receivedAtUtc) {
    throw new CanonicalSyncBusinessPayloadError(`${label}.allocatedAtUtc must match receipt time`);
  }
  return {
    allocationPublicId: publicId(allocation.allocationPublicId, `${label}.allocationPublicId`),
    invoicePublicId: publicId(allocation.invoicePublicId, `${label}.invoicePublicId`),
    invoiceLinePublicId: allocation.invoiceLinePublicId == null
      ? null
      : publicId(allocation.invoiceLinePublicId, `${label}.invoiceLinePublicId`),
    amountMinor,
    invoiceDueBeforeMinor,
    invoiceDueAfterMinor,
    allocatedAtUtc,
    sourceEvidenceSha256: hash(allocation.sourceEvidenceSha256, `${label}.sourceEvidenceSha256`),
  };
}

function validateCommonMutation(mutation: Record<string, unknown>): asserts mutation is Record<string, unknown> & CanonicalSyncMutationBase {
  exact(mutation.kind, 'mutation.kind', 96);
  publicId(mutation.entityPublicId, 'mutation.entityPublicId');
}

function requestStatusForQuantity(fulfilledQuantity: number, requestedQuantity: number): string {
  if (fulfilledQuantity > requestedQuantity) {
    throw new CanonicalSyncBusinessPayloadError('mutation fulfilled quantity cannot exceed requested quantity');
  }
  if (fulfilledQuantity === requestedQuantity) return 'fulfilled';
  if (fulfilledQuantity > 0) return 'partially_fulfilled';
  return 'active';
}

function validateMutation(mutation: Record<string, unknown>): void {
  validateCommonMutation(mutation);
  switch (mutation.kind) {
    case 'encounter_started':
      validateEncounterStarted(mutation);
      return;
    case 'encounter_completed':
      exact(mutation.encounterType, 'mutation.encounterType', 32);
      utc(mutation.startedAtUtc, 'mutation.startedAtUtc');
      utc(mutation.completedAtUtc, 'mutation.completedAtUtc');
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      return;
    case 'encounter_cancelled':
      exact(mutation.encounterType, 'mutation.encounterType', 32);
      utc(mutation.startedAtUtc, 'mutation.startedAtUtc');
      utc(mutation.cancelledAtUtc, 'mutation.cancelledAtUtc');
      if (Date.parse(String(mutation.cancelledAtUtc)) < Date.parse(String(mutation.startedAtUtc))) {
        throw new CanonicalSyncBusinessPayloadError('mutation.cancelledAtUtc cannot precede mutation.startedAtUtc');
      }
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      return;
    case 'service_request_created':
      publicId(mutation.patientSyncKey, 'mutation.patientSyncKey');
      if (mutation.encounterPublicId != null) publicId(mutation.encounterPublicId, 'mutation.encounterPublicId');
      publicId(mutation.servicePublicId, 'mutation.servicePublicId');
      integer(mutation.requestedQuantity, 'mutation.requestedQuantity', { positive: true });
      utc(mutation.requestedAtUtc, 'mutation.requestedAtUtc');
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      return;
    case 'service_request_cancelled': {
      if (mutation.encounterPublicId != null) publicId(mutation.encounterPublicId, 'mutation.encounterPublicId');
      publicId(mutation.servicePublicId, 'mutation.servicePublicId');
      const requestedQuantity = integer(mutation.requestedQuantity, 'mutation.requestedQuantity', { positive: true });
      const fulfilledQuantity = integer(mutation.fulfilledQuantity, 'mutation.fulfilledQuantity');
      if (fulfilledQuantity >= requestedQuantity) {
        throw new CanonicalSyncBusinessPayloadError('mutation.fulfilledQuantity must remain below requestedQuantity for cancellation');
      }
      utc(mutation.requestedAtUtc, 'mutation.requestedAtUtc');
      utc(mutation.cancelledAtUtc, 'mutation.cancelledAtUtc');
      if (Date.parse(String(mutation.cancelledAtUtc)) < Date.parse(String(mutation.requestedAtUtc))) {
        throw new CanonicalSyncBusinessPayloadError('mutation.cancelledAtUtc cannot precede mutation.requestedAtUtc');
      }
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      return;
    }
    case 'service_event_recorded':
      publicId(mutation.requestPublicId, 'mutation.requestPublicId');
      if (mutation.encounterPublicId != null) publicId(mutation.encounterPublicId, 'mutation.encounterPublicId');
      publicId(mutation.servicePublicId, 'mutation.servicePublicId');
      exact(mutation.serviceEventType, 'mutation.serviceEventType', 32);
      integer(mutation.quantity, 'mutation.quantity', { positive: true });
      exact(mutation.requestStatusAfter, 'mutation.requestStatusAfter', 32);
      utc(mutation.occurredAtUtc, 'mutation.occurredAtUtc');
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      return;
    case 'service_event_cancelled': {
      publicId(mutation.requestPublicId, 'mutation.requestPublicId');
      if (mutation.encounterPublicId != null) publicId(mutation.encounterPublicId, 'mutation.encounterPublicId');
      publicId(mutation.servicePublicId, 'mutation.servicePublicId');
      const serviceEventType = exact(mutation.serviceEventType, 'mutation.serviceEventType', 32);
      if (!['accepted', 'delivered', 'completed', 'dispensed', 'occupied'].includes(serviceEventType)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.serviceEventType is unsupported');
      }
      const quantity = integer(mutation.quantity, 'mutation.quantity', { positive: true });
      const requestedQuantity = integer(mutation.requestedQuantity, 'mutation.requestedQuantity', { positive: true });
      const fulfilledBefore = integer(mutation.fulfilledQuantityBefore, 'mutation.fulfilledQuantityBefore');
      const fulfilledAfter = integer(mutation.fulfilledQuantityAfter, 'mutation.fulfilledQuantityAfter');
      const decrement = serviceEventType === 'accepted' ? 0 : quantity;
      if (fulfilledAfter !== fulfilledBefore - decrement) {
        throw new CanonicalSyncBusinessPayloadError('mutation service-event cancellation fulfillment balances do not reconcile');
      }
      const requestStatusBefore = exact(mutation.requestStatusBefore, 'mutation.requestStatusBefore', 32);
      const requestStatusAfter = exact(mutation.requestStatusAfter, 'mutation.requestStatusAfter', 32);
      if (
        requestStatusBefore !== requestStatusForQuantity(fulfilledBefore, requestedQuantity)
        || requestStatusAfter !== requestStatusForQuantity(fulfilledAfter, requestedQuantity)
      ) {
        throw new CanonicalSyncBusinessPayloadError('mutation service-event cancellation request statuses do not reconcile');
      }
      if (mutation.previousEventPublicId != null) {
        publicId(mutation.previousEventPublicId, 'mutation.previousEventPublicId');
      }
      utc(mutation.occurredAtUtc, 'mutation.occurredAtUtc');
      utc(mutation.cancelledAtUtc, 'mutation.cancelledAtUtc');
      if (Date.parse(String(mutation.cancelledAtUtc)) < Date.parse(String(mutation.occurredAtUtc))) {
        throw new CanonicalSyncBusinessPayloadError('mutation.cancelledAtUtc cannot precede mutation.occurredAtUtc');
      }
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      return;
    }
    case 'invoice_issued': {
      exact(mutation.invoiceNumber, 'mutation.invoiceNumber', 192);
      publicId(mutation.patientSyncKey, 'mutation.patientSyncKey');
      currency(mutation.currencyCode, 'mutation.currencyCode');
      const subtotalMinor = integer(mutation.subtotalMinor, 'mutation.subtotalMinor');
      const adjustmentTotalMinor = integer(
        mutation.adjustmentTotalMinor,
        'mutation.adjustmentTotalMinor',
        { signed: true },
      );
      const totalMinor = integer(mutation.totalMinor, 'mutation.totalMinor');
      if (totalMinor !== subtotalMinor + adjustmentTotalMinor) {
        throw new CanonicalSyncBusinessPayloadError('mutation invoice totals do not reconcile');
      }
      utc(mutation.issuedAtUtc, 'mutation.issuedAtUtc');
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      if (mutation.encounterLink != null) {
        const link = plainObject(mutation.encounterLink, 'mutation.encounterLink');
        publicId(link.encounterPublicId, 'mutation.encounterLink.encounterPublicId');
        exact(link.admissionNo, 'mutation.encounterLink.admissionNo', 192);
        if (link.linkType !== 'discharge_invoice') {
          throw new CanonicalSyncBusinessPayloadError('mutation.encounterLink.linkType is unsupported');
        }
        hash(link.sourceEvidenceSha256, 'mutation.encounterLink.sourceEvidenceSha256');
      }
      if (!Array.isArray(mutation.lines) || mutation.lines.length === 0) {
        throw new CanonicalSyncBusinessPayloadError('mutation.lines must contain at least one line');
      }
      const lines = mutation.lines.map(validateInvoiceLine);
      const ids = new Set(lines.map((line) => line.linePublicId));
      if (ids.size !== lines.length) {
        throw new CanonicalSyncBusinessPayloadError('mutation.lines contain duplicate line public IDs');
      }
      const serviceSubtotal = lines
        .filter((line) => line.lineType === 'service')
        .reduce((total, line) => total + line.lineAmountMinor, 0);
      const adjustments = lines
        .filter((line) => line.lineType !== 'service')
        .reduce((total, line) => total + line.lineAmountMinor, 0);
      if (serviceSubtotal !== subtotalMinor || adjustments !== adjustmentTotalMinor) {
        throw new CanonicalSyncBusinessPayloadError('mutation invoice lines do not reconcile to header totals');
      }
      return;
    }
    case 'invoice_cancelled': {
      integer(mutation.totalMinor, 'mutation.totalMinor');
      utc(mutation.cancelledAtUtc, 'mutation.cancelledAtUtc');
      if (!Array.isArray(mutation.compensationAdjustments)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.compensationAdjustments must be an array');
      }
      const adjustments = mutation.compensationAdjustments.map((value, index) => (
        validateCompensationAdjustment(value, `mutation.compensationAdjustments[${index}]`)
      ));
      const adjustmentIds = new Set(adjustments.map((adjustment) => adjustment.adjustmentPublicId));
      const accrualIds = new Set(adjustments.map((adjustment) => adjustment.accrualPublicId));
      if (adjustmentIds.size !== adjustments.length || accrualIds.size !== adjustments.length) {
        throw new CanonicalSyncBusinessPayloadError(
          'mutation.compensationAdjustments contain duplicate adjustment or accrual public IDs',
        );
      }
      if (adjustments.some((adjustment) => adjustment.occurredAtUtc !== mutation.cancelledAtUtc)) {
        throw new CanonicalSyncBusinessPayloadError(
          'mutation.compensationAdjustments must share the invoice cancellation timestamp',
        );
      }
      return;
    }
    case 'payment_receipt_recorded': {
      exact(mutation.receiptNumber, 'mutation.receiptNumber', 192);
      publicId(mutation.patientSyncKey, 'mutation.patientSyncKey');
      currency(mutation.currencyCode, 'mutation.currencyCode');
      const totalMinor = integer(mutation.totalMinor, 'mutation.totalMinor', { positive: true });
      const allocatedTotalMinor = integer(mutation.allocatedTotalMinor, 'mutation.allocatedTotalMinor');
      const unallocatedMinor = integer(mutation.unallocatedMinor, 'mutation.unallocatedMinor');
      if (totalMinor !== allocatedTotalMinor + unallocatedMinor) {
        throw new CanonicalSyncBusinessPayloadError('payment receipt totals do not reconcile');
      }
      const status = exact(mutation.status, 'mutation.status', 32) as PaymentReceiptRecordedMutation['status'];
      if (!['pending', 'posted', 'failed'].includes(status)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.status is unsupported');
      }
      const receivedAtUtc = utc(mutation.receivedAtUtc, 'mutation.receivedAtUtc');
      const businessDateValue = exact(mutation.businessDate, 'mutation.businessDate', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDateValue)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.businessDate must use YYYY-MM-DD');
      }
      const postedAtUtc = mutation.postedAtUtc == null ? null : utc(mutation.postedAtUtc, 'mutation.postedAtUtc');
      const failedAtUtc = mutation.failedAtUtc == null ? null : utc(mutation.failedAtUtc, 'mutation.failedAtUtc');
      if (
        (status === 'posted' && (postedAtUtc !== receivedAtUtc || failedAtUtc !== null))
        || (status === 'failed' && (failedAtUtc !== receivedAtUtc || postedAtUtc !== null))
        || (status === 'pending' && (postedAtUtc !== null || failedAtUtc !== null))
      ) {
        throw new CanonicalSyncBusinessPayloadError('payment receipt timestamps do not match status');
      }
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      if (!Array.isArray(mutation.tenders) || mutation.tenders.length === 0 || !Array.isArray(mutation.allocations)) {
        throw new CanonicalSyncBusinessPayloadError('payment mutation must contain tenders and an allocations array');
      }
      const tenders = mutation.tenders.map((value, index) => (
        validatePaymentTender(value, index, status, receivedAtUtc)
      ));
      const allocations = mutation.allocations.map((value, index) => (
        validatePaymentAllocation(value, index, receivedAtUtc)
      ));
      if (new Set(tenders.map((tender) => tender.tenderPublicId)).size !== tenders.length) {
        throw new CanonicalSyncBusinessPayloadError('payment mutation contains duplicate tender public IDs');
      }
      if (new Set(allocations.map((allocation) => allocation.allocationPublicId)).size !== allocations.length) {
        throw new CanonicalSyncBusinessPayloadError('payment mutation contains duplicate allocation public IDs');
      }
      const tenderTotal = tenders.reduce((total, tender) => total + tender.amountMinor, 0);
      const allocationTotal = allocations.reduce((total, allocation) => total + allocation.amountMinor, 0);
      if (!Number.isSafeInteger(tenderTotal) || tenderTotal !== totalMinor || allocationTotal !== allocatedTotalMinor) {
        throw new CanonicalSyncBusinessPayloadError('payment tenders or allocations do not reconcile to the receipt');
      }
      if (status !== 'posted' && (allocations.length !== 0 || allocatedTotalMinor !== 0 || unallocatedMinor !== totalMinor)) {
        throw new CanonicalSyncBusinessPayloadError('pending or failed payment receipt cannot contain allocations');
      }
      return;
    }
    case 'payment_reversed': {
      for (const field of ['reversalPublicId', 'refundPublicId', 'receiptPublicId', 'tenderPublicId', 'allocationPublicId', 'invoicePublicId']) {
        publicId(mutation[field], `mutation.${field}`);
      }
      const amountMinor = integer(mutation.amountMinor, 'mutation.amountMinor', { positive: true });
      exact(mutation.reasonCode, 'mutation.reasonCode', 128);
      const tenderType = exact(mutation.tenderType, 'mutation.tenderType', 32);
      if (!['cash', 'card', 'mobile_wallet', 'bank_transfer', 'gateway', 'other'].includes(tenderType)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.tenderType is unsupported');
      }
      exact(mutation.methodCode, 'mutation.methodCode', 128);
      utc(mutation.reversedAtUtc, 'mutation.reversedAtUtc');
      const businessDateValue = exact(mutation.businessDate, 'mutation.businessDate', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDateValue)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.businessDate must use YYYY-MM-DD');
      }
      const allocationBefore = integer(mutation.allocationReversedBeforeMinor, 'mutation.allocationReversedBeforeMinor');
      const allocationAfter = integer(mutation.allocationReversedAfterMinor, 'mutation.allocationReversedAfterMinor');
      const tenderBefore = integer(mutation.tenderReversedBeforeMinor, 'mutation.tenderReversedBeforeMinor');
      const tenderAfter = integer(mutation.tenderReversedAfterMinor, 'mutation.tenderReversedAfterMinor');
      const receiptBefore = integer(mutation.receiptRefundedBeforeMinor, 'mutation.receiptRefundedBeforeMinor');
      const receiptAfter = integer(mutation.receiptRefundedAfterMinor, 'mutation.receiptRefundedAfterMinor');
      const invoicePaidBefore = integer(mutation.invoicePaidBeforeMinor, 'mutation.invoicePaidBeforeMinor');
      const invoicePaidAfter = integer(mutation.invoicePaidAfterMinor, 'mutation.invoicePaidAfterMinor');
      const invoiceDueBefore = integer(mutation.invoiceDueBeforeMinor, 'mutation.invoiceDueBeforeMinor');
      const invoiceDueAfter = integer(mutation.invoiceDueAfterMinor, 'mutation.invoiceDueAfterMinor');
      const invoiceNetDueBefore = integer(mutation.invoiceNetDueBeforeMinor, 'mutation.invoiceNetDueBeforeMinor');
      const invoiceNetDueAfter = integer(mutation.invoiceNetDueAfterMinor, 'mutation.invoiceNetDueAfterMinor');
      if (
        allocationAfter !== allocationBefore + amountMinor
        || tenderAfter !== tenderBefore + amountMinor
        || receiptAfter !== receiptBefore + amountMinor
        || invoicePaidBefore < amountMinor
        || invoicePaidAfter !== invoicePaidBefore - amountMinor
        || invoiceDueAfter !== invoiceDueBefore + amountMinor
        || invoiceNetDueAfter !== invoiceNetDueBefore + amountMinor
      ) {
        throw new CanonicalSyncBusinessPayloadError('payment reversal balances do not reconcile');
      }
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      hash(mutation.refundSourceEvidenceSha256, 'mutation.refundSourceEvidenceSha256');
      return;
    }
    case 'deposit_recorded': {
      exact(mutation.depositNumber, 'mutation.depositNumber', 192);
      publicId(mutation.receiptPublicId, 'mutation.receiptPublicId');
      publicId(mutation.patientSyncKey, 'mutation.patientSyncKey');
      currency(mutation.currencyCode, 'mutation.currencyCode');
      integer(mutation.amountMinor, 'mutation.amountMinor', { positive: true });
      const receivedAtUtc = utc(mutation.receivedAtUtc, 'mutation.receivedAtUtc');
      const postedAtUtc = utc(mutation.postedAtUtc, 'mutation.postedAtUtc');
      if (postedAtUtc !== receivedAtUtc) {
        throw new CanonicalSyncBusinessPayloadError('deposit postedAtUtc must match receivedAtUtc');
      }
      const businessDateValue = exact(mutation.businessDate, 'mutation.businessDate', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDateValue)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.businessDate must use YYYY-MM-DD');
      }
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      return;
    }
    case 'deposit_applied': {
      publicId(mutation.applicationPublicId, 'mutation.applicationPublicId');
      publicId(mutation.invoicePublicId, 'mutation.invoicePublicId');
      if (mutation.invoiceLinePublicId != null) {
        publicId(mutation.invoiceLinePublicId, 'mutation.invoiceLinePublicId');
      }
      const amountMinor = integer(mutation.amountMinor, 'mutation.amountMinor', { positive: true });
      const depositAvailableBeforeMinor = integer(
        mutation.depositAvailableBeforeMinor,
        'mutation.depositAvailableBeforeMinor',
      );
      const depositAvailableAfterMinor = integer(
        mutation.depositAvailableAfterMinor,
        'mutation.depositAvailableAfterMinor',
      );
      const invoicePaidBeforeMinor = integer(mutation.invoicePaidBeforeMinor, 'mutation.invoicePaidBeforeMinor');
      const invoicePaidAfterMinor = integer(mutation.invoicePaidAfterMinor, 'mutation.invoicePaidAfterMinor');
      const invoiceDueBeforeMinor = integer(mutation.invoiceDueBeforeMinor, 'mutation.invoiceDueBeforeMinor');
      const invoiceDueAfterMinor = integer(mutation.invoiceDueAfterMinor, 'mutation.invoiceDueAfterMinor');
      const invoiceNetDueBeforeMinor = integer(
        mutation.invoiceNetDueBeforeMinor,
        'mutation.invoiceNetDueBeforeMinor',
      );
      const invoiceNetDueAfterMinor = integer(
        mutation.invoiceNetDueAfterMinor,
        'mutation.invoiceNetDueAfterMinor',
      );
      if (
        depositAvailableBeforeMinor < amountMinor
        || depositAvailableAfterMinor !== depositAvailableBeforeMinor - amountMinor
        || invoicePaidAfterMinor !== invoicePaidBeforeMinor + amountMinor
        || invoiceDueBeforeMinor < amountMinor
        || invoiceDueAfterMinor !== invoiceDueBeforeMinor - amountMinor
        || invoiceNetDueBeforeMinor < amountMinor
        || invoiceNetDueAfterMinor !== invoiceNetDueBeforeMinor - amountMinor
      ) {
        throw new CanonicalSyncBusinessPayloadError('deposit application balances do not reconcile');
      }
      utc(mutation.appliedAtUtc, 'mutation.appliedAtUtc');
      const businessDateValue = exact(mutation.businessDate, 'mutation.businessDate', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDateValue)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.businessDate must use YYYY-MM-DD');
      }
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      return;
    }
    case 'deposit_refunded': {
      publicId(mutation.refundPublicId, 'mutation.refundPublicId');
      const amountMinor = integer(mutation.amountMinor, 'mutation.amountMinor', { positive: true });
      const tenderType = exact(mutation.tenderType, 'mutation.tenderType', 32);
      if (!['cash', 'card', 'mobile_wallet', 'bank_transfer', 'gateway', 'other'].includes(tenderType)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.tenderType is unsupported');
      }
      exact(mutation.methodCode, 'mutation.methodCode', 128);
      utc(mutation.refundedAtUtc, 'mutation.refundedAtUtc');
      const businessDateValue = exact(mutation.businessDate, 'mutation.businessDate', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDateValue)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.businessDate must use YYYY-MM-DD');
      }
      const availableBefore = integer(mutation.depositAvailableBeforeMinor, 'mutation.depositAvailableBeforeMinor');
      const availableAfter = integer(mutation.depositAvailableAfterMinor, 'mutation.depositAvailableAfterMinor');
      const refundedBefore = integer(mutation.depositRefundedBeforeMinor, 'mutation.depositRefundedBeforeMinor');
      const refundedAfter = integer(mutation.depositRefundedAfterMinor, 'mutation.depositRefundedAfterMinor');
      if (
        availableBefore < amountMinor
        || availableAfter !== availableBefore - amountMinor
        || refundedAfter !== refundedBefore + amountMinor
      ) {
        throw new CanonicalSyncBusinessPayloadError('deposit refund balances do not reconcile');
      }
      hash(mutation.depositSourceEvidenceSha256, 'mutation.depositSourceEvidenceSha256');
      hash(mutation.refundSourceEvidenceSha256, 'mutation.refundSourceEvidenceSha256');
      return;
    }
    case 'compensation_accrued': {
      publicId(mutation.invoicePublicId, 'mutation.invoicePublicId');
      publicId(mutation.invoiceLinePublicId, 'mutation.invoiceLinePublicId');
      if (mutation.serviceEventPublicId != null) publicId(mutation.serviceEventPublicId, 'mutation.serviceEventPublicId');
      if (mutation.practitionerPublicId != null) publicId(mutation.practitionerPublicId, 'mutation.practitionerPublicId');
      const practitionerRole = exact(mutation.practitionerRole, 'mutation.practitionerRole', 32);
      if (!['performing', 'referring', 'prescribing', 'treating', 'reporting'].includes(practitionerRole)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.practitionerRole is unsupported');
      }
      const accrualStage = exact(mutation.accrualStage, 'mutation.accrualStage', 32);
      if (!['performer_reserve', 'commission', 'professional_fee'].includes(accrualStage)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.accrualStage is unsupported');
      }
      publicId(mutation.rulePublicId, 'mutation.rulePublicId');
      integer(mutation.ruleVersion, 'mutation.ruleVersion', { positive: true });
      const calculationBasis = exact(mutation.calculationBasis, 'mutation.calculationBasis', 48);
      if (!['gross', 'net_after_discount', 'remaining_after_performer', 'collected'].includes(calculationBasis)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.calculationBasis is unsupported');
      }
      const rateType = exact(mutation.rateType, 'mutation.rateType', 32);
      if (!['fixed', 'basis_points'].includes(rateType)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.rateType is unsupported');
      }
      const rateValue = integer(mutation.rateValue, 'mutation.rateValue');
      if (rateType === 'basis_points' && rateValue > 10000) {
        throw new CanonicalSyncBusinessPayloadError('mutation.rateValue exceeds 10000 basis points');
      }
      currency(mutation.currencyCode, 'mutation.currencyCode');
      const grossMinor = integer(mutation.grossMinor, 'mutation.grossMinor');
      const discountMinor = integer(mutation.discountMinor, 'mutation.discountMinor');
      integer(mutation.taxMinor, 'mutation.taxMinor');
      const performerReserveMinor = integer(mutation.performerReserveMinor, 'mutation.performerReserveMinor');
      integer(mutation.eligibleBaseMinor, 'mutation.eligibleBaseMinor');
      const earnedMinor = integer(mutation.earnedMinor, 'mutation.earnedMinor');
      if (discountMinor > grossMinor || performerReserveMinor > grossMinor) {
        throw new CanonicalSyncBusinessPayloadError('compensation source amounts exceed gross amount');
      }
      const initialStatus = exact(mutation.initialStatus, 'mutation.initialStatus', 32);
      if (
        (mutation.practitionerPublicId == null && initialStatus !== 'unassigned')
        || (mutation.practitionerPublicId != null && initialStatus !== 'accrued')
        || (initialStatus === 'accrued' && earnedMinor <= 0)
      ) {
        throw new CanonicalSyncBusinessPayloadError('compensation initial status does not match practitioner and earned amount');
      }
      utc(mutation.accruedAtUtc, 'mutation.accruedAtUtc');
      const businessDateValue = exact(mutation.businessDate, 'mutation.businessDate', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDateValue)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.businessDate must use YYYY-MM-DD');
      }
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      return;
    }
    case 'compensation_adjusted': {
      const adjustment = plainObject(mutation.adjustment, 'mutation.adjustment');
      publicId(adjustment.adjustmentPublicId, 'mutation.adjustment.adjustmentPublicId');
      publicId(adjustment.accrualPublicId, 'mutation.adjustment.accrualPublicId');
      const adjustmentType = exact(adjustment.adjustmentType, 'mutation.adjustment.adjustmentType', 64);
      if (!['credit', 'refund', 'service_cancellation', 'manual_recovery'].includes(adjustmentType)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.adjustment.adjustmentType is unsupported');
      }
      exact(adjustment.reasonCode, 'mutation.adjustment.reasonCode', 128);
      const amountMinor = integer(adjustment.amountMinor, 'mutation.adjustment.amountMinor', { positive: true });
      const adjustedBefore = integer(adjustment.adjustedBeforeMinor, 'mutation.adjustment.adjustedBeforeMinor');
      const adjustedAfter = integer(adjustment.adjustedAfterMinor, 'mutation.adjustment.adjustedAfterMinor');
      const settledBefore = integer(adjustment.settledBeforeMinor, 'mutation.adjustment.settledBeforeMinor');
      const settledAfter = integer(adjustment.settledAfterMinor, 'mutation.adjustment.settledAfterMinor');
      const payableBefore = integer(adjustment.payableBeforeMinor, 'mutation.adjustment.payableBeforeMinor');
      const payableAfter = integer(adjustment.payableAfterMinor, 'mutation.adjustment.payableAfterMinor');
      if (
        adjustedAfter !== adjustedBefore + amountMinor
        || settledAfter !== settledBefore
        || payableBefore < amountMinor
        || payableAfter !== payableBefore - amountMinor
      ) {
        throw new CanonicalSyncBusinessPayloadError('compensation adjustment balances do not reconcile');
      }
      const statusBefore = exact(adjustment.statusBefore, 'mutation.adjustment.statusBefore', 32);
      const statusAfter = exact(adjustment.statusAfter, 'mutation.adjustment.statusAfter', 32);
      if (
        !['unassigned', 'accrued', 'partially_settled'].includes(statusBefore)
        || (payableAfter === 0 && settledAfter === 0 ? statusAfter !== 'reversed' : statusAfter !== statusBefore)
      ) {
        throw new CanonicalSyncBusinessPayloadError('compensation adjustment status transition is unsupported');
      }
      utc(adjustment.occurredAtUtc, 'mutation.adjustment.occurredAtUtc');
      const businessDateValue = exact(adjustment.businessDate, 'mutation.adjustment.businessDate', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDateValue)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.adjustment.businessDate must use YYYY-MM-DD');
      }
      hash(adjustment.sourceEvidenceSha256, 'mutation.adjustment.sourceEvidenceSha256');
      return;
    }
    case 'inventory_movement_recorded': {
      publicId(mutation.itemPublicId, 'mutation.itemPublicId');
      publicId(mutation.locationPublicId, 'mutation.locationPublicId');
      publicId(mutation.lotPublicId, 'mutation.lotPublicId');
      const movementType = exact(mutation.movementType, 'mutation.movementType', 64);
      const inboundTypes = ['migration_opening', 'purchase_receipt', 'transfer_in', 'patient_return', 'adjustment_in', 'reversal_in'];
      const outboundTypes = ['transfer_out', 'issue', 'dispense', 'sale', 'supplier_return', 'waste', 'expiry', 'adjustment_out', 'reversal_out'];
      if (![...inboundTypes, ...outboundTypes].includes(movementType)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.movementType is unsupported');
      }
      const direction = exact(mutation.direction, 'mutation.direction', 8);
      const expectedDirection = inboundTypes.includes(movementType) ? 'in' : 'out';
      if (direction !== expectedDirection) {
        throw new CanonicalSyncBusinessPayloadError('inventory movement direction does not match movement type');
      }
      const sourceQuantity = integer(mutation.sourceQuantity, 'mutation.sourceQuantity', { positive: true });
      exact(mutation.sourceUnitCode, 'mutation.sourceUnitCode', 64);
      const numerator = integer(mutation.conversionNumerator, 'mutation.conversionNumerator', { positive: true });
      const denominator = integer(mutation.conversionDenominator, 'mutation.conversionDenominator', { positive: true });
      if (sourceQuantity > Math.floor(Number.MAX_SAFE_INTEGER / numerator)) {
        throw new CanonicalSyncBusinessPayloadError('inventory conversion exceeds safe integer range');
      }
      const product = sourceQuantity * numerator;
      if (product % denominator !== 0) {
        throw new CanonicalSyncBusinessPayloadError('inventory conversion must produce an integral base quantity');
      }
      const quantityBase = integer(mutation.quantityBase, 'mutation.quantityBase', { positive: true });
      if (quantityBase !== product / denominator) {
        throw new CanonicalSyncBusinessPayloadError('inventory base quantity does not match conversion');
      }
      const signedQuantityBase = integer(mutation.signedQuantityBase, 'mutation.signedQuantityBase', { signed: true });
      const expectedSigned = direction === 'in' ? quantityBase : -quantityBase;
      const balanceBefore = integer(mutation.balanceBeforeBase, 'mutation.balanceBeforeBase', { signed: true });
      const balanceAfter = integer(mutation.balanceAfterBase, 'mutation.balanceAfterBase', { signed: true });
      if (signedQuantityBase !== expectedSigned || balanceAfter !== balanceBefore + signedQuantityBase) {
        throw new CanonicalSyncBusinessPayloadError('inventory signed quantity or balance delta does not reconcile');
      }
      const versionBefore = integer(mutation.balanceVersionBefore, 'mutation.balanceVersionBefore');
      const versionAfter = integer(mutation.balanceVersionAfter, 'mutation.balanceVersionAfter', { positive: true });
      if (versionAfter !== versionBefore + 1) {
        throw new CanonicalSyncBusinessPayloadError('inventory balance version must advance by one');
      }
      const transferPublicId = mutation.transferPublicId == null ? null : publicId(mutation.transferPublicId, 'mutation.transferPublicId');
      if ((movementType === 'transfer_in' || movementType === 'transfer_out') !== (transferPublicId != null)) {
        throw new CanonicalSyncBusinessPayloadError('inventory transfer identity does not match movement type');
      }
      if (mutation.serviceEventPublicId != null) publicId(mutation.serviceEventPublicId, 'mutation.serviceEventPublicId');
      if (mutation.invoicePublicId != null) publicId(mutation.invoicePublicId, 'mutation.invoicePublicId');
      if (mutation.invoiceLinePublicId != null) publicId(mutation.invoiceLinePublicId, 'mutation.invoiceLinePublicId');
      if ((mutation.invoicePublicId == null) !== (mutation.invoiceLinePublicId == null)) {
        throw new CanonicalSyncBusinessPayloadError('inventory invoice and line identities must be provided together');
      }
      if (mutation.reversalOfMovementPublicId != null) {
        publicId(mutation.reversalOfMovementPublicId, 'mutation.reversalOfMovementPublicId');
      }
      for (const field of ['sourceType', 'sourcePublicId', 'sourceLinePublicId', 'sourceTable']) {
        exact(mutation[field], `mutation.${field}`, 192);
      }
      utc(mutation.occurredAtUtc, 'mutation.occurredAtUtc');
      const businessDateValue = exact(mutation.businessDate, 'mutation.businessDate', 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDateValue)) {
        throw new CanonicalSyncBusinessPayloadError('mutation.businessDate must use YYYY-MM-DD');
      }
      hash(mutation.sourceEvidenceSha256, 'mutation.sourceEvidenceSha256');
      return;
    }
    default:
      throw new CanonicalSyncBusinessPayloadError(`Unsupported canonical sync mutation kind: ${String(mutation.kind)}`);
  }
}

export function createCanonicalSyncBusinessPayload(input: {
  event: Record<string, unknown>;
  mutation: CanonicalSyncMutationV1 | Record<string, unknown>;
}): CanonicalSyncBusinessPayloadV1 {
  const event = plainObject(input.event, 'event');
  const mutation = plainObject(input.mutation, 'mutation') as unknown as CanonicalSyncMutationV1;
  return { schemaVersion: 1, event, mutation };
}

export function parseCanonicalSyncBusinessPayload(
  envelope: CanonicalSyncEnvelope,
): CanonicalSyncBusinessPayloadV1 {
  const payload = plainObject(envelope.payload, 'Canonical sync business payload');
  if (payload.schemaVersion !== 1) {
    throw new CanonicalSyncBusinessPayloadError('Canonical sync business payload schemaVersion must be 1');
  }
  const event = plainObject(payload.event, 'Canonical sync business payload event');
  const mutation = plainObject(payload.mutation, 'Canonical sync business payload mutation');
  validateCommonMutation(mutation);

  const contract = CONTRACTS.get(`${envelope.entityType}\u0000${envelope.eventType}`);
  if (!contract) {
    throw new CanonicalSyncBusinessPayloadError(
      `Unsupported canonical sync business event: ${envelope.entityType}/${envelope.eventType}`,
    );
  }
  if (envelope.operation !== contract.operation) {
    throw new CanonicalSyncBusinessPayloadError(
      `Canonical sync operation mismatch for ${envelope.eventType}: expected ${contract.operation}`,
    );
  }
  if (mutation.kind !== contract.kind) {
    throw new CanonicalSyncBusinessPayloadError(
      `Canonical sync mutation kind mismatch for ${envelope.eventType}: expected ${contract.kind}`,
    );
  }
  if (mutation.entityPublicId !== envelope.entityPublicId) {
    throw new CanonicalSyncBusinessPayloadError(
      `Canonical sync mutation entity identity mismatch for ${envelope.entityPublicId}`,
    );
  }
  validateMutation(mutation);

  return {
    schemaVersion: 1,
    event,
    mutation: mutation as unknown as CanonicalSyncMutationV1,
  };
}

export const CANONICAL_SYNC_BUSINESS_CONTRACTS = Object.freeze(
  [...CONTRACTS.entries()].map(([key, value]) => {
    const [entityType, eventType] = key.split('\u0000');
    return { entityType, eventType, ...value };
  }),
);
