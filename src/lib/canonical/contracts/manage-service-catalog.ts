import {
  prepareCanonicalBatch,
  readCanonicalCommandReplay,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
  type PreparedCanonicalBatch,
} from '../command-batch';
import { createDeterministicSourceId } from '../source-mapping';
import { toUtcIso } from '../time';

export type CanonicalServiceItemKind =
  | 'laboratory'
  | 'radiology'
  | 'consultation'
  | 'bed'
  | 'procedure'
  | 'product'
  | 'other';
export type CanonicalServiceStatus = 'active' | 'inactive' | 'retired';
export type CanonicalServicePriceContextType =
  | 'base'
  | 'price_category'
  | 'appointment_type'
  | 'bed_rate'
  | 'sale';
export type CanonicalServicePriceStatus = 'active' | 'inactive' | 'retired';

type EditableServiceStatus = Exclude<CanonicalServiceStatus, 'retired'>;
type EditablePriceStatus = Exclude<CanonicalServicePriceStatus, 'retired'>;

export interface CanonicalServicePriceDefinitionInput {
  pricePublicId: string;
  priceContextType: CanonicalServicePriceContextType;
  priceContextKey?: string;
  amountMinor: number;
  currencyCode: string;
  validFromUtc: string;
  validToUtc?: string | null;
  status?: EditablePriceStatus;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  replacePricePublicId?: string | null;
  expectedReplacedEvidenceSha256?: string | null;
}

export interface UpsertCanonicalServiceCatalogItemInput {
  tenantId: string;
  servicePublicId?: string;
  itemKind: CanonicalServiceItemKind;
  canonicalCode?: string | null;
  displayName: string;
  unitCode: string;
  status?: EditableServiceStatus;
  expectedSourceEvidenceSha256?: string | null;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
  outboxEventPublicId?: string;
  prices?: CanonicalServicePriceDefinitionInput[];
}

export interface SetCanonicalServicePriceInput extends CanonicalServicePriceDefinitionInput {
  tenantId: string;
  servicePublicId: string;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
  outboxEventPublicId?: string;
}

export interface RetireCanonicalServicePriceInput {
  tenantId: string;
  servicePublicId: string;
  pricePublicId: string;
  expectedSourceEvidenceSha256: string;
  retiredAtUtc: string;
  reasonCode: string;
  sourceEvidenceSha256: string;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
  outboxEventPublicId?: string;
}

export interface CanonicalServiceCatalogItemResult {
  servicePublicId: string;
  status: CanonicalServiceStatus;
  pricePublicIds: string[];
}

export interface CanonicalServicePriceResult {
  servicePublicId: string;
  pricePublicId: string;
  status: CanonicalServicePriceStatus;
}

type CurrentCatalogRow = {
  service_public_id: string;
  item_kind: CanonicalServiceItemKind;
  canonical_code: string | null;
  display_name: string;
  unit_code: string;
  status: CanonicalServiceStatus;
  source_evidence_sha256: string;
};

type CurrentPriceRow = {
  price_public_id: string;
  service_public_id: string;
  price_context_type: CanonicalServicePriceContextType;
  price_context_key: string;
  amount_minor: number;
  currency_code: string;
  valid_from_utc: string;
  valid_to_utc: string | null;
  status: CanonicalServicePriceStatus;
  source_evidence_sha256: string;
};

type MappingRow = {
  canonical_public_id: string | null;
  mapping_status: string;
};

type ResolvedPrice = Required<Omit<CanonicalServicePriceDefinitionInput,
  'priceContextKey' | 'validToUtc' | 'status' | 'replacePricePublicId' | 'expectedReplacedEvidenceSha256'
>> & {
  priceContextKey: string;
  validToUtc: string | null;
  status: EditablePriceStatus;
  replacePricePublicId: string | null;
  expectedReplacedEvidenceSha256: string | null;
};

type ResolvedCatalog = Required<Omit<UpsertCanonicalServiceCatalogItemInput,
  'servicePublicId' | 'canonicalCode' | 'status' | 'expectedSourceEvidenceSha256'
  | 'outboxEventPublicId' | 'prices'
>> & {
  servicePublicId: string;
  canonicalCode: string | null;
  status: EditableServiceStatus;
  expectedSourceEvidenceSha256: string | null;
  outboxEventPublicId: string;
  prices: ResolvedPrice[];
};

type ResolvedSetPrice = ResolvedPrice & {
  tenantId: string;
  servicePublicId: string;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
};

type ResolvedRetirePrice = Omit<RetireCanonicalServicePriceInput, 'outboxEventPublicId'> & {
  outboxEventPublicId: string;
};

const UPSERT_COMMAND = 'canonical.service-catalog.upsert';
const SET_PRICE_COMMAND = 'canonical.service-price.set';
const RETIRE_PRICE_COMMAND = 'canonical.service-price.retire';
const ITEM_KINDS = new Set<CanonicalServiceItemKind>([
  'laboratory', 'radiology', 'consultation', 'bed', 'procedure', 'product', 'other',
]);
const ITEM_STATUSES = new Set<EditableServiceStatus>(['active', 'inactive']);
const PRICE_CONTEXT_TYPES = new Set<CanonicalServicePriceContextType>([
  'base', 'price_category', 'appointment_type', 'bed_rate', 'sale',
]);
const PRICE_STATUSES = new Set<EditablePriceStatus>(['active', 'inactive']);

function exact(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  if (value.trim() !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  return value == null ? null : exact(value, label);
}

function sha256(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new RangeError(`${label} must be a 64-character SHA-256 hex digest`);
  return value.toLowerCase();
}

function optionalSha256(value: string | null | undefined, label: string): string | null {
  return value == null ? null : sha256(value, label);
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function date(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${label} must be a valid calendar date`);
  }
  return value;
}

function nonNegativeMinor(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer in minor units`);
  }
  return value;
}

function currency(value: string): string {
  const normalized = exact(value, 'currencyCode');
  if (!/^[A-Z]{3}$/.test(normalized)) throw new RangeError('currencyCode must be three uppercase letters');
  return normalized;
}

async function outboxId(
  prefix: string,
  tenantId: string,
  idempotencyKey: string,
  supplied?: string,
): Promise<string> {
  if (supplied != null) return exact(supplied, 'outboxEventPublicId');
  return createDeterministicSourceId(prefix, tenantId, 'service_catalog_event', idempotencyKey);
}

async function serviceId(input: UpsertCanonicalServiceCatalogItemInput): Promise<string> {
  if (input.servicePublicId != null) return exact(input.servicePublicId, 'servicePublicId');
  return createDeterministicSourceId(
    'svc',
    exact(input.tenantId, 'tenantId'),
    exact(input.sourceType, 'sourceType'),
    exact(input.sourcePublicId, 'sourcePublicId'),
  );
}

function resolvePrice(raw: CanonicalServicePriceDefinitionInput): ResolvedPrice {
  if (!PRICE_CONTEXT_TYPES.has(raw.priceContextType)) throw new TypeError('priceContextType is not supported');
  const priceContextKey = raw.priceContextKey?.trim() ?? '';
  if (raw.priceContextType !== 'base' && !priceContextKey) {
    throw new TypeError('non-base price requires priceContextKey');
  }
  if (raw.priceContextType === 'base' && priceContextKey) {
    throw new TypeError('base price forbids priceContextKey');
  }
  const validFromUtc = utc(raw.validFromUtc, 'validFromUtc');
  const validToUtc = raw.validToUtc == null ? null : utc(raw.validToUtc, 'validToUtc');
  if (validToUtc != null && validToUtc <= validFromUtc) {
    throw new RangeError('validToUtc must be later than validFromUtc');
  }
  const status = raw.status ?? 'active';
  if (!PRICE_STATUSES.has(status)) throw new TypeError('price status must be active or inactive');
  const replacePricePublicId = optionalExact(raw.replacePricePublicId, 'replacePricePublicId');
  const expectedReplacedEvidenceSha256 = optionalSha256(
    raw.expectedReplacedEvidenceSha256,
    'expectedReplacedEvidenceSha256',
  );
  if ((replacePricePublicId == null) !== (expectedReplacedEvidenceSha256 == null)) {
    throw new TypeError('replacement requires both replacePricePublicId and expectedReplacedEvidenceSha256');
  }
  return {
    pricePublicId: exact(raw.pricePublicId, 'pricePublicId'),
    priceContextType: raw.priceContextType,
    priceContextKey,
    amountMinor: nonNegativeMinor(raw.amountMinor, 'amountMinor'),
    currencyCode: currency(raw.currencyCode),
    validFromUtc,
    validToUtc,
    status,
    sourceType: exact(raw.sourceType, 'price sourceType'),
    sourcePublicId: exact(raw.sourcePublicId, 'price sourcePublicId'),
    sourceTable: exact(raw.sourceTable, 'price sourceTable'),
    sourceEvidenceSha256: sha256(raw.sourceEvidenceSha256, 'price sourceEvidenceSha256'),
    replacePricePublicId,
    expectedReplacedEvidenceSha256,
  };
}

async function resolveCatalog(raw: UpsertCanonicalServiceCatalogItemInput): Promise<ResolvedCatalog> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  if (!ITEM_KINDS.has(raw.itemKind)) throw new TypeError('itemKind is not supported');
  const status = raw.status ?? 'active';
  if (!ITEM_STATUSES.has(status)) throw new TypeError('catalog status must be active or inactive');
  const prices = (raw.prices ?? []).map(resolvePrice);
  const pricePublicIds = new Set<string>();
  const contexts = new Set<string>();
  for (const price of prices) {
    if (pricePublicIds.has(price.pricePublicId)) throw new Error(`duplicate pricePublicId: ${price.pricePublicId}`);
    pricePublicIds.add(price.pricePublicId);
    const context = `${price.priceContextType}\u0000${price.priceContextKey}`;
    if (contexts.has(context)) throw new Error(`duplicate price context in one service command: ${price.priceContextType}`);
    contexts.add(context);
  }
  return {
    tenantId,
    servicePublicId: await serviceId(raw),
    itemKind: raw.itemKind,
    canonicalCode: optionalExact(raw.canonicalCode, 'canonicalCode'),
    displayName: exact(raw.displayName, 'displayName'),
    unitCode: exact(raw.unitCode, 'unitCode'),
    status,
    expectedSourceEvidenceSha256: optionalSha256(
      raw.expectedSourceEvidenceSha256,
      'expectedSourceEvidenceSha256',
    ),
    sourceType: exact(raw.sourceType, 'sourceType'),
    sourcePublicId: exact(raw.sourcePublicId, 'sourcePublicId'),
    sourceTable: exact(raw.sourceTable, 'sourceTable'),
    sourceEvidenceSha256: sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256'),
    occurredAtUtc: utc(raw.occurredAtUtc, 'occurredAtUtc'),
    businessDate: date(raw.businessDate, 'businessDate'),
    idempotencyKey,
    outboxEventPublicId: await outboxId('svcevt', tenantId, idempotencyKey, raw.outboxEventPublicId),
    prices,
  };
}

async function resolveSetPrice(raw: SetCanonicalServicePriceInput): Promise<ResolvedSetPrice> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  return {
    ...resolvePrice(raw),
    tenantId,
    servicePublicId: exact(raw.servicePublicId, 'servicePublicId'),
    occurredAtUtc: utc(raw.occurredAtUtc, 'occurredAtUtc'),
    businessDate: date(raw.businessDate, 'businessDate'),
    idempotencyKey,
    outboxEventPublicId: await outboxId('priceevt', tenantId, idempotencyKey, raw.outboxEventPublicId),
  };
}

async function resolveRetirePrice(raw: RetireCanonicalServicePriceInput): Promise<ResolvedRetirePrice> {
  const tenantId = exact(raw.tenantId, 'tenantId');
  const idempotencyKey = exact(raw.idempotencyKey, 'idempotencyKey');
  return {
    tenantId,
    servicePublicId: exact(raw.servicePublicId, 'servicePublicId'),
    pricePublicId: exact(raw.pricePublicId, 'pricePublicId'),
    expectedSourceEvidenceSha256: sha256(raw.expectedSourceEvidenceSha256, 'expectedSourceEvidenceSha256'),
    retiredAtUtc: utc(raw.retiredAtUtc, 'retiredAtUtc'),
    reasonCode: exact(raw.reasonCode, 'reasonCode'),
    sourceEvidenceSha256: sha256(raw.sourceEvidenceSha256, 'sourceEvidenceSha256'),
    occurredAtUtc: utc(raw.occurredAtUtc, 'occurredAtUtc'),
    businessDate: date(raw.businessDate, 'businessDate'),
    idempotencyKey,
    outboxEventPublicId: await outboxId('priceevt', tenantId, idempotencyKey, raw.outboxEventPublicId),
  };
}

function catalogRequest(input: ResolvedCatalog) {
  return {
    tenantId: input.tenantId,
    servicePublicId: input.servicePublicId,
    itemKind: input.itemKind,
    canonicalCode: input.canonicalCode,
    displayName: input.displayName,
    unitCode: input.unitCode,
    status: input.status,
    expectedSourceEvidenceSha256: input.expectedSourceEvidenceSha256,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    prices: input.prices,
  };
}

function priceRequest(input: ResolvedSetPrice) {
  return {
    tenantId: input.tenantId,
    servicePublicId: input.servicePublicId,
    pricePublicId: input.pricePublicId,
    priceContextType: input.priceContextType,
    priceContextKey: input.priceContextKey,
    amountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
    validFromUtc: input.validFromUtc,
    validToUtc: input.validToUtc,
    status: input.status,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
    replacePricePublicId: input.replacePricePublicId,
    expectedReplacedEvidenceSha256: input.expectedReplacedEvidenceSha256,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
  };
}

function retireRequest(input: ResolvedRetirePrice) {
  return {
    tenantId: input.tenantId,
    servicePublicId: input.servicePublicId,
    pricePublicId: input.pricePublicId,
    expectedSourceEvidenceSha256: input.expectedSourceEvidenceSha256,
    retiredAtUtc: input.retiredAtUtc,
    reasonCode: input.reasonCode,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
  };
}

async function currentCatalog(
  db: CanonicalBatchDatabase,
  tenantId: string,
  servicePublicId: string,
): Promise<CurrentCatalogRow | null> {
  return db.prepare(`
    SELECT service_public_id,item_kind,canonical_code,display_name,unit_code,status,source_evidence_sha256
    FROM canonical_service_catalog_items
    WHERE tenant_id=? AND service_public_id=?
    LIMIT 1
  `).bind(tenantId, servicePublicId).first<CurrentCatalogRow>();
}

async function currentPrice(
  db: CanonicalBatchDatabase,
  tenantId: string,
  pricePublicId: string,
): Promise<CurrentPriceRow | null> {
  return db.prepare(`
    SELECT price_public_id,service_public_id,price_context_type,price_context_key,
           amount_minor,currency_code,valid_from_utc,valid_to_utc,status,source_evidence_sha256
    FROM canonical_service_prices
    WHERE tenant_id=? AND price_public_id=?
    LIMIT 1
  `).bind(tenantId, pricePublicId).first<CurrentPriceRow>();
}

async function checkedMapping(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'service_catalog_item' | 'service_price';
    canonicalPublicId: string;
    sourceType: string;
    sourcePublicId: string;
  },
): Promise<MappingRow | null> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(
    input.tenantId,
    input.entityType,
    input.sourceType,
    input.sourcePublicId,
  ).first<MappingRow>();
  if (!mapping) return null;
  if (mapping.mapping_status !== 'mapped' || mapping.canonical_public_id !== input.canonicalPublicId) {
    throw new Error(`${input.entityType} source mapping belongs to another Canonical identity`);
  }
  return mapping;
}

function mappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'service_catalog_item' | 'service_price';
    canonicalPublicId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    evidenceSha256: string;
  },
  exists: boolean,
): CanonicalPreparedStatement {
  if (exists) {
    return db.prepare(`
      UPDATE canonical_source_mappings
      SET source_table=?,evidence_sha256=?,mapping_version=mapping_version+1,
          updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
        AND canonical_public_id=? AND mapping_status='mapped'
    `).bind(
      input.sourceTable,
      input.evidenceSha256,
      input.tenantId,
      input.entityType,
      input.sourceType,
      input.sourcePublicId,
      input.canonicalPublicId,
    );
  }
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

async function priceStatements(
  db: CanonicalBatchDatabase,
  input: ResolvedPrice & { tenantId: string; servicePublicId: string },
  serviceWillExist: boolean,
): Promise<CanonicalPreparedStatement[]> {
  if (!serviceWillExist) {
    const service = await currentCatalog(db, input.tenantId, input.servicePublicId);
    if (!service || service.status !== 'active') {
      throw new Error('Canonical service does not exist or is not active in the price tenant');
    }
  }
  const duplicate = await currentPrice(db, input.tenantId, input.pricePublicId);
  if (duplicate) throw new Error('Canonical service price already exists; replace it with a new price public ID');

  let replaced: CurrentPriceRow | null = null;
  if (input.replacePricePublicId) {
    replaced = await currentPrice(db, input.tenantId, input.replacePricePublicId);
    if (!replaced || replaced.service_public_id !== input.servicePublicId) {
      throw new Error('replacement price does not exist in the service tenant');
    }
    if (replaced.status !== 'active') throw new Error('replacement price is not active');
    if (
      replaced.price_context_type !== input.priceContextType
      || replaced.price_context_key !== input.priceContextKey
    ) {
      throw new Error('replacement price context does not match');
    }
    if (replaced.source_evidence_sha256 !== input.expectedReplacedEvidenceSha256) {
      throw new Error('replacement price evidence is stale');
    }
    if (input.validFromUtc <= replaced.valid_from_utc) {
      throw new RangeError('replacement validFromUtc must be later than the current price');
    }
  }

  const overlap = await db.prepare(`
    SELECT price_public_id
    FROM canonical_service_prices
    WHERE tenant_id=?
      AND service_public_id=?
      AND price_context_type=?
      AND price_context_key=?
      AND status='active'
      AND price_public_id<>COALESCE(?, '')
      AND valid_from_utc < COALESCE(?, '9999-12-31T23:59:59.999Z')
      AND (valid_to_utc IS NULL OR valid_to_utc > ?)
    LIMIT 1
  `).bind(
    input.tenantId,
    input.servicePublicId,
    input.priceContextType,
    input.priceContextKey,
    input.replacePricePublicId,
    input.validToUtc,
    input.validFromUtc,
  ).first<{ price_public_id: string }>();
  if (overlap) throw new Error(`effective service price overlap with ${overlap.price_public_id}`);

  const mapping = await checkedMapping(db, {
    tenantId: input.tenantId,
    entityType: 'service_price',
    canonicalPublicId: input.pricePublicId,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
  });
  const statements: CanonicalPreparedStatement[] = [];
  if (replaced) {
    statements.push(db.prepare(`
      UPDATE canonical_service_prices
      SET valid_to_utc=?,status='retired',updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE tenant_id=? AND price_public_id=? AND service_public_id=?
        AND status='active' AND source_evidence_sha256=?
    `).bind(
      input.validFromUtc,
      input.tenantId,
      replaced.price_public_id,
      input.servicePublicId,
      input.expectedReplacedEvidenceSha256,
    ));
  }
  statements.push(db.prepare(`
    INSERT INTO canonical_service_prices (
      tenant_id,price_public_id,service_public_id,price_context_type,price_context_key,
      amount_minor,currency_code,valid_from_utc,valid_to_utc,status,source_evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    input.pricePublicId,
    input.servicePublicId,
    input.priceContextType,
    input.priceContextKey,
    input.amountMinor,
    input.currencyCode,
    input.validFromUtc,
    input.validToUtc,
    input.status,
    input.sourceEvidenceSha256,
    input.validFromUtc,
    input.validFromUtc,
  ));
  statements.push(mappingStatement(db, {
    tenantId: input.tenantId,
    entityType: 'service_price',
    canonicalPublicId: input.pricePublicId,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    evidenceSha256: input.sourceEvidenceSha256,
  }, Boolean(mapping)));
  return statements;
}

export async function prepareUpsertCanonicalServiceCatalogItem(
  db: CanonicalBatchDatabase,
  rawInput: UpsertCanonicalServiceCatalogItemInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<PreparedCanonicalBatch<CanonicalServiceCatalogItemResult>> {
  const input = await resolveCatalog(rawInput);
  const request = catalogRequest(input);
  const replay = await readCanonicalCommandReplay<CanonicalServiceCatalogItemResult>(db, {
    tenantId: input.tenantId,
    commandName: UPSERT_COMMAND,
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return { status: 'replayed', result: replay.result, statements: [] };

  const current = await currentCatalog(db, input.tenantId, input.servicePublicId);
  if (!current && input.expectedSourceEvidenceSha256 != null) {
    throw new Error('Canonical service does not exist for expected evidence');
  }
  if (current && input.expectedSourceEvidenceSha256 != null
    && current.source_evidence_sha256 !== input.expectedSourceEvidenceSha256) {
    throw new Error('Canonical service evidence is stale');
  }
  if (current?.status === 'retired') throw new Error('retired Canonical service cannot be upserted');

  const mapping = await checkedMapping(db, {
    tenantId: input.tenantId,
    entityType: 'service_catalog_item',
    canonicalPublicId: input.servicePublicId,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
  });
  const statements: CanonicalPreparedStatement[] = [];
  if (current) {
    statements.push(db.prepare(`
      UPDATE canonical_service_catalog_items
      SET item_kind=?,canonical_code=?,display_name=?,unit_code=?,status=?,source_evidence_sha256=?,
          updated_at_utc=?
      WHERE tenant_id=? AND service_public_id=?
    `).bind(
      input.itemKind,
      input.canonicalCode,
      input.displayName,
      input.unitCode,
      input.status,
      input.sourceEvidenceSha256,
      input.occurredAtUtc,
      input.tenantId,
      input.servicePublicId,
    ));
  } else {
    statements.push(db.prepare(`
      INSERT INTO canonical_service_catalog_items (
        tenant_id,service_public_id,item_kind,canonical_code,display_name,unit_code,status,
        source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).bind(
      input.tenantId,
      input.servicePublicId,
      input.itemKind,
      input.canonicalCode,
      input.displayName,
      input.unitCode,
      input.status,
      input.sourceEvidenceSha256,
      input.occurredAtUtc,
      input.occurredAtUtc,
    ));
  }
  statements.push(mappingStatement(db, {
    tenantId: input.tenantId,
    entityType: 'service_catalog_item',
    canonicalPublicId: input.servicePublicId,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    evidenceSha256: input.sourceEvidenceSha256,
  }, Boolean(mapping)));
  for (const price of input.prices) {
    statements.push(...await priceStatements(db, {
      ...price,
      tenantId: input.tenantId,
      servicePublicId: input.servicePublicId,
    }, !current));
  }

  const result: CanonicalServiceCatalogItemResult = {
    servicePublicId: input.servicePublicId,
    status: input.status,
    pricePublicIds: input.prices.map((price) => price.pricePublicId),
  };
  return prepareCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: UPSERT_COMMAND,
    idempotencyKey: input.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_service_catalog_item',
      aggregatePublicId: input.servicePublicId,
      eventType: current ? 'canonical.service-catalog.updated' : 'canonical.service-catalog.created',
      eventVersion: 1,
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: result,
    },
  });
}

export async function upsertCanonicalServiceCatalogItem(
  db: CanonicalBatchDatabase,
  rawInput: UpsertCanonicalServiceCatalogItemInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalServiceCatalogItemResult>> {
  const prepared = await prepareUpsertCanonicalServiceCatalogItem(db, rawInput, execution);
  if (prepared.status === 'replayed') return { status: 'replayed', result: prepared.result };
  await db.batch([...prepared.statements]);
  return { status: 'applied', result: prepared.result };
}

export async function prepareSetCanonicalServicePrice(
  db: CanonicalBatchDatabase,
  rawInput: SetCanonicalServicePriceInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<PreparedCanonicalBatch<CanonicalServicePriceResult>> {
  const input = await resolveSetPrice(rawInput);
  const request = priceRequest(input);
  const replay = await readCanonicalCommandReplay<CanonicalServicePriceResult>(db, {
    tenantId: input.tenantId,
    commandName: SET_PRICE_COMMAND,
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return { status: 'replayed', result: replay.result, statements: [] };
  const statements = await priceStatements(db, input, false);
  const result: CanonicalServicePriceResult = {
    servicePublicId: input.servicePublicId,
    pricePublicId: input.pricePublicId,
    status: input.status,
  };
  return prepareCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: SET_PRICE_COMMAND,
    idempotencyKey: input.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_service_price',
      aggregatePublicId: input.pricePublicId,
      eventType: 'canonical.service-price.set',
      eventVersion: 1,
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: result,
    },
  });
}

export async function setCanonicalServicePrice(
  db: CanonicalBatchDatabase,
  rawInput: SetCanonicalServicePriceInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalServicePriceResult>> {
  const prepared = await prepareSetCanonicalServicePrice(db, rawInput, execution);
  if (prepared.status === 'replayed') return { status: 'replayed', result: prepared.result };
  await db.batch([...prepared.statements]);
  return { status: 'applied', result: prepared.result };
}

export async function prepareRetireCanonicalServicePrice(
  db: CanonicalBatchDatabase,
  rawInput: RetireCanonicalServicePriceInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<PreparedCanonicalBatch<CanonicalServicePriceResult>> {
  const input = await resolveRetirePrice(rawInput);
  const request = retireRequest(input);
  const replay = await readCanonicalCommandReplay<CanonicalServicePriceResult>(db, {
    tenantId: input.tenantId,
    commandName: RETIRE_PRICE_COMMAND,
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return { status: 'replayed', result: replay.result, statements: [] };

  const current = await currentPrice(db, input.tenantId, input.pricePublicId);
  if (!current || current.service_public_id !== input.servicePublicId) {
    throw new Error('Canonical service price does not exist in the tenant');
  }
  if (current.status !== 'active') throw new Error('Canonical service price is not active');
  if (current.source_evidence_sha256 !== input.expectedSourceEvidenceSha256) {
    throw new Error('Canonical service price evidence is stale');
  }
  if (input.retiredAtUtc <= current.valid_from_utc) {
    throw new RangeError('retiredAtUtc must be later than the price validFromUtc');
  }
  const result: CanonicalServicePriceResult = {
    servicePublicId: input.servicePublicId,
    pricePublicId: input.pricePublicId,
    status: 'retired',
  };
  return prepareCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: RETIRE_PRICE_COMMAND,
    idempotencyKey: input.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements: [db.prepare(`
      UPDATE canonical_service_prices
      SET valid_to_utc=?,status='retired',source_evidence_sha256=?,updated_at_utc=?
      WHERE tenant_id=? AND price_public_id=? AND service_public_id=?
        AND status='active' AND source_evidence_sha256=?
    `).bind(
      input.retiredAtUtc,
      input.sourceEvidenceSha256,
      input.occurredAtUtc,
      input.tenantId,
      input.pricePublicId,
      input.servicePublicId,
      input.expectedSourceEvidenceSha256,
    )],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_service_price',
      aggregatePublicId: input.pricePublicId,
      eventType: 'canonical.service-price.retired',
      eventVersion: 1,
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        ...result,
        reasonCode: input.reasonCode,
      },
    },
  });
}

export async function retireCanonicalServicePrice(
  db: CanonicalBatchDatabase,
  rawInput: RetireCanonicalServicePriceInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CanonicalServicePriceResult>> {
  const prepared = await prepareRetireCanonicalServicePrice(db, rawInput, execution);
  if (prepared.status === 'replayed') return { status: 'replayed', result: prepared.result };
  await db.batch([...prepared.statements]);
  return { status: 'applied', result: prepared.result };
}
