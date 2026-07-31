import {
  prepareCanonicalBatch,
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
  type PreparedCanonicalBatch,
} from '../command-batch';
import { toUtcIso } from '../time';

export type ServiceParticipantRole =
  | 'ordering'
  | 'prescribing'
  | 'performing'
  | 'reporting'
  | 'approving'
  | 'referring';

export type ServiceParticipantEvidence =
  | 'legacy_lab_orderer'
  | 'legacy_lab_processor'
  | 'legacy_lab_verifier'
  | 'legacy_radiology_prescriber'
  | 'legacy_radiology_performer'
  | 'legacy_consultation_doctor'
  | 'legacy_procedure_orderer'
  | 'legacy_procedure_performer'
  | 'legacy_prescription_doctor'
  | 'approved_manual';

export interface ServiceOperationParticipantInput {
  practitionerPublicId: string;
  role: ServiceParticipantRole;
  evidenceType: ServiceParticipantEvidence;
}

interface CommandSourceInput {
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
}

interface CommandEnvelopeInput {
  idempotencyKey: string;
  outboxEventPublicId: string;
  businessDate: string;
}

export interface CreateServiceRequestInput extends CommandSourceInput, CommandEnvelopeInput {
  tenantId: string;
  requestPublicId: string;
  legacyPatientId: number;
  encounterPublicId?: string | null;
  servicePublicId: string;
  requestedQuantity: number;
  requestedAtUtc: string;
  participant?: ServiceOperationParticipantInput | null;
}

export interface CreateServiceRequestResult {
  requestPublicId: string;
  status: 'active';
}

export interface CancelServiceRequestInput extends CommandEnvelopeInput {
  tenantId: string;
  requestPublicId: string;
  cancelledAtUtc: string;
}

export interface CancelServiceRequestResult {
  requestPublicId: string;
  status: 'cancelled';
  fulfilledQuantity: number;
}

export type RecordServiceEventType =
  | 'accepted'
  | 'delivered'
  | 'completed'
  | 'dispensed'
  | 'occupied';

export interface RecordServiceEventInput extends CommandSourceInput, CommandEnvelopeInput {
  tenantId: string;
  requestPublicId: string;
  eventPublicId: string;
  eventType: RecordServiceEventType;
  quantity: number;
  occurredAtUtc: string;
  participant?: ServiceOperationParticipantInput | null;
}

export interface RecordServiceEventResult {
  eventPublicId: string;
  requestPublicId: string;
  requestStatus: 'active' | 'partially_fulfilled' | 'fulfilled';
  fulfilledQuantity: number;
}

export interface CancelServiceEventInput extends CommandEnvelopeInput {
  tenantId: string;
  eventPublicId: string;
  cancelledAtUtc: string;
}

export interface CancelServiceEventResult {
  eventPublicId: string;
  requestPublicId: string;
  status: 'cancelled';
  requestStatus: 'active' | 'partially_fulfilled' | 'fulfilled';
  fulfilledQuantity: number;
}

interface StoredRequestRow {
  encounter_public_id: string | null;
  service_public_id: string;
  requested_quantity: number;
  fulfilled_quantity: number;
  last_event_public_id: string | null;
  status: string;
  requested_at_utc: string;
  cancelled_at_utc: string | null;
  source_evidence_sha256: string;
}

interface StoredServiceEventRow {
  id: number;
  request_public_id: string | null;
  encounter_public_id: string | null;
  service_public_id: string;
  event_type: RecordServiceEventType;
  quantity: number;
  status: string;
  occurred_at_utc: string;
  cancelled_at_utc: string | null;
  source_evidence_sha256: string;
}

interface PreviousServiceEventRow {
  event_public_id: string;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function validateUtc(value: string, label: string): string {
  if (toUtcIso(value) !== value) {
    throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  }
  return value;
}

function validateHash(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError('sourceEvidenceSha256 must be a lowercase SHA-256 hex digest');
  }
  return value;
}

function validateCommon(input: CommandSourceInput & CommandEnvelopeInput): void {
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  validateHash(input.sourceEvidenceSha256);
}

function recordEventRequest(input: RecordServiceEventInput): Record<string, unknown> {
  return {
    requestPublicId: input.requestPublicId,
    eventPublicId: input.eventPublicId,
    eventType: input.eventType,
    quantity: input.quantity,
    occurredAtUtc: input.occurredAtUtc,
    participant: input.participant ?? null,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
}

function participantStatement(
  db: CanonicalBatchDatabase,
  tenantId: string,
  participant: ServiceOperationParticipantInput | null | undefined,
  target: { requestPublicId?: string; eventPublicId?: string },
): CanonicalPreparedStatement[] {
  if (!participant) return [];
  exact(participant.practitionerPublicId, 'participant.practitionerPublicId');
  return [db.prepare(`
    INSERT INTO canonical_service_participants (
      tenant_id,request_public_id,event_public_id,practitioner_public_id,
      participant_role,evidence_type
    ) VALUES (?,?,?,?,?,?)
  `).bind(
    tenantId,
    target.requestPublicId ?? null,
    target.eventPublicId ?? null,
    participant.practitionerPublicId,
    participant.role,
    participant.evidenceType,
  )];
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'service_request' | 'service_event';
    canonicalPublicId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,?,?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.evidenceSha256,
  );
}

export async function createServiceRequest(
  db: CanonicalBatchDatabase,
  input: CreateServiceRequestInput,
): Promise<CanonicalCommandResult<CreateServiceRequestResult>> {
  validateCommon(input);
  exact(input.tenantId, 'tenantId');
  exact(input.requestPublicId, 'requestPublicId');
  exact(input.servicePublicId, 'servicePublicId');
  positiveSafeInteger(input.legacyPatientId, 'legacyPatientId');
  positiveSafeInteger(input.requestedQuantity, 'requestedQuantity');
  validateUtc(input.requestedAtUtc, 'requestedAtUtc');
  if (input.encounterPublicId != null) exact(input.encounterPublicId, 'encounterPublicId');

  const result: CreateServiceRequestResult = {
    requestPublicId: input.requestPublicId,
    status: 'active',
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_request.create',
    idempotencyKey: input.idempotencyKey,
    request: {
      requestPublicId: input.requestPublicId,
      legacyPatientId: input.legacyPatientId,
      encounterPublicId: input.encounterPublicId ?? null,
      servicePublicId: input.servicePublicId,
      requestedQuantity: input.requestedQuantity,
      requestedAtUtc: input.requestedAtUtc,
      participant: input.participant ?? null,
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
      sourceTable: input.sourceTable,
      sourceEvidenceSha256: input.sourceEvidenceSha256,
    },
    statements: [
      db.prepare(`
        INSERT INTO canonical_service_requests (
          tenant_id,request_public_id,legacy_patient_id,encounter_public_id,
          service_public_id,requested_quantity,fulfilled_quantity,status,
          requested_at_utc,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,0,'active',?,?)
      `).bind(
        input.tenantId,
        input.requestPublicId,
        input.legacyPatientId,
        input.encounterPublicId ?? null,
        input.servicePublicId,
        input.requestedQuantity,
        input.requestedAtUtc,
        input.sourceEvidenceSha256,
      ),
      ...participantStatement(db, input.tenantId, input.participant, {
        requestPublicId: input.requestPublicId,
      }),
    ],
    reconciliationStatements: [
      sourceMappingStatement(db, {
        tenantId: input.tenantId,
        entityType: 'service_request',
        canonicalPublicId: input.requestPublicId,
        sourceType: input.sourceType,
        sourcePublicId: input.sourcePublicId,
        sourceTable: input.sourceTable,
        evidenceSha256: input.sourceEvidenceSha256,
      }),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_service_request',
      aggregatePublicId: input.requestPublicId,
      eventType: 'canonical.service_request.created',
      occurredAtUtc: input.requestedAtUtc,
      businessDate: input.businessDate,
      payload: {
        requestPublicId: input.requestPublicId,
        servicePublicId: input.servicePublicId,
        requestedQuantity: input.requestedQuantity,
        status: 'active',
      },
    },
  });
}

export async function cancelServiceRequest(
  db: CanonicalBatchDatabase,
  input: CancelServiceRequestInput,
): Promise<CanonicalCommandResult<CancelServiceRequestResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.requestPublicId, 'requestPublicId');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  validateUtc(input.cancelledAtUtc, 'cancelledAtUtc');
  const requestFingerprintInput = {
    requestPublicId: input.requestPublicId,
    cancelledAtUtc: input.cancelledAtUtc,
  };
  const replay = await readCanonicalCommandReplay<CancelServiceRequestResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_request.cancel',
    idempotencyKey: input.idempotencyKey,
    request: requestFingerprintInput,
  });
  if (replay) return replay;

  const request = await db.prepare(`
    SELECT encounter_public_id,service_public_id,requested_quantity,fulfilled_quantity,
           last_event_public_id,status,requested_at_utc,cancelled_at_utc,source_evidence_sha256
    FROM canonical_service_requests
    WHERE tenant_id=? AND request_public_id=? LIMIT 1
  `).bind(input.tenantId, input.requestPublicId).first<StoredRequestRow>();
  if (!request) throw new Error('Canonical service request not found');
  if (!['active', 'partially_fulfilled'].includes(request.status) || request.cancelled_at_utc !== null) {
    throw new Error(`Canonical service request cannot be cancelled in status: ${request.status}`);
  }
  if (Date.parse(input.cancelledAtUtc) < Date.parse(request.requested_at_utc)) {
    throw new RangeError('Service request cancellation cannot occur before request time');
  }
  const result: CancelServiceRequestResult = {
    requestPublicId: input.requestPublicId,
    status: 'cancelled',
    fulfilledQuantity: request.fulfilled_quantity,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_request.cancel',
    idempotencyKey: input.idempotencyKey,
    request: requestFingerprintInput,
    statements: [
      db.prepare(`
        UPDATE canonical_service_requests
        SET status='cancelled',cancelled_at_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND request_public_id=?
          AND service_public_id=? AND requested_quantity=? AND fulfilled_quantity=?
          AND COALESCE(encounter_public_id,'')=COALESCE(?,'')
          AND COALESCE(last_event_public_id,'')=COALESCE(?,'')
          AND status=? AND requested_at_utc=? AND cancelled_at_utc IS NULL
          AND source_evidence_sha256=?
      `).bind(
        input.cancelledAtUtc,
        input.cancelledAtUtc,
        input.tenantId,
        input.requestPublicId,
        request.service_public_id,
        request.requested_quantity,
        request.fulfilled_quantity,
        request.encounter_public_id,
        request.last_event_public_id,
        request.status,
        request.requested_at_utc,
        request.source_evidence_sha256,
      ),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_service_request',
      aggregatePublicId: input.requestPublicId,
      eventType: 'canonical.service_request.cancelled',
      occurredAtUtc: input.cancelledAtUtc,
      businessDate: input.businessDate,
      payload: {
        requestPublicId: input.requestPublicId,
        status: 'cancelled',
        fulfilledQuantity: request.fulfilled_quantity,
      },
    },
  });
}

export async function cancelServiceEvent(
  db: CanonicalBatchDatabase,
  input: CancelServiceEventInput,
): Promise<CanonicalCommandResult<CancelServiceEventResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.eventPublicId, 'eventPublicId');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  exact(input.businessDate, 'businessDate');
  validateUtc(input.cancelledAtUtc, 'cancelledAtUtc');
  const requestFingerprintInput = {
    eventPublicId: input.eventPublicId,
    cancelledAtUtc: input.cancelledAtUtc,
  };
  const replay = await readCanonicalCommandReplay<CancelServiceEventResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_event.cancel',
    idempotencyKey: input.idempotencyKey,
    request: requestFingerprintInput,
  });
  if (replay) return replay;

  const event = await db.prepare(`
    SELECT id,request_public_id,encounter_public_id,service_public_id,event_type,
           quantity,status,occurred_at_utc,cancelled_at_utc,source_evidence_sha256
    FROM canonical_service_events
    WHERE tenant_id=? AND event_public_id=? LIMIT 1
  `).bind(input.tenantId, input.eventPublicId).first<StoredServiceEventRow>();
  if (!event) throw new Error('Canonical service event not found');
  if (event.status !== 'posted' || event.cancelled_at_utc !== null) {
    throw new Error(`Canonical service event cannot be cancelled in status: ${event.status}`);
  }
  if (!event.request_public_id) {
    throw new Error('Canonical service event is not attached to a service request');
  }
  if (Date.parse(input.cancelledAtUtc) < Date.parse(event.occurred_at_utc)) {
    throw new RangeError('Service event cancellation cannot occur before the event');
  }

  const request = await db.prepare(`
    SELECT encounter_public_id,service_public_id,requested_quantity,fulfilled_quantity,
           last_event_public_id,status,requested_at_utc,cancelled_at_utc,source_evidence_sha256
    FROM canonical_service_requests
    WHERE tenant_id=? AND request_public_id=? LIMIT 1
  `).bind(input.tenantId, event.request_public_id).first<StoredRequestRow>();
  if (!request) throw new Error('Canonical service request not found');
  if (request.status === 'cancelled' || request.cancelled_at_utc !== null) {
    throw new Error('Canonical service event cannot be cancelled after request cancellation');
  }
  if (request.last_event_public_id !== input.eventPublicId) {
    throw new Error('Canonical service event cancellation requires the current last event');
  }
  if (
    request.encounter_public_id !== event.encounter_public_id
    || request.service_public_id !== event.service_public_id
  ) {
    throw new Error('Canonical service event request authority is inconsistent');
  }

  const decrement = event.event_type === 'accepted' ? 0 : event.quantity;
  if (request.fulfilled_quantity < decrement) {
    throw new Error('Canonical service-event fulfillment authority is inconsistent');
  }
  const fulfilledQuantity = request.fulfilled_quantity - decrement;
  const requestStatus: CancelServiceEventResult['requestStatus'] =
    fulfilledQuantity === request.requested_quantity
      ? 'fulfilled'
      : fulfilledQuantity > 0
        ? 'partially_fulfilled'
        : 'active';
  const previousEvent = await db.prepare(`
    SELECT event_public_id
    FROM canonical_service_events
    WHERE tenant_id=? AND request_public_id=? AND id<? AND status='posted'
    ORDER BY id DESC LIMIT 1
  `).bind(input.tenantId, event.request_public_id, event.id).first<PreviousServiceEventRow>();
  const previousEventPublicId = previousEvent?.event_public_id ?? null;
  const result: CancelServiceEventResult = {
    eventPublicId: input.eventPublicId,
    requestPublicId: event.request_public_id,
    status: 'cancelled',
    requestStatus,
    fulfilledQuantity,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_event.cancel',
    idempotencyKey: input.idempotencyKey,
    request: requestFingerprintInput,
    statements: [
      db.prepare(`
        UPDATE canonical_service_events
        SET status=CASE WHEN EXISTS (
              SELECT 1 FROM canonical_service_requests r
              WHERE r.tenant_id=? AND r.request_public_id=?
                AND COALESCE(r.encounter_public_id,'')=COALESCE(?,'')
                AND r.service_public_id=? AND r.requested_quantity=?
                AND r.fulfilled_quantity=? AND r.status=?
                AND r.last_event_public_id=? AND r.cancelled_at_utc IS NULL
                AND r.source_evidence_sha256=?
            ) THEN 'cancelled' ELSE NULL END,
            cancelled_at_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND event_public_id=? AND request_public_id=?
          AND COALESCE(encounter_public_id,'')=COALESCE(?,'')
          AND service_public_id=? AND event_type=? AND quantity=?
          AND status='posted' AND occurred_at_utc=? AND cancelled_at_utc IS NULL
          AND source_evidence_sha256=?
      `).bind(
        input.tenantId,
        event.request_public_id,
        request.encounter_public_id,
        request.service_public_id,
        request.requested_quantity,
        request.fulfilled_quantity,
        request.status,
        input.eventPublicId,
        request.source_evidence_sha256,
        input.cancelledAtUtc,
        input.cancelledAtUtc,
        input.tenantId,
        input.eventPublicId,
        event.request_public_id,
        event.encounter_public_id,
        event.service_public_id,
        event.event_type,
        event.quantity,
        event.occurred_at_utc,
        event.source_evidence_sha256,
      ),
      db.prepare(`
        UPDATE canonical_service_requests
        SET fulfilled_quantity=?,
            status=CASE WHEN EXISTS (
              SELECT 1 FROM canonical_service_events e
              WHERE e.tenant_id=? AND e.event_public_id=?
                AND e.request_public_id=?
                AND COALESCE(e.encounter_public_id,'')=COALESCE(?,'')
                AND e.service_public_id=? AND e.event_type=? AND e.quantity=?
                AND e.status='cancelled' AND e.occurred_at_utc=?
                AND e.cancelled_at_utc=? AND e.source_evidence_sha256=?
            ) THEN ? ELSE NULL END,
            last_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND request_public_id=?
          AND COALESCE(encounter_public_id,'')=COALESCE(?,'')
          AND service_public_id=? AND requested_quantity=?
          AND fulfilled_quantity=? AND status=?
          AND last_event_public_id=? AND cancelled_at_utc IS NULL
          AND source_evidence_sha256=?
      `).bind(
        fulfilledQuantity,
        input.tenantId,
        input.eventPublicId,
        event.request_public_id,
        event.encounter_public_id,
        event.service_public_id,
        event.event_type,
        event.quantity,
        event.occurred_at_utc,
        input.cancelledAtUtc,
        event.source_evidence_sha256,
        requestStatus,
        previousEventPublicId,
        input.cancelledAtUtc,
        input.tenantId,
        event.request_public_id,
        request.encounter_public_id,
        request.service_public_id,
        request.requested_quantity,
        request.fulfilled_quantity,
        request.status,
        input.eventPublicId,
        request.source_evidence_sha256,
      ),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_service_event',
      aggregatePublicId: input.eventPublicId,
      eventType: 'canonical.service_event.cancelled',
      occurredAtUtc: input.cancelledAtUtc,
      businessDate: input.businessDate,
      payload: {
        eventPublicId: input.eventPublicId,
        requestPublicId: event.request_public_id,
        status: 'cancelled',
        fulfilledQuantityBefore: request.fulfilled_quantity,
        fulfilledQuantityAfter: fulfilledQuantity,
        requestStatusAfter: requestStatus,
        previousEventPublicId,
      },
    },
  });
}

export async function recordServiceEvent(
  db: CanonicalBatchDatabase,
  input: RecordServiceEventInput,
): Promise<CanonicalCommandResult<RecordServiceEventResult>> {
  validateCommon(input);
  exact(input.tenantId, 'tenantId');
  exact(input.requestPublicId, 'requestPublicId');
  exact(input.eventPublicId, 'eventPublicId');
  positiveSafeInteger(input.quantity, 'quantity');
  validateUtc(input.occurredAtUtc, 'occurredAtUtc');

  const replay = await readCanonicalCommandReplay<RecordServiceEventResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_event.record',
    idempotencyKey: input.idempotencyKey,
    request: recordEventRequest(input),
  });
  if (replay) return replay;

  const request = await db.prepare(`
    SELECT encounter_public_id,service_public_id,requested_quantity,
           fulfilled_quantity,last_event_public_id,status
    FROM canonical_service_requests
    WHERE tenant_id=? AND request_public_id=? LIMIT 1
  `).bind(input.tenantId, input.requestPublicId).first<StoredRequestRow>();
  if (!request) throw new Error('Canonical service request not found');
  if (request.status === 'cancelled' || request.status === 'fulfilled') {
    throw new Error(`Canonical service request cannot accept events in status: ${request.status}`);
  }

  const incrementsFulfillment = input.eventType !== 'accepted';
  const fulfilledQuantity = request.fulfilled_quantity
    + (incrementsFulfillment ? input.quantity : 0);
  if (fulfilledQuantity > request.requested_quantity) {
    throw new RangeError('Service event quantity exceeds the unfulfilled request quantity');
  }
  const requestStatus: RecordServiceEventResult['requestStatus'] =
    fulfilledQuantity === request.requested_quantity
      ? 'fulfilled'
      : fulfilledQuantity > 0
        ? 'partially_fulfilled'
        : 'active';
  const result: RecordServiceEventResult = {
    eventPublicId: input.eventPublicId,
    requestPublicId: input.requestPublicId,
    requestStatus,
    fulfilledQuantity,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_event.record',
    idempotencyKey: input.idempotencyKey,
    request: recordEventRequest(input),
    statements: [
      db.prepare(`
        UPDATE canonical_service_requests
        SET fulfilled_quantity=?,status=?,last_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND request_public_id=?
          AND fulfilled_quantity=?
          AND COALESCE(last_event_public_id,'')=COALESCE(?,'')
          AND status NOT IN ('cancelled','fulfilled')
      `).bind(
        fulfilledQuantity,
        requestStatus,
        input.eventPublicId,
        input.occurredAtUtc,
        input.tenantId,
        input.requestPublicId,
        request.fulfilled_quantity,
        request.last_event_public_id,
      ),
      db.prepare(`
        INSERT INTO canonical_service_events (
          tenant_id,event_public_id,request_public_id,encounter_public_id,
          service_public_id,event_type,quantity,status,occurred_at_utc,
          source_evidence_sha256
        ) VALUES (
          ?,?,?,
          (SELECT encounter_public_id FROM canonical_service_requests
           WHERE tenant_id=? AND request_public_id=? AND last_event_public_id=?),
          (SELECT service_public_id FROM canonical_service_requests
           WHERE tenant_id=? AND request_public_id=? AND last_event_public_id=?),
          ?,?,'posted',?,?
        )
      `).bind(
        input.tenantId,
        input.eventPublicId,
        input.requestPublicId,
        input.tenantId,
        input.requestPublicId,
        input.eventPublicId,
        input.tenantId,
        input.requestPublicId,
        input.eventPublicId,
        input.eventType,
        input.quantity,
        input.occurredAtUtc,
        input.sourceEvidenceSha256,
      ),
      ...participantStatement(db, input.tenantId, input.participant, {
        eventPublicId: input.eventPublicId,
      }),
    ],
    reconciliationStatements: [
      sourceMappingStatement(db, {
        tenantId: input.tenantId,
        entityType: 'service_event',
        canonicalPublicId: input.eventPublicId,
        sourceType: input.sourceType,
        sourcePublicId: input.sourcePublicId,
        sourceTable: input.sourceTable,
        evidenceSha256: input.sourceEvidenceSha256,
      }),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_service_event',
      aggregatePublicId: input.eventPublicId,
      eventType: 'canonical.service_event.recorded',
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        eventPublicId: input.eventPublicId,
        requestPublicId: input.requestPublicId,
        eventType: input.eventType,
        quantity: input.quantity,
        requestStatus,
      },
    },
  });
}

export interface PrepareAcceptedServiceOperationInput extends CommandSourceInput {
  tenantId: string;
  legacyPatientId: number;
  encounterPublicId: string | null;
  servicePublicId: string;
  requestPublicId: string;
  eventPublicId: string;
  quantity: number;
  occurredAtUtc: string;
  participant?: ServiceOperationParticipantInput | null;
  requestIdempotencyKey: string;
  eventIdempotencyKey: string;
  requestOutboxEventPublicId: string;
  eventOutboxEventPublicId: string;
  businessDate: string;
  preparedEncounter?: {
    encounterPublicId: string;
    legacyPatientId: number;
  } | null;
  preparedService?: {
    servicePublicId: string;
    sourceEvidenceSha256: string;
  } | null;
  authoritativeStatements?: readonly CanonicalPreparedStatement[];
}

export interface PreparedAcceptedServiceOperation {
  status: 'prepared' | 'replayed';
  requestPublicId: string;
  eventPublicId: string;
  statements: readonly CanonicalPreparedStatement[];
}

interface ExactEncounterRow {
  legacy_patient_id: number;
  status: string;
}

interface ExactPatientLinkCountRow {
  link_count: number;
}

interface ExactServiceRow {
  status: string;
}

interface ExactPractitionerRow {
  status: string;
}

interface ExactMappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}

async function requireAcceptedServiceScope(
  db: CanonicalBatchDatabase,
  input: PrepareAcceptedServiceOperationInput,
): Promise<void> {
  if (input.encounterPublicId == null) {
    if (input.preparedEncounter) {
      throw new Error('planned service without an encounter cannot include prepared encounter evidence');
    }
    const patientLinks = await db.prepare(`
      SELECT COUNT(*) AS link_count
      FROM canonical_tenant_patient_links
      WHERE tenant_id=? AND legacy_patient_id=?
        AND effective_to_utc IS NULL
        AND link_status NOT IN ('rejected','retired')
    `).bind(input.tenantId, input.legacyPatientId).first<ExactPatientLinkCountRow>();
    if (Number(patientLinks?.link_count ?? 0) !== 1) {
      throw new Error('planned service acceptance requires one exact active tenant patient link');
    }
  } else if (input.preparedEncounter) {
    if (
      exact(input.preparedEncounter.encounterPublicId, 'preparedEncounter.encounterPublicId') !== input.encounterPublicId
      || positiveSafeInteger(input.preparedEncounter.legacyPatientId, 'preparedEncounter.legacyPatientId') !== input.legacyPatientId
    ) {
      throw new Error('prepared service encounter evidence does not match the accepted service scope');
    }
  } else {
    const encounter = await db.prepare(`
      SELECT legacy_patient_id,status
      FROM canonical_encounters
      WHERE tenant_id=? AND encounter_public_id=?
      LIMIT 1
    `).bind(input.tenantId, input.encounterPublicId).first<ExactEncounterRow>();
    if (!encounter || Number(encounter.legacy_patient_id) !== input.legacyPatientId) {
      throw new Error('service acceptance requires an exact encounter and patient match');
    }
    if (!['planned', 'in_progress'].includes(String(encounter.status))) {
      throw new Error('service acceptance requires an active encounter');
    }
  }

  if (input.preparedService) {
    if (
      exact(input.preparedService.servicePublicId, 'preparedService.servicePublicId') !== input.servicePublicId
      || validateHash(input.preparedService.sourceEvidenceSha256) !== input.preparedService.sourceEvidenceSha256
    ) {
      throw new Error('prepared service evidence does not match the accepted service scope');
    }
  } else {
    const service = await db.prepare(`
      SELECT status
      FROM canonical_service_catalog_items
      WHERE tenant_id=? AND service_public_id=?
      LIMIT 1
    `).bind(input.tenantId, input.servicePublicId).first<ExactServiceRow>();
    if (!service || service.status !== 'active') {
      throw new Error('service acceptance requires an active canonical service');
    }
  }

  if (input.participant) {
    const practitioner = await db.prepare(`
      SELECT status
      FROM canonical_practitioners
      WHERE tenant_id=? AND practitioner_public_id=?
      LIMIT 1
    `).bind(input.tenantId, input.participant.practitionerPublicId).first<ExactPractitionerRow>();
    if (!practitioner || practitioner.status !== 'active') {
      throw new Error('service acceptance requires an active practitioner participant');
    }
  }

  for (const [entityType, canonicalPublicId] of [
    ['service_request', input.requestPublicId],
    ['service_event', input.eventPublicId],
  ] as const) {
    const mapping = await db.prepare(`
      SELECT canonical_public_id,mapping_status,evidence_sha256
      FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
      LIMIT 1
    `).bind(
      input.tenantId,
      entityType,
      input.sourceType,
      input.sourcePublicId,
    ).first<ExactMappingRow>();
    if (mapping && (
      mapping.mapping_status !== 'mapped'
      || mapping.canonical_public_id !== canonicalPublicId
      || mapping.evidence_sha256 !== input.sourceEvidenceSha256
    )) {
      throw new Error(`service ${entityType} source mapping conflicts with route evidence`);
    }
  }
}

/**
 * Prepares the frozen createServiceRequest + recordServiceEvent(accepted) commands
 * as one outer batch. Billing/queue acceptance is not treated as delivered care.
 */
export async function prepareAcceptedServiceOperationBatch(
  db: CanonicalBatchDatabase,
  input: PrepareAcceptedServiceOperationInput,
): Promise<PreparedAcceptedServiceOperation> {
  validateCommon({
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
    idempotencyKey: input.requestIdempotencyKey,
    outboxEventPublicId: input.requestOutboxEventPublicId,
    businessDate: input.businessDate,
  });
  exact(input.tenantId, 'tenantId');
  if (input.encounterPublicId != null) exact(input.encounterPublicId, 'encounterPublicId');
  exact(input.servicePublicId, 'servicePublicId');
  exact(input.requestPublicId, 'requestPublicId');
  exact(input.eventPublicId, 'eventPublicId');
  exact(input.eventIdempotencyKey, 'eventIdempotencyKey');
  exact(input.eventOutboxEventPublicId, 'eventOutboxEventPublicId');
  positiveSafeInteger(input.legacyPatientId, 'legacyPatientId');
  positiveSafeInteger(input.quantity, 'quantity');
  validateUtc(input.occurredAtUtc, 'occurredAtUtc');

  const requestResult: CreateServiceRequestResult = {
    requestPublicId: input.requestPublicId,
    status: 'active',
  };
  const requestPrepared = await prepareCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_request.create',
    idempotencyKey: input.requestIdempotencyKey,
    request: {
      requestPublicId: input.requestPublicId,
      legacyPatientId: input.legacyPatientId,
      encounterPublicId: input.encounterPublicId,
      servicePublicId: input.servicePublicId,
      requestedQuantity: input.quantity,
      requestedAtUtc: input.occurredAtUtc,
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
      sourceTable: input.sourceTable,
      sourceEvidenceSha256: input.sourceEvidenceSha256,
    },
    authoritativeStatements: input.authoritativeStatements,
    statements: [
      db.prepare(`
        INSERT INTO canonical_service_requests (
          tenant_id,request_public_id,legacy_patient_id,encounter_public_id,
          service_public_id,requested_quantity,fulfilled_quantity,last_event_public_id,
          status,requested_at_utc,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,0,NULL,'active',?,?)
      `).bind(
        input.tenantId,
        input.requestPublicId,
        input.legacyPatientId,
        input.encounterPublicId,
        input.servicePublicId,
        input.quantity,
        input.occurredAtUtc,
        input.sourceEvidenceSha256,
      ),
    ],
    reconciliationStatements: [
      sourceMappingStatement(db, {
        tenantId: input.tenantId,
        entityType: 'service_request',
        canonicalPublicId: input.requestPublicId,
        sourceType: input.sourceType,
        sourcePublicId: input.sourcePublicId,
        sourceTable: input.sourceTable,
        evidenceSha256: input.sourceEvidenceSha256,
      }),
    ],
    result: requestResult,
    event: {
      eventPublicId: input.requestOutboxEventPublicId,
      aggregateType: 'canonical_service_request',
      aggregatePublicId: input.requestPublicId,
      eventType: 'canonical.service_request.created',
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        requestPublicId: input.requestPublicId,
        servicePublicId: input.servicePublicId,
        requestedQuantity: input.quantity,
        status: 'active',
      },
    },
  });

  const eventResult: RecordServiceEventResult = {
    eventPublicId: input.eventPublicId,
    requestPublicId: input.requestPublicId,
    requestStatus: 'active',
    fulfilledQuantity: 0,
  };
  const eventPrepared = await prepareCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_event.record',
    idempotencyKey: input.eventIdempotencyKey,
    request: {
      requestPublicId: input.requestPublicId,
      eventPublicId: input.eventPublicId,
      eventType: 'accepted',
      quantity: input.quantity,
      occurredAtUtc: input.occurredAtUtc,
      participant: input.participant ?? null,
      sourceType: input.sourceType,
      sourcePublicId: input.sourcePublicId,
      sourceTable: input.sourceTable,
      sourceEvidenceSha256: input.sourceEvidenceSha256,
    },
    statements: [
      db.prepare(`
        UPDATE canonical_service_requests
        SET last_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND request_public_id=?
          AND legacy_patient_id=?
          AND COALESCE(encounter_public_id,'')=COALESCE(?,'')
          AND service_public_id=?
          AND requested_quantity=? AND fulfilled_quantity=0
          AND last_event_public_id IS NULL AND status='active'
          AND requested_at_utc=? AND source_evidence_sha256=?
      `).bind(
        input.eventPublicId,
        input.occurredAtUtc,
        input.tenantId,
        input.requestPublicId,
        input.legacyPatientId,
        input.encounterPublicId,
        input.servicePublicId,
        input.quantity,
        input.occurredAtUtc,
        input.sourceEvidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_service_events (
          tenant_id,event_public_id,request_public_id,encounter_public_id,
          service_public_id,event_type,quantity,status,occurred_at_utc,
          source_evidence_sha256
        )
        SELECT ?,?,?,encounter_public_id,service_public_id,'accepted',?,'posted',?,?
        FROM canonical_service_requests
        WHERE tenant_id=? AND request_public_id=? AND last_event_public_id=?
          AND legacy_patient_id=? AND requested_quantity=?
          AND fulfilled_quantity=0 AND status='active'
      `).bind(
        input.tenantId,
        input.eventPublicId,
        input.requestPublicId,
        input.quantity,
        input.occurredAtUtc,
        input.sourceEvidenceSha256,
        input.tenantId,
        input.requestPublicId,
        input.eventPublicId,
        input.legacyPatientId,
        input.quantity,
      ),
      ...participantStatement(db, input.tenantId, input.participant, {
        eventPublicId: input.eventPublicId,
      }),
    ],
    reconciliationStatements: [
      sourceMappingStatement(db, {
        tenantId: input.tenantId,
        entityType: 'service_event',
        canonicalPublicId: input.eventPublicId,
        sourceType: input.sourceType,
        sourcePublicId: input.sourcePublicId,
        sourceTable: input.sourceTable,
        evidenceSha256: input.sourceEvidenceSha256,
      }),
    ],
    result: eventResult,
    event: {
      eventPublicId: input.eventOutboxEventPublicId,
      aggregateType: 'canonical_service_event',
      aggregatePublicId: input.eventPublicId,
      eventType: 'canonical.service_event.recorded',
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        eventPublicId: input.eventPublicId,
        requestPublicId: input.requestPublicId,
        eventType: 'accepted',
        quantity: input.quantity,
        requestStatus: 'active',
      },
    },
  });

  if (requestPrepared.status !== eventPrepared.status) {
    throw new Error('service acceptance command receipts are partially committed');
  }
  if (requestPrepared.status === 'replayed') {
    return {
      status: 'replayed',
      requestPublicId: input.requestPublicId,
      eventPublicId: input.eventPublicId,
      statements: [],
    };
  }
  await requireAcceptedServiceScope(db, input);
  return {
    status: 'prepared',
    requestPublicId: input.requestPublicId,
    eventPublicId: input.eventPublicId,
    statements: [...requestPrepared.statements, ...eventPrepared.statements],
  };
}

export interface PrepareCancelServiceEventOperationInput extends CancelServiceEventInput {
  sourceEvidenceSha256: string;
  outboxEventPublicId: string;
  authoritativeStatements?: readonly CanonicalPreparedStatement[];
}

export async function prepareCancelServiceEventOperationBatch(
  db: CanonicalBatchDatabase,
  input: PrepareCancelServiceEventOperationInput,
): Promise<PreparedCanonicalBatch<CancelServiceEventResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.eventPublicId, 'eventPublicId');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  exact(input.businessDate, 'businessDate');
  validateHash(input.sourceEvidenceSha256);
  validateUtc(input.cancelledAtUtc, 'cancelledAtUtc');
  const requestFingerprintInput = {
    eventPublicId: input.eventPublicId,
    cancelledAtUtc: input.cancelledAtUtc,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<CancelServiceEventResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_event.cancel',
    idempotencyKey: input.idempotencyKey,
    request: requestFingerprintInput,
  });
  if (replay) return { status: 'replayed', result: replay.result, statements: [] };

  const event = await db.prepare(`
    SELECT id,request_public_id,encounter_public_id,service_public_id,event_type,
           quantity,status,occurred_at_utc,cancelled_at_utc,source_evidence_sha256
    FROM canonical_service_events
    WHERE tenant_id=? AND event_public_id=? LIMIT 1
  `).bind(input.tenantId, input.eventPublicId).first<StoredServiceEventRow>();
  if (!event) throw new Error('Canonical service event not found');
  if (event.status !== 'posted' || event.cancelled_at_utc !== null) {
    throw new Error(`Canonical service event cannot be cancelled in status: ${event.status}`);
  }
  if (!event.request_public_id) throw new Error('Canonical service event is not attached to a service request');
  if (Date.parse(input.cancelledAtUtc) < Date.parse(event.occurred_at_utc)) {
    throw new RangeError('Service event cancellation cannot occur before the event');
  }

  const request = await db.prepare(`
    SELECT encounter_public_id,service_public_id,requested_quantity,fulfilled_quantity,
           last_event_public_id,status,requested_at_utc,cancelled_at_utc,source_evidence_sha256
    FROM canonical_service_requests
    WHERE tenant_id=? AND request_public_id=? LIMIT 1
  `).bind(input.tenantId, event.request_public_id).first<StoredRequestRow>();
  if (!request) throw new Error('Canonical service request not found');
  if (request.status === 'cancelled' || request.cancelled_at_utc !== null) {
    throw new Error('Canonical service event cannot be cancelled after request cancellation');
  }
  if (request.last_event_public_id !== input.eventPublicId) {
    throw new Error('Canonical service event cancellation requires the current last event');
  }
  if (request.encounter_public_id !== event.encounter_public_id || request.service_public_id !== event.service_public_id) {
    throw new Error('Canonical service event request authority is inconsistent');
  }

  const decrement = event.event_type === 'accepted' ? 0 : event.quantity;
  if (request.fulfilled_quantity < decrement) {
    throw new Error('Canonical service-event fulfillment authority is inconsistent');
  }
  const fulfilledQuantity = request.fulfilled_quantity - decrement;
  const requestStatus: CancelServiceEventResult['requestStatus'] =
    fulfilledQuantity === request.requested_quantity
      ? 'fulfilled'
      : fulfilledQuantity > 0
        ? 'partially_fulfilled'
        : 'active';
  const previousEvent = await db.prepare(`
    SELECT event_public_id
    FROM canonical_service_events
    WHERE tenant_id=? AND request_public_id=? AND id<? AND status='posted'
    ORDER BY id DESC LIMIT 1
  `).bind(input.tenantId, event.request_public_id, event.id).first<PreviousServiceEventRow>();
  const previousEventPublicId = previousEvent?.event_public_id ?? null;
  const result: CancelServiceEventResult = {
    eventPublicId: input.eventPublicId,
    requestPublicId: event.request_public_id,
    status: 'cancelled',
    requestStatus,
    fulfilledQuantity,
  };

  return prepareCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.service_event.cancel',
    idempotencyKey: input.idempotencyKey,
    request: requestFingerprintInput,
    authoritativeStatements: input.authoritativeStatements,
    statements: [
      db.prepare(`
        UPDATE canonical_service_events
        SET status=CASE WHEN EXISTS (
              SELECT 1 FROM canonical_service_requests r
              WHERE r.tenant_id=? AND r.request_public_id=?
                AND COALESCE(r.encounter_public_id,'')=COALESCE(?,'')
                AND r.service_public_id=? AND r.requested_quantity=?
                AND r.fulfilled_quantity=? AND r.status=?
                AND r.last_event_public_id=? AND r.cancelled_at_utc IS NULL
                AND r.source_evidence_sha256=?
            ) THEN 'cancelled' ELSE NULL END,
            cancelled_at_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND event_public_id=? AND request_public_id=?
          AND COALESCE(encounter_public_id,'')=COALESCE(?,'')
          AND service_public_id=? AND event_type=? AND quantity=?
          AND status='posted' AND occurred_at_utc=? AND cancelled_at_utc IS NULL
          AND source_evidence_sha256=?
      `).bind(
        input.tenantId,
        event.request_public_id,
        request.encounter_public_id,
        request.service_public_id,
        request.requested_quantity,
        request.fulfilled_quantity,
        request.status,
        input.eventPublicId,
        request.source_evidence_sha256,
        input.cancelledAtUtc,
        input.cancelledAtUtc,
        input.tenantId,
        input.eventPublicId,
        event.request_public_id,
        event.encounter_public_id,
        event.service_public_id,
        event.event_type,
        event.quantity,
        event.occurred_at_utc,
        event.source_evidence_sha256,
      ),
      db.prepare(`
        UPDATE canonical_service_requests
        SET fulfilled_quantity=?,
            status=CASE WHEN EXISTS (
              SELECT 1 FROM canonical_service_events e
              WHERE e.tenant_id=? AND e.event_public_id=?
                AND e.request_public_id=?
                AND COALESCE(e.encounter_public_id,'')=COALESCE(?,'')
                AND e.service_public_id=? AND e.event_type=? AND e.quantity=?
                AND e.status='cancelled' AND e.occurred_at_utc=?
                AND e.cancelled_at_utc=? AND e.source_evidence_sha256=?
            ) THEN ? ELSE NULL END,
            last_event_public_id=?,updated_at_utc=?
        WHERE tenant_id=? AND request_public_id=?
          AND COALESCE(encounter_public_id,'')=COALESCE(?,'')
          AND service_public_id=? AND requested_quantity=?
          AND fulfilled_quantity=? AND status=?
          AND last_event_public_id=? AND cancelled_at_utc IS NULL
          AND source_evidence_sha256=?
      `).bind(
        fulfilledQuantity,
        input.tenantId,
        input.eventPublicId,
        event.request_public_id,
        event.encounter_public_id,
        event.service_public_id,
        event.event_type,
        event.quantity,
        event.occurred_at_utc,
        input.cancelledAtUtc,
        event.source_evidence_sha256,
        requestStatus,
        previousEventPublicId,
        input.cancelledAtUtc,
        input.tenantId,
        event.request_public_id,
        request.encounter_public_id,
        request.service_public_id,
        request.requested_quantity,
        request.fulfilled_quantity,
        request.status,
        input.eventPublicId,
        request.source_evidence_sha256,
      ),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_service_event',
      aggregatePublicId: input.eventPublicId,
      eventType: 'canonical.service_event.cancelled',
      occurredAtUtc: input.cancelledAtUtc,
      businessDate: input.businessDate,
      payload: {
        eventPublicId: input.eventPublicId,
        requestPublicId: event.request_public_id,
        status: 'cancelled',
        fulfilledQuantityBefore: request.fulfilled_quantity,
        fulfilledQuantityAfter: fulfilledQuantity,
        requestStatusAfter: requestStatus,
        previousEventPublicId,
      },
    },
  });
}
