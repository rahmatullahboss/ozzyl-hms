import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
  normalizeIdentityText,
} from '../../src/lib/canonical/source-mapping';
import { toMinorUnits } from '../../src/lib/canonical/money';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface InvoiceItemDeliveryPreparedStatement {
  bind(...values: unknown[]): InvoiceItemDeliveryPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface InvoiceItemDeliveryDatabase {
  prepare(sql: string): InvoiceItemDeliveryPreparedStatement;
  batch(statements: InvoiceItemDeliveryPreparedStatement[]): Promise<unknown[]>;
}

export interface InvoiceItemDeliveryBackfillOptions {
  tenantId: string;
  currencyCode: string;
  nowUtc?: string;
}

export interface InvoiceItemDeliveryBackfillResult {
  completed: true;
  scanned: number;
  eventsCreated: number;
  headerEventsCreated: number;
  reused: number;
  skipped: number;
}

interface InvoiceItemRow {
  id: number;
  bill_id: number;
  patient_id: number;
  item_category: string | null;
  description: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  reference_id: number | null;
  status: string | null;
  cancelled_at: string | null;
  tax_amount: number | null;
  created_at: string | null;
  bill_created_at: string | null;
}

interface HeaderBillRow {
  id: number;
  patient_id: number;
  invoice_no: string | null;
  invoice_code: string | null;
  discount: number | null;
  tax_total: number | null;
  total: number | null;
  status: string | null;
  cancelled_at: string | null;
  created_at: string | null;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}

const SOURCE_SERVICE = 'legacy_invoice_item_historical_service';
const SOURCE_PRICE = 'legacy_invoice_item_historical_price';
export const SOURCE_DELIVERY_EVENT = 'legacy_invoice_item_delivery';
const SOURCE_HEADER_SERVICE = 'legacy_bill_header_historical_service';
const SOURCE_HEADER_PRICE = 'legacy_bill_header_historical_price';
export const SOURCE_HEADER_DELIVERY_EVENT = 'legacy_bill_header_delivery';

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) throw new TypeError(`${label} is invalid`);
  return value;
}

function currency(value: string): string {
  exact(value, 'currencyCode');
  if (!/^[A-Z]{3}$/.test(value)) throw new TypeError('currencyCode must be three uppercase letters');
  return value;
}

function legacyUtc(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  return toUtcIso(/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso) ? iso : `${iso}+06:00`);
}

function active(row: InvoiceItemRow): boolean {
  return row.cancelled_at == null && (row.status ?? '').trim().toLowerCase() !== 'cancelled';
}

function validMoneyAndQuantity(row: InvoiceItemRow): row is InvoiceItemRow & {
  quantity: number;
  unit_price: number;
  line_total: number;
} {
  if (!Number.isSafeInteger(row.quantity) || Number(row.quantity) <= 0) return false;
  if (!Number.isSafeInteger(row.unit_price) || Number(row.unit_price) < 0) return false;
  if (!Number.isSafeInteger(row.line_total) || Number(row.line_total) < 0) return false;
  const gross = BigInt(Number(row.quantity)) * BigInt(Number(row.unit_price));
  return gross <= BigInt(Number.MAX_SAFE_INTEGER) && Number(row.line_total) <= Number(gross);
}

function minor(major: number): number {
  const value = BigInt(major) * 100n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Historical invoice amount exceeds safe range');
  return Number(value);
}

function exactMinor(major: number | null, label: string): number {
  if (major == null || !Number.isFinite(major) || major < 0) {
    throw new RangeError(`${label} must be a non-negative finite amount`);
  }
  return Number(toMinorUnits(String(major)));
}

function itemKind(category: string): 'laboratory' | 'radiology' | 'consultation' | 'bed' | 'procedure' | 'product' | 'other' {
  switch (category) {
    case 'test': return 'laboratory';
    case 'doctor_visit': return 'consultation';
    case 'admission': return 'bed';
    case 'operation':
    case 'procedure': return 'procedure';
    case 'medicine': return 'product';
    default: return 'other';
  }
}

function eventType(category: string): 'completed' | 'dispensed' | 'occupied' | 'delivered' {
  if (category === 'medicine') return 'dispensed';
  if (category === 'admission') return 'occupied';
  if (category === 'doctor_visit') return 'completed';
  return 'delivered';
}

function unitCode(category: string): string {
  switch (category) {
    case 'test': return 'test';
    case 'doctor_visit': return 'visit';
    case 'admission': return 'stay';
    case 'operation':
    case 'procedure': return 'procedure';
    case 'medicine': return 'item';
    default: return 'item';
  }
}

function displayName(row: InvoiceItemRow): string {
  return normalizeIdentityText(row.description)
    ?? `Historical ${normalizeIdentityText(row.item_category)?.replaceAll('_', ' ') ?? 'service'} item ${row.id}`;
}

async function evidence(row: InvoiceItemRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_DELIVERY_EVENT,
    sourcePublicId: String(row.id),
    billId: row.bill_id,
    patientId: row.patient_id,
    category: normalizeIdentityText(row.item_category),
    description: normalizeIdentityText(row.description),
    quantity: row.quantity,
    unitPriceMajor: row.unit_price,
    lineTotalMajor: row.line_total,
    referenceId: row.reference_id,
    status: row.status,
    cancelledAt: row.cancelled_at,
    taxMajor: row.tax_amount,
    createdAt: row.created_at,
  });
}

async function headerEvidence(row: HeaderBillRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_HEADER_DELIVERY_EVENT,
    sourcePublicId: String(row.id),
    patientId: row.patient_id,
    invoiceNo: row.invoice_no,
    invoiceCode: row.invoice_code,
    discountMajor: row.discount,
    taxMajor: row.tax_total,
    totalMajor: row.total,
    status: row.status,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
  });
}

function mappingStatement(
  db: InvoiceItemDeliveryDatabase,
  tenantId: string,
  entityType: string,
  canonicalId: string,
  sourceType: string,
  sourceId: string,
  evidenceSha256: string,
  nowUtc: string,
  sourceTable = 'invoice_items',
): InvoiceItemDeliveryPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,'mapped',1,?,?,?)
  `).bind(
    tenantId,
    entityType,
    canonicalId,
    sourceType,
    sourceId,
    sourceTable,
    evidenceSha256,
    nowUtc,
    nowUtc,
  );
}

async function existingMapping(
  db: InvoiceItemDeliveryDatabase,
  tenantId: string,
  sourceType: string,
  sourceId: string,
): Promise<MappingRow | null> {
  return db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='service_event'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, sourceType, sourceId).first<MappingRow>();
}

export async function backfillInvoiceItemDeliveries(
  db: InvoiceItemDeliveryDatabase,
  options: InvoiceItemDeliveryBackfillOptions,
): Promise<InvoiceItemDeliveryBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const currencyCode = currency(options.currencyCode);
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
  const rows = (await db.prepare(`
    SELECT i.id,i.bill_id,b.patient_id,i.item_category,i.description,i.quantity,
           i.unit_price,i.line_total,i.reference_id,i.status,i.cancelled_at,
           i.tax_amount,i.created_at,b.created_at AS bill_created_at
    FROM invoice_items i
    JOIN bills b ON b.id=i.bill_id AND CAST(b.tenant_id AS TEXT)=CAST(i.tenant_id AS TEXT)
    WHERE CAST(i.tenant_id AS TEXT)=?
    ORDER BY i.id
  `).bind(tenantId).all<InvoiceItemRow>()).results;

  let eventsCreated = 0;
  let headerEventsCreated = 0;
  let reused = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!active(row) || !validMoneyAndQuantity(row)) {
      skipped += 1;
      continue;
    }
    const sourceId = String(row.id);
    const sourceEvidence = await evidence(row);
    const mapping = await existingMapping(db, tenantId, SOURCE_DELIVERY_EVENT, sourceId);
    if (mapping) {
      if (
        mapping.mapping_status !== 'mapped'
        || !mapping.canonical_public_id
        || mapping.evidence_sha256 !== sourceEvidence
      ) {
        throw new Error(`Historical invoice delivery evidence changed for line ${row.id}`);
      }
      reused += 1;
      continue;
    }

    const category = normalizeIdentityText(row.item_category) ?? 'other';
    const serviceId = await createDeterministicSourceId('svch', tenantId, SOURCE_SERVICE, sourceId);
    const priceId = await createDeterministicSourceId('prch', tenantId, SOURCE_PRICE, sourceId);
    const eventId = await createDeterministicSourceId('evth', tenantId, SOURCE_DELIVERY_EVENT, sourceId);
    const occurredAt = legacyUtc(row.created_at ?? row.bill_created_at, nowUtc);
    const amountMinor = minor(row.unit_price);

    await db.batch([
      db.prepare(`
        INSERT INTO canonical_service_catalog_items (
          tenant_id,service_public_id,item_kind,canonical_code,display_name,
          unit_code,status,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,NULL,?,?,'retired',?,?,?)
      `).bind(
        tenantId,
        serviceId,
        itemKind(category),
        displayName(row),
        unitCode(category),
        sourceEvidence,
        nowUtc,
        nowUtc,
      ),
      db.prepare(`
        INSERT INTO canonical_service_prices (
          tenant_id,price_public_id,service_public_id,price_context_type,
          price_context_key,amount_minor,currency_code,valid_from_utc,
          valid_to_utc,status,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,'sale','historical_invoice_item',?,?,?,NULL,'retired',?,?,?)
      `).bind(
        tenantId,
        priceId,
        serviceId,
        amountMinor,
        currencyCode,
        occurredAt,
        sourceEvidence,
        nowUtc,
        nowUtc,
      ),
      db.prepare(`
        INSERT INTO canonical_service_events (
          tenant_id,event_public_id,request_public_id,encounter_public_id,
          service_public_id,event_type,quantity,status,occurred_at_utc,
          cancelled_at_utc,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,NULL,NULL,?,?,?,'posted',?,NULL,?,?,?)
      `).bind(
        tenantId,
        eventId,
        serviceId,
        eventType(category),
        row.quantity,
        occurredAt,
        sourceEvidence,
        nowUtc,
        nowUtc,
      ),
      mappingStatement(db, tenantId, 'service_catalog_item', serviceId, SOURCE_SERVICE, sourceId, sourceEvidence, nowUtc),
      mappingStatement(db, tenantId, 'service_price', priceId, SOURCE_PRICE, sourceId, sourceEvidence, nowUtc),
      mappingStatement(db, tenantId, 'service_event', eventId, SOURCE_DELIVERY_EVENT, sourceId, sourceEvidence, nowUtc),
    ]);
    eventsCreated += 1;
  }

  const headerRows = (await db.prepare(`
    SELECT b.id,b.patient_id,b.invoice_no,b.invoice_code,b.discount,b.tax_total,
           b.total,b.status,b.cancelled_at,b.created_at
    FROM bills b
    WHERE CAST(b.tenant_id AS TEXT)=?
      AND b.cancelled_at IS NULL
      AND lower(COALESCE(b.status,'')) <> 'cancelled'
      AND NOT EXISTS (
        SELECT 1 FROM invoice_items i
        WHERE i.bill_id=b.id AND CAST(i.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
          AND i.cancelled_at IS NULL
          AND lower(COALESCE(i.status,'')) <> 'cancelled'
      )
    ORDER BY b.id
  `).bind(tenantId).all<HeaderBillRow>()).results;

  for (const row of headerRows) {
    let totalMinor: number;
    let discountMinor: number;
    let taxMinor: number;
    try {
      totalMinor = exactMinor(row.total, 'bill total');
      discountMinor = exactMinor(row.discount ?? 0, 'bill discount');
      taxMinor = exactMinor(row.tax_total ?? 0, 'bill tax');
    } catch {
      skipped += 1;
      continue;
    }
    const grossMinor = totalMinor + discountMinor - taxMinor;
    if (!Number.isSafeInteger(grossMinor) || grossMinor < 0) {
      skipped += 1;
      continue;
    }

    const sourceId = String(row.id);
    const sourceEvidence = await headerEvidence(row);
    const mapping = await existingMapping(db, tenantId, SOURCE_HEADER_DELIVERY_EVENT, sourceId);
    if (mapping) {
      if (
        mapping.mapping_status !== 'mapped'
        || !mapping.canonical_public_id
        || mapping.evidence_sha256 !== sourceEvidence
      ) {
        throw new Error(`Historical bill-header delivery evidence changed for bill ${row.id}`);
      }
      reused += 1;
      continue;
    }

    const serviceId = await createDeterministicSourceId('svch', tenantId, SOURCE_HEADER_SERVICE, sourceId);
    const priceId = await createDeterministicSourceId('prch', tenantId, SOURCE_HEADER_PRICE, sourceId);
    const eventId = await createDeterministicSourceId('evth', tenantId, SOURCE_HEADER_DELIVERY_EVENT, sourceId);
    const occurredAt = legacyUtc(row.created_at, nowUtc);
    const invoiceLabel = normalizeIdentityText(row.invoice_no ?? row.invoice_code)
      ?? `bill ${row.id}`;

    await db.batch([
      db.prepare(`
        INSERT INTO canonical_service_catalog_items (
          tenant_id,service_public_id,item_kind,canonical_code,display_name,
          unit_code,status,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,'other',NULL,?,'invoice','retired',?,?,?)
      `).bind(
        tenantId,
        serviceId,
        `Historical invoice delivery ${invoiceLabel}`,
        sourceEvidence,
        nowUtc,
        nowUtc,
      ),
      db.prepare(`
        INSERT INTO canonical_service_prices (
          tenant_id,price_public_id,service_public_id,price_context_type,
          price_context_key,amount_minor,currency_code,valid_from_utc,
          valid_to_utc,status,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,?,'sale','historical_bill_header',?,?,?,NULL,'retired',?,?,?)
      `).bind(
        tenantId,
        priceId,
        serviceId,
        grossMinor,
        currencyCode,
        occurredAt,
        sourceEvidence,
        nowUtc,
        nowUtc,
      ),
      db.prepare(`
        INSERT INTO canonical_service_events (
          tenant_id,event_public_id,request_public_id,encounter_public_id,
          service_public_id,event_type,quantity,status,occurred_at_utc,
          cancelled_at_utc,source_evidence_sha256,created_at_utc,updated_at_utc
        ) VALUES (?,?,NULL,NULL,?,'delivered',1,'posted',?,NULL,?,?,?)
      `).bind(
        tenantId,
        eventId,
        serviceId,
        occurredAt,
        sourceEvidence,
        nowUtc,
        nowUtc,
      ),
      mappingStatement(
        db, tenantId, 'service_catalog_item', serviceId,
        SOURCE_HEADER_SERVICE, sourceId, sourceEvidence, nowUtc, 'bills',
      ),
      mappingStatement(
        db, tenantId, 'service_price', priceId,
        SOURCE_HEADER_PRICE, sourceId, sourceEvidence, nowUtc, 'bills',
      ),
      mappingStatement(
        db, tenantId, 'service_event', eventId,
        SOURCE_HEADER_DELIVERY_EVENT, sourceId, sourceEvidence, nowUtc, 'bills',
      ),
    ]);
    headerEventsCreated += 1;
  }

  return {
    completed: true,
    scanned: rows.length + headerRows.length,
    eventsCreated,
    headerEventsCreated,
    reused,
    skipped,
  };
}
