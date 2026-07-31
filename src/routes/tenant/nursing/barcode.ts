import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { requireRole, NURSING_ROLES } from '../../../middleware/rbac';
import type { D1Database } from '@cloudflare/workers-types';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const barcodeRoutes = new Hono<NursingEnv>();

// ─── RBAC: Restrict barcode endpoints to nursing staff ───────────────────────
barcodeRoutes.use('/*', requireRole(...NURSING_ROLES));

const ALLOWED_TABLES = new Set(['patients', 'formulary_items', 'beds']);

async function hasColumn(db: D1Database, table: string, column: string): Promise<boolean> {
  if (!ALLOWED_TABLES.has(table)) return false;
  try {
    const cols = await db.prepare('SELECT name FROM pragma_table_info(?)').bind(table).all<{ name: string }>();
    return (cols.results || []).some(r => r.name === column);
  } catch {
    return false;
  }
}

// GET /barcode/patient/:code — look up patient by wristband barcode
barcodeRoutes.get('/patient/:code', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const code = c.req.param('code');

  if (!code || code.trim().length === 0) {
    throw new HTTPException(400, { message: 'Barcode code is required' });
  }

  const hasWristband = await hasColumn(db.$client, 'patients', 'wristband_barcode');

  const query = hasWristband
    ? `SELECT id AS patient_id, patient_code, name FROM patients WHERE tenant_id = ? AND (patient_code = ? OR wristband_barcode = ?) AND is_active = 1 LIMIT 1`
    : `SELECT id AS patient_id, patient_code, name FROM patients WHERE tenant_id = ? AND patient_code = ? AND is_active = 1 LIMIT 1`;

  const params = hasWristband ? [tenantId, code.trim(), code.trim()] : [tenantId, code.trim()];

  const patient = await db.$client.prepare(query).bind(...params).first<{
    patient_id: number;
    patient_code: string;
    name: string;
  }>();

  if (!patient) {
    throw new HTTPException(404, { message: 'Patient not found for this barcode' });
  }

  return c.json(patient);
});

// GET /barcode/medicine/:code — look up medicine by barcode (future use)
barcodeRoutes.get('/medicine/:code', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const code = c.req.param('code');

  if (!code || code.trim().length === 0) {
    throw new HTTPException(400, { message: 'Barcode code is required' });
  }

  const hasBarcode = await hasColumn(db.$client, 'formulary_items', 'barcode');

  if (!hasBarcode) {
    throw new HTTPException(404, { message: 'Medicine barcode lookup not available' });
  }

  const medicine = await db.$client.prepare(`
    SELECT id, name, generic_name, strength, dosage_form, barcode
    FROM formulary_items
    WHERE tenant_id = ? AND barcode = ? AND is_active = 1
    LIMIT 1
  `).bind(tenantId, code.trim()).first<{
    id: number;
    name: string;
    generic_name: string;
    strength: string;
    dosage_form: string;
    barcode: string;
  }>();

  if (!medicine) {
    throw new HTTPException(404, { message: 'Medicine not found for this barcode' });
  }

  return c.json(medicine);
});
