import {
  prepareCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalPreparedStatement,
} from './command-batch';
import {
  prepareAcceptedServiceOperationBatch,
  prepareCancelServiceEventOperationBatch,
  type ServiceOperationParticipantInput,
} from './commands/service-operations';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';

export interface PrepareAcceptedServiceRouteInput {
  tenantId: string;
  legacyPatientId: number;
  encounterPublicId: string | null;
  servicePublicId: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  quantity: number;
  occurredAtUtc: string;
  sourceEvidence: unknown;
  participant?: ServiceOperationParticipantInput | null;
  idempotencyKey: string;
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

export interface PreparedAcceptedServiceRouteBatch {
  status: 'prepared' | 'replayed';
  requestPublicId: string;
  eventPublicId: string;
  statements: readonly CanonicalPreparedStatement[];
}

export interface PrepareServiceRouteCancellationInput {
  tenantId: string;
  sourceType: string;
  sourcePublicId: string;
  cancelledAtUtc: string;
  sourceEvidence: unknown;
  idempotencyKey: string;
  businessDate: string;
  authoritativeStatements?: readonly CanonicalPreparedStatement[];
}

export interface PrepareAcceptedAndCancelledServiceRouteInput {
  tenantId: string;
  legacyPatientId: number;
  encounterPublicId: string | null;
  servicePublicId: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  quantity: number;
  occurredAtUtc: string;
  acceptedSourceEvidence: unknown;
  cancelledAtUtc: string;
  cancellationSourceEvidence: unknown;
  participant?: ServiceOperationParticipantInput | null;
  acceptanceIdempotencyKey: string;
  cancellationIdempotencyKey: string;
  businessDate: string;
  preparedService?: {
    servicePublicId: string;
    sourceEvidenceSha256: string;
  } | null;
  acceptanceStatements?: readonly CanonicalPreparedStatement[];
  cancellationStatements?: readonly CanonicalPreparedStatement[];
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return normalized;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

interface ConsultationServiceRow {
  item_kind: string;
  canonical_code: string | null;
  display_name: string;
  unit_code: string;
  status: string;
  source_evidence_sha256: string;
}

interface ConsultationServiceMappingRow extends MappingRow {
  evidence_sha256: string | null;
}

export async function prepareProtectedConsultationService(
  db: CanonicalBatchDatabase,
  tenantIdInput: string,
): Promise<{
  servicePublicId: string;
  sourceEvidenceSha256: string;
  statements: readonly CanonicalPreparedStatement[];
}> {
  const tenantId = exact(tenantIdInput, 'tenantId');
  const sourceType = 'protected_consultation_service';
  const sourcePublicId = 'consultation';
  const servicePublicId = await createDeterministicSourceId(
    'svc', tenantId, sourceType, sourcePublicId,
  );
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType,
    sourcePublicId,
    itemKind: 'consultation',
    canonicalCode: 'PROTECTED-CONSULTATION',
    displayName: 'Consultation',
    unitCode: 'service',
    status: 'active',
    priceAuthority: 'excluded',
  });
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='service_catalog_item'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, sourceType, sourcePublicId).first<ConsultationServiceMappingRow>();
  const service = await db.prepare(`
    SELECT item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
    FROM canonical_service_catalog_items
    WHERE tenant_id=? AND service_public_id=?
    LIMIT 1
  `).bind(tenantId, servicePublicId).first<ConsultationServiceRow>();

  if (mapping || service) {
    if (
      mapping?.mapping_status !== 'mapped'
      || mapping.canonical_public_id !== servicePublicId
      || mapping.evidence_sha256 !== sourceEvidenceSha256
      || service?.item_kind !== 'consultation'
      || service.canonical_code !== 'PROTECTED-CONSULTATION'
      || service.display_name !== 'Consultation'
      || service.unit_code !== 'service'
      || service.status !== 'active'
      || service.source_evidence_sha256 !== sourceEvidenceSha256
    ) {
      throw new Error('protected consultation service identity conflicts with canonical catalog evidence');
    }
    return { servicePublicId, sourceEvidenceSha256, statements: [] };
  }

  const codeOwner = await db.prepare(`
    SELECT service_public_id
    FROM canonical_service_catalog_items
    WHERE tenant_id=? AND canonical_code='PROTECTED-CONSULTATION'
    LIMIT 1
  `).bind(tenantId).first<{ service_public_id: string }>();
  if (codeOwner && codeOwner.service_public_id !== servicePublicId) {
    throw new Error('protected consultation service code already belongs to another service');
  }

  return {
    servicePublicId,
    sourceEvidenceSha256,
    statements: [
      db.prepare(`
        INSERT INTO canonical_service_catalog_items (
          tenant_id,service_public_id,item_kind,canonical_code,display_name,
          unit_code,status,source_evidence_sha256
        ) VALUES (?,?,'consultation','PROTECTED-CONSULTATION','Consultation','service','active',?)
      `).bind(tenantId, servicePublicId, sourceEvidenceSha256),
      db.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES (?,'service_catalog_item',?,?,?,'canonical_service_catalog_items','mapped',1,?)
      `).bind(
        tenantId,
        servicePublicId,
        sourceType,
        sourcePublicId,
        sourceEvidenceSha256,
      ),
    ],
  };
}

export async function prepareAcceptedServiceRouteBatch(
  db: CanonicalBatchDatabase,
  input: PrepareAcceptedServiceRouteInput,
): Promise<PreparedAcceptedServiceRouteBatch> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourceType = exact(input.sourceType, 'sourceType');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(input.sourceTable, 'sourceTable');
  const idempotencyKey = exact(input.idempotencyKey, 'idempotencyKey');
  const requestPublicId = await createDeterministicSourceId(
    'svcreq', tenantId, sourceType, sourcePublicId,
  );
  const eventPublicId = await createDeterministicSourceId(
    'svcevt', tenantId, sourceType, sourcePublicId,
  );
  const sourceEvidenceSha256 = await createSourceEvidenceSha256(input.sourceEvidence);

  return prepareAcceptedServiceOperationBatch(db, {
    tenantId,
    legacyPatientId: positive(input.legacyPatientId, 'legacyPatientId'),
    encounterPublicId: input.encounterPublicId == null
      ? null
      : exact(input.encounterPublicId, 'encounterPublicId'),
    servicePublicId: exact(input.servicePublicId, 'servicePublicId'),
    requestPublicId,
    eventPublicId,
    quantity: positive(input.quantity, 'quantity'),
    occurredAtUtc: exact(input.occurredAtUtc, 'occurredAtUtc'),
    participant: input.participant ?? null,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256,
    requestIdempotencyKey: `${idempotencyKey}:request`,
    eventIdempotencyKey: `${idempotencyKey}:event`,
    requestOutboxEventPublicId: await createDeterministicSourceId(
      'outevt', tenantId, 'service_request_route', `${sourceType}:${sourcePublicId}`,
    ),
    eventOutboxEventPublicId: await createDeterministicSourceId(
      'outevt', tenantId, 'service_event_route', `${sourceType}:${sourcePublicId}`,
    ),
    businessDate: exact(input.businessDate, 'businessDate'),
    preparedEncounter: input.preparedEncounter ?? null,
    preparedService: input.preparedService ?? null,
    authoritativeStatements: input.authoritativeStatements ?? [],
  });
}

export async function prepareAcceptedAndCancelledServiceRouteBatch(
  db: CanonicalBatchDatabase,
  input: PrepareAcceptedAndCancelledServiceRouteInput,
): Promise<PreparedAcceptedServiceRouteBatch> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourceType = exact(input.sourceType, 'sourceType');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const sourceTable = exact(input.sourceTable, 'sourceTable');
  const servicePublicId = exact(input.servicePublicId, 'servicePublicId');
  const occurredAtUtc = exact(input.occurredAtUtc, 'occurredAtUtc');
  const cancelledAtUtc = exact(input.cancelledAtUtc, 'cancelledAtUtc');
  if (new Date(occurredAtUtc).toISOString() !== occurredAtUtc) {
    throw new RangeError('occurredAtUtc must be a normalized UTC ISO timestamp');
  }
  if (new Date(cancelledAtUtc).toISOString() !== cancelledAtUtc) {
    throw new RangeError('cancelledAtUtc must be a normalized UTC ISO timestamp');
  }
  if (Date.parse(cancelledAtUtc) < Date.parse(occurredAtUtc)) {
    throw new RangeError('service cancellation cannot occur before acceptance');
  }
  const quantity = positive(input.quantity, 'quantity');
  const requestPublicId = await createDeterministicSourceId(
    'svcreq', tenantId, sourceType, sourcePublicId,
  );
  const eventPublicId = await createDeterministicSourceId(
    'svcevt', tenantId, sourceType, sourcePublicId,
  );
  const acceptedSourceEvidenceSha256 = await createSourceEvidenceSha256(input.acceptedSourceEvidence);
  const cancellationSourceEvidenceSha256 = await createSourceEvidenceSha256(
    input.cancellationSourceEvidence,
  );
  const acceptanceKey = exact(input.acceptanceIdempotencyKey, 'acceptanceIdempotencyKey');
  const cancellationKey = exact(input.cancellationIdempotencyKey, 'cancellationIdempotencyKey');
  const businessDate = exact(input.businessDate, 'businessDate');

  const acceptance = await prepareAcceptedServiceOperationBatch(db, {
    tenantId,
    legacyPatientId: positive(input.legacyPatientId, 'legacyPatientId'),
    encounterPublicId: input.encounterPublicId == null
      ? null
      : exact(input.encounterPublicId, 'encounterPublicId'),
    servicePublicId,
    requestPublicId,
    eventPublicId,
    quantity,
    occurredAtUtc,
    participant: input.participant ?? null,
    sourceType,
    sourcePublicId,
    sourceTable,
    sourceEvidenceSha256: acceptedSourceEvidenceSha256,
    requestIdempotencyKey: `${acceptanceKey}:request`,
    eventIdempotencyKey: `${acceptanceKey}:event`,
    requestOutboxEventPublicId: await createDeterministicSourceId(
      'outevt', tenantId, 'service_request_route', `${sourceType}:${sourcePublicId}`,
    ),
    eventOutboxEventPublicId: await createDeterministicSourceId(
      'outevt', tenantId, 'service_event_route', `${sourceType}:${sourcePublicId}`,
    ),
    businessDate,
    preparedService: input.preparedService ?? null,
    authoritativeStatements: input.acceptanceStatements ?? [],
  });

  const cancellationResult = {
    eventPublicId,
    requestPublicId,
    status: 'cancelled' as const,
    requestStatus: 'active' as const,
    fulfilledQuantity: 0,
  };
  const cancellation = await prepareCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.service_event.cancel',
    idempotencyKey: cancellationKey,
    request: {
      eventPublicId,
      cancelledAtUtc,
      sourceEvidenceSha256: cancellationSourceEvidenceSha256,
    },
    authoritativeStatements: input.cancellationStatements ?? [],
    statements: [
      db.prepare(`
        UPDATE canonical_service_events
        SET status=CASE WHEN EXISTS (
              SELECT 1 FROM canonical_service_requests r
              WHERE r.tenant_id=? AND r.request_public_id=?
                AND COALESCE(r.encounter_public_id,'')=COALESCE(?,'')
                AND r.service_public_id=? AND r.requested_quantity=?
                AND r.fulfilled_quantity=0 AND r.status='active'
                AND r.last_event_public_id=? AND r.cancelled_at_utc IS NULL
                AND r.source_evidence_sha256=?
            ) THEN 'cancelled' ELSE NULL END,
            cancelled_at_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND event_public_id=? AND request_public_id=?
          AND COALESCE(encounter_public_id,'')=COALESCE(?,'')
          AND service_public_id=? AND event_type='accepted' AND quantity=?
          AND status='posted' AND occurred_at_utc=? AND cancelled_at_utc IS NULL
          AND source_evidence_sha256=?
      `).bind(
        tenantId,
        requestPublicId,
        input.encounterPublicId,
        servicePublicId,
        quantity,
        eventPublicId,
        acceptedSourceEvidenceSha256,
        cancelledAtUtc,
        cancelledAtUtc,
        tenantId,
        eventPublicId,
        requestPublicId,
        input.encounterPublicId,
        servicePublicId,
        quantity,
        occurredAtUtc,
        acceptedSourceEvidenceSha256,
      ),
      db.prepare(`
        UPDATE canonical_service_requests
        SET status=CASE WHEN EXISTS (
              SELECT 1 FROM canonical_service_events e
              WHERE e.tenant_id=? AND e.event_public_id=?
                AND e.request_public_id=?
                AND COALESCE(e.encounter_public_id,'')=COALESCE(?,'')
                AND e.service_public_id=? AND e.event_type='accepted' AND e.quantity=?
                AND e.status='cancelled' AND e.occurred_at_utc=?
                AND e.cancelled_at_utc=? AND e.source_evidence_sha256=?
            ) THEN 'active' ELSE NULL END,
            last_event_public_id=NULL,updated_at_utc=?
        WHERE tenant_id=? AND request_public_id=?
          AND COALESCE(encounter_public_id,'')=COALESCE(?,'')
          AND service_public_id=? AND requested_quantity=?
          AND fulfilled_quantity=0 AND status='active'
          AND last_event_public_id=? AND cancelled_at_utc IS NULL
          AND source_evidence_sha256=?
      `).bind(
        tenantId,
        eventPublicId,
        requestPublicId,
        input.encounterPublicId,
        servicePublicId,
        quantity,
        occurredAtUtc,
        cancelledAtUtc,
        acceptedSourceEvidenceSha256,
        cancelledAtUtc,
        tenantId,
        requestPublicId,
        input.encounterPublicId,
        servicePublicId,
        quantity,
        eventPublicId,
        acceptedSourceEvidenceSha256,
      ),
    ],
    result: cancellationResult,
    event: {
      eventPublicId: await createDeterministicSourceId(
        'outevt', tenantId, 'service_event_route_cancel', `${sourceType}:${sourcePublicId}`,
      ),
      aggregateType: 'canonical_service_event',
      aggregatePublicId: eventPublicId,
      eventType: 'canonical.service_event.cancelled',
      occurredAtUtc: cancelledAtUtc,
      businessDate,
      payload: {
        eventPublicId,
        requestPublicId,
        status: 'cancelled',
        fulfilledQuantityBefore: 0,
        fulfilledQuantityAfter: 0,
        requestStatusAfter: 'active',
        previousEventPublicId: null,
      },
    },
  });

  if (acceptance.status === 'prepared' && cancellation.status === 'replayed') {
    throw new Error('service bootstrap cancellation receipt exists without accepted service receipt');
  }
  if (acceptance.status === 'replayed' && cancellation.status === 'replayed') {
    return { status: 'replayed', requestPublicId, eventPublicId, statements: [] };
  }
  return {
    status: 'prepared',
    requestPublicId,
    eventPublicId,
    statements: [
      ...(acceptance.status === 'prepared' ? acceptance.statements : []),
      ...(cancellation.status === 'prepared' ? cancellation.statements : []),
    ],
  };
}

export async function prepareServiceRouteCancellationBatch(
  db: CanonicalBatchDatabase,
  input: PrepareServiceRouteCancellationInput,
) {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourceType = exact(input.sourceType, 'sourceType');
  const sourcePublicId = exact(input.sourcePublicId, 'sourcePublicId');
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='service_event'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, sourceType, sourcePublicId).first<MappingRow>();
  if (mapping?.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error('service cancellation requires one exact mapped service event');
  }

  const sourceEvidenceSha256 = await createSourceEvidenceSha256(input.sourceEvidence);
  return prepareCancelServiceEventOperationBatch(db, {
    tenantId,
    eventPublicId: mapping.canonical_public_id,
    cancelledAtUtc: exact(input.cancelledAtUtc, 'cancelledAtUtc'),
    sourceEvidenceSha256,
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    outboxEventPublicId: await createDeterministicSourceId(
      'outevt', tenantId, 'service_event_route_cancel', `${sourceType}:${sourcePublicId}`,
    ),
    businessDate: exact(input.businessDate, 'businessDate'),
    authoritativeStatements: input.authoritativeStatements ?? [],
  });
}
