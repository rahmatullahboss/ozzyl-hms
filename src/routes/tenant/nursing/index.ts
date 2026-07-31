import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { requireRole, NURSING_ROLES, OPD_ROLES } from '../../../middleware/rbac';
import { finalDiagnosisSchema } from '../../../schemas/nursing';

// Sub-routes
import { carePlanRoutes } from './care-plan';
import { nursingNotesRoutes } from './notes';
import { marRoutes } from './mar';
import { ioChartsRoutes } from './io-charts';
import { monitoringRoutes } from './monitoring';
import { ivDrugRoutes } from './iv-drugs';
import { woundCareRoutes } from './wound-care';
import { handoverRoutes } from './handover';
import { aiHandoverRoutes } from './ai-handover';
import { opdRoutes } from './opd';
import wardsRoutes from './wards';
import { medicationOrderRoutes } from './medication-orders';
import { medicationReconciliationRoutes } from './medication-reconciliation';
import { favouritesRoutes } from './favourites';
import { clinicalSummaryRoutes } from './clinical-summary';
import { medicationDueRoutes } from './medication-due';
import { investigationResultsRoutes } from './investigation-results';
import { dietSheetRoutes } from './diet-sheet';
import { bloodSugarRoutes } from './blood-sugar';
import { consultationRequestRoutes } from './consultation-requests';
import { wardBillingRoutes } from './ward-billing';
import { drugRequisitionRoutes } from './drug-requisition';
import { patientTransferRoutes } from './patient-transfer';
import { nursingOrderRoutes } from './nursing-orders';
import { respiratoryRoutes } from './respiratory';
import { assignmentsRoutes } from './assignments';
import { nursingReportsRoutes } from './reports';
import { barcodeRoutes } from './barcode';
import { getDb } from '../../../db';
import type { D1Database } from '@cloudflare/workers-types';

const _admissionColumnsCache = new WeakMap<D1Database, Set<string>>();

async function getAdmissionColumns(db: D1Database): Promise<Set<string>> {
  const cached = _admissionColumnsCache.get(db);
  if (cached) return cached;
  const columns = await db.prepare(
    "SELECT name FROM pragma_table_info('admissions')"
  ).all<{ name: string }>();
  const cols = new Set((columns.results || []).map(r => r.name));
  _admissionColumnsCache.set(db, cols);
  return cols;
}

type NursingEnv = { Bindings: Env; Variables: Variables };

const nursing = new Hono<NursingEnv>();

// ─── RBAC: Restrict write operations to nursing staff ───────────────────────
// GETs = open to all authenticated users (viewing patient data)
// POST/PUT/DELETE = restricted by route:
//   - medication-orders: doctor/md/admin only (CPOE)
//   - opd: nursing + receptionist
//   - everything else: nursing roles
nursing.use('/*', async (c, next) => {
  const method = c.req.method;

  // GETs restricted to clinical roles (nursing data is PHI)
  if (method === 'GET') {
    return requireRole(...NURSING_ROLES)(c, next);
  }

  // CPOE: only doctors/md/admin can create/modify medication orders
  if (c.req.path.includes('/medication-orders')) {
    return requireRole('doctor', 'md', 'hospital_admin')(c, next);
  }

  // OPD check-in/out can be done by receptionists too
  if (c.req.path.includes('/opd/')) {
    return requireRole(...OPD_ROLES)(c, next);
  }

  return requireRole(...NURSING_ROLES)(c, next);
});

// GET /nursing/patients — admitted patients for nursing dashboard
nursing.get(
  '/patients',
  zValidator('query', z.object({ ward_id: z.coerce.number().int().positive().optional() })),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { ward_id } = c.req.valid('query');

    const colNames = await getAdmissionColumns(db.$client);

    const hasVisitId = colNames.has('visit_id');
    const hasAdmittingDoctor = colNames.has('admitting_doctor_id');
    const hasDoctorId = colNames.has('doctor_id');
    const hasIsActive = colNames.has('is_active');
    const hasWardId = colNames.has('ward_id');

    const visitIdCol = hasVisitId ? 'a.visit_id' : 'NULL AS visit_id';

    let doctorJoin = '';
    let doctorCol = 'NULL AS doctor_name';
    if (hasAdmittingDoctor) {
      doctorJoin = 'LEFT JOIN doctors d ON d.id = a.admitting_doctor_id';
      doctorCol = 'd.name AS doctor_name';
    } else if (hasDoctorId) {
      doctorJoin = 'LEFT JOIN doctors d ON d.id = a.doctor_id';
      doctorCol = 'd.name AS doctor_name';
    }

    const isActiveFilter = hasIsActive ? 'AND a.is_active = 1' : '';
    const wardFilter = hasWardId && ward_id ? 'AND a.ward_id = ?' : '';

    const sql = `
      SELECT
        p.id AS patient_id, p.patient_code, p.name, p.gender, p.mobile,
        a.id AS admission_id, a.admission_date, a.status AS admission_status,
        ${visitIdCol}, ${doctorCol}
      FROM admissions a
      JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      ${doctorJoin}
      WHERE a.tenant_id = ? AND a.status = 'admitted' ${isActiveFilter} ${wardFilter}
      ORDER BY a.admission_date DESC LIMIT 100
    `;

    const params: (string | number)[] = [tenantId];
    if (hasWardId && ward_id) params.push(ward_id);

    const { results } = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ Results: results, TotalCount: results.length });
  }
);

// POST /api/nursing/final-diagnosis — Danphe Nursing FinalDiagnosis route
nursing.post('/final-diagnosis', zValidator('json', finalDiagnosisSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const visit = await db.$client.prepare(
    'SELECT patient_id FROM visits WHERE id = ? AND tenant_id = ?'
  ).bind(data.visit_id, tenantId).first<{ patient_id: number }>();
  if (!visit) return c.json({ error: 'Visit not found' }, 404);
  if (visit.patient_id !== data.patient_id) return c.json({ error: 'Patient does not match visit' }, 400);

  await db.$client.prepare(`
    INSERT INTO nursing_final_diagnoses
      (tenant_id, visit_id, patient_id, final_diagnosis, icd10_code, recorded_by)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, visit_id) DO UPDATE SET
      final_diagnosis = excluded.final_diagnosis,
      icd10_code = excluded.icd10_code,
      recorded_by = excluded.recorded_by,
      updated_at = datetime('now', '+6 hours')
  `).bind(String(tenantId), data.visit_id, data.patient_id, data.final_diagnosis, data.icd10_code ?? null, userId ?? 'system').run();

  return c.json({ Results: true }, 201);
});

// GET /nursing/activity-log — audit trail for a patient
nursing.get(
  '/activity-log',
  zValidator('query', z.object({
    patient_id: z.coerce.number().int().positive(),
    admission_id: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const { patient_id, limit } = c.req.valid('query');

    try {
      const { results } = await db.$client.prepare(`
        SELECT
          al.id,
          al.action,
          al.new_value AS details,
          al.created_at,
          COALESCE(u.name, u.username, 'System') AS user_name
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE al.tenant_id = ?
          AND al.table_name = 'patients'
          AND al.record_id = ?
        ORDER BY al.created_at DESC
        LIMIT ?
      `).bind(String(tenantId), patient_id, limit).all();

      return c.json({ Results: results });
    } catch (err) {
      console.error('Activity log error:', err);
      return c.json({ Results: [] });
    }
  }
);

// Mount sub-routes
nursing.route('/care-plan', carePlanRoutes);
nursing.route('/notes', nursingNotesRoutes);
nursing.route('/mar', marRoutes);
nursing.route('/io', ioChartsRoutes);
nursing.route('/monitoring', monitoringRoutes);
nursing.route('/iv-drugs', ivDrugRoutes);
nursing.route('/wound-care', woundCareRoutes);
nursing.route('/handover', handoverRoutes);
nursing.route('/ai-handover', aiHandoverRoutes);
nursing.route('/opd', opdRoutes);
nursing.route('/wards', wardsRoutes);
nursing.route('/medication-orders', medicationOrderRoutes);
nursing.route('/medication-reconciliation', medicationReconciliationRoutes);
nursing.route('/favourites', favouritesRoutes);
nursing.route('/clinical-summary', clinicalSummaryRoutes);
nursing.route('/medication-due', medicationDueRoutes);
nursing.route('/patient', investigationResultsRoutes);
nursing.route('/diet-sheet', dietSheetRoutes);
nursing.route('/blood-sugar', bloodSugarRoutes);
nursing.route('/consultation-requests', consultationRequestRoutes);
nursing.route('/ward-billing', wardBillingRoutes);
nursing.route('/drug-requisition', drugRequisitionRoutes);
nursing.route('/patient-transfer', patientTransferRoutes);
nursing.route('/nursing-orders', nursingOrderRoutes);
nursing.route('/respiratory', respiratoryRoutes);
nursing.route('/assignments', assignmentsRoutes);
nursing.route('/reports', nursingReportsRoutes);
nursing.route('/barcode', barcodeRoutes);

export default nursing;
