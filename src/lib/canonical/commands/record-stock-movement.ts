import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { toUtcIso } from '../time';

export type DirectStockMovementType =
  | 'purchase_receipt'
  | 'issue'
  | 'dispense'
  | 'sale'
  | 'patient_return'
  | 'supplier_return'
  | 'waste'
  | 'expiry'
  | 'adjustment_in'
  | 'adjustment_out';

export type RecordStockMovementType = DirectStockMovementType | 'transfer';

export interface RecordStockMovementInput {
  tenantId: string;
  movementPublicId: string;
  movementType: RecordStockMovementType;
  itemPublicId: string;
  locationPublicId: string;
  lotPublicId: string;
  sourceQuantity: number;
  sourceUnitCode: string;
  destinationLocationPublicId?: string | null;
  transferPublicId?: string | null;
  inboundMovementPublicId?: string | null;
  serviceEventPublicId?: string | null;
  invoicePublicId?: string | null;
  invoiceLinePublicId?: string | null;
  occurredAtUtc: string;
  businessDate: string;
  actorUserId?: number | null;
  sourceType: string;
  sourcePublicId: string;
  sourceLinePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}

export interface RecordStockMovementResult {
  movementPublicId: string;
  movementType: RecordStockMovementType;
  quantityBase: number;
  balanceBeforeBase: number;
  balanceAfterBase: number;
  transferPublicId: string | null;
  inboundMovementPublicId: string | null;
  destinationBalanceBeforeBase: number | null;
  destinationBalanceAfterBase: number | null;
}

interface ItemRow {
  base_unit_code: string;
  service_public_id: string | null;
  status: string;
}

interface ConversionRow {
  numerator: number;
  denominator: number;
  base_unit_code: string;
}

interface BalanceRow {
  quantity_base: number;
  version: number;
}

interface PolicyRow {
  allow_negative_stock: number;
}

interface ServiceLinkRow {
  event_public_id: string;
  service_public_id: string;
  event_type: string;
  event_status: string;
  invoice_public_id: string | null;
  invoice_line_public_id: string | null;
  invoice_status: string | null;
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

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function optionalPositiveSafeInteger(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  return positiveSafeInteger(value, label);
}

function hash(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError('sourceEvidenceSha256 must be a lowercase SHA-256 hex digest');
  }
  return value;
}

function normalizedUtc(value: string): string {
  if (toUtcIso(value) !== value) throw new RangeError('occurredAtUtc must be a normalized UTC ISO timestamp');
  return value;
}

function request(input: RecordStockMovementInput): Record<string, unknown> {
  return {
    movementPublicId: input.movementPublicId,
    movementType: input.movementType,
    itemPublicId: input.itemPublicId,
    locationPublicId: input.locationPublicId,
    lotPublicId: input.lotPublicId,
    sourceQuantity: input.sourceQuantity,
    sourceUnitCode: input.sourceUnitCode,
    destinationLocationPublicId: input.destinationLocationPublicId ?? null,
    transferPublicId: input.transferPublicId ?? null,
    inboundMovementPublicId: input.inboundMovementPublicId ?? null,
    serviceEventPublicId: input.serviceEventPublicId ?? null,
    invoicePublicId: input.invoicePublicId ?? null,
    invoiceLinePublicId: input.invoiceLinePublicId ?? null,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    actorUserId: input.actorUserId ?? null,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceLinePublicId: input.sourceLinePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
}

function direction(type: DirectStockMovementType): 'in' | 'out' {
  return ['purchase_receipt', 'patient_return', 'adjustment_in'].includes(type) ? 'in' : 'out';
}

function signed(type: DirectStockMovementType | 'transfer_out' | 'transfer_in', quantity: number): number {
  return ['purchase_receipt', 'patient_return', 'adjustment_in', 'transfer_in'].includes(type)
    ? quantity
    : -quantity;
}

async function balanceRow(
  db: CanonicalBatchDatabase,
  tenantId: string,
  itemPublicId: string,
  locationPublicId: string,
  lotPublicId: string,
): Promise<BalanceRow> {
  return (await db.prepare(`
    SELECT quantity_base,version
    FROM canonical_inventory_balances
    WHERE tenant_id=? AND item_public_id=? AND location_public_id=? AND lot_public_id=?
    LIMIT 1
  `).bind(tenantId, itemPublicId, locationPublicId, lotPublicId).first<BalanceRow>())
    ?? { quantity_base: 0, version: 0 };
}

async function negativePolicy(
  db: CanonicalBatchDatabase,
  tenantId: string,
  itemPublicId: string,
  locationPublicId: string,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT allow_negative_stock
    FROM canonical_inventory_stock_policies
    WHERE tenant_id=? AND item_public_id=? AND location_public_id=?
    LIMIT 1
  `).bind(tenantId, itemPublicId, locationPublicId).first<PolicyRow>();
  return row?.allow_negative_stock === 1;
}

function ensureBalanceStatement(
  db: CanonicalBatchDatabase,
  input: RecordStockMovementInput,
  locationPublicId: string,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_inventory_balances (
      tenant_id,item_public_id,location_public_id,lot_public_id,quantity_base,version,
      projection_guard,source_evidence_sha256,updated_at_utc
    ) VALUES (?,?,?,?,0,0,1,?,?)
    ON CONFLICT(tenant_id,item_public_id,location_public_id,lot_public_id) DO NOTHING
  `).bind(
    input.tenantId,
    input.itemPublicId,
    locationPublicId,
    input.lotPublicId,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
  );
}

function updateBalanceStatement(
  db: CanonicalBatchDatabase,
  input: RecordStockMovementInput,
  locationPublicId: string,
  before: BalanceRow,
  afterQuantity: number,
): CanonicalPreparedStatement {
  return db.prepare(`
    UPDATE canonical_inventory_balances
    SET quantity_base=?,version=?,projection_guard=1,source_evidence_sha256=?,updated_at_utc=?
    WHERE tenant_id=? AND item_public_id=? AND location_public_id=? AND lot_public_id=?
      AND quantity_base=? AND version=?
  `).bind(
    afterQuantity,
    before.version + 1,
    input.sourceEvidenceSha256,
    input.occurredAtUtc,
    input.tenantId,
    input.itemPublicId,
    locationPublicId,
    input.lotPublicId,
    before.quantity_base,
    before.version,
  );
}

function movementStatement(
  db: CanonicalBatchDatabase,
  input: RecordStockMovementInput,
  values: {
    movementPublicId: string;
    movementType: DirectStockMovementType | 'transfer_out' | 'transfer_in';
    locationPublicId: string;
    sourceQuantity: number;
    numerator: number;
    denominator: number;
    quantityBase: number;
    balanceBefore: BalanceRow;
    balanceAfter: number;
    transferPublicId: string | null;
    serviceEventPublicId: string | null;
    invoicePublicId: string | null;
    invoiceLinePublicId: string | null;
  },
): CanonicalPreparedStatement {
  const movementDirection = values.movementType === 'transfer_in'
    ? 'in'
    : values.movementType === 'transfer_out'
      ? 'out'
      : direction(values.movementType);
  const signedQuantity = movementDirection === 'in' ? values.quantityBase : -values.quantityBase;
  return db.prepare(`
    INSERT INTO canonical_inventory_movements (
      tenant_id,movement_public_id,item_public_id,location_public_id,lot_public_id,
      movement_type,direction,source_quantity,source_unit_code,conversion_numerator,
      conversion_denominator,quantity_base,signed_quantity_base,balance_before_base,
      balance_after_base,transfer_public_id,service_event_public_id,invoice_public_id,
      invoice_line_public_id,source_type,source_public_id,source_line_public_id,
      source_table,status,occurred_at_utc,business_date,actor_user_id,balance_guard,
      source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
      CASE WHEN EXISTS(
        SELECT 1 FROM canonical_inventory_balances
        WHERE tenant_id=? AND item_public_id=? AND location_public_id=? AND lot_public_id=?
          AND quantity_base=? AND version=?
      ) THEN 1 ELSE 0 END,?)
  `).bind(
    input.tenantId,
    values.movementPublicId,
    input.itemPublicId,
    values.locationPublicId,
    input.lotPublicId,
    values.movementType,
    movementDirection,
    values.sourceQuantity,
    input.sourceUnitCode,
    values.numerator,
    values.denominator,
    values.quantityBase,
    signedQuantity,
    values.balanceBefore.quantity_base,
    values.balanceAfter,
    values.transferPublicId,
    values.serviceEventPublicId,
    values.invoicePublicId,
    values.invoiceLinePublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceLinePublicId,
    input.sourceTable,
    'posted',
    input.occurredAtUtc,
    input.businessDate,
    input.actorUserId ?? null,
    input.tenantId,
    input.itemPublicId,
    values.locationPublicId,
    input.lotPublicId,
    values.balanceAfter,
    values.balanceBefore.version + 1,
    input.sourceEvidenceSha256,
  );
}

function mappingStatement(
  db: CanonicalBatchDatabase,
  input: RecordStockMovementInput,
  movementPublicId: string,
  sourceLinePublicId: string,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,?,?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    'inventory_movement',
    movementPublicId,
    input.sourceType,
    `${input.sourcePublicId}:${sourceLinePublicId}`,
    input.sourceTable,
    input.sourceEvidenceSha256,
  );
}

async function validateServiceLink(
  db: CanonicalBatchDatabase,
  input: RecordStockMovementInput,
  item: ItemRow,
): Promise<void> {
  const serviceEventPublicId = optionalExact(input.serviceEventPublicId, 'serviceEventPublicId');
  const invoicePublicId = optionalExact(input.invoicePublicId, 'invoicePublicId');
  const invoiceLinePublicId = optionalExact(input.invoiceLinePublicId, 'invoiceLinePublicId');
  if (input.movementType === 'dispense') {
    if (!serviceEventPublicId || invoicePublicId || invoiceLinePublicId) {
      throw new TypeError('dispense requires one service event and no invoice line');
    }
  } else if (input.movementType === 'sale') {
    if (!serviceEventPublicId || !invoicePublicId || !invoiceLinePublicId) {
      throw new TypeError('sale requires one service event and one invoice line');
    }
  } else if (serviceEventPublicId || invoicePublicId || invoiceLinePublicId) {
    throw new TypeError('Only dispense or sale may link service and invoice facts');
  } else {
    return;
  }
  if (!item.service_public_id) throw new Error('Canonical inventory item is not linked to a service catalog product');

  const row = await db.prepare(`
    SELECT e.event_public_id,e.service_public_id,e.event_type,e.status event_status,
           il.invoice_public_id,il.line_public_id invoice_line_public_id,i.status invoice_status
    FROM canonical_service_events e
    LEFT JOIN canonical_invoice_lines il
      ON il.tenant_id=e.tenant_id AND il.service_event_public_id=e.event_public_id
      AND il.invoice_public_id=? AND il.line_public_id=?
    LEFT JOIN canonical_invoices i
      ON i.tenant_id=il.tenant_id AND i.invoice_public_id=il.invoice_public_id
    WHERE e.tenant_id=? AND e.event_public_id=?
    LIMIT 1
  `).bind(
    invoicePublicId,
    invoiceLinePublicId,
    input.tenantId,
    serviceEventPublicId,
  ).first<ServiceLinkRow>();
  if (!row || row.event_status !== 'posted' || row.event_type !== 'dispensed') {
    throw new Error('Linked canonical dispense service event is not posted');
  }
  if (row.service_public_id !== item.service_public_id) {
    throw new Error('Linked service event does not match the inventory item service identity');
  }
  if (input.movementType === 'sale' && (
    row.invoice_public_id !== invoicePublicId
    || row.invoice_line_public_id !== invoiceLinePublicId
    || row.invoice_status !== 'posted'
  )) {
    throw new Error('Linked canonical invoice line is not a posted line for the dispense event');
  }
}

export async function recordStockMovement(
  db: CanonicalBatchDatabase,
  input: RecordStockMovementInput,
): Promise<CanonicalCommandResult<RecordStockMovementResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.movementPublicId, 'movementPublicId');
  exact(input.itemPublicId, 'itemPublicId');
  exact(input.locationPublicId, 'locationPublicId');
  exact(input.lotPublicId, 'lotPublicId');
  exact(input.sourceUnitCode, 'sourceUnitCode');
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceLinePublicId, 'sourceLinePublicId');
  exact(input.sourceTable, 'sourceTable');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  positiveSafeInteger(input.sourceQuantity, 'sourceQuantity');
  optionalPositiveSafeInteger(input.actorUserId, 'actorUserId');
  normalizedUtc(input.occurredAtUtc);
  hash(input.sourceEvidenceSha256);

  const replay = await readCanonicalCommandReplay<RecordStockMovementResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.inventory.stock_movement.record',
    idempotencyKey: input.idempotencyKey,
    request: request(input),
  });
  if (replay) return replay;

  const item = await db.prepare(`
    SELECT base_unit_code,service_public_id,status
    FROM canonical_inventory_items
    WHERE tenant_id=? AND item_public_id=? LIMIT 1
  `).bind(input.tenantId, input.itemPublicId).first<ItemRow>();
  if (!item || item.status !== 'active') throw new Error('Canonical inventory item not found or inactive');

  const lot = await db.prepare(`
    SELECT 1 ok FROM canonical_inventory_lots
    WHERE tenant_id=? AND lot_public_id=? AND item_public_id=? AND status IN ('active','blocked','expired')
    LIMIT 1
  `).bind(input.tenantId, input.lotPublicId, input.itemPublicId).first<{ ok: number }>();
  if (!lot) throw new Error('Canonical inventory lot not found for item');

  const location = await db.prepare(`
    SELECT 1 ok FROM canonical_inventory_locations
    WHERE tenant_id=? AND location_public_id=? AND status='active' LIMIT 1
  `).bind(input.tenantId, input.locationPublicId).first<{ ok: number }>();
  if (!location) throw new Error('Canonical inventory location not found or inactive');

  let numerator = 1;
  let denominator = 1;
  if (input.sourceUnitCode !== item.base_unit_code) {
    const conversion = await db.prepare(`
      SELECT numerator,denominator,base_unit_code
      FROM canonical_inventory_unit_conversions
      WHERE tenant_id=? AND item_public_id=? AND source_unit_code=? AND status='active'
      LIMIT 1
    `).bind(input.tenantId, input.itemPublicId, input.sourceUnitCode).first<ConversionRow>();
    if (!conversion || conversion.base_unit_code !== item.base_unit_code) {
      throw new Error('Exact active inventory unit conversion not found');
    }
    numerator = conversion.numerator;
    denominator = conversion.denominator;
  }
  if (input.sourceQuantity > Math.floor(Number.MAX_SAFE_INTEGER / numerator)) {
    throw new RangeError('Converted inventory quantity exceeds safe integer range');
  }
  const product = input.sourceQuantity * numerator;
  if (product % denominator !== 0) {
    throw new RangeError('Inventory unit conversion does not produce an integral base quantity');
  }
  const quantityBase = product / denominator;
  positiveSafeInteger(quantityBase, 'quantityBase');

  await validateServiceLink(db, input, item);

  const sourceBalance = await balanceRow(
    db,
    input.tenantId,
    input.itemPublicId,
    input.locationPublicId,
    input.lotPublicId,
  );

  if (input.movementType !== 'transfer') {
    optionalExact(input.destinationLocationPublicId, 'destinationLocationPublicId');
    if (input.destinationLocationPublicId || input.transferPublicId || input.inboundMovementPublicId) {
      throw new TypeError('Transfer identifiers are only valid for transfer movements');
    }
    const movementDirection = direction(input.movementType);
    const signedQuantity = movementDirection === 'in' ? quantityBase : -quantityBase;
    const balanceAfter = sourceBalance.quantity_base + signedQuantity;
    if (!Number.isSafeInteger(balanceAfter)) throw new RangeError('Inventory balance exceeds safe integer range');
    if (balanceAfter < 0 && !(await negativePolicy(db, input.tenantId, input.itemPublicId, input.locationPublicId))) {
      throw new RangeError('Inventory movement would violate the negative stock policy');
    }
    const result: RecordStockMovementResult = {
      movementPublicId: input.movementPublicId,
      movementType: input.movementType,
      quantityBase,
      balanceBeforeBase: sourceBalance.quantity_base,
      balanceAfterBase: balanceAfter,
      transferPublicId: null,
      inboundMovementPublicId: null,
      destinationBalanceBeforeBase: null,
      destinationBalanceAfterBase: null,
    };
    return runCanonicalBatch(db, {
      tenantId: input.tenantId,
      commandName: 'canonical.inventory.stock_movement.record',
      idempotencyKey: input.idempotencyKey,
      request: request(input),
      statements: [
        ensureBalanceStatement(db, input, input.locationPublicId),
        updateBalanceStatement(db, input, input.locationPublicId, sourceBalance, balanceAfter),
        movementStatement(db, input, {
          movementPublicId: input.movementPublicId,
          movementType: input.movementType,
          locationPublicId: input.locationPublicId,
          sourceQuantity: input.sourceQuantity,
          numerator,
          denominator,
          quantityBase,
          balanceBefore: sourceBalance,
          balanceAfter,
          transferPublicId: null,
          serviceEventPublicId: input.serviceEventPublicId ?? null,
          invoicePublicId: input.invoicePublicId ?? null,
          invoiceLinePublicId: input.invoiceLinePublicId ?? null,
        }),
      ],
      reconciliationStatements: [mappingStatement(db, input, input.movementPublicId, input.sourceLinePublicId)],
      result,
      event: {
        eventPublicId: input.outboxEventPublicId,
        aggregateType: 'canonical_inventory_movement',
        aggregatePublicId: input.movementPublicId,
        eventType: 'canonical.inventory.stock_movement.recorded',
        occurredAtUtc: input.occurredAtUtc,
        businessDate: input.businessDate,
        payload: {
          movementPublicId: input.movementPublicId,
          movementType: input.movementType,
          itemPublicId: input.itemPublicId,
          locationPublicId: input.locationPublicId,
          lotPublicId: input.lotPublicId,
          quantityBase,
          balanceAfterBase: balanceAfter,
        },
      },
    });
  }

  const destinationLocationPublicId = optionalExact(input.destinationLocationPublicId, 'destinationLocationPublicId');
  const transferPublicId = optionalExact(input.transferPublicId, 'transferPublicId');
  const inboundMovementPublicId = optionalExact(input.inboundMovementPublicId, 'inboundMovementPublicId');
  if (!destinationLocationPublicId || !transferPublicId || !inboundMovementPublicId) {
    throw new TypeError('transfer requires destinationLocationPublicId, transferPublicId, and inboundMovementPublicId');
  }
  if (destinationLocationPublicId === input.locationPublicId) throw new TypeError('Transfer locations must be different');
  const destination = await db.prepare(`
    SELECT 1 ok FROM canonical_inventory_locations
    WHERE tenant_id=? AND location_public_id=? AND status='active' LIMIT 1
  `).bind(input.tenantId, destinationLocationPublicId).first<{ ok: number }>();
  if (!destination) throw new Error('Canonical destination inventory location not found or inactive');

  const sourceAfter = sourceBalance.quantity_base - quantityBase;
  if (sourceAfter < 0 && !(await negativePolicy(db, input.tenantId, input.itemPublicId, input.locationPublicId))) {
    throw new RangeError('Inventory transfer would violate the negative stock policy');
  }
  const destinationBalance = await balanceRow(
    db,
    input.tenantId,
    input.itemPublicId,
    destinationLocationPublicId,
    input.lotPublicId,
  );
  const destinationAfter = destinationBalance.quantity_base + quantityBase;
  if (!Number.isSafeInteger(sourceAfter) || !Number.isSafeInteger(destinationAfter)) {
    throw new RangeError('Inventory transfer balance exceeds safe integer range');
  }
  const result: RecordStockMovementResult = {
    movementPublicId: input.movementPublicId,
    movementType: 'transfer',
    quantityBase,
    balanceBeforeBase: sourceBalance.quantity_base,
    balanceAfterBase: sourceAfter,
    transferPublicId,
    inboundMovementPublicId,
    destinationBalanceBeforeBase: destinationBalance.quantity_base,
    destinationBalanceAfterBase: destinationAfter,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.inventory.stock_movement.record',
    idempotencyKey: input.idempotencyKey,
    request: request(input),
    statements: [
      ensureBalanceStatement(db, input, input.locationPublicId),
      ensureBalanceStatement(db, input, destinationLocationPublicId),
      db.prepare(`
        INSERT INTO canonical_inventory_transfers (
          tenant_id,transfer_public_id,item_public_id,lot_public_id,
          from_location_public_id,to_location_public_id,quantity_base,status,
          occurred_at_utc,business_date,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,'posted',?,?,?)
      `).bind(
        input.tenantId,
        transferPublicId,
        input.itemPublicId,
        input.lotPublicId,
        input.locationPublicId,
        destinationLocationPublicId,
        quantityBase,
        input.occurredAtUtc,
        input.businessDate,
        input.sourceEvidenceSha256,
      ),
      updateBalanceStatement(db, input, input.locationPublicId, sourceBalance, sourceAfter),
      updateBalanceStatement(db, input, destinationLocationPublicId, destinationBalance, destinationAfter),
      movementStatement(db, input, {
        movementPublicId: input.movementPublicId,
        movementType: 'transfer_out',
        locationPublicId: input.locationPublicId,
        sourceQuantity: input.sourceQuantity,
        numerator,
        denominator,
        quantityBase,
        balanceBefore: sourceBalance,
        balanceAfter: sourceAfter,
        transferPublicId,
        serviceEventPublicId: null,
        invoicePublicId: null,
        invoiceLinePublicId: null,
      }),
      movementStatement(db, input, {
        movementPublicId: inboundMovementPublicId,
        movementType: 'transfer_in',
        locationPublicId: destinationLocationPublicId,
        sourceQuantity: input.sourceQuantity,
        numerator,
        denominator,
        quantityBase,
        balanceBefore: destinationBalance,
        balanceAfter: destinationAfter,
        transferPublicId,
        serviceEventPublicId: null,
        invoicePublicId: null,
        invoiceLinePublicId: null,
      }),
    ],
    reconciliationStatements: [
      mappingStatement(db, input, input.movementPublicId, `${input.sourceLinePublicId}:out`),
      mappingStatement(db, input, inboundMovementPublicId, `${input.sourceLinePublicId}:in`),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_inventory_transfer',
      aggregatePublicId: transferPublicId,
      eventType: 'canonical.inventory.transfer.recorded',
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        transferPublicId,
        outboundMovementPublicId: input.movementPublicId,
        inboundMovementPublicId,
        itemPublicId: input.itemPublicId,
        lotPublicId: input.lotPublicId,
        fromLocationPublicId: input.locationPublicId,
        toLocationPublicId: destinationLocationPublicId,
        quantityBase,
      },
    },
  });
}
