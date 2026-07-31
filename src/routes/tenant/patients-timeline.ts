import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';

const patientTimelineRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

patientTimelineRoutes.get('/:id/timeline', async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);

  try {
    const db = getDb(c.env.DB);
    const patientId = Number(id);
    if (Number.isNaN(patientId) || patientId <= 0) {
      throw new HTTPException(400, { message: 'Invalid patient id' });
    }

    // Replaced Promise.all() with db.$client.batch() for patient timeline fetching.
    // Why: Promise.all() sends 13 separate HTTP network requests to Cloudflare D1.
    const batchResults = await db.$client.batch([
      db.$client.prepare(`SELECT name FROM patients WHERE id = ? AND tenant_id = ?`).bind(patientId, tenantId),
      db.$client.prepare(`
        SELECT v.id, v.visit_no, v.visit_type, v.created_at, v.notes, v.icd10_description, d.name as doctor_name
        FROM visits v LEFT JOIN doctors d ON v.doctor_id = d.id
        WHERE v.tenant_id = ? AND v.patient_id = ? ORDER BY v.created_at DESC LIMIT 30
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT con.id, con.scheduled_at, con.status, con.notes, con.prescription, con.chief_complaint, d.name as doctor_name
        FROM consultations con LEFT JOIN doctors d ON con.doctor_id = d.id
        WHERE con.tenant_id = ? AND con.patient_id = ? ORDER BY con.scheduled_at DESC LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT SOAPId, ChiefComplaint, Subjective, Objective, Assessment, Plan, CreatedAt
        FROM FormSOAP WHERE tenant_id = ? AND PatientId = ? ORDER BY CreatedAt DESC LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT p.id, p.rx_no, p.created_at, p.status, p.diagnosis, p.chief_complaint, d.name as doctor_name
        FROM prescriptions p LEFT JOIN doctors d ON p.doctor_id = d.id
        WHERE p.tenant_id = ? AND p.patient_id = ? ORDER BY p.created_at DESC LIMIT 30
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT lo.id, lo.order_no, lo.order_date, COUNT(loi.id) as total_items,
               SUM(CASE WHEN loi.status = 'pending' THEN 1 ELSE 0 END) as pending_items
        FROM lab_orders lo LEFT JOIN lab_order_items loi ON lo.id = loi.lab_order_id
        WHERE lo.tenant_id = ? AND lo.patient_id = ? GROUP BY lo.id ORDER BY lo.created_at DESC LIMIT 30
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, imaging_date, imaging_type_name, imaging_item_name, order_status, requisition_remarks, prescriber_name
        FROM radiology_requisitions WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY COALESCE(imaging_date, created_at) DESC, id DESC LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, imaging_type_name, imaging_item_name, performer_name, report_text, order_status, created_at
        FROM radiology_reports WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY COALESCE(updated_at, created_at) DESC, id DESC LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT a.id, a.admission_no, a.admission_date, a.status, a.provisional_diagnosis, d.name as doctor_name
        FROM admissions a LEFT JOIN doctors d ON a.doctor_id = d.id
        WHERE a.tenant_id = ? AND a.patient_id = ? ORDER BY a.admission_date DESC LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT ds.id, ds.updated_at, ds.status, ds.final_diagnosis, a.admission_no
        FROM discharge_summaries ds LEFT JOIN admissions a ON ds.admission_id = a.id AND a.tenant_id = ds.tenant_id
        WHERE ds.tenant_id = ? AND ds.patient_id = ? ORDER BY COALESCE(ds.updated_at, ds.created_at) DESC LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, title, description, document_type, created_at
        FROM document_records WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, referred_to, referred_date, referred_reason, created_at
        FROM medical_records WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 AND discharge_type = 'referred'
        ORDER BY COALESCE(referred_date, created_at) DESC LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT a.id, a.appt_date as appointment_date, a.appt_time as time_slot, a.status, d.name as doctor_name
        FROM appointments a LEFT JOIN doctors d ON a.doctor_id = d.id
        WHERE a.tenant_id = ? AND a.patient_id = ? ORDER BY a.appt_date DESC, a.appt_time DESC LIMIT 20
      `).bind(tenantId, patientId),
    ]);

const patient = batchResults[0]?.results?.[0] as { name: string } | undefined;
    const visitsResult = { results: batchResults[1]?.results as Record<string, unknown>[] };
    const consultationsResult = { results: batchResults[2]?.results as Record<string, unknown>[] };
    const soapNotesResult = { results: batchResults[3]?.results as Record<string, unknown>[] };
    const prescriptionsResult = { results: batchResults[4]?.results as Record<string, unknown>[] };
    const labOrdersResult = { results: batchResults[5]?.results as Record<string, unknown>[] };
    const radiologyOrdersResult = { results: batchResults[6]?.results as Record<string, unknown>[] };
    const radiologyReportsResult = { results: batchResults[7]?.results as Record<string, unknown>[] };
    const admissionsResult = { results: batchResults[8]?.results as Record<string, unknown>[] };
    const dischargeSummariesResult = { results: batchResults[9]?.results as Record<string, unknown>[] };
    const documentsResult = { results: batchResults[10]?.results as Record<string, unknown>[] };
    const referralsResult = { results: batchResults[11]?.results as Record<string, unknown>[] };
    const appointmentsResult = { results: batchResults[12]?.results as Record<string, unknown>[] };
    if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

    const events = [
      ...(visitsResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'visit',
        title: `${String(item.visit_type ?? 'visit').toUpperCase()} visit ${item.visit_no ? `· ${item.visit_no}` : ''}`.trim(),
        description: String(item.icd10_description ?? item.notes ?? 'Clinical visit'),
        date: String(item.created_at ?? ''), doctor: String(item.doctor_name ?? ''), status: 'completed',
      })),
      ...(consultationsResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'consultation',
        title: `Consultation${item.doctor_name ? ` · ${item.doctor_name}` : ''}`,
        description: String(item.chief_complaint ?? item.notes ?? item.prescription ?? 'Consultation note'),
        date: String(item.scheduled_at ?? ''), doctor: String(item.doctor_name ?? ''), status: String(item.status ?? 'scheduled'),
      })),
      ...(soapNotesResult.results ?? []).map((item: any) => ({
        id: Number(item.SOAPId), type: 'soap',
        title: `SOAP Note${item.ChiefComplaint ? ` · ${item.ChiefComplaint}` : ''}`,
        description: String(item.Assessment ?? item.Subjective ?? 'SOAP note'),
        date: String(item.CreatedAt ?? ''), status: 'completed',
      })),
      ...(prescriptionsResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'prescription', title: `Prescription ${item.rx_no}`,
        description: String(item.diagnosis ?? item.chief_complaint ?? 'Prescription updated'),
        date: String(item.created_at ?? ''), doctor: String(item.doctor_name ?? ''), status: String(item.status ?? 'draft'),
      })),
      ...(labOrdersResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'lab', title: `Lab Order ${item.order_no}`,
        description: `${Number(item.total_items ?? 0)} test(s), ${Number(item.pending_items ?? 0)} pending`,
        date: String(item.order_date ?? ''), status: Number(item.pending_items ?? 0) > 0 ? 'pending' : 'completed',
      })),
      ...(radiologyOrdersResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'radiology_order',
        title: `Radiology Order · ${String(item.imaging_item_name ?? item.imaging_type_name ?? 'Imaging')}`,
        description: String(item.requisition_remarks ?? 'Radiology requisition'),
        date: String(item.imaging_date ?? ''), doctor: String(item.prescriber_name ?? ''), status: String(item.order_status ?? 'pending'),
      })),
      ...(radiologyReportsResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'radiology_report',
        title: `Radiology Report · ${String(item.imaging_item_name ?? item.imaging_type_name ?? 'Imaging')}`,
        description: String(item.report_text ?? 'Radiology findings available'),
        date: String(item.created_at ?? ''), doctor: String(item.performer_name ?? ''), status: String(item.order_status ?? 'pending'),
      })),
      ...(admissionsResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'admission', title: `Admission ${item.admission_no}`,
        description: String(item.provisional_diagnosis ?? 'Hospital admission'),
        date: String(item.admission_date ?? ''), doctor: String(item.doctor_name ?? ''), status: String(item.status ?? 'admitted'),
      })),
      ...(dischargeSummariesResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'discharge',
        title: `Discharge Summary${item.admission_no ? ` · ${item.admission_no}` : ''}`,
        description: String(item.final_diagnosis ?? 'Discharge summary updated'),
        date: String(item.updated_at ?? ''), status: String(item.status ?? 'draft'),
      })),
      ...(documentsResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'visit', title: String(item.title ?? 'Clinical document'),
        description: String(item.description ?? item.document_type ?? 'Document attached'),
        date: String(item.created_at ?? ''), status: String(item.document_type ?? 'document'),
      })),
      ...(referralsResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'visit',
        title: `Referral${item.referred_to ? ` · ${item.referred_to}` : ''}`,
        description: String(item.referred_reason ?? 'Referral recorded'),
        date: String(item.referred_date ?? item.created_at ?? ''), status: 'referred',
      })),
      ...(appointmentsResult.results ?? []).map((item: any) => ({
        id: Number(item.id), type: 'appointment',
        title: `Appointment${item.doctor_name ? ` with ${item.doctor_name}` : ''}`,
        description: String(item.time_slot ?? 'Scheduled appointment'),
        date: String(item.appointment_date ?? ''), doctor: String(item.doctor_name ?? ''), status: String(item.status ?? 'scheduled'),
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return c.json({ patient_name: patient.name, events });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('patient timeline fetch error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch patient timeline' });
  }
});

export default patientTimelineRoutes;
