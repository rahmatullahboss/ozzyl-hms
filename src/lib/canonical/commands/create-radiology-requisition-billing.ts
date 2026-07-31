import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../financial-batch-assertion';
import { stableCanonicalJson } from '../idempotency';
import { buildLegacyLiveInvoiceSourceLineId } from '../live-invoice-line-identity';
import { prepareCanonicalBillingServiceMapping } from '../live-service-catalog-recovery';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../source-mapping';
import { toUtcIso } from '../time';
import { prepareInvoiceSettlementBatch } from './issue-invoice-settlement';

export interface CreateRadiologyRequisitionBillingInput {
  tenantId: string;
  commandIdempotencyKey: string;
  accessionNo: string;
  invoiceNo: string;
  legacyPatientId: number;
  imagingItemId: number;
  billingServiceItemId: number;
  displayName: string;
  totalMinor: number;
  requestedAtUtc: string;
  businessDate: string;
}

export interface CreateRadiologyRequisitionBillingResult {
  accessionNo: string;
  invoiceNo: string;
  requestPublicId: string;
  eventPublicId: string;
  servicePublicId: string;
  invoicePublicId: string;
  invoiceLinePublicId: string;
  totalMinor: number;
}

function exact(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  if (normalized !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function businessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('businessDate must use YYYY-MM-DD');
  }
  return value;
}

function actualRequisitionMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'service_request' | 'service_event';
    canonicalPublicId: string;
    accessionNo: string;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    )
    SELECT ?,?,?, 'legacy_radiology_requisition',CAST(r.id AS TEXT),
           'radiology_requisitions','mapped',1,?
    FROM radiology_requisitions r
    WHERE CAST(r.tenant_id AS TEXT)=? AND r.accession_no=?
    ORDER BY r.id DESC
    LIMIT 1
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.evidenceSha256,
    input.tenantId,
    input.accessionNo,
  );
}

export async function createRadiologyRequisitionBilling(
  db: CanonicalBatchDatabase,
  input: CreateRadiologyRequisitionBillingInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CreateRadiologyRequisitionBillingResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const commandIdempotencyKey = exact(input.commandIdempotencyKey, 'commandIdempotencyKey');
  const accessionNo = exact(input.accessionNo, 'accessionNo');
  const invoiceNo = exact(input.invoiceNo, 'invoiceNo');
  const legacyPatientId = positive(input.legacyPatientId, 'legacyPatientId');
  const imagingItemId = positive(input.imagingItemId, 'imagingItemId');
  const billingServiceItemId = positive(input.billingServiceItemId, 'billingServiceItemId');
  const displayName = exact(input.displayName, 'displayName');
  const totalMinor = positive(input.totalMinor, 'totalMinor');
  if (toUtcIso(input.requestedAtUtc) !== input.requestedAtUtc) {
    throw new RangeError('requestedAtUtc must be a normalized UTC ISO timestamp');
  }
  const requestedAtUtc = input.requestedAtUtc;
  const requestedBusinessDate = businessDate(input.businessDate);
  const request = {
    accessionNo,
    invoiceNo,
    legacyPatientId,
    imagingItemId,
    billingServiceItemId,
    displayName,
    totalMinor,
    requestedAtUtc,
    businessDate: requestedBusinessDate,
  };
  const replay = await readCanonicalCommandReplay<CreateRadiologyRequisitionBillingResult>(db, {
    tenantId,
    commandName: 'canonical.radiology_requisition.billing.create',
    idempotencyKey: commandIdempotencyKey,
    request,
  });
  if (replay) return replay;

  const catalog = await prepareCanonicalBillingServiceMapping(db, {
    tenantId,
    billingServiceItemId,
  });
  const sourceKey = `${accessionNo}:${imagingItemId}`;
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'legacy_radiology_requisition',
    sourcePublicId: sourceKey,
    accessionNo,
    invoiceNo,
    legacyPatientId,
    imagingItemId,
    billingServiceItemId,
    displayName,
    totalMinor,
    requestedAtUtc,
  });
  const requestPublicId = await createDeterministicSourceId(
    'svcreq', tenantId, 'legacy_radiology_requisition_planned', sourceKey,
  );
  const eventPublicId = await createDeterministicSourceId(
    'svcevt', tenantId, 'legacy_radiology_requisition_accepted', sourceKey,
  );
  const sourceLineId = buildLegacyLiveInvoiceSourceLineId({
    lineNumber: 1,
    itemCategory: 'test',
    referenceId: billingServiceItemId,
  });
  const invoiceLinePublicId = await createDeterministicSourceId(
    'invline', tenantId, 'legacy_live_bill_line', `${invoiceNo}:${sourceLineId}`,
  );
  const invoicePublicId = await createDeterministicSourceId(
    'inv', tenantId, 'legacy_live_bill', invoiceNo,
  );
  const invoiceEvidence = await createSourceEvidenceSha256({
    sourceType: 'legacy_live_bill',
    sourcePublicId: invoiceNo,
    sourceTable: 'bills',
    accessionNo,
    legacyPatientId,
    subtotalMinor: totalMinor,
    totalMinor,
    requestedAtUtc,
    imagingItemId,
    billingServiceItemId,
  });
  const invoiceEventPublicId = await createDeterministicSourceId(
    'outevt', tenantId, 'legacy_live_bill', invoiceNo,
  );
  const invoicePrepared = await prepareInvoiceSettlementBatch(db, {
    tenantId,
    commandIdempotencyKey: `${commandIdempotencyKey}:invoice-preparation`,
    invoice: {
      tenantId,
      invoicePublicId,
      invoiceNumber: invoiceNo,
      legacyPatientId,
      currencyCode: 'BDT',
      issuedAtUtc: requestedAtUtc,
      businessDate: requestedBusinessDate,
      lines: [{
        linePublicId: invoiceLinePublicId,
        lineType: 'service',
        serviceEventPublicId: eventPublicId,
        adjustmentCode: null,
        quantity: 1,
        unitAmountMinor: totalMinor,
        sourceEvidenceSha256,
      }],
      sourceType: 'legacy_live_bill',
      sourcePublicId: invoiceNo,
      sourceTable: 'bills',
      sourceEvidenceSha256: invoiceEvidence,
      idempotencyKey: `legacy_live_bill:${invoiceNo}`,
      outboxEventPublicId: invoiceEventPublicId,
    },
    payment: null,
    deposit: null,
  });
  if (invoicePrepared.result.totalMinor !== totalMinor) {
    throw new Error('Canonical radiology invoice arithmetic does not match source requisition');
  }

  const statements: CanonicalPreparedStatement[] = [
    ...catalog.statements,
    db.prepare(`
      INSERT INTO canonical_service_requests (
        tenant_id,request_public_id,legacy_patient_id,encounter_public_id,
        service_public_id,requested_quantity,fulfilled_quantity,last_event_public_id,
        status,requested_at_utc,source_evidence_sha256
      ) VALUES (?,?,?,NULL,?,1,0,?,'active',?,?)
    `).bind(
      tenantId,
      requestPublicId,
      legacyPatientId,
      catalog.servicePublicId,
      eventPublicId,
      requestedAtUtc,
      sourceEvidenceSha256,
    ),
    db.prepare(`
      INSERT INTO canonical_service_events (
        tenant_id,event_public_id,request_public_id,encounter_public_id,
        service_public_id,event_type,quantity,status,occurred_at_utc,source_evidence_sha256
      ) VALUES (?,?,?,NULL,?,'accepted',1,'posted',?,?)
    `).bind(
      tenantId,
      eventPublicId,
      requestPublicId,
      catalog.servicePublicId,
      requestedAtUtc,
      sourceEvidenceSha256,
    ),
    db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      tenantId,
      await createDeterministicSourceId(
        'outevt', tenantId, 'legacy_radiology_service_request', accessionNo,
      ),
      'canonical_service_request',
      requestPublicId,
      'canonical.service_request.created',
      stableCanonicalJson({
        requestPublicId,
        servicePublicId: catalog.servicePublicId,
        requestedQuantity: 1,
        status: 'active',
      }),
      requestedAtUtc,
      requestedBusinessDate,
      `${commandIdempotencyKey}:request`,
    ),
    db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      tenantId,
      await createDeterministicSourceId(
        'outevt', tenantId, 'legacy_radiology_service_event', accessionNo,
      ),
      'canonical_service_event',
      eventPublicId,
      'canonical.service_event.recorded',
      stableCanonicalJson({
        eventPublicId,
        requestPublicId,
        eventType: 'accepted',
        quantity: 1,
        requestStatus: 'active',
      }),
      requestedAtUtc,
      requestedBusinessDate,
      `${commandIdempotencyKey}:event`,
    ),
    ...invoicePrepared.statements,
    db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      tenantId,
      invoiceEventPublicId,
      'canonical_invoice',
      invoicePublicId,
      'canonical.invoice.issued',
      stableCanonicalJson({
        invoicePublicId,
        status: 'posted',
        subtotalMinor: totalMinor,
        adjustmentTotalMinor: 0,
        totalMinor,
      }),
      requestedAtUtc,
      requestedBusinessDate,
      `${commandIdempotencyKey}:invoice`,
    ),
  ];

  const assertionOperationKey = `radiology-requisition-source-mapping:${accessionNo}`;
  const reconciliationStatements: CanonicalPreparedStatement[] = [
    ...catalog.reconciliationStatements,
    actualRequisitionMappingStatement(db, {
      tenantId,
      entityType: 'service_request',
      canonicalPublicId: requestPublicId,
      accessionNo,
      evidenceSha256: sourceEvidenceSha256,
    }),
    prepareFinancialBatchAssertion(db, {
      tenantId,
      operationKey: assertionOperationKey,
      stepKey: 'request-source',
      expectedChanges: 1,
    }),
    actualRequisitionMappingStatement(db, {
      tenantId,
      entityType: 'service_event',
      canonicalPublicId: eventPublicId,
      accessionNo,
      evidenceSha256: sourceEvidenceSha256,
    }),
    prepareFinancialBatchAssertion(db, {
      tenantId,
      operationKey: assertionOperationKey,
      stepKey: 'event-source',
      expectedChanges: 1,
    }),
    prepareClearFinancialBatchAssertions(db, tenantId, assertionOperationKey),
  ];

  const result: CreateRadiologyRequisitionBillingResult = {
    accessionNo,
    invoiceNo,
    requestPublicId,
    eventPublicId,
    servicePublicId: catalog.servicePublicId,
    invoicePublicId,
    invoiceLinePublicId,
    totalMinor,
  };

  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.radiology_requisition.billing.create',
    idempotencyKey: commandIdempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements,
    result,
    event: {
      eventPublicId: await createDeterministicSourceId(
        'outevt', tenantId, 'legacy_radiology_requisition_billing', accessionNo,
      ),
      aggregateType: 'canonical_radiology_requisition_billing',
      aggregatePublicId: invoicePublicId,
      eventType: 'canonical.radiology_requisition.billing_created',
      occurredAtUtc: requestedAtUtc,
      businessDate: requestedBusinessDate,
      payload: {
        accessionNo,
        requestPublicId,
        eventPublicId,
        invoicePublicId,
        totalMinor,
      },
    },
  });
}
