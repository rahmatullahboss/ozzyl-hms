import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { requireRole, NURSING_ROLES } from '../../../middleware/rbac';


type NursingEnv = { Bindings: Env; Variables: Variables };

const wardsRoutes = new Hono<NursingEnv>();

wardsRoutes.use('/*', requireRole(...NURSING_ROLES));

// GET /wards — list all wards with bed count
wardsRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(`
    SELECT
      MIN(id) AS id,
      tenant_id,
      ward_name AS name,
      ward_name,
      MIN(floor) AS floor,
      1 AS is_active,
      COUNT(*) AS total_beds,
      SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied_beds,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available_beds
    FROM beds
    WHERE tenant_id = ?
    GROUP BY tenant_id, ward_name
    ORDER BY ward_name
  `).bind(tenantId).all();
  return c.json({ Results: results, wards: results });
});

// GET /wards/bed-grid — all beds with patient, vitals, med-due, alert status for visual grid
wardsRoutes.get('/bed-grid', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results: beds } = await db.$client.prepare(`
    SELECT
      b.id AS bed_id,
      b.ward_name,
      b.bed_number,
      b.bed_type,
      b.status AS bed_status,
      b.floor,
      b.rate_per_day,
      a.id AS admission_id,
      a.status AS admission_status,
      a.admission_date,
      a.provisional_diagnosis,
      p.id AS patient_id,
      p.name AS patient_name,
      p.patient_code,
      p.blood_group,
      d.name AS doctor_name
    FROM beds b
    LEFT JOIN admissions a ON a.bed_id = b.id AND a.tenant_id = b.tenant_id AND a.status IN ('admitted', 'critical')
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = b.tenant_id
    WHERE b.tenant_id = ?
    ORDER BY b.ward_name, b.bed_number
  `).bind(tenantId).all();

  const occupiedBeds = (beds as Record<string, unknown>[]).filter(b => b.patient_id);
  const occupiedPatientIds = occupiedBeds.map(b => b.patient_id);
  const batchStatements: ReturnType<typeof db.$client.prepare>[] = [];

  for (const bed of occupiedBeds) {
    batchStatements.push(
      db.$client.prepare(`
        SELECT systolic, diastolic, temperature, heart_rate, spo2, respiratory_rate, recorded_at
        FROM patient_vitals WHERE tenant_id = ? AND patient_id = ?
        ORDER BY recorded_at DESC LIMIT 1
      `).bind(tenantId, bed.patient_id)
    );
    batchStatements.push(
      db.$client.prepare(`
        SELECT COUNT(*) AS cnt FROM vital_alerts
        WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
      `).bind(tenantId, bed.patient_id)
    );
    batchStatements.push(
      db.$client.prepare(`
        SELECT COUNT(*) AS cnt FROM nur_medication_admin
        WHERE tenant_id = ? AND patient_id = ? AND status = 'pending'
          AND administered_on <= datetime('now', '+6 hours')
      `).bind(tenantId, bed.patient_id)
    );
  }

  // Batch query for isolation (care_plans) and discharge-planned (discharge_checklists)
  let isolationSet = new Set<number>();
  let dischargePlannedSet = new Set<number>();
  if (occupiedPatientIds.length > 0) {
    const placeholders = occupiedPatientIds.map(() => '?').join(',');
    try {
      const isolationQuery = await db.$client.prepare(`
        SELECT DISTINCT patient_id FROM care_plans
        WHERE tenant_id = ? AND patient_id IN (${placeholders}) AND isolation_type IS NOT NULL AND isolation_type != ''
      `).bind(tenantId, ...occupiedPatientIds).all<{ patient_id: number }>();
      isolationSet = new Set((isolationQuery.results || []).map(r => r.patient_id));
    } catch { /* care_plans table may not exist */ }

    try {
      const dischargeQuery = await db.$client.prepare(`
        SELECT DISTINCT patient_id FROM discharge_checklists
        WHERE tenant_id = ? AND patient_id IN (${placeholders}) AND (discharge_status IS NULL OR discharge_status = 'planned')
      `).bind(tenantId, ...occupiedPatientIds).all<{ patient_id: number }>();
      dischargePlannedSet = new Set((dischargeQuery.results || []).map(r => r.patient_id));
    } catch { /* discharge_checklists table may not exist */ }
  }

  let batchResults: { results: Record<string, unknown>[] }[] = [];
  if (batchStatements.length > 0) {
    try {
      batchResults = await db.$client.batch(batchStatements);
    } catch (err) {
      console.warn('nur_medication_admin batch failed (table may not exist):', err);
      batchResults = [];
    }
  }

  const enrichedBeds = (beds as Record<string, unknown>[]).map(bed => {
    if (!bed.patient_id) {
      return { ...bed, latestVitals: null, activeAlerts: 0, medDueCount: 0, statusColor: 'empty', isolation: false, fall_risk: false, is_diabetic: false, npo: false, allergy_count: 0 };
    }
    const idx = occupiedBeds.indexOf(bed);
    const vitals = batchResults[idx * 3]?.results[0] ?? null;
    const alerts = (batchResults[idx * 3 + 1]?.results[0] as { cnt: number })?.cnt ?? 0;
    const medDue = (batchResults[idx * 3 + 2]?.results[0] as { cnt: number })?.cnt ?? 0;
    const pid = bed.patient_id as number;

    let statusColor = 'stable';
    if (alerts > 0 || bed.admission_status === 'critical') {
      statusColor = 'critical';
    } else if (isolationSet.has(pid)) {
      statusColor = 'isolation';
    } else if (dischargePlannedSet.has(pid)) {
      statusColor = 'discharge-planned';
    } else if (medDue > 0) {
      statusColor = 'medication-due';
    } else if (vitals) {
      // Check for abnormal vitals (not critical, but outside normal range)
      const temp = vitals.temperature as number | undefined;
      const sys = vitals.systolic as number | undefined;
      const dia = vitals.diastolic as number | undefined;
      const hr = vitals.heart_rate as number | undefined;
      const spo2 = vitals.spo2 as number | undefined;
      const isAbnormal =
        (temp != null && (temp > 100.4 || temp < 96)) ||
        (sys != null && (sys > 140 || sys < 90)) ||
        (dia != null && (dia > 90 || dia < 60)) ||
        (hr != null && (hr > 100 || hr < 55)) ||
        (spo2 != null && spo2 < 95);
      if (isAbnormal) statusColor = 'vitals-abnormal';
    }

    return {
      ...bed,
      latestVitals: vitals,
      activeAlerts: alerts,
      medDueCount: medDue,
      statusColor,
      isolation: isolationSet.has(pid),
      fall_risk: false,
      is_diabetic: false,
      npo: false,
      allergy_count: 0,
    };
  });

  return c.json({ Results: enrichedBeds });
});

// GET /wards/:id — ward details with beds and patients
wardsRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ward ID' });

  const ward = await db.$client.prepare(`
    SELECT
      MIN(id) AS id,
      tenant_id,
      ward_name AS name,
      ward_name,
      MIN(floor) AS floor,
      1 AS is_active,
      COUNT(*) AS total_beds,
      SUM(CASE WHEN status = 'occupied' THEN 1 ELSE 0 END) AS occupied_beds,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available_beds
    FROM beds
    WHERE tenant_id = ?
      AND ward_name = (SELECT ward_name FROM beds WHERE id = ? AND tenant_id = ?)
    GROUP BY tenant_id, ward_name
  `).bind(tenantId, id, tenantId).first();
  if (!ward) throw new HTTPException(404, { message: 'Ward not found' });

  const { results: beds } = await db.$client.prepare(`
    SELECT b.*,
      p.name AS patient_name,
      p.patient_code,
      a.admission_date,
      a.id AS admission_id
    FROM beds b
    LEFT JOIN admissions a ON a.bed_id = b.id AND a.tenant_id = b.tenant_id AND a.status = 'admitted'
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    WHERE b.tenant_id = ? AND b.ward_name = ?
    ORDER BY b.bed_number
  `).bind(tenantId, (ward as { ward_name: string }).ward_name).all();

  return c.json({ Results: { ...ward, beds } });
});

export default wardsRoutes;
