import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole, NURSING_ROLES } from '../../middleware/rbac';


const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── RBAC: Restrict all nurse station endpoints to nursing staff ─────────────
app.use('/*', requireRole(...NURSING_ROLES));

// ─── Vitals schema ───────────────────────────────────────────────────────────
const vitalsSchema = z.object({
  patient_id:       z.number().int().positive(),
  admission_id:     z.number().int().positive().optional(),
  systolic:         z.number().int().min(0).max(300).optional(),
  diastolic:        z.number().int().min(0).max(200).optional(),
  temperature:      z.number().min(30).max(110).optional(),
  heart_rate:       z.number().int().min(0).max(250).optional(),
  spo2:             z.number().int().min(0).max(100).optional(),
  respiratory_rate: z.number().int().min(0).max(60).optional(),
  weight:           z.number().min(0).max(500).optional(),
  notes:            z.string().max(500).optional(),
});

const bulkVitalsSchema = z.object({
  entries: z.array(vitalsSchema).min(1).max(100),
});

function normalizeTemperatureF(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value <= 45) return Math.round(((value * 9 / 5) + 32) * 10) / 10;
  return value;
}

// ─── Alert checker ───────────────────────────────────────────────────────────
interface AlertRule {
  id: number;
  vital_type: string;
  min_value: number | null;
  max_value: number | null;
  severity: string;
}

async function checkVitalsAgainstRules(
  db: D1Database,
  tenantId: string,
  patientId: number,
  vitalId: number,
  vitals: Record<string, number | undefined>
): Promise<number> {
  // Get applicable rules: tenant-specific first, then global (tenant_id=0)
  const { results: rules } = await db.prepare(`
    SELECT id, vital_type, min_value, max_value, severity
    FROM vital_alert_rules
    WHERE (tenant_id = ? OR tenant_id = 0) AND is_active = 1
    ORDER BY tenant_id DESC
  `).bind(tenantId).all<AlertRule>();

  let alertCount = 0;
  const insertStatements: ReturnType<typeof db.prepare>[] = [];

  for (const rule of rules) {
    const value = vitals[rule.vital_type];
    if (value === undefined || value === null) continue;

    const breached =
      (rule.min_value !== null && value < rule.min_value) ||
      (rule.max_value !== null && value > rule.max_value);

    if (breached) {
      insertStatements.push(
        db.prepare(`
          INSERT INTO vital_alerts
            (tenant_id, patient_id, vital_id, rule_id, vital_type,
             recorded_value, threshold_min, threshold_max, severity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          tenantId, patientId, vitalId, rule.id, rule.vital_type,
          value, rule.min_value, rule.max_value, rule.severity
        )
      );
      alertCount++;
    }
  }

  // Batch-insert all alerts atomically (avoids N sequential roundtrips)
  if (insertStatements.length > 0) {
    await db.batch(insertStatements);
  }

  return alertCount;
}

// GET /api/nurse-station/dashboard — active inpatients with latest vitals
app.get('/dashboard', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results: admissions } = await db.$client.prepare(`
    SELECT a.id AS admission_id, a.admission_no, a.patient_id, a.status AS admission_status,
           a.provisional_diagnosis,
           p.name AS patient_name, p.patient_code,
           b.ward_name, b.bed_number,
           d.name AS doctor_name
    FROM admissions a
    LEFT JOIN patients p ON a.patient_id = p.id AND p.tenant_id = a.tenant_id
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON a.doctor_id = d.id AND d.tenant_id = a.tenant_id
    WHERE a.tenant_id = ? AND a.status IN ('admitted', 'critical')
    ORDER BY CASE a.status WHEN 'critical' THEN 0 ELSE 1 END, a.admission_date DESC
  `).bind(tenantId).all();

  // Add latest vitals + active alert count for each patient
  const patients = [];
  if (admissions.length > 0) {
    const batchStatements = [];
    for (const adm of admissions as Record<string, unknown>[]) {
      batchStatements.push(
        db.$client.prepare(`
          SELECT systolic, diastolic, temperature, heart_rate, spo2, respiratory_rate, recorded_at
          FROM patient_vitals
          WHERE tenant_id = ? AND patient_id = ?
          ORDER BY recorded_at DESC LIMIT 1
        `).bind(tenantId, adm.patient_id),
        db.$client.prepare(`
          SELECT COUNT(*) AS cnt FROM vital_alerts
          WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
        `).bind(tenantId, adm.patient_id)
      );
    }
    const batchResults = await db.$client.batch(batchStatements);
    for (let i = 0; i < admissions.length; i++) {
      const adm = admissions[i];
      const vitalRow = batchResults[i * 2].results[0];
      const alertRow = batchResults[i * 2 + 1].results[0] as { cnt: number } | undefined;
      patients.push({
        ...adm,
        latestVitals: vitalRow ?? null,
        activeAlerts: alertRow?.cnt ?? 0,
      });
    }
  }

  const pendingVitals = patients.filter(p => !p.latestVitals).length;

  // Total active alerts
  const totalAlerts = await db.$client.prepare(`
    SELECT COUNT(*) AS cnt FROM vital_alerts WHERE tenant_id = ? AND status = 'active'
  `).bind(tenantId).first<{ cnt: number }>();

  return c.json({
    patients,
    stats: {
      activePatients: patients.length,
      pendingVitals,
      roundsCompleted: patients.length - pendingVitals,
      totalRounds: patients.length,
      activeAlerts: totalAlerts?.cnt ?? 0,
    },
  });
});

// GET /api/nurse-station/vitals?limit=10
app.get('/vitals', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const limit = Math.min(Number(c.req.query('limit')) || 10, 100);

  const { results } = await db.$client.prepare(`
    SELECT v.*, p.name AS patient_name
    FROM patient_vitals v
    LEFT JOIN patients p ON v.patient_id = p.id AND p.tenant_id = v.tenant_id
    WHERE v.tenant_id = ?
    ORDER BY v.recorded_at DESC LIMIT ?
  `).bind(tenantId, limit).all();

  return c.json({ vitals: results });
});

// POST /api/nurse-station/vitals — Record vitals + auto-check alerts
app.post('/vitals', zValidator('json', vitalsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = requireUserId(c);
  const role     = c.get('role');

  const allowedRoles = ['nurse', 'doctor', 'md', 'hospital_admin'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to record vitals' });
  }

  const body     = c.req.valid('json');

  const temperatureF = normalizeTemperatureF(body.temperature);

  const result = await db.$client.prepare(`
    INSERT INTO patient_vitals
      (tenant_id, patient_id, admission_id, systolic, diastolic, temperature,
       heart_rate, spo2, respiratory_rate, weight, notes, recorded_by, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, body.patient_id, body.admission_id ?? null,
    body.systolic ?? null, body.diastolic ?? null,
    temperatureF ?? null, body.heart_rate ?? null,
    body.spo2 ?? null, body.respiratory_rate ?? null,
    body.weight ?? null, body.notes ?? null,
    userId ?? 'system', 'recorded'
  ).run();

  const vitalId = result.meta.last_row_id as number;

  // Auto-check against alert rules
  const alertCount = await checkVitalsAgainstRules(
    c.env.DB, tenantId, body.patient_id, vitalId,
    {
      systolic:         body.systolic,
      diastolic:        body.diastolic,
      temperature:      temperatureF,
      heart_rate:       body.heart_rate,
      spo2:             body.spo2,
      respiratory_rate: body.respiratory_rate,
    }
  );

  return c.json({ success: true, id: vitalId, alertsGenerated: alertCount }, 201);
});

// POST /api/nurse-station/vitals/bulk — round-entry vitals for multiple patients
app.post('/vitals/bulk', zValidator('json', bulkVitalsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  if (!role || !['nurse', 'doctor', 'md', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to record vitals' });
  }
  const { entries } = c.req.valid('json');
  const stmts = entries.map((body) => {
    const temperatureF = normalizeTemperatureF(body.temperature);
    return db.$client.prepare(`
    INSERT INTO patient_vitals
      (tenant_id, patient_id, admission_id, systolic, diastolic, temperature,
       heart_rate, spo2, respiratory_rate, weight, notes, recorded_by, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, body.patient_id, body.admission_id ?? null,
    body.systolic ?? null, body.diastolic ?? null,
    temperatureF ?? null, body.heart_rate ?? null,
    body.spo2 ?? null, body.respiratory_rate ?? null,
    body.weight ?? null, body.notes ?? null,
    userId ?? 'system', 'round_entry',
  );
  });
  await db.$client.batch(stmts);
  return c.json({ success: true, count: entries.length }, 201);
});

// GET /api/nurse-station/vitals-trends/:patientId — time-series for charting
app.get('/vitals-trends/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId  = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  const days      = Math.min(Number(c.req.query('days')) || 7, 90);

  if (!patientId || isNaN(patientId)) {
    throw new HTTPException(400, { message: 'Valid patientId required' });
  }

  const { results } = await db.$client.prepare(`
    SELECT systolic, diastolic, temperature, heart_rate, spo2,
           respiratory_rate, weight, recorded_at
    FROM patient_vitals
    WHERE tenant_id = ? AND patient_id = ?
      AND recorded_at >= datetime('now', ?)
    ORDER BY recorded_at ASC
  `).bind(tenantId, patientId, `-${days} days`).all();

  // Also fetch alert thresholds for this tenant (graceful fallback if table doesn't exist)
  let rules: Record<string, unknown>[] = [];
  try {
    const rulesResult = await db.$client.prepare(`
      SELECT vital_type, min_value, max_value, severity
      FROM vital_alert_rules
      WHERE (tenant_id = ? OR tenant_id = 0) AND is_active = 1
      ORDER BY tenant_id DESC
    `).bind(tenantId).all();
    rules = rulesResult.results;
  } catch {
    // vital_alert_rules table may not exist if migration 0018 hasn't been applied
  }

  return c.json({ vitals: results, thresholds: rules });
});

// GET /api/nurse-station/active-alerts — unresolved alerts
app.get('/active-alerts', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const limit    = Math.min(Number(c.req.query('limit')) || 50, 200);

  const { results } = await db.$client.prepare(`
    SELECT va.*, p.name AS patient_name, p.patient_code,
           b.ward_name, b.bed_number
    FROM vital_alerts va
    LEFT JOIN patients p ON va.patient_id = p.id AND p.tenant_id = va.tenant_id
    LEFT JOIN admissions a ON a.patient_id = va.patient_id
      AND a.tenant_id = va.tenant_id AND a.status IN ('admitted', 'critical')
    LEFT JOIN beds b ON a.bed_id = b.id AND b.tenant_id = a.tenant_id
    WHERE va.tenant_id = ? AND va.status = 'active'
    ORDER BY CASE va.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
             va.created_at DESC
    LIMIT ?
  `).bind(tenantId, limit).all();

  return c.json({ alerts: results });
});

// PUT /api/nurse-station/alerts/:id/acknowledge
app.put('/alerts/:id/acknowledge', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = requireUserId(c);
  const role     = c.get('role');

  const allowedRoles = ['nurse', 'doctor', 'md', 'hospital_admin'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to acknowledge alerts' });
  }

  const id       = Number(c.req.param('id'));

  await db.$client.prepare(`
    UPDATE vital_alerts SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ? AND status = 'active'
  `).bind(userId, id, tenantId).run();

  return c.json({ success: true });
});

// PUT /api/nurse-station/alerts/:id/resolve
app.put('/alerts/:id/resolve', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role     = c.get('role');

  const allowedRoles = ['nurse', 'doctor', 'md', 'hospital_admin'];
  if (!role || !allowedRoles.includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to resolve alerts' });
  }

  const id       = Number(c.req.param('id'));

  await db.$client.prepare(`
    UPDATE vital_alerts SET status = 'resolved', resolved_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ? AND status IN ('active', 'acknowledged')
  `).bind(id, tenantId).run();

  return c.json({ success: true });
});

export default app;
