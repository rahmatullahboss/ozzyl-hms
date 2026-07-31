import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getPagination, paginationMeta } from '../../lib/pagination';
import {
  createFormularyCategorySchema,
  updateFormularyCategorySchema,
  createFormularyItemSchema,
  updateFormularyItemSchema,
  createDrugInteractionSchema,
  addPatientMedicationSchema,
  updatePatientMedicationSchema,
  safetyCheckRequestSchema,
  safetyCheckOverrideSchema,
} from '../../schemas/ePrescribing';
import { clinicalReviewSchema } from '../../schemas/clinical-review';
import { getDb } from '../../db';
import { evaluateMedicationSafety, normalizeMedicationName } from '../../lib/drug-safety';
import { fetchAndCacheMedexMedicines } from '../../lib/medicine-external-lookup';
import { recordLocalSyncOutboxEvent } from '../../lib/local-sync-outbox';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Parse and validate integer ID from URL params
// ═══════════════════════════════════════════════════════════════════════════════

function parseId(value: string, label = 'ID'): number {
  const id = parseInt(value, 10);
  if (isNaN(id) || id <= 0) throw new HTTPException(400, { message: `Invalid ${label}: must be a positive integer` });
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Require clinical role for mutations
// ═══════════════════════════════════════════════════════════════════════════════

const CLINICAL_WRITE_ROLES = ['doctor', 'md', 'pharmacist', 'hospital_admin'];

function requireClinicalRole(c: any): void {
  const role = c.get('role');
  if (!role || !CLINICAL_WRITE_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Insufficient permissions: clinical write access required' });
  }
}

function isMissingTableError(error: unknown, tableName: string): boolean {
  return error instanceof Error && error.message.toLowerCase().includes(`no such table: ${tableName.toLowerCase()}`);
}

function medicineCatalogEntityId(input: {
  name: string;
  generic: string | null;
  manufacturer: string | null;
  strength: string | null;
  dosage_form: string | null;
}): string {
  return [
    input.name,
    input.generic ?? '',
    input.manufacturer ?? '',
    input.strength ?? '',
    input.dosage_form ?? '',
  ].join('|').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || crypto.randomUUID();
}

async function recordMedicineCatalogSyncEvents(c: any, tenantId: string, rows: Awaited<ReturnType<typeof fetchAndCacheMedexMedicines>>) {
  if (c.env.ENVIRONMENT !== 'local_server') return;

  for (const row of rows) {
    await recordLocalSyncOutboxEvent(c.env, {
      tenantId,
      entityType: 'medicine_catalog_entry',
      entityId: medicineCatalogEntityId(row),
      operation: 'upsert',
      payload: {
        source: row.source,
        brand_name: row.name,
        generic_name: row.generic,
        manufacturer: row.manufacturer,
        strength: row.strength,
        dosage_form: row.dosage_form,
      },
    });
  }
}

type MedicineSearchResult = {
  name: string;
  generic: string | null;
  manufacturer: string | null;
  strength: string | null;
  dosage_form: string | null;
  default_frequency: string | null;
  default_duration: string | null;
  default_instructions: string | null;
  medicine_id: number | null;
  source: 'local' | 'seed' | 'bd_master' | 'doctor_usage' | 'medex';
};

async function resolveFrequentDoctorId(c: any, db: ReturnType<typeof getDb>, tenantId: string): Promise<number | null> {
  const queryDoctorId = c.req.query('doctorId');
  if (queryDoctorId) {
    const parsed = Number(queryDoctorId);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    const role = c.get('role');
    if (role === 'doctor') {
      const linkedDoctor = await db.$client.prepare(
        'SELECT id FROM doctors WHERE user_id = ? AND tenant_id = ? AND is_active = 1'
      ).bind(requireUserId(c), tenantId).first<{ id: number }>();
      if (!linkedDoctor?.id || Number(linkedDoctor.id) !== parsed) {
        throw new HTTPException(403, { message: 'Cannot read another doctor frequent medicines' });
      }
    } else if (!['hospital_admin', 'md'].includes(String(role ?? ''))) {
      throw new HTTPException(403, { message: 'Cannot query another doctor frequent medicines' });
    }
    return parsed;
  }

  const userId = c.get('userId');
  if (!userId) return null;

  const linkedDoctor = await db.$client.prepare(
    'SELECT id FROM doctors WHERE user_id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(userId, tenantId).first<{ id: number }>();
  return linkedDoctor?.id ? Number(linkedDoctor.id) : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER: Ensure seed data is cloned to tenant on first use
// ═══════════════════════════════════════════════════════════════════════════════

async function ensureSeedData(db: D1Database, tenantId: string): Promise<void> {
  // Check if tenant already has interaction data
  const existing = await db.prepare(
    'SELECT COUNT(*) as count FROM drug_interaction_pairs WHERE tenant_id = ?'
  ).bind(tenantId).first<{ count: number }>();

  if (existing && existing.count > 0) return;

  // Clone seed data for this tenant using INSERT OR IGNORE to handle race conditions
  // (UNIQUE indexes on tenant_id+drug_a_name+drug_b_name and tenant_id+name prevent duplicates)
  await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO drug_interaction_pairs (tenant_id, drug_a_name, drug_b_name, severity, description, recommendation, evidence_level, is_active)
      SELECT ?, drug_a_name, drug_b_name, severity, description, recommendation, evidence_level, is_active
      FROM drug_interaction_pairs WHERE tenant_id = '__seed__'
    `).bind(tenantId),
    db.prepare(`
      INSERT OR IGNORE INTO formulary_categories (tenant_id, name, description, sort_order, is_active)
      SELECT ?, name, description, sort_order, is_active
      FROM formulary_categories WHERE tenant_id = '__seed__'
    `).bind(tenantId),
    db.prepare(`
      INSERT OR IGNORE INTO formulary_items (
        tenant_id, name, generic_name, category_id, strength, dosage_form, route,
        manufacturer, common_dosages, default_frequency, default_duration, max_daily_dose_mg,
        default_instructions, is_antibiotic, is_controlled, requires_prior_auth, unit_price, medicine_id, is_active
      )
      SELECT
        ?, name, generic_name, category_id, strength, dosage_form, route,
        manufacturer, common_dosages, default_frequency, default_duration, max_daily_dose_mg,
        default_instructions, is_antibiotic, is_controlled, requires_prior_auth, unit_price, medicine_id, is_active
      FROM formulary_items WHERE tenant_id = '__seed__'
    `).bind(tenantId),
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMULARY CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/e-prescribing/formulary/categories
app.get('/formulary/categories', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  await ensureSeedData(c.env.DB, tenantId);

  const { results } = await db.$client.prepare(`
    SELECT fc.*, (SELECT COUNT(*) FROM formulary_items fi WHERE fi.category_id = fc.id AND fi.tenant_id = fc.tenant_id) as item_count
    FROM formulary_categories fc
    WHERE fc.tenant_id = ? AND fc.is_active = 1
    ORDER BY fc.sort_order, fc.name
  `).bind(tenantId).all();

  return c.json({ categories: results });
});

// POST /api/e-prescribing/formulary/categories
app.post('/formulary/categories', zValidator('json', createFormularyCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireClinicalRole(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO formulary_categories (tenant_id, name, description, parent_id, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tenantId, data.name, data.description ?? null, data.parent_id ?? null, data.sort_order).run();

  return c.json({ id: result.meta.last_row_id, message: 'Category created' }, 201);
});

// PUT /api/e-prescribing/formulary/categories/:id
app.put('/formulary/categories/:id', zValidator('json', updateFormularyCategorySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireClinicalRole(c);
  const id = parseId(c.req.param('id'), 'Category ID');
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM formulary_categories WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Category not found' });

  const sets: string[] = ["updated_at = datetime('now', '+6 hours')"];
  const vals: (string | number | null)[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.description !== undefined) { sets.push('description = ?'); vals.push(data.description); }
  if (data.sort_order !== undefined) { sets.push('sort_order = ?'); vals.push(data.sort_order); }

  vals.push(id, tenantId);
  await db.$client.prepare(
    `UPDATE formulary_categories SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  return c.json({ success: true, message: 'Category updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FORMULARY ITEMS (Drug Catalog)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/e-prescribing/formulary/search
app.get('/formulary/search', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  await ensureSeedData(c.env.DB, tenantId);
  const search = (c.req.query('q') || '').trim();
  
  if (!search || search.length < 2) return c.json({ medicines: [] });

  const { results: formularyRows } = await db.$client.prepare(`
    SELECT name, generic_name, manufacturer, strength, dosage_form, default_frequency, default_duration, default_instructions, medicine_id, tenant_id
    FROM formulary_items
    WHERE tenant_id IN (?, '__seed__')
      AND is_active = 1
      AND (name LIKE ? OR generic_name LIKE ? OR manufacturer LIKE ?)
    ORDER BY
      CASE WHEN tenant_id = ? THEN 0 ELSE 1 END,
      CASE WHEN LOWER(name) = LOWER(?) THEN 0 WHEN LOWER(name) LIKE LOWER(?) THEN 1 ELSE 2 END,
      name ASC
    LIMIT 25
  `).bind(tenantId, `%${search}%`, `%${search}%`, `%${search}%`, tenantId, search, `${search}%`).all<{
    name: string;
    generic_name: string | null;
    manufacturer: string | null;
    strength: string | null;
    dosage_form: string | null;
    default_frequency: string | null;
    default_duration: string | null;
    default_instructions: string | null;
    medicine_id: number | null;
    tenant_id: string;
  }>();

  const medicines: MedicineSearchResult[] = (formularyRows ?? []).map((row) => ({
    name: row.name,
    generic: row.generic_name,
    manufacturer: row.manufacturer,
    strength: row.strength,
    dosage_form: row.dosage_form,
    default_frequency: row.default_frequency,
    default_duration: row.default_duration,
    default_instructions: row.default_instructions,
    medicine_id: row.medicine_id,
    source: row.tenant_id === tenantId ? 'local' : 'seed',
  }));

  if (medicines.length < 25) {
    try {
      const { results: masterRows } = await db.$client.prepare(`
        SELECT name, generic_name, manufacturer, strength, dosage_form
        FROM (
          SELECT
            d.brand_name AS name,
            g.name AS generic_name,
            co.name AS manufacturer,
            d.strength AS strength,
            d.form AS dosage_form,
            0 AS source_rank
          FROM master_drugs d
          LEFT JOIN master_generics g ON d.generic_id = g.id
          LEFT JOIN master_companies co ON d.company_id = co.id
          WHERE d.brand_name LIKE ? || '%'
          UNION ALL
          SELECT
            d.brand_name AS name,
            g.name AS generic_name,
            co.name AS manufacturer,
            d.strength AS strength,
            d.form AS dosage_form,
            1 AS source_rank
          FROM master_generics g
          JOIN master_drugs d ON d.generic_id = g.id
          LEFT JOIN master_companies co ON d.company_id = co.id
          WHERE g.name LIKE ? || '%'
        )
        ORDER BY source_rank, name ASC, dosage_form ASC
        LIMIT ?
      `).bind(search, search, 25 - medicines.length).all<{
        name: string;
        generic_name: string | null;
        manufacturer: string | null;
        strength: string | null;
        dosage_form: string | null;
      }>();

      const seen = new Set(medicines.map((item) => [
        item.name,
        item.generic,
        item.manufacturer,
        item.strength,
        item.dosage_form,
      ].join('|').toLowerCase()));

      for (const row of masterRows ?? []) {
        const key = [row.name, row.generic_name, row.manufacturer, row.strength, row.dosage_form].join('|').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        medicines.push({
          name: row.name,
          generic: row.generic_name,
          manufacturer: row.manufacturer,
          strength: row.strength,
          dosage_form: row.dosage_form,
          default_frequency: null,
          default_duration: null,
          default_instructions: null,
          medicine_id: null,
          source: 'bd_master',
        });
      }
    } catch (error) {
      if (!isMissingTableError(error, 'master_drugs')) throw error;
    }
  }

  return c.json({
    medicines,
  });
});

// GET /api/e-prescribing/formulary/external-search
app.get('/formulary/external-search', async (c) => {
  requireClinicalRole(c);
  const tenantId = requireTenantId(c);
  const search = (c.req.query('q') || '').trim();
  if (search.length < 2) return c.json({ medicines: [] });

  const results = await fetchAndCacheMedexMedicines(c.env.DB, search);
  await recordMedicineCatalogSyncEvents(c, tenantId, results);
  return c.json({
    medicines: results.map((row) => ({
      name: row.name,
      generic: row.generic,
      manufacturer: row.manufacturer,
      strength: row.strength,
      dosage_form: row.dosage_form,
      default_frequency: null,
      default_duration: null,
      default_instructions: null,
      medicine_id: null,
      source: row.source,
    })),
  });
});

// GET /api/e-prescribing/formulary
app.get('/formulary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const search = c.req.query('search') || '';
  const categoryId = c.req.query('category_id');
  const { page, limit, offset } = getPagination(c);

  let whereClause = 'WHERE fi.tenant_id = ? AND fi.is_active = 1';
  const params: (string | number)[] = [tenantId];

  if (search) {
    whereClause += ' AND (fi.name LIKE ? OR fi.generic_name LIKE ? OR fi.manufacturer LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (categoryId) {
    whereClause += ' AND fi.category_id = ?';
    params.push(Number(categoryId));
  }

  const countResult = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM formulary_items fi ${whereClause}`
  ).bind(...params).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  const { results } = await db.$client.prepare(`
    SELECT fi.*, fc.name as category_name
    FROM formulary_items fi
    LEFT JOIN formulary_categories fc ON fi.category_id = fc.id AND fc.tenant_id = fi.tenant_id
    ${whereClause}
    ORDER BY fi.generic_name, fi.name
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ formulary: results, meta: paginationMeta(page, limit, total) });
});

// GET /api/e-prescribing/formulary/frequent
app.get('/formulary/frequent', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 8), 1), 20);
  const doctorId = await resolveFrequentDoctorId(c, db, tenantId);

  if (!doctorId) return c.json({ medicines: [] });

  const { results } = await db.$client.prepare(`
    SELECT medicine_name, generic_name, strength, dosage_form, manufacturer,
           default_frequency, default_duration, default_instructions, usage_count
    FROM prescription_medicine_usage_stats
    WHERE tenant_id = ? AND doctor_id = ?
    ORDER BY usage_count DESC, last_used_at DESC, medicine_name ASC
    LIMIT ?
  `).bind(tenantId, doctorId, limit).all<{
    medicine_name: string;
    generic_name: string | null;
    strength: string | null;
    dosage_form: string | null;
    manufacturer: string | null;
    default_frequency: string | null;
    default_duration: string | null;
    default_instructions: string | null;
    usage_count: number;
  }>();

  return c.json({
    medicines: (results ?? []).map((row) => ({
      name: row.medicine_name,
      generic: row.generic_name,
      manufacturer: row.manufacturer,
      strength: row.strength,
      dosage_form: row.dosage_form,
      default_frequency: row.default_frequency,
      default_duration: row.default_duration,
      default_instructions: row.default_instructions,
      medicine_id: null,
      usage_count: row.usage_count,
      source: 'doctor_usage',
    })),
  });
});

// GET /api/e-prescribing/formulary/:id
app.get('/formulary/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Formulary ID');

  const item = await db.$client.prepare(`
    SELECT fi.*, fc.name as category_name
    FROM formulary_items fi
    LEFT JOIN formulary_categories fc ON fi.category_id = fc.id AND fc.tenant_id = fi.tenant_id
    WHERE fi.id = ? AND fi.tenant_id = ?
  `).bind(id, tenantId).first();

  if (!item) throw new HTTPException(404, { message: 'Formulary item not found' });
  return c.json(item);
});

// POST /api/e-prescribing/formulary
app.post('/formulary', zValidator('json', createFormularyItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireClinicalRole(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO formulary_items (
      tenant_id, name, generic_name, category_id, strength, dosage_form, route,
      manufacturer, common_dosages, default_frequency, default_duration, max_daily_dose_mg,
      default_instructions, is_antibiotic, is_controlled, requires_prior_auth, unit_price, medicine_id, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.name, data.generic_name, data.category_id ?? null,
    data.strength ?? null, data.dosage_form ?? null, data.route ?? null,
    data.manufacturer ?? null,
    data.common_dosages ? JSON.stringify(data.common_dosages) : null,
    data.default_frequency ?? null, data.default_duration ?? null,
    data.max_daily_dose_mg ?? null, data.default_instructions ?? null,
    data.is_antibiotic ? 1 : 0, data.is_controlled ? 1 : 0,
    data.requires_prior_auth ? 1 : 0, data.unit_price, data.medicine_id ?? null, userId
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Formulary item added' }, 201);
});

// PUT /api/e-prescribing/formulary/:id
app.put('/formulary/:id', zValidator('json', updateFormularyItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireClinicalRole(c);
  const id = parseId(c.req.param('id'), 'Formulary ID');
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM formulary_items WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Formulary item not found' });

  const sets: string[] = ["updated_at = datetime('now', '+6 hours')"];
  const vals: (string | number | null)[] = [];

  if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name); }
  if (data.generic_name !== undefined) { sets.push('generic_name = ?'); vals.push(data.generic_name); }
  if (data.category_id !== undefined) { sets.push('category_id = ?'); vals.push(data.category_id); }
  if (data.strength !== undefined) { sets.push('strength = ?'); vals.push(data.strength); }
  if (data.dosage_form !== undefined) { sets.push('dosage_form = ?'); vals.push(data.dosage_form); }
  if (data.route !== undefined) { sets.push('route = ?'); vals.push(data.route); }
  if (data.manufacturer !== undefined) { sets.push('manufacturer = ?'); vals.push(data.manufacturer); }
  if (data.common_dosages !== undefined) { sets.push('common_dosages = ?'); vals.push(JSON.stringify(data.common_dosages)); }
  if (data.default_frequency !== undefined) { sets.push('default_frequency = ?'); vals.push(data.default_frequency); }
  if (data.default_duration !== undefined) { sets.push('default_duration = ?'); vals.push(data.default_duration); }
  if (data.max_daily_dose_mg !== undefined) { sets.push('max_daily_dose_mg = ?'); vals.push(data.max_daily_dose_mg); }
  if (data.default_instructions !== undefined) { sets.push('default_instructions = ?'); vals.push(data.default_instructions); }
  if (data.is_antibiotic !== undefined) { sets.push('is_antibiotic = ?'); vals.push(data.is_antibiotic ? 1 : 0); }
  if (data.is_controlled !== undefined) { sets.push('is_controlled = ?'); vals.push(data.is_controlled ? 1 : 0); }
  if (data.unit_price !== undefined) { sets.push('unit_price = ?'); vals.push(data.unit_price); }
  if (data.medicine_id !== undefined) { sets.push('medicine_id = ?'); vals.push(data.medicine_id); }

  vals.push(id, tenantId);
  await db.$client.prepare(
    `UPDATE formulary_items SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  return c.json({ success: true, message: 'Formulary item updated' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DRUG INTERACTION PAIRS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/e-prescribing/interactions
app.get('/interactions', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  await ensureSeedData(c.env.DB, tenantId);

  const search = c.req.query('search') || '';
  const severity = c.req.query('severity');
  const { page, limit, offset } = getPagination(c);

  let whereClause = 'WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];

  if (search) {
    whereClause += ' AND (drug_a_name LIKE ? OR drug_b_name LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (severity) {
    whereClause += ' AND severity = ?';
    params.push(severity);
  }

  const countResult = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM drug_interaction_pairs ${whereClause}`
  ).bind(...params).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  const { results } = await db.$client.prepare(`
    SELECT * FROM drug_interaction_pairs ${whereClause}
    ORDER BY CASE severity 
      WHEN 'contraindicated' THEN 1 WHEN 'major' THEN 2 
      WHEN 'moderate' THEN 3 WHEN 'minor' THEN 4 END,
    drug_a_name
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  return c.json({ interactions: results, meta: paginationMeta(page, limit, total) });
});

// POST /api/e-prescribing/interactions
app.post('/interactions', zValidator('json', createDrugInteractionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireClinicalRole(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Normalize to lowercase for matching
  const drugA = data.drug_a_name.toLowerCase().trim();
  const drugB = data.drug_b_name.toLowerCase().trim();

  // Check for duplicate (either direction)
  const duplicate = await db.$client.prepare(`
    SELECT id FROM drug_interaction_pairs
    WHERE tenant_id = ? AND is_active = 1
      AND ((drug_a_name = ? AND drug_b_name = ?) OR (drug_a_name = ? AND drug_b_name = ?))
  `).bind(tenantId, drugA, drugB, drugB, drugA).first();

  if (duplicate) throw new HTTPException(400, { message: 'This interaction pair already exists' });

  const result = await db.$client.prepare(`
    INSERT INTO drug_interaction_pairs (tenant_id, drug_a_name, drug_b_name, severity, description, recommendation, evidence_level, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, drugA, drugB, data.severity, data.description, data.recommendation ?? null, data.evidence_level ?? null, userId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Interaction pair added' }, 201);
});

// DELETE /api/e-prescribing/interactions/:id
app.delete('/interactions/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireClinicalRole(c);
  const id = parseId(c.req.param('id'), 'Interaction ID');

  const existing = await db.$client.prepare(
    'SELECT id FROM drug_interaction_pairs WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Interaction pair not found' });

  await db.$client.prepare(
    'UPDATE drug_interaction_pairs SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();

  return c.json({ success: true, message: 'Interaction pair removed' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PATIENT ACTIVE MEDICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/e-prescribing/patient/:patientId/medications
app.get('/patient/:patientId/medications', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseId(c.req.param('patientId'), 'Patient ID');
  const status = c.req.query('status') || 'active';

  const { results } = await db.$client.prepare(`
    SELECT pam.*, fi.name as formulary_name, fi.category_id,
           fc.name as category_name,
           s.name as prescribed_by_name
    FROM patient_active_medications pam
    LEFT JOIN formulary_items fi ON pam.formulary_item_id = fi.id AND fi.tenant_id = pam.tenant_id
    LEFT JOIN formulary_categories fc ON fi.category_id = fc.id AND fc.tenant_id = pam.tenant_id
    LEFT JOIN staff s ON pam.prescribed_by = s.id AND s.tenant_id = pam.tenant_id
    WHERE pam.tenant_id = ? AND pam.patient_id = ? AND pam.status = ? AND pam.is_active = 1
    ORDER BY pam.start_date DESC
  `).bind(tenantId, patientId, status).all();

  return c.json({
    medications: results,
    total: results.length,
    patient_id: patientId,
  });
});

// POST /api/e-prescribing/patient/:patientId/medications
app.post('/patient/:patientId/medications', zValidator('json', addPatientMedicationSchema.omit({ patient_id: true })), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireClinicalRole(c);
  const userId = requireUserId(c);
  const patientId = parseId(c.req.param('patientId'), 'Patient ID');
  const data = c.req.valid('json');

  // Validate patient exists
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // If formulary_item_id provided, fetch generic_name from formulary
  let genericName = data.generic_name ?? null;
  if (data.formulary_item_id && !genericName) {
    const fi = await db.$client.prepare(
      'SELECT generic_name FROM formulary_items WHERE id = ? AND tenant_id = ?'
    ).bind(data.formulary_item_id, tenantId).first<{ generic_name: string }>();
    if (fi) genericName = fi.generic_name;
  }

  const reviewStatus = data.source === 'patient_reported' || data.source === 'imported'
    ? 'pending_review'
    : 'verified';

  const result = await db.$client.prepare(`
    INSERT INTO patient_active_medications (
      tenant_id, patient_id, formulary_item_id, medication_name, generic_name,
      strength, dosage_form, dosage, frequency, duration, instructions,
      start_date, end_date, source, prescription_id, prescribed_by, created_by,
      review_status, reviewed_by, reviewed_at, review_notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, patientId, data.formulary_item_id ?? null,
    data.medication_name, genericName,
    data.strength ?? null, data.dosage_form ?? null,
    data.dosage ?? null, data.frequency ?? null, data.duration ?? null,
    data.instructions ?? null, data.start_date ?? null, data.end_date ?? null,
    data.source, data.prescription_id ?? null, userId, userId,
    reviewStatus, reviewStatus === 'verified' ? userId : null, reviewStatus === 'verified' ? new Date().toISOString() : null, null
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Medication added' }, 201);
});

// PUT /api/e-prescribing/patient/:patientId/medications/:id
app.put('/patient/:patientId/medications/:id', zValidator('json', updatePatientMedicationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireClinicalRole(c);
  const patientId = parseId(c.req.param('patientId'), 'Patient ID');
  const id = parseId(c.req.param('id'), 'Medication ID');
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id FROM patient_active_medications WHERE id = ? AND patient_id = ? AND tenant_id = ?'
  ).bind(id, patientId, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Medication record not found' });

  const sets: string[] = ["updated_at = datetime('now', '+6 hours')"];
  const vals: (string | number | null)[] = [];

  if (data.status !== undefined) { sets.push('status = ?'); vals.push(data.status); }
  if (data.status_reason !== undefined) { sets.push('status_reason = ?'); vals.push(data.status_reason); }
  if (data.end_date !== undefined) { sets.push('end_date = ?'); vals.push(data.end_date); }
  if (data.dosage !== undefined) { sets.push('dosage = ?'); vals.push(data.dosage); }
  if (data.frequency !== undefined) { sets.push('frequency = ?'); vals.push(data.frequency); }
  if (data.instructions !== undefined) { sets.push('instructions = ?'); vals.push(data.instructions); }

  if (sets.length === 1) throw new HTTPException(400, { message: 'No fields to update' });

  vals.push(id, patientId, tenantId);
  await db.$client.prepare(
    `UPDATE patient_active_medications SET ${sets.join(', ')} WHERE id = ? AND patient_id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  return c.json({ success: true, message: 'Medication updated' });
});

app.put('/patient/:patientId/medications/:id/review', zValidator('json', clinicalReviewSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireClinicalRole(c);
  const userId = requireUserId(c);
  const patientId = parseId(c.req.param('patientId'), 'Patient ID');
  const id = parseId(c.req.param('id'), 'Medication ID');
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT id, source FROM patient_active_medications WHERE id = ? AND patient_id = ? AND tenant_id = ?'
  ).bind(id, patientId, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Medication record not found' });

  await db.$client.prepare(
    "UPDATE patient_active_medications SET review_status = ?, reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'), review_notes = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND patient_id = ? AND tenant_id = ?"
  ).bind(data.status, userId, data.notes ?? null, id, patientId, tenantId).run();

  return c.json({ success: true, status: data.status, message: `Medication ${data.status}` });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SAFETY CHECKING — THE CORE FEATURE
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/e-prescribing/check-safety
app.post('/check-safety', zValidator('json', safetyCheckRequestSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  requireClinicalRole(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  await ensureSeedData(c.env.DB, tenantId);

  const medications = data.medications?.length
    ? data.medications
    : [{
      medication_name: data.medication_name ?? '',
      generic_name: data.generic_name,
      dose_mg: data.dose_mg,
      frequency_per_day: data.frequency_per_day,
    }];

  const { results: activeMeds } = await db.$client.prepare(`
    SELECT medication_name, generic_name FROM patient_active_medications
    WHERE tenant_id = ? AND patient_id = ? AND status = 'active' AND is_active = 1
  `).bind(tenantId, data.patient_id).all<{ medication_name: string; generic_name: string | null }>();
  const { results: recentlyStoppedMeds } = await db.$client.prepare(`
    SELECT medication_name, generic_name, status, COALESCE(end_date, updated_at, created_at) AS stop_date
    FROM patient_active_medications
    WHERE tenant_id = ? AND patient_id = ? AND status IN ('discontinued', 'completed', 'on_hold', 'suspended') AND is_active = 1
  `).bind(tenantId, data.patient_id).all<{
    medication_name: string;
    generic_name: string | null;
    status: string | null;
    stop_date: string | null;
  }>();
  const { results: drugAllergies } = await db.$client.prepare(`
    SELECT allergen, severity, reaction FROM patient_allergies
    WHERE tenant_id = ? AND patient_id = ? AND allergy_type = 'drug' AND is_active = 1
  `).bind(tenantId, data.patient_id).all<{ allergen: string; severity: string; reaction: string | null }>();

  const { results: interactionPairs } = await db.$client.prepare(`
    SELECT drug_a_name, drug_b_name, severity, description, recommendation
    FROM drug_interaction_pairs
    WHERE tenant_id = ? AND is_active = 1
  `).bind(tenantId).all<{
    drug_a_name: string;
    drug_b_name: string;
    severity: string;
    description: string;
    recommendation: string | null;
  }>();

  const { results: formularyRows } = await db.$client.prepare(`
    SELECT name, generic_name, max_daily_dose_mg
    FROM formulary_items
    WHERE tenant_id = ? AND is_active = 1
  `).bind(tenantId).all<{
    name: string;
    generic_name: string | null;
    max_daily_dose_mg: number | null;
  }>();

  const formularyByDrug = Object.fromEntries((formularyRows ?? []).flatMap((row) => {
    const keys = [
      normalizeMedicationName(row.generic_name ?? ''),
      normalizeMedicationName(row.name ?? ''),
    ].filter(Boolean);
    return keys.map((key) => [key, row]);
  }));

  const result = evaluateMedicationSafety({
    newItems: medications,
    activeMedications: activeMeds ?? [],
    recentlyStoppedMedications: recentlyStoppedMeds ?? [],
    allergies: drugAllergies ?? [],
    interactionPairs: interactionPairs ?? [],
    formularyByDrug,
    patientContext: data.patient_context,
  });

  // ─── Log safety check ───────────────────────────────────────────────────
  const safetyCheckResult = await db.$client.prepare(`
    INSERT INTO prescription_safety_checks (
      tenant_id, prescription_id, patient_id, medication_name, generic_name,
      check_type, has_warnings, warning_count, warnings_json, checked_by
    ) VALUES (?, ?, ?, ?, ?, 'combined', ?, ?, ?, ?)
  `).bind(
    tenantId, data.prescription_id ?? null, data.patient_id,
    medications.map((item) => item.medication_name).join(', '),
    medications[0]?.generic_name ?? null,
    result.findings.length > 0 ? 1 : 0, result.findings.length,
    JSON.stringify({
      medications,
      patient_context: data.patient_context ?? null,
      findings: result.findings,
      summary: {
        has_blocking: result.has_blocking,
        has_contraindicated: result.has_contraindicated,
        has_major: result.has_major,
      },
    }), userId
  ).run();

  return c.json({
    safe: result.safe,
    warning_count: result.warning_count,
    has_critical: result.findings.some((w) => w.severity === 'critical' || w.severity === 'contraindicated'),
    has_contraindicated: result.has_contraindicated,
    has_blocking: result.has_blocking,
    has_major: result.has_major,
    findings: result.findings,
    warnings: result.findings,
    safety_check_id: safetyCheckResult.meta.last_row_id,
    patient_id: data.patient_id,
    medication_name: medications[0]?.medication_name,
    medications,
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SAFETY CHECK HISTORY & OVERRIDE
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/e-prescribing/safety-checks/:prescriptionId
app.get('/safety-checks/:prescriptionId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const prescriptionId = parseId(c.req.param('prescriptionId'), 'Prescription ID');

  const { results } = await db.$client.prepare(`
    SELECT psc.*, s.name as checked_by_name
    FROM prescription_safety_checks psc
    LEFT JOIN staff s ON psc.checked_by = s.id AND s.tenant_id = psc.tenant_id
    WHERE psc.tenant_id = ? AND psc.prescription_id = ?
    ORDER BY psc.checked_at DESC
  `).bind(tenantId, prescriptionId).all();

  return c.json({ safety_checks: results });
});

// GET /api/e-prescribing/patient/:patientId/safety-checks
app.get('/patient/:patientId/safety-checks', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseId(c.req.param('patientId'), 'Patient ID');

  const { results } = await db.$client.prepare(`
    SELECT psc.*, s.name as checked_by_name
    FROM prescription_safety_checks psc
    LEFT JOIN staff s ON psc.checked_by = s.id AND s.tenant_id = psc.tenant_id
    WHERE psc.tenant_id = ? AND psc.patient_id = ?
    ORDER BY psc.checked_at DESC
    LIMIT 50
  `).bind(tenantId, patientId).all();

  return c.json({ safety_checks: results, total: results.length });
});


// GET /api/e-prescribing/safety-overrides — audit list for overridden safety checks
app.get('/safety-overrides', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const allowedRoles = ['doctor', 'md', 'pharmacist', 'hospital_admin'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Only clinical users and administrators can view safety override audit logs' });
  }

  const { page, limit, offset } = getPagination(c);
  const patientId = c.req.query('patientId');
  const prescriptionId = c.req.query('prescriptionId');
  const checkedBy = c.req.query('checkedBy');
  const where = [
    'psc.tenant_id = ?',
    "psc.action_taken = 'overridden'",
    "psc.override_reason IS NOT NULL",
    "TRIM(psc.override_reason) <> ''",
  ];
  const params: unknown[] = [tenantId];

  if (patientId) {
    const parsedPatientId = parseId(patientId, 'Patient ID');
    where.push('psc.patient_id = ?');
    params.push(parsedPatientId);
  }
  if (prescriptionId) {
    const parsedPrescriptionId = parseId(prescriptionId, 'Prescription ID');
    where.push('psc.prescription_id = ?');
    params.push(parsedPrescriptionId);
  }

  if (role === 'doctor' || role === 'pharmacist') {
    where.push('CAST(psc.checked_by AS TEXT) = ?');
    params.push(String(userId));
  } else if (checkedBy) {
    const parsedCheckedBy = parseId(checkedBy, 'Checked-by user ID');
    where.push('psc.checked_by = ?');
    params.push(parsedCheckedBy);
  }

  const whereSql = where.join(' AND ');
  const totalRow = await db.$client.prepare(`
    SELECT COUNT(*) AS total
    FROM prescription_safety_checks psc
    WHERE ${whereSql}
  `).bind(...params).first<{ total: number }>();

  const { results } = await db.$client.prepare(`
    SELECT
      psc.id,
      psc.prescription_id,
      psc.patient_id,
      p.name AS patient_name,
      p.patient_code,
      psc.medication_name,
      psc.generic_name,
      psc.check_type,
      psc.warning_count,
      psc.override_reason,
      psc.checked_by,
      COALESCE(u.name, s.name) AS checked_by_name,
      psc.checked_at
    FROM prescription_safety_checks psc
    LEFT JOIN patients p ON p.id = psc.patient_id AND p.tenant_id = psc.tenant_id
    LEFT JOIN users u ON u.id = psc.checked_by AND u.tenant_id = psc.tenant_id
    LEFT JOIN staff s ON s.user_id = psc.checked_by AND s.tenant_id = psc.tenant_id
    WHERE ${whereSql}
    ORDER BY psc.checked_at DESC, psc.id DESC
    LIMIT ? OFFSET ?
  `).bind(...params, limit, offset).all();

  const total = Number(totalRow?.total ?? 0);
  return c.json({
    overrides: results,
    pagination: paginationMeta(page, limit, total),
  });
});

// PUT /api/e-prescribing/safety-checks/:id/override
app.put('/safety-checks/:id/override', zValidator('json', safetyCheckOverrideSchema.omit({ safety_check_id: true })), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'), 'Safety Check ID');
  const data = c.req.valid('json');

  const role = c.get('role');
  const allowedRoles = ['doctor', 'md', 'hospital_admin'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Only doctors and administrators can override safety checks' });
  }

  const existing = await db.$client.prepare(
    'SELECT id FROM prescription_safety_checks WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Safety check not found' });

  await db.$client.prepare(
    'UPDATE prescription_safety_checks SET action_taken = ?, override_reason = ? WHERE id = ? AND tenant_id = ?'
  ).bind(data.action_taken, data.override_reason, id, tenantId).run();

  return c.json({ success: true, message: 'Safety check override recorded' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY / STATS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/e-prescribing/stats
app.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const safeCount = async (sql: string): Promise<number> => {
    try {
      const row = await db.$client.prepare(sql).bind(tenantId).first<{ count: number }>();
      return row?.count ?? 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('no such table')) return 0;
      throw error;
    }
  };

  const [formularyCount, interactionCount, safetyCheckCount, warningCount] = await Promise.all([
    safeCount('SELECT COUNT(*) as count FROM formulary_items WHERE tenant_id = ? AND is_active = 1'),
    safeCount('SELECT COUNT(*) as count FROM drug_interaction_pairs WHERE tenant_id = ? AND is_active = 1'),
    safeCount('SELECT COUNT(*) as count FROM prescription_safety_checks WHERE tenant_id = ?'),
    safeCount('SELECT COUNT(*) as count FROM prescription_safety_checks WHERE tenant_id = ? AND has_warnings = 1'),
  ]);

  return c.json({
    formulary_items: formularyCount,
    interaction_pairs: interactionCount,
    total_safety_checks: safetyCheckCount,
    checks_with_warnings: warningCount,
  });
});

export default app;
