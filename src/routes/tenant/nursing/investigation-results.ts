import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';

type NursingEnv = { Bindings: Env; Variables: Variables };

export const investigationResultsRoutes = new Hono<NursingEnv>();

// GET /api/nursing/patient/:id/clinical-summary
investigationResultsRoutes.get('/:patientId/clinical-summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  if (!patientId || Number.isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  let vitals: any[] = [];
  let medications: any[] = [];
  let labs: any[] = [];
  let diagnoses: any[] = [];
  let allergies: any[] = [];

  try {
    // Replaced Promise.all() with db.$client.batch() for clinical summary fetch.
    // Why: Promise.all() sends 5 separate HTTP network requests to Cloudflare D1.
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
        SELECT lo.id, lo.ordered_at, GROUP_CONCAT(loi.test_name, ', ') AS tests,
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
      `).bind(tenantId, patientId)
    ]);

    vitals = batchResults[0]?.results || [];
    medications = batchResults[1]?.results || [];
    labs = batchResults[2]?.results || [];
    diagnoses = batchResults[3]?.results || [];
    allergies = batchResults[4]?.results || [];
  } catch (err) {
    console.error('Batch fetch failed for investigation results clinical summary:', err);
  }

  return c.json({ Results: { patient_id: patientId, vitals, medications, labs, diagnoses, allergies } });
});

// GET /api/nursing/patient/:id/investigation-results
// Aggregates lab + radiology result rows for the nurse's patient view.
investigationResultsRoutes.get('/:patientId/investigation-results', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  if (!patientId || Number.isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });
  const from = c.req.query('from_date');
  const to = c.req.query('to_date');

  const dateClause = from && to ? ' AND DATE(lo.ordered_at) BETWEEN ? AND ?' : '';
  const labParams: (string | number)[] = [tenantId, patientId];
  if (from && to) labParams.push(from, to);

  const labs = await db.$client.prepare(`
    SELECT 'lab' AS source, lo.id AS order_id, lo.order_no, lo.ordered_at AS ordered_at,
           loi.test_name AS item_name, loi.status, loi.result, loi.result_unit,
           loi.normal_range, loi.verified_at
    FROM lab_orders lo
    JOIN lab_order_items loi ON loi.lab_order_id = lo.id
    WHERE lo.tenant_id = ? AND lo.patient_id = ?${dateClause}
    ORDER BY lo.ordered_at DESC
    LIMIT 100
  `).bind(...labParams).all().then(r => r.results).catch(() => []);

  const radioDateClause = from && to ? ' AND DATE(rr.imaging_date) BETWEEN ? AND ?' : '';
  const radioParams: (string | number)[] = [tenantId, patientId];
  if (from && to) radioParams.push(from, to);
  const radiology = await db.$client.prepare(`
    SELECT 'radiology' AS source, rr.id AS order_id, rr.radiology_number AS order_no,
           rr.imaging_date AS ordered_at, COALESCE(ri.imaging_item_name, rr.imaging_type_name) AS item_name,
           COALESCE(rpt.order_status, rr.order_status) AS status, rpt.findings AS result,
           rpt.impression, rpt.reported_at AS verified_at
    FROM radiology_requisitions rr
    LEFT JOIN radiology_items ri ON ri.id = rr.imaging_item_id
    LEFT JOIN radiology_reports rpt ON rpt.requisition_id = rr.id AND rpt.tenant_id = rr.tenant_id
    WHERE rr.tenant_id = ? AND rr.patient_id = ?${radioDateClause}
    ORDER BY rr.imaging_date DESC
    LIMIT 100
  `).bind(...radioParams).all().then(r => r.results).catch(() => []);

  return c.json({ Results: [...labs, ...radiology] });
});
