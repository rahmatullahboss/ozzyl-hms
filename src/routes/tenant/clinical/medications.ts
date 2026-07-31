import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createMedicationSchema, updateMedicationSchema } from '../../../schemas/clinicalMedications';

type ClinicalEnv = { Bindings: Env; Variables: Variables };
export const medicationRoutes = new Hono<ClinicalEnv>();

// ─── List active medications for a patient ─────────────────────────────────

medicationRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  const status = c.req.query('status') || 'active';

  if (!patientId || isNaN(Number(patientId)))
    throw new HTTPException(400, { message: 'patientId query param is required' });

  let query = 'SELECT * FROM patient_active_medications WHERE tenant_id = ? AND patient_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId, Number(patientId)];

  if (status !== 'all') {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// ─── Get single medication ─────────────────────────────────────────────────

medicationRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const row = await db.$client
    .prepare('SELECT * FROM patient_active_medications WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();

  if (!row) throw new HTTPException(404, { message: 'Medication not found' });
  return c.json({ Results: row });
});

// ─── Create medication ─────────────────────────────────────────────────────

medicationRoutes.post('/', zValidator('json', createMedicationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');

  // ─── P0-11: tenant ownership check for patient + prescription ────────────
  // Returns 404 for cross-tenant IDs to avoid leaking existence.
  const patientRow = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ? LIMIT 1',
  ).bind(d.patientId, tenantId).first<{ id: number }>();
  if (!patientRow) throw new HTTPException(404, { message: 'Patient not found' });
  if (d.prescriptionId != null) {
    const rxRow = await db.$client.prepare(
      'SELECT id FROM prescriptions WHERE id = ? AND tenant_id = ? LIMIT 1',
    ).bind(d.prescriptionId, tenantId).first<{ id: number }>();
    if (!rxRow) throw new HTTPException(404, { message: 'Prescription not found' });
  }

  const result = await db.$client.prepare(`
    INSERT INTO patient_active_medications (
      tenant_id, patient_id, formulary_item_id, medication_name, generic_name,
      strength, dosage_form, dosage, frequency, duration, instructions,
      start_date, end_date, status, source, prescribed_by, prescription_id,
      is_active, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 1, ?, datetime('now', '+6 hours'))
  `).bind(
    tenantId, d.patientId, d.formularyItemId ?? null,
    d.medicationName, d.genericName ?? null,
    d.strength ?? null, d.dosageForm ?? null,
    d.dosage ?? null, d.frequency ?? null,
    d.duration ?? null, d.instructions ?? null,
    d.startDate ?? null, d.endDate ?? null,
    d.source ?? 'prescribed', userId, d.prescriptionId ?? null,
    userId,
  ).run();

  // Run safety checks if formulary item is linked
  let safetyWarnings: unknown[] = [];
  if (d.formularyItemId || d.genericName) {
    safetyWarnings = await runSafetyChecks(db, tenantId, d.patientId, d);
  }

  return c.json({ Results: { id: result.meta.last_row_id, safetyWarnings } }, 201);
});

// ─── Update medication ─────────────────────────────────────────────────────

medicationRoutes.put('/:id', zValidator('json', updateMedicationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT 1 FROM patient_active_medications WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Medication not found' });

  const data = c.req.valid('json');
  const colMap: Record<string, string> = {
    medicationName: 'medication_name', genericName: 'generic_name',
    strength: 'strength', dosageForm: 'dosage_form', dosage: 'dosage',
    frequency: 'frequency', duration: 'duration', instructions: 'instructions',
    startDate: 'start_date', endDate: 'end_date',
    status: 'status', statusReason: 'status_reason',
  };

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && colMap[key]) {
      sets.push(`${colMap[key]} = ?`);
      vals.push(val as string | number);
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    await db.$client
      .prepare(`UPDATE patient_active_medications SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...vals).run();
  }

  return c.json({ Results: true });
});

// ─── Discontinue medication (convenience endpoint) ─────────────────────────

medicationRoutes.put('/:id/discontinue', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  let reason: string | null = null;
  try {
    const body = await c.req.json();
    reason = body?.reason ?? null;
  } catch { /* no body is fine */ }

  const ex = await db.$client
    .prepare("SELECT 1 FROM patient_active_medications WHERE id = ? AND tenant_id = ? AND is_active = 1 AND status = 'active'")
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Active medication not found' });

  await db.$client
    .prepare(`UPDATE patient_active_medications
      SET status = 'discontinued', status_reason = ?, end_date = date('now', '+6 hours'), updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?`)
    .bind(reason, id, tenantId).run();

  return c.json({ Results: true });
});

// ─── Soft delete medication ────────────────────────────────────────────────

medicationRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT 1 FROM patient_active_medications WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Medication not found' });

  await db.$client
    .prepare("UPDATE patient_active_medications SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?")
    .bind(id, tenantId).run();

  return c.json({ Results: true });
});

// ─── Helper: Run prescription safety checks ────────────────────────────────

async function runSafetyChecks(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  patientId: number,
  med: Record<string, unknown>,
): Promise<unknown[]> {
  const warnings: unknown[] = [];

  // Check drug-allergy contraindications
  const { results: allergies } = await db.$client
    .prepare(
      "SELECT allergen, allergy_type FROM patient_allergies WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 AND allergy_type = 'drug'",
    )
    .bind(tenantId, patientId).all();

  const medNameLower = (med.medicationName as string).toLowerCase();
  const genericLower = (med.genericName as string | undefined)?.toLowerCase();

  for (const allergy of (allergies || [])) {
    const a = allergy as Record<string, unknown>;
    const allergenLower = (a.allergen as string).toLowerCase();
    if (medNameLower.includes(allergenLower) || (genericLower && genericLower.includes(allergenLower))) {
      warnings.push({
        type: 'allergy_contraindication',
        severity: 'major',
        message: `Patient has documented allergy to "${a.allergen}"`,
      });
    }
  }

  // Check drug-drug interactions
  if (med.genericName) {
    const { results: interactions } = await db.$client
      .prepare(`
        SELECT dip.severity, dip.description, pam.medication_name as interacting_with
        FROM drug_interaction_pairs dip
        JOIN patient_active_medications pam
          ON pam.tenant_id = ? AND pam.patient_id = ? AND pam.is_active = 1 AND pam.status = 'active'
          AND (LOWER(pam.generic_name) = LOWER(dip.drug_a) OR LOWER(pam.generic_name) = LOWER(dip.drug_b))
        WHERE (LOWER(dip.drug_a) = LOWER(?) OR LOWER(dip.drug_b) = LOWER(?))
          AND dip.is_active = 1
      `)
      .bind(tenantId, patientId, med.genericName as string, med.genericName as string).all();

    for (const interaction of (interactions || [])) {
      const i = interaction as Record<string, unknown>;
      warnings.push({
        type: 'drug_interaction',
        severity: i.severity,
        message: `Interaction with ${i.interacting_with}: ${i.description || 'Review recommended'}`,
      });
    }
  }

  return warnings;
}
