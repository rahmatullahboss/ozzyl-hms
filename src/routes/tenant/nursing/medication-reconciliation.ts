import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import {
  createReconciliationSchema,
  reconciliationItemSchema,
  reconciliationQuerySchema,
} from '../../../schemas/nursing';
import { getDb } from '../../../db';
import { createAuditLog } from '../../../lib/accounting-helpers';
import {
  clnMedicationReconciliation,
  clnMedicationReconciliationItems,
} from '../../../db/schema/clinicalMar';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const medicationReconciliationRoutes = new Hono<NursingEnv>();

const updateReconciliationItemSchema = reconciliationItemSchema.partial().superRefine((value, ctx) => {
  if (Object.values(value).every((entry) => entry === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one field is required' });
  }
  if (value.action === 'discontinue' && !value.action_reason?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['action_reason'], message: 'Reason is required when discontinuing a medication' });
  }
  if (value.action === 'modify' && ![value.new_dose, value.new_route, value.new_frequency].some((entry) => entry?.trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['new_dose'], message: 'At least one new medication instruction is required when modifying' });
  }
});

async function requireVisitForPatient(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  visitId: number,
  patientId: number,
): Promise<void> {
  const visit = await db.$client.prepare(
    'SELECT patient_id FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
  ).bind(visitId, tenantId).first<{ patient_id: number }>();

  if (!visit) throw new HTTPException(404, { message: 'Visit not found' });
  if (Number(visit.patient_id) !== patientId) {
    throw new HTTPException(400, { message: 'Patient does not match visit' });
  }
}

async function findOpenReconciliation(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  patientId: number,
  visitId: number,
  reconciliationType: string,
): Promise<number | null> {
  const existing = await db.$client.prepare(`
    SELECT id
    FROM cln_medication_reconciliation
    WHERE tenant_id = ? AND patient_id = ? AND visit_id = ?
      AND reconciliation_type = ? AND status = 'in_progress' AND is_active = 1
    LIMIT 1
  `).bind(tenantId, patientId, visitId, reconciliationType).first<{ id: number }>();
  return existing?.id ? Number(existing.id) : null;
}

// ─── GET / — list reconciliations ───────────────────────────────────────────
medicationReconciliationRoutes.get('/', zValidator('query', reconciliationQuerySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, patient_id, visit_id } = c.req.valid('query');
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM cln_medication_reconciliation WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];

  if (patient_id) { query += ' AND patient_id = ?'; params.push(patient_id); }
  if (visit_id) { query += ' AND visit_id = ?'; params.push(visit_id); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();

  let countQuery = 'SELECT COUNT(*) as total FROM cln_medication_reconciliation WHERE tenant_id = ? AND is_active = 1';
  const countParams: (string | number)[] = [tenantId];
  if (patient_id) { countQuery += ' AND patient_id = ?'; countParams.push(patient_id); }
  if (visit_id) { countQuery += ' AND visit_id = ?'; countParams.push(visit_id); }
  const countResult = await db.$client.prepare(countQuery).bind(...countParams).first<{ total: number }>();

  return c.json({ Results: results, pagination: { page, limit, total: countResult?.total || 0 } });
});

// ─── GET /patient/:patientId — reconciliation history for a patient ─────────
medicationReconciliationRoutes.get('/patient/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  const reconciliations = await db.select()
    .from(clnMedicationReconciliation)
    .where(
      and(
        eq(clnMedicationReconciliation.tenantId, tenantId),
        eq(clnMedicationReconciliation.patientId, patientId),
        eq(clnMedicationReconciliation.isActive, 1)
      )
    )
    .orderBy(desc(clnMedicationReconciliation.createdAt));

  return c.json({ Results: reconciliations });
});

// ─── GET /:id — single reconciliation with items ────────────────────────────
medicationReconciliationRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const recon = await db.select()
    .from(clnMedicationReconciliation)
    .where(
      and(
        eq(clnMedicationReconciliation.id, id),
        eq(clnMedicationReconciliation.tenantId, tenantId),
        eq(clnMedicationReconciliation.isActive, 1)
      )
    )
    .limit(1);

  if (recon.length === 0) throw new HTTPException(404, { message: 'Reconciliation not found' });

  const items = await db.select()
    .from(clnMedicationReconciliationItems)
    .where(
      and(
        eq(clnMedicationReconciliationItems.reconciliationId, id),
        eq(clnMedicationReconciliationItems.tenantId, tenantId),
        eq(clnMedicationReconciliationItems.isActive, 1)
      )
    );

  const linkedPrescription = await db.$client.prepare(`
    SELECT id, rx_no, status
    FROM prescriptions
    WHERE tenant_id = ? AND source_reconciliation_id = ?
    LIMIT 1
  `).bind(tenantId, id).first<{ id: number; rx_no: string; status: string }>();

  return c.json({ Results: { ...recon[0], items, linked_prescription: linkedPrescription ?? null } });
});

// ─── POST / — create a new reconciliation ───────────────────────────────────
medicationReconciliationRoutes.post('/', zValidator('json', createReconciliationSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  await requireVisitForPatient(db, tenantId, data.visit_id, data.patient_id);
  const openId = await findOpenReconciliation(
    db,
    tenantId,
    data.patient_id,
    data.visit_id,
    data.reconciliation_type,
  );
  if (openId) {
    throw new HTTPException(409, {
      message: 'A medication reconciliation is already in progress for this transition',
    });
  }

  const result = await db.$client.prepare(`
    INSERT INTO cln_medication_reconciliation
      (tenant_id, patient_id, visit_id, reconciliation_type, status, performed_by, notes, created_by)
    SELECT ?, ?, ?, ?, 'in_progress', ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1
      FROM cln_medication_reconciliation
      WHERE tenant_id = ? AND patient_id = ? AND visit_id = ?
        AND reconciliation_type = ? AND status = 'in_progress' AND is_active = 1
    )
  `).bind(
    tenantId, data.patient_id, data.visit_id,
    data.reconciliation_type, userId,
    data.notes ?? null, userId,
    tenantId, data.patient_id, data.visit_id, data.reconciliation_type,
  ).run();

  if (result.meta.changes !== 1) {
    throw new HTTPException(409, {
      message: 'A medication reconciliation is already in progress for this transition',
    });
  }

  const reconId = Number(result.meta.last_row_id);

  if (reconId) {
    const source = data.reconciliation_type === 'admission' ? 'home' : 'inpatient';
    const activeMeds = data.reconciliation_type === 'admission'
      ? await db.$client.prepare(`
          SELECT medication_name, generic_name, dosage AS dose, NULL AS route, frequency
          FROM patient_active_medications
          WHERE tenant_id = ? AND patient_id = ? AND status = 'active' AND is_active = 1
          ORDER BY COALESCE(start_date, created_at) DESC, id DESC
        `).bind(tenantId, data.patient_id).all()
      : await db.$client.prepare(`
          SELECT medication_name, generic_name, dose, route, frequency
          FROM cln_medication_orders
          WHERE tenant_id = ? AND patient_id = ? AND status = 'active' AND is_active = 1
          ORDER BY created_at DESC, id DESC
        `).bind(tenantId, data.patient_id).all();

    for (const med of activeMeds.results) {
      const m = med as Record<string, string | null>;
      await db.$client.prepare(`
        INSERT INTO cln_medication_reconciliation_items
          (tenant_id, reconciliation_id, medication_name, generic_name, dose, route, frequency, source, action)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'continue')
      `).bind(
        tenantId, reconId,
        m.medication_name || 'Unknown',
        m.generic_name ?? null,
        m.dose ?? null,
        m.route ?? null,
        m.frequency ?? null,
        source,
      ).run();
    }

    await createAuditLog(c.env, tenantId, userId, 'CREATE', 'cln_medication_reconciliation', reconId, null, {
      patientId: data.patient_id,
      visitId: data.visit_id,
      reconciliationType: data.reconciliation_type,
      status: 'in_progress',
      importedMedicationCount: activeMeds.results.length,
    });
  }

  return c.json({ Results: { id: reconId } }, 201);
});

// ─── POST /:id/items — add item to reconciliation ──────────────────────────
medicationReconciliationRoutes.post('/:id/items', zValidator('json', reconciliationItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const reconId = parseInt(c.req.param('id'));
  if (isNaN(reconId)) throw new HTTPException(400, { message: 'Invalid reconciliation ID' });

  // Verify the reconciliation exists and is in_progress
  const recon = await db.select({ id: clnMedicationReconciliation.id, status: clnMedicationReconciliation.status })
    .from(clnMedicationReconciliation)
    .where(
      and(
        eq(clnMedicationReconciliation.id, reconId),
        eq(clnMedicationReconciliation.tenantId, tenantId),
        eq(clnMedicationReconciliation.isActive, 1)
      )
    )
    .limit(1);

  if (recon.length === 0) throw new HTTPException(404, { message: 'Reconciliation not found' });
  if (recon[0].status !== 'in_progress') {
    throw new HTTPException(400, { message: 'Reconciliation is already completed or cancelled' });
  }

  const data = c.req.valid('json');

  const result = await db.insert(clnMedicationReconciliationItems).values({
    tenantId,
    reconciliationId: reconId,
    medicationName: data.medication_name,
    genericName: data.generic_name ?? null,
    dose: data.dose ?? null,
    route: data.route ?? null,
    frequency: data.frequency ?? null,
    source: data.source,
    action: data.action,
    actionReason: data.action_reason ?? null,
    newDose: data.new_dose ?? null,
    newRoute: data.new_route ?? null,
    newFrequency: data.new_frequency ?? null,
    updatedBy: Number(userId) || null,
  }).returning({ id: clnMedicationReconciliationItems.id });

  const itemId = Number(result[0]?.id ?? 0);
  if (itemId) {
    await createAuditLog(c.env, tenantId, userId, 'CREATE', 'cln_medication_reconciliation_items', itemId, null, {
      reconciliationId: reconId,
      source: data.source,
      action: data.action,
      hasActionReason: Boolean(data.action_reason?.trim()),
    });
  }

  return c.json({ Results: { id: itemId } }, 201);
});

// ─── PUT /:id/items/:itemId — update an imported/manual medication decision ──
medicationReconciliationRoutes.put('/:id/items/:itemId', zValidator('json', updateReconciliationItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const reconId = Number(c.req.param('id'));
  const itemId = Number(c.req.param('itemId'));
  if (!Number.isInteger(reconId) || reconId <= 0 || !Number.isInteger(itemId) || itemId <= 0) {
    throw new HTTPException(400, { message: 'Invalid reconciliation or item ID' });
  }

  const recon = await db.$client.prepare(`
    SELECT id, status
    FROM cln_medication_reconciliation
    WHERE id = ? AND tenant_id = ? AND is_active = 1
    LIMIT 1
  `).bind(reconId, tenantId).first<{ id: number; status: string }>();
  if (!recon) throw new HTTPException(404, { message: 'Reconciliation not found' });
  if (recon.status !== 'in_progress') {
    throw new HTTPException(409, { message: 'Completed reconciliation items cannot be changed' });
  }

  const item = await db.$client.prepare(`
    SELECT id
    FROM cln_medication_reconciliation_items
    WHERE id = ? AND reconciliation_id = ? AND tenant_id = ? AND is_active = 1
    LIMIT 1
  `).bind(itemId, reconId, tenantId).first<{ id: number }>();
  if (!item) throw new HTTPException(404, { message: 'Reconciliation item not found' });

  const data = c.req.valid('json');
  const columnMap: Record<string, string> = {
    medication_name: 'medication_name',
    generic_name: 'generic_name',
    dose: 'dose',
    route: 'route',
    frequency: 'frequency',
    source: 'source',
    action: 'action',
    action_reason: 'action_reason',
    new_dose: 'new_dose',
    new_route: 'new_route',
    new_frequency: 'new_frequency',
  };
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  for (const [key, value] of Object.entries(data)) {
    const column = columnMap[key];
    if (!column || value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(value === '' ? null : value as string | number);
  }
  sets.push('updated_by = ?');
  values.push(Number(userId) || null, itemId, reconId, tenantId);

  await db.$client.prepare(`
    UPDATE cln_medication_reconciliation_items
    SET ${sets.join(', ')}
    WHERE id = ? AND reconciliation_id = ? AND tenant_id = ? AND is_active = 1
  `).bind(...values).run();

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'cln_medication_reconciliation_items', itemId, null, {
    reconciliationId: reconId,
    action: data.action ?? null,
    hasActionReason: Boolean(data.action_reason?.trim()),
    modifiedDose: data.new_dose !== undefined,
    modifiedRoute: data.new_route !== undefined,
    modifiedFrequency: data.new_frequency !== undefined,
  });

  return c.json({ Results: { id: itemId } });
});

// ─── PUT /:id/complete — complete and sign the reconciliation ───────────────
medicationReconciliationRoutes.put('/:id/complete', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.$client.prepare(`
    SELECT id, status, patient_id, visit_id, reconciliation_type
    FROM cln_medication_reconciliation
    WHERE id = ? AND tenant_id = ? AND is_active = 1
    LIMIT 1
  `).bind(id, tenantId).first<{
    id: number;
    status: string;
    patient_id: number;
    visit_id: number;
    reconciliation_type: string;
  }>();

  if (!existing) throw new HTTPException(404, { message: 'Reconciliation not found' });
  if (existing.status !== 'in_progress') {
    throw new HTTPException(400, { message: 'Reconciliation is not in progress' });
  }

  const completedAt = new Date().toISOString();
  const completion = await db.$client.prepare(`
    UPDATE cln_medication_reconciliation
    SET status = 'completed', completed_at = ?, updated_at = ?, updated_by = ?
    WHERE id = ? AND tenant_id = ? AND status = 'in_progress' AND is_active = 1
  `).bind(completedAt, completedAt, Number(userId) || null, id, tenantId).run();
  if (completion.meta.changes !== 1) {
    throw new HTTPException(409, { message: 'Reconciliation was already completed by another user' });
  }

  let dischargeChecklistSynced: boolean | null = null;
  if (existing.reconciliation_type === 'discharge') {
    dischargeChecklistSynced = false;
    try {
      const admission = await db.$client.prepare(`
        SELECT a.id
        FROM admissions a
        JOIN visits v
          ON v.id = ? AND v.tenant_id = a.tenant_id AND v.patient_id = a.patient_id
        WHERE a.tenant_id = ? AND a.patient_id = ?
          AND (
            (v.admission_no IS NOT NULL AND v.admission_no = a.admission_no)
            OR a.status IN ('admitted', 'critical')
          )
        ORDER BY CASE WHEN v.admission_no = a.admission_no THEN 0 ELSE 1 END, a.id DESC
        LIMIT 1
      `).bind(existing.visit_id, tenantId, existing.patient_id).first<{ id: number }>();

      if (admission?.id) {
        const checklistUpdate = await db.$client.prepare(`
          UPDATE discharge_checklists
          SET medications_reconciled = 1, updated_at = datetime('now', '+6 hours')
          WHERE admission_id = ? AND tenant_id = ?
        `).bind(Number(admission.id), tenantId).run();
        dischargeChecklistSynced = checklistUpdate.meta.changes > 0;
      }
    } catch (error) {
      console.error('Medication reconciliation completed but discharge checklist sync failed', error);
    }
  }

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'cln_medication_reconciliation', id, {
    status: 'in_progress',
  }, {
    status: 'completed',
    patientId: existing.patient_id,
    visitId: existing.visit_id,
    reconciliationType: existing.reconciliation_type,
    dischargeChecklistSynced,
  });

  return c.json({ Results: { id, status: 'completed', dischargeChecklistSynced } });
});

// ─── DELETE /:id — soft delete a reconciliation ─────────────────────────────
medicationReconciliationRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const existing = await db.select({
    id: clnMedicationReconciliation.id,
    status: clnMedicationReconciliation.status,
  })
    .from(clnMedicationReconciliation)
    .where(
      and(
        eq(clnMedicationReconciliation.id, id),
        eq(clnMedicationReconciliation.tenantId, tenantId),
        eq(clnMedicationReconciliation.isActive, 1)
      )
    )
    .limit(1);

  if (existing.length === 0) throw new HTTPException(404, { message: 'Reconciliation not found' });
  if (existing[0].status === 'completed') {
    throw new HTTPException(409, {
      message: 'Completed medication reconciliation is locked; create a corrective reconciliation instead',
    });
  }

  await db.update(clnMedicationReconciliation)
    .set({ isActive: 0, status: 'cancelled', updatedAt: new Date().toISOString(), updatedBy: Number(userId) || null })
    .where(
      and(
        eq(clnMedicationReconciliation.id, id),
        eq(clnMedicationReconciliation.tenantId, tenantId),
        eq(clnMedicationReconciliation.status, existing[0].status)
      )
    );

  await createAuditLog(c.env, tenantId, userId, 'DELETE', 'cln_medication_reconciliation', id, {
    status: existing[0].status,
  }, {
    status: 'cancelled',
    isActive: false,
  });

  return c.json({ Results: true });
});
