import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const clinicalSummaryRoutes = new Hono<NursingEnv>();

clinicalSummaryRoutes.get('/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));
  if (isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  let vitals: any[] = [];
  let recentMeds: any[] = [];
  let recentLabs: any[] = [];
  let diagnoses: any[] = [];
  let allergies: any[] = [];
  let activeOrders: any[] = [];

  try {
    // Replaced Promise.all() with db.$client.batch() for clinical summary fetch.
    // Why: Promise.all() sends 6 separate HTTP network requests to Cloudflare D1.
    const batchResults = await db.$client.batch([
      db.$client.prepare(`
        SELECT systolic, diastolic, temperature, heart_rate, spo2, respiratory_rate, weight, recorded_at
        FROM patient_vitals
        WHERE tenant_id = ? AND patient_id = ?
        ORDER BY recorded_at DESC LIMIT 5
      `).bind(tenantId, patientId),

      db.$client.prepare(`
        SELECT medication_name, dose, route, frequency, status, administered_on, created_at
        FROM nur_medication_admin
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC LIMIT 10
      `).bind(tenantId, patientId),

      db.$client.prepare(`
        SELECT lo.id, lo.ordered_at,
               GROUP_CONCAT(loi.test_name, ', ') AS tests,
               GROUP_CONCAT(loi.status, ', ') AS statuses
        FROM lab_orders lo
        JOIN lab_order_items loi ON loi.lab_order_id = lo.id
        WHERE lo.tenant_id = ? AND lo.patient_id = ?
        GROUP BY lo.id
        ORDER BY lo.ordered_at DESC LIMIT 5
      `).bind(tenantId, patientId),

      db.$client.prepare(`
        SELECT final_diagnosis, icd10_code, created_at
        FROM nursing_final_diagnoses
        WHERE tenant_id = ? AND patient_id = ?
        ORDER BY created_at DESC LIMIT 5
      `).bind(String(tenantId), patientId),

      db.$client.prepare(`
        SELECT allergy_type, allergen, severity, reaction
        FROM patient_allergies
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC
      `).bind(tenantId, patientId),

      db.$client.prepare(`
        SELECT medication_name, generic_name, dose, route, frequency, priority, status
        FROM cln_medication_orders
        WHERE tenant_id = ? AND patient_id = ? AND status = 'active'
        ORDER BY created_at DESC
      `).bind(tenantId, patientId)
    ]);

    vitals = batchResults[0]?.results || [];
    recentMeds = batchResults[1]?.results || [];
    recentLabs = batchResults[2]?.results || [];
    diagnoses = batchResults[3]?.results || [];
    allergies = batchResults[4]?.results || [];
    activeOrders = batchResults[5]?.results || [];
  } catch (err) {
    // If the entire batch fails, these remain empty arrays as initialized above
    console.error('Batch fetch failed for clinical summary:', err);
  }

  return c.json({
    Results: {
      patient_id: patientId,
      vitals,
      recent_medications: recentMeds,
      recent_labs: recentLabs,
      diagnoses,
      allergies,
      active_orders: activeOrders,
    },
  });
});
