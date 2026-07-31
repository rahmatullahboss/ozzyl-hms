import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { syncDiagnosticCatalogFromBillingServiceItem } from '../../lib/diagnostic-catalog';
import { getTodayGMT6 } from '../../lib/date-utils';
import { auditRequestMetadata, prepareMasterDataAudit } from '../../lib/master-data-audit';
import { createSourceEvidenceSha256 } from '../../lib/canonical/source-mapping';
import {
  buildPatientImportRouteContext,
  createImportedPatient,
} from '../../lib/canonical/patient-import-route-integration';
import {
  applyBillingServiceCatalogMutation,
  billingPriceMapCanonicalSourceKey,
  billingServiceCanonicalSourceKey,
} from '../../lib/canonical/service-catalog-route-integration';

const settingsImportExport = new Hono<{ Bindings: Env; Variables: Variables }>();

// CSV utilities (from inventory/importExport.ts pattern)
function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.map(csvEscape).join(','),
    ...rows.map(row => headers.map(h => csvEscape(row[h])).join(',')),
  ].join('\n');
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current.trim()); current = ''; }
      else { current += ch; }
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

async function extractCsv(c: any): Promise<string> {
  const contentType = c.req.header('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;
    if (!file) throw new HTTPException(400, { message: 'No file provided' });
    return file.text();
  }

  const body = await c.req.json() as { csv?: string };
  if (!body.csv) throw new HTTPException(400, { message: 'CSV data is required' });
  return body.csv;
}

function pick(row: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function parseMoney(value: string): number {
  if (!value) return 0;
  const normalized = value
    .replace(/৳/g, '')
    .replace(/BDT/gi, '')
    .replace(/Tk\.?/gi, '')
    .replace(/Taka/gi, '')
    .replace(/\/-/g, '')
    .replace(/,/g, '')
    .trim();
  if (!normalized) return 0;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Invalid price '${value}'`);
  }
  return amount;
}

function parseBool(value: string, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'active', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'inactive', 'disabled'].includes(normalized)) return false;
  return fallback;
}

function normalizeDepartmentCode(raw: string): string {
  const code = (raw || 'GENERAL').trim().toUpperCase().replace(/\s+/g, '-');
  const aliases: Record<string, string> = {
    GENERAL: 'GENERAL',
    SERVICE: 'SERV',
    SERVICES: 'SERV',
    HOSPITAL: 'SERV',
    LABORATORY: 'LAB',
    PATHOLOGY: 'LAB',
    RADIOLOGY: 'RAD',
    IMAGING: 'RAD',
    XRAY: 'RAD',
    'X-RAY': 'RAD',
    USG: 'RAD',
    IPD: 'IPD',
    ADMISSION: 'IPD',
    CABIN: 'BED',
    BED: 'BED',
    OT: 'OT',
    OPERATION: 'OT',
    'OPERATION-THEATRE': 'OT',
    DELIVERY: 'DELIVERY',
    BLOOD: 'BLOOD',
    'BLOOD-BANK': 'BLOOD',
  };
  return aliases[code] ?? code;
}

function departmentNameFor(code: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  const names: Record<string, string> = {
    GENERAL: 'General Services',
    SERV: 'Hospital Services',
    LAB: 'Laboratory',
    RAD: 'Radiology',
    IPD: 'IPD Services',
    BED: 'Bed & Cabin Charges',
    OT: 'Operation Theatre',
    DELIVERY: 'Delivery Services',
    BLOOD: 'Blood Bank',
  };
  return names[code] ?? code.replace(/-/g, ' ');
}

async function ensureServiceDepartment(
  d1: D1Database,
  tenantId: string,
  deptCode: string,
  deptName?: string,
): Promise<number> {
  const existing = await d1.prepare(`
    SELECT id FROM billing_service_departments
    WHERE tenant_id = ?
      AND upper(trim(COALESCE(department_code, ''))) = ?
    ORDER BY COALESCE(is_active, 1) DESC, id ASC
    LIMIT 1
  `).bind(tenantId, deptCode).first<{ id: number }>();
  if (existing?.id) return Number(existing.id);

  const result = await d1.prepare(`
    INSERT INTO billing_service_departments
      (department_name, department_code, is_active, tenant_id)
    VALUES (?, ?, 1, ?)
  `).bind(departmentNameFor(deptCode, deptName), deptCode, tenantId).run();
  return Number(result.meta.last_row_id);
}

async function ensureDefaultPriceCategory(d1: D1Database, tenantId: string): Promise<number> {
  await d1.prepare(`
    INSERT INTO price_categories
      (tenant_id, category_name, category_code, description, is_default, is_active, created_at)
    SELECT ?, 'Normal', 'NOR', 'Standard price', 1, 1, datetime('now', '+6 hours')
    WHERE NOT EXISTS (
      SELECT 1 FROM price_categories
      WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1
    )
  `).bind(tenantId, tenantId).run();

  const category = await d1.prepare(`
    SELECT id FROM price_categories
    WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1
    ORDER BY COALESCE(is_default, 0) DESC, id ASC
    LIMIT 1
  `).bind(tenantId).first<{ id: number }>();

  if (!category?.id) throw new HTTPException(500, { message: 'Default billing price category is not configured' });
  return Number(category.id);
}


// ─── Import Services ────────────────────────────────────────────────
settingsImportExport.post('/import/services', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const csvText = await extractCsv(c);

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new HTTPException(400, { message: 'No data rows found in CSV' });
  }

  const suppliedBatchKey = c.req.header('Idempotency-Key')?.trim() || null;
  const batchSourceKey = await createSourceEvidenceSha256({
    sourceType: 'settings_service_import_csv',
    tenantId,
    importKey: suppliedBatchKey ?? csvText,
  });
  const defaultPriceCategoryId = await ensureDefaultPriceCategory(c.env.DB, tenantId);
  let success = 0;
  let created = 0;
  let updated = 0;
  let failed = 0;
  const errors: string[] = [];
  const userId = String(c.get('userId') ?? '0');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const name = pick(row, ['name', 'service_name', 'ServiceName', 'item_name', 'ItemName', 'description', 'Description']);
      const code = pick(row, ['code', 'service_code', 'ServiceCode', 'item_code', 'ItemCode']);
      const deptCode = normalizeDepartmentCode(pick(row, ['department', 'department_code', 'Department', 'DepartmentCode']) || 'GENERAL');
      const deptName = pick(row, ['department_name', 'DepartmentName']);
      const price = parseMoney(pick(row, ['price', 'rate', 'Rate', 'RATE', 'taka', 'Taka', 'amount', 'Amount']));
      const taxApplicable = parseBool(pick(row, ['tax_applicable', 'TaxApplicable']), false);
      const taxPercent = parseMoney(pick(row, ['tax_percent', 'TaxPercent'])) || 0;
      const allowDiscount = parseBool(pick(row, ['allow_discount', 'AllowDiscount']), true);
      const allowMultipleQty = parseBool(pick(row, ['allow_multiple_qty', 'AllowMultipleQty']), true);
      const isActive = parseBool(pick(row, ['is_active', 'IsActive', 'active', 'Active']), true);

      if (!name) { failed++; errors.push(`Row ${i + 2}: Missing service name`); continue; }

      const deptId = await ensureServiceDepartment(c.env.DB, tenantId, deptCode, deptName);
      const existing = code
        ? await db.$client.prepare(`
            SELECT id,canonical_source_key FROM billing_service_items
            WHERE tenant_id = ? AND lower(trim(COALESCE(item_code, ''))) = lower(trim(?))
            LIMIT 1
          `).bind(tenantId, code).first<{ id: number; canonical_source_key: string | null }>()
        : await db.$client.prepare(`
            SELECT id,canonical_source_key FROM billing_service_items
            WHERE tenant_id = ?
              AND service_department_id = ?
              AND lower(trim(item_name)) = lower(trim(?))
            LIMIT 1
          `).bind(tenantId, deptId, name).first<{ id: number; canonical_source_key: string | null }>();

      let serviceItemId = Number(existing?.id ?? 0);
      if (serviceItemId <= 0) {
        const next = await c.env.DB.prepare(`
          SELECT COALESCE(MAX(id),0)+1 AS next_id FROM billing_service_items
        `).first<{ next_id: number }>();
        serviceItemId = Number(next?.next_id ?? 0);
        if (!Number.isSafeInteger(serviceItemId) || serviceItemId <= 0) {
          throw new Error('Unable to allocate service item identity');
        }
      }
      const canonicalSourceKey = existing?.canonical_source_key || billingServiceCanonicalSourceKey(serviceItemId);
      const priceMapSourceKey = billingPriceMapCanonicalSourceKey(serviceItemId, defaultPriceCategoryId);
      const occurredAtUtc = new Date().toISOString();
      const authoritativeStatements = [];
      if (existing?.id) {
        authoritativeStatements.push(c.env.DB.prepare(`
          UPDATE billing_service_items
          SET item_name=?,item_code=?,service_department_id=?,price=?,tax_applicable=?,tax_percent=?,
              allow_discount=?,allow_multiple_qty=?,is_active=?,canonical_source_key=?,
              updated_at=datetime('now', '+6 hours')
          WHERE id=? AND tenant_id=?
        `).bind(
          name,
          code || null,
          deptId,
          price,
          taxApplicable ? 1 : 0,
          taxPercent,
          allowDiscount ? 1 : 0,
          allowMultipleQty ? 1 : 0,
          isActive ? 1 : 0,
          canonicalSourceKey,
          serviceItemId,
          tenantId,
        ));
      } else {
        authoritativeStatements.push(c.env.DB.prepare(`
          INSERT INTO billing_service_items (
            id,item_name,item_code,service_department_id,price,tax_applicable,tax_percent,
            allow_discount,allow_multiple_qty,is_active,tenant_id,canonical_source_key,created_by,
            created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', '+6 hours'),datetime('now', '+6 hours'))
        `).bind(
          serviceItemId,
          name,
          code || null,
          deptId,
          price,
          taxApplicable ? 1 : 0,
          taxPercent,
          allowDiscount ? 1 : 0,
          allowMultipleQty ? 1 : 0,
          isActive ? 1 : 0,
          tenantId,
          canonicalSourceKey,
          userId === '0' ? null : userId,
        ));
      }
      authoritativeStatements.push(c.env.DB.prepare(`
        INSERT INTO billing_item_price_category_maps (
          tenant_id,service_item_id,price_category_id,price,is_discount_applicable,is_active,
          canonical_source_key,created_at,updated_at
        ) VALUES (?,?,?,?,?,1,?,datetime('now', '+6 hours'),datetime('now', '+6 hours'))
        ON CONFLICT(tenant_id,service_item_id,price_category_id)
        DO UPDATE SET price=excluded.price,
                      is_discount_applicable=excluded.is_discount_applicable,
                      is_active=1,
                      canonical_source_key=COALESCE(billing_item_price_category_maps.canonical_source_key, excluded.canonical_source_key),
                      updated_at=datetime('now', '+6 hours')
      `).bind(
        tenantId,
        serviceItemId,
        defaultPriceCategoryId,
        price,
        allowDiscount ? 1 : 0,
        priceMapSourceKey,
      ));

      await applyBillingServiceCatalogMutation(c.env.DB, {
        tenantId,
        canonicalSourceKey,
        snapshot: {
          serviceItemId,
          itemName: name,
          itemCode: code || null,
          departmentCode: deptCode,
          price,
          isActive,
        },
        defaultPriceCategoryId,
        occurredAtUtc,
        businessDate: getTodayGMT6(),
        idempotencyKey: `route:service-catalog:settings-import:${suppliedBatchKey ?? batchSourceKey}:${i + 2}`,
      }, { authoritativeStatements });
      if (existing?.id) updated++;
      else created++;

      if (deptCode === 'LAB' || deptCode === 'RAD') {
        await syncDiagnosticCatalogFromBillingServiceItem(c.env.DB, tenantId, serviceItemId, userId);
      }

      success++;
    } catch (err) {
      failed++;
      errors.push(`Row ${i + 2}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return c.json({ success, created, updated, failed, errors: errors.slice(0, 20) });
});

// ─── Import Medicines ───────────────────────────────────────────────
settingsImportExport.post('/import/medicines', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const csvText = await extractCsv(c);

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new HTTPException(400, { message: 'No data rows found in CSV' });
  }

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const name = row.name || row.medicine_name || row.ItemName || row.item_name;
      const generic = row.generic || row.generic_name || row.GenericName;
      const company = row.company || row.manufacturer || row.BrandName;
      const price = Number(row.price || row.StandardRate || 0);

      if (!name) { failed++; errors.push(`Row ${i + 2}: Missing medicine name`); continue; }

      await db.$client.prepare(
        `INSERT INTO InventoryItem (tenant_id, ItemName, ItemType, GenericName, BrandName, StandardRate, IsActive)
         VALUES (?, ?, 'medicine', ?, ?, ?, 1)`
      ).bind(tenantId, name, generic || null, company || null, price).run();

      success++;
    } catch (err) {
      failed++;
      errors.push(`Row ${i + 2}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return c.json({ success, failed, errors: errors.slice(0, 20) });
});

// ─── Import Patients ────────────────────────────────────────────────
settingsImportExport.post('/import/patients', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const csvText = await extractCsv(c);

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new HTTPException(400, { message: 'No data rows found in CSV' });
  }

  const suppliedBatchKey = c.req.header('Idempotency-Key')?.trim() || null;
  const batchSourceKey = await createSourceEvidenceSha256({
    sourceType: 'settings_patient_import_csv',
    tenantId,
    importKey: suppliedBatchKey ?? csvText,
  });
  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const name = row.name || row.patient_name || row.PatientName;
      const mobile = row.phone || row.mobile || row.Mobile || row.PhoneNumber;
      const gender = row.gender || row.Gender || 'other';
      const dob = row.dob || row.date_of_birth || row.DateOfBirth;
      const address = row.address || row.Address || '';
      const fatherHusband = row.father || row.father_husband || row.guardian || '';

      if (!name) { failed++; errors.push(`Row ${i + 2}: Missing patient name`); continue; }
      if (!mobile) { failed++; errors.push(`Row ${i + 2}: Missing mobile number`); continue; }

      const sourcePublicId = `patient-import:${batchSourceKey}:row:${i + 2}`;
      const context = await buildPatientImportRouteContext(c.env.DB, {
        tenantId,
        sourcePublicId,
        row: {
          name,
          mobile,
          fatherHusband,
          address,
          gender,
          dateOfBirth: dob || null,
        },
      });
      const legacyInsert = c.env.DB.prepare(`
        INSERT INTO patients (
          id,name,mobile,father_husband,address,gender,date_of_birth,tenant_id,canonical_source_key
        ) VALUES (?,?,?,?,?,?,?,?,?)
      `).bind(
        context.legacyPatientId,
        context.row.name,
        context.row.mobile,
        context.row.fatherHusband,
        context.row.address,
        context.row.gender,
        context.row.dateOfBirth,
        tenantId,
        sourcePublicId,
      );
      const audit = prepareMasterDataAudit(c.env.DB, {
        tenantId,
        userId,
        action: 'CREATE',
        tableName: 'patients',
        recordId: sourcePublicId,
        oldValue: null,
        newValue: {
          legacyPatientId: context.legacyPatientId,
          canonicalSourceKey: sourcePublicId,
          importRow: i + 2,
        },
        ...auditRequestMetadata(c),
      });
      await createImportedPatient(c.env.DB, context, {
        authoritativeStatements: [legacyInsert, audit],
        actorUserId: Number(userId),
        occurredAtUtc: new Date().toISOString(),
        businessDate: getTodayGMT6(),
        idempotencyKey: `route:patient-import:${batchSourceKey}:row:${i + 2}`,
      });

      success++;
    } catch (err) {
      failed++;
      errors.push(`Row ${i + 2}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return c.json({ success, failed, errors: errors.slice(0, 20) });
});

// ─── Export Patients ────────────────────────────────────────────────
settingsImportExport.post('/export/patients', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const format = c.req.query('format') || 'csv';

  const { results } = await db.$client.prepare(
    `SELECT id, name, mobile, gender, date_of_birth, email, address, created_at
     FROM patients WHERE tenant_id = ? ORDER BY name`
  ).bind(tenantId).all();

  if (format === 'json') return c.json({ data: results });

  return new Response(toCsv((results || []) as Record<string, unknown>[]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="patients-export.csv"',
    },
  });
});

// ─── Export Billing ─────────────────────────────────────────────────
settingsImportExport.post('/export/billing', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const format = c.req.query('format') || 'csv';

  const { results } = await db.$client.prepare(
    `SELECT b.id, b.invoice_no, p.name as patient_name, b.total,
            b.discount, b.paid, b.due, b.status, b.created_at
     FROM bills b
     LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
     WHERE b.tenant_id = ?
     ORDER BY b.created_at DESC`
  ).bind(tenantId).all();

  if (format === 'json') return c.json({ data: results });

  return new Response(toCsv((results || []) as Record<string, unknown>[]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="billing-export.csv"',
    },
  });
});

// ─── Export Lab Reports ─────────────────────────────────────────────
settingsImportExport.post('/export/lab', async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const format = c.req.query('format') || 'csv';

  const { results } = await db.$client.prepare(
    `SELECT t.id, p.name as patient_name, t.test_name, t.status,
            t.result, t.date, t.created_at
     FROM tests t
     LEFT JOIN patients p ON p.id = t.patient_id AND p.tenant_id = t.tenant_id
     WHERE t.tenant_id = ?
     ORDER BY t.created_at DESC`
  ).bind(tenantId).all();

  if (format === 'json') return c.json({ data: results });

  return new Response(toCsv((results || []) as Record<string, unknown>[]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="lab-reports-export.csv"',
    },
  });
});

// ─── Sample Templates ───────────────────────────────────────────────
const SAMPLE_TEMPLATES: Record<string, string> = {
  services: 'name,code,department,price,allow_discount,allow_multiple_qty\nGeneral Consultation,CONSULT-001,GENERAL,300,yes,yes\nBlood Test,LAB-001,LAB,500,yes,yes\nX-Ray,XRAY-001,RAD,600,yes,yes',
  medicines: 'name,generic,company,price\nParacetamol 500mg,Paracetamol,Square,2.50\nAmoxicillin 250mg,Amoxicillin,Renata,5.00\nOmeprazole 20mg,Omeprazole,Eskayef,3.00',
  patients: 'name,phone,gender,dob,address,father\nJohn Doe,01712345678,male,1990-01-15,Dhaka Bangladesh,Robert Doe\nJane Doe,01812345679,female,1985-05-20,Chittagong Bangladesh,Robert Doe',
};

settingsImportExport.get('/import/:type/sample', async (c) => {
  const type = c.req.param('type');
  const template = SAMPLE_TEMPLATES[type];

  if (!template) {
    throw new HTTPException(404, { message: 'Sample template not found' });
  }

  return new Response(template, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${type}-sample.csv"`,
    },
  });
});

export default settingsImportExport;
