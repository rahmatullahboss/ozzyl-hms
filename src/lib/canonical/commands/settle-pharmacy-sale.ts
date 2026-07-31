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
import {
  pharmacyMinorSettlement,
  pharmacyMoneyMinor,
  pharmacyTender,
  positivePharmacyQuantity,
  type PharmacySaleContext,
  type PharmacySaleItemContext,
} from '../pharmacy-sale-types';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../source-mapping';
import { toUtcIso } from '../time';
import { prepareInvoiceSettlementBatch } from './issue-invoice-settlement';
import type { IssueInvoiceLineInput } from './issue-invoice';

export interface SettlePharmacySaleItemResult {
  lineNumber: number;
  requestPublicId: string;
  eventPublicId: string;
  invoiceLinePublicId: string;
  movementPublicId: string;
  quantityBase: number;
}

export interface SettlePharmacySaleResult {
  invoiceNo: string;
  invoicePublicId: string;
  receiptPublicId: string | null;
  totalMinor: number;
  paymentMinor: number;
  depositMinor: number;
  paidMinor: number;
  dueMinor: number;
  movementCount: number;
  items: SettlePharmacySaleItemResult[];
}

interface PreparedItem {
  input: PharmacySaleItemContext;
  requestPublicId: string;
  eventPublicId: string;
  invoiceLinePublicId: string;
  movementPublicId: string;
  requestOutboxPublicId: string;
  eventOutboxPublicId: string;
  movementOutboxPublicId: string;
  evidenceSha256: string;
  lineMinor: number;
  quantityBase: number;
  balanceBeforeBase: number;
  balanceAfterBase: number;
  balanceVersionBefore: number;
  balanceVersionAfter: number;
}

interface BalanceState {
  quantity: number;
  version: number;
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

function actualInvoiceItemSql(): string {
  return `
    SELECT pii.id
    FROM pharmacy_invoice_items pii
    JOIN pharmacy_invoices pi
      ON pi.id=pii.invoice_id AND CAST(pi.tenant_id AS TEXT)=CAST(pii.tenant_id AS TEXT)
    WHERE CAST(pi.tenant_id AS TEXT)=? AND pi.invoice_no=?
      AND pii.item_id=? AND pii.stock_id=?
    ORDER BY pii.id
    LIMIT 1 OFFSET ?
  `;
}

function actualStockTransactionSql(): string {
  return `
    SELECT pst.id
    FROM pharmacy_stock_transactions pst
    JOIN pharmacy_invoices pi
      ON pi.id=pst.reference_id AND CAST(pi.tenant_id AS TEXT)=CAST(pst.tenant_id AS TEXT)
    WHERE CAST(pi.tenant_id AS TEXT)=? AND pi.invoice_no=?
      AND pst.reference_type='invoice' AND pst.item_id=? AND pst.stock_id=?
    ORDER BY pst.id
    LIMIT 1 OFFSET ?
  `;
}

function actualInvoiceItemMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'service_request' | 'service_event';
    canonicalPublicId: string;
    invoiceNo: string;
    item: PharmacySaleItemContext;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    )
    SELECT ?,?,?, 'legacy_pharmacy_invoice_item',CAST((${actualInvoiceItemSql()}) AS TEXT),
           'pharmacy_invoice_items','mapped',1,?
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.tenantId,
    input.invoiceNo,
    input.item.pharmacyItemId,
    input.item.stockId,
    input.item.duplicateOrdinal,
    input.evidenceSha256,
  );
}

function actualMovementMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    canonicalPublicId: string;
    invoiceNo: string;
    item: PharmacySaleItemContext;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    )
    SELECT ?,'inventory_movement',?, 'legacy_pharmacy_stock_transaction',
           CAST((${actualStockTransactionSql()}) AS TEXT),
           'pharmacy_stock_transactions','mapped',1,?
  `).bind(
    input.tenantId,
    input.canonicalPublicId,
    input.tenantId,
    input.invoiceNo,
    input.item.pharmacyItemId,
    input.item.stockId,
    input.item.duplicateOrdinal,
    input.evidenceSha256,
  );
}

function movementStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    invoiceNo: string;
    invoicePublicId: string;
    item: PreparedItem;
    occurredAtUtc: string;
    businessDate: string;
    actorUserId: number;
  },
): CanonicalPreparedStatement {
  const authority = input.item.input.canonical!;
  return db.prepare(`
    INSERT INTO canonical_inventory_movements (
      tenant_id,movement_public_id,item_public_id,location_public_id,lot_public_id,
      movement_type,direction,source_quantity,source_unit_code,
      conversion_numerator,conversion_denominator,quantity_base,signed_quantity_base,
      balance_before_base,balance_after_base,transfer_public_id,service_event_public_id,
      invoice_public_id,invoice_line_public_id,reversal_of_movement_public_id,
      source_type,source_public_id,source_line_public_id,source_table,status,
      occurred_at_utc,business_date,actor_user_id,balance_guard,source_evidence_sha256
    )
    SELECT ?,?,?,?,?, 'sale','out',?,?,?,?,?, -?, ?,?,NULL,?,?,?,NULL,
           'legacy_pharmacy_stock_transaction',CAST(t.id AS TEXT),?,
           'pharmacy_stock_transactions','posted',?,?,?,1,?
    FROM pharmacy_stock_transactions t
    JOIN pharmacy_invoices pi
      ON pi.id=t.reference_id AND CAST(pi.tenant_id AS TEXT)=CAST(t.tenant_id AS TEXT)
    WHERE CAST(pi.tenant_id AS TEXT)=? AND pi.invoice_no=?
      AND t.reference_type='invoice' AND t.item_id=? AND t.stock_id=?
    ORDER BY t.id
    LIMIT 1 OFFSET ?
  `).bind(
    input.tenantId,
    input.item.movementPublicId,
    authority.itemPublicId,
    authority.locationPublicId,
    authority.lotPublicId,
    input.item.input.quantity,
    input.item.input.sourceUnitCode,
    authority.conversionNumerator,
    authority.conversionDenominator,
    input.item.quantityBase,
    input.item.quantityBase,
    input.item.balanceBeforeBase,
    input.item.balanceAfterBase,
    input.item.eventPublicId,
    input.invoicePublicId,
    input.item.invoiceLinePublicId,
    `line:${input.item.input.lineNumber}`,
    input.occurredAtUtc,
    input.businessDate,
    input.actorUserId,
    input.item.evidenceSha256,
    input.tenantId,
    input.invoiceNo,
    input.item.input.pharmacyItemId,
    input.item.input.stockId,
    input.item.input.duplicateOrdinal,
  );
}

function validateContext(context: PharmacySaleContext): void {
  exact(context.tenantId, 'tenantId');
  positive(context.userId, 'userId');
  positive(context.patientId, 'patientId');
  positive(context.sourceDocumentId, 'sourceDocumentId');
  exact(context.invoiceNo, 'invoiceNo');
  if (toUtcIso(context.occurredAtUtc) !== context.occurredAtUtc) {
    throw new RangeError('occurredAtUtc must be a normalized UTC ISO timestamp');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(context.businessDate)) {
    throw new RangeError('businessDate must use YYYY-MM-DD');
  }
  if (context.items.length === 0) throw new RangeError('Pharmacy sale must contain at least one item');
}

export async function settlePharmacySale(
  db: CanonicalBatchDatabase,
  context: PharmacySaleContext,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<SettlePharmacySaleResult>> {
  validateContext(context);
  const settlement = pharmacyMinorSettlement(context);
  positive(settlement.totalMinor, 'totalMinor');
  const commandIdempotencyKey = `pharmacy-sale:${context.sourceKind}:${context.invoiceNo}`;
  const request = {
    sourceKind: context.sourceKind,
    sourceDocumentId: context.sourceDocumentId,
    invoiceNo: context.invoiceNo,
    patientId: context.patientId,
    patientVisitId: context.patientVisitId,
    prescriberId: context.prescriberId,
    counterId: context.counterId,
    paymentMode: context.paymentMode,
    externalTransactionId: context.externalTransactionId,
    settlement,
    sourceDiscountPct: context.sourceDiscountPct,
    items: context.items,
  };
  const replay = await readCanonicalCommandReplay<SettlePharmacySaleResult>(db, {
    tenantId: context.tenantId,
    commandName: 'canonical.pharmacy_sale.settle',
    idempotencyKey: commandIdempotencyKey,
    request,
  });
  if (replay) return replay;

  const balanceStates = new Map<string, BalanceState>();
  const preparedItems: PreparedItem[] = [];
  let itemSubtotalMinor = 0n;
  for (const item of context.items) {
    positive(item.lineNumber, 'item.lineNumber');
    nonNegative(item.duplicateOrdinal, 'item.duplicateOrdinal');
    positive(item.pharmacyItemId, 'item.pharmacyItemId');
    positive(item.stockId ?? 0, 'item.stockId');
    exact(item.itemName, 'item.itemName');
    exact(item.sourceUnitCode ?? '', 'item.sourceUnitCode');
    const quantity = positivePharmacyQuantity(item.quantity, 'item.quantity');
    const authority = item.canonical;
    if (!authority) throw new Error(`Canonical inventory mapping is unavailable for pharmacy item ${item.pharmacyItemId}`);
    exact(authority.itemPublicId, 'item.canonical.itemPublicId');
    exact(authority.servicePublicId, 'item.canonical.servicePublicId');
    exact(authority.lotPublicId, 'item.canonical.lotPublicId');
    exact(authority.locationPublicId, 'item.canonical.locationPublicId');
    exact(authority.baseUnitCode, 'item.canonical.baseUnitCode');
    positive(authority.conversionNumerator, 'item.canonical.conversionNumerator');
    positive(authority.conversionDenominator, 'item.canonical.conversionDenominator');
    const converted = BigInt(quantity) * BigInt(authority.conversionNumerator);
    if (converted % BigInt(authority.conversionDenominator) !== 0n) {
      throw new RangeError('Pharmacy quantity cannot be represented in canonical base units');
    }
    const quantityBaseBig = converted / BigInt(authority.conversionDenominator);
    if (quantityBaseBig <= 0n || quantityBaseBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('Pharmacy canonical quantity exceeds the safe integer range');
    }
    const quantityBase = Number(quantityBaseBig);
    const legacyBefore = positivePharmacyQuantity(item.legacyAvailableBefore, 'item.legacyAvailableBefore');
    const legacyBeforeBaseBig = BigInt(legacyBefore) * BigInt(authority.conversionNumerator);
    if (legacyBeforeBaseBig % BigInt(authority.conversionDenominator) !== 0n) {
      throw new RangeError('Legacy pharmacy balance cannot be represented in canonical base units');
    }
    const legacyBeforeBase = Number(legacyBeforeBaseBig / BigInt(authority.conversionDenominator));
    const balanceKey = `${authority.itemPublicId}:${authority.locationPublicId}:${authority.lotPublicId}`;
    const existingState = balanceStates.get(balanceKey);
    const before = existingState?.quantity ?? nonNegative(authority.balanceBeforeBase, 'item.canonical.balanceBeforeBase');
    const versionBefore = existingState?.version ?? nonNegative(authority.balanceVersion, 'item.canonical.balanceVersion');
    if (before !== legacyBeforeBase) {
      throw new Error('Canonical pharmacy balance does not match the legacy stock cache');
    }
    if (before < quantityBase) throw new Error('Insufficient canonical pharmacy stock');
    const after = before - quantityBase;
    const versionAfter = versionBefore + 1;
    balanceStates.set(balanceKey, { quantity: after, version: versionAfter });
    const lineMinor = pharmacyMoneyMinor(item.total, `item ${item.lineNumber} total`);
    if (lineMinor <= 0) throw new RangeError('Pharmacy canonical invoice lines must be positive');
    itemSubtotalMinor += BigInt(lineMinor);
    if (itemSubtotalMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('Pharmacy line subtotal exceeds the safe integer range');
    }
    const sourceKey = `${context.invoiceNo}:${item.lineNumber}:${item.pharmacyItemId}:${item.stockId}:${item.duplicateOrdinal}`;
    const evidenceSha256 = await createSourceEvidenceSha256({
      sourceType: 'legacy_pharmacy_invoice_item',
      sourcePublicId: sourceKey,
      sourceKind: context.sourceKind,
      sourceDocumentId: context.sourceDocumentId,
      invoiceNo: context.invoiceNo,
      patientId: context.patientId,
      itemId: item.pharmacyItemId,
      stockId: item.stockId,
      quantity,
      lineMinor,
      occurredAtUtc: context.occurredAtUtc,
    });
    preparedItems.push({
      input: item,
      requestPublicId: await createDeterministicSourceId('svcreq', context.tenantId, 'legacy_pharmacy_invoice_item', sourceKey),
      eventPublicId: await createDeterministicSourceId('svcevt', context.tenantId, 'legacy_pharmacy_dispense', sourceKey),
      invoiceLinePublicId: await createDeterministicSourceId('invline', context.tenantId, 'legacy_pharmacy_invoice_item', sourceKey),
      movementPublicId: await createDeterministicSourceId('invmov', context.tenantId, 'legacy_pharmacy_stock_transaction', sourceKey),
      requestOutboxPublicId: await createDeterministicSourceId('outevt', context.tenantId, 'legacy_pharmacy_request', sourceKey),
      eventOutboxPublicId: await createDeterministicSourceId('outevt', context.tenantId, 'legacy_pharmacy_event', sourceKey),
      movementOutboxPublicId: await createDeterministicSourceId('outevt', context.tenantId, 'legacy_pharmacy_movement', sourceKey),
      evidenceSha256,
      lineMinor,
      quantityBase,
      balanceBeforeBase: before,
      balanceAfterBase: after,
      balanceVersionBefore: versionBefore,
      balanceVersionAfter: versionAfter,
    });
  }
  if (Number(itemSubtotalMinor) !== settlement.subtotalMinor) {
    throw new Error('Pharmacy invoice item totals do not match the header subtotal');
  }

  const invoicePublicId = await createDeterministicSourceId(
    'inv', context.tenantId, 'legacy_pharmacy_invoice', context.invoiceNo,
  );
  const invoiceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'legacy_pharmacy_invoice',
    sourcePublicId: context.invoiceNo,
    sourceTable: 'pharmacy_invoices',
    sourceKind: context.sourceKind,
    sourceDocumentId: context.sourceDocumentId,
    patientId: context.patientId,
    settlement,
    items: context.items,
    occurredAtUtc: context.occurredAtUtc,
  });
  const invoiceLines: IssueInvoiceLineInput[] = preparedItems.map((item) => ({
    linePublicId: item.invoiceLinePublicId,
    lineType: 'service',
    serviceEventPublicId: item.eventPublicId,
    adjustmentCode: null,
    quantity: 1,
    unitAmountMinor: item.lineMinor,
    sourceEvidenceSha256: item.evidenceSha256,
  }));
  if (settlement.discountMinor > 0) {
    invoiceLines.push({
      linePublicId: await createDeterministicSourceId(
        'invline', context.tenantId, 'legacy_pharmacy_invoice_discount', context.invoiceNo,
      ),
      lineType: 'discount',
      serviceEventPublicId: null,
      adjustmentCode: 'PHARMACY_GLOBAL_DISCOUNT',
      quantity: 1,
      unitAmountMinor: -settlement.discountMinor,
      sourceEvidenceSha256: invoiceEvidenceSha256,
    });
  }
  const tender = pharmacyTender(context.paymentMode);
  if (settlement.paidMinor > 0 && tender.tenderType !== 'cash' && !context.externalTransactionId) {
    throw new Error('Canonical non-cash pharmacy payment requires external transaction authority');
  }
  const paymentEvidenceSha256 = settlement.paidMinor > 0
    ? await createSourceEvidenceSha256({
        sourceType: 'legacy_pharmacy_invoice_payment',
        sourcePublicId: context.invoiceNo,
        paymentMode: context.paymentMode,
        externalTransactionId: context.externalTransactionId,
        paidMinor: settlement.paidMinor,
      })
    : null;
  const receiptPublicId = settlement.paidMinor > 0
    ? await createDeterministicSourceId('receipt', context.tenantId, 'legacy_pharmacy_invoice_payment', context.invoiceNo)
    : null;
  const invoicePrepared = await prepareInvoiceSettlementBatch(db, {
    tenantId: context.tenantId,
    commandIdempotencyKey: `${commandIdempotencyKey}:invoice`,
    invoice: {
      tenantId: context.tenantId,
      invoicePublicId,
      invoiceNumber: context.invoiceNo,
      legacyPatientId: context.patientId,
      currencyCode: 'BDT',
      issuedAtUtc: context.occurredAtUtc,
      businessDate: context.businessDate,
      lines: invoiceLines,
      sourceType: 'legacy_pharmacy_invoice',
      sourcePublicId: context.invoiceNo,
      sourceTable: 'pharmacy_invoices',
      sourceEvidenceSha256: invoiceEvidenceSha256,
      idempotencyKey: `legacy_pharmacy_invoice:${context.invoiceNo}`,
      outboxEventPublicId: await createDeterministicSourceId(
        'outevt', context.tenantId, 'legacy_pharmacy_invoice', context.invoiceNo,
      ),
    },
    payment: settlement.paidMinor > 0 && receiptPublicId && paymentEvidenceSha256 ? {
      receiptPublicId,
      receiptNumber: `${context.invoiceNo}-PAY`,
      tenderPublicId: await createDeterministicSourceId('tender', context.tenantId, 'legacy_pharmacy_invoice_payment', context.invoiceNo),
      allocationPublicId: await createDeterministicSourceId('payalloc', context.tenantId, 'legacy_pharmacy_invoice_payment', context.invoiceNo),
      tenderType: tender.tenderType,
      methodCode: tender.methodCode,
      amountMinor: settlement.paidMinor,
      externalTransactionId: context.externalTransactionId,
      legacyCollectorId: context.userId,
      legacyCounterId: context.counterId,
      legacyCounterSessionId: null,
      receivedAtUtc: context.occurredAtUtc,
      sourceType: 'legacy_pharmacy_invoice_payment',
      sourcePublicId: context.invoiceNo,
      sourceTable: 'pharmacy_invoices',
      sourceEvidenceSha256: paymentEvidenceSha256,
      paymentOutboxEventPublicId: await createDeterministicSourceId(
        'outevt', context.tenantId, 'legacy_pharmacy_payment', context.invoiceNo,
      ),
      cashCustodyEventPublicId: tender.tenderType === 'cash'
        ? await createDeterministicSourceId('outevt', context.tenantId, 'legacy_pharmacy_cash', context.invoiceNo)
        : null,
    } : null,
    deposit: settlement.depositMinor > 0 ? {
      adjustmentNumber: `${context.invoiceNo}-DEP`,
      amountMinor: settlement.depositMinor,
      appliedAtUtc: context.occurredAtUtc,
      businessDate: context.businessDate,
      sourceType: 'legacy_pharmacy_invoice_deposit',
      sourceTable: 'billing_deposit_adjustments',
    } : null,
  });
  if (
    invoicePrepared.result.totalMinor !== settlement.totalMinor
    || invoicePrepared.result.paidMinor !== settlement.paidMinor + settlement.depositMinor
    || invoicePrepared.result.dueMinor !== settlement.creditMinor
  ) {
    throw new Error('Canonical pharmacy settlement does not match the legacy payment split');
  }

  const statements: CanonicalPreparedStatement[] = [];
  for (const item of preparedItems) {
    const authority = item.input.canonical!;
    statements.push(
      db.prepare(`
        INSERT INTO canonical_service_requests (
          tenant_id,request_public_id,legacy_patient_id,encounter_public_id,
          service_public_id,requested_quantity,fulfilled_quantity,last_event_public_id,
          status,requested_at_utc,source_evidence_sha256
        ) VALUES (?,?,?,NULL,?,?,?,?, 'fulfilled',?,?)
      `).bind(
        context.tenantId,
        item.requestPublicId,
        context.patientId,
        authority.servicePublicId,
        item.input.quantity,
        item.input.quantity,
        item.eventPublicId,
        context.occurredAtUtc,
        item.evidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_service_events (
          tenant_id,event_public_id,request_public_id,encounter_public_id,
          service_public_id,event_type,quantity,status,occurred_at_utc,source_evidence_sha256
        ) VALUES (?,?,?,NULL,?,'dispensed',1*?,'posted',?,?)
      `).bind(
        context.tenantId,
        item.eventPublicId,
        item.requestPublicId,
        authority.servicePublicId,
        item.input.quantity,
        context.occurredAtUtc,
        item.evidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        context.tenantId,
        item.requestOutboxPublicId,
        'canonical_service_request',
        item.requestPublicId,
        'canonical.service_request.created',
        stableCanonicalJson({
          requestPublicId: item.requestPublicId,
          servicePublicId: authority.servicePublicId,
          requestedQuantity: item.input.quantity,
          status: 'fulfilled',
        }),
        context.occurredAtUtc,
        context.businessDate,
        `${commandIdempotencyKey}:request:${item.input.lineNumber}`,
      ),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        context.tenantId,
        item.eventOutboxPublicId,
        'canonical_service_event',
        item.eventPublicId,
        'canonical.service_event.recorded',
        stableCanonicalJson({
          eventPublicId: item.eventPublicId,
          requestPublicId: item.requestPublicId,
          eventType: 'dispensed',
          quantity: item.input.quantity,
          requestStatus: 'fulfilled',
        }),
        context.occurredAtUtc,
        context.businessDate,
        `${commandIdempotencyKey}:event:${item.input.lineNumber}`,
      ),
    );
  }
  statements.push(...invoicePrepared.statements);

  const assertionOperationKey = `pharmacy-sale:${context.sourceKind}:${context.invoiceNo}`;
  for (const item of preparedItems) {
    const authority = item.input.canonical!;
    statements.push(
      db.prepare(`
        UPDATE canonical_inventory_balances
        SET quantity_base=?,version=?,updated_at_utc=?
        WHERE tenant_id=? AND item_public_id=? AND location_public_id=? AND lot_public_id=?
          AND quantity_base=? AND version=?
          AND EXISTS (
            SELECT 1 FROM canonical_inventory_stock_policies p
            WHERE p.tenant_id=? AND p.item_public_id=? AND p.location_public_id=?
              AND (p.allow_negative_stock=1 OR ?>=0)
          )
      `).bind(
        item.balanceAfterBase,
        item.balanceVersionAfter,
        context.occurredAtUtc,
        context.tenantId,
        authority.itemPublicId,
        authority.locationPublicId,
        authority.lotPublicId,
        item.balanceBeforeBase,
        item.balanceVersionBefore,
        context.tenantId,
        authority.itemPublicId,
        authority.locationPublicId,
        item.balanceAfterBase,
      ),
      prepareFinancialBatchAssertion(db, {
        tenantId: context.tenantId,
        operationKey: assertionOperationKey,
        stepKey: `balance-${item.input.lineNumber}`,
        expectedChanges: 1,
      }),
      movementStatement(db, {
        tenantId: context.tenantId,
        invoiceNo: context.invoiceNo,
        invoicePublicId,
        item,
        occurredAtUtc: context.occurredAtUtc,
        businessDate: context.businessDate,
        actorUserId: context.userId,
      }),
      prepareFinancialBatchAssertion(db, {
        tenantId: context.tenantId,
        operationKey: assertionOperationKey,
        stepKey: `movement-${item.input.lineNumber}`,
        expectedChanges: 1,
      }),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        context.tenantId,
        item.movementOutboxPublicId,
        'canonical_inventory_movement',
        item.movementPublicId,
        'canonical.inventory.movement.posted',
        stableCanonicalJson({
          movementPublicId: item.movementPublicId,
          itemPublicId: authority.itemPublicId,
          movementType: 'sale',
          quantityBase: item.quantityBase,
          balanceAfterBase: item.balanceAfterBase,
          serviceEventPublicId: item.eventPublicId,
          invoicePublicId,
          invoiceLinePublicId: item.invoiceLinePublicId,
        }),
        context.occurredAtUtc,
        context.businessDate,
        `${commandIdempotencyKey}:movement:${item.input.lineNumber}`,
      ),
    );
  }

  const reconciliationStatements: CanonicalPreparedStatement[] = [];
  for (const item of preparedItems) {
    reconciliationStatements.push(
      actualInvoiceItemMappingStatement(db, {
        tenantId: context.tenantId,
        entityType: 'service_request',
        canonicalPublicId: item.requestPublicId,
        invoiceNo: context.invoiceNo,
        item: item.input,
        evidenceSha256: item.evidenceSha256,
      }),
      prepareFinancialBatchAssertion(db, {
        tenantId: context.tenantId,
        operationKey: assertionOperationKey,
        stepKey: `request-source-${item.input.lineNumber}`,
        expectedChanges: 1,
      }),
      actualInvoiceItemMappingStatement(db, {
        tenantId: context.tenantId,
        entityType: 'service_event',
        canonicalPublicId: item.eventPublicId,
        invoiceNo: context.invoiceNo,
        item: item.input,
        evidenceSha256: item.evidenceSha256,
      }),
      prepareFinancialBatchAssertion(db, {
        tenantId: context.tenantId,
        operationKey: assertionOperationKey,
        stepKey: `event-source-${item.input.lineNumber}`,
        expectedChanges: 1,
      }),
      actualMovementMappingStatement(db, {
        tenantId: context.tenantId,
        canonicalPublicId: item.movementPublicId,
        invoiceNo: context.invoiceNo,
        item: item.input,
        evidenceSha256: item.evidenceSha256,
      }),
      prepareFinancialBatchAssertion(db, {
        tenantId: context.tenantId,
        operationKey: assertionOperationKey,
        stepKey: `movement-source-${item.input.lineNumber}`,
        expectedChanges: 1,
      }),
    );
  }
  reconciliationStatements.push(
    prepareClearFinancialBatchAssertions(db, context.tenantId, assertionOperationKey),
  );

  const result: SettlePharmacySaleResult = {
    invoiceNo: context.invoiceNo,
    invoicePublicId,
    receiptPublicId: invoicePrepared.result.receiptPublicId,
    totalMinor: invoicePrepared.result.totalMinor,
    paymentMinor: invoicePrepared.result.paymentMinor,
    depositMinor: invoicePrepared.result.depositMinor,
    paidMinor: invoicePrepared.result.paidMinor,
    dueMinor: invoicePrepared.result.dueMinor,
    movementCount: preparedItems.length,
    items: preparedItems.map((item) => ({
      lineNumber: item.input.lineNumber,
      requestPublicId: item.requestPublicId,
      eventPublicId: item.eventPublicId,
      invoiceLinePublicId: item.invoiceLinePublicId,
      movementPublicId: item.movementPublicId,
      quantityBase: item.quantityBase,
    })),
  };

  return runCanonicalBatch(db, {
    tenantId: context.tenantId,
    commandName: 'canonical.pharmacy_sale.settle',
    idempotencyKey: commandIdempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements,
    result,
    event: {
      eventPublicId: await createDeterministicSourceId(
        'outevt', context.tenantId, 'legacy_pharmacy_sale', `${context.sourceKind}:${context.invoiceNo}`,
      ),
      aggregateType: 'canonical_pharmacy_sale',
      aggregatePublicId: invoicePublicId,
      eventType: 'canonical.pharmacy_sale.settled',
      occurredAtUtc: context.occurredAtUtc,
      businessDate: context.businessDate,
      payload: {
        sourceKind: context.sourceKind,
        sourceDocumentId: context.sourceDocumentId,
        invoiceNo: context.invoiceNo,
        invoicePublicId,
        totalMinor: result.totalMinor,
        paidMinor: result.paidMinor,
        dueMinor: result.dueMinor,
        movementCount: result.movementCount,
      },
    },
  });
}
