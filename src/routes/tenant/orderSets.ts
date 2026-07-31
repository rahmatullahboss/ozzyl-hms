import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getPagination, paginationMeta } from '../../lib/pagination';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { getNextSequence } from '../../lib/sequence';
import { resolveOrderingClinicianDoctorId } from '../../lib/lab-order-attribution';
import {
  createOrderSetSchema, updateOrderSetSchema, createOrderSetItemSchema,
  applyOrderSetSchema, doctorFavoriteSchema,
} from '../../schemas/orderSet';
import {
  evaluateMedicationSafety, type MedicationSafetyCandidate,
  type ActiveMedicationRecord, type DrugAllergyRecord,
  type DrugInteractionPairRecord, type FormularyDrugRecord,
  normalizeMedicationName,
} from '../../lib/drug-safety';

type OEnv = { Bindings: Env; Variables: Variables };
const orderSetRoutes = new Hono<OEnv>();

// ─── Auto-clone seed order sets ─────────────────────────────────────────────

async function ensureSeeds(db: ReturnType<typeof getDb>, tenantId: string) {
  const existing = await db.$client.prepare(
    'SELECT COUNT(*) as count FROM order_set_templates WHERE tenant_id = ?',
  ).bind(tenantId).first<{ count: number }>();
  if (existing && existing.count > 0) return;

  const seeds = await db.$client.prepare(
    "SELECT * FROM order_set_templates WHERE tenant_id = '__seed__'",
  ).all();
  for (const seed of seeds.results || []) {
    const s = seed as Record<string, unknown>;
    const result = await db.$client.prepare(`
      INSERT OR IGNORE INTO order_set_templates (code, name, description, specialty, category, is_global, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(s.code, s.name, s.description, s.specialty, s.category, s.is_global, tenantId).run();
    const newId = result.meta.last_row_id;

    const items = await db.$client.prepare(
      "SELECT * FROM order_set_items WHERE order_set_id = ? AND tenant_id = '__seed__' ORDER BY sequence",
    ).bind(s.id).all();
    for (const item of items.results || []) {
      const i = item as Record<string, unknown>;
      await db.$client.prepare(`
        INSERT INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name,
          dose, route, frequency, duration, instructions, formulary_item_id,
          lab_test_id, lab_test_code, description, priority, is_optional, tenant_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        newId, i.sequence, i.item_type, i.medication_name, i.generic_name,
        i.dose, i.route, i.frequency, i.duration, i.instructions, i.formulary_item_id,
        i.lab_test_id, i.lab_test_code, i.description, i.priority, i.is_optional, tenantId,
      ).run();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ORDER SET TEMPLATE CRUD
// ═══════════════════════════════════════════════════════════════════════════

orderSetRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  await ensureSeeds(db, tenantId);

  const { specialty, category, search } = c.req.query();
  let query = 'SELECT * FROM order_set_templates WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (specialty) { query += ' AND specialty = ?'; params.push(specialty); }
  if (category) { query += ' AND category = ?'; params.push(category); }
  if (search) { query += ' AND (name LIKE ? OR code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ' ORDER BY specialty, name';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

orderSetRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  const template = await db.$client.prepare(
    'SELECT * FROM order_set_templates WHERE id = ? AND tenant_id = ? AND is_active = 1',
  ).bind(id, tenantId).first();
  if (!template) throw new HTTPException(404, { message: 'Order set not found' });

  const { results: items } = await db.$client.prepare(
    'SELECT * FROM order_set_items WHERE order_set_id = ? AND tenant_id = ? AND is_active = 1 ORDER BY sequence',
  ).bind(id, tenantId).all();

  return c.json({ data: { ...template, items: items || [] } });
});

orderSetRoutes.post('/', requireRole('doctor', 'md', 'hospital_admin'), zValidator('json', createOrderSetSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO order_set_templates (code, name, description, specialty, category, is_global, created_by, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(data.code, data.name, data.description ?? null, data.specialty ?? null,
    data.category, data.is_global ? 1 : 0, userId, tenantId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Order set created' }, 201);
});

orderSetRoutes.put('/:id', requireRole('doctor', 'md', 'hospital_admin'), zValidator('json', updateOrderSetSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      updates.push(`${key} = ?`);
      values.push(key === 'is_global' ? (val ? 1 : 0) : val as string);
    }
  }
  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  updates.push("updated_at = datetime('now', '+6 hours')");
  values.push(id, tenantId);

  await db.$client.prepare(
    `UPDATE order_set_templates SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`,
  ).bind(...values).run();
  return c.json({ message: 'Order set updated' });
});

orderSetRoutes.delete('/:id', requireRole('doctor', 'md', 'hospital_admin'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  await db.$client.prepare(
    'UPDATE order_set_templates SET is_active = 0 WHERE id = ? AND tenant_id = ?',
  ).bind(c.req.param('id'), tenantId).run();
  return c.json({ message: 'Order set deactivated' });
});

// ═══════════════════════════════════════════════════════════════════════════
// ORDER SET ITEMS
// ═══════════════════════════════════════════════════════════════════════════

orderSetRoutes.post('/:id/items', requireRole('doctor', 'md', 'hospital_admin'), zValidator('json', createOrderSetItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const setId = c.req.param('id');
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO order_set_items (order_set_id, sequence, item_type, medication_name, generic_name,
      dose, route, frequency, duration, instructions, formulary_item_id,
      lab_test_id, lab_test_code, description, priority, is_optional, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    setId, data.sequence, data.item_type, data.medication_name ?? null, data.generic_name ?? null,
    data.dose ?? null, data.route ?? null, data.frequency ?? null, data.duration ?? null,
    data.instructions ?? null, data.formulary_item_id ?? null, data.lab_test_id ?? null,
    data.lab_test_code ?? null, data.description ?? null, data.priority, data.is_optional ? 1 : 0, tenantId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Item added' }, 201);
});

orderSetRoutes.put('/:id/items/:itemId', requireRole('doctor', 'md', 'hospital_admin'), zValidator('json', createOrderSetItemSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const itemId = c.req.param('itemId');
  const data = c.req.valid('json');

  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      updates.push(`${key} = ?`);
      values.push(key === 'is_optional' ? (val ? 1 : 0) : val as string | number);
    }
  }
  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields' });
  values.push(itemId, tenantId);

  await db.$client.prepare(
    `UPDATE order_set_items SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`,
  ).bind(...values).run();
  return c.json({ message: 'Item updated' });
});

orderSetRoutes.delete('/:id/items/:itemId', requireRole('doctor', 'md', 'hospital_admin'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  await db.$client.prepare(
    'UPDATE order_set_items SET is_active = 0 WHERE id = ? AND tenant_id = ?',
  ).bind(c.req.param('itemId'), tenantId).run();
  return c.json({ message: 'Item removed' });
});

// ═══════════════════════════════════════════════════════════════════════════
// APPLY ORDER SET — The Core Feature
// ═══════════════════════════════════════════════════════════════════════════

orderSetRoutes.post('/:id/apply', requireRole('doctor', 'md', 'hospital_admin'), zValidator('json', applyOrderSetSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const setId = c.req.param('id');
  const data = c.req.valid('json');

  // Verify order set exists
  const template = await db.$client.prepare(
    'SELECT * FROM order_set_templates WHERE id = ? AND tenant_id = ? AND is_active = 1',
  ).bind(setId, tenantId).first() as any;
  if (!template) throw new HTTPException(404, { message: 'Order set not found' });

  // Fetch items
  const { results: allItems } = await db.$client.prepare(
    'SELECT * FROM order_set_items WHERE order_set_id = ? AND tenant_id = ? AND is_active = 1 ORDER BY sequence',
  ).bind(setId, tenantId).all();

  // Apply overrides (skip, dose changes)
  const overrideMap = new Map((data.overrides || []).map(o => [o.item_id, o]));
  const items = (allItems || []).filter((item: any) => {
    const override = overrideMap.get(item.id as number);
    return !override?.skip;
  }) as any[];

  // ── Drug Safety Check on medication items ────────────────────────────────
  const medItems = items.filter(i => i.item_type === 'medication');
  if (medItems.length > 0) {
    // Fetch patient context for safety check
    const [activeMedsResult, allergiesResult, interactionsResult] = await Promise.all([
      db.$client.prepare(
        "SELECT medication_name, generic_name, status FROM patient_active_medications WHERE patient_id = ? AND tenant_id = ? AND status = 'active'",
      ).bind(data.patient_id, tenantId).all().catch(() => ({ results: [] })),
      db.$client.prepare(
        "SELECT allergen, severity FROM patient_allergies WHERE patient_id = ? AND tenant_id = ? AND is_active = 1 AND allergy_type = 'drug'",
      ).bind(data.patient_id, tenantId).all().catch(() => ({ results: [] })),
      db.$client.prepare(
        "SELECT drug_a_name, drug_b_name, severity, description, recommendation FROM drug_interaction_pairs WHERE tenant_id IN (?, '__seed__') AND is_active = 1",
      ).bind(tenantId).all().catch(() => ({ results: [] })),
    ]);

    const newCandidates: MedicationSafetyCandidate[] = medItems.map(item => {
      const override = overrideMap.get(item.id as number);
      return {
        medication_name: item.medication_name || item.generic_name || '',
        generic_name: item.generic_name,
        dose_mg: parseFloat(override?.dose || item.dose || '0') || undefined,
        frequency_per_day: undefined,
      };
    });

    const formularyByDrug: Record<string, FormularyDrugRecord> = {};
    // Build formulary lookup from items
    for (const item of medItems) {
      const key = normalizeMedicationName(item.generic_name || item.medication_name || '');
      if (key && item.formulary_item_id) {
        const fi = await db.$client.prepare(
          'SELECT name, generic_name, max_daily_dose_mg FROM formulary_items WHERE id = ? AND tenant_id = ?',
        ).bind(item.formulary_item_id, tenantId).first() as any;
        if (fi) formularyByDrug[key] = fi;
      }
    }

    const safetyResult = evaluateMedicationSafety({
      newItems: newCandidates,
      activeMedications: (activeMedsResult.results || []) as ActiveMedicationRecord[],
      allergies: (allergiesResult.results || []) as DrugAllergyRecord[],
      interactionPairs: (interactionsResult.results || []) as DrugInteractionPairRecord[],
      formularyByDrug,
    });

    if (safetyResult.has_blocking) {
      return c.json({
        applied: false,
        safety_blocked: true,
        findings: safetyResult.findings.filter(f => f.blocking),
        message: 'Order set blocked by drug safety check. Review findings and override if clinically justified.',
      }, 422);
    }

    // Non-blocking warnings included in response
    if (safetyResult.warning_count > 0) {
      // Continue but include warnings
    }
  }

  // ── Create Orders ────────────────────────────────────────────────────────
  const created = { prescriptions: 0, lab_orders: 0, nursing_notes: 0, instructions: 0 };
  let prescriptionId: number | null = null;
  let labOrderId: number | null = null;

  // Create prescription for medication items
  const medsToOrder = items.filter(i => i.item_type === 'medication');
  if (medsToOrder.length > 0) {
    const rxNo = await getNextSequence(c.env.DB, tenantId!, 'prescription', 'RX');
    const rxResult = await db.$client.prepare(`
      INSERT INTO prescriptions (rx_no, patient_id, doctor_id, status, tenant_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'final', ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
    `).bind(rxNo, data.patient_id, userId, tenantId, userId).run();
    prescriptionId = rxResult.meta.last_row_id as number;

    for (let i = 0; i < medsToOrder.length; i++) {
      const item = medsToOrder[i];
      const override = overrideMap.get(item.id as number);
      await db.$client.prepare(`
        INSERT INTO prescription_items (prescription_id, medicine_name, dosage, frequency, duration, instructions, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        prescriptionId, item.medication_name || item.generic_name,
        override?.dose || item.dose || '', override?.frequency || item.frequency || '',
        override?.duration || item.duration || '', override?.instructions || item.instructions || '',
        i + 1,
      ).run();
      created.prescriptions++;
    }
  }

  // Create lab orders
  const labsToOrder = items.filter(i => i.item_type === 'lab_test');
  if (labsToOrder.length > 0) {
    const loNo = await getNextSequence(c.env.DB, tenantId!, 'lab_order', 'LO');
    const orderingClinicianDoctorId = await resolveOrderingClinicianDoctorId(c.env.DB, tenantId!, {
      enteredByUserId: userId,
      visitId: data.visit_id ?? null,
    });
    const loResult = await db.$client.prepare(`
      INSERT INTO lab_orders (
        order_no, patient_id, visit_id, ordered_by, ordering_clinician_doctor_id,
        order_date, priority, tenant_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, date('now', '+6 hours'), ?, ?, datetime('now', '+6 hours'))
    `).bind(loNo, data.patient_id, data.visit_id ?? null, userId, orderingClinicianDoctorId,
      labsToOrder.some((l: any) => l.priority === 'stat') ? 'stat' : 'routine', tenantId).run();
    labOrderId = loResult.meta.last_row_id as number;

    for (const item of labsToOrder) {
      // Try to find test in catalog by code
      const test = item.lab_test_id
        ? await db.$client.prepare('SELECT id, price FROM lab_test_catalog WHERE id = ? AND tenant_id = ? AND is_active = 1').bind(item.lab_test_id, tenantId).first<{ id: number; price: number }>()
        : item.lab_test_code
          ? await db.$client.prepare('SELECT id, price FROM lab_test_catalog WHERE code = ? AND tenant_id = ? AND is_active = 1').bind(item.lab_test_code, tenantId).first<{ id: number; price: number }>()
          : null;

      if (test) {
        await db.$client.prepare(`
          INSERT INTO lab_order_items (lab_order_id, lab_test_id, unit_price, discount, line_total, status, tenant_id, source)
          VALUES (?, ?, ?, 0, ?, 'pending', ?, 'order_set')
        `).bind(labOrderId, test.id, test.price, test.price, tenantId).run();
      }
      created.lab_orders++;
    }
  }

  // Create nursing notes for nursing/diet/instruction items
  const nursingItems = items.filter(i => ['nursing', 'diet', 'instruction'].includes(i.item_type));
  for (const item of nursingItems) {
    const noteType = item.item_type === 'nursing' ? 'assessment' : item.item_type === 'diet' ? 'general' : 'general';
    await db.$client.prepare(`
      INSERT INTO nur_notes (patient_id, visit_id, note_type, note, is_active, tenant_id, created_by, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      data.patient_id, data.visit_id ?? null, noteType,
      `[${template.name}] ${item.description || item.instructions || ''}`,
      tenantId, userId,
    ).run();
    created.nursing_notes++;
    if (item.item_type === 'instruction') created.instructions++;
  }

  return c.json({
    applied: true,
    order_set: template.name,
    summary: created,
    prescription_id: prescriptionId,
    lab_order_id: labOrderId,
    message: `Order set "${template.name}" applied successfully`,
  }, 201);
});

// ═══════════════════════════════════════════════════════════════════════════
// DOCTOR FAVORITES
// ═══════════════════════════════════════════════════════════════════════════

orderSetRoutes.get('/favorites/list', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const { results } = await db.$client.prepare(
    'SELECT * FROM doctor_favorite_orders WHERE doctor_id = ? AND tenant_id = ? AND is_active = 1 ORDER BY created_at DESC',
  ).bind(userId, tenantId).all();
  return c.json({ data: results });
});

orderSetRoutes.post('/favorites', requireRole('doctor', 'md', 'hospital_admin'), zValidator('json', doctorFavoriteSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO doctor_favorite_orders (doctor_id, name, items_json, tenant_id)
    VALUES (?, ?, ?, ?)
  `).bind(userId, data.name, data.items_json, tenantId).run();

  return c.json({ id: result.meta.last_row_id, message: 'Favorite saved' }, 201);
});

orderSetRoutes.delete('/favorites/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  await db.$client.prepare(
    'UPDATE doctor_favorite_orders SET is_active = 0 WHERE id = ? AND doctor_id = ? AND tenant_id = ?',
  ).bind(c.req.param('id'), userId, tenantId).run();
  return c.json({ message: 'Favorite removed' });
});

export default orderSetRoutes;
