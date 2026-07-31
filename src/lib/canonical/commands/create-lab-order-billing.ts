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
import {
  prepareCanonicalBillingServiceMapping,
  type PreparedCanonicalBillingServiceMapping,
} from '../live-service-catalog-recovery';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../source-mapping';
import { toUtcIso } from '../time';
import { prepareInvoiceSettlementBatch } from './issue-invoice-settlement';

export interface CreateLabOrderBillingItemInput {
  lineNumber: number;
  duplicateOrdinal: number;
  labTestId: number;
  billingServiceItemId: number;
  name: string;
  category: string | null;
  grossMinor: number;
  discountMinor: number;
}

export interface CreateLabOrderBillingInput {
  tenantId: string;
  commandIdempotencyKey: string;
  orderNo: string;
  invoiceNo: string;
  legacyPatientId: number;
  legacyVisitId?: number | null;
  orderingClinicianDoctorId?: number | null;
  orderedAtUtc: string;
  businessDate: string;
  items: readonly CreateLabOrderBillingItemInput[];
}

export interface CreateLabOrderBillingItemResult {
  requestPublicId: string;
  eventPublicId: string;
  servicePublicId: string;
  invoiceLinePublicId: string;
  lineNumber: number;
  labTestId: number;
  billingServiceItemId: number;
  grossMinor: number;
  discountMinor: number;
}

export interface CreateLabOrderBillingResult {
  orderNo: string;
  invoiceNo: string;
  invoicePublicId: string;
  totalMinor: number;
  encounterPublicId: string | null;
  practitionerPublicId: string | null;
  items: CreateLabOrderBillingItemResult[];
}

type MappingRow = {
  canonical_public_id: string | null;
  mapping_status: string;
};

type EncounterRow = {
  encounter_public_id: string;
  legacy_patient_id: number;
  status: string;
};

type PractitionerRow = {
  practitioner_public_id: string;
  status: string;
};

interface PreparedItem {
  input: CreateLabOrderBillingItemInput;
  catalog: PreparedCanonicalBillingServiceMapping;
  requestPublicId: string;
  eventPublicId: string;
  sourceEvidenceSha256: string;
  invoiceLinePublicId: string;
  discountLinePublicId: string | null;
  sourceLineId: string;
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

function nonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function validBusinessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('businessDate must use YYYY-MM-DD');
  return value;
}

function mappedId(row: MappingRow | null, label: string): string {
  if (row?.mapping_status !== 'mapped' || !row.canonical_public_id) {
    throw new Error(`${label} mapping is unavailable`);
  }
  return exact(row.canonical_public_id, `${label} canonical id`);
}

function actualLabOrderItemIdSql(): string {
  return `
    SELECT li.id
    FROM lab_order_items li
    JOIN lab_orders lo ON lo.id=li.lab_order_id
    WHERE CAST(lo.tenant_id AS TEXT)=? AND lo.order_no=?
      AND CAST(li.tenant_id AS TEXT)=? AND li.lab_test_id=?
    ORDER BY li.id
    LIMIT 1 OFFSET ?
  `;
}

function sourceMappingFromActualItemStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'service_request' | 'service_event';
    canonicalPublicId: string;
    orderNo: string;
    labTestId: number;
    duplicateOrdinal: number;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    )
    SELECT ?,?,?, 'legacy_lab_order_item',CAST((${actualLabOrderItemIdSql()}) AS TEXT),
           'lab_order_items','mapped',1,?
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.tenantId,
    input.orderNo,
    input.tenantId,
    input.labTestId,
    input.duplicateOrdinal,
    input.evidenceSha256,
  );
}

async function resolveEncounter(
  db: CanonicalBatchDatabase,
  input: CreateLabOrderBillingInput,
): Promise<string | null> {
  if (input.legacyVisitId == null) return null;
  const visitId = positive(input.legacyVisitId, 'legacyVisitId');
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter'
      AND source_type='legacy_visit' AND source_public_id=?
    LIMIT 1
  `).bind(input.tenantId, String(visitId)).first<MappingRow>();
  const encounterPublicId = mappedId(mapping, 'Canonical encounter');
  const encounter = await db.prepare(`
    SELECT encounter_public_id,legacy_patient_id,status
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(input.tenantId, encounterPublicId).first<EncounterRow>();
  if (!encounter || encounter.legacy_patient_id !== input.legacyPatientId) {
    throw new Error('Canonical encounter mapping does not match the lab-order patient');
  }
  if (!['planned', 'in_progress'].includes(encounter.status)) {
    throw new Error('Canonical encounter mapping is not active for lab ordering');
  }
  return encounterPublicId;
}

async function resolvePractitioner(
  db: CanonicalBatchDatabase,
  input: CreateLabOrderBillingInput,
): Promise<string | null> {
  if (input.orderingClinicianDoctorId == null) return null;
  const doctorId = positive(input.orderingClinicianDoctorId, 'orderingClinicianDoctorId');
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='practitioner'
      AND source_type='legacy_doctor' AND source_public_id=?
    LIMIT 1
  `).bind(input.tenantId, String(doctorId)).first<MappingRow>();
  const practitionerPublicId = mappedId(mapping, 'Canonical practitioner');
  const practitioner = await db.prepare(`
    SELECT practitioner_public_id,status
    FROM canonical_practitioners
    WHERE tenant_id=? AND practitioner_public_id=?
    LIMIT 1
  `).bind(input.tenantId, practitionerPublicId).first<PractitionerRow>();
  if (!practitioner || practitioner.status !== 'active') {
    throw new Error('Canonical practitioner mapping is not active');
  }
  return practitionerPublicId;
}

function validate(input: CreateLabOrderBillingInput): { subtotalMinor: number; discountMinor: number; totalMinor: number } {
  exact(input.tenantId, 'tenantId');
  exact(input.commandIdempotencyKey, 'commandIdempotencyKey');
  exact(input.orderNo, 'orderNo');
  exact(input.invoiceNo, 'invoiceNo');
  positive(input.legacyPatientId, 'legacyPatientId');
  if (toUtcIso(input.orderedAtUtc) !== input.orderedAtUtc) {
    throw new RangeError('orderedAtUtc must be a normalized UTC ISO timestamp');
  }
  validBusinessDate(input.businessDate);
  if (input.items.length === 0) throw new RangeError('Lab order must contain at least one item');
  const lineNumbers = new Set<number>();
  let subtotal = 0n;
  let discounts = 0n;
  for (const item of input.items) {
    positive(item.lineNumber, 'item.lineNumber');
    if (lineNumbers.has(item.lineNumber)) throw new RangeError('duplicate lab invoice lineNumber');
    lineNumbers.add(item.lineNumber);
    nonNegative(item.duplicateOrdinal, 'item.duplicateOrdinal');
    positive(item.labTestId, 'item.labTestId');
    positive(item.billingServiceItemId, 'item.billingServiceItemId');
    exact(item.name, 'item.name');
    if (item.category != null) exact(item.category, 'item.category');
    positive(item.grossMinor, 'item.grossMinor');
    nonNegative(item.discountMinor, 'item.discountMinor');
    if (item.discountMinor > item.grossMinor) throw new RangeError('Lab item discount exceeds gross amount');
    subtotal += BigInt(item.grossMinor);
    discounts += BigInt(item.discountMinor);
  }
  const total = subtotal - discounts;
  if (total <= 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Lab order invoice total must be positive and safe');
  }
  return {
    subtotalMinor: Number(subtotal),
    discountMinor: Number(discounts),
    totalMinor: Number(total),
  };
}

export async function createLabOrderBilling(
  db: CanonicalBatchDatabase,
  input: CreateLabOrderBillingInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CreateLabOrderBillingResult>> {
  const totals = validate(input);
  const request = {
    orderNo: input.orderNo,
    invoiceNo: input.invoiceNo,
    legacyPatientId: input.legacyPatientId,
    legacyVisitId: input.legacyVisitId ?? null,
    orderingClinicianDoctorId: input.orderingClinicianDoctorId ?? null,
    orderedAtUtc: input.orderedAtUtc,
    businessDate: input.businessDate,
    items: input.items,
  };
  const replay = await readCanonicalCommandReplay<CreateLabOrderBillingResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.lab_order.billing.create',
    idempotencyKey: input.commandIdempotencyKey,
    request,
  });
  if (replay) return replay;

  const encounterPublicId = await resolveEncounter(db, input);
  const practitionerPublicId = await resolvePractitioner(db, input);
  const uniqueCatalog = new Map<number, PreparedCanonicalBillingServiceMapping>();
  for (const item of input.items) {
    if (!uniqueCatalog.has(item.billingServiceItemId)) {
      uniqueCatalog.set(item.billingServiceItemId, await prepareCanonicalBillingServiceMapping(db, {
        tenantId: input.tenantId,
        billingServiceItemId: item.billingServiceItemId,
      }));
    }
  }

  const preparedItems: PreparedItem[] = [];
  for (const item of input.items) {
    const sourceKey = `${input.orderNo}:${item.lineNumber}:${item.labTestId}:${item.duplicateOrdinal}`;
    const requestPublicId = await createDeterministicSourceId(
      'svcreq', input.tenantId, 'legacy_lab_order_item_planned', sourceKey,
    );
    const eventPublicId = await createDeterministicSourceId(
      'svcevt', input.tenantId, 'legacy_lab_order_item_accepted', sourceKey,
    );
    const sourceEvidenceSha256 = await createSourceEvidenceSha256({
      sourceType: 'legacy_lab_order_item',
      sourcePublicId: sourceKey,
      orderNo: input.orderNo,
      invoiceNo: input.invoiceNo,
      legacyPatientId: input.legacyPatientId,
      legacyVisitId: input.legacyVisitId ?? null,
      lineNumber: item.lineNumber,
      labTestId: item.labTestId,
      billingServiceItemId: item.billingServiceItemId,
      name: item.name,
      category: item.category,
      grossMinor: item.grossMinor,
      discountMinor: item.discountMinor,
      orderedAtUtc: input.orderedAtUtc,
    });
    const sourceLineId = buildLegacyLiveInvoiceSourceLineId({
      lineNumber: item.lineNumber,
      itemCategory: 'test',
      referenceId: item.billingServiceItemId,
    });
    const invoiceLinePublicId = await createDeterministicSourceId(
      'invline', input.tenantId, 'legacy_live_bill_line', `${input.invoiceNo}:${sourceLineId}`,
    );
    const discountLinePublicId = item.discountMinor > 0
      ? await createDeterministicSourceId(
          'invline', input.tenantId, 'legacy_lab_order_item_discount', sourceKey,
        )
      : null;
    preparedItems.push({
      input: item,
      catalog: uniqueCatalog.get(item.billingServiceItemId)!,
      requestPublicId,
      eventPublicId,
      sourceEvidenceSha256,
      invoiceLinePublicId,
      discountLinePublicId,
      sourceLineId,
    });
  }

  const invoiceEvidence = await createSourceEvidenceSha256({
    sourceType: 'legacy_live_bill',
    sourcePublicId: input.invoiceNo,
    sourceTable: 'bills',
    orderNo: input.orderNo,
    legacyPatientId: input.legacyPatientId,
    subtotalMinor: totals.subtotalMinor,
    discountMinor: totals.discountMinor,
    totalMinor: totals.totalMinor,
    orderedAtUtc: input.orderedAtUtc,
    items: input.items,
  });
  const invoicePublicId = await createDeterministicSourceId(
    'inv', input.tenantId, 'legacy_live_bill', input.invoiceNo,
  );
  const invoiceEventPublicId = await createDeterministicSourceId(
    'outevt', input.tenantId, 'legacy_live_bill', input.invoiceNo,
  );
  const invoicePrepared = await prepareInvoiceSettlementBatch(db, {
    tenantId: input.tenantId,
    commandIdempotencyKey: `${input.commandIdempotencyKey}:invoice-preparation`,
    invoice: {
      tenantId: input.tenantId,
      invoicePublicId,
      invoiceNumber: input.invoiceNo,
      legacyPatientId: input.legacyPatientId,
      currencyCode: 'BDT',
      issuedAtUtc: input.orderedAtUtc,
      businessDate: input.businessDate,
      lines: preparedItems.flatMap((item) => [
        {
          linePublicId: item.invoiceLinePublicId,
          lineType: 'service' as const,
          serviceEventPublicId: item.eventPublicId,
          adjustmentCode: null,
          quantity: 1,
          unitAmountMinor: item.input.grossMinor,
          sourceEvidenceSha256: item.sourceEvidenceSha256,
        },
        ...(item.input.discountMinor > 0 && item.discountLinePublicId ? [{
          linePublicId: item.discountLinePublicId,
          lineType: 'discount' as const,
          serviceEventPublicId: null,
          adjustmentCode: 'LAB_ITEM_DISCOUNT',
          quantity: 1,
          unitAmountMinor: -item.input.discountMinor,
          sourceEvidenceSha256: item.sourceEvidenceSha256,
        }] : []),
      ]),
      sourceType: 'legacy_live_bill',
      sourcePublicId: input.invoiceNo,
      sourceTable: 'bills',
      sourceEvidenceSha256: invoiceEvidence,
      idempotencyKey: `legacy_live_bill:${input.invoiceNo}`,
      outboxEventPublicId: invoiceEventPublicId,
    },
    payment: null,
    deposit: null,
  });
  if (invoicePrepared.result.totalMinor !== totals.totalMinor) {
    throw new Error('Canonical lab invoice arithmetic does not match source order');
  }

  const statements: CanonicalPreparedStatement[] = [];
  const reconciliationStatements: CanonicalPreparedStatement[] = [];
  for (const catalog of uniqueCatalog.values()) {
    statements.push(...catalog.statements);
    reconciliationStatements.push(...catalog.reconciliationStatements);
  }
  for (const item of preparedItems) {
    statements.push(
      db.prepare(`
        INSERT INTO canonical_service_requests (
          tenant_id,request_public_id,legacy_patient_id,encounter_public_id,
          service_public_id,requested_quantity,fulfilled_quantity,last_event_public_id,
          status,requested_at_utc,source_evidence_sha256
        ) VALUES (?,?,?,?,?,1,0,?,'active',?,?)
      `).bind(
        input.tenantId,
        item.requestPublicId,
        input.legacyPatientId,
        encounterPublicId,
        item.catalog.servicePublicId,
        item.eventPublicId,
        input.orderedAtUtc,
        item.sourceEvidenceSha256,
      ),
    );
    if (practitionerPublicId) {
      statements.push(db.prepare(`
        INSERT INTO canonical_service_participants (
          tenant_id,request_public_id,event_public_id,practitioner_public_id,
          participant_role,evidence_type
        ) VALUES (?,?,NULL,?,'ordering','legacy_lab_orderer')
      `).bind(input.tenantId, item.requestPublicId, practitionerPublicId));
    }
    statements.push(
      db.prepare(`
        INSERT INTO canonical_service_events (
          tenant_id,event_public_id,request_public_id,encounter_public_id,
          service_public_id,event_type,quantity,status,occurred_at_utc,source_evidence_sha256
        ) VALUES (?,?,?,?,?,'accepted',1,'posted',?,?)
      `).bind(
        input.tenantId,
        item.eventPublicId,
        item.requestPublicId,
        encounterPublicId,
        item.catalog.servicePublicId,
        input.orderedAtUtc,
        item.sourceEvidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        input.tenantId,
        await createDeterministicSourceId(
          'outevt', input.tenantId, 'legacy_lab_service_request', `${input.orderNo}:${item.input.lineNumber}`,
        ),
        'canonical_service_request',
        item.requestPublicId,
        'canonical.service_request.created',
        stableCanonicalJson({
          requestPublicId: item.requestPublicId,
          servicePublicId: item.catalog.servicePublicId,
          requestedQuantity: 1,
          status: 'active',
        }),
        input.orderedAtUtc,
        input.businessDate,
        `${input.commandIdempotencyKey}:request:${item.input.lineNumber}`,
      ),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        input.tenantId,
        await createDeterministicSourceId(
          'outevt', input.tenantId, 'legacy_lab_service_event', `${input.orderNo}:${item.input.lineNumber}`,
        ),
        'canonical_service_event',
        item.eventPublicId,
        'canonical.service_event.recorded',
        stableCanonicalJson({
          eventPublicId: item.eventPublicId,
          requestPublicId: item.requestPublicId,
          eventType: 'accepted',
          quantity: 1,
          requestStatus: 'active',
        }),
        input.orderedAtUtc,
        input.businessDate,
        `${input.commandIdempotencyKey}:event:${item.input.lineNumber}`,
      ),
    );
  }
  statements.push(...invoicePrepared.statements);
  statements.push(db.prepare(`
    INSERT INTO canonical_outbox_events (
      tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
      event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
    ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
  `).bind(
    input.tenantId,
    invoiceEventPublicId,
    'canonical_invoice',
    invoicePublicId,
    'canonical.invoice.issued',
    stableCanonicalJson({
      invoicePublicId,
      status: 'posted',
      subtotalMinor: totals.subtotalMinor,
      adjustmentTotalMinor: -totals.discountMinor,
      totalMinor: totals.totalMinor,
    }),
    input.orderedAtUtc,
    input.businessDate,
    `${input.commandIdempotencyKey}:invoice`,
  ));

  const assertionOperationKey = `lab-order-source-mapping:${input.orderNo}`;
  for (const item of preparedItems) {
    reconciliationStatements.push(
      sourceMappingFromActualItemStatement(db, {
        tenantId: input.tenantId,
        entityType: 'service_request',
        canonicalPublicId: item.requestPublicId,
        orderNo: input.orderNo,
        labTestId: item.input.labTestId,
        duplicateOrdinal: item.input.duplicateOrdinal,
        evidenceSha256: item.sourceEvidenceSha256,
      }),
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey: assertionOperationKey,
        stepKey: `request-source-${item.input.lineNumber}`,
        expectedChanges: 1,
      }),
      sourceMappingFromActualItemStatement(db, {
        tenantId: input.tenantId,
        entityType: 'service_event',
        canonicalPublicId: item.eventPublicId,
        orderNo: input.orderNo,
        labTestId: item.input.labTestId,
        duplicateOrdinal: item.input.duplicateOrdinal,
        evidenceSha256: item.sourceEvidenceSha256,
      }),
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey: assertionOperationKey,
        stepKey: `event-source-${item.input.lineNumber}`,
        expectedChanges: 1,
      }),
    );
  }
  reconciliationStatements.push(
    prepareClearFinancialBatchAssertions(db, input.tenantId, assertionOperationKey),
  );

  const result: CreateLabOrderBillingResult = {
    orderNo: input.orderNo,
    invoiceNo: input.invoiceNo,
    invoicePublicId,
    totalMinor: totals.totalMinor,
    encounterPublicId,
    practitionerPublicId,
    items: preparedItems.map((item) => ({
      requestPublicId: item.requestPublicId,
      eventPublicId: item.eventPublicId,
      servicePublicId: item.catalog.servicePublicId,
      invoiceLinePublicId: item.invoiceLinePublicId,
      lineNumber: item.input.lineNumber,
      labTestId: item.input.labTestId,
      billingServiceItemId: item.input.billingServiceItemId,
      grossMinor: item.input.grossMinor,
      discountMinor: item.input.discountMinor,
    })),
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.lab_order.billing.create',
    idempotencyKey: input.commandIdempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements,
    result,
    event: {
      eventPublicId: await createDeterministicSourceId(
        'outevt', input.tenantId, 'legacy_lab_order_billing', input.orderNo,
      ),
      aggregateType: 'canonical_lab_order_billing',
      aggregatePublicId: invoicePublicId,
      eventType: 'canonical.lab_order.billing_created',
      occurredAtUtc: input.orderedAtUtc,
      businessDate: input.businessDate,
      payload: {
        orderNo: input.orderNo,
        invoicePublicId,
        itemCount: preparedItems.length,
        totalMinor: totals.totalMinor,
      },
    },
  });
}
