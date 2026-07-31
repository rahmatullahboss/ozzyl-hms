import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { eq, and, desc, sql } from 'drizzle-orm';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { clinicalVitals, patients } from '../../db/schema';


const vitals = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createVitalsSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  temperature: z.number().min(30).max(45).optional(), // Celsius
  pulse: z.number().int().min(20).max(300).optional(),
  blood_pressure_systolic: z.number().int().min(40).max(300).optional(),
  blood_pressure_diastolic: z.number().int().min(20).max(200).optional(),
  respiratory_rate: z.number().int().min(4).max(60).optional(),
  spo2: z.number().min(0).max(100).optional(),
  weight: z.number().min(0.1).max(500).optional(), // kg
  height: z.number().min(10).max(300).optional(), // cm
  pain_scale: z.number().int().min(0).max(10).optional(),
  blood_sugar: z.number().min(10).max(1000).optional(), // mg/dL
  notes: z.string().optional(),
});

// ─── Helper: auto-calculate BMI ──────────────────────────────────────────────

function calcBMI(weight?: number, height?: number): number | null {
  if (!weight || !height || height <= 0) return null;
  const heightM = height / 100;
  return Math.round((weight / (heightM * heightM)) * 10) / 10;
}

// ─── GET / — list vitals for a patient/visit ─────────────────────────────────

vitals.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient_id');
  const visitId = c.req.query('visit_id');

  if (!patientId && !visitId) {
    throw new HTTPException(400, { message: 'patient_id or visit_id required' });
  }

  // For complex JOINs with staff alias, use raw sql via db.$client
  // since the staff table may not have a full Drizzle schema mapping yet.
  let query = `
    SELECT v.*, s.name as taken_by_name
    FROM clinical_vitals v
    LEFT JOIN staff s ON v.taken_by = s.id AND s.tenant_id = v.tenant_id
    WHERE v.tenant_id = ? AND v.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (visitId) { query += ' AND v.visit_id = ?'; params.push(visitId); }
  else if (patientId) { query += ' AND v.patient_id = ?'; params.push(patientId); }

  query += ' ORDER BY v.taken_at DESC LIMIT 50';

  const { results } = await db.$client.prepare(query).bind(...params).all();

  // Cross-visit: if visit filtered and <3 records, get previous visit vitals
  if (visitId && results.length < 3 && patientId) {
    const prevVisit = await db.$client.prepare(`
      SELECT id FROM visits WHERE patient_id = ? AND tenant_id = ? AND id != ? ORDER BY visit_date DESC LIMIT 1
    `).bind(patientId, tenantId, visitId).first<{ id: number }>();

    if (prevVisit) {
      const { results: older } = await db.$client.prepare(`
        SELECT v.*, s.name as taken_by_name, 1 as from_previous_visit
        FROM clinical_vitals v
        LEFT JOIN staff s ON v.taken_by = s.id AND s.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.visit_id = ? AND v.is_active = 1
        ORDER BY v.taken_at DESC LIMIT 3
      `).bind(tenantId, prevVisit.id).all();

      return c.json({ vitals: [...results, ...older], has_previous_visit_data: true });
    }
  }

  return c.json({ vitals: results, has_previous_visit_data: false });
});

// ─── GET /latest/:patientId — latest vitals for a patient ────────────────────

vitals.get('/latest/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));

  // Simple single-table query → use Drizzle ORM
  const [latest] = await db.select()
    .from(clinicalVitals)
    .where(
      and(
        eq(clinicalVitals.tenantId, tenantId),
        eq(clinicalVitals.patientId, patientId),
        eq(clinicalVitals.isActive, 1),
      )
    )
    .orderBy(desc(clinicalVitals.takenAt))
    .limit(1);

  if (!latest) return c.json({ vitals: null, message: 'No vitals recorded' });
  return c.json({ vitals: latest });
});

// ─── POST / — record vitals ─────────────────────────────────────────────────

vitals.post('/', zValidator('json', createVitalsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Validate patient belongs to tenant using Drizzle
  const [patient] = await db.select({ id: patients.id })
    .from(patients)
    .where(and(eq(patients.id, data.patient_id), eq(patients.tenantId, tenantId)))
    .limit(1);
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  const bmi = calcBMI(data.weight, data.height);

  // Insert using Drizzle ORM with .returning()
  const [result] = await db.insert(clinicalVitals)
    .values({
      tenantId: tenantId,
      patientId: data.patient_id,
      visitId: data.visit_id ?? null,
      temperature: data.temperature ?? null,
      pulse: data.pulse ?? null,
      bloodPressureSystolic: data.blood_pressure_systolic ?? null,
      bloodPressureDiastolic: data.blood_pressure_diastolic ?? null,
      respiratoryRate: data.respiratory_rate ?? null,
      spo2: data.spo2 ?? null,
      weight: data.weight ?? null,
      height: data.height ?? null,
      bmi,
      painScale: data.pain_scale ?? null,
      bloodSugar: data.blood_sugar ?? null,
      notes: data.notes ?? null,
      takenBy: Number(userId),
      source: 'recorded',
    })
    .returning({ id: clinicalVitals.id });

  return c.json({ id: result.id, bmi, message: 'Vitals recorded' }, 201);
});

// ─── DELETE /:id — soft-delete vitals record ─────────────────────────────────

vitals.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseInt(c.req.param('id'));

  // Verify existence with Drizzle
  const [existing] = await db.select({ id: clinicalVitals.id })
    .from(clinicalVitals)
    .where(and(eq(clinicalVitals.id, id), eq(clinicalVitals.tenantId, tenantId)))
    .limit(1);
  if (!existing) throw new HTTPException(404, { message: 'Vitals record not found' });

  // Soft delete with audit note using Drizzle update + sql template
  await db.update(clinicalVitals)
    .set({
      isActive: 0,
      updatedAt: sql`datetime('now', '+6 hours')`,
      notes: sql`COALESCE(${clinicalVitals.notes}, '') || ' [Removed by user ${userId} at ' || datetime('now', '+6 hours') || ']'`,
    })
    .where(and(eq(clinicalVitals.id, id), eq(clinicalVitals.tenantId, tenantId)));

  return c.json({ success: true, message: 'Vitals record removed' });
});

export default vitals;
