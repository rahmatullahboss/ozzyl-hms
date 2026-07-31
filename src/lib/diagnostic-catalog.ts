import { HTTPException } from 'hono/http-exception';

export type DiagnosticCatalogKind = 'lab' | 'radiology';

export interface DiagnosticCatalogCsvRow {
  rowNumber: number;
  kind: DiagnosticCatalogKind;
  code: string;
  name: string;
  category: string | null;
  price: number;
  unit: string | null;
  normalRange: string | null;
  method: string | null;
  isActive: number;
}

export interface DiagnosticCatalogCsvError {
  rowNumber: number;
  message: string;
  raw: string[];
}

export interface DiagnosticCatalogCsvParseResult {
  rows: DiagnosticCatalogCsvRow[];
  errors: DiagnosticCatalogCsvError[];
  totalRows: number;
}

export interface DiagnosticBillingSyncInput {
  kind: DiagnosticCatalogKind;
  tenantId: string;
  userId: string;
  code: string;
  name: string;
  category?: string | null;
  price: number;
  isActive?: number;
  oldCode?: string | null;
  serviceItemId?: number | null;
}

export interface DiagnosticCatalogSyncOptions {
  isCommissionable?: boolean;
}

export interface DiagnosticBillingServiceRow {
  id: number;
  item_name: string;
  item_code: string | null;
  service_department_id: number | null;
  department_code: string | null;
  department_name: string | null;
  price: number;
  description: string | null;
  is_active: number | null;
}

export interface ResolvedLabBillingRow {
  id: number;
  code: string;
  name: string;
  category: string | null;
  price: number;
  billingServiceItemId: number | null;
}

export interface ResolvedRadiologyBillingRow {
  id: number;
  imagingTypeId: number | null;
  imagingTypeName: string | null;
  name: string;
  procedureCode: string | null;
  price: number;
  pricePaisa: number;
  billingServiceItemId: number | null;
}

const DIAGNOSTIC_DEPARTMENTS: Record<DiagnosticCatalogKind, { code: string; name: string }> = {
  lab: { code: 'LAB', name: 'Laboratory' },
  radiology: { code: 'RAD', name: 'Radiology' },
};

const HEADER_ALIASES: Record<string, string[]> = {
  kind: ['type', 'kind', 'department', 'service_type', 'catalog_type'],
  code: ['code', 'test_code', 'item_code', 'procedure_code', 'short_code'],
  serialNo: ['serial_no', 'serial', 'sl', 'sl_no', 's_no'],
  name: ['name', 'test_name', 'item_name', 'procedure_name', 'service_name'],
  category: ['category', 'group', 'test_category', 'department_name', 'modality', 'imaging_type'],
  price: ['price', 'rate', 'amount', 'charge', 'fee', 'price_bdt'],
  unit: ['unit', 'units'],
  normalRange: ['normal_range', 'reference_range', 'range'],
  method: ['method', 'technology'],
  active: ['active', 'is_active', 'status'],
};

function cleanText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function requiredText(value: unknown): string {
  return cleanText(value) ?? '';
}

function normalizeCode(value: unknown): string {
  return requiredText(value).toUpperCase().replace(/\s+/g, '-').slice(0, 50);
}

export function normalizeDiagnosticCatalogCode(value: unknown): string {
  return normalizeCode(value);
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeDigits(value: string): string {
  const banglaDigits = '০১২৩৪৫৬৭৮৯';
  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  return value.replace(/[০-৯٠-٩]/g, (digit) => {
    const banglaIndex = banglaDigits.indexOf(digit);
    if (banglaIndex >= 0) return String(banglaIndex);
    const arabicIndex = arabicDigits.indexOf(digit);
    return arabicIndex >= 0 ? String(arabicIndex) : digit;
  });
}

function codePrefixFromCategory(category: string | null, kind: DiagnosticCatalogKind): string {
  const text = (category ?? '').toUpperCase();
  if (kind === 'radiology') {
    if (/ULTRA|USG|US/.test(text)) return 'USG';
    if (/X[-\s]?RAY|XR/.test(text)) return 'XR';
    if (/CT/.test(text)) return 'CT';
    if (/MRI|MR/.test(text)) return 'MR';
    return 'RAD';
  }
  const words = text.replace(/&/g, ' ').split(/[^A-Z0-9]+/).filter(Boolean);
  const prefix = words.map((word) => word[0]).join('').slice(0, 5);
  return prefix || 'LAB';
}

function slugFromName(name: string): string {
  const normalized = normalizeDigits(name)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, 30) || 'ITEM';
}

function generateCatalogCode(
  category: string | null,
  serialNo: string | null,
  name: string,
  kind: DiagnosticCatalogKind,
): string {
  const prefix = codePrefixFromCategory(category, kind);
  const serial = normalizeDigits(serialNo ?? '').replace(/[^0-9A-Z]+/gi, '').toUpperCase();
  return normalizeCode(`${prefix}-${serial || slugFromName(name)}`);
}

function parseMoney(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  const cleaned = String(value).replace(/[৳$,]/g, '').trim();
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function normalizeActive(value: unknown): number {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 1;
  if (['0', 'false', 'inactive', 'disabled', 'no', 'n'].includes(text)) return 0;
  return 1;
}

function normalizeKind(value: unknown, code: string): DiagnosticCatalogKind {
  const text = String(value ?? '').trim().toLowerCase();
  const codeText = String(code ?? '').trim().toLowerCase();
  const radiologyPattern = /(^|[^a-z0-9])(rad|radio|radiology|imaging|xray|x-ray|x ray|ct|mri|mr|us|usg|ultrasound|ultrasonography|scan)([^a-z0-9]|$)/;
  if (radiologyPattern.test(text) || radiologyPattern.test(codeText)) return 'radiology';
  if (/(lab|pathology|path|test|diagnostic)/.test(text)) return 'lab';
  if (/^(RAD|XR|CT|MR|MRI|US|USG)-?/i.test(code)) return 'radiology';
  return 'lab';
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += ch;
  }

  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function buildHeaderIndex(row: string[]): Record<string, number> | null {
  const normalized = row.map(normalizeHeader);
  const index: Record<string, number> = {};

  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const found = aliases.map(normalizeHeader).map((alias) => normalized.indexOf(alias)).find((idx) => idx >= 0);
    if (found !== undefined && found >= 0) index[key] = found;
  }

  if (index.name === undefined) return null;
  return index;
}

function valueAt(row: string[], index: Record<string, number> | null, key: string, fallbackPosition: number): string {
  if (index) {
    const position = index[key];
    return position === undefined ? '' : row[position] ?? '';
  }
  const position = index?.[key] ?? fallbackPosition;
  return row[position] ?? '';
}

export function parseDiagnosticCatalogCsv(text: string): DiagnosticCatalogCsvParseResult {
  const table = parseCsvRows(text);
  if (table.length === 0) return { rows: [], errors: [], totalRows: 0 };

  const headerIndex = buildHeaderIndex(table[0]);
  const startIndex = headerIndex ? 1 : 0;
  const rows: DiagnosticCatalogCsvRow[] = [];
  const errors: DiagnosticCatalogCsvError[] = [];

  for (let i = startIndex; i < table.length; i += 1) {
    const raw = table[i];
    const rowNumber = i + 1;
    const name = requiredText(valueAt(raw, headerIndex, 'name', 1));
    const category = cleanText(valueAt(raw, headerIndex, 'category', 2));
    const serialNo = cleanText(valueAt(raw, headerIndex, 'serialNo', 9));
    const explicitCode = normalizeCode(valueAt(raw, headerIndex, 'code', 0));
    const kindSignal = category
      ? `${valueAt(raw, headerIndex, 'kind', 8)} ${category}`
      : `${valueAt(raw, headerIndex, 'kind', 8)} ${name}`;
    const kind = normalizeKind(kindSignal, explicitCode);
    const code = explicitCode || generateCatalogCode(category, serialNo, name, kind);
    const price = parseMoney(valueAt(raw, headerIndex, 'price', 3));

    if (!code) {
      errors.push({ rowNumber, message: 'Missing code', raw });
      continue;
    }
    if (!name) {
      errors.push({ rowNumber, message: 'Missing name', raw });
      continue;
    }
    if (price === null) {
      errors.push({ rowNumber, message: 'Invalid price', raw });
      continue;
    }

    rows.push({
      rowNumber,
      kind,
      code,
      name,
      category,
      price,
      unit: cleanText(valueAt(raw, headerIndex, 'unit', 4)),
      normalRange: cleanText(valueAt(raw, headerIndex, 'normalRange', 5)),
      method: cleanText(valueAt(raw, headerIndex, 'method', 6)),
      isActive: normalizeActive(valueAt(raw, headerIndex, 'active', 7)),
    });
  }

  return {
    rows,
    errors,
    totalRows: table.length - startIndex,
  };
}

export async function ensureDiagnosticBillingDepartment(
  d1: D1Database,
  tenantId: string,
  userId: string,
  kind: DiagnosticCatalogKind,
): Promise<number> {
  const config = DIAGNOSTIC_DEPARTMENTS[kind];
  const existing = await d1.prepare(`
    SELECT id FROM billing_service_departments
    WHERE department_code = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(config.code, tenantId).first<{ id: number }>();
  if (existing?.id) return Number(existing.id);

  try {
    const result = await d1.prepare(`
      INSERT INTO billing_service_departments
        (department_name, department_code, is_active, tenant_id, created_by)
      VALUES (?, ?, 1, ?, ?)
    `).bind(config.name, config.code, tenantId, userId).run();
    return Number(result.meta.last_row_id);
  } catch {
    const recovered = await d1.prepare(`
      SELECT id FROM billing_service_departments
      WHERE department_code = ? AND tenant_id = ? AND COALESCE(is_active, 1) = 1
      LIMIT 1
    `).bind(config.code, tenantId).first<{ id: number }>();
    if (recovered?.id) return Number(recovered.id);
    throw new Error(`Failed to ensure ${config.name} billing department`);
  }
}

export async function ensureDefaultDiagnosticPriceCategory(d1: D1Database, tenantId: string): Promise<number> {
  const insertResult = await d1.prepare(`
    INSERT INTO price_categories
      (tenant_id, category_name, category_code, description, is_default, is_active, created_at)
    SELECT ?, 'Normal', 'NOR', 'Standard price', 1, 1, datetime('now', '+6 hours')
    WHERE NOT EXISTS (
      SELECT 1 FROM price_categories
      WHERE tenant_id = ? AND is_active = 1
    )
  `).bind(tenantId, tenantId).run();

  const category = await d1.prepare(`
    SELECT id FROM price_categories
    WHERE tenant_id = ? AND is_active = 1
    ORDER BY is_default DESC, id ASC
    LIMIT 1
  `).bind(tenantId).first<{ id: number }>();

  if (!category?.id && insertResult.meta.last_row_id) return Number(insertResult.meta.last_row_id);
  if (!category?.id) throw new HTTPException(500, { message: 'Default billing price category is not configured' });
  return Number(category.id);
}

export async function ensureLabTestCategory(
  d1: D1Database,
  tenantId: string,
  userId: string,
  category: string | null | undefined,
): Promise<number | null> {
  const categoryName = cleanText(category);
  if (!categoryName) return null;

  const existing = await d1.prepare(`
    SELECT id FROM lab_test_categories
    WHERE tenant_id = ?
      AND LOWER(category_name) = LOWER(?)
      AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(tenantId, categoryName).first<{ id: number }>();
  if (existing?.id) return Number(existing.id);

  const result = await d1.prepare(`
    INSERT INTO lab_test_categories
      (category_name, description, is_active, tenant_id, created_by, created_at, updated_at)
    VALUES (?, 'Diagnostic catalog category', 1, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
  `).bind(categoryName, tenantId, userId).run();
  return Number(result.meta.last_row_id);
}

export async function syncDefaultDiagnosticPriceMap(
  d1: D1Database,
  tenantId: string,
  serviceItemId: number,
  price: number,
): Promise<void> {
  const categoryId = await ensureDefaultDiagnosticPriceCategory(d1, tenantId);
  const existing = await d1.prepare(`
    SELECT id FROM billing_item_price_category_maps
    WHERE tenant_id = ? AND service_item_id = ? AND price_category_id = ?
    LIMIT 1
  `).bind(tenantId, serviceItemId, categoryId).first<{ id: number }>();

  if (existing?.id) {
    await d1.prepare(`
      UPDATE billing_item_price_category_maps
      SET price = ?, is_active = 1, updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(price, existing.id, tenantId).run();
    return;
  }

  await d1.prepare(`
    INSERT INTO billing_item_price_category_maps
      (tenant_id, service_item_id, price_category_id, price, is_discount_applicable, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, 1, datetime('now', '+6 hours'))
  `).bind(tenantId, serviceItemId, categoryId, price).run();
}

export async function upsertDiagnosticBillingServiceItem(
  d1: D1Database,
  input: DiagnosticBillingSyncInput,
): Promise<number> {
  const code = normalizeCode(input.code);
  const name = requiredText(input.name);
  if (!code || !name) throw new HTTPException(400, { message: 'Diagnostic item code and name are required' });
  if (input.kind === 'lab') {
    await ensureLabTestCategory(d1, input.tenantId, input.userId, input.category);
  }

  const serviceDeptId = await ensureDiagnosticBillingDepartment(d1, input.tenantId, input.userId, input.kind);
  const oldCode = cleanText(input.oldCode) ?? code;
  const isActive = input.isActive ?? 1;
  let existing: { id: number } | null = null;

  if (input.serviceItemId) {
    existing = await d1.prepare(`
      SELECT id FROM billing_service_items
      WHERE id = ? AND tenant_id = ?
      LIMIT 1
    `).bind(input.serviceItemId, input.tenantId).first<{ id: number }>();
  }

  if (!existing) {
    existing = await d1.prepare(`
      SELECT si.id
      FROM billing_service_items si
      WHERE si.tenant_id = ?
        AND si.service_department_id = ?
        AND si.item_code IN (?, ?)
      ORDER BY CASE WHEN si.item_code = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).bind(input.tenantId, serviceDeptId, oldCode, code, oldCode).first<{ id: number }>();
  }

  if (existing?.id) {
    const serviceItemId = Number(existing.id);
    await d1.prepare(`
      UPDATE billing_service_items
      SET item_name = ?,
          item_code = ?,
          service_department_id = ?,
          price = ?,
          description = ?,
          is_active = ?,
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(
      name,
      code,
      serviceDeptId,
      input.price,
      cleanText(input.category),
      isActive,
      serviceItemId,
      input.tenantId,
    ).run();
    await syncDefaultDiagnosticPriceMap(d1, input.tenantId, serviceItemId, input.price);
    return serviceItemId;
  }

  const insertResult = await d1.prepare(`
    INSERT INTO billing_service_items
      (item_name, item_code, service_department_id, price, tax_applicable, tax_percent,
       allow_discount, allow_multiple_qty, description, display_order, is_active, tenant_id, created_by)
    VALUES (?, ?, ?, ?, 0, 0, 1, 1, ?, 0, ?, ?, ?)
  `).bind(
    name,
    code,
    serviceDeptId,
    input.price,
    cleanText(input.category),
    isActive,
    input.tenantId,
    input.userId,
  ).run();

  const serviceItemId = Number(insertResult.meta.last_row_id);
  await syncDefaultDiagnosticPriceMap(d1, input.tenantId, serviceItemId, input.price);
  return serviceItemId;
}

type ResolvedLabBillingQueryRow = {
  id: number;
  code: string;
  name: string;
  category: string | null;
  price: number;
  billing_service_item_id: number | null;
  linked_service_price: number | null;
  linked_service_item_id: number | null;
  code_service_price: number | null;
  code_service_item_id: number | null;
};

function mapResolvedLabBillingRow(row: ResolvedLabBillingQueryRow): ResolvedLabBillingRow {
  const price = row.linked_service_price ?? row.code_service_price ?? row.price ?? 0;
  const billingServiceItemId = row.linked_service_item_id ?? row.code_service_item_id ?? row.billing_service_item_id ?? null;
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    category: row.category ?? null,
    price: Number(price),
    billingServiceItemId: billingServiceItemId ? Number(billingServiceItemId) : null,
  };
}

/** Resolve multiple lab tests with one indexed catalog query. */
export async function resolveLabTestBillingRows(
  d1: D1Database,
  tenantId: string,
  labTestIds: number[],
): Promise<ResolvedLabBillingRow[]> {
  const ids = [...new Set(labTestIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await d1.prepare(`
    SELECT
      ltc.id,
      ltc.code,
      ltc.name,
      ltc.category,
      ltc.price,
      ltc.billing_service_item_id,
      linked_si.price AS linked_service_price,
      linked_si.id AS linked_service_item_id,
      code_si.price AS code_service_price,
      code_si.id AS code_service_item_id
    FROM lab_test_catalog ltc
    LEFT JOIN billing_service_items linked_si
      ON linked_si.id = ltc.billing_service_item_id
     AND linked_si.tenant_id = ltc.tenant_id
     AND (linked_si.is_active IS NULL OR linked_si.is_active = 1)
    LEFT JOIN billing_service_departments lab_sd
      ON lab_sd.tenant_id = ltc.tenant_id
     AND lab_sd.department_code = 'LAB'
     AND (lab_sd.is_active IS NULL OR lab_sd.is_active = 1)
    LEFT JOIN billing_service_items code_si
      ON code_si.tenant_id = ltc.tenant_id
     AND code_si.service_department_id = lab_sd.id
     AND code_si.item_code = ltc.code
     AND (code_si.is_active IS NULL OR code_si.is_active = 1)
    WHERE ltc.id IN (${placeholders})
      AND ltc.tenant_id = ?
      AND (ltc.is_active IS NULL OR ltc.is_active = 1)
  `).bind(...ids, tenantId).all<ResolvedLabBillingQueryRow>();
  return results.map(mapResolvedLabBillingRow);
}

export async function resolveLabTestBillingRow(
  d1: D1Database,
  tenantId: string,
  labTestId: number,
): Promise<ResolvedLabBillingRow | null> {
  return (await resolveLabTestBillingRows(d1, tenantId, [labTestId]))[0] ?? null;
}

export async function resolveRadiologyBillingRow(
  d1: D1Database,
  tenantId: string,
  imagingItemId: number,
): Promise<ResolvedRadiologyBillingRow | null> {
  const row = await d1.prepare(`
    SELECT
      i.id,
      i.imaging_type_id,
      t.name AS imaging_type_name,
      i.name,
      i.procedure_code,
      COALESCE(linked_si.price, code_si.price, COALESCE(i.price_paisa, 0) / 100.0, 0) AS price,
      COALESCE(linked_si.id, code_si.id, i.billing_service_item_id) AS billing_service_item_id
    FROM radiology_imaging_items i
    LEFT JOIN radiology_imaging_types t
      ON t.id = i.imaging_type_id AND t.tenant_id = i.tenant_id
    LEFT JOIN billing_service_items linked_si
      ON linked_si.id = i.billing_service_item_id
     AND linked_si.tenant_id = i.tenant_id
     AND COALESCE(linked_si.is_active, 1) = 1
    LEFT JOIN billing_service_departments rad_sd
      ON rad_sd.tenant_id = i.tenant_id
     AND rad_sd.department_code = 'RAD'
     AND COALESCE(rad_sd.is_active, 1) = 1
    LEFT JOIN billing_service_items code_si
      ON code_si.tenant_id = i.tenant_id
     AND code_si.service_department_id = rad_sd.id
     AND code_si.item_code = i.procedure_code
     AND COALESCE(code_si.is_active, 1) = 1
    WHERE i.id = ? AND i.tenant_id = ? AND COALESCE(i.is_active, 1) = 1
    LIMIT 1
  `).bind(imagingItemId, tenantId).first<{
    id: number;
    imaging_type_id: number | null;
    imaging_type_name: string | null;
    name: string;
    procedure_code: string | null;
    price: number;
    billing_service_item_id: number | null;
  }>();

  if (!row) return null;
  const price = Number(row.price ?? 0);
  return {
    id: Number(row.id),
    imagingTypeId: row.imaging_type_id ? Number(row.imaging_type_id) : null,
    imagingTypeName: row.imaging_type_name ?? null,
    name: row.name,
    procedureCode: row.procedure_code ?? null,
    price,
    pricePaisa: Math.round(price * 100),
    billingServiceItemId: row.billing_service_item_id ? Number(row.billing_service_item_id) : null,
  };
}

async function ensureRadiologyImagingType(
  d1: D1Database,
  tenantId: string,
  userId: string,
  name: string | null,
): Promise<number> {
  const typeName = cleanText(name) ?? 'General Radiology';
  const existing = await d1.prepare(`
    SELECT id FROM radiology_imaging_types
    WHERE tenant_id = ? AND LOWER(name) = LOWER(?) AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(tenantId, typeName).first<{ id: number }>();
  if (existing?.id) return Number(existing.id);

  const code = typeName.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'RAD';
  const result = await d1.prepare(`
    INSERT INTO radiology_imaging_types (tenant_id, name, code, description, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tenantId, typeName, code, 'Created from billing catalog', userId).run();
  return Number(result.meta.last_row_id);
}

export async function syncDiagnosticCatalogFromBillingServiceItem(
  d1: D1Database,
  tenantId: string,
  serviceItemId: number,
  userId: string,
  options: DiagnosticCatalogSyncOptions = {},
): Promise<DiagnosticCatalogKind | null> {
  const service = await d1.prepare(`
    SELECT si.id, si.item_name, si.item_code, si.service_department_id, si.price, si.description,
           si.is_active, sd.department_code, sd.department_name
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON sd.id = si.service_department_id AND sd.tenant_id = si.tenant_id
    WHERE si.id = ? AND si.tenant_id = ?
    LIMIT 1
  `).bind(serviceItemId, tenantId).first<DiagnosticBillingServiceRow>();

  if (!service?.department_code) return null;
  const kind = service.department_code === 'LAB'
    ? 'lab'
    : service.department_code === 'RAD'
      ? 'radiology'
      : null;
  if (!kind) return null;

  let code = normalizeCode(service.item_code ?? '');
  if (!code) {
    code = `${service.department_code}-${serviceItemId}`;
    await d1.prepare(`
      UPDATE billing_service_items
      SET item_code = ?, updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(code, serviceItemId, tenantId).run();
  }

  if (kind === 'lab') {
    const commissionableValue = options.isCommissionable === undefined
      ? null
      : options.isCommissionable ? 1 : 0;
    await ensureLabTestCategory(d1, tenantId, userId, cleanText(service.description) ?? service.department_name ?? 'Laboratory');

    const existing = await d1.prepare(`
      SELECT id FROM lab_test_catalog
      WHERE tenant_id = ?
        AND (billing_service_item_id = ? OR code = ?)
      ORDER BY CASE WHEN billing_service_item_id = ? THEN 0 ELSE 1 END
      LIMIT 1
    `).bind(tenantId, serviceItemId, code, serviceItemId).first<{ id: number }>();

    if (existing?.id) {
      await d1.prepare(`
        UPDATE lab_test_catalog
        SET code = ?, name = ?, category = ?, price = ?, is_active = ?, billing_service_item_id = ?,
            is_commissionable = CASE WHEN ? IS NULL THEN is_commissionable ELSE ? END
        WHERE id = ? AND tenant_id = ?
      `).bind(
        code,
        service.item_name,
        cleanText(service.description) ?? service.department_name ?? 'Laboratory',
        Number(service.price ?? 0),
        Number(service.is_active ?? 1) ? 1 : 0,
        serviceItemId,
        commissionableValue,
        commissionableValue,
        existing.id,
        tenantId,
      ).run();
    } else {
      await d1.prepare(`
        INSERT INTO lab_test_catalog
          (code, name, category, price, is_active, is_commissionable, tenant_id, billing_service_item_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        code,
        service.item_name,
        cleanText(service.description) ?? service.department_name ?? 'Laboratory',
        Number(service.price ?? 0),
        Number(service.is_active ?? 1) ? 1 : 0,
        commissionableValue ?? 1,
        tenantId,
        serviceItemId,
      ).run();
    }
    return kind;
  }

  const imagingTypeId = await ensureRadiologyImagingType(d1, tenantId, userId, cleanText(service.description));
  const existing = await d1.prepare(`
    SELECT id FROM radiology_imaging_items
    WHERE tenant_id = ?
      AND (billing_service_item_id = ? OR procedure_code = ?)
    ORDER BY CASE WHEN billing_service_item_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(tenantId, serviceItemId, code, serviceItemId).first<{ id: number }>();

  if (existing?.id) {
    await d1.prepare(`
      UPDATE radiology_imaging_items
      SET imaging_type_id = ?,
          name = ?,
          procedure_code = ?,
          price_paisa = ?,
          is_active = ?,
          billing_service_item_id = ?,
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(
      imagingTypeId,
      service.item_name,
      code,
      Math.round(Number(service.price ?? 0) * 100),
      Number(service.is_active ?? 1) ? 1 : 0,
      serviceItemId,
      existing.id,
      tenantId,
    ).run();
  } else {
    await d1.prepare(`
      INSERT INTO radiology_imaging_items
        (tenant_id, imaging_type_id, name, procedure_code, price_paisa, is_active, billing_service_item_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      imagingTypeId,
      service.item_name,
      code,
      Math.round(Number(service.price ?? 0) * 100),
      Number(service.is_active ?? 1) ? 1 : 0,
      serviceItemId,
      userId,
    ).run();
  }

  return kind;
}
