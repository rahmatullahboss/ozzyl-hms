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
import { issueInvoice, type IssueInvoiceInput } from './issue-invoice';

export interface CreateReceptionVisitBillingLineInput {
  lineNumber: number;
  visitServiceId: number;
  billingServiceItemId: number;
  serviceType: string;
  description: string;
  legacyReferenceId: number | null;
  quantity: number;
  lineTotalMinor: number;
}

export interface CreateReceptionVisitBillingInput {
  tenantId: string;
  commandIdempotencyKey: string;
  invoiceNo: string;
  legacyPatientId: number;
  legacyVisitId: number;
  issuedAtUtc: string;
  businessDate: string;
  billDiscountMinor: number;
  lines: readonly CreateReceptionVisitBillingLineInput[];
}

export interface CreateReceptionVisitBillingLineResult {
  lineNumber: number;
  visitServiceId: number;
  requestPublicId: string;
  eventPublicId: string;
  servicePublicId: string;
  invoiceLinePublicId: string;
  canonicalSourceLineId: string;
  lineTotalMinor: number;
}

export interface CreateReceptionVisitBillingResult {
  invoiceNo: string;
  invoicePublicId: string;
  encounterPublicId: string;
  subtotalMinor: number;
  billDiscountMinor: number;
  totalMinor: number;
  lines: CreateReceptionVisitBillingLineResult[];
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

interface PreparedLine {
  input: CreateReceptionVisitBillingLineInput;
  catalog: PreparedCanonicalBillingServiceMapping;
  requestPublicId: string;
  eventPublicId: string;
  sourceEvidenceSha256: string;
  canonicalSourceLineId: string;
  invoiceLinePublicId: string;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('businessDate must use YYYY-MM-DD');
  }
  return value;
}

function validate(input: CreateReceptionVisitBillingInput): {
  subtotalMinor: number;
  totalMinor: number;
} {
  exact(input.tenantId, 'tenantId');
  exact(input.commandIdempotencyKey, 'commandIdempotencyKey');
  exact(input.invoiceNo, 'invoiceNo');
  positive(input.legacyPatientId, 'legacyPatientId');
  positive(input.legacyVisitId, 'legacyVisitId');
  if (toUtcIso(input.issuedAtUtc) !== input.issuedAtUtc) {
    throw new RangeError('issuedAtUtc must be a normalized UTC ISO timestamp');
  }
  validBusinessDate(input.businessDate);
  nonNegative(input.billDiscountMinor, 'billDiscountMinor');
  if (input.lines.length === 0) throw new RangeError('Reception visit invoice must contain at least one line');

  const lineNumbers = new Set<number>();
  const serviceIds = new Set<number>();
  let subtotal = 0n;
  for (const line of input.lines) {
    positive(line.lineNumber, 'line.lineNumber');
    if (lineNumbers.has(line.lineNumber)) throw new RangeError('duplicate reception invoice lineNumber');
    lineNumbers.add(line.lineNumber);
    positive(line.visitServiceId, 'line.visitServiceId');
    if (serviceIds.has(line.visitServiceId)) throw new RangeError('duplicate visitServiceId');
    serviceIds.add(line.visitServiceId);
    positive(line.billingServiceItemId, 'line.billingServiceItemId');
    exact(line.serviceType, 'line.serviceType');
    exact(line.description, 'line.description');
    if (line.legacyReferenceId != null) positive(line.legacyReferenceId, 'line.legacyReferenceId');
    positive(line.quantity, 'line.quantity');
    nonNegative(line.lineTotalMinor, 'line.lineTotalMinor');
    subtotal += BigInt(line.lineTotalMinor);
    if (subtotal > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('Reception visit invoice subtotal exceeds the safe integer range');
    }
  }

  if (BigInt(input.billDiscountMinor) > subtotal) {
    throw new RangeError('Reception visit bill discount exceeds service subtotal');
  }
  return {
    subtotalMinor: Number(subtotal),
    totalMinor: Number(subtotal - BigInt(input.billDiscountMinor)),
  };
}

async function resolveEncounter(
  db: CanonicalBatchDatabase,
  input: CreateReceptionVisitBillingInput,
): Promise<string> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='encounter'
      AND source_type='legacy_visit' AND source_public_id=?
    LIMIT 1
  `).bind(input.tenantId, String(input.legacyVisitId)).first<MappingRow>();
  if (mapping?.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error('Canonical encounter mapping is unavailable for the reception visit');
  }
  const encounterPublicId = exact(mapping.canonical_public_id, 'encounterPublicId');
  const encounter = await db.prepare(`
    SELECT encounter_public_id,legacy_patient_id,status
    FROM canonical_encounters
    WHERE tenant_id=? AND encounter_public_id=?
    LIMIT 1
  `).bind(input.tenantId, encounterPublicId).first<EncounterRow>();
  if (!encounter || encounter.legacy_patient_id !== input.legacyPatientId) {
    throw new Error('Canonical encounter mapping does not match the reception visit patient');
  }
  if (!['planned', 'in_progress'].includes(encounter.status)) {
    throw new Error('Canonical encounter mapping is not active for reception billing');
  }
  return encounterPublicId;
}

async function prepareIssueInvoiceStatements(
  db: CanonicalBatchDatabase,
  input: IssueInvoiceInput,
): Promise<CanonicalPreparedStatement[]> {
  const capture: { statements: CanonicalPreparedStatement[] | null } = { statements: null };
  const captureDb: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return db.prepare(sql);
    },
    async batch(statements) {
      capture.statements = [...statements];
      return statements.map(() => ({ success: true }));
    },
  };
  await issueInvoice(captureDb, input);
  const captured = capture.statements;
  if (!captured || captured.length === 0) {
    throw new Error('Reception invoice preparation did not produce a canonical batch');
  }
  const [, ...statements] = captured;
  return statements;
}

function sourceMappingFromVisitService(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    legacyVisitId: number;
    legacyPatientId: number;
    visitServiceId: number;
    billingServiceItemId: number;
    invoiceNo: string;
    serviceType: string;
    description: string;
    legacyReferenceId: number | null;
    quantity: number;
    lineTotalMinor: number;
    entityType: 'service_request' | 'service_event';
    canonicalPublicId: string;
    servicePublicId: string;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    )
    SELECT ?,?,?, 'legacy_visit_service',CAST(vs.id AS TEXT),
           'visit_services','mapped',1,?
    FROM visit_services vs
    JOIN bills b
      ON b.id=vs.bill_id AND CAST(b.tenant_id AS TEXT)=CAST(vs.tenant_id AS TEXT)
    JOIN canonical_service_catalog_items ci
      ON CAST(ci.tenant_id AS TEXT)=CAST(vs.tenant_id AS TEXT)
     AND ci.service_public_id=? AND ci.status='active'
    WHERE CAST(vs.tenant_id AS TEXT)=? AND vs.id=?
      AND vs.visit_id=? AND vs.patient_id=? AND vs.service_item_id=?
      AND vs.service_type=? AND vs.description=? AND vs.quantity=?
      AND ROUND(COALESCE(vs.total_amount,0)*100)=?
      AND COALESCE(
        CASE WHEN vs.reference_type='lab_order_item'
             THEN vs.reference_id ELSE COALESCE(vs.service_item_id,vs.reference_id) END,
        0
      )=COALESCE(?,0)
      AND vs.status='billed' AND vs.bill_id IS NOT NULL
      AND b.invoice_no=?
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.evidenceSha256,
    input.servicePublicId,
    input.tenantId,
    input.visitServiceId,
    input.legacyVisitId,
    input.legacyPatientId,
    input.billingServiceItemId,
    input.serviceType,
    input.description,
    input.quantity,
    input.lineTotalMinor,
    input.legacyReferenceId,
    input.invoiceNo,
  );
}

export async function createReceptionVisitBilling(
  db: CanonicalBatchDatabase,
  input: CreateReceptionVisitBillingInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CreateReceptionVisitBillingResult>> {
  const totals = validate(input);
  const request = {
    invoiceNo: input.invoiceNo,
    legacyPatientId: input.legacyPatientId,
    legacyVisitId: input.legacyVisitId,
    issuedAtUtc: input.issuedAtUtc,
    businessDate: input.businessDate,
    billDiscountMinor: input.billDiscountMinor,
    lines: input.lines,
  };
  const replay = await readCanonicalCommandReplay<CreateReceptionVisitBillingResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.reception_visit.billing.create',
    idempotencyKey: input.commandIdempotencyKey,
    request,
  });
  if (replay) return replay;

  const encounterPublicId = await resolveEncounter(db, input);
  const uniqueCatalog = new Map<number, PreparedCanonicalBillingServiceMapping>();
  for (const line of input.lines) {
    if (!uniqueCatalog.has(line.billingServiceItemId)) {
      const mapping = await prepareCanonicalBillingServiceMapping(db, {
        tenantId: input.tenantId,
        billingServiceItemId: line.billingServiceItemId,
      });
      if (mapping.status !== 'active') {
        throw new Error('Reception visit billing requires an active canonical service');
      }
      uniqueCatalog.set(line.billingServiceItemId, mapping);
    }
  }

  const preparedLines: PreparedLine[] = [];
  for (const line of input.lines) {
    const sourcePublicId = String(line.visitServiceId);
    const requestPublicId = await createDeterministicSourceId(
      'svcreq', input.tenantId, 'legacy_visit_service_planned', sourcePublicId,
    );
    const eventPublicId = await createDeterministicSourceId(
      'svcevt', input.tenantId, 'legacy_visit_service_accepted', sourcePublicId,
    );
    const sourceEvidenceSha256 = await createSourceEvidenceSha256({
      sourceType: 'legacy_visit_service',
      sourcePublicId,
      invoiceNo: input.invoiceNo,
      legacyPatientId: input.legacyPatientId,
      legacyVisitId: input.legacyVisitId,
      lineNumber: line.lineNumber,
      billingServiceItemId: line.billingServiceItemId,
      serviceType: line.serviceType,
      description: line.description,
      legacyReferenceId: line.legacyReferenceId,
      quantity: line.quantity,
      lineTotalMinor: line.lineTotalMinor,
      issuedAtUtc: input.issuedAtUtc,
    });
    const canonicalSourceLineId = buildLegacyLiveInvoiceSourceLineId({
      lineNumber: line.lineNumber,
      itemCategory: line.serviceType,
      referenceId: line.legacyReferenceId,
    });
    const invoiceLinePublicId = await createDeterministicSourceId(
      'invline', input.tenantId, 'legacy_live_bill_line', `${input.invoiceNo}:${canonicalSourceLineId}`,
    );
    preparedLines.push({
      input: line,
      catalog: uniqueCatalog.get(line.billingServiceItemId)!,
      requestPublicId,
      eventPublicId,
      sourceEvidenceSha256,
      canonicalSourceLineId,
      invoiceLinePublicId,
    });
  }

  const invoicePublicId = await createDeterministicSourceId(
    'inv', input.tenantId, 'legacy_live_bill', input.invoiceNo,
  );
  const invoiceEventPublicId = await createDeterministicSourceId(
    'outevt', input.tenantId, 'legacy_live_bill', input.invoiceNo,
  );
  const invoiceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'legacy_live_bill',
    sourcePublicId: input.invoiceNo,
    sourceTable: 'bills',
    legacyPatientId: input.legacyPatientId,
    legacyVisitId: input.legacyVisitId,
    subtotalMinor: totals.subtotalMinor,
    billDiscountMinor: input.billDiscountMinor,
    totalMinor: totals.totalMinor,
    issuedAtUtc: input.issuedAtUtc,
    lines: input.lines,
  });
  const discountLinePublicId = input.billDiscountMinor > 0
    ? await createDeterministicSourceId(
        'invline', input.tenantId, 'legacy_reception_bill_discount', input.invoiceNo,
      )
    : null;
  const invoiceInput: IssueInvoiceInput = {
    tenantId: input.tenantId,
    invoicePublicId,
    invoiceNumber: input.invoiceNo,
    legacyPatientId: input.legacyPatientId,
    currencyCode: 'BDT',
    issuedAtUtc: input.issuedAtUtc,
    businessDate: input.businessDate,
    lines: [
      ...preparedLines.map((line) => ({
        linePublicId: line.invoiceLinePublicId,
        lineType: 'service' as const,
        serviceEventPublicId: line.eventPublicId,
        adjustmentCode: null,
        quantity: 1,
        unitAmountMinor: line.input.lineTotalMinor,
        sourceEvidenceSha256: line.sourceEvidenceSha256,
      })),
      ...(discountLinePublicId ? [{
        linePublicId: discountLinePublicId,
        lineType: 'discount' as const,
        serviceEventPublicId: null,
        adjustmentCode: 'RECEPTION_BILL_DISCOUNT',
        quantity: 1,
        unitAmountMinor: -input.billDiscountMinor,
        sourceEvidenceSha256: invoiceEvidenceSha256,
      }] : []),
    ],
    sourceType: 'legacy_live_bill',
    sourcePublicId: input.invoiceNo,
    sourceTable: 'bills',
    sourceEvidenceSha256: invoiceEvidenceSha256,
    idempotencyKey: `legacy_live_bill:${input.invoiceNo}`,
    outboxEventPublicId: invoiceEventPublicId,
  };
  const invoiceStatements = await prepareIssueInvoiceStatements(db, invoiceInput);

  const statements: CanonicalPreparedStatement[] = [];
  const reconciliationStatements: CanonicalPreparedStatement[] = [];
  for (const catalog of uniqueCatalog.values()) {
    statements.push(...catalog.statements);
    reconciliationStatements.push(...catalog.reconciliationStatements);
  }
  for (const line of preparedLines) {
    statements.push(
      db.prepare(`
        INSERT INTO canonical_service_requests (
          tenant_id,request_public_id,legacy_patient_id,encounter_public_id,
          service_public_id,requested_quantity,fulfilled_quantity,last_event_public_id,
          status,requested_at_utc,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,0,?,'active',?,?)
      `).bind(
        input.tenantId,
        line.requestPublicId,
        input.legacyPatientId,
        encounterPublicId,
        line.catalog.servicePublicId,
        line.input.quantity,
        line.eventPublicId,
        input.issuedAtUtc,
        line.sourceEvidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_service_events (
          tenant_id,event_public_id,request_public_id,encounter_public_id,
          service_public_id,event_type,quantity,status,occurred_at_utc,source_evidence_sha256
        ) VALUES (?,?,?,?,?,'accepted',?,'posted',?,?)
      `).bind(
        input.tenantId,
        line.eventPublicId,
        line.requestPublicId,
        encounterPublicId,
        line.catalog.servicePublicId,
        line.input.quantity,
        input.issuedAtUtc,
        line.sourceEvidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        input.tenantId,
        await createDeterministicSourceId(
          'outevt', input.tenantId, 'legacy_visit_service_request', String(line.input.visitServiceId),
        ),
        'canonical_service_request',
        line.requestPublicId,
        'canonical.service_request.created',
        stableCanonicalJson({
          requestPublicId: line.requestPublicId,
          servicePublicId: line.catalog.servicePublicId,
          requestedQuantity: line.input.quantity,
          status: 'active',
        }),
        input.issuedAtUtc,
        input.businessDate,
        `${input.commandIdempotencyKey}:request:${line.input.lineNumber}`,
      ),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        input.tenantId,
        await createDeterministicSourceId(
          'outevt', input.tenantId, 'legacy_visit_service_event', String(line.input.visitServiceId),
        ),
        'canonical_service_event',
        line.eventPublicId,
        'canonical.service_event.recorded',
        stableCanonicalJson({
          eventPublicId: line.eventPublicId,
          requestPublicId: line.requestPublicId,
          eventType: 'accepted',
          quantity: line.input.quantity,
          requestStatus: 'active',
        }),
        input.issuedAtUtc,
        input.businessDate,
        `${input.commandIdempotencyKey}:event:${line.input.lineNumber}`,
      ),
    );
  }
  statements.push(...invoiceStatements);
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
      adjustmentTotalMinor: -input.billDiscountMinor,
      totalMinor: totals.totalMinor,
    }),
    input.issuedAtUtc,
    input.businessDate,
    `${input.commandIdempotencyKey}:invoice`,
  ));

  const mappingOperationKey = `reception-visit-service-mapping:${input.invoiceNo}`;
  for (const line of preparedLines) {
    reconciliationStatements.push(
      sourceMappingFromVisitService(db, {
        tenantId: input.tenantId,
        legacyVisitId: input.legacyVisitId,
        legacyPatientId: input.legacyPatientId,
        visitServiceId: line.input.visitServiceId,
        billingServiceItemId: line.input.billingServiceItemId,
        invoiceNo: input.invoiceNo,
        serviceType: line.input.serviceType,
        description: line.input.description,
        legacyReferenceId: line.input.legacyReferenceId,
        quantity: line.input.quantity,
        lineTotalMinor: line.input.lineTotalMinor,
        entityType: 'service_request',
        canonicalPublicId: line.requestPublicId,
        servicePublicId: line.catalog.servicePublicId,
        evidenceSha256: line.sourceEvidenceSha256,
      }),
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey: mappingOperationKey,
        stepKey: `request-source-${line.input.lineNumber}`,
        expectedChanges: 1,
      }),
      sourceMappingFromVisitService(db, {
        tenantId: input.tenantId,
        legacyVisitId: input.legacyVisitId,
        legacyPatientId: input.legacyPatientId,
        visitServiceId: line.input.visitServiceId,
        billingServiceItemId: line.input.billingServiceItemId,
        invoiceNo: input.invoiceNo,
        serviceType: line.input.serviceType,
        description: line.input.description,
        legacyReferenceId: line.input.legacyReferenceId,
        quantity: line.input.quantity,
        lineTotalMinor: line.input.lineTotalMinor,
        entityType: 'service_event',
        canonicalPublicId: line.eventPublicId,
        servicePublicId: line.catalog.servicePublicId,
        evidenceSha256: line.sourceEvidenceSha256,
      }),
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey: mappingOperationKey,
        stepKey: `event-source-${line.input.lineNumber}`,
        expectedChanges: 1,
      }),
    );
  }
  reconciliationStatements.push(
    prepareClearFinancialBatchAssertions(db, input.tenantId, mappingOperationKey),
  );

  const result: CreateReceptionVisitBillingResult = {
    invoiceNo: input.invoiceNo,
    invoicePublicId,
    encounterPublicId,
    subtotalMinor: totals.subtotalMinor,
    billDiscountMinor: input.billDiscountMinor,
    totalMinor: totals.totalMinor,
    lines: preparedLines.map((line) => ({
      lineNumber: line.input.lineNumber,
      visitServiceId: line.input.visitServiceId,
      requestPublicId: line.requestPublicId,
      eventPublicId: line.eventPublicId,
      servicePublicId: line.catalog.servicePublicId,
      invoiceLinePublicId: line.invoiceLinePublicId,
      canonicalSourceLineId: line.canonicalSourceLineId,
      lineTotalMinor: line.input.lineTotalMinor,
    })),
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.reception_visit.billing.create',
    idempotencyKey: input.commandIdempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements,
    result,
    event: {
      eventPublicId: await createDeterministicSourceId(
        'outevt', input.tenantId, 'legacy_reception_visit_billing', input.invoiceNo,
      ),
      aggregateType: 'canonical_reception_visit_billing',
      aggregatePublicId: invoicePublicId,
      eventType: 'canonical.reception_visit.billing_created',
      occurredAtUtc: input.issuedAtUtc,
      businessDate: input.businessDate,
      payload: {
        invoiceNo: input.invoiceNo,
        invoicePublicId,
        encounterPublicId,
        subtotalMinor: totals.subtotalMinor,
        billDiscountMinor: input.billDiscountMinor,
        totalMinor: totals.totalMinor,
        serviceCount: input.lines.length,
      },
    },
  });
}
