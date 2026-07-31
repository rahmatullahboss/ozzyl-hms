import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../../types';
import { requireSpecificRole, requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createEncounterSchema, updateEncounterSchema } from '../../../schemas/clinicalEncounters';
import { createAuditLog } from '../../../lib/accounting-helpers';
import { getFullTimestampGMT6 } from '../../../lib/date-utils';
import { sha256Hex } from '../../../lib/clinical-signatures';

type ClinicalEnv = { Bindings: Env; Variables: Variables };
export const encounterRoutes = new Hono<ClinicalEnv>();

const createEncounterAddendumSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  content: z.string().trim().min(3).max(5000),
});

// ─── List encounters for a patient ─────────────────────────────────────────

encounterRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  const status = c.req.query('status');
  const page = Math.max(Number(c.req.query('page')) || 1, 1);
  const limit = Math.min(Number(c.req.query('limit')) || 20, 100);
  const offset = (page - 1) * limit;

  if (!patientId || isNaN(Number(patientId)))
    throw new HTTPException(400, { message: 'patientId query param is required' });

  let query = 'SELECT * FROM encounters WHERE tenant_id = ? AND patient_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId, Number(patientId)];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
  const countResult = await db.$client.prepare(countQuery).bind(...params).first<{ total: number }>();

  query += ' ORDER BY start_time DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({
    Results: results,
    pagination: { page, limit, total: countResult?.total || 0 },
  });
});

// ─── Get encounter with linked clinical data ──────────────────────────────

encounterRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const encounter = await db.$client
    .prepare('SELECT * FROM encounters WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();

  if (!encounter) throw new HTTPException(404, { message: 'Encounter not found' });

  const { results: addenda } = await db.$client.prepare(`
    SELECT id, encounter_id, author_id, reason, content,
           previous_snapshot_hash, addendum_hash, created_at
    FROM encounter_addenda
    WHERE tenant_id = ? AND encounter_id = ?
    ORDER BY created_at ASC, id ASC
  `).bind(tenantId, id).all();

  return c.json({ Results: { ...(encounter as Record<string, unknown>), addenda } });
});

// ─── Append-only correction to a signed encounter ──────────────────────────
encounterRoutes.post('/:id/addenda', zValidator('json', createEncounterAddendumSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = requireSpecificRole(c, 'doctor', 'hospital_admin', 'md');
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid encounter ID' });
  const body = c.req.valid('json');

  const encounter = await db.$client.prepare(`
    SELECT id, patient_id, visit_id, appointment_id, provider_id,
           status, snapshot_hash, signed_at, addendum_count
    FROM encounters
    WHERE id = ? AND tenant_id = ? AND is_active = 1
    LIMIT 1
  `).bind(id, tenantId).first<{
    id: number;
    patient_id: number;
    visit_id: number | null;
    appointment_id: number | null;
    provider_id: number | null;
    status: string;
    snapshot_hash: string | null;
    signed_at: string | null;
    addendum_count: number;
  }>();
  if (!encounter) throw new HTTPException(404, { message: 'Encounter not found' });
  if (encounter.status !== 'signed' || !encounter.signed_at || !encounter.snapshot_hash) {
    throw new HTTPException(409, { message: 'Addenda can only be attached to a signed encounter' });
  }

  if (role === 'doctor') {
    const doctor = await db.$client.prepare(`
      SELECT id
      FROM doctors
      WHERE tenant_id = ? AND user_id = ? AND is_active = 1
      LIMIT 1
    `).bind(tenantId, userId).first<{ id: number }>();
    if (!doctor || Number(doctor.id) !== Number(encounter.provider_id)) {
      throw new HTTPException(403, { message: 'Only the signing doctor or hospital administration can add an addendum' });
    }
  }

  const previousAddendum = await db.$client.prepare(`
    SELECT addendum_hash
    FROM encounter_addenda
    WHERE tenant_id = ? AND encounter_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).bind(tenantId, id).first<{ addendum_hash: string }>();
  const previousHash = previousAddendum?.addendum_hash ?? encounter.snapshot_hash;
  const createdAt = getFullTimestampGMT6();
  const addendumPayload = JSON.stringify({
    encounterId: id,
    previousHash,
    authorId: Number(userId),
    reason: body.reason,
    content: body.content,
    createdAt,
  });
  const addendumHash = await sha256Hex(addendumPayload);

  try {
    await db.$client.batch([
      db.$client.prepare(`
        INSERT INTO encounter_addenda (
          tenant_id, encounter_id, author_id, reason, content,
          previous_snapshot_hash, addendum_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        id,
        Number(userId),
        body.reason,
        body.content,
        previousHash,
        addendumHash,
        createdAt,
      ),
      db.$client.prepare(`
        UPDATE encounters
        SET addendum_count = addendum_count + 1, updated_at = ?
        WHERE id = ? AND tenant_id = ? AND status = 'signed' AND is_active = 1
      `).bind(createdAt, id, tenantId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique constraint|constraint failed/i.test(message)) {
      throw new HTTPException(409, { message: 'This encounter addendum was already recorded' });
    }
    throw error;
  }

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'encounter_addenda', id, null, {
    encounterId: id,
    patientId: encounter.patient_id,
    visitId: encounter.visit_id,
    appointmentId: encounter.appointment_id,
    hasReason: true,
    chainedToPreviousHash: true,
  });

  return c.json({
    Results: {
      encounterId: id,
      addendumHash,
      previousHash,
      createdAt,
    },
  }, 201);
});

// ─── Get full encounter summary (aggregated clinical data) ────────────────

encounterRoutes.get('/:id/summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const encounter = await db.$client
    .prepare('SELECT * FROM encounters WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first<Record<string, unknown>>();

  if (!encounter) throw new HTTPException(404, { message: 'Encounter not found' });

  const visitId = encounter.visit_id as number | null;
  const patientId = encounter.patient_id as number;

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with db.$client.batch() for fetching encounter clinical data.
  // Why: Promise.all() sends up to 6 separate HTTP network requests to Cloudflare D1.
  //      db.$client.batch() sends a single network request containing all queries.
  // Impact: Eliminates multiple network round-trips, significantly reducing latency and
  //         making the encounter summary load much faster.
  const batchStatements = [];

  if (visitId) {
    batchStatements.push(
      db.$client.prepare('SELECT * FROM clinical_vitals WHERE tenant_id = ? AND visit_id = ? AND is_active = 1 ORDER BY taken_at DESC').bind(tenantId, visitId)
    );
  } else {
    batchStatements.push(db.$client.prepare('SELECT 1 WHERE 0')); // Dummy query that returns no rows
  }

  batchStatements.push(
    db.$client.prepare('SELECT * FROM clinical_notes WHERE tenant_id = ? AND patient_id = ? AND visit_id = ? AND is_active = 1 ORDER BY created_at DESC').bind(tenantId, patientId, visitId ?? 0),
    db.$client.prepare('SELECT * FROM patient_allergies WHERE tenant_id = ? AND patient_id = ? AND is_active = 1').bind(tenantId, patientId),
    db.$client.prepare("SELECT * FROM patient_active_medications WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 AND status = 'active'").bind(tenantId, patientId),
    db.$client.prepare("SELECT * FROM cln_patient_clinical_info WHERE tenant_id = ? AND patient_id = ? AND is_active = 1").bind(tenantId, patientId)
  );

  if (visitId) {
    batchStatements.push(
      db.$client.prepare('SELECT * FROM clinical_images WHERE tenant_id = ? AND visit_id = ? AND is_active = 1').bind(tenantId, visitId)
    );
  } else {
    batchStatements.push(db.$client.prepare('SELECT 1 WHERE 0')); // Dummy query that returns no rows
  }

  let vitalsRes, notesRes, allergiesRes, medicationsRes, problemsRes, imagesRes;
  try {
    const results = await db.$client.batch(batchStatements);
    [vitalsRes, notesRes, allergiesRes, medicationsRes, problemsRes, imagesRes] = results;
  } catch (e) {
    // If the entire batch fails (e.g., missing cln_patient_clinical_info table), we can fallback to individual Promise.all to isolate the failing query
    // This maintains the previous behavior where `cln_patient_clinical_info` might fail but caught individually.
    const [v, n, a, m, p, i] = await Promise.all([
      visitId
        ? db.$client.prepare('SELECT * FROM clinical_vitals WHERE tenant_id = ? AND visit_id = ? AND is_active = 1 ORDER BY taken_at DESC').bind(tenantId, visitId).all()
        : Promise.resolve({ results: [] }),
      db.$client.prepare('SELECT * FROM clinical_notes WHERE tenant_id = ? AND patient_id = ? AND visit_id = ? AND is_active = 1 ORDER BY created_at DESC').bind(tenantId, patientId, visitId ?? 0).all(),
      db.$client.prepare('SELECT * FROM patient_allergies WHERE tenant_id = ? AND patient_id = ? AND is_active = 1').bind(tenantId, patientId).all(),
      db.$client.prepare("SELECT * FROM patient_active_medications WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 AND status = 'active'").bind(tenantId, patientId).all(),
      db.$client.prepare("SELECT * FROM cln_patient_clinical_info WHERE tenant_id = ? AND patient_id = ? AND is_active = 1").bind(tenantId, patientId).all().catch(() => ({ results: [] })),
      visitId
        ? db.$client.prepare('SELECT * FROM clinical_images WHERE tenant_id = ? AND visit_id = ? AND is_active = 1').bind(tenantId, visitId).all()
        : Promise.resolve({ results: [] }),
    ]);
    vitalsRes = v; notesRes = n; allergiesRes = a; medicationsRes = m; problemsRes = p; imagesRes = i;
  }

  const vitals = vitalsRes || { results: [] };
  const notes = notesRes || { results: [] };
  const allergies = allergiesRes || { results: [] };
  const medications = medicationsRes || { results: [] };
  const problems = problemsRes || { results: [] };
  const images = imagesRes || { results: [] };

  return c.json({
    Results: {
      encounter,
      vitals: vitals.results,
      notes: notes.results,
      allergies: allergies.results,
      activeMedications: medications.results,
      problems: problems.results,
      images: images.results,
    },
  });
});

// ─── Create encounter ──────────────────────────────────────────────────────

encounterRoutes.post('/', zValidator('json', createEncounterSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO encounters (
      tenant_id, patient_id, visit_id, encounter_type, status,
      start_time, provider_id, department_id,
      reason_for_visit, chief_complaint,
      is_active, created_by, created_at
    ) VALUES (?, ?, ?, ?, 'in_progress', datetime('now', '+6 hours'), ?, ?, ?, ?, 1, ?, datetime('now', '+6 hours'))
  `).bind(
    tenantId, d.patientId, d.visitId ?? null,
    d.encounterType ?? 'outpatient',
    d.providerId ?? null, d.departmentId ?? null,
    d.reasonForVisit ?? null, d.chiefComplaint ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ─── Update encounter ──────────────────────────────────────────────────────

encounterRoutes.put('/:id', zValidator('json', updateEncounterSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT status, signed_at FROM encounters WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first<{ status: string; signed_at: string | null }>();
  if (!ex) throw new HTTPException(404, { message: 'Encounter not found' });
  if (ex.status === 'signed' || ex.signed_at) {
    throw new HTTPException(409, {
      message: 'Signed encounters are immutable. Record corrections as an addendum.',
    });
  }

  const data = c.req.valid('json');
  const colMap: Record<string, string> = {
    status: 'status', encounterType: 'encounter_type',
    providerId: 'provider_id', departmentId: 'department_id',
    reasonForVisit: 'reason_for_visit', chiefComplaint: 'chief_complaint',
    endTime: 'end_time', dispositionCode: 'disposition_code',
    dispositionNote: 'disposition_note',
  };

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && colMap[key]) {
      sets.push(`${colMap[key]} = ?`);
      vals.push(val as string | number);
    }
  }

  if (data.status === 'completed' && !data.endTime) {
    sets.push("end_time = datetime('now', '+6 hours')");
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    await db.$client
      .prepare(`UPDATE encounters SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...vals).run();
  }

  return c.json({ Results: true });
});

// ─── Complete encounter (convenience) ──────────────────────────────────────

encounterRoutes.put('/:id/complete', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  let disposition: { code?: string; note?: string } = {};
  try {
    disposition = await c.req.json();
  } catch { /* no body is fine */ }

  const ex = await db.$client
    .prepare("SELECT status FROM encounters WHERE id = ? AND tenant_id = ? AND is_active = 1 AND status = 'in_progress'")
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Active encounter not found' });

  await db.$client
    .prepare(`UPDATE encounters
      SET status = 'completed', end_time = datetime('now', '+6 hours'),
          disposition_code = ?, disposition_note = ?, updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?`)
    .bind(disposition.code ?? null, disposition.note ?? null, id, tenantId).run();

  return c.json({ Results: true });
});

// ─── Soft delete encounter ─────────────────────────────────────────────────

encounterRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const userId = requireUserId(c);
  const ex = await db.$client
    .prepare('SELECT status, signed_at, patient_id, visit_id, appointment_id FROM encounters WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first<{
      status: string;
      signed_at: string | null;
      patient_id: number;
      visit_id: number | null;
      appointment_id: number | null;
    }>();
  if (!ex) throw new HTTPException(404, { message: 'Encounter not found' });
  if (ex.status === 'signed' || ex.signed_at) {
    await createAuditLog(c.env, tenantId, userId, 'BLOCKED_DELETE', 'encounters', id, {
      status: ex.status,
    }, {
      patientId: ex.patient_id,
      visitId: ex.visit_id,
      appointmentId: ex.appointment_id,
      outcome: 'blocked_signed_encounter_delete',
    });
    throw new HTTPException(409, {
      message: 'Signed encounters are immutable and cannot be deleted. Use an addendum for corrections.',
    });
  }

  await db.$client
    .prepare("UPDATE encounters SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?")
    .bind(id, tenantId).run();

  return c.json({ Results: true });
});
