import type { CanonicalBatchDatabase } from './command-batch';
import type {
  CanonicalSyncMutationV1,
  EncounterCancelledMutation,
  EncounterCompletedMutation,
  EncounterStartedMutation,
  CompensationAdjustmentMutation,
  InvoiceCancelledMutation,
  InvoiceIssuedMutation,
  InvoiceLineMutation,
  PaymentReceiptRecordedMutation,
  PaymentReversedMutation,
  PaymentTenderMutation,
  PaymentAllocationMutation,
  DepositRecordedMutation,
  DepositAppliedMutation,
  DepositRefundedMutation,
  CompensationAccruedMutation,
  CompensationAdjustedMutation,
  InventoryMovementRecordedMutation,
  ServiceEventCancelledMutation,
  ServiceEventRecordedMutation,
  ServiceRequestCancelledMutation,
  ServiceRequestCreatedMutation,
} from './local-sync-business-payload';

export interface CanonicalSyncBusinessProjectionInput {
  tenantId: string;
  entityType: string;
  entityPublicId: string;
  eventType: string;
  occurredAtUtc: string;
  businessDate?: string | null;
  event: Record<string, unknown>;
}

interface PatientSyncRow {
  sync_key: string | null;
}

interface EncounterSourceRow {
  legacy_patient_id: number;
  encounter_type: EncounterStartedMutation['encounterType'];
  status: string;
  started_at_utc: string;
  ended_at_utc: string | null;
  source_evidence_sha256: string;
}

interface ServiceRequestSourceRow {
  legacy_patient_id: number;
  encounter_public_id: string | null;
  service_public_id: string;
  requested_quantity: number;
  fulfilled_quantity: number;
  status: string;
  requested_at_utc: string;
  cancelled_at_utc: string | null;
  source_evidence_sha256: string;
}

interface ServiceEventSourceRow {
  request_public_id: string | null;
  encounter_public_id: string | null;
  service_public_id: string;
  event_type: ServiceEventRecordedMutation['serviceEventType'];
  quantity: number;
  status: string;
  occurred_at_utc: string;
  cancelled_at_utc: string | null;
  source_evidence_sha256: string;
}

interface ServiceEventRequestAuthorityRow {
  encounter_public_id: string | null;
  service_public_id: string;
  requested_quantity: number;
  fulfilled_quantity: number;
  last_event_public_id: string | null;
  status: ServiceEventRecordedMutation['requestStatusAfter'];
  cancelled_at_utc: string | null;
}

interface InvoiceSourceRow {
  invoice_number: string;
  legacy_patient_id: number;
  currency_code: string;
  subtotal_minor: number;
  adjustment_total_minor: number;
  total_minor: number;
  issued_at_utc: string;
  source_evidence_sha256: string;
}

interface InvoiceLineSourceRow {
  line_public_id: string;
  line_type: InvoiceLineMutation['lineType'];
  service_event_public_id: string | null;
  adjustment_code: string | null;
  quantity: number;
  unit_amount_minor: number;
  line_amount_minor: number;
  source_evidence_sha256: string;
}

interface InvoiceEncounterLinkSourceRow {
  encounter_public_id: string;
  admission_no: string | null;
  link_type: 'discharge_invoice';
  source_evidence_sha256: string;
}

interface InvoiceCancellationSourceRow {
  total_minor: number;
  status: string;
  cancelled_at_utc: string | null;
}

interface CompensationCancellationSourceRow {
  adjustment_public_id: string;
  accrual_public_id: string;
  practitioner_public_id: string | null;
  adjustment_type: string;
  reason_code: string;
  amount_minor: number;
  accrual_adjusted_before_minor: number;
  accrual_adjusted_after_minor: number;
  accrual_settled_before_minor: number;
  accrual_settled_after_minor: number;
  accrual_payable_before_minor: number;
  accrual_payable_after_minor: number;
  occurred_at_utc: string;
  business_date: string;
  source_evidence_sha256: string;
}

interface PaymentReceiptSourceRow {
  receipt_number: string;
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  allocated_total_minor: number;
  unallocated_minor: number;
  received_at_utc: string;
  business_date: string;
  external_transaction_id: string | null;
  posted_at_utc: string | null;
  failed_at_utc: string | null;
  source_evidence_sha256: string;
}

interface PaymentTenderSourceRow {
  tender_public_id: string;
  tender_type: PaymentTenderMutation['tenderType'];
  method_code: string;
  amount_minor: number;
  external_transaction_id: string | null;
  captured_at_utc: string | null;
  failed_at_utc: string | null;
  source_evidence_sha256: string;
}

interface PaymentAllocationSourceRow {
  allocation_public_id: string;
  invoice_public_id: string;
  invoice_line_public_id: string | null;
  amount_minor: number;
  invoice_due_before_minor: number;
  invoice_due_after_minor: number;
  allocated_at_utc: string;
  source_evidence_sha256: string;
}

interface PaymentReversalSourceRow {
  reversal_public_id: string;
  receipt_public_id: string;
  tender_public_id: string;
  allocation_public_id: string;
  invoice_public_id: string;
  amount_minor: number;
  reason_code: string;
  status: string;
  reversed_at_utc: string;
  business_date: string;
  allocation_reversed_before_minor: number;
  allocation_reversed_after_minor: number;
  tender_reversed_before_minor: number;
  tender_reversed_after_minor: number;
  receipt_refunded_before_minor: number;
  receipt_refunded_after_minor: number;
  invoice_paid_before_minor: number;
  invoice_paid_after_minor: number;
  invoice_due_before_minor: number;
  invoice_due_after_minor: number;
  invoice_net_due_before_minor: number;
  invoice_net_due_after_minor: number;
  compensation_guard: number;
  balance_guard: number;
  source_evidence_sha256: string;
}

interface PaymentRefundSourceRow {
  refund_public_id: string;
  source_type: string;
  receipt_public_id: string | null;
  tender_public_id: string | null;
  allocation_public_id: string | null;
  payment_reversal_public_id: string | null;
  amount_minor: number;
  tender_type: PaymentTenderMutation['tenderType'];
  method_code: string;
  status: string;
  refunded_at_utc: string;
  business_date: string;
  reversed_at_utc: string | null;
  liability_guard: number;
  source_evidence_sha256: string;
}

interface DepositSourceRow {
  deposit_number: string;
  receipt_public_id: string;
  legacy_patient_id: number;
  currency_code: string;
  amount_minor: number;
  applied_minor: number;
  refunded_minor: number;
  available_minor: number;
  status: string;
  received_at_utc: string;
  business_date: string;
  posted_at_utc: string;
  source_evidence_sha256: string;
}

interface DepositRefundSourceRow {
  id: number;
  refund_public_id: string;
  deposit_public_id: string | null;
  source_type: string;
  amount_minor: number;
  tender_type: PaymentTenderMutation['tenderType'];
  method_code: string;
  status: string;
  refunded_at_utc: string;
  business_date: string;
  reversed_at_utc: string | null;
  source_available_before_minor: number | null;
  source_available_after_minor: number | null;
  liability_guard: number;
  source_evidence_sha256: string;
}

interface SumRow {
  total_minor: number;
}

interface DepositApplicationSourceRow {
  application_public_id: string;
  deposit_public_id: string;
  invoice_public_id: string;
  invoice_line_public_id: string | null;
  amount_minor: number;
  deposit_available_before_minor: number;
  deposit_available_after_minor: number;
  invoice_paid_before_minor: number;
  invoice_paid_after_minor: number;
  invoice_due_before_minor: number;
  invoice_due_after_minor: number;
  invoice_net_due_before_minor: number;
  invoice_net_due_after_minor: number;
  applied_at_utc: string;
  source_evidence_sha256: string;
}

interface CompensationAccrualSourceRow {
  invoice_public_id: string;
  invoice_line_public_id: string;
  service_event_public_id: string | null;
  practitioner_public_id: string | null;
  practitioner_role: CompensationAccruedMutation['practitionerRole'];
  accrual_stage: CompensationAccruedMutation['accrualStage'];
  rule_public_id: string;
  rule_version: number;
  calculation_basis: CompensationAccruedMutation['calculationBasis'];
  rate_type: CompensationAccruedMutation['rateType'];
  rate_value: number;
  currency_code: string;
  gross_minor: number;
  discount_minor: number;
  tax_minor: number;
  performer_reserve_minor: number;
  eligible_base_minor: number;
  earned_minor: number;
  accrued_at_utc: string;
  business_date: string;
  source_evidence_sha256: string;
}

interface CompensationAdjustmentSourceRow {
  adjustment_public_id: string;
  accrual_public_id: string;
  settlement_public_id: string | null;
  settlement_allocation_public_id: string | null;
  adjustment_type: string;
  reason_code: string;
  amount_minor: number;
  accrual_adjusted_before_minor: number;
  accrual_adjusted_after_minor: number;
  accrual_settled_before_minor: number;
  accrual_settled_after_minor: number;
  accrual_payable_before_minor: number;
  accrual_payable_after_minor: number;
  occurred_at_utc: string;
  business_date: string;
  balance_guard: number;
  source_evidence_sha256: string;
  practitioner_public_id: string | null;
}

interface InventoryMovementSourceRow {
  id: number;
  movement_public_id: string;
  item_public_id: string;
  location_public_id: string;
  lot_public_id: string;
  movement_type: string;
  direction: InventoryMovementRecordedMutation['direction'];
  source_quantity: number;
  source_unit_code: string;
  conversion_numerator: number;
  conversion_denominator: number;
  quantity_base: number;
  signed_quantity_base: number;
  balance_before_base: number;
  balance_after_base: number;
  transfer_public_id: string | null;
  service_event_public_id: string | null;
  invoice_public_id: string | null;
  invoice_line_public_id: string | null;
  reversal_of_movement_public_id: string | null;
  source_type: string;
  source_public_id: string;
  source_line_public_id: string;
  source_table: string;
  status: string;
  occurred_at_utc: string;
  business_date: string;
  balance_guard: number;
  source_evidence_sha256: string;
}

export class CanonicalSyncBusinessProjectionError extends Error {
  readonly code = 'CANONICAL_SYNC_BUSINESS_PROJECTION';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CanonicalSyncBusinessProjectionError';
  }
}

const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function exact(value: unknown, label: string, maxLength = 256): string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > maxLength
  ) {
    throw new CanonicalSyncBusinessProjectionError(
      `${label} must be non-empty without surrounding whitespace and at most ${maxLength} characters`,
    );
  }
  return value;
}

function publicId(value: unknown, label: string): string {
  const result = exact(value, label, 192);
  if (/^\d+$/.test(result)) {
    throw new CanonicalSyncBusinessProjectionError(`${label} must be a stable public identity`);
  }
  return result;
}

function utc(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UTC_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new CanonicalSyncBusinessProjectionError(`${label} must be a normalized UTC timestamp`);
  }
  return value;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new CanonicalSyncBusinessProjectionError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new CanonicalSyncBusinessProjectionError(`${label} must be a positive safe integer`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new CanonicalSyncBusinessProjectionError(`${label} must be a non-negative safe integer`);
  }
  return Number(value);
}

function eventString(event: Record<string, unknown>, field: string): string {
  return exact(event[field], `event.${field}`);
}

function eventInteger(event: Record<string, unknown>, field: string): number {
  return positiveInteger(event[field], `event.${field}`);
}

function assertEventValue(
  event: Record<string, unknown>,
  field: string,
  expected: string | number | null,
): void {
  if (event[field] !== expected) {
    throw new CanonicalSyncBusinessProjectionError(
      `Canonical sync event payload ${field} does not match immutable source authority`,
    );
  }
}

async function resolvePatientSyncKey(
  db: CanonicalBatchDatabase,
  tenantId: string,
  legacyPatientId: number,
): Promise<string> {
  if (!Number.isSafeInteger(legacyPatientId) || legacyPatientId <= 0) {
    throw new CanonicalSyncBusinessProjectionError('Canonical source patient ID is invalid');
  }
  const row = await db.prepare(`
    SELECT sync_key
    FROM patients
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `).bind(tenantId, legacyPatientId).first<PatientSyncRow>();
  if (!row?.sync_key) {
    throw new CanonicalSyncBusinessProjectionError(
      `Canonical source patient sync identity is missing for ${tenantId}/${legacyPatientId}`,
    );
  }
  return publicId(row.sync_key, 'patient sync identity');
}

async function projectEncounter(
  db: CanonicalBatchDatabase,
  input: CanonicalSyncBusinessProjectionInput,
): Promise<EncounterStartedMutation | EncounterCompletedMutation | EncounterCancelledMutation> {
  const row = await db.prepare(`
    SELECT legacy_patient_id,encounter_type,status,started_at_utc,ended_at_utc,
           source_evidence_sha256
    FROM canonical_encounters
    WHERE tenant_id = ? AND encounter_public_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.entityPublicId).first<EncounterSourceRow>();
  if (!row) {
    throw new CanonicalSyncBusinessProjectionError('Canonical encounter source authority is missing');
  }
  const encounterType = exact(row.encounter_type, 'canonical encounter type', 32) as EncounterStartedMutation['encounterType'];
  const startedAtUtc = utc(row.started_at_utc, 'canonical encounter started_at_utc');
  const evidence = hash(row.source_evidence_sha256, 'canonical encounter source evidence');
  assertEventValue(input.event, 'encounterPublicId', input.entityPublicId);

  if (input.eventType === 'canonical.encounter.started') {
    assertEventValue(input.event, 'encounterType', encounterType);
    assertEventValue(input.event, 'status', 'in_progress');
    if (input.occurredAtUtc !== startedAtUtc) {
      throw new CanonicalSyncBusinessProjectionError('Canonical encounter start event time does not match source authority');
    }
    return {
      kind: 'encounter_started',
      entityPublicId: input.entityPublicId,
      patientSyncKey: await resolvePatientSyncKey(db, input.tenantId, row.legacy_patient_id),
      encounterType,
      startedAtUtc,
      sourceEvidenceSha256: evidence,
    };
  }

  if (input.eventType === 'canonical.encounter.completed') {
    assertEventValue(input.event, 'status', 'completed');
    if (row.status !== 'completed' || row.ended_at_utc !== input.occurredAtUtc) {
      throw new CanonicalSyncBusinessProjectionError('Canonical encounter completion evidence does not match source authority');
    }
    return {
      kind: 'encounter_completed',
      entityPublicId: input.entityPublicId,
      encounterType,
      startedAtUtc,
      completedAtUtc: utc(input.occurredAtUtc, 'canonical encounter completedAtUtc'),
      sourceEvidenceSha256: evidence,
    };
  }

  if (input.eventType === 'canonical.encounter.cancelled') {
    assertEventValue(input.event, 'status', 'cancelled');
    if (
      row.status !== 'cancelled'
      || row.ended_at_utc !== input.occurredAtUtc
      || Date.parse(input.occurredAtUtc) < Date.parse(startedAtUtc)
    ) {
      throw new CanonicalSyncBusinessProjectionError('Canonical encounter cancellation evidence does not match source authority');
    }
    return {
      kind: 'encounter_cancelled',
      entityPublicId: input.entityPublicId,
      encounterType,
      startedAtUtc,
      cancelledAtUtc: utc(input.occurredAtUtc, 'canonical encounter cancelledAtUtc'),
      sourceEvidenceSha256: evidence,
    };
  }

  throw new CanonicalSyncBusinessProjectionError(`Unsupported encounter event: ${input.eventType}`);
}

async function projectServiceRequest(
  db: CanonicalBatchDatabase,
  input: CanonicalSyncBusinessProjectionInput,
): Promise<ServiceRequestCreatedMutation | ServiceRequestCancelledMutation> {
  const row = await db.prepare(`
    SELECT legacy_patient_id,encounter_public_id,service_public_id,requested_quantity,
           fulfilled_quantity,status,requested_at_utc,cancelled_at_utc,source_evidence_sha256
    FROM canonical_service_requests
    WHERE tenant_id = ? AND request_public_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.entityPublicId).first<ServiceRequestSourceRow>();
  if (!row) {
    throw new CanonicalSyncBusinessProjectionError('Canonical service-request source authority is missing');
  }
  assertEventValue(input.event, 'requestPublicId', input.entityPublicId);
  const encounterPublicId = row.encounter_public_id == null
    ? null
    : publicId(row.encounter_public_id, 'canonical service-request encounter public ID');
  const servicePublicId = publicId(row.service_public_id, 'canonical service-request service public ID');
  const requestedQuantity = positiveInteger(row.requested_quantity, 'canonical service-request quantity');
  const requestedAtUtc = utc(row.requested_at_utc, 'canonical service-request requested_at_utc');
  const sourceEvidenceSha256 = hash(row.source_evidence_sha256, 'canonical service-request source evidence');

  if (input.eventType === 'canonical.service_request.created') {
    assertEventValue(input.event, 'servicePublicId', row.service_public_id);
    assertEventValue(input.event, 'requestedQuantity', row.requested_quantity);
    assertEventValue(input.event, 'status', 'active');
    if (input.occurredAtUtc !== row.requested_at_utc) {
      throw new CanonicalSyncBusinessProjectionError('Canonical service-request event time does not match source authority');
    }
    return {
      kind: 'service_request_created',
      entityPublicId: input.entityPublicId,
      patientSyncKey: await resolvePatientSyncKey(db, input.tenantId, row.legacy_patient_id),
      encounterPublicId,
      servicePublicId,
      requestedQuantity,
      requestedAtUtc,
      sourceEvidenceSha256,
    };
  }

  if (input.eventType === 'canonical.service_request.cancelled') {
    assertEventValue(input.event, 'status', 'cancelled');
    assertEventValue(input.event, 'fulfilledQuantity', row.fulfilled_quantity);
    if (
      row.status !== 'cancelled'
      || row.cancelled_at_utc !== input.occurredAtUtc
      || !Number.isSafeInteger(row.fulfilled_quantity)
      || row.fulfilled_quantity < 0
      || row.fulfilled_quantity >= row.requested_quantity
    ) {
      throw new CanonicalSyncBusinessProjectionError('Canonical service-request cancellation evidence does not match source authority');
    }
    return {
      kind: 'service_request_cancelled',
      entityPublicId: input.entityPublicId,
      encounterPublicId,
      servicePublicId,
      requestedQuantity,
      fulfilledQuantity: row.fulfilled_quantity,
      requestedAtUtc,
      cancelledAtUtc: utc(input.occurredAtUtc, 'canonical service-request cancelled_at_utc'),
      sourceEvidenceSha256,
    };
  }

  throw new CanonicalSyncBusinessProjectionError(`Unsupported service request event: ${input.eventType}`);
}

async function projectServiceEvent(
  db: CanonicalBatchDatabase,
  input: CanonicalSyncBusinessProjectionInput,
): Promise<ServiceEventRecordedMutation | ServiceEventCancelledMutation> {
  const row = await db.prepare(`
    SELECT request_public_id,encounter_public_id,service_public_id,event_type,quantity,
           status,occurred_at_utc,cancelled_at_utc,source_evidence_sha256
    FROM canonical_service_events
    WHERE tenant_id = ? AND event_public_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.entityPublicId).first<ServiceEventSourceRow>();
  if (!row) {
    throw new CanonicalSyncBusinessProjectionError('Canonical service-event source authority is missing');
  }
  assertEventValue(input.event, 'eventPublicId', input.entityPublicId);
  const requestPublicId = publicId(row.request_public_id, 'canonical service-event request public ID');
  const encounterPublicId = row.encounter_public_id == null
    ? null
    : publicId(row.encounter_public_id, 'canonical service-event encounter public ID');
  const servicePublicId = publicId(row.service_public_id, 'canonical service-event service public ID');
  const serviceEventType = exact(
    row.event_type,
    'canonical service-event type',
    32,
  ) as ServiceEventRecordedMutation['serviceEventType'];
  if (!['accepted', 'delivered', 'completed', 'dispensed', 'occupied'].includes(serviceEventType)) {
    throw new CanonicalSyncBusinessProjectionError('Canonical service-event type is unsupported');
  }
  const quantity = positiveInteger(row.quantity, 'canonical service-event quantity');
  const occurredAtUtc = utc(row.occurred_at_utc, 'canonical service-event occurred_at_utc');
  const sourceEvidenceSha256 = hash(row.source_evidence_sha256, 'canonical service-event source evidence');

  if (input.eventType === 'canonical.service_event.recorded') {
    if (!['posted', 'cancelled', 'reversed'].includes(row.status)) {
      throw new CanonicalSyncBusinessProjectionError('Canonical service-event source fact has unsupported status');
    }
    assertEventValue(input.event, 'requestPublicId', requestPublicId);
    assertEventValue(input.event, 'eventType', serviceEventType);
    assertEventValue(input.event, 'quantity', quantity);
    const requestStatus = eventString(input.event, 'requestStatus');
    if (!['active', 'partially_fulfilled', 'fulfilled'].includes(requestStatus)) {
      throw new CanonicalSyncBusinessProjectionError('Canonical service-event requestStatus is unsupported');
    }
    if (input.occurredAtUtc !== occurredAtUtc) {
      throw new CanonicalSyncBusinessProjectionError('Canonical service-event time does not match source authority');
    }
    return {
      kind: 'service_event_recorded',
      entityPublicId: input.entityPublicId,
      requestPublicId,
      encounterPublicId,
      servicePublicId,
      serviceEventType,
      quantity,
      requestStatusAfter: requestStatus as ServiceEventRecordedMutation['requestStatusAfter'],
      occurredAtUtc,
      sourceEvidenceSha256,
    };
  }

  if (input.eventType === 'canonical.service_event.cancelled') {
    assertEventValue(input.event, 'requestPublicId', requestPublicId);
    assertEventValue(input.event, 'status', 'cancelled');
    if (row.status !== 'cancelled' || row.cancelled_at_utc !== input.occurredAtUtc) {
      throw new CanonicalSyncBusinessProjectionError('Canonical service-event cancellation evidence does not match source authority');
    }
    const request = await db.prepare(`
      SELECT encounter_public_id,service_public_id,requested_quantity,fulfilled_quantity,
             last_event_public_id,status,cancelled_at_utc
      FROM canonical_service_requests
      WHERE tenant_id=? AND request_public_id=? LIMIT 1
    `).bind(input.tenantId, requestPublicId).first<ServiceEventRequestAuthorityRow>();
    if (!request || request.cancelled_at_utc !== null) {
      throw new CanonicalSyncBusinessProjectionError('Canonical service-event request authority is missing or terminal');
    }
    const requestedQuantity = positiveInteger(request.requested_quantity, 'canonical service request quantity');
    const fulfilledQuantityAfter = nonNegativeInteger(
      request.fulfilled_quantity,
      'canonical service request fulfilled quantity after cancellation',
    );
    const decrement = serviceEventType === 'accepted' ? 0 : quantity;
    const fulfilledQuantityBefore = fulfilledQuantityAfter + decrement;
    if (fulfilledQuantityBefore > requestedQuantity) {
      throw new CanonicalSyncBusinessProjectionError('Canonical service-event cancellation fulfillment balances do not reconcile');
    }
    const statusFor = (fulfilledQuantity: number): ServiceEventRecordedMutation['requestStatusAfter'] => (
      fulfilledQuantity === requestedQuantity
        ? 'fulfilled'
        : fulfilledQuantity > 0
          ? 'partially_fulfilled'
          : 'active'
    );
    const requestStatusBefore = statusFor(fulfilledQuantityBefore);
    const requestStatusAfter = statusFor(fulfilledQuantityAfter);
    const previousEventPublicId = input.event.previousEventPublicId == null
      ? null
      : publicId(input.event.previousEventPublicId, 'event.previousEventPublicId');
    assertEventValue(input.event, 'fulfilledQuantityBefore', fulfilledQuantityBefore);
    assertEventValue(input.event, 'fulfilledQuantityAfter', fulfilledQuantityAfter);
    assertEventValue(input.event, 'requestStatusAfter', requestStatusAfter);
    if (
      request.encounter_public_id !== row.encounter_public_id
      || request.service_public_id !== servicePublicId
      || request.status !== requestStatusAfter
      || request.last_event_public_id !== previousEventPublicId
    ) {
      throw new CanonicalSyncBusinessProjectionError('Canonical service-event cancellation request state does not match source authority');
    }
    return {
      kind: 'service_event_cancelled',
      entityPublicId: input.entityPublicId,
      requestPublicId,
      encounterPublicId,
      servicePublicId,
      serviceEventType,
      quantity,
      requestedQuantity,
      fulfilledQuantityBefore,
      fulfilledQuantityAfter,
      requestStatusBefore,
      requestStatusAfter,
      previousEventPublicId,
      occurredAtUtc,
      cancelledAtUtc: utc(input.occurredAtUtc, 'canonical service-event cancelled_at_utc'),
      sourceEvidenceSha256,
    };
  }

  throw new CanonicalSyncBusinessProjectionError(`Unsupported service event: ${input.eventType}`);
}

async function projectInvoiceIssued(
  db: CanonicalBatchDatabase,
  input: CanonicalSyncBusinessProjectionInput,
): Promise<InvoiceIssuedMutation> {
  if (input.eventType !== 'canonical.invoice.issued') {
    throw new CanonicalSyncBusinessProjectionError(`Unsupported invoice event: ${input.eventType}`);
  }
  const row = await db.prepare(`
    SELECT invoice_number,legacy_patient_id,currency_code,subtotal_minor,
           adjustment_total_minor,total_minor,issued_at_utc,source_evidence_sha256
    FROM canonical_invoices
    WHERE tenant_id = ? AND invoice_public_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.entityPublicId).first<InvoiceSourceRow>();
  if (!row) {
    throw new CanonicalSyncBusinessProjectionError('Canonical invoice source authority is missing');
  }
  assertEventValue(input.event, 'invoicePublicId', input.entityPublicId);
  assertEventValue(input.event, 'status', 'posted');
  assertEventValue(input.event, 'subtotalMinor', row.subtotal_minor);
  assertEventValue(input.event, 'adjustmentTotalMinor', row.adjustment_total_minor);
  assertEventValue(input.event, 'totalMinor', row.total_minor);
  if (row.total_minor !== row.subtotal_minor + row.adjustment_total_minor) {
    throw new CanonicalSyncBusinessProjectionError('Canonical invoice source totals do not reconcile');
  }
  if (input.occurredAtUtc !== row.issued_at_utc) {
    throw new CanonicalSyncBusinessProjectionError('Canonical invoice issue time does not match source authority');
  }
  const lines: InvoiceLineMutation[] = [];
  for (let offset = 0; ; offset += 1) {
    const line = await db.prepare(`
      SELECT line_public_id,line_type,service_event_public_id,adjustment_code,
             quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
      FROM canonical_invoice_lines
      WHERE tenant_id = ? AND invoice_public_id = ?
      ORDER BY id
      LIMIT 1 OFFSET ?
    `).bind(input.tenantId, input.entityPublicId, offset).first<InvoiceLineSourceRow>();
    if (!line) break;
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new CanonicalSyncBusinessProjectionError('Canonical invoice line quantity is invalid');
    }
    for (const [label, amount] of [
      ['unit amount', line.unit_amount_minor],
      ['line amount', line.line_amount_minor],
    ] as const) {
      if (!Number.isSafeInteger(amount)) {
        throw new CanonicalSyncBusinessProjectionError(`Canonical invoice line ${label} is invalid`);
      }
    }
    lines.push({
      linePublicId: publicId(line.line_public_id, 'canonical invoice line public ID'),
      lineType: exact(line.line_type, 'canonical invoice line type', 32) as InvoiceLineMutation['lineType'],
      serviceEventPublicId: line.service_event_public_id == null
        ? null
        : publicId(line.service_event_public_id, 'canonical invoice service-event public ID'),
      adjustmentCode: line.adjustment_code == null
        ? null
        : exact(line.adjustment_code, 'canonical invoice adjustment code', 128),
      quantity: line.quantity,
      unitAmountMinor: line.unit_amount_minor,
      lineAmountMinor: line.line_amount_minor,
      sourceEvidenceSha256: hash(line.source_evidence_sha256, 'canonical invoice line source evidence'),
    });
  }
  if (lines.length === 0) {
    throw new CanonicalSyncBusinessProjectionError('Canonical invoice has no immutable line authority');
  }

  const link = await db.prepare(`
    SELECT l.encounter_public_id,a.admission_no,l.link_type,l.source_evidence_sha256
    FROM canonical_invoice_encounter_links l
    LEFT JOIN canonical_encounter_admission_links a
      ON a.tenant_id = l.tenant_id
     AND a.encounter_public_id = l.encounter_public_id
     AND a.legacy_admission_id = l.legacy_admission_id
    WHERE l.tenant_id = ? AND l.invoice_public_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.entityPublicId).first<InvoiceEncounterLinkSourceRow>();
  if (link && !link.admission_no) {
    throw new CanonicalSyncBusinessProjectionError(
      'Canonical invoice encounter link cannot resolve stable admission identity',
    );
  }

  return {
    kind: 'invoice_issued',
    entityPublicId: input.entityPublicId,
    invoiceNumber: exact(row.invoice_number, 'canonical invoice number', 192),
    patientSyncKey: await resolvePatientSyncKey(db, input.tenantId, row.legacy_patient_id),
    currencyCode: exact(row.currency_code, 'canonical invoice currency', 3),
    subtotalMinor: row.subtotal_minor,
    adjustmentTotalMinor: row.adjustment_total_minor,
    totalMinor: row.total_minor,
    issuedAtUtc: utc(row.issued_at_utc, 'canonical invoice issued_at_utc'),
    sourceEvidenceSha256: hash(row.source_evidence_sha256, 'canonical invoice source evidence'),
    encounterLink: link
      ? {
          encounterPublicId: publicId(link.encounter_public_id, 'canonical invoice encounter public ID'),
          admissionNo: exact(link.admission_no, 'canonical invoice admission number', 192),
          linkType: link.link_type,
          sourceEvidenceSha256: hash(link.source_evidence_sha256, 'canonical invoice encounter-link evidence'),
        }
      : null,
    lines,
  };
}

async function projectInvoiceCancelled(
  db: CanonicalBatchDatabase,
  input: CanonicalSyncBusinessProjectionInput,
): Promise<InvoiceCancelledMutation> {
  if (input.eventType !== 'canonical.invoice.cancelled') {
    throw new CanonicalSyncBusinessProjectionError(`Unsupported invoice cancellation event: ${input.eventType}`);
  }
  const invoice = await db.prepare(`
    SELECT total_minor,status,cancelled_at_utc
    FROM canonical_invoices
    WHERE tenant_id = ? AND invoice_public_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.entityPublicId).first<InvoiceCancellationSourceRow>();
  if (!invoice) {
    throw new CanonicalSyncBusinessProjectionError('Canonical cancelled-invoice source authority is missing');
  }
  if (invoice.status !== 'cancelled' || invoice.cancelled_at_utc !== input.occurredAtUtc) {
    throw new CanonicalSyncBusinessProjectionError(
      'Canonical invoice cancellation evidence does not match source authority',
    );
  }
  const totalMinor = nonNegativeInteger(invoice.total_minor, 'canonical cancelled invoice total');
  assertEventValue(input.event, 'invoicePublicId', input.entityPublicId);
  assertEventValue(input.event, 'status', 'cancelled');
  assertEventValue(input.event, 'totalMinor', totalMinor);
  const expectedMinor = nonNegativeInteger(
    input.event.reversedCompensationMinor,
    'event.reversedCompensationMinor',
  );
  const expectedCount = nonNegativeInteger(
    input.event.reversedCompensationCount,
    'event.reversedCompensationCount',
  );

  const compensationAdjustments: CompensationAdjustmentMutation[] = [];
  for (let offset = 0; ; offset += 1) {
    const row = await db.prepare(`
      SELECT a.adjustment_public_id,a.accrual_public_id,c.practitioner_public_id,
             a.adjustment_type,a.reason_code,a.amount_minor,
             a.accrual_adjusted_before_minor,a.accrual_adjusted_after_minor,
             a.accrual_settled_before_minor,a.accrual_settled_after_minor,
             a.accrual_payable_before_minor,a.accrual_payable_after_minor,
             a.occurred_at_utc,a.business_date,a.source_evidence_sha256
      FROM canonical_compensation_adjustments a
      JOIN canonical_compensation_accruals c
        ON c.tenant_id = a.tenant_id
       AND c.accrual_public_id = a.accrual_public_id
      WHERE a.tenant_id = ?
        AND c.invoice_public_id = ?
        AND a.adjustment_type = 'service_cancellation'
        AND a.occurred_at_utc = ?
      ORDER BY a.adjustment_public_id
      LIMIT 1 OFFSET ?
    `).bind(
      input.tenantId,
      input.entityPublicId,
      input.occurredAtUtc,
      offset,
    ).first<CompensationCancellationSourceRow>();
    if (!row) break;
    const amountMinor = positiveInteger(row.amount_minor, 'canonical cancellation adjustment amount');
    compensationAdjustments.push({
      adjustmentPublicId: publicId(row.adjustment_public_id, 'canonical cancellation adjustment public ID'),
      accrualPublicId: publicId(row.accrual_public_id, 'canonical cancellation accrual public ID'),
      adjustmentType: exact(row.adjustment_type, 'canonical cancellation adjustment type', 64),
      reasonCode: exact(row.reason_code, 'canonical cancellation reason code', 128),
      amountMinor,
      adjustedBeforeMinor: nonNegativeInteger(
        row.accrual_adjusted_before_minor,
        'canonical cancellation adjusted before',
      ),
      adjustedAfterMinor: nonNegativeInteger(
        row.accrual_adjusted_after_minor,
        'canonical cancellation adjusted after',
      ),
      settledBeforeMinor: nonNegativeInteger(
        row.accrual_settled_before_minor,
        'canonical cancellation settled before',
      ),
      settledAfterMinor: nonNegativeInteger(
        row.accrual_settled_after_minor,
        'canonical cancellation settled after',
      ),
      payableBeforeMinor: nonNegativeInteger(
        row.accrual_payable_before_minor,
        'canonical cancellation payable before',
      ),
      payableAfterMinor: nonNegativeInteger(
        row.accrual_payable_after_minor,
        'canonical cancellation payable after',
      ),
      statusBefore: row.practitioner_public_id == null ? 'unassigned' : 'accrued',
      statusAfter: 'reversed',
      occurredAtUtc: utc(row.occurred_at_utc, 'canonical cancellation occurred_at_utc'),
      businessDate: exact(row.business_date, 'canonical cancellation business date', 10),
      sourceEvidenceSha256: hash(
        row.source_evidence_sha256,
        'canonical cancellation adjustment evidence',
      ),
    });
  }
  const projectedMinor = compensationAdjustments.reduce(
    (total, adjustment) => total + adjustment.amountMinor,
    0,
  );
  if (
    !Number.isSafeInteger(projectedMinor)
    || projectedMinor !== expectedMinor
    || compensationAdjustments.length !== expectedCount
  ) {
    throw new CanonicalSyncBusinessProjectionError(
      'Canonical invoice cancellation compensation evidence does not match the event payload',
    );
  }
  return {
    kind: 'invoice_cancelled',
    entityPublicId: input.entityPublicId,
    totalMinor,
    cancelledAtUtc: utc(input.occurredAtUtc, 'canonical invoice cancelledAtUtc'),
    compensationAdjustments,
  };
}

function requiredBusinessDate(input: CanonicalSyncBusinessProjectionInput): string {
  const value = exact(input.businessDate, 'canonical outbox business date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new CanonicalSyncBusinessProjectionError('Canonical outbox business date must use YYYY-MM-DD');
  }
  return value;
}

async function projectPaymentReceiptRecorded(
  db: CanonicalBatchDatabase,
  input: CanonicalSyncBusinessProjectionInput,
): Promise<PaymentReceiptRecordedMutation> {
  const status: PaymentReceiptRecordedMutation['status'] = input.eventType === 'canonical.payment.receipt.posted'
    ? 'posted'
    : input.eventType === 'canonical.payment.receipt.pending'
      ? 'pending'
      : input.eventType === 'canonical.payment.receipt.failed'
        ? 'failed'
        : (() => { throw new CanonicalSyncBusinessProjectionError(`Unsupported payment receipt event: ${input.eventType}`); })();
  const row = await db.prepare(`
    SELECT receipt_number,legacy_patient_id,currency_code,total_minor,allocated_total_minor,
           unallocated_minor,received_at_utc,business_date,external_transaction_id,
           posted_at_utc,failed_at_utc,source_evidence_sha256
    FROM canonical_payment_receipts
    WHERE tenant_id = ? AND receipt_public_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.entityPublicId).first<PaymentReceiptSourceRow>();
  if (!row) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment receipt source authority is missing');
  }
  if (row.received_at_utc !== input.occurredAtUtc || row.business_date !== requiredBusinessDate(input)) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment receipt event time or business date does not match source authority');
  }
  if (
    (status === 'posted' && (row.posted_at_utc !== input.occurredAtUtc || row.failed_at_utc !== null))
    || (status === 'failed' && (row.failed_at_utc !== input.occurredAtUtc || row.posted_at_utc !== null))
    || (status === 'pending' && (row.posted_at_utc !== null || row.failed_at_utc !== null))
  ) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment receipt status timestamps do not match the event');
  }
  const totalMinor = positiveInteger(row.total_minor, 'canonical payment receipt total');
  const allocatedTotalMinor = nonNegativeInteger(
    row.allocated_total_minor,
    'canonical payment receipt allocated total',
  );
  const unallocatedMinor = nonNegativeInteger(
    row.unallocated_minor,
    'canonical payment receipt unallocated total',
  );
  if (totalMinor !== allocatedTotalMinor + unallocatedMinor) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment receipt totals do not reconcile');
  }
  assertEventValue(input.event, 'receiptPublicId', input.entityPublicId);
  assertEventValue(input.event, 'status', status);
  assertEventValue(input.event, 'totalMinor', totalMinor);
  assertEventValue(input.event, 'allocatedMinor', allocatedTotalMinor);
  assertEventValue(input.event, 'unallocatedMinor', unallocatedMinor);

  const tenders: PaymentTenderMutation[] = [];
  let tenderTotal = 0;
  let cashTenderMinor = 0;
  for (let offset = 0; ; offset += 1) {
    const tender = await db.prepare(`
      SELECT tender_public_id,tender_type,method_code,amount_minor,external_transaction_id,
             captured_at_utc,failed_at_utc,source_evidence_sha256
      FROM canonical_payment_tenders
      WHERE tenant_id = ? AND receipt_public_id = ?
      ORDER BY id
      LIMIT 1 OFFSET ?
    `).bind(input.tenantId, input.entityPublicId, offset).first<PaymentTenderSourceRow>();
    if (!tender) break;
    const amountMinor = positiveInteger(tender.amount_minor, 'canonical payment tender amount');
    const tenderStatus: PaymentTenderMutation['status'] = status === 'posted'
      ? 'captured'
      : status === 'pending'
        ? 'verifying'
        : 'failed';
    if (
      (tenderStatus === 'captured' && (tender.captured_at_utc !== input.occurredAtUtc || tender.failed_at_utc !== null))
      || (tenderStatus === 'failed' && (tender.failed_at_utc !== input.occurredAtUtc || tender.captured_at_utc !== null))
      || (tenderStatus === 'verifying' && (tender.captured_at_utc !== null || tender.failed_at_utc !== null))
    ) {
      throw new CanonicalSyncBusinessProjectionError('Canonical payment tender timestamps do not match the receipt event');
    }
    tenderTotal += amountMinor;
    if (!Number.isSafeInteger(tenderTotal)) {
      throw new CanonicalSyncBusinessProjectionError('Canonical payment tender total exceeds safe integer range');
    }
    if (tender.tender_type === 'cash' && tenderStatus === 'captured') cashTenderMinor += amountMinor;
    tenders.push({
      tenderPublicId: publicId(tender.tender_public_id, 'canonical payment tender public ID'),
      tenderType: exact(tender.tender_type, 'canonical payment tender type', 32) as PaymentTenderMutation['tenderType'],
      methodCode: exact(tender.method_code, 'canonical payment tender method', 128),
      amountMinor,
      status: tenderStatus,
      externalTransactionId: tender.external_transaction_id == null
        ? null
        : exact(tender.external_transaction_id, 'canonical payment tender external transaction ID', 256),
      capturedAtUtc: tender.captured_at_utc == null
        ? null
        : utc(tender.captured_at_utc, 'canonical payment tender captured_at_utc'),
      failedAtUtc: tender.failed_at_utc == null
        ? null
        : utc(tender.failed_at_utc, 'canonical payment tender failed_at_utc'),
      sourceEvidenceSha256: hash(tender.source_evidence_sha256, 'canonical payment tender evidence'),
    });
  }
  if (tenders.length === 0 || tenderTotal !== totalMinor) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment tenders do not reconcile to receipt total');
  }
  assertEventValue(input.event, 'cashTenderMinor', cashTenderMinor);

  const allocations: PaymentAllocationMutation[] = [];
  let allocationTotal = 0;
  for (let offset = 0; ; offset += 1) {
    const allocation = await db.prepare(`
      SELECT allocation_public_id,invoice_public_id,invoice_line_public_id,amount_minor,
             invoice_due_before_minor,invoice_due_after_minor,allocated_at_utc,
             source_evidence_sha256
      FROM canonical_payment_allocations
      WHERE tenant_id = ? AND receipt_public_id = ?
      ORDER BY id
      LIMIT 1 OFFSET ?
    `).bind(input.tenantId, input.entityPublicId, offset).first<PaymentAllocationSourceRow>();
    if (!allocation) break;
    const amountMinor = positiveInteger(allocation.amount_minor, 'canonical payment allocation amount');
    const dueBefore = nonNegativeInteger(
      allocation.invoice_due_before_minor,
      'canonical payment allocation due before',
    );
    const dueAfter = nonNegativeInteger(
      allocation.invoice_due_after_minor,
      'canonical payment allocation due after',
    );
    if (status !== 'posted' || dueBefore < amountMinor || dueAfter !== dueBefore - amountMinor) {
      throw new CanonicalSyncBusinessProjectionError('Canonical payment allocation is invalid for the receipt event');
    }
    if (allocation.allocated_at_utc !== input.occurredAtUtc) {
      throw new CanonicalSyncBusinessProjectionError('Canonical payment allocation time does not match receipt event');
    }
    allocationTotal += amountMinor;
    if (!Number.isSafeInteger(allocationTotal)) {
      throw new CanonicalSyncBusinessProjectionError('Canonical payment allocation total exceeds safe integer range');
    }
    allocations.push({
      allocationPublicId: publicId(allocation.allocation_public_id, 'canonical payment allocation public ID'),
      invoicePublicId: publicId(allocation.invoice_public_id, 'canonical payment allocation invoice public ID'),
      invoiceLinePublicId: allocation.invoice_line_public_id == null
        ? null
        : publicId(allocation.invoice_line_public_id, 'canonical payment allocation invoice line public ID'),
      amountMinor,
      invoiceDueBeforeMinor: dueBefore,
      invoiceDueAfterMinor: dueAfter,
      allocatedAtUtc: utc(allocation.allocated_at_utc, 'canonical payment allocation allocated_at_utc'),
      sourceEvidenceSha256: hash(allocation.source_evidence_sha256, 'canonical payment allocation evidence'),
    });
  }
  if (allocationTotal !== allocatedTotalMinor || (status !== 'posted' && allocations.length > 0)) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment allocations do not reconcile to receipt event');
  }

  return {
    kind: 'payment_receipt_recorded',
    entityPublicId: input.entityPublicId,
    receiptNumber: exact(row.receipt_number, 'canonical payment receipt number', 192),
    patientSyncKey: await resolvePatientSyncKey(db, input.tenantId, row.legacy_patient_id),
    currencyCode: exact(row.currency_code, 'canonical payment receipt currency', 3),
    totalMinor,
    allocatedTotalMinor,
    unallocatedMinor,
    status,
    receivedAtUtc: utc(row.received_at_utc, 'canonical payment receipt received_at_utc'),
    businessDate: row.business_date,
    externalTransactionId: row.external_transaction_id == null
      ? null
      : exact(row.external_transaction_id, 'canonical payment receipt external transaction ID', 256),
    postedAtUtc: row.posted_at_utc == null ? null : utc(row.posted_at_utc, 'canonical payment receipt posted_at_utc'),
    failedAtUtc: row.failed_at_utc == null ? null : utc(row.failed_at_utc, 'canonical payment receipt failed_at_utc'),
    sourceEvidenceSha256: hash(row.source_evidence_sha256, 'canonical payment receipt evidence'),
    tenders,
    allocations,
  };
}

async function projectPaymentReversed(
  db: CanonicalBatchDatabase,
  input: CanonicalSyncBusinessProjectionInput,
): Promise<PaymentReversedMutation> {
  if (input.eventType !== 'canonical.payment.reversed') {
    throw new CanonicalSyncBusinessProjectionError(`Unsupported payment reversal event: ${input.eventType}`);
  }
  const businessDateValue = requiredBusinessDate(input);
  const reversalPublicId = publicId(input.event.reversalPublicId, 'event.reversalPublicId');
  const refundPublicId = publicId(input.event.refundPublicId, 'event.refundPublicId');
  const row = await db.prepare(`
    SELECT reversal_public_id,receipt_public_id,tender_public_id,allocation_public_id,
           invoice_public_id,amount_minor,reason_code,status,reversed_at_utc,business_date,
           allocation_reversed_before_minor,allocation_reversed_after_minor,
           tender_reversed_before_minor,tender_reversed_after_minor,
           receipt_refunded_before_minor,receipt_refunded_after_minor,
           invoice_paid_before_minor,invoice_paid_after_minor,invoice_due_before_minor,
           invoice_due_after_minor,invoice_net_due_before_minor,invoice_net_due_after_minor,
           compensation_guard,balance_guard,source_evidence_sha256
    FROM canonical_payment_reversals
    WHERE tenant_id = ? AND reversal_public_id = ?
    LIMIT 1
  `).bind(input.tenantId, reversalPublicId).first<PaymentReversalSourceRow>();
  if (!row) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment reversal source authority is missing');
  }
  if (
    row.status !== 'posted'
    || row.compensation_guard !== 1
    || row.balance_guard !== 1
    || row.receipt_public_id !== input.entityPublicId
    || row.reversed_at_utc !== input.occurredAtUtc
    || row.business_date !== businessDateValue
  ) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment reversal authority does not match the event');
  }
  const amountMinor = positiveInteger(row.amount_minor, 'canonical payment reversal amount');
  assertEventValue(input.event, 'receiptPublicId', input.entityPublicId);
  assertEventValue(input.event, 'reversalPublicId', reversalPublicId);
  assertEventValue(input.event, 'refundPublicId', refundPublicId);
  assertEventValue(input.event, 'tenderPublicId', row.tender_public_id);
  assertEventValue(input.event, 'allocationPublicId', row.allocation_public_id);
  assertEventValue(input.event, 'amountMinor', amountMinor);

  const refund = await db.prepare(`
    SELECT refund_public_id,source_type,receipt_public_id,tender_public_id,allocation_public_id,
           payment_reversal_public_id,amount_minor,tender_type,method_code,status,
           refunded_at_utc,business_date,reversed_at_utc,liability_guard,source_evidence_sha256
    FROM canonical_refunds
    WHERE tenant_id = ? AND refund_public_id = ?
    LIMIT 1
  `).bind(input.tenantId, refundPublicId).first<PaymentRefundSourceRow>();
  if (
    !refund
    || refund.source_type !== 'payment'
    || refund.status !== 'posted'
    || refund.reversed_at_utc !== null
    || refund.liability_guard !== 1
    || refund.receipt_public_id !== row.receipt_public_id
    || refund.tender_public_id !== row.tender_public_id
    || refund.allocation_public_id !== row.allocation_public_id
    || refund.payment_reversal_public_id !== row.reversal_public_id
    || refund.amount_minor !== amountMinor
    || refund.refunded_at_utc !== input.occurredAtUtc
    || refund.business_date !== businessDateValue
  ) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment refund authority does not match the reversal');
  }

  const allocationBefore = nonNegativeInteger(row.allocation_reversed_before_minor, 'allocation reversed before');
  const allocationAfter = nonNegativeInteger(row.allocation_reversed_after_minor, 'allocation reversed after');
  const tenderBefore = nonNegativeInteger(row.tender_reversed_before_minor, 'tender reversed before');
  const tenderAfter = nonNegativeInteger(row.tender_reversed_after_minor, 'tender reversed after');
  const receiptBefore = nonNegativeInteger(row.receipt_refunded_before_minor, 'receipt refunded before');
  const receiptAfter = nonNegativeInteger(row.receipt_refunded_after_minor, 'receipt refunded after');
  const invoicePaidBefore = nonNegativeInteger(row.invoice_paid_before_minor, 'invoice paid before');
  const invoicePaidAfter = nonNegativeInteger(row.invoice_paid_after_minor, 'invoice paid after');
  const invoiceDueBefore = nonNegativeInteger(row.invoice_due_before_minor, 'invoice due before');
  const invoiceDueAfter = nonNegativeInteger(row.invoice_due_after_minor, 'invoice due after');
  const invoiceNetDueBefore = nonNegativeInteger(row.invoice_net_due_before_minor, 'invoice net due before');
  const invoiceNetDueAfter = nonNegativeInteger(row.invoice_net_due_after_minor, 'invoice net due after');
  if (
    allocationAfter !== allocationBefore + amountMinor
    || tenderAfter !== tenderBefore + amountMinor
    || receiptAfter !== receiptBefore + amountMinor
    || invoicePaidBefore < amountMinor
    || invoicePaidAfter !== invoicePaidBefore - amountMinor
    || invoiceDueAfter !== invoiceDueBefore + amountMinor
    || invoiceNetDueAfter !== invoiceNetDueBefore + amountMinor
  ) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment reversal balances do not reconcile');
  }
  const tenderType = exact(refund.tender_type, 'canonical payment refund tender type', 32) as PaymentTenderMutation['tenderType'];
  if (!['cash', 'card', 'mobile_wallet', 'bank_transfer', 'gateway', 'other'].includes(tenderType)) {
    throw new CanonicalSyncBusinessProjectionError('Canonical payment refund tender type is unsupported');
  }
  return {
    kind: 'payment_reversed',
    entityPublicId: input.entityPublicId,
    reversalPublicId,
    refundPublicId,
    receiptPublicId: publicId(row.receipt_public_id, 'canonical reversal receipt public ID'),
    tenderPublicId: publicId(row.tender_public_id, 'canonical reversal tender public ID'),
    allocationPublicId: publicId(row.allocation_public_id, 'canonical reversal allocation public ID'),
    invoicePublicId: publicId(row.invoice_public_id, 'canonical reversal invoice public ID'),
    amountMinor,
    reasonCode: exact(row.reason_code, 'canonical payment reversal reason', 128),
    tenderType,
    methodCode: exact(refund.method_code, 'canonical payment refund method', 128),
    reversedAtUtc: utc(row.reversed_at_utc, 'canonical payment reversal reversed_at_utc'),
    businessDate: businessDateValue,
    allocationReversedBeforeMinor: allocationBefore,
    allocationReversedAfterMinor: allocationAfter,
    tenderReversedBeforeMinor: tenderBefore,
    tenderReversedAfterMinor: tenderAfter,
    receiptRefundedBeforeMinor: receiptBefore,
    receiptRefundedAfterMinor: receiptAfter,
    invoicePaidBeforeMinor: invoicePaidBefore,
    invoicePaidAfterMinor: invoicePaidAfter,
    invoiceDueBeforeMinor: invoiceDueBefore,
    invoiceDueAfterMinor: invoiceDueAfter,
    invoiceNetDueBeforeMinor: invoiceNetDueBefore,
    invoiceNetDueAfterMinor: invoiceNetDueAfter,
    sourceEvidenceSha256: hash(row.source_evidence_sha256, 'canonical payment reversal evidence'),
    refundSourceEvidenceSha256: hash(refund.source_evidence_sha256, 'canonical payment refund evidence'),
  };
}

async function projectDepositMutation(
  db: CanonicalBatchDatabase,
  input: CanonicalSyncBusinessProjectionInput,
): Promise<DepositRecordedMutation | DepositAppliedMutation | DepositRefundedMutation> {
  const businessDateValue = requiredBusinessDate(input);
  if (input.eventType === 'canonical.deposit.recorded') {
    const row = await db.prepare(`
      SELECT deposit_number,receipt_public_id,legacy_patient_id,currency_code,amount_minor,
             applied_minor,refunded_minor,available_minor,status,
             received_at_utc,business_date,posted_at_utc,source_evidence_sha256
      FROM canonical_deposits
      WHERE tenant_id = ? AND deposit_public_id = ?
      LIMIT 1
    `).bind(input.tenantId, input.entityPublicId).first<DepositSourceRow>();
    if (!row) throw new CanonicalSyncBusinessProjectionError('Canonical deposit source authority is missing');
    if (row.posted_at_utc !== input.occurredAtUtc || row.business_date !== businessDateValue) {
      throw new CanonicalSyncBusinessProjectionError('Canonical deposit event time or business date does not match source authority');
    }
    const amountMinor = positiveInteger(row.amount_minor, 'canonical deposit amount');
    assertEventValue(input.event, 'depositPublicId', input.entityPublicId);
    assertEventValue(input.event, 'receiptPublicId', row.receipt_public_id);
    assertEventValue(input.event, 'amountMinor', amountMinor);
    return {
      kind: 'deposit_recorded',
      entityPublicId: input.entityPublicId,
      depositNumber: exact(row.deposit_number, 'canonical deposit number', 192),
      receiptPublicId: publicId(row.receipt_public_id, 'canonical deposit receipt public ID'),
      patientSyncKey: await resolvePatientSyncKey(db, input.tenantId, row.legacy_patient_id),
      currencyCode: exact(row.currency_code, 'canonical deposit currency', 3),
      amountMinor,
      receivedAtUtc: utc(row.received_at_utc, 'canonical deposit received_at_utc'),
      businessDate: row.business_date,
      postedAtUtc: utc(row.posted_at_utc, 'canonical deposit posted_at_utc'),
      sourceEvidenceSha256: hash(row.source_evidence_sha256, 'canonical deposit evidence'),
    };
  }

  if (input.eventType === 'canonical.deposit.applied') {
    const applicationPublicId = publicId(
      input.event.applicationPublicId,
      'event.applicationPublicId',
    );
    const row = await db.prepare(`
      SELECT application_public_id,deposit_public_id,invoice_public_id,invoice_line_public_id,
             amount_minor,deposit_available_before_minor,deposit_available_after_minor,
             invoice_paid_before_minor,invoice_paid_after_minor,invoice_due_before_minor,
             invoice_due_after_minor,invoice_net_due_before_minor,invoice_net_due_after_minor,
             applied_at_utc,source_evidence_sha256
      FROM canonical_deposit_applications
      WHERE tenant_id = ? AND application_public_id = ?
      LIMIT 1
    `).bind(input.tenantId, applicationPublicId).first<DepositApplicationSourceRow>();
    if (!row || row.deposit_public_id !== input.entityPublicId) {
      throw new CanonicalSyncBusinessProjectionError('Canonical deposit application source authority is missing or mismatched');
    }
    if (row.applied_at_utc !== input.occurredAtUtc) {
      throw new CanonicalSyncBusinessProjectionError('Canonical deposit application time does not match source authority');
    }
    const amountMinor = positiveInteger(row.amount_minor, 'canonical deposit application amount');
    assertEventValue(input.event, 'depositPublicId', input.entityPublicId);
    assertEventValue(input.event, 'invoicePublicId', row.invoice_public_id);
    assertEventValue(input.event, 'amountMinor', amountMinor);
    return {
      kind: 'deposit_applied',
      entityPublicId: input.entityPublicId,
      applicationPublicId,
      invoicePublicId: publicId(row.invoice_public_id, 'canonical deposit application invoice public ID'),
      invoiceLinePublicId: row.invoice_line_public_id == null
        ? null
        : publicId(row.invoice_line_public_id, 'canonical deposit application invoice line public ID'),
      amountMinor,
      depositAvailableBeforeMinor: nonNegativeInteger(row.deposit_available_before_minor, 'canonical deposit available before'),
      depositAvailableAfterMinor: nonNegativeInteger(row.deposit_available_after_minor, 'canonical deposit available after'),
      invoicePaidBeforeMinor: nonNegativeInteger(row.invoice_paid_before_minor, 'canonical deposit invoice paid before'),
      invoicePaidAfterMinor: nonNegativeInteger(row.invoice_paid_after_minor, 'canonical deposit invoice paid after'),
      invoiceDueBeforeMinor: nonNegativeInteger(row.invoice_due_before_minor, 'canonical deposit invoice due before'),
      invoiceDueAfterMinor: nonNegativeInteger(row.invoice_due_after_minor, 'canonical deposit invoice due after'),
      invoiceNetDueBeforeMinor: nonNegativeInteger(row.invoice_net_due_before_minor, 'canonical deposit invoice net due before'),
      invoiceNetDueAfterMinor: nonNegativeInteger(row.invoice_net_due_after_minor, 'canonical deposit invoice net due after'),
      appliedAtUtc: utc(row.applied_at_utc, 'canonical deposit application applied_at_utc'),
      businessDate: businessDateValue,
      sourceEvidenceSha256: hash(row.source_evidence_sha256, 'canonical deposit application evidence'),
    };
  }

  if (input.eventType === 'canonical.deposit.refunded') {
    const refundPublicId = publicId(input.event.refundPublicId, 'event.refundPublicId');
    const refund = await db.prepare(`
      SELECT id,refund_public_id,deposit_public_id,source_type,amount_minor,tender_type,
             method_code,status,refunded_at_utc,business_date,reversed_at_utc,
             source_available_before_minor,source_available_after_minor,liability_guard,
             source_evidence_sha256
      FROM canonical_refunds
      WHERE tenant_id=? AND refund_public_id=? LIMIT 1
    `).bind(input.tenantId, refundPublicId).first<DepositRefundSourceRow>();
    if (
      !refund
      || refund.source_type !== 'deposit'
      || refund.deposit_public_id !== input.entityPublicId
      || refund.status !== 'posted'
      || refund.reversed_at_utc !== null
      || refund.liability_guard !== 1
      || refund.refunded_at_utc !== input.occurredAtUtc
      || refund.business_date !== businessDateValue
    ) {
      throw new CanonicalSyncBusinessProjectionError('Canonical deposit refund source authority is missing or mismatched');
    }
    const deposit = await db.prepare(`
      SELECT deposit_number,receipt_public_id,legacy_patient_id,currency_code,amount_minor,
             applied_minor,refunded_minor,available_minor,status,
             received_at_utc,business_date,posted_at_utc,source_evidence_sha256
      FROM canonical_deposits
      WHERE tenant_id=? AND deposit_public_id=? LIMIT 1
    `).bind(input.tenantId, input.entityPublicId).first<DepositSourceRow>();
    if (
      !deposit
      || deposit.status !== 'posted'
      || deposit.amount_minor !== deposit.applied_minor + deposit.refunded_minor + deposit.available_minor
    ) {
      throw new CanonicalSyncBusinessProjectionError('Canonical deposit balance authority is missing or inconsistent');
    }
    const history = await db.prepare(`
      SELECT COALESCE(SUM(amount_minor),0) AS total_minor
      FROM canonical_refunds
      WHERE tenant_id=? AND deposit_public_id=? AND source_type='deposit'
        AND id<? AND status='posted' AND reversed_at_utc IS NULL
    `).bind(input.tenantId, input.entityPublicId, refund.id).first<SumRow>();
    const depositRefundedBeforeMinor = nonNegativeInteger(
      history?.total_minor ?? 0,
      'canonical deposit refunded balance before',
    );
    const amountMinor = positiveInteger(refund.amount_minor, 'canonical deposit refund amount');
    const depositRefundedAfterMinor = depositRefundedBeforeMinor + amountMinor;
    const depositAvailableBeforeMinor = nonNegativeInteger(
      refund.source_available_before_minor,
      'canonical deposit available before refund',
    );
    const depositAvailableAfterMinor = nonNegativeInteger(
      refund.source_available_after_minor,
      'canonical deposit available after refund',
    );
    if (
      depositAvailableBeforeMinor < amountMinor
      || depositAvailableAfterMinor !== depositAvailableBeforeMinor - amountMinor
      || depositRefundedAfterMinor > deposit.amount_minor
    ) {
      throw new CanonicalSyncBusinessProjectionError('Canonical deposit refund balances do not reconcile');
    }
    const tenderType = exact(
      refund.tender_type,
      'canonical deposit refund tender type',
      32,
    ) as PaymentTenderMutation['tenderType'];
    if (!['cash', 'card', 'mobile_wallet', 'bank_transfer', 'gateway', 'other'].includes(tenderType)) {
      throw new CanonicalSyncBusinessProjectionError('Canonical deposit refund tender type is unsupported');
    }
    assertEventValue(input.event, 'depositPublicId', input.entityPublicId);
    assertEventValue(input.event, 'amountMinor', amountMinor);
    assertEventValue(input.event, 'tenderType', tenderType);
    return {
      kind: 'deposit_refunded',
      entityPublicId: input.entityPublicId,
      refundPublicId,
      amountMinor,
      tenderType,
      methodCode: exact(refund.method_code, 'canonical deposit refund method', 128),
      refundedAtUtc: utc(refund.refunded_at_utc, 'canonical deposit refund refunded_at_utc'),
      businessDate: businessDateValue,
      depositAvailableBeforeMinor,
      depositAvailableAfterMinor,
      depositRefundedBeforeMinor,
      depositRefundedAfterMinor,
      depositSourceEvidenceSha256: hash(deposit.source_evidence_sha256, 'canonical deposit evidence'),
      refundSourceEvidenceSha256: hash(refund.source_evidence_sha256, 'canonical deposit refund evidence'),
    };
  }

  throw new CanonicalSyncBusinessProjectionError(`Unsupported deposit event: ${input.eventType}`);
}

function compensationStatus(
  practitionerPublicId: string | null,
  settledMinor: number,
  payableMinor: number,
  allowReversed: boolean,
): string {
  if (allowReversed && payableMinor === 0 && settledMinor === 0) return 'reversed';
  if (practitionerPublicId == null) {
    if (settledMinor !== 0) {
      throw new CanonicalSyncBusinessProjectionError('Unassigned compensation cannot contain settled balance');
    }
    return 'unassigned';
  }
  if (payableMinor === 0) return 'settled';
  return settledMinor > 0 ? 'partially_settled' : 'accrued';
}

async function projectCompensationMutation(
  db: CanonicalBatchDatabase,
  input: CanonicalSyncBusinessProjectionInput,
): Promise<CompensationAccruedMutation | CompensationAdjustedMutation> {
  const businessDateValue = requiredBusinessDate(input);
  if (
    input.eventType === 'canonical.compensation.accrued'
    || input.eventType === 'canonical.compensation.performer-reserve.accrued'
  ) {
    const row = await db.prepare(`
      SELECT invoice_public_id,invoice_line_public_id,service_event_public_id,
             practitioner_public_id,practitioner_role,accrual_stage,rule_public_id,
             rule_version,calculation_basis,rate_type,rate_value,currency_code,
             gross_minor,discount_minor,tax_minor,performer_reserve_minor,
             eligible_base_minor,earned_minor,accrued_at_utc,business_date,
             source_evidence_sha256
      FROM canonical_compensation_accruals
      WHERE tenant_id = ? AND accrual_public_id = ?
      LIMIT 1
    `).bind(input.tenantId, input.entityPublicId).first<CompensationAccrualSourceRow>();
    if (!row) {
      throw new CanonicalSyncBusinessProjectionError('Canonical compensation accrual source authority is missing');
    }
    if (row.accrued_at_utc !== input.occurredAtUtc || row.business_date !== businessDateValue) {
      throw new CanonicalSyncBusinessProjectionError('Canonical compensation accrual time or business date does not match event');
    }
    const earnedMinor = nonNegativeInteger(row.earned_minor, 'canonical compensation earned amount');
    assertEventValue(input.event, 'accrualPublicId', input.entityPublicId);
    assertEventValue(input.event, 'invoiceLinePublicId', row.invoice_line_public_id);
    assertEventValue(input.event, 'practitionerPublicId', row.practitioner_public_id);
    assertEventValue(input.event, 'practitionerRole', row.practitioner_role);
    assertEventValue(input.event, 'earnedMinor', earnedMinor);
    assertEventValue(input.event, 'currencyCode', row.currency_code);
    const initialStatus = row.practitioner_public_id == null ? 'unassigned' : 'accrued';
    if (initialStatus === 'accrued' && earnedMinor <= 0) {
      throw new CanonicalSyncBusinessProjectionError('Assigned compensation accrual must have positive earnings');
    }
    return {
      kind: 'compensation_accrued',
      entityPublicId: input.entityPublicId,
      invoicePublicId: publicId(row.invoice_public_id, 'canonical compensation invoice public ID'),
      invoiceLinePublicId: publicId(row.invoice_line_public_id, 'canonical compensation invoice line public ID'),
      serviceEventPublicId: row.service_event_public_id == null
        ? null
        : publicId(row.service_event_public_id, 'canonical compensation service event public ID'),
      practitionerPublicId: row.practitioner_public_id == null
        ? null
        : publicId(row.practitioner_public_id, 'canonical compensation practitioner public ID'),
      practitionerRole: row.practitioner_role,
      accrualStage: row.accrual_stage,
      rulePublicId: publicId(row.rule_public_id, 'canonical compensation rule public ID'),
      ruleVersion: positiveInteger(row.rule_version, 'canonical compensation rule version'),
      calculationBasis: row.calculation_basis,
      rateType: row.rate_type,
      rateValue: nonNegativeInteger(row.rate_value, 'canonical compensation rate value'),
      currencyCode: exact(row.currency_code, 'canonical compensation currency', 3),
      grossMinor: nonNegativeInteger(row.gross_minor, 'canonical compensation gross amount'),
      discountMinor: nonNegativeInteger(row.discount_minor, 'canonical compensation discount amount'),
      taxMinor: nonNegativeInteger(row.tax_minor, 'canonical compensation tax amount'),
      performerReserveMinor: nonNegativeInteger(row.performer_reserve_minor, 'canonical performer reserve amount'),
      eligibleBaseMinor: nonNegativeInteger(row.eligible_base_minor, 'canonical compensation eligible base'),
      earnedMinor,
      initialStatus,
      accruedAtUtc: utc(row.accrued_at_utc, 'canonical compensation accrued_at_utc'),
      businessDate: businessDateValue,
      sourceEvidenceSha256: hash(row.source_evidence_sha256, 'canonical compensation accrual evidence'),
    };
  }

  if (input.eventType === 'canonical.compensation.adjusted') {
    const adjustmentPublicId = publicId(
      input.event.adjustmentPublicId,
      'event.adjustmentPublicId',
    );
    const row = await db.prepare(`
      SELECT a.adjustment_public_id,a.accrual_public_id,a.settlement_public_id,
             a.settlement_allocation_public_id,a.adjustment_type,a.reason_code,
             a.amount_minor,a.accrual_adjusted_before_minor,a.accrual_adjusted_after_minor,
             a.accrual_settled_before_minor,a.accrual_settled_after_minor,
             a.accrual_payable_before_minor,a.accrual_payable_after_minor,
             a.occurred_at_utc,a.business_date,a.balance_guard,a.source_evidence_sha256,
             c.practitioner_public_id
      FROM canonical_compensation_adjustments a
      JOIN canonical_compensation_accruals c
        ON c.tenant_id = a.tenant_id AND c.accrual_public_id = a.accrual_public_id
      WHERE a.tenant_id = ? AND a.adjustment_public_id = ?
      LIMIT 1
    `).bind(input.tenantId, adjustmentPublicId).first<CompensationAdjustmentSourceRow>();
    if (!row || row.accrual_public_id !== input.entityPublicId) {
      throw new CanonicalSyncBusinessProjectionError('Canonical compensation adjustment source authority is missing or mismatched');
    }
    if (
      row.settlement_public_id !== null
      || row.settlement_allocation_public_id !== null
      || row.balance_guard !== 1
      || row.occurred_at_utc !== input.occurredAtUtc
      || row.business_date !== businessDateValue
    ) {
      throw new CanonicalSyncBusinessProjectionError('Canonical compensation adjustment authority does not match event');
    }
    const amountMinor = positiveInteger(row.amount_minor, 'canonical compensation adjustment amount');
    const adjustedBefore = nonNegativeInteger(row.accrual_adjusted_before_minor, 'canonical compensation adjusted before');
    const adjustedAfter = nonNegativeInteger(row.accrual_adjusted_after_minor, 'canonical compensation adjusted after');
    const settledBefore = nonNegativeInteger(row.accrual_settled_before_minor, 'canonical compensation settled before');
    const settledAfter = nonNegativeInteger(row.accrual_settled_after_minor, 'canonical compensation settled after');
    const payableBefore = nonNegativeInteger(row.accrual_payable_before_minor, 'canonical compensation payable before');
    const payableAfter = nonNegativeInteger(row.accrual_payable_after_minor, 'canonical compensation payable after');
    if (
      adjustedAfter !== adjustedBefore + amountMinor
      || settledAfter !== settledBefore
      || payableBefore < amountMinor
      || payableAfter !== payableBefore - amountMinor
    ) {
      throw new CanonicalSyncBusinessProjectionError('Canonical compensation adjustment balances do not reconcile');
    }
    assertEventValue(input.event, 'accrualPublicId', input.entityPublicId);
    assertEventValue(input.event, 'adjustmentType', row.adjustment_type);
    assertEventValue(input.event, 'amountMinor', amountMinor);
    assertEventValue(input.event, 'payableMinor', payableAfter);
    const statusBefore = compensationStatus(row.practitioner_public_id, settledBefore, payableBefore, false);
    const statusAfter = compensationStatus(row.practitioner_public_id, settledAfter, payableAfter, true);
    return {
      kind: 'compensation_adjusted',
      entityPublicId: input.entityPublicId,
      adjustment: {
        adjustmentPublicId,
        accrualPublicId: input.entityPublicId,
        adjustmentType: exact(row.adjustment_type, 'canonical compensation adjustment type', 64),
        reasonCode: exact(row.reason_code, 'canonical compensation adjustment reason', 128),
        amountMinor,
        adjustedBeforeMinor: adjustedBefore,
        adjustedAfterMinor: adjustedAfter,
        settledBeforeMinor: settledBefore,
        settledAfterMinor: settledAfter,
        payableBeforeMinor: payableBefore,
        payableAfterMinor: payableAfter,
        statusBefore,
        statusAfter,
        occurredAtUtc: utc(row.occurred_at_utc, 'canonical compensation adjustment occurred_at_utc'),
        businessDate: businessDateValue,
        sourceEvidenceSha256: hash(row.source_evidence_sha256, 'canonical compensation adjustment evidence'),
      },
    };
  }

  throw new CanonicalSyncBusinessProjectionError(`Unsupported compensation event: ${input.eventType}`);
}

async function projectInventoryMovement(
  db: CanonicalBatchDatabase,
  input: CanonicalSyncBusinessProjectionInput,
): Promise<InventoryMovementRecordedMutation> {
  if (
    input.eventType !== 'canonical.inventory.stock_movement.recorded'
    && input.eventType !== 'canonical.inventory.movement.posted'
  ) {
    throw new CanonicalSyncBusinessProjectionError(`Unsupported inventory event: ${input.eventType}`);
  }
  const businessDateValue = requiredBusinessDate(input);
  const row = await db.prepare(`
    SELECT id,movement_public_id,item_public_id,location_public_id,lot_public_id,
           movement_type,direction,source_quantity,source_unit_code,conversion_numerator,
           conversion_denominator,quantity_base,signed_quantity_base,balance_before_base,
           balance_after_base,transfer_public_id,service_event_public_id,invoice_public_id,
           invoice_line_public_id,reversal_of_movement_public_id,source_type,source_public_id,
           source_line_public_id,source_table,status,occurred_at_utc,business_date,
           balance_guard,source_evidence_sha256
    FROM canonical_inventory_movements
    WHERE tenant_id = ? AND movement_public_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.entityPublicId).first<InventoryMovementSourceRow>();
  if (!row) {
    throw new CanonicalSyncBusinessProjectionError('Canonical inventory movement source authority is missing');
  }
  if (
    row.status !== 'posted'
    || row.balance_guard !== 1
    || row.occurred_at_utc !== input.occurredAtUtc
    || row.business_date !== businessDateValue
  ) {
    throw new CanonicalSyncBusinessProjectionError('Canonical inventory movement authority does not match event');
  }
  const version = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM canonical_inventory_movements
    WHERE tenant_id = ? AND item_public_id = ? AND location_public_id = ?
      AND lot_public_id = ? AND id <= ?
  `).bind(
    input.tenantId,
    row.item_public_id,
    row.location_public_id,
    row.lot_public_id,
    row.id,
  ).first<{ count: number }>();
  const balanceVersionAfter = positiveInteger(version?.count, 'canonical inventory balance version after');
  const quantityBase = positiveInteger(row.quantity_base, 'canonical inventory base quantity');
  const balanceBefore = Number(row.balance_before_base);
  const balanceAfter = Number(row.balance_after_base);
  const signedQuantity = Number(row.signed_quantity_base);
  if (
    !Number.isSafeInteger(balanceBefore)
    || !Number.isSafeInteger(balanceAfter)
    || !Number.isSafeInteger(signedQuantity)
    || balanceAfter !== balanceBefore + signedQuantity
  ) {
    throw new CanonicalSyncBusinessProjectionError('Canonical inventory movement balances do not reconcile');
  }
  assertEventValue(input.event, 'movementPublicId', input.entityPublicId);
  assertEventValue(input.event, 'movementType', row.movement_type);
  assertEventValue(input.event, 'itemPublicId', row.item_public_id);
  assertEventValue(input.event, 'locationPublicId', row.location_public_id);
  assertEventValue(input.event, 'lotPublicId', row.lot_public_id);
  assertEventValue(input.event, 'quantityBase', quantityBase);
  assertEventValue(input.event, 'balanceAfterBase', balanceAfter);
  return {
    kind: 'inventory_movement_recorded',
    entityPublicId: input.entityPublicId,
    itemPublicId: publicId(row.item_public_id, 'canonical inventory item public ID'),
    locationPublicId: publicId(row.location_public_id, 'canonical inventory location public ID'),
    lotPublicId: publicId(row.lot_public_id, 'canonical inventory lot public ID'),
    movementType: exact(row.movement_type, 'canonical inventory movement type', 64),
    direction: row.direction,
    sourceQuantity: positiveInteger(row.source_quantity, 'canonical inventory source quantity'),
    sourceUnitCode: exact(row.source_unit_code, 'canonical inventory source unit', 64),
    conversionNumerator: positiveInteger(row.conversion_numerator, 'canonical inventory conversion numerator'),
    conversionDenominator: positiveInteger(row.conversion_denominator, 'canonical inventory conversion denominator'),
    quantityBase,
    signedQuantityBase: signedQuantity,
    balanceBeforeBase: balanceBefore,
    balanceAfterBase: balanceAfter,
    balanceVersionBefore: balanceVersionAfter - 1,
    balanceVersionAfter,
    transferPublicId: row.transfer_public_id == null
      ? null
      : publicId(row.transfer_public_id, 'canonical inventory transfer public ID'),
    serviceEventPublicId: row.service_event_public_id == null
      ? null
      : publicId(row.service_event_public_id, 'canonical inventory service event public ID'),
    invoicePublicId: row.invoice_public_id == null
      ? null
      : publicId(row.invoice_public_id, 'canonical inventory invoice public ID'),
    invoiceLinePublicId: row.invoice_line_public_id == null
      ? null
      : publicId(row.invoice_line_public_id, 'canonical inventory invoice line public ID'),
    reversalOfMovementPublicId: row.reversal_of_movement_public_id == null
      ? null
      : publicId(row.reversal_of_movement_public_id, 'canonical reversed inventory movement public ID'),
    sourceType: exact(row.source_type, 'canonical inventory source type', 192),
    sourcePublicId: exact(row.source_public_id, 'canonical inventory source public ID', 192),
    sourceLinePublicId: exact(row.source_line_public_id, 'canonical inventory source line public ID', 192),
    sourceTable: exact(row.source_table, 'canonical inventory source table', 192),
    occurredAtUtc: utc(row.occurred_at_utc, 'canonical inventory movement occurred_at_utc'),
    businessDate: businessDateValue,
    sourceEvidenceSha256: hash(row.source_evidence_sha256, 'canonical inventory movement evidence'),
  };
}

export const CANONICAL_SYNC_BUSINESS_PROJECTED_EVENT_TYPES = Object.freeze([
  'canonical.encounter.started',
  'canonical.encounter.completed',
  'canonical.encounter.cancelled',
  'canonical.service_request.created',
  'canonical.service_request.cancelled',
  'canonical.service_event.recorded',
  'canonical.service_event.cancelled',
  'canonical.invoice.issued',
  'canonical.invoice.cancelled',
  'canonical.payment.receipt.posted',
  'canonical.payment.receipt.pending',
  'canonical.payment.receipt.failed',
  'canonical.payment.reversed',
  'canonical.deposit.recorded',
  'canonical.deposit.applied',
  'canonical.deposit.refunded',
  'canonical.compensation.accrued',
  'canonical.compensation.adjusted',
  'canonical.compensation.performer-reserve.accrued',
  'canonical.inventory.stock_movement.recorded',
  'canonical.inventory.movement.posted',
] as const);

export async function projectCanonicalSyncBusinessMutation(
  db: CanonicalBatchDatabase,
  rawInput: CanonicalSyncBusinessProjectionInput,
): Promise<CanonicalSyncMutationV1> {
  const input: CanonicalSyncBusinessProjectionInput = {
    tenantId: exact(rawInput.tenantId, 'tenantId', 128),
    entityType: exact(rawInput.entityType, 'entityType', 96),
    entityPublicId: publicId(rawInput.entityPublicId, 'entityPublicId'),
    eventType: exact(rawInput.eventType, 'eventType', 160),
    occurredAtUtc: utc(rawInput.occurredAtUtc, 'occurredAtUtc'),
    businessDate: rawInput.businessDate == null
      ? null
      : exact(rawInput.businessDate, 'businessDate', 10),
    event: rawInput.event,
  };
  if (!input.event || typeof input.event !== 'object' || Array.isArray(input.event)) {
    throw new CanonicalSyncBusinessProjectionError('event must be a plain object');
  }

  if (input.entityType === 'encounter') return projectEncounter(db, input);
  if (input.entityType === 'service_request') return projectServiceRequest(db, input);
  if (input.entityType === 'service_event') return projectServiceEvent(db, input);
  if (input.entityType === 'invoice') {
    if (input.eventType === 'canonical.invoice.issued') return projectInvoiceIssued(db, input);
    if (input.eventType === 'canonical.invoice.cancelled') return projectInvoiceCancelled(db, input);
  }
  if (input.entityType === 'payment_receipt') {
    if (input.eventType === 'canonical.payment.reversed') return projectPaymentReversed(db, input);
    return projectPaymentReceiptRecorded(db, input);
  }
  if (input.entityType === 'deposit') return projectDepositMutation(db, input);
  if (input.entityType === 'compensation_accrual') return projectCompensationMutation(db, input);
  if (input.entityType === 'inventory_movement') return projectInventoryMovement(db, input);
  throw new CanonicalSyncBusinessProjectionError(
    `Canonical sync business projection is not implemented for ${input.entityType}/${input.eventType}`,
  );
}
