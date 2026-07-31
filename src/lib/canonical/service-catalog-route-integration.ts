import type {
  CanonicalBatchDatabase,
  CanonicalCommandExecutionOptions,
  CanonicalCommandResult,
} from './command-batch';
import {
  retireCanonicalServicePrice,
  setCanonicalServicePrice,
  upsertCanonicalServiceCatalogItem,
  type CanonicalServiceCatalogItemResult,
  type CanonicalServiceItemKind,
  type CanonicalServicePriceDefinitionInput,
  type CanonicalServicePriceResult,
} from './contracts/manage-service-catalog';
import { toMinorUnits, type DecimalAmount } from './money';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';

const SERVICE_SOURCE_TYPE = 'billing_service_item';
const SERVICE_SOURCE_TABLE = 'billing_service_items';
const PRICE_SOURCE_TYPE = 'billing_price_category_map';
const PRICE_SOURCE_TABLE = 'billing_item_price_category_maps';
const CURRENCY_CODE = 'BDT';

export interface BillingServiceCatalogSnapshot {
  serviceItemId: number;
  itemName: string;
  itemCode: string | null;
  departmentCode: string | null;
  price: DecimalAmount;
  isActive: boolean;
}

export interface BillingServiceCatalogMutationInput {
  tenantId: string;
  canonicalSourceKey: string;
  snapshot: BillingServiceCatalogSnapshot;
  defaultPriceCategoryId?: number | null;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
}

export interface BillingServiceCategoryPriceMutationInput {
  tenantId: string;
  serviceItemId: number;
  priceCategoryId: number;
  price: DecimalAmount;
  isActive: boolean;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
}

type CurrentCatalogRow = {
  service_public_id: string;
  item_kind: CanonicalServiceItemKind;
  canonical_code: string | null;
  display_name: string;
  unit_code: string;
  status: 'active' | 'inactive' | 'retired';
  source_evidence_sha256: string;
};

type CurrentPriceRow = {
  price_public_id: string;
  amount_minor: number;
  currency_code: string;
  valid_from_utc: string;
  source_evidence_sha256: string;
};

type LegacyServiceRow = {
  id: number;
  item_name: string;
  item_code: string | null;
  price: number | string;
  is_active: number;
  canonical_source_key: string | null;
  department_code: string | null;
};

function exact(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function amountMinor(value: DecimalAmount): number {
  const minor = Number(toMinorUnits(value));
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new RangeError('service price must resolve to a non-negative safe integer in minor units');
  }
  return minor;
}

function laterUtc(current: string, requested: string): string {
  if (requested > current) return requested;
  return new Date(new Date(current).getTime() + 1).toISOString();
}

export function billingServiceCanonicalSourceKey(serviceItemId: number): string {
  return `billing-service:${positiveInteger(serviceItemId, 'serviceItemId')}`;
}

export function billingPriceMapCanonicalSourceKey(serviceItemId: number, priceCategoryId: number): string {
  return `billing-price-map:${positiveInteger(serviceItemId, 'serviceItemId')}:${positiveInteger(priceCategoryId, 'priceCategoryId')}`;
}

export function serviceItemKindFromDepartmentCode(code: string | null | undefined): CanonicalServiceItemKind {
  const normalized = code?.trim().toUpperCase() ?? '';
  if (normalized === 'LAB') return 'laboratory';
  if (normalized === 'RAD') return 'radiology';
  if (normalized === 'BED' || normalized === 'IPD') return 'bed';
  if (normalized === 'CONSULT' || normalized === 'OPD') return 'consultation';
  if (normalized === 'PHARMACY' || normalized === 'MEDICINE') return 'product';
  if (normalized === 'OT' || normalized === 'PROCEDURE' || normalized === 'DELIVERY') return 'procedure';
  return 'other';
}

async function servicePublicId(
  db: CanonicalBatchDatabase,
  tenantId: string,
  sourcePublicId: string,
): Promise<string> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='service_catalog_item'
      AND source_type=? AND source_public_id=? AND mapping_status='mapped'
    LIMIT 1
  `).bind(tenantId, SERVICE_SOURCE_TYPE, sourcePublicId).first<{ canonical_public_id: string | null }>();
  if (mapping?.canonical_public_id) return exact(mapping.canonical_public_id, 'mapped servicePublicId');
  return createDeterministicSourceId('svc', tenantId, SERVICE_SOURCE_TYPE, sourcePublicId);
}

async function currentCatalog(
  db: CanonicalBatchDatabase,
  tenantId: string,
  publicId: string,
): Promise<CurrentCatalogRow | null> {
  return db.prepare(`
    SELECT service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
    FROM canonical_service_catalog_items
    WHERE tenant_id=? AND service_public_id=?
    LIMIT 1
  `).bind(tenantId, publicId).first<CurrentCatalogRow>();
}

async function currentPrice(
  db: CanonicalBatchDatabase,
  tenantId: string,
  publicId: string,
  contextType: 'base' | 'price_category',
  contextKey: string,
): Promise<CurrentPriceRow | null> {
  return db.prepare(`
    SELECT price_public_id,amount_minor,currency_code,valid_from_utc,source_evidence_sha256
    FROM canonical_service_prices
    WHERE tenant_id=? AND service_public_id=?
      AND price_context_type=? AND price_context_key=? AND status='active'
    ORDER BY valid_from_utc DESC, id DESC
    LIMIT 1
  `).bind(tenantId, publicId, contextType, contextKey).first<CurrentPriceRow>();
}

async function priceDefinition(input: {
  db: CanonicalBatchDatabase;
  tenantId: string;
  servicePublicId: string;
  sourceKey: string;
  contextType: 'base' | 'price_category';
  contextKey: string;
  price: DecimalAmount;
  occurredAtUtc: string;
}): Promise<CanonicalServicePriceDefinitionInput | null> {
  const minor = amountMinor(input.price);
  const current = await currentPrice(
    input.db,
    input.tenantId,
    input.servicePublicId,
    input.contextType,
    input.contextKey,
  );
  if (current && current.amount_minor === minor && current.currency_code === CURRENCY_CODE) return null;
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    tenantId: input.tenantId,
    servicePublicId: input.servicePublicId,
    sourceKey: input.sourceKey,
    contextType: input.contextType,
    contextKey: input.contextKey,
    amountMinor: minor,
    currencyCode: CURRENCY_CODE,
  });
  const sourcePublicId = `${input.sourceKey}:${sourceEvidenceSha256.slice(0, 24)}`;
  const validFromUtc = current
    ? laterUtc(current.valid_from_utc, input.occurredAtUtc)
    : input.occurredAtUtc;
  return {
    pricePublicId: await createDeterministicSourceId(
      'svcprice',
      input.tenantId,
      input.contextType,
      `${input.servicePublicId}:${input.contextKey || 'base'}:${sourceEvidenceSha256}`,
    ),
    priceContextType: input.contextType,
    priceContextKey: input.contextKey,
    amountMinor: minor,
    currencyCode: CURRENCY_CODE,
    validFromUtc,
    sourceType: input.contextType === 'base' ? 'billing_service_base_price' : PRICE_SOURCE_TYPE,
    sourcePublicId,
    sourceTable: input.contextType === 'base' ? SERVICE_SOURCE_TABLE : PRICE_SOURCE_TABLE,
    sourceEvidenceSha256,
    replacePricePublicId: current?.price_public_id ?? null,
    expectedReplacedEvidenceSha256: current?.source_evidence_sha256 ?? null,
  };
}

async function catalogMutationInput(
  db: CanonicalBatchDatabase,
  input: BillingServiceCatalogMutationInput,
): Promise<Parameters<typeof upsertCanonicalServiceCatalogItem>[1]> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourcePublicId = exact(input.canonicalSourceKey, 'canonicalSourceKey');
  const publicId = await servicePublicId(db, tenantId, sourcePublicId);
  const current = await currentCatalog(db, tenantId, publicId);
  const itemKind = serviceItemKindFromDepartmentCode(input.snapshot.departmentCode);
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    tenantId,
    sourcePublicId,
    serviceItemId: positiveInteger(input.snapshot.serviceItemId, 'serviceItemId'),
    itemName: exact(input.snapshot.itemName, 'itemName'),
    itemCode: input.snapshot.itemCode?.trim() || null,
    itemKind,
    priceMinor: amountMinor(input.snapshot.price),
    status: input.snapshot.isActive ? 'active' : 'inactive',
  });
  const prices: CanonicalServicePriceDefinitionInput[] = [];
  if (input.snapshot.isActive) {
    const base = await priceDefinition({
      db,
      tenantId,
      servicePublicId: publicId,
      sourceKey: `${sourcePublicId}:base`,
      contextType: 'base',
      contextKey: '',
      price: input.snapshot.price,
      occurredAtUtc: input.occurredAtUtc,
    });
    if (base) prices.push(base);
    if (input.defaultPriceCategoryId != null) {
      const categoryId = positiveInteger(input.defaultPriceCategoryId, 'defaultPriceCategoryId');
      const category = await priceDefinition({
        db,
        tenantId,
        servicePublicId: publicId,
        sourceKey: billingPriceMapCanonicalSourceKey(input.snapshot.serviceItemId, categoryId),
        contextType: 'price_category',
        contextKey: `price-category:${categoryId}`,
        price: input.snapshot.price,
        occurredAtUtc: input.occurredAtUtc,
      });
      if (category) prices.push(category);
    }
  }
  return {
    tenantId,
    servicePublicId: publicId,
    itemKind,
    canonicalCode: input.snapshot.itemCode?.trim() || null,
    displayName: exact(input.snapshot.itemName, 'itemName'),
    unitCode: 'service',
    status: input.snapshot.isActive ? 'active' : 'inactive',
    expectedSourceEvidenceSha256: current?.source_evidence_sha256 ?? null,
    sourceType: SERVICE_SOURCE_TYPE,
    sourcePublicId,
    sourceTable: SERVICE_SOURCE_TABLE,
    sourceEvidenceSha256,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    prices,
  };
}

export async function applyBillingServiceCatalogMutation(
  db: CanonicalBatchDatabase,
  input: BillingServiceCatalogMutationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalServiceCatalogItemResult>> {
  const identityStatement = db.prepare(`
    UPDATE billing_service_items
    SET canonical_source_key=COALESCE(canonical_source_key, ?)
    WHERE tenant_id=? AND id=?
  `).bind(
    input.canonicalSourceKey,
    input.tenantId,
    input.snapshot.serviceItemId,
  );
  return upsertCanonicalServiceCatalogItem(db, await catalogMutationInput(db, input), {
    authoritativeStatements: [identityStatement, ...(execution.authoritativeStatements ?? [])],
  });
}

async function loadLegacyService(
  db: CanonicalBatchDatabase,
  tenantId: string,
  serviceItemId: number,
): Promise<LegacyServiceRow> {
  const row = await db.prepare(`
    SELECT si.id,si.item_name,si.item_code,si.price,COALESCE(si.is_active,1) AS is_active,
           si.canonical_source_key,sd.department_code
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON sd.id=si.service_department_id AND sd.tenant_id IN (si.tenant_id,'0')
    WHERE si.tenant_id=? AND si.id=?
    LIMIT 1
  `).bind(tenantId, serviceItemId).first<LegacyServiceRow>();
  if (!row) throw new Error('billing service item does not exist in the tenant');
  return row;
}

async function catalogTouchForPriceMutation(
  db: CanonicalBatchDatabase,
  input: BillingServiceCategoryPriceMutationInput,
  legacy: LegacyServiceRow,
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<CanonicalServiceCatalogItemResult>> {
  return applyBillingServiceCatalogMutation(db, {
    tenantId: input.tenantId,
    canonicalSourceKey: legacy.canonical_source_key || billingServiceCanonicalSourceKey(input.serviceItemId),
    snapshot: {
      serviceItemId: input.serviceItemId,
      itemName: legacy.item_name,
      itemCode: legacy.item_code,
      departmentCode: legacy.department_code,
      price: legacy.price,
      isActive: Number(legacy.is_active) === 1,
    },
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    idempotencyKey: input.idempotencyKey,
  }, execution);
}

export async function applyBillingServiceCategoryPriceMutation(
  db: CanonicalBatchDatabase,
  input: BillingServiceCategoryPriceMutationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalServiceCatalogItemResult | CanonicalServicePriceResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const serviceItemId = positiveInteger(input.serviceItemId, 'serviceItemId');
  const priceCategoryId = positiveInteger(input.priceCategoryId, 'priceCategoryId');
  const legacy = await loadLegacyService(db, tenantId, serviceItemId);
  const sourceKey = legacy.canonical_source_key || billingServiceCanonicalSourceKey(serviceItemId);
  const priceSourceKey = billingPriceMapCanonicalSourceKey(serviceItemId, priceCategoryId);
  const identityStatements = [
    db.prepare(`
      UPDATE billing_service_items
      SET canonical_source_key=COALESCE(canonical_source_key, ?)
      WHERE tenant_id=? AND id=?
    `).bind(sourceKey, tenantId, serviceItemId),
    db.prepare(`
      UPDATE billing_item_price_category_maps
      SET canonical_source_key=COALESCE(canonical_source_key, ?)
      WHERE tenant_id=? AND service_item_id=? AND price_category_id=?
    `).bind(priceSourceKey, tenantId, serviceItemId, priceCategoryId),
  ];
  const routeExecution: CanonicalCommandExecutionOptions = {
    authoritativeStatements: [
      ...identityStatements,
      ...(execution.authoritativeStatements ?? []),
    ],
  };
  const publicId = await servicePublicId(db, tenantId, sourceKey);
  const catalog = await currentCatalog(db, tenantId, publicId);
  const contextKey = `price-category:${priceCategoryId}`;
  const current = catalog
    ? await currentPrice(db, tenantId, publicId, 'price_category', contextKey)
    : null;

  if (!input.isActive) {
    if (!current) return catalogTouchForPriceMutation(db, input, legacy, routeExecution);
    const retirementEvidence = await createSourceEvidenceSha256({
      tenantId,
      servicePublicId: publicId,
      pricePublicId: current.price_public_id,
      priceCategoryId,
      reasonCode: 'legacy_price_mapping_deactivated',
      retiredAtUtc: input.occurredAtUtc,
    });
    return retireCanonicalServicePrice(db, {
      tenantId,
      servicePublicId: publicId,
      pricePublicId: current.price_public_id,
      expectedSourceEvidenceSha256: current.source_evidence_sha256,
      retiredAtUtc: laterUtc(current.valid_from_utc, input.occurredAtUtc),
      reasonCode: 'legacy_price_mapping_deactivated',
      sourceEvidenceSha256: retirementEvidence,
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
    }, routeExecution);
  }

  const definition = await priceDefinition({
    db,
    tenantId,
    servicePublicId: publicId,
    sourceKey: billingPriceMapCanonicalSourceKey(serviceItemId, priceCategoryId),
    contextType: 'price_category',
    contextKey,
    price: input.price,
    occurredAtUtc: input.occurredAtUtc,
  });
  if (!catalog || !definition) {
    const catalogInput = await catalogMutationInput(db, {
      tenantId,
      canonicalSourceKey: sourceKey,
      snapshot: {
        serviceItemId,
        itemName: legacy.item_name,
        itemCode: legacy.item_code,
        departmentCode: legacy.department_code,
        price: legacy.price,
        isActive: Number(legacy.is_active) === 1,
      },
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      idempotencyKey: input.idempotencyKey,
    });
    if (definition) catalogInput.prices = [definition];
    return upsertCanonicalServiceCatalogItem(db, catalogInput, routeExecution);
  }
  return setCanonicalServicePrice(db, {
    ...definition,
    tenantId,
    servicePublicId: publicId,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    idempotencyKey: exact(input.idempotencyKey, 'idempotencyKey'),
  }, routeExecution);
}
