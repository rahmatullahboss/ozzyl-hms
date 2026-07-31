import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface InventoryBackfillPreparedStatement {
  bind(...values: unknown[]): InventoryBackfillPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface InventoryBackfillDatabase {
  prepare(sql: string): InventoryBackfillPreparedStatement;
  batch(statements: InventoryBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface InventoryBackfillOptions {
  tenantId: string;
  runPublicId: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}

export interface InventoryBackfillCounts {
  scanned: number;
  itemsCreated: number;
  locationsCreated: number;
  lotsCreated: number;
  movementsCreated: number;
  balancesCreated: number;
  mappingsCreated: number;
  issuesCreated: number;
}

export interface InventoryBackfillResult {
  completed: boolean;
  counts: InventoryBackfillCounts;
}

interface RunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface MappingRow { canonical_public_id: string | null; mapping_status: string; evidence_sha256: string | null }
interface CountRow { count: number }
interface BalanceRow { quantity_base: number; version: number }

interface SourceRow {
  sourceKind: 'general' | 'pharmacy' | 'medicine';
  sourceType: string;
  sourceTable: string;
  sourceId: number;
  sortKey: string;
  rawMovementType: string;
  itemId: number;
  itemName: string;
  itemCode: string | null;
  unitCode: string | null;
  linkedInventoryItemId: number | null;
  fixedAsset: number;
  locationId: number | null;
  locationName: string;
  locationCode: string | null;
  locationType: string;
  lotId: number | null;
  lotCode: string | null;
  expiryDate: string | null;
  inQuantity: number;
  outQuantity: number;
  quantity: number;
  cachedQuantity: number | null;
  referenceType: string | null;
  referenceId: number | null;
  referenceNo: string | null;
  occurredAt: string | null;
  actorUserId: number | null;
}

interface CanonicalContext {
  itemPublicId: string;
  locationPublicId: string;
  lotPublicId: string;
  baseUnitCode: string;
}

type CanonicalMovementType =
  | 'purchase_receipt'
  | 'transfer_out'
  | 'transfer_in'
  | 'issue'
  | 'dispense'
  | 'sale'
  | 'patient_return'
  | 'supplier_return'
  | 'waste'
  | 'expiry'
  | 'adjustment_in'
  | 'adjustment_out';

const MIGRATION = '0514_canonical_inventory_links.sql';
const CHECKPOINT_SOURCE = 'legacy_inventory_movements';
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function emptyCounts(): InventoryBackfillCounts {
  return {
    scanned: 0,
    itemsCreated: 0,
    locationsCreated: 0,
    lotsCreated: 0,
    movementsCreated: 0,
    balancesCreated: 0,
    mappingsCreated: 0,
    issuesCreated: 0,
  };
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function limit(value: number | undefined): number {
  if (value === undefined) return 1_000_000;
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive safe integer');
  return value;
}

function utc(value: string | undefined): string {
  const result = toUtcIso(value ?? new Date().toISOString());
  return result;
}

function legacyUtc(value: string | null, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return toUtcIso(`${iso}T00:00:00+06:00`);
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)) return toUtcIso(iso);
  return toUtcIso(`${iso}+06:00`);
}

function dateOnly(value: string | null, fallbackUtc: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec(value?.trim() ?? '')?.[1] ?? fallbackUtc.slice(0, 10);
}

function normalizedUnit(value: string | null): string {
  const unit = value?.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, '_');
  return unit || 'unit';
}

function integerQuantity(value: number): number | null {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function safeBalance(value: number): number {
  if (!Number.isSafeInteger(value) || value < -MAX_SAFE || value > MAX_SAFE) {
    throw new RangeError('Canonical inventory balance exceeds safe integer range');
  }
  return value;
}

function locationKind(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes('ward')) return 'ward';
  if (normalized.includes('department')) return 'department';
  if (normalized.includes('dispens')) return 'dispensary';
  return 'store';
}

function movementType(row: SourceRow): CanonicalMovementType | null {
  const raw = row.rawMovementType.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (row.sourceKind === 'medicine') {
    if (raw === 'purchase_in') return 'purchase_receipt';
    if (raw === 'sale_out') return 'sale';
    if (raw === 'return') return 'patient_return';
    if (raw === 'expired') return 'expiry';
    if (raw === 'adjustment') return row.quantity >= 0 ? 'adjustment_in' : 'adjustment_out';
    return null;
  }
  if (['purchase', 'purchase_in', 'grn', 'receipt', 'goods_receipt', 'lab_stock_in'].includes(raw)) return 'purchase_receipt';
  if (['issue', 'requisition', 'consumption', 'consume', 'ward_issue'].includes(raw)) return 'issue';
  if (['dispense', 'dispensed'].includes(raw)) return 'dispense';
  if (['sale', 'sale_out'].includes(raw)) return 'sale';
  if (['return_in', 'patient_return', 'sales_return'].includes(raw)) return 'patient_return';
  if (['return_out', 'supplier_return', 'vendor_return'].includes(raw)) return 'supplier_return';
  if (['writeoff', 'write_off', 'waste', 'damaged'].includes(raw)) return 'waste';
  if (['expired', 'expiry'].includes(raw)) return 'expiry';
  if (['adjustment_in', 'count_in'].includes(raw)) return 'adjustment_in';
  if (['adjustment_out', 'count_out'].includes(raw)) return 'adjustment_out';
  // Legacy transfer/dispatch rows are not canonicalized as standalone legs. The
  // counterpart identity, destination/source location, and exact pair must first
  // be resolved from the workflow document; guessing one leg would create stock.
  if (['transfer_in', 'dispatch_receive', 'transfer_out', 'transfer', 'dispatch'].includes(raw)) return null;
  if (raw === 'adjustment') {
    if (row.inQuantity > 0 && row.outQuantity === 0) return 'adjustment_in';
    if (row.outQuantity > 0 && row.inQuantity === 0) return 'adjustment_out';
  }
  if (raw === 'return') {
    if (row.inQuantity > 0 && row.outQuantity === 0) return 'patient_return';
    if (row.outQuantity > 0 && row.inQuantity === 0) return 'supplier_return';
  }
  return null;
}

function isUnresolvedTransfer(row: SourceRow): boolean {
  const raw = row.rawMovementType.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ['transfer_in','dispatch_receive','transfer_out','transfer','dispatch'].includes(raw);
}

function movementQuantity(row: SourceRow): number | null {
  if (row.sourceKind === 'medicine') return integerQuantity(Math.abs(row.quantity));
  const incoming = Number(row.inQuantity ?? 0);
  const outgoing = Number(row.outQuantity ?? 0);
  if (incoming > 0 && outgoing === 0) return integerQuantity(incoming);
  if (outgoing > 0 && incoming === 0) return integerQuantity(outgoing);
  return null;
}

function direction(type: CanonicalMovementType): 'in' | 'out' {
  return ['purchase_receipt', 'transfer_in', 'patient_return', 'adjustment_in'].includes(type) ? 'in' : 'out';
}

async function safeAll<T>(db: InventoryBackfillDatabase, sql: string, tenantId: string): Promise<T[]> {
  try {
    return (await db.prepare(sql).bind(tenantId).all<T>()).results;
  } catch (error) {
    if (/no such table/i.test(error instanceof Error ? error.message : String(error))) return [];
    throw error;
  }
}

async function sourceRows(db: InventoryBackfillDatabase, tenantId: string): Promise<SourceRow[]> {
  const general = await safeAll<Record<string, unknown>>(db, `
    SELECT t.TransactionId source_id,t.TransactionType movement_type,t.ItemId item_id,
           i.ItemName item_name,i.ItemCode item_code,u.UOMName unit_code,
           i.IsFixedAsset fixed_asset,t.StoreId location_id,s.StoreName location_name,
           s.StoreCode location_code,s.StoreType location_type,t.StockId lot_id,
           st.BatchNo lot_code,st.ExpiryDate expiry_date,t.InQuantity in_quantity,
           t.OutQuantity out_quantity,0 quantity,st.AvailableQuantity cached_quantity,
           NULL linked_inventory_item_id,NULL reference_type,t.ReferenceId reference_id,
           t.ReferenceNo reference_no,COALESCE(t.TransactionDate,t.CreatedOn) occurred_at,
           t.CreatedBy actor_user_id
    FROM InventoryStockTransaction t
    JOIN InventoryItem i ON i.ItemId=t.ItemId AND CAST(i.tenant_id AS TEXT)=CAST(t.tenant_id AS TEXT)
    JOIN InventoryStore s ON s.StoreId=t.StoreId AND CAST(s.tenant_id AS TEXT)=CAST(t.tenant_id AS TEXT)
    LEFT JOIN InventoryStock st ON st.StockId=t.StockId AND CAST(st.tenant_id AS TEXT)=CAST(t.tenant_id AS TEXT)
    LEFT JOIN InventoryUnitOfMeasurement u ON u.UOMId=i.UOMId
    WHERE CAST(t.tenant_id AS TEXT)=?
    ORDER BY t.TransactionId
  `, tenantId);

  const pharmacy = await safeAll<Record<string, unknown>>(db, `
    SELECT t.id source_id,t.transaction_type movement_type,t.item_id item_id,
           i.name item_name,i.item_code item_code,u.name unit_code,0 fixed_asset,
           NULL location_id,'Pharmacy stock' location_name,'PHARMACY-RICH' location_code,
           'pharmacy' location_type,t.stock_id lot_id,COALESCE(t.batch_no,s.batch_no) lot_code,
           COALESCE(t.expiry_date,s.expiry_date) expiry_date,t.in_qty in_quantity,
           t.out_qty out_quantity,0 quantity,s.available_qty cached_quantity,
           i.inventory_item_id linked_inventory_item_id,t.reference_type reference_type,
           t.reference_id reference_id,NULL reference_no,t.created_at occurred_at,
           t.created_by actor_user_id
    FROM pharmacy_stock_transactions t
    JOIN pharmacy_items i ON i.id=t.item_id AND CAST(i.tenant_id AS TEXT)=CAST(t.tenant_id AS TEXT)
    JOIN pharmacy_stock s ON s.id=t.stock_id AND CAST(s.tenant_id AS TEXT)=CAST(t.tenant_id AS TEXT)
    LEFT JOIN pharmacy_uom u ON u.id=i.uom_id AND CAST(u.tenant_id AS TEXT)=CAST(i.tenant_id AS TEXT)
    WHERE CAST(t.tenant_id AS TEXT)=? AND COALESCE(t.is_active,1)=1
    ORDER BY t.id
  `, tenantId);

  const medicine = await safeAll<Record<string, unknown>>(db, `
    SELECT t.id source_id,t.movement_type movement_type,t.medicine_id item_id,
           m.name item_name,NULL item_code,m.unit unit_code,0 fixed_asset,
           NULL location_id,'Legacy medicine stock' location_name,'PHARMACY-LEGACY' location_code,
           'pharmacy' location_type,t.batch_id lot_id,b.batch_no lot_code,b.expiry_date expiry_date,
           0 in_quantity,0 out_quantity,t.quantity quantity,b.quantity_available cached_quantity,
           NULL linked_inventory_item_id,t.reference_type reference_type,t.reference_id reference_id,
           NULL reference_no,COALESCE(t.created_at,t.movement_date) occurred_at,
           t.created_by actor_user_id
    FROM medicine_stock_movements t
    JOIN medicines m ON m.id=t.medicine_id AND CAST(m.tenant_id AS TEXT)=CAST(t.tenant_id AS TEXT)
    LEFT JOIN medicine_stock_batches b ON b.id=t.batch_id AND CAST(b.tenant_id AS TEXT)=CAST(t.tenant_id AS TEXT)
    WHERE CAST(t.tenant_id AS TEXT)=?
    ORDER BY t.id
  `, tenantId);

  const convert = (sourceKind: SourceRow['sourceKind'], rows: Array<Record<string, unknown>>): SourceRow[] => rows.map((raw) => {
    const sourceId = Number(raw.source_id);
    const order = sourceKind === 'general' ? 1 : sourceKind === 'pharmacy' ? 2 : 3;
    return {
      sourceKind,
      sourceType: sourceKind === 'general'
        ? 'legacy_inventory_stock_transaction'
        : sourceKind === 'pharmacy'
          ? 'legacy_pharmacy_stock_transaction'
          : 'legacy_medicine_stock_movement',
      sourceTable: sourceKind === 'general'
        ? 'InventoryStockTransaction'
        : sourceKind === 'pharmacy'
          ? 'pharmacy_stock_transactions'
          : 'medicine_stock_movements',
      sourceId,
      sortKey: `${order}:${String(sourceId).padStart(20, '0')}`,
      rawMovementType: String(raw.movement_type ?? ''),
      itemId: Number(raw.item_id),
      itemName: String(raw.item_name ?? ''),
      itemCode: raw.item_code == null ? null : String(raw.item_code),
      unitCode: raw.unit_code == null ? null : String(raw.unit_code),
      linkedInventoryItemId: raw.linked_inventory_item_id == null ? null : Number(raw.linked_inventory_item_id),
      fixedAsset: Number(raw.fixed_asset ?? 0),
      locationId: raw.location_id == null ? null : Number(raw.location_id),
      locationName: String(raw.location_name ?? ''),
      locationCode: raw.location_code == null ? null : String(raw.location_code),
      locationType: String(raw.location_type ?? 'other'),
      lotId: raw.lot_id == null ? null : Number(raw.lot_id),
      lotCode: raw.lot_code == null ? null : String(raw.lot_code),
      expiryDate: raw.expiry_date == null ? null : String(raw.expiry_date).slice(0, 10),
      inQuantity: Number(raw.in_quantity ?? 0),
      outQuantity: Number(raw.out_quantity ?? 0),
      quantity: Number(raw.quantity ?? 0),
      cachedQuantity: raw.cached_quantity == null ? null : Number(raw.cached_quantity),
      referenceType: raw.reference_type == null ? null : String(raw.reference_type),
      referenceId: raw.reference_id == null ? null : Number(raw.reference_id),
      referenceNo: raw.reference_no == null ? null : String(raw.reference_no),
      occurredAt: raw.occurred_at == null ? null : String(raw.occurred_at),
      actorUserId: raw.actor_user_id == null ? null : Number(raw.actor_user_id),
    };
  });

  return [
    ...convert('general', general),
    ...convert('pharmacy', pharmacy),
    ...convert('medicine', medicine),
  ].sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}

async function issue(
  db: InventoryBackfillDatabase,
  input: {
    tenantId: string;
    runId: number;
    code: string;
    sourceType: string;
    sourcePublicId: string;
    entityPublicId?: string | null;
    summary: string;
    details?: Record<string, unknown>;
    nowUtc: string;
  },
): Promise<boolean> {
  const fingerprint = await createSourceEvidenceSha256({
    code: input.code,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
  });
  const existing = await db.prepare(`
    SELECT id FROM canonical_processing_issues
    WHERE tenant_id=? AND issue_type='inventory_backfill' AND fingerprint=? LIMIT 1
  `).bind(input.tenantId, fingerprint).first<{ id: number }>();
  if (existing) {
    await db.prepare(`
      UPDATE canonical_processing_issues
      SET occurrence_count=occurrence_count+1,last_seen_at_utc=?,updated_at_utc=?
      WHERE id=?
    `).bind(input.nowUtc, input.nowUtc, existing.id).run();
    return false;
  }
  const issuePublicId = await createDeterministicSourceId('invissue', input.tenantId, input.code, input.sourcePublicId);
  await db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,entity_type,
      entity_public_id,source_type,source_public_id,fingerprint,severity,status,
      summary,details_json,first_seen_at_utc,last_seen_at_utc
    ) VALUES (?,?,?,'inventory_backfill',?,'inventory_movement',?,?,?,?,
              'error','open',?,?,?,?)
  `).bind(
    input.tenantId,
    issuePublicId,
    input.runId,
    input.code,
    input.entityPublicId ?? null,
    input.sourceType,
    input.sourcePublicId,
    fingerprint,
    input.summary,
    JSON.stringify(input.details ?? {}),
    input.nowUtc,
    input.nowUtc,
  ).run();
  return true;
}

async function mapping(
  db: InventoryBackfillDatabase,
  input: {
    tenantId: string;
    runId: number;
    entityType: string;
    canonicalPublicId: string | null;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    status: 'mapped' | 'ambiguous' | 'rejected';
    evidence: string;
  },
): Promise<boolean> {
  const existing = await db.prepare(`
    SELECT id FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(input.tenantId, input.entityType, input.sourceType, input.sourcePublicId).first<{ id: number }>();
  if (existing) return false;
  await db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
      mapping_status,mapping_version,migration_run_id,evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,1,?,?)
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.status,
    input.runId,
    input.evidence,
  ).run();
  return true;
}

async function ensureItem(
  db: InventoryBackfillDatabase,
  tenantId: string,
  runId: number,
  row: SourceRow,
  counts: InventoryBackfillCounts,
): Promise<{ itemPublicId: string; baseUnitCode: string }> {
  if (row.sourceKind === 'pharmacy' && row.linkedInventoryItemId != null) {
    const linked = await db.prepare(`
      SELECT item_public_id,base_unit_code FROM canonical_inventory_items
      WHERE tenant_id=? AND legacy_inventory_item_id=? LIMIT 1
    `).bind(tenantId, row.linkedInventoryItemId).first<{ item_public_id: string; base_unit_code: string }>();
    if (linked) return { itemPublicId: linked.item_public_id, baseUnitCode: linked.base_unit_code };
  }
  const legacyColumn = row.sourceKind === 'general'
    ? 'legacy_inventory_item_id'
    : row.sourceKind === 'pharmacy'
      ? 'legacy_pharmacy_item_id'
      : 'legacy_medicine_id';
  const existing = await db.prepare(`
    SELECT item_public_id,base_unit_code FROM canonical_inventory_items
    WHERE tenant_id=? AND ${legacyColumn}=? LIMIT 1
  `).bind(tenantId, row.itemId).first<{ item_public_id: string; base_unit_code: string }>();
  if (existing) return { itemPublicId: existing.item_public_id, baseUnitCode: existing.base_unit_code };

  const sourceType = `${row.sourceType}:item`;
  const sourcePublicId = String(row.itemId);
  const itemPublicId = await createDeterministicSourceId('invitem', tenantId, sourceType, sourcePublicId);
  const evidence = await createSourceEvidenceSha256({
    sourceType,
    sourcePublicId,
    itemCode: row.itemCode,
    unitCode: normalizedUnit(row.unitCode),
    fixedAsset: row.fixedAsset === 1,
  });
  const itemKind = row.sourceKind === 'general'
    ? row.fixedAsset === 1 ? 'fixed_asset' : 'general'
    : 'medicine';
  await db.prepare(`
    INSERT INTO canonical_inventory_items (
      tenant_id,item_public_id,item_kind,legacy_inventory_item_id,
      legacy_pharmacy_item_id,legacy_medicine_id,display_name,base_unit_code,status,
      source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?, 'active',?)
  `).bind(
    tenantId,
    itemPublicId,
    itemKind,
    row.sourceKind === 'general' ? row.itemId : null,
    row.sourceKind === 'pharmacy' ? row.itemId : null,
    row.sourceKind === 'medicine' ? row.itemId : null,
    row.itemName.trim() || `${row.sourceKind} item ${row.itemId}`,
    normalizedUnit(row.unitCode),
    evidence,
  ).run();
  counts.itemsCreated += 1;
  if (await mapping(db, {
    tenantId,runId,entityType: 'inventory_item',canonicalPublicId: itemPublicId,
    sourceType,sourcePublicId,sourceTable: row.sourceTable,status: 'mapped',evidence,
  })) counts.mappingsCreated += 1;
  return { itemPublicId, baseUnitCode: normalizedUnit(row.unitCode) };
}

async function ensureLocation(
  db: InventoryBackfillDatabase,
  tenantId: string,
  runId: number,
  row: SourceRow,
  counts: InventoryBackfillCounts,
): Promise<string> {
  if (row.sourceKind === 'general' && row.locationId != null) {
    const existing = await db.prepare(`
      SELECT location_public_id FROM canonical_inventory_locations
      WHERE tenant_id=? AND legacy_inventory_store_id=? LIMIT 1
    `).bind(tenantId, row.locationId).first<{ location_public_id: string }>();
    if (existing) return existing.location_public_id;
  } else {
    const existing = await db.prepare(`
      SELECT location_public_id FROM canonical_inventory_locations
      WHERE tenant_id=? AND location_code=? LIMIT 1
    `).bind(tenantId, row.locationCode).first<{ location_public_id: string }>();
    if (existing) return existing.location_public_id;
  }
  const sourceType = row.sourceKind === 'general' ? `${row.sourceType}:location` : `${row.sourceType}:default_location`;
  const sourcePublicId = row.sourceKind === 'general' ? String(row.locationId) : 'default';
  const locationPublicId = await createDeterministicSourceId('invloc', tenantId, sourceType, sourcePublicId);
  const evidence = await createSourceEvidenceSha256({
    sourceType,
    sourcePublicId,
    locationCode: row.locationCode,
    locationType: row.locationType,
  });
  await db.prepare(`
    INSERT INTO canonical_inventory_locations (
      tenant_id,location_public_id,location_type,legacy_inventory_store_id,
      location_code,display_name,status,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,'active',?)
  `).bind(
    tenantId,
    locationPublicId,
    row.sourceKind === 'general' ? locationKind(row.locationType) : 'pharmacy',
    row.sourceKind === 'general' ? row.locationId : null,
    row.locationCode,
    row.locationName.trim() || `${row.sourceKind} stock`,
    evidence,
  ).run();
  counts.locationsCreated += 1;
  if (await mapping(db, {
    tenantId,runId,entityType: 'inventory_location',canonicalPublicId: locationPublicId,
    sourceType,sourcePublicId,sourceTable: row.sourceTable,status: 'mapped',evidence,
  })) counts.mappingsCreated += 1;
  return locationPublicId;
}

async function ensureLot(
  db: InventoryBackfillDatabase,
  tenantId: string,
  runId: number,
  row: SourceRow,
  itemPublicId: string,
  counts: InventoryBackfillCounts,
): Promise<string> {
  const legacyColumn = row.sourceKind === 'general'
    ? 'legacy_inventory_stock_id'
    : row.sourceKind === 'pharmacy'
      ? 'legacy_pharmacy_stock_id'
      : 'legacy_medicine_batch_id';
  const lotSourceId = row.lotId ?? row.itemId;
  const existing = await db.prepare(`
    SELECT lot_public_id FROM canonical_inventory_lots
    WHERE tenant_id=? AND ${legacyColumn}=? LIMIT 1
  `).bind(tenantId, lotSourceId).first<{ lot_public_id: string }>();
  if (existing) return existing.lot_public_id;
  const sourceType = `${row.sourceType}:lot`;
  const sourcePublicId = String(lotSourceId);
  const lotPublicId = await createDeterministicSourceId('invlot', tenantId, sourceType, sourcePublicId);
  const lotCode = row.lotCode?.trim() || `UNBATCHED-${lotSourceId}`;
  const evidence = await createSourceEvidenceSha256({ sourceType,sourcePublicId,lotCode,expiryDate: row.expiryDate });
  await db.prepare(`
    INSERT INTO canonical_inventory_lots (
      tenant_id,lot_public_id,item_public_id,legacy_inventory_stock_id,
      legacy_pharmacy_stock_id,legacy_medicine_batch_id,lot_code,expiry_date,status,
      source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?, 'active',?)
  `).bind(
    tenantId,
    lotPublicId,
    itemPublicId,
    row.sourceKind === 'general' ? lotSourceId : null,
    row.sourceKind === 'pharmacy' ? lotSourceId : null,
    row.sourceKind === 'medicine' ? lotSourceId : null,
    lotCode,
    row.expiryDate,
    evidence,
  ).run();
  counts.lotsCreated += 1;
  if (await mapping(db, {
    tenantId,runId,entityType: 'inventory_lot',canonicalPublicId: lotPublicId,
    sourceType,sourcePublicId,sourceTable: row.sourceTable,status: 'mapped',evidence,
  })) counts.mappingsCreated += 1;
  return lotPublicId;
}

async function ensurePolicy(
  db: InventoryBackfillDatabase,
  tenantId: string,
  itemPublicId: string,
  locationPublicId: string,
  evidence: string,
): Promise<void> {
  await db.prepare(`
    INSERT INTO canonical_inventory_stock_policies (
      tenant_id,item_public_id,location_public_id,allow_negative_stock,source_evidence_sha256
    ) VALUES (?,?,?,0,?)
    ON CONFLICT(tenant_id,item_public_id,location_public_id) DO NOTHING
  `).bind(tenantId,itemPublicId,locationPublicId,evidence).run();
}

async function processRow(
  db: InventoryBackfillDatabase,
  input: { tenantId: string; runId: number; nowUtc: string; row: SourceRow },
  counts: InventoryBackfillCounts,
): Promise<void> {
  const sourcePublicId = String(input.row.sourceId);
  const evidence = await createSourceEvidenceSha256({
    sourceType: input.row.sourceType,
    sourcePublicId,
    movementType: input.row.rawMovementType,
    itemId: input.row.itemId,
    locationId: input.row.locationId,
    lotId: input.row.lotId,
    inQuantity: input.row.inQuantity,
    outQuantity: input.row.outQuantity,
    quantity: input.row.quantity,
    referenceType: input.row.referenceType,
    referenceId: input.row.referenceId,
    referenceNo: input.row.referenceNo,
    occurredAt: input.row.occurredAt,
  });
  const existingMapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='inventory_movement'
      AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(input.tenantId,input.row.sourceType,sourcePublicId).first<MappingRow>();
  if (existingMapping) {
    if (existingMapping.evidence_sha256 !== evidence) {
      if (await issue(db, {
        tenantId: input.tenantId,runId: input.runId,code: 'INVENTORY_SOURCE_DRIFT',
        sourceType: input.row.sourceType,sourcePublicId,
        entityPublicId: existingMapping.canonical_public_id,
        summary: 'Mapped legacy inventory movement evidence changed after canonicalization.',
        details: { sourceTable: input.row.sourceTable },nowUtc: input.nowUtc,
      })) counts.issuesCreated += 1;
    }
    return;
  }

  const type = movementType(input.row);
  if (!type) {
    const unresolvedTransfer = isUnresolvedTransfer(input.row);
    if (await mapping(db, {
      tenantId: input.tenantId,runId: input.runId,entityType: 'inventory_movement',canonicalPublicId: null,
      sourceType: input.row.sourceType,sourcePublicId,sourceTable: input.row.sourceTable,status: 'ambiguous',evidence,
    })) counts.mappingsCreated += 1;
    if (await issue(db, {
      tenantId: input.tenantId,runId: input.runId,
      code: unresolvedTransfer ? 'INVENTORY_TRANSFER_PAIR_UNRESOLVED' : 'INVENTORY_MOVEMENT_TYPE_UNKNOWN',
      sourceType: input.row.sourceType,sourcePublicId,
      summary: unresolvedTransfer
        ? 'Legacy transfer or dispatch movement lacks an exact canonical counterpart and location pair.'
        : 'Legacy inventory movement type cannot be mapped to an approved canonical movement kind.',
      details: { rawMovementType: input.row.rawMovementType },nowUtc: input.nowUtc,
    })) counts.issuesCreated += 1;
    return;
  }
  const quantity = movementQuantity(input.row);
  if (!quantity) {
    if (await mapping(db, {
      tenantId: input.tenantId,runId: input.runId,entityType: 'inventory_movement',canonicalPublicId: null,
      sourceType: input.row.sourceType,sourcePublicId,sourceTable: input.row.sourceTable,status: 'rejected',evidence,
    })) counts.mappingsCreated += 1;
    if (await issue(db, {
      tenantId: input.tenantId,runId: input.runId,code: 'INVENTORY_QUANTITY_NON_INTEGRAL',
      sourceType: input.row.sourceType,sourcePublicId,
      summary: 'Legacy inventory movement quantity is zero, fractional, conflicting, or outside the safe integer range.',
      details: {},nowUtc: input.nowUtc,
    })) counts.issuesCreated += 1;
    return;
  }

  const item = await ensureItem(db,input.tenantId,input.runId,input.row,counts);
  const locationPublicId = await ensureLocation(db,input.tenantId,input.runId,input.row,counts);
  const lotPublicId = await ensureLot(db,input.tenantId,input.runId,input.row,item.itemPublicId,counts);
  await ensurePolicy(db,input.tenantId,item.itemPublicId,locationPublicId,evidence);
  const context: CanonicalContext = {
    itemPublicId: item.itemPublicId,
    locationPublicId,
    lotPublicId,
    baseUnitCode: item.baseUnitCode,
  };
  const movementPublicId = await createDeterministicSourceId('invmove',input.tenantId,input.row.sourceType,sourcePublicId);
  const before = (await db.prepare(`
    SELECT quantity_base,version FROM canonical_inventory_balances
    WHERE tenant_id=? AND item_public_id=? AND location_public_id=? AND lot_public_id=? LIMIT 1
  `).bind(input.tenantId,context.itemPublicId,context.locationPublicId,context.lotPublicId).first<BalanceRow>())
    ?? { quantity_base: 0, version: 0 };
  const movementDirection = direction(type);
  const signedQuantity = movementDirection === 'in' ? quantity : -quantity;
  const after = safeBalance(before.quantity_base + signedQuantity);
  const occurredAtUtc = legacyUtc(input.row.occurredAt,input.nowUtc);
  const businessDate = dateOnly(input.row.occurredAt,occurredAtUtc);

  const statements: InventoryBackfillPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_inventory_balances (
        tenant_id,item_public_id,location_public_id,lot_public_id,quantity_base,version,
        projection_guard,source_evidence_sha256,updated_at_utc
      ) VALUES (?,?,?,?,0,0,1,?,?)
      ON CONFLICT(tenant_id,item_public_id,location_public_id,lot_public_id) DO NOTHING
    `).bind(input.tenantId,context.itemPublicId,context.locationPublicId,context.lotPublicId,evidence,occurredAtUtc),
    db.prepare(`
      UPDATE canonical_inventory_balances
      SET quantity_base=?,version=?,projection_guard=1,source_evidence_sha256=?,updated_at_utc=?
      WHERE tenant_id=? AND item_public_id=? AND location_public_id=? AND lot_public_id=?
        AND quantity_base=? AND version=?
    `).bind(
      after,before.version+1,evidence,occurredAtUtc,input.tenantId,context.itemPublicId,
      context.locationPublicId,context.lotPublicId,before.quantity_base,before.version,
    ),
    db.prepare(`
      INSERT INTO canonical_inventory_movements (
        tenant_id,movement_public_id,item_public_id,location_public_id,lot_public_id,
        movement_type,direction,source_quantity,source_unit_code,conversion_numerator,
        conversion_denominator,quantity_base,signed_quantity_base,balance_before_base,
        balance_after_base,source_type,source_public_id,source_line_public_id,source_table,
        status,occurred_at_utc,business_date,actor_user_id,balance_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?,1,1,?,?,?,?,?,?,?,?, 'posted',?,?,?,
        CASE WHEN EXISTS(
          SELECT 1 FROM canonical_inventory_balances
          WHERE tenant_id=? AND item_public_id=? AND location_public_id=? AND lot_public_id=?
            AND quantity_base=? AND version=?
        ) THEN 1 ELSE 0 END,?)
    `).bind(
      input.tenantId,movementPublicId,context.itemPublicId,context.locationPublicId,context.lotPublicId,
      type,movementDirection,quantity,context.baseUnitCode,quantity,signedQuantity,
      before.quantity_base,after,input.row.sourceType,sourcePublicId,sourcePublicId,input.row.sourceTable,
      occurredAtUtc,businessDate,input.row.actorUserId,
      input.tenantId,context.itemPublicId,context.locationPublicId,context.lotPublicId,after,before.version+1,evidence,
    ),
    db.prepare(`
      INSERT INTO canonical_source_mappings (
        tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
        mapping_status,mapping_version,migration_run_id,evidence_sha256
      ) VALUES (?,'inventory_movement',?,?,?,?, 'mapped',1,?,?)
    `).bind(input.tenantId,movementPublicId,input.row.sourceType,sourcePublicId,input.row.sourceTable,input.runId,evidence),
  ];
  const hadBalance = await db.prepare(`
    SELECT COUNT(*) count FROM canonical_inventory_balances
    WHERE tenant_id=? AND item_public_id=? AND location_public_id=? AND lot_public_id=?
  `).bind(input.tenantId,context.itemPublicId,context.locationPublicId,context.lotPublicId).first<CountRow>();
  await db.batch(statements);
  counts.movementsCreated += 1;
  counts.mappingsCreated += 1;
  if (Number(hadBalance?.count ?? 0) === 0) counts.balancesCreated += 1;
}

async function reconcileBalances(
  db: InventoryBackfillDatabase,
  tenantId: string,
  runId: number,
  nowUtc: string,
  counts: InventoryBackfillCounts,
): Promise<void> {
  const rows = (await db.prepare(`
    SELECT b.item_public_id,b.location_public_id,b.lot_public_id,b.quantity_base,
           l.legacy_inventory_stock_id,l.legacy_pharmacy_stock_id,l.legacy_medicine_batch_id
    FROM canonical_inventory_balances b
    JOIN canonical_inventory_lots l
      ON l.tenant_id=b.tenant_id AND l.lot_public_id=b.lot_public_id
    WHERE b.tenant_id=?
  `).bind(tenantId).all<{
    item_public_id: string;location_public_id: string;lot_public_id: string;quantity_base: number;
    legacy_inventory_stock_id: number | null;legacy_pharmacy_stock_id: number | null;legacy_medicine_batch_id: number | null;
  }>()).results;
  for (const row of rows) {
    let sourceType = '';
    let sourcePublicId = '';
    let cache: number | null = null;
    if (row.legacy_inventory_stock_id != null) {
      sourceType = 'legacy_inventory_stock_cache';
      sourcePublicId = String(row.legacy_inventory_stock_id);
      cache = Number((await db.prepare(`SELECT AvailableQuantity quantity FROM InventoryStock WHERE StockId=? AND CAST(tenant_id AS TEXT)=?`).bind(row.legacy_inventory_stock_id,tenantId).first<{ quantity: number }>())?.quantity ?? 0);
    } else if (row.legacy_pharmacy_stock_id != null) {
      sourceType = 'legacy_pharmacy_stock_cache';
      sourcePublicId = String(row.legacy_pharmacy_stock_id);
      cache = Number((await db.prepare(`SELECT available_qty quantity FROM pharmacy_stock WHERE id=? AND CAST(tenant_id AS TEXT)=?`).bind(row.legacy_pharmacy_stock_id,tenantId).first<{ quantity: number }>())?.quantity ?? 0);
    } else if (row.legacy_medicine_batch_id != null) {
      sourceType = 'legacy_medicine_batch_cache';
      sourcePublicId = String(row.legacy_medicine_batch_id);
      cache = Number((await db.prepare(`SELECT quantity_available quantity FROM medicine_stock_batches WHERE id=? AND CAST(tenant_id AS TEXT)=?`).bind(row.legacy_medicine_batch_id,tenantId).first<{ quantity: number }>())?.quantity ?? 0);
    }
    if (!sourceType || cache == null) continue;
    if (!Number.isSafeInteger(cache)) {
      if (await issue(db, {
        tenantId,runId,code: 'INVENTORY_BALANCE_NON_INTEGRAL',sourceType,sourcePublicId,
        entityPublicId: row.lot_public_id,
        summary: 'Legacy inventory balance cache cannot be represented in the canonical base unit without an approved conversion.',
        details: {},nowUtc,
      })) counts.issuesCreated += 1;
      continue;
    }
    if (cache !== row.quantity_base) {
      if (await issue(db, {
        tenantId,runId,code: 'INVENTORY_BALANCE_VARIANCE',sourceType,sourcePublicId,
        entityPublicId: row.lot_public_id,
        summary: 'Legacy inventory balance cache differs from the sum of canonical immutable movements.',
        details: { canonicalQuantityBase: row.quantity_base,legacyCachedQuantity: cache },nowUtc,
      })) counts.issuesCreated += 1;
    }
  }
}

export async function backfillInventory(
  db: InventoryBackfillDatabase,
  options: InventoryBackfillOptions,
): Promise<InventoryBackfillResult> {
  const tenantId = exact(options.tenantId,'tenantId');
  const runPublicId = exact(options.runPublicId,'runPublicId');
  const nowUtc = utc(options.nowUtc);
  const maxSourceRecords = limit(options.maxSourceRecords);
  const counts = emptyCounts();

  let run = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId,runPublicId).first<RunRow>();
  if (run?.status === 'succeeded') return { completed: true, counts };
  if (!run) {
    await db.prepare(`
      INSERT INTO canonical_migration_runs (
        tenant_id,run_public_id,migration_name,migration_kind,status,started_at_utc
      ) VALUES (?,?,?,'backfill','running',?)
    `).bind(tenantId,runPublicId,MIGRATION,nowUtc).run();
    run = await db.prepare(`
      SELECT id,status FROM canonical_migration_runs
      WHERE tenant_id=? AND run_public_id=? LIMIT 1
    `).bind(tenantId,runPublicId).first<RunRow>();
  } else if (run.status !== 'running') {
    await db.prepare(`
      UPDATE canonical_migration_runs
      SET status='running',completed_at_utc=NULL,error_code=NULL,error_summary=NULL,updated_at_utc=?
      WHERE id=?
    `).bind(nowUtc,run.id).run();
  }
  if (!run) throw new Error('Failed to create canonical inventory migration run');

  let checkpoint = await db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type='inventory_movement'
      AND source_type=? AND partition_key='' LIMIT 1
  `).bind(tenantId,run.id,CHECKPOINT_SOURCE).first<CheckpointRow>();
  if (!checkpoint) {
    const checkpointPublicId = await createDeterministicSourceId('invcheck',tenantId,CHECKPOINT_SOURCE,runPublicId);
    await db.prepare(`
      INSERT INTO canonical_backfill_checkpoints (
        tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
        partition_key,status,started_at_utc
      ) VALUES (?,?,?,'inventory_movement',?,'','running',?)
    `).bind(tenantId,checkpointPublicId,run.id,CHECKPOINT_SOURCE,nowUtc).run();
    checkpoint = await db.prepare(`
      SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
      WHERE tenant_id=? AND migration_run_id=? AND entity_type='inventory_movement'
        AND source_type=? AND partition_key='' LIMIT 1
    `).bind(tenantId,run.id,CHECKPOINT_SOURCE).first<CheckpointRow>();
  } else if (checkpoint.status !== 'running') {
    await db.prepare(`
      UPDATE canonical_backfill_checkpoints
      SET status='running',completed_at_utc=NULL,last_error_code=NULL,last_error_summary=NULL,updated_at_utc=?
      WHERE id=?
    `).bind(nowUtc,checkpoint.id).run();
  }
  if (!checkpoint) throw new Error('Failed to create canonical inventory checkpoint');

  const allRows = await sourceRows(db,tenantId);
  const pending = allRows.filter((row) => checkpoint?.cursor_value == null || row.sortKey > checkpoint.cursor_value);
  const selected = pending.slice(0,maxSourceRecords);
  for (const row of selected) {
    const movementsBefore = counts.movementsCreated;
    const mappingsBefore = counts.mappingsCreated;
    const issuesBefore = counts.issuesCreated;
    counts.scanned += 1;
    await processRow(db,{ tenantId,runId: run.id,nowUtc,row },counts);
    await db.prepare(`
      UPDATE canonical_backfill_checkpoints
      SET cursor_value=?,scanned_count=scanned_count+1,created_count=created_count+?,
          mapped_count=mapped_count+?,exception_count=exception_count+?,updated_at_utc=?
      WHERE id=?
    `).bind(
      row.sortKey,
      counts.movementsCreated - movementsBefore,
      counts.mappingsCreated - mappingsBefore,
      counts.issuesCreated - issuesBefore,
      nowUtc,
      checkpoint.id,
    ).run();
  }

  const completed = selected.length === pending.length;
  if (!completed) {
    await db.prepare(`
      UPDATE canonical_backfill_checkpoints SET status='paused',updated_at_utc=? WHERE id=?
    `).bind(nowUtc,checkpoint.id).run();
    return { completed: false, counts };
  }

  await reconcileBalances(db,tenantId,run.id,nowUtc,counts);
  await db.batch([
    db.prepare(`
      UPDATE canonical_backfill_checkpoints
      SET status='completed',completed_at_utc=?,updated_at_utc=? WHERE id=?
    `).bind(nowUtc,nowUtc,checkpoint.id),
    db.prepare(`
      UPDATE canonical_migration_runs
      SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=?
      WHERE id=?
    `).bind(nowUtc,JSON.stringify(counts),nowUtc,run.id),
  ]);
  return { completed: true, counts };
}
