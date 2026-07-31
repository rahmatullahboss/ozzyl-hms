import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createVitalsSchema, updateVitalsSchema } from '../../../schemas/clinicalVitals';

type ClinicalEnv = { Bindings: Env; Variables: Variables };
export const vitalsRoutes = new Hono<ClinicalEnv>();

// ─── List vitals for a patient ─────────────────────────────────────────────

vitalsRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  const visitId = c.req.query('visitId');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);

  if (!patientId || isNaN(Number(patientId)))
    throw new HTTPException(400, { message: 'patientId query param is required' });

  let query = 'SELECT * FROM clinical_vitals WHERE tenant_id = ? AND patient_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId, Number(patientId)];

  if (visitId && !isNaN(Number(visitId))) {
    query += ' AND visit_id = ?';
    params.push(Number(visitId));
  }

  query += ' ORDER BY taken_at DESC LIMIT ?';
  params.push(limit);

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

// ─── Get single vital record ───────────────────────────────────────────────

vitalsRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const row = await db.$client
    .prepare('SELECT * FROM clinical_vitals WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();

  if (!row) throw new HTTPException(404, { message: 'Vital record not found' });
  return c.json({ Results: row });
});

// ─── Vitals trend for a patient ────────────────────────────────────────────

vitalsRoutes.get('/trend/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  const days = Math.min(Number(c.req.query('days')) || 30, 365);
  const { results } = await db.$client
    .prepare(`SELECT id, temperature, pulse, blood_pressure_systolic, blood_pressure_diastolic,
      respiratory_rate, spo2, weight, height, bmi, pain_scale, blood_sugar, taken_at
      FROM clinical_vitals
      WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
      AND taken_at >= datetime('now', '-' || ? || ' days')
      ORDER BY taken_at ASC`)
    .bind(tenantId, patientId, days).all();

  return c.json({ Results: results });
});

// ─── Create vital record ───────────────────────────────────────────────────

vitalsRoutes.post('/', zValidator('json', createVitalsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const d = c.req.valid('json');

  const bmi = (d.weight && d.height && d.height > 0)
    ? Math.round((d.weight / ((d.height / 100) ** 2)) * 10) / 10
    : null;

  const result = await db.$client.prepare(`
    INSERT INTO clinical_vitals (
      tenant_id, patient_id, visit_id, temperature, pulse,
      blood_pressure_systolic, blood_pressure_diastolic, respiratory_rate,
      spo2, weight, height, bmi, pain_scale, blood_sugar, notes,
      taken_by, taken_at, source, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), 'recorded', 1, datetime('now', '+6 hours'))
  `).bind(
    tenantId, d.patientId, d.visitId ?? null,
    d.temperature ?? null, d.pulse ?? null,
    d.bloodPressureSystolic ?? null, d.bloodPressureDiastolic ?? null,
    d.respiratoryRate ?? null, d.spo2 ?? null,
    d.weight ?? null, d.height ?? null, bmi,
    d.painScale ?? null, d.bloodSugar ?? null,
    d.notes ?? null, userId,
  ).run();

  // Check vital alert rules
  const alerts = await checkVitalAlerts(db, tenantId, d, result.meta.last_row_id as number);

  return c.json({ Results: { id: result.meta.last_row_id, alerts } }, 201);
});

// ─── Update vital record ───────────────────────────────────────────────────

vitalsRoutes.put('/:id', zValidator('json', updateVitalsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT 1 FROM clinical_vitals WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Vital record not found' });

  const data = c.req.valid('json');
  const colMap: Record<string, string> = {
    temperature: 'temperature', pulse: 'pulse',
    bloodPressureSystolic: 'blood_pressure_systolic',
    bloodPressureDiastolic: 'blood_pressure_diastolic',
    respiratoryRate: 'respiratory_rate', spo2: 'spo2',
    weight: 'weight', height: 'height',
    painScale: 'pain_scale', bloodSugar: 'blood_sugar', notes: 'notes',
  };

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined && colMap[key]) {
      sets.push(`${colMap[key]} = ?`);
      vals.push(val as string | number);
    }
  }

  if (data.weight !== undefined || data.height !== undefined) {
    const current = await db.$client
      .prepare('SELECT weight, height FROM clinical_vitals WHERE id = ? AND tenant_id = ?')
      .bind(id, tenantId).first<{ weight: number | null; height: number | null }>();
    const w = data.weight ?? current?.weight;
    const h = data.height ?? current?.height;
    if (w && h && h > 0) {
      sets.push('bmi = ?');
      vals.push(Math.round((w / ((h / 100) ** 2)) * 10) / 10);
    }
  }

  if (sets.length > 0) {
    sets.push("updated_at = datetime('now', '+6 hours')");
    vals.push(id, tenantId);
    await db.$client
      .prepare(`UPDATE clinical_vitals SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`)
      .bind(...vals).run();
  }

  return c.json({ Results: true });
});

// ─── Soft delete vital record ──────────────────────────────────────────────

vitalsRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ID' });

  const ex = await db.$client
    .prepare('SELECT 1 FROM clinical_vitals WHERE id = ? AND tenant_id = ? AND is_active = 1')
    .bind(id, tenantId).first();
  if (!ex) throw new HTTPException(404, { message: 'Vital record not found' });

  await db.$client
    .prepare("UPDATE clinical_vitals SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?")
    .bind(id, tenantId).run();

  return c.json({ Results: true });
});

// ─── Helper: Check vital alert rules ───────────────────────────────────────

async function checkVitalAlerts(
  db: ReturnType<typeof getDb>,
  tenantId: string,
  vitals: Record<string, unknown>,
  vitalId: number,
): Promise<{ alertCount: number }> {
  const { results: rules } = await db.$client
    .prepare('SELECT * FROM vital_alert_rules WHERE tenant_id = ? AND is_active = 1')
    .bind(tenantId).all();

  if (!rules || rules.length === 0) return { alertCount: 0 };

  const vitalMap: Record<string, number | undefined> = {
    temperature: vitals.temperature as number | undefined,
    pulse: vitals.pulse as number | undefined,
    systolic: vitals.bloodPressureSystolic as number | undefined,
    diastolic: vitals.bloodPressureDiastolic as number | undefined,
    respiratory_rate: vitals.respiratoryRate as number | undefined,
    spo2: vitals.spo2 as number | undefined,
    blood_sugar: vitals.bloodSugar as number | undefined,
  };

  let alertCount = 0;
  for (const rule of rules) {
    const r = rule as Record<string, unknown>;
    const value = vitalMap[r.vital_type as string];
    if (value === undefined || value === null) continue;

    const min = r.min_value as number | null;
    const max = r.max_value as number | null;
    const breached = (min !== null && value < min) || (max !== null && value > max);

    if (breached) {
      await db.$client.prepare(`
        INSERT INTO vital_alerts (
          tenant_id, patient_id, vital_id, rule_id, vital_type,
          recorded_value, threshold_min, threshold_max, severity, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now', '+6 hours'))
      `).bind(
        tenantId, vitals.patientId as number, vitalId, r.id as number,
        r.vital_type as string, value, min, max, r.severity as string,
      ).run();
      alertCount++;
    }
  }

  return { alertCount };
}
