import type {
  PharmacyCanonicalInventoryAuthority,
  PharmacySaleContext,
  PharmacySaleItemContext,
} from './pharmacy-sale-types';

interface PharmacyAuthorityStatement {
  bind(...values: unknown[]): PharmacyAuthorityStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export interface PharmacyAuthorityDatabase {
  prepare(sql: string): PharmacyAuthorityStatement;
}

interface PharmacyAuthorityRow {
  item_public_id: string;
  service_public_id: string;
  lot_public_id: string;
  location_public_id: string;
  item_name: string;
  source_unit_code: string;
  base_unit_code: string;
  numerator: number | null;
  denominator: number | null;
  quantity_base: number;
  version: number;
  lot_expiry_date: string | null;
}

function exact(value: string | null | undefined, label: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`${label} is unavailable`);
  return normalized;
}

function positive(value: number | null | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return Number(value);
}

function nonNegative(value: number | null | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return Number(value);
}

async function resolveAuthority(
  db: PharmacyAuthorityDatabase,
  tenantId: string,
  businessDate: string,
  item: PharmacySaleItemContext,
): Promise<{ authority: PharmacyCanonicalInventoryAuthority; sourceUnitCode: string; itemName: string }> {
  const row = await db.prepare(`
    SELECT
      ci.item_public_id,
      ci.service_public_id,
      cl.lot_public_id,
      loc.location_public_id,
      COALESCE(NULLIF(TRIM(pi.name), ''), svc.display_name) AS item_name,
      COALESCE(NULLIF(TRIM(u.name), ''), ci.base_unit_code) AS source_unit_code,
      ci.base_unit_code,
      CASE
        WHEN COALESCE(NULLIF(TRIM(u.name), ''), ci.base_unit_code)=ci.base_unit_code THEN 1
        ELSE conv.numerator
      END AS numerator,
      CASE
        WHEN COALESCE(NULLIF(TRIM(u.name), ''), ci.base_unit_code)=ci.base_unit_code THEN 1
        ELSE conv.denominator
      END AS denominator,
      bal.quantity_base,
      bal.version,
      cl.expiry_date AS lot_expiry_date
    FROM pharmacy_items pi
    LEFT JOIN pharmacy_uom u
      ON u.id=pi.uom_id AND CAST(u.tenant_id AS TEXT)=CAST(pi.tenant_id AS TEXT)
    JOIN canonical_inventory_items ci
      ON ci.tenant_id=CAST(pi.tenant_id AS TEXT)
     AND ci.legacy_pharmacy_item_id=pi.id
     AND ci.status='active'
     AND ci.service_public_id IS NOT NULL
    JOIN canonical_service_catalog_items svc
      ON svc.tenant_id=ci.tenant_id
     AND svc.service_public_id=ci.service_public_id
     AND svc.status='active'
    JOIN canonical_inventory_lots cl
      ON cl.tenant_id=ci.tenant_id
     AND cl.item_public_id=ci.item_public_id
     AND cl.legacy_pharmacy_stock_id=?
     AND cl.status='active'
    JOIN canonical_inventory_locations loc
      ON loc.tenant_id=ci.tenant_id
     AND loc.location_code='PHARMACY-RICH'
     AND loc.status='active'
    JOIN canonical_inventory_stock_policies policy
      ON policy.tenant_id=ci.tenant_id
     AND policy.item_public_id=ci.item_public_id
     AND policy.location_public_id=loc.location_public_id
    JOIN canonical_inventory_balances bal
      ON bal.tenant_id=ci.tenant_id
     AND bal.item_public_id=ci.item_public_id
     AND bal.location_public_id=loc.location_public_id
     AND bal.lot_public_id=cl.lot_public_id
    LEFT JOIN canonical_inventory_unit_conversions conv
      ON conv.tenant_id=ci.tenant_id
     AND conv.item_public_id=ci.item_public_id
     AND conv.source_unit_code=COALESCE(NULLIF(TRIM(u.name), ''), ci.base_unit_code)
     AND conv.status='active'
    WHERE CAST(pi.tenant_id AS TEXT)=?
      AND pi.id=?
      AND COALESCE(pi.is_active,1)=1
      AND (cl.expiry_date IS NULL OR cl.expiry_date>=?)
    LIMIT 1
  `).bind(
    item.stockId,
    tenantId,
    item.pharmacyItemId,
    businessDate,
  ).first<PharmacyAuthorityRow>();
  if (!row) {
    throw new Error(`Canonical pharmacy inventory authority is unavailable for item ${item.pharmacyItemId} stock ${item.stockId}`);
  }
  const sourceUnitCode = exact(row.source_unit_code, 'Canonical pharmacy source unit');
  const baseUnitCode = exact(row.base_unit_code, 'Canonical pharmacy base unit');
  const numerator = positive(row.numerator, 'Canonical pharmacy conversion numerator');
  const denominator = positive(row.denominator, 'Canonical pharmacy conversion denominator');
  if (row.lot_expiry_date && row.lot_expiry_date < businessDate) {
    throw new Error(`Canonical pharmacy lot ${item.stockId} is expired`);
  }
  return {
    itemName: exact(row.item_name, 'Canonical pharmacy item name'),
    sourceUnitCode,
    authority: {
      itemPublicId: exact(row.item_public_id, 'Canonical pharmacy item'),
      servicePublicId: exact(row.service_public_id, 'Canonical pharmacy service'),
      lotPublicId: exact(row.lot_public_id, 'Canonical pharmacy lot'),
      locationPublicId: exact(row.location_public_id, 'Canonical pharmacy location'),
      baseUnitCode,
      conversionNumerator: numerator,
      conversionDenominator: denominator,
      balanceBeforeBase: nonNegative(row.quantity_base, 'Canonical pharmacy balance'),
      balanceVersion: nonNegative(row.version, 'Canonical pharmacy balance version'),
    },
  };
}

export async function hydratePharmacySaleCanonicalAuthority(
  db: PharmacyAuthorityDatabase,
  context: PharmacySaleContext,
): Promise<PharmacySaleContext> {
  const items: PharmacySaleItemContext[] = [];
  for (const item of context.items) {
    if (item.canonical && item.sourceUnitCode) {
      items.push(item);
      continue;
    }
    const resolved = await resolveAuthority(db, context.tenantId, context.businessDate, item);
    items.push({
      ...item,
      itemName: resolved.itemName,
      sourceUnitCode: resolved.sourceUnitCode,
      canonical: resolved.authority,
    });
  }
  return { ...context, items };
}
