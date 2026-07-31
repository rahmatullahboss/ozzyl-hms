import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const patientSummaryRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

patientSummaryRoutes.get('/:id/summary', async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);

  try {
    const db = getDb(c.env.DB);
    const patientId = Number(id);
    if (Number.isNaN(patientId) || patientId <= 0) {
      throw new HTTPException(400, { message: 'Invalid patient id' });
    }

    const patient = await db.$client.prepare(`
      SELECT id, name, patient_code, date_of_birth, gender, blood_group, mobile, address
      FROM patients WHERE id = ? AND tenant_id = ?
    `).bind(patientId, tenantId).first();

    if (!patient) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    // Replaced Promise.all() with db.$client.batch() for patient summary fetch.
    // Why: Promise.all() sends 7 separate HTTP network requests to Cloudflare D1.
    const batchResults = await db.$client.batch([
      db.$client.prepare(`
        SELECT * FROM clinical_vitals WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 ORDER BY taken_at DESC LIMIT 1
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT * FROM patient_allergies WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT * FROM patient_active_medications WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 AND status = 'active'
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT * FROM visits WHERE tenant_id = ? AND patient_id = ? ORDER BY created_at DESC LIMIT 5
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT * FROM ClinicalDiagnosis WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1 ORDER BY CreatedOn DESC LIMIT 5
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT p.*, (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id = p.id) AS item_count
        FROM prescriptions p WHERE p.tenant_id = ? AND p.patient_id = ? ORDER BY p.created_at DESC LIMIT 1
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT loi.*, lo.order_no, lo.order_date, ltc.name as test_name
        FROM lab_order_items loi
        JOIN lab_orders lo ON loi.lab_order_id = lo.id
        LEFT JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
        WHERE lo.tenant_id = ? AND lo.patient_id = ?
        ORDER BY lo.created_at DESC, loi.id DESC LIMIT 10
      `).bind(tenantId, patientId),
    ]);

    return c.json({
      patient,
      vitals: batchResults[0]?.results?.[0] ?? null,
      allergies: batchResults[1]?.results ?? [],
      active_medications: batchResults[2]?.results ?? [],
      recent_visits: batchResults[3]?.results ?? [],
      recent_diagnoses: batchResults[4]?.results ?? [],
      last_prescription: batchResults[5]?.results?.[0] ?? null,
      recent_lab_results: batchResults[6]?.results ?? [],
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('patient summary error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch patient summary' });
  }
});

export default patientSummaryRoutes;
