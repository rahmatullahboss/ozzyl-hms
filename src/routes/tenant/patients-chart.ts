import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { callAIJson, type ChatMessage } from "../../lib/ai";
import { createAuditLog } from "../../lib/accounting-helpers";
import type { Env, Variables } from "../../types";
import { requireTenantId } from "../../lib/context-helpers";
import { getDb } from "../../db";
import { composeDeterministicChartSummary, sanitizeAiSummaryOutput, type PhysicianSummary } from "../../lib/chart-ai-summary";
import { buildChartFamilyRiskSummary, buildFamilyRiskCitationSources, getFamilyRiskInsightBySourceId, loadChartFamilyRiskOverview } from "../../lib/family-risk";

const chartRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function buildPatientAge(patient: { age?: number | null; date_of_birth?: string | null }): number | null {
  if (typeof patient.age === 'number' && patient.age > 0) return patient.age;
  if (!patient.date_of_birth) return null;

  const dob = new Date(patient.date_of_birth);
  if (Number.isNaN(dob.getTime())) return null;

  return Math.max(0, Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)));
}

function buildChartNarrative(data: {
  patient: Record<string, unknown>;
  allergies: Array<Record<string, unknown>>;
  activeProblems: Array<Record<string, unknown>>;
  medications: Array<Record<string, unknown>>;
  adverseReactions: Array<Record<string, unknown>>;
  lifestyleLogs: Array<Record<string, unknown>>;
  visits: Array<Record<string, unknown>>;
  consultations: Array<Record<string, unknown>>;
  soapNotes: Array<Record<string, unknown>>;
  prescriptions: Array<Record<string, unknown>>;
  labResults: Array<Record<string, unknown>>;
  radiologyOrders: Array<Record<string, unknown>>;
  radiologyReports: Array<Record<string, unknown>>;
  admissions: Array<Record<string, unknown>>;
  familyRiskOverview?: {
    headline: string;
    summary: string;
    insights: Array<{ label: string; rationale: string }>;
  } | null;
}): string {
  const age = buildPatientAge(data.patient as { age?: number | null; date_of_birth?: string | null });
  const patientHeader = [
    `Patient: ${data.patient.name ?? 'Unknown'}`,
    age ? `Age: ${age}` : null,
    data.patient.gender ? `Gender: ${data.patient.gender}` : null,
    data.patient.blood_group ? `Blood group: ${data.patient.blood_group}` : null,
  ].filter(Boolean).join(', ');

  const allergies = data.allergies.length
    ? data.allergies.map((item) => `${item.allergen} (${item.severity ?? 'unknown'}${item.reaction ? `; reaction: ${item.reaction}` : ''})`).join('; ')
    : 'None recorded';

  const problems = data.activeProblems.length
    ? data.activeProblems.map((item) => `${item.description}${item.severity ? ` [${item.severity}]` : ''}`).join('; ')
    : 'None recorded';

  const medications = data.medications.length
    ? data.medications.map((item) => `${item.medication_name}${item.dosage ? ` ${item.dosage}` : ''}${item.frequency ? ` ${item.frequency}` : ''} (${item.status})`).join('; ')
    : 'None recorded';

  const adverseReactions = data.adverseReactions.length
    ? data.adverseReactions.map((item) => `${item.medication_name ?? item.generic_name ?? 'Unknown medicine'}: ${item.reaction ?? 'reaction not specified'} (${item.severity ?? 'unknown'}; ${normalizeReviewStatus(item.review_status, false)})`).join('; ')
    : 'None recorded';

  const lifestyleLogs = data.lifestyleLogs.length
    ? data.lifestyleLogs.map((item) => `${item.logged_on}: sleep ${item.sleep_hours ?? 'n/a'}h, exercise ${item.exercise_minutes ?? 0} min${item.symptoms ? `, symptoms ${String(item.symptoms).slice(0, 80)}` : ''}${item.mood ? `, mood ${item.mood}` : ''} (${normalizeReviewStatus(item.review_status, false)})`).join('\n')
    : 'None recorded';

  const visits = data.visits.length
    ? data.visits.map((item) => `${item.created_at}: ${item.visit_type}${item.doctor_name ? ` with ${item.doctor_name}` : ''}${item.icd10_description ? `, dx ${item.icd10_description}` : ''}${item.notes ? `, notes ${String(item.notes).slice(0, 120)}` : ''}`).join('\n')
    : 'None recorded';

  const consultations = data.consultations.length
    ? data.consultations.map((item) => `${item.scheduled_at}: ${item.status}${item.doctor_name ? ` with ${item.doctor_name}` : ''}${item.chief_complaint ? `, complaint ${item.chief_complaint}` : ''}${item.notes ? `, notes ${String(item.notes).slice(0, 120)}` : ''}${item.prescription ? `, rx ${String(item.prescription).slice(0, 120)}` : ''}`).join('\n')
    : 'None recorded';

  const soapNotes = data.soapNotes.length
    ? data.soapNotes.map((item) => `${item.CreatedAt}: complaint ${item.ChiefComplaint ?? 'n/a'}, subjective ${String(item.Subjective ?? '').slice(0, 100)}, objective ${String(item.Objective ?? '').slice(0, 100)}, assessment ${String(item.Assessment ?? '').slice(0, 100)}, plan ${String(item.Plan ?? '').slice(0, 100)}`).join('\n')
    : 'None recorded';

  const prescriptions = data.prescriptions.length
    ? data.prescriptions.map((item) => `${item.created_at}: ${item.rx_no}${item.diagnosis ? `, diagnosis ${item.diagnosis}` : ''}${item.chief_complaint ? `, complaint ${item.chief_complaint}` : ''}`).join('\n')
    : 'None recorded';

  const labs = data.labResults.length
    ? data.labResults.map((item) => `${item.order_date}: ${item.test_name} = ${item.result ?? item.result_numeric ?? 'pending'} (${item.abnormal_flag ?? item.status})`).join('\n')
    : 'None recorded';

  const radiologyOrders = data.radiologyOrders.length
    ? data.radiologyOrders.map((item) => `${item.imaging_date}: ${item.imaging_item_name ?? item.imaging_type_name ?? 'Radiology order'} (${item.order_status ?? 'pending'})${item.urgency ? `, urgency ${item.urgency}` : ''}`).join('\n')
    : 'None recorded';

  const radiologyReports = data.radiologyReports.length
    ? data.radiologyReports.map((item) => `${item.created_at}: ${item.imaging_item_name ?? item.imaging_type_name ?? 'Radiology report'} (${item.order_status ?? 'pending'})${item.performer_name ? ` by ${item.performer_name}` : ''}${item.report_text ? `, findings ${String(item.report_text).slice(0, 160)}` : ''}`).join('\n')
    : 'None recorded';

  const admissions = data.admissions.length
    ? data.admissions.map((item) => `${item.admission_date}: ${item.admission_no} ${item.status}${item.provisional_diagnosis ? `, ${item.provisional_diagnosis}` : ''}`).join('\n')
    : 'None recorded';

  const familyRisk = data.familyRiskOverview?.insights?.length
    ? `${data.familyRiskOverview.headline}\n${data.familyRiskOverview.insights.map((item) => `${item.label}: ${item.rationale}`).join('\n')}`
    : 'No linked family-risk insights available';

  return [
    patientHeader,
    `Allergies: ${allergies}`,
    `Active problems: ${problems}`,
    `Current medications: ${medications}`,
    `Patient-reported adverse reactions: ${adverseReactions}`,
    `Patient-reported lifestyle logs:\n${lifestyleLogs}`,
    `Recent visits:\n${visits}`,
    `Recent consultations:\n${consultations}`,
    `Recent SOAP notes:\n${soapNotes}`,
    `Recent prescriptions:\n${prescriptions}`,
    `Recent labs:\n${labs}`,
    `Recent radiology orders:\n${radiologyOrders}`,
    `Recent radiology reports:\n${radiologyReports}`,
    `Admissions:\n${admissions}`,
    `Family history watchlist:\n${familyRisk}`,
  ].join('\n\n');
}

async function buildAiChartSummary(
  env: Env,
  chartNarrative: string,
  citationSourceIds: string[],
  fallbackSummary: PhysicianSummary,
): Promise<{ summary: PhysicianSummary; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; status: 'ready' | 'fallback' }> {
  if (!env.OPENROUTER_API_KEY || chartNarrative.length < 80) {
    return { summary: fallbackSummary, status: 'fallback' };
  }

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are an AI clinical chart briefing assistant.
Use ONLY the facts provided. Do not infer unsupported diagnoses. If something is not clear, omit it.
Respond ONLY in valid JSON with this structure:
{
  "oneLiner": "",
  "activeIssues": [{"text": "", "citationIds": ["src-1"]}],
  "familyHistory": [{"text": "", "citationIds": ["src-1"]}],
  "patientContext": [{"text": "", "priority": "medium", "citationIds": ["src-1"], "provenance": "patient_reported"}],
  "recentChanges": [{"text": "", "citationIds": ["src-1"]}],
  "medicationFocus": [{"text": "", "citationIds": ["src-1"]}],
  "abnormalFindings": [{"text": "", "citationIds": ["src-1"]}],
  "followUpRisks": [{"text": "", "citationIds": ["src-1"]}],
  "cautions": [{"text": "", "citationIds": ["src-1"]}],
  "provenanceFlags": [{"text": "", "citationIds": ["src-1"]}]
}`,
    },
    {
      role: 'user',
      content: `Prepare a concise doctor-facing chart brief from this patient longitudinal record.
Only cite from these source ids: ${citationSourceIds.join(', ')}.

${chartNarrative.slice(0, 7000)}`,
    },
  ];

  try {
    const result = await callAIJson<Record<string, unknown>>(env.OPENROUTER_API_KEY, messages, {
      model: env.AI_MODEL,
      temperature: 0.2,
      maxTokens: 1200,
    });
    return {
      summary: sanitizeAiSummaryOutput(result.data, new Set(citationSourceIds), fallbackSummary),
      usage: result.usage,
      status: 'ready',
    };
  } catch (error) {
    console.error('chart ai summary error:', error);
    return { summary: fallbackSummary, status: 'fallback' };
  }
}

function toTimelineEvent(item: {
  id: string;
  type: 'visit' | 'prescription' | 'lab' | 'admission' | 'appointment' | 'document' | 'referral' | 'discharge' | 'consultation' | 'radiology_order' | 'radiology_report' | 'soap' | 'patient_reported_adr' | 'patient_reported_lifestyle';
  title: string;
  subtitle?: string;
  doctor_name?: string;
  status?: string;
  date: string | null | undefined;
  details?: Record<string, string>;
  provenance?: ChartSourceProvenance;
}) {
  return {
    ...item,
    date: item.date ?? new Date().toISOString(),
  };
}

type ChartProvenanceCategory =
  | 'clinician_verified'
  | 'clinician_entered'
  | 'patient_reported'
  | 'imported_record'
  | 'family_history'
  | 'mixed'
  | 'system_derived';

type ChartSourceProvenance = {
  category: ChartProvenanceCategory;
  badge_text: string;
  review_status: 'pending_review' | 'verified' | 'rejected';
  reviewed_at: string | null;
  reviewed_by: number | null;
  source_label: string;
};

function parseChartSourceId(sourceId: string): { rawType: string; recordId: number } {
  const patterns: Array<{ prefix: string; type: string }> = [
    { prefix: 'family-risk-', type: 'family_risk' },
    { prefix: 'lifestyle-', type: 'patient_reported_lifestyle' },
    { prefix: 'adr-', type: 'patient_reported_adr' },
    { prefix: 'radiology-report-', type: 'radiology_report' },
    { prefix: 'radiology-order-', type: 'radiology_order' },
    { prefix: 'consultation-', type: 'consultation' },
    { prefix: 'soap-', type: 'soap' },
    { prefix: 'problem-', type: 'problem' },
    { prefix: 'medication-', type: 'medication' },
    { prefix: 'allergy-', type: 'allergy' },
    { prefix: 'discharge-', type: 'discharge' },
    { prefix: 'document-', type: 'document' },
    { prefix: 'referral-', type: 'referral' },
    { prefix: 'visit-', type: 'visit' },
    { prefix: 'rx-', type: 'prescription' },
    { prefix: 'lab-', type: 'lab' },
    { prefix: 'adm-', type: 'admission' },
    { prefix: 'appt-', type: 'appointment' },
  ];

  for (const pattern of patterns) {
    if (sourceId.startsWith(pattern.prefix)) {
      const recordId = Number(sourceId.slice(pattern.prefix.length));
      if (Number.isNaN(recordId) || recordId <= 0) break;
      return { rawType: pattern.type, recordId };
    }
  }

  throw new HTTPException(400, { message: 'Invalid chart source id' });
}

function buildSourceResponse(payload: {
  id: string;
  type: string;
  title: string;
  date?: string | null;
  status?: string | null;
  summary?: string | null;
  sections?: Array<{ label: string; value: string | null | undefined }>;
  provenance?: ChartSourceProvenance | null;
  reviewActions?: {
    review_path: string;
    approve_method: 'PUT';
    reject_method: 'PUT';
  } | null;
}) {
  return {
    source: {
      id: payload.id,
      type: payload.type,
      title: payload.title,
      date: payload.date ?? null,
      status: payload.status ?? null,
      summary: payload.summary ?? '',
      provenance: payload.provenance ?? null,
      sections: (payload.sections ?? [])
        .filter((item) => item.value !== null && item.value !== undefined && String(item.value).trim() !== '')
        .map((item) => ({ label: item.label, value: String(item.value) })),
      review_actions: payload.reviewActions ?? null,
    },
  };
}

function normalizeReviewStatus(value: unknown, fallbackVerified: boolean = false): 'pending_review' | 'verified' | 'rejected' {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized === 'verified' || normalized === 'rejected' || normalized === 'pending_review') {
    return normalized;
  }
  return fallbackVerified ? 'verified' : 'pending_review';
}

function provenanceBadgeText(category: ChartProvenanceCategory): string {
  switch (category) {
    case 'clinician_verified':
      return 'Doctor verified';
    case 'clinician_entered':
      return 'Clinician entered';
    case 'patient_reported':
      return 'Patient reported';
    case 'imported_record':
      return 'Imported record';
    case 'family_history':
      return 'Family history';
    case 'system_derived':
      return 'System derived';
    case 'mixed':
      return 'Mixed sources';
    default:
      return 'Clinician entered';
  }
}

function buildChartProvenance(input: {
  category: ChartProvenanceCategory;
  sourceLabel: string;
  reviewStatus?: unknown;
  reviewedAt?: unknown;
  reviewedBy?: unknown;
  fallbackVerified?: boolean;
}): ChartSourceProvenance {
  const reviewedAt = input.reviewedAt ? String(input.reviewedAt) : null;
  const reviewedBy = input.reviewedBy == null ? null : Number(input.reviewedBy);
  return {
    category: input.category,
    badge_text: provenanceBadgeText(input.category),
    review_status: normalizeReviewStatus(input.reviewStatus, Boolean(input.fallbackVerified)),
    reviewed_at: reviewedAt,
    reviewed_by: Number.isFinite(reviewedBy as number) ? reviewedBy : null,
    source_label: input.sourceLabel,
  };
}

async function loadLatestApprovalAudit(
  db: ReturnType<typeof getDb>,
  tenantId: string | number,
  tableName: string,
  recordId: number,
): Promise<Record<string, unknown> | null> {
  return db.$client.prepare(`
    SELECT user_id, created_at
    FROM audit_logs
    WHERE tenant_id = ? AND action = 'APPROVE' AND table_name = ? AND record_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(tenantId, tableName, recordId).first<Record<string, unknown>>();
}

function buildInClause(length: number): string {
  return Array.from({ length }, () => '?').join(', ');
}

const quickLabOrderSchema = z.object({
  tests: z.array(z.object({
    lab_test_id: z.number().int().positive(),
    instructions: z.string().optional(),
  })).min(1),
  notes: z.string().optional(),
});

const quickRadiologyOrderSchema = z.object({
  imaging_type_name: z.string().min(1),
  imaging_item_name: z.string().min(1),
  urgency: z.enum(['normal', 'urgent', 'stat']).default('normal'),
  requisition_remarks: z.string().optional(),
});

const quickFollowUpSchema = z.object({
  apptDate: z.string().min(1),
  apptTime: z.string().optional(),
  notes: z.string().optional(),
});

const quickEncounterCloseSchema = z.object({
  consultation_id: z.number().int().positive().optional(),
  summary: z.string().optional(),
  diagnosis: z.string().optional(),
  prescription: z.string().optional(),
  reconciliation_summary: z.string().optional(),
  medication_reconciliation_done: z.boolean().optional(),
  followup_date: z.string().optional(),
  followup_time: z.string().optional(),
  followup_notes: z.string().optional(),
  book_followup: z.boolean().optional(),
});

/**
 * GET /api/patients
 * Retrieves a list of patients for the current tenant.
 * Supports searching by name, mobile, patient code, or ID, and uses cursor-based pagination.
 */

chartRoutes.get('/:id/chart', async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);
  const includeAiSummary = c.req.query('includeAiSummary') === '1';

  try {
    const db = getDb(c.env.DB);
    const patientId = Number(id);
    if (Number.isNaN(patientId) || patientId <= 0) {
      throw new HTTPException(400, { message: 'Invalid patient id' });
    }

    const patient = await db.$client.prepare(`
      SELECT id, patient_code, uhid, name, father_husband, address, mobile, guardian_mobile,
             age, gender, blood_group, date_of_birth, email, created_at
      FROM patients
      WHERE id = ? AND tenant_id = ?
    `).bind(patientId, tenantId).first<Record<string, unknown>>();

    if (!patient) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    const familyRiskPromise = loadChartFamilyRiskOverview(c.env.DB, String(patient.uhid ?? ''));

    const [
      allergiesResult,
      problemsResult,
      diagnosisResult,
      finalDiagnosisResult,
      medicationsResult,
      visitsResult,
      consultationsResult,
      soapNotesResult,
      prescriptionsResult,
      labOrdersResult,
      labResultsResult,
      radiologyOrdersResult,
      radiologyReportsResult,
      admissionsResult,
      dischargeSummariesResult,
      documentRecordsResult,
      referralsResult,
      vitalsResult,
      vitalAlertsResult,
      appointmentsResult,
      adverseReactionsResult,
      lifestyleLogsResult,
      clinicalNotesResult,
      clinicalImagesResult,
      encountersResult,
      rawFamilyRiskOverview,
    ] = await Promise.all([
      db.$client.prepare(`
        SELECT id, allergy_type, allergen, severity, reaction, onset_date, verified_at,
               review_status, reviewed_at, reviewed_by, review_notes
        FROM patient_allergies
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY CASE severity
          WHEN 'life_threatening' THEN 1
          WHEN 'severe' THEN 2
          WHEN 'moderate' THEN 3
          ELSE 4 END, allergen ASC
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT ProblemId as id, ICD10Code as icd10_code, Description as description, Severity as severity,
               Status as status, BegDate as onset_date, EndDate as end_date, Comments as comments,
               COALESCE(ModifiedAt, CreatedAt) as updated_at
        FROM CLN_ProblemList
        WHERE tenant_id = ? AND PatientId = ? AND Status != 'deleted'
        ORDER BY CASE Status WHEN 'active' THEN 0 ELSE 1 END, COALESCE(ModifiedAt, CreatedAt) DESC
        LIMIT 20
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT DiagnosisId as id, ICD10Code as icd10_code, ICD10Description as description,
               DiagnosisType as diagnosis_type, Notes as notes, CreatedOn as created_at,
               review_status, reviewed_at, reviewed_by, review_notes
        FROM ClinicalDiagnosis
        WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
        ORDER BY CreatedOn DESC
        LIMIT 12
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT fd.id, ic.code as icd10_code, ic.description as description,
               CASE WHEN fd.is_primary = 1 THEN 'primary' ELSE 'secondary' END as diagnosis_type,
               fd.notes, fd.created_at,
               'verified' as review_status, fd.created_at as reviewed_at, fd.created_by as reviewed_by, fd.notes as review_notes
        FROM final_diagnosis fd
        LEFT JOIN icd10_codes ic ON fd.icd10_id = ic.id
        WHERE fd.tenant_id = ? AND fd.patient_id = ? AND fd.is_active = 1
        ORDER BY fd.is_primary DESC, fd.created_at DESC
        LIMIT 12
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT id, medication_name, generic_name, dosage, frequency, duration, instructions,
               start_date, end_date, status, status_reason, source, prescription_id,
               review_status, reviewed_at, reviewed_by, review_notes
        FROM patient_active_medications
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, COALESCE(start_date, created_at) DESC
        LIMIT 20
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT v.id, v.visit_no, v.visit_type, v.created_at, v.discharge_date,
               v.icd10_code, v.icd10_description, v.notes, d.name as doctor_name
        FROM visits v
        LEFT JOIN doctors d ON v.doctor_id = d.id
        WHERE v.tenant_id = ? AND v.patient_id = ?
        ORDER BY v.created_at DESC
        LIMIT 12
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT con.id, con.scheduled_at, con.status, con.notes, con.prescription, con.chief_complaint,
               con.followup_date, d.name as doctor_name
        FROM consultations con
        LEFT JOIN doctors d ON con.doctor_id = d.id
        WHERE con.tenant_id = ? AND con.patient_id = ?
        ORDER BY con.scheduled_at DESC
        LIMIT 10
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT SOAPId, PatientId, EncounterId, ChiefComplaint, Subjective, Objective, Assessment, Plan, CreatedById, CreatedAt
        FROM FormSOAP
        WHERE tenant_id = ? AND PatientId = ?
        ORDER BY CreatedAt DESC
        LIMIT 8
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT p.id, p.rx_no, p.created_at, p.status, p.chief_complaint, p.diagnosis, p.advice,
               d.name as doctor_name,
               (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id = p.id) AS item_count
        FROM prescriptions p
        LEFT JOIN doctors d ON p.doctor_id = d.id
        WHERE p.tenant_id = ? AND p.patient_id = ?
        ORDER BY p.created_at DESC
        LIMIT 12
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT lo.id, lo.order_no, lo.order_date,
               COUNT(loi.id) as total_items,
               SUM(CASE WHEN loi.status = 'pending' THEN 1 ELSE 0 END) as pending_items
        FROM lab_orders lo
        LEFT JOIN lab_order_items loi ON lo.id = loi.lab_order_id
        WHERE lo.tenant_id = ? AND lo.patient_id = ?
        GROUP BY lo.id
        ORDER BY lo.created_at DESC
        LIMIT 10
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT loi.id, loi.result, loi.result_numeric, loi.abnormal_flag, loi.status, loi.completed_at,
               lo.order_no, lo.order_date,
               ltc.name as test_name, ltc.unit, ltc.normal_range
        FROM lab_order_items loi
        JOIN lab_orders lo ON loi.lab_order_id = lo.id
        LEFT JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
        WHERE lo.tenant_id = ? AND lo.patient_id = ?
        ORDER BY lo.created_at DESC, loi.id DESC
        LIMIT 20
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT rr.id, rr.imaging_date, rr.imaging_type_name, rr.imaging_item_name, rr.procedure_code,
               rr.urgency, rr.order_status, rr.requisition_remarks, rr.prescriber_name
        FROM radiology_requisitions rr
        WHERE rr.tenant_id = ? AND rr.patient_id = ? AND rr.is_active = 1
        ORDER BY COALESCE(rr.imaging_date, rr.created_at) DESC, rr.id DESC
        LIMIT 10
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT rr.id, rr.requisition_id, rr.created_at, rr.imaging_type_name, rr.imaging_item_name,
               rr.performer_name, rr.report_text, rr.indication, rr.radiology_number, rr.order_status
        FROM radiology_reports rr
        WHERE rr.tenant_id = ? AND rr.patient_id = ? AND rr.is_active = 1
        ORDER BY COALESCE(rr.updated_at, rr.created_at) DESC, rr.id DESC
        LIMIT 10
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT a.id, a.admission_no, a.admission_date, a.discharge_date, a.status,
               a.provisional_diagnosis, a.notes, b.ward_name, b.bed_number, d.name as doctor_name
        FROM admissions a
        LEFT JOIN beds b ON a.bed_id = b.id
        LEFT JOIN doctors d ON a.doctor_id = d.id
        WHERE a.tenant_id = ? AND a.patient_id = ?
        ORDER BY a.admission_date DESC
        LIMIT 8
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT ds.id, ds.admission_id, ds.final_diagnosis, ds.treatment_summary, ds.follow_up_date,
               ds.follow_up_instructions, ds.doctor_notes, ds.status, ds.updated_at, a.admission_no
        FROM discharge_summaries ds
        LEFT JOIN admissions a ON ds.admission_id = a.id AND a.tenant_id = ds.tenant_id
        WHERE ds.tenant_id = ? AND ds.patient_id = ?
        ORDER BY COALESCE(ds.updated_at, ds.created_at) DESC
        LIMIT 6
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT id, medical_record_id, document_type, title, description, file_name, created_at
        FROM document_records
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT id, referred_to, referred_date, referred_time, referred_reason, file_number, remarks, created_at
        FROM medical_records
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 AND discharge_type = 'referred'
        ORDER BY COALESCE(referred_date, created_at) DESC
        LIMIT 8
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT id, taken_at as recorded_at, temperature, pulse,
               blood_pressure_systolic as systolic, blood_pressure_diastolic as diastolic,
               respiratory_rate, spo2, weight, height, bmi, blood_sugar, notes
        FROM clinical_vitals
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY taken_at DESC
        LIMIT 12
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT id, vital_type, recorded_value, threshold_min, threshold_max, severity, status, acknowledged_at, created_at
        FROM vital_alerts
        WHERE tenant_id = ? AND patient_id = ? AND status IN ('active', 'acknowledged')
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
        LIMIT 8
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT a.id, a.appt_date as appointment_date, a.appt_time as time_slot, a.status, d.name as doctor_name
        FROM appointments a
        LEFT JOIN doctors d ON a.doctor_id = d.id
        WHERE a.tenant_id = ? AND a.patient_id = ?
        ORDER BY a.appt_date DESC, a.appt_time DESC
        LIMIT 8
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT id, medication_name, generic_name, reaction, severity, onset_date, outcome_status, notes,
               source, review_status, reviewed_by, reviewed_at, review_notes, created_at, updated_at
        FROM global_patient_adverse_reactions
        WHERE uhid = (SELECT uhid FROM patients WHERE tenant_id = ? AND id = ?)
        ORDER BY created_at DESC
        LIMIT 6
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT id, logged_on, sleep_hours, exercise_minutes, mood, energy_level, symptom_score, symptoms,
               diet_notes, notes, source, review_status, reviewed_by, reviewed_at, review_notes, created_at, updated_at
        FROM global_patient_lifestyle_logs
        WHERE uhid = (SELECT uhid FROM patients WHERE tenant_id = ? AND id = ?)
        ORDER BY logged_on DESC, created_at DESC
        LIMIT 6
      `).bind(tenantId, patientId).all<Record<string, unknown>>(),
      db.$client.prepare(`
        SELECT id, visit_id, note_type, title, content, chief_complaint, subjective, objective,
               assessment, plan, follow_up, is_signed, signed_by, signed_at, created_by, created_at
        FROM clinical_notes
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(tenantId, patientId).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] })),
      db.$client.prepare(`
        SELECT id, visit_id, image_type, title, description, file_key, file_name, body_part, created_at
        FROM clinical_images
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(tenantId, patientId).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] })),
      db.$client.prepare(`
        SELECT id, visit_id, appointment_id, encounter_type, status, start_time, end_time, provider_id,
               reason_for_visit, chief_complaint, disposition_code, disposition_note,
               snapshot_hash, signed_by, signed_at, signature_version, addendum_count, created_at
        FROM encounters
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY start_time DESC
        LIMIT 10
      `).bind(tenantId, patientId).all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] })),
      familyRiskPromise,
    ]);

    const allergies = allergiesResult.results ?? [];
    const problems = problemsResult.results ?? [];
    const diagnoses = (diagnosisResult.results ?? []).length > 0
      ? (diagnosisResult.results ?? [])
      : (finalDiagnosisResult.results ?? []);
    const medications = medicationsResult.results ?? [];
    const visits = visitsResult.results ?? [];
    const consultations = consultationsResult.results ?? [];
    const soapNotes = soapNotesResult.results ?? [];
    const prescriptions = prescriptionsResult.results ?? [];
    const labOrders = labOrdersResult.results ?? [];
    const labResults = labResultsResult.results ?? [];
    const radiologyOrders = radiologyOrdersResult.results ?? [];
    const radiologyReports = radiologyReportsResult.results ?? [];
    const admissions = admissionsResult.results ?? [];
    const dischargeSummaries = dischargeSummariesResult.results ?? [];
    const documents = documentRecordsResult.results ?? [];
    const referrals = referralsResult.results ?? [];
    const vitals = vitalsResult.results ?? [];
    const vitalAlerts = vitalAlertsResult.results ?? [];
    const appointments = appointmentsResult.results ?? [];
    const adverseReactions = adverseReactionsResult.results ?? [];
    const lifestyleLogs = lifestyleLogsResult.results ?? [];
    const clinicalNotes = clinicalNotesResult.results ?? [];
    const clinicalImages = clinicalImagesResult.results ?? [];
    const encountersList = encountersResult.results ?? [];
    const currentMedications = medications.filter((item) => ['active', 'on_hold'].includes(String(item.status ?? '')));
    const stoppedMedications = medications.filter((item) => ['discontinued', 'completed', 'suspended'].includes(String(item.status ?? '')));

    const labResultIds = labResults.map((item) => Number(item.id)).filter((value) => Number.isFinite(value));
    const radiologyReportIds = radiologyReports.map((item) => Number(item.id)).filter((value) => Number.isFinite(value));
    const reviewAuditResults = (labResultIds.length + radiologyReportIds.length) > 0
      ? await db.$client.prepare(`
          SELECT table_name, record_id, user_id, created_at, new_value
          FROM audit_logs
          WHERE tenant_id = ?
            AND action = 'APPROVE'
            AND (
              ${labResultIds.length > 0 ? `table_name = 'lab_order_items' AND record_id IN (${buildInClause(labResultIds.length)})` : '0=1'}
              OR
              ${radiologyReportIds.length > 0 ? `table_name = 'radiology_reports' AND record_id IN (${buildInClause(radiologyReportIds.length)})` : '0=1'}
            )
          ORDER BY created_at DESC
          LIMIT 50
        `).bind(tenantId, ...labResultIds, ...radiologyReportIds).all<Record<string, unknown>>()
      : { results: [] as Record<string, unknown>[] };

    const reviewIndex = new Map<string, Record<string, unknown>>();
    for (const row of reviewAuditResults.results ?? []) {
      const key = `${String(row.table_name)}:${String(row.record_id)}`;
      if (!reviewIndex.has(key)) {
        reviewIndex.set(key, row);
      }
    }

    const decoratedLabResults: Array<Record<string, unknown> & { provenance: ChartSourceProvenance }> = labResults.map((item) => {
      const review = reviewIndex.get(`lab_order_items:${String(item.id)}`);
      const reviewedAt = review?.created_at ?? null;
      const reviewedBy = review?.user_id ?? null;
      const provenance = buildChartProvenance({
        category: reviewedAt ? 'clinician_verified' : 'clinician_entered',
        sourceLabel: 'Lab result',
        reviewStatus: reviewedAt ? 'verified' : 'pending_review',
        reviewedAt,
        reviewedBy,
        fallbackVerified: Boolean(reviewedAt),
      });
      return {
        ...item,
        reviewed_at: reviewedAt,
        reviewed_by: reviewedBy,
        provenance,
      };
    });

    const decoratedRadiologyReports: Array<Record<string, unknown> & { provenance: ChartSourceProvenance }> = radiologyReports.map((item) => {
      const review = reviewIndex.get(`radiology_reports:${String(item.id)}`);
      const reviewedAt = review?.created_at ?? null;
      const reviewedBy = review?.user_id ?? null;
      const provenance = buildChartProvenance({
        category: reviewedAt ? 'clinician_verified' : 'clinician_entered',
        sourceLabel: 'Radiology report',
        reviewStatus: reviewedAt ? 'verified' : 'pending_review',
        reviewedAt,
        reviewedBy,
        fallbackVerified: Boolean(reviewedAt),
      });
      return {
        ...item,
        reviewed_at: reviewedAt,
        reviewed_by: reviewedBy,
        provenance,
      };
    });

    const decoratedDiagnoses: Array<Record<string, unknown> & { provenance: ChartSourceProvenance }> = diagnoses.map((item) => {
      const reviewStatus = normalizeReviewStatus(item.review_status, true);
      return {
        ...item,
        review_status: reviewStatus,
        provenance: buildChartProvenance({
          category: reviewStatus === 'verified' ? 'clinician_verified' : 'clinician_entered',
          sourceLabel: 'Diagnosis',
          reviewStatus,
          reviewedAt: item.reviewed_at ?? item.created_at ?? null,
          reviewedBy: item.reviewed_by ?? null,
          fallbackVerified: reviewStatus === 'verified',
        }),
      };
    });

    const decoratedCurrentMedications: Array<Record<string, unknown> & { provenance: ChartSourceProvenance }> = currentMedications.map((item) => {
      const reviewStatus = normalizeReviewStatus(item.review_status, String(item.source ?? '') !== 'patient_reported');
      const category: ChartProvenanceCategory = String(item.source ?? '') === 'patient_reported'
        ? 'patient_reported'
        : reviewStatus === 'verified'
          ? 'clinician_verified'
          : 'clinician_entered';
      return {
        ...item,
        review_status: reviewStatus,
        provenance: buildChartProvenance({
          category,
          sourceLabel: 'Medication',
          reviewStatus,
          reviewedAt: item.reviewed_at ?? null,
          reviewedBy: item.reviewed_by ?? null,
          fallbackVerified: reviewStatus === 'verified',
        }),
      };
    });

    const decoratedStoppedMedications: Array<Record<string, unknown> & { provenance: ChartSourceProvenance }> = stoppedMedications.map((item) => {
      const reviewStatus = normalizeReviewStatus(item.review_status, String(item.source ?? '') !== 'patient_reported');
      const category: ChartProvenanceCategory = String(item.source ?? '') === 'patient_reported'
        ? 'patient_reported'
        : reviewStatus === 'verified'
          ? 'clinician_verified'
          : 'clinician_entered';
      return {
        ...item,
        review_status: reviewStatus,
        provenance: buildChartProvenance({
          category,
          sourceLabel: 'Medication',
          reviewStatus,
          reviewedAt: item.reviewed_at ?? null,
          reviewedBy: item.reviewed_by ?? null,
          fallbackVerified: reviewStatus === 'verified',
        }),
      };
    });

    const decoratedDischargeSummaries: Array<Record<string, unknown> & { provenance: ChartSourceProvenance }> = dischargeSummaries.map((item) => {
      const isVerified = ['final', 'completed', 'signed'].includes(String(item.status ?? '').toLowerCase());
      return {
        ...item,
        provenance: buildChartProvenance({
          category: isVerified ? 'clinician_verified' : 'clinician_entered',
          sourceLabel: 'Discharge summary',
          reviewStatus: isVerified ? 'verified' : 'pending_review',
          reviewedAt: item.updated_at ?? null,
          reviewedBy: null,
          fallbackVerified: isVerified,
        }),
      };
    });

    const decoratedDocuments: Array<Record<string, unknown> & { provenance: ChartSourceProvenance }> = documents.map((item) => ({
      ...item,
      provenance: buildChartProvenance({
        category: 'imported_record',
        sourceLabel: 'Imported document',
        reviewStatus: 'pending_review',
        reviewedAt: null,
        reviewedBy: null,
      }),
    }));

    const decoratedReferrals: Array<Record<string, unknown> & { provenance: ChartSourceProvenance }> = referrals.map((item) => ({
      ...item,
      provenance: buildChartProvenance({
        category: 'clinician_entered',
        sourceLabel: 'Referral',
        reviewStatus: 'verified',
        reviewedAt: item.created_at ?? item.referred_date ?? null,
        reviewedBy: null,
        fallbackVerified: true,
      }),
    }));

    const decoratedRadiologyOrders: Array<Record<string, unknown> & { provenance: ChartSourceProvenance }> = radiologyOrders.map((item) => ({
      ...item,
      provenance: buildChartProvenance({
        category: 'clinician_entered',
        sourceLabel: 'Radiology order',
        reviewStatus: 'verified',
        reviewedAt: item.imaging_date ?? null,
        reviewedBy: null,
        fallbackVerified: true,
      }),
    }));

    const activeProblems = problems.filter((item) => item.status === 'active');
    const resolvedProblems = problems.filter((item) => item.status === 'resolved');
    const inactiveProblems = problems.filter((item) => item.status === 'inactive');
    const provenanceReviewItems = [
      ...allergies.map((item) => normalizeReviewStatus(item.review_status, Boolean(item.verified_at))),
      ...medications.map((item) => normalizeReviewStatus(item.review_status, String(item.source ?? '') !== 'patient_reported')),
      ...diagnoses.map((item) => normalizeReviewStatus(item.review_status, true)),
      ...decoratedLabResults.map((item) => normalizeReviewStatus(item.provenance?.review_status, false)),
      ...decoratedRadiologyReports.map((item) => normalizeReviewStatus(item.provenance?.review_status, false)),
      ...decoratedDischargeSummaries.map((item) => normalizeReviewStatus(item.provenance?.review_status, false)),
      ...decoratedDocuments.map((item) => normalizeReviewStatus(item.provenance?.review_status, false)),
      ...decoratedReferrals.map((item) => normalizeReviewStatus(item.provenance?.review_status, false)),
    ];
    const provenanceSummary = {
      pendingReviewCount: provenanceReviewItems.filter((item) => item === 'pending_review').length,
      verifiedCount: provenanceReviewItems.filter((item) => item === 'verified').length,
      rejectedCount: provenanceReviewItems.filter((item) => item === 'rejected').length,
    };
    const lifestyleSleepValues = lifestyleLogs
      .map((item) => Number(item.sleep_hours))
      .filter((value) => Number.isFinite(value) && value > 0);
    const patientReportedSummary = {
      adverse_reactions: adverseReactions.slice(0, 4).map((item) => ({
        ...item,
        review_status: normalizeReviewStatus(item.review_status, false),
        review_actions: {
          review_path: `/api/patient-reported/adverse-reactions/${String(item.id)}/review`,
          approve_method: 'PUT',
          reject_method: 'PUT',
        },
      })),
      lifestyle_logs: lifestyleLogs.slice(0, 4).map((item) => ({
        ...item,
        review_status: normalizeReviewStatus(item.review_status, false),
        review_actions: {
          review_path: `/api/patient-reported/lifestyle-logs/${String(item.id)}/review`,
          approve_method: 'PUT',
          reject_method: 'PUT',
        },
      })),
      highlights: {
        average_sleep_hours: lifestyleSleepValues.length
          ? Number((lifestyleSleepValues.reduce((sum, value) => sum + value, 0) / lifestyleSleepValues.length).toFixed(2))
          : null,
        recent_exercise_minutes: lifestyleLogs.reduce((sum, item) => sum + Number(item.exercise_minutes ?? 0), 0),
        pending_review_count: [...adverseReactions, ...lifestyleLogs]
          .filter((item) => normalizeReviewStatus(item.review_status, false) === 'pending_review').length,
        severe_adr_count: adverseReactions.filter((item) => String(item.severity ?? '').toLowerCase() === 'severe').length,
      },
    };
    const abnormalLabs = decoratedLabResults.filter((item) => {
      const flag = String(item.abnormal_flag ?? '').toLowerCase();
      return flag === 'high' || flag === 'low' || flag === 'critical';
    });
    const pendingLabs = labOrders.filter((item) => Number(item.pending_items ?? 0) > 0);
    const latestVitals = vitals[0] ?? null;
    const familyRiskOverview = buildChartFamilyRiskSummary(rawFamilyRiskOverview, {
      age: buildPatientAge(patient as { age?: number | null; date_of_birth?: string | null }),
      activeProblems: activeProblems.map((item) => String(item.description ?? '')),
      latestVitals,
    });
    const activeConsultation = consultations.find((item) => ['scheduled', 'in_progress'].includes(String(item.status ?? ''))) ?? null;
    const hasScheduledFollowUp = appointments.some((item) => String(item.status ?? '') === 'scheduled');
    const hasUnverifiedAllergy = allergies.some((item) => !item.verified_at);
    const chronicProblemKeywords = ['diabetes', 'hypertension', 'asthma', 'copd', 'heart failure', 'ckd'];
    const hasDiabetes = activeProblems.some((item) => {
      const value = `${String(item.description ?? '')} ${String(item.icd10_code ?? '')}`.toLowerCase();
      return value.includes('diabetes') || value.includes('e11') || value.includes('e10');
    });
    const hasHypertension = activeProblems.some((item) => {
      const value = `${String(item.description ?? '')} ${String(item.icd10_code ?? '')}`.toLowerCase();
      return value.includes('hypertension') || value.includes('i10');
    });
    const hasAirwayDisease = activeProblems.some((item) => {
      const value = `${String(item.description ?? '')} ${String(item.icd10_code ?? '')}`.toLowerCase();
      return value.includes('asthma') || value.includes('copd') || value.includes('j44') || value.includes('j45');
    });
    const hasChronicCondition = activeProblems.some((item) => {
      const value = `${String(item.description ?? '')} ${String(item.icd10_code ?? '')}`.toLowerCase();
      return chronicProblemKeywords.some((keyword) => value.includes(keyword));
    });
    const latestA1c = decoratedLabResults.find((item) => String(item.test_name ?? '').toLowerCase().includes('hba1c') || String(item.test_name ?? '').toLowerCase().includes('a1c')) ?? null;
    const latestBloodSugar = latestVitals ? Number(latestVitals.blood_sugar ?? 0) : 0;
    const latestSystolic = latestVitals ? Number(latestVitals.systolic ?? 0) : 0;
    const latestDiastolic = latestVitals ? Number(latestVitals.diastolic ?? 0) : 0;
    const scheduledFollowUpDate = appointments.find((item) => String(item.status ?? '') === 'scheduled')?.appointment_date ?? null;
    const missedFollowUp = appointments.find((item) => {
      const status = String(item.status ?? '').toLowerCase();
      const appointmentDate = String(item.appointment_date ?? '');
      return ['no_show', 'cancelled'].includes(status) || (status === 'scheduled' && appointmentDate && appointmentDate < '2026-04-01');
    }) ?? null;
    const medsNearEnd = currentMedications.filter((item) => {
      const endDate = String(item.end_date ?? '');
      return Boolean(endDate) && endDate <= '2026-04-07';
    });
    const medsOnHold = currentMedications.filter((item) => String(item.status ?? '').toLowerCase() === 'on_hold');
    const stoppedChronicMeds = stoppedMedications.filter((item) => {
      const value = `${String(item.medication_name ?? '')} ${String(item.generic_name ?? '')}`.toLowerCase();
      return hasChronicCondition && ['metformin', 'insulin', 'amlodipine', 'losartan', 'salbutamol', 'seretide'].some((keyword) => value.includes(keyword));
    });
    const needsEarlyReview = Boolean(
      (latestVitals && (Number(latestVitals.systolic ?? 0) >= 160 || Number(latestVitals.blood_sugar ?? 0) >= 250 || Number(latestVitals.temperature ?? 0) >= 38.0))
      || abnormalLabs.some((item) => ['critical', 'high'].includes(String(item.abnormal_flag ?? '').toLowerCase())),
    );

    const chronicCareReminders = [
      hasDiabetes && !latestA1c
        ? {
            code: 'diabetes-a1c-missing',
            severity: 'warning',
            label: 'No HbA1c result found in chart',
            recommendation: 'Order HbA1c for diabetes follow-up.',
          }
        : null,
      hasDiabetes && latestBloodSugar >= 200 && !hasScheduledFollowUp
        ? {
            code: 'diabetes-follow-up',
            severity: 'critical',
            label: `Blood sugar ${latestBloodSugar} needs close follow-up`,
            recommendation: 'Arrange early diabetic review within 7 days.',
          }
        : null,
      hasHypertension && latestSystolic >= 140 && !hasScheduledFollowUp
        ? {
            code: 'hypertension-follow-up',
            severity: latestSystolic >= 160 || latestDiastolic >= 100 ? 'critical' : 'warning',
            label: `BP ${latestSystolic}/${latestDiastolic} needs reassessment`,
            recommendation: 'Schedule BP review and medication adherence check.',
          }
        : null,
      hasAirwayDisease && !hasScheduledFollowUp
        ? {
            code: 'airway-follow-up',
            severity: 'warning',
            label: 'Chronic airway disease without follow-up',
            recommendation: 'Review symptom control and inhaler technique.',
          }
        : null,
      missedFollowUp
        ? {
            code: 'missed-follow-up',
            severity: 'critical',
            label: 'Patient missed or overdue for follow-up',
            recommendation: 'Contact patient and reschedule review promptly.',
          }
        : null,
      medsNearEnd.length > 0
        ? {
            code: 'medication-refill-risk',
            severity: 'warning',
            label: `${medsNearEnd.length} active medication(s) nearing end date`,
            recommendation: 'Check adherence and renew chronic prescriptions if needed.',
          }
        : null,
      medsOnHold.length > 0
        ? {
            code: 'medication-on-hold',
            severity: 'warning',
            label: `${medsOnHold.length} medication(s) currently on hold`,
            recommendation: 'Confirm whether held medicines should be restarted or stopped.',
          }
        : null,
      stoppedChronicMeds.length > 0 && !hasScheduledFollowUp
        ? {
            code: 'stopped-chronic-medication-review',
            severity: 'warning',
            label: 'Stopped chronic medication needs review',
            recommendation: 'Verify if treatment change was intentional and clinically safe.',
          }
        : null,
      hasChronicCondition && hasScheduledFollowUp && scheduledFollowUpDate
        ? {
            code: 'chronic-follow-up-booked',
            severity: 'info',
            label: `Chronic care follow-up booked for ${scheduledFollowUpDate}`,
            recommendation: 'Use next visit for medication reconciliation and trend review.',
          }
        : null,
    ].filter(Boolean);

    const riskFlags = [
      ...allergies
        .filter((item) => ['severe', 'life_threatening'].includes(String(item.severity ?? '')))
        .map((item) => ({
          type: 'allergy_alert',
          label: `${item.allergen} allergy`,
          severity: item.severity ?? 'severe',
        })),
      ...activeProblems
        .filter((item) => ['severe', 'critical'].includes(String(item.severity ?? '').toLowerCase()))
        .map((item) => ({
          type: 'clinical_problem',
          label: String(item.description ?? 'Active problem'),
          severity: item.severity ?? 'severe',
        })),
      ...abnormalLabs.slice(0, 3).map((item) => ({
        type: 'abnormal_lab',
        label: `${item.test_name}: ${item.abnormal_flag}`,
        severity: item.abnormal_flag ?? 'high',
      })),
      ...admissions
        .filter((item) => ['critical', 'admitted'].includes(String(item.status ?? '')))
        .slice(0, 1)
        .map((item) => ({
          type: 'admission',
          label: `${item.status === 'critical' ? 'Critical admission' : 'Currently admitted'}${item.ward_name ? ` · ${item.ward_name}` : ''}`,
          severity: item.status ?? 'admitted',
        })),
    ].slice(0, 6);

    const careAlerts = [
      latestVitals && Number(latestVitals.systolic ?? 0) >= 160
        ? { code: 'high-blood-pressure', severity: 'critical', label: `BP ${latestVitals.systolic}/${latestVitals.diastolic}` }
        : null,
      latestVitals && Number(latestVitals.blood_sugar ?? 0) >= 250
        ? { code: 'high-blood-sugar', severity: 'critical', label: `Blood sugar ${latestVitals.blood_sugar}` }
        : null,
      latestVitals && Number(latestVitals.temperature ?? 0) >= 38.0
        ? { code: 'fever-alert', severity: 'warning', label: `Temperature ${latestVitals.temperature}F` }
        : null,
      abnormalLabs.some((item) => String(item.abnormal_flag ?? '').toLowerCase() === 'critical' && !item.reviewed_at)
        ? { code: 'critical-lab', severity: 'critical', label: 'Critical lab result requires review' }
        : null,
      decoratedRadiologyReports.some((item) => ['reported', 'final'].includes(String(item.order_status ?? '').toLowerCase()) && !item.reviewed_at)
        ? { code: 'radiology-review-pending', severity: 'warning', label: 'Radiology report awaiting doctor review' }
        : null,
      hasScheduledFollowUp
        ? { code: 'follow-up-scheduled', severity: 'info', label: 'Upcoming follow-up scheduled' }
        : null,
      hasUnverifiedAllergy
        ? { code: 'allergy-verification', severity: 'warning', label: 'Unverified allergy needs confirmation' }
        : null,
      activeConsultation
        ? { code: 'active-consultation', severity: 'warning', label: 'Active consultation needs closure' }
        : null,
      needsEarlyReview && !hasScheduledFollowUp
        ? { code: 'follow-up-missing', severity: 'critical', label: 'No follow-up scheduled for unstable patient' }
        : null,
      hasChronicCondition && !hasScheduledFollowUp
        ? { code: 'chronic-follow-up-due', severity: 'warning', label: 'Chronic patient has no scheduled follow-up' }
        : null,
    ].filter(Boolean);

    const timeline = [
      ...visits.map((item) => toTimelineEvent({
        id: `visit-${item.id}`,
        type: 'visit',
        title: `${String(item.visit_type ?? 'visit').toUpperCase()} visit ${item.visit_no ? `· ${item.visit_no}` : ''}`.trim(),
        subtitle: String(item.icd10_description ?? item.notes ?? ''),
        doctor_name: String(item.doctor_name ?? ''),
        status: item.discharge_date ? 'closed' : 'active',
        date: String(item.created_at ?? ''),
        details: item.notes ? { Notes: String(item.notes).slice(0, 140) } : undefined,
      })),
      ...consultations.map((item) => toTimelineEvent({
        id: `consultation-${item.id}`,
        type: 'consultation',
        title: `Consultation${item.doctor_name ? ` · ${item.doctor_name}` : ''}`,
        subtitle: String(item.chief_complaint ?? item.notes ?? item.prescription ?? ''),
        doctor_name: String(item.doctor_name ?? ''),
        status: String(item.status ?? ''),
        date: String(item.scheduled_at ?? ''),
        details: {
          ...(item.followup_date ? { FollowUp: String(item.followup_date) } : {}),
          ...(item.prescription ? { Prescription: String(item.prescription).slice(0, 140) } : {}),
        },
      })),
      ...soapNotes.map((item) => toTimelineEvent({
        id: `soap-${item.SOAPId}`,
        type: 'soap',
        title: `SOAP Note${item.ChiefComplaint ? ` · ${item.ChiefComplaint}` : ''}`,
        subtitle: String(item.Assessment ?? item.Subjective ?? ''),
        status: 'completed',
        date: String(item.CreatedAt ?? ''),
        details: {
          ...(item.Objective ? { Objective: String(item.Objective).slice(0, 140) } : {}),
          ...(item.Plan ? { Plan: String(item.Plan).slice(0, 140) } : {}),
        },
      })),
      ...prescriptions.map((item) => toTimelineEvent({
        id: `rx-${item.id}`,
        type: 'prescription',
        title: `Prescription ${item.rx_no}`,
        subtitle: String(item.diagnosis ?? item.chief_complaint ?? ''),
        doctor_name: String(item.doctor_name ?? ''),
        status: String(item.status ?? ''),
        date: String(item.created_at ?? ''),
        details: item.advice ? { Advice: String(item.advice).slice(0, 140) } : undefined,
      })),
      ...labOrders.map((item) => toTimelineEvent({
        id: `lab-${item.id}`,
        type: 'lab',
        title: `Lab order ${item.order_no}`,
        subtitle: `${item.total_items ?? 0} test(s)`,
        doctor_name: '',
        status: Number(item.pending_items ?? 0) > 0 ? 'pending' : 'completed',
        date: String(item.order_date ?? ''),
        provenance: buildChartProvenance({
          category: 'clinician_entered',
          sourceLabel: 'Lab order',
          reviewStatus: 'verified',
          reviewedAt: item.order_date ?? null,
          reviewedBy: null,
          fallbackVerified: true,
        }),
        details: {
          Total: String(item.total_items ?? 0),
          Pending: String(item.pending_items ?? 0),
        },
      })),
      ...decoratedRadiologyOrders.map((item) => toTimelineEvent({
        id: `radiology-order-${item.id}`,
        type: 'radiology_order',
        title: `Radiology order · ${item.imaging_item_name ?? item.imaging_type_name ?? 'Imaging'}`,
        subtitle: String(item.requisition_remarks ?? item.procedure_code ?? ''),
        doctor_name: String(item.prescriber_name ?? ''),
        status: String(item.order_status ?? ''),
        date: String(item.imaging_date ?? ''),
        provenance: item.provenance as ChartSourceProvenance,
        details: {
          ...(item.urgency ? { Urgency: String(item.urgency) } : {}),
          ...(item.procedure_code ? { Procedure: String(item.procedure_code) } : {}),
        },
      })),
      ...decoratedRadiologyReports.map((item) => toTimelineEvent({
        id: `radiology-report-${item.id}`,
        type: 'radiology_report',
        title: `Radiology report · ${item.imaging_item_name ?? item.imaging_type_name ?? 'Imaging'}`,
        subtitle: String(item.report_text ?? item.indication ?? ''),
        doctor_name: String(item.performer_name ?? ''),
        status: String(item.order_status ?? ''),
        date: String(item.created_at ?? ''),
        provenance: item.provenance as ChartSourceProvenance,
        details: {
          ...(item.radiology_number ? { Number: String(item.radiology_number) } : {}),
          ...(item.indication ? { Indication: String(item.indication).slice(0, 140) } : {}),
        },
      })),
      ...admissions.map((item) => toTimelineEvent({
        id: `adm-${item.id}`,
        type: 'admission',
        title: `Admission ${item.admission_no}`,
        subtitle: String(item.provisional_diagnosis ?? item.notes ?? ''),
        doctor_name: String(item.doctor_name ?? ''),
        status: String(item.status ?? ''),
        date: String(item.admission_date ?? ''),
        details: {
          Ward: String(item.ward_name ?? '—'),
          Bed: String(item.bed_number ?? '—'),
        },
      })),
      ...dischargeSummaries.map((item) => toTimelineEvent({
        id: `discharge-${item.id}`,
        type: 'discharge',
        title: `Discharge summary${item.admission_no ? ` · ${item.admission_no}` : ''}`,
        subtitle: String(item.final_diagnosis ?? item.treatment_summary ?? ''),
        status: String(item.status ?? 'draft'),
        date: String(item.updated_at ?? ''),
        provenance: (decoratedDischargeSummaries.find((entry) => entry.id === item.id)?.provenance as ChartSourceProvenance | undefined),
        details: item.follow_up_instructions ? { FollowUp: String(item.follow_up_instructions).slice(0, 140) } : undefined,
      })),
      ...appointments.map((item) => toTimelineEvent({
        id: `appt-${item.id}`,
        type: 'appointment',
        title: `Appointment${item.doctor_name ? ` · ${item.doctor_name}` : ''}`,
        subtitle: String(item.time_slot ?? ''),
        doctor_name: String(item.doctor_name ?? ''),
        status: String(item.status ?? ''),
        date: String(item.appointment_date ?? ''),
      })),
      ...decoratedDocuments.map((item) => toTimelineEvent({
        id: `document-${item.id}`,
        type: 'document',
        title: String(item.title ?? 'Clinical document'),
        subtitle: String(item.description ?? item.document_type ?? ''),
        status: String(item.document_type ?? ''),
        date: String(item.created_at ?? ''),
        provenance: item.provenance as ChartSourceProvenance,
        details: item.file_name ? { File: String(item.file_name) } : undefined,
      })),
      ...decoratedReferrals.map((item) => toTimelineEvent({
        id: `referral-${item.id}`,
        type: 'referral',
        title: `Referral${item.referred_to ? ` · ${item.referred_to}` : ''}`,
        subtitle: String(item.referred_reason ?? item.remarks ?? ''),
        status: 'referred',
        date: String(item.referred_date ?? item.created_at ?? ''),
        provenance: item.provenance as ChartSourceProvenance,
      })),
      ...adverseReactions.map((item) => toTimelineEvent({
        id: `adr-${item.id}`,
        type: 'patient_reported_adr',
        title: `Patient-reported ADR · ${item.medication_name ?? item.generic_name ?? 'Reaction'}`,
        subtitle: String(item.reaction ?? item.notes ?? ''),
        status: String(normalizeReviewStatus(item.review_status, false)),
        date: String(item.created_at ?? item.onset_date ?? ''),
        provenance: buildChartProvenance({
          category: 'patient_reported',
          sourceLabel: 'Patient ADR',
          reviewStatus: item.review_status,
          reviewedAt: item.reviewed_at ?? null,
          reviewedBy: item.reviewed_by ?? null,
          fallbackVerified: false,
        }),
        details: {
          ...(item.severity ? { Severity: String(item.severity) } : {}),
          ...(item.outcome_status ? { Outcome: String(item.outcome_status) } : {}),
        },
      })),
      ...lifestyleLogs.map((item) => toTimelineEvent({
        id: `lifestyle-${item.id}`,
        type: 'patient_reported_lifestyle',
        title: `Patient-reported lifestyle · ${item.logged_on ?? 'Daily log'}`,
        subtitle: String(item.symptoms ?? item.notes ?? item.diet_notes ?? ''),
        status: String(normalizeReviewStatus(item.review_status, false)),
        date: String(item.logged_on ?? item.created_at ?? ''),
        provenance: buildChartProvenance({
          category: 'patient_reported',
          sourceLabel: 'Lifestyle log',
          reviewStatus: item.review_status,
          reviewedAt: item.reviewed_at ?? null,
          reviewedBy: item.reviewed_by ?? null,
          fallbackVerified: false,
        }),
        details: {
          ...(item.sleep_hours != null ? { Sleep: `${String(item.sleep_hours)}h` } : {}),
          ...(item.exercise_minutes != null ? { Exercise: `${String(item.exercise_minutes)} min` } : {}),
          ...(item.mood ? { Mood: String(item.mood) } : {}),
        },
      })),
    ].sort((a, b) => new Date(String(b.date)).getTime() - new Date(String(a.date)).getTime());

    const timelineCitationSources = timeline.slice(0, 20).map((item) => ({
      id: item.id,
      type: item.type,
      date: item.date,
      title: item.title,
      subtitle: item.subtitle ?? '',
      status: item.status ?? '',
    }));
    const familyRiskCitations = buildFamilyRiskCitationSources(familyRiskOverview);
    const citationSources = [...timelineCitationSources, ...familyRiskCitations];
    const deterministicSummary = composeDeterministicChartSummary({
      allergies,
      activeProblems,
      currentMedications,
      stoppedMedications,
      adverseReactions,
      lifestyleLogs,
      abnormalLabs,
      latestVitals,
      activeConsultation,
      hasScheduledFollowUp,
      hasUnverifiedAllergy,
      familyRiskOverview,
      citationSources,
    });
    const chartNarrative = buildChartNarrative({
      patient,
      allergies,
      activeProblems,
      medications,
      adverseReactions,
      lifestyleLogs,
      visits,
      consultations,
      soapNotes,
      prescriptions,
      labResults,
      radiologyOrders,
      radiologyReports,
      admissions,
      familyRiskOverview,
    }) + `\n\nTimeline sources:\n${citationSources.map((item) => `${item.id} | ${item.date} | ${item.type} | ${item.title} | ${item.subtitle}${item.status ? ` | ${item.status}` : ''}`).join('\n')}`;
    const aiPayload = includeAiSummary
      ? await buildAiChartSummary(c.env, chartNarrative, citationSources.map((item) => item.id), deterministicSummary)
      : null;

    return c.json({
      patient,
      snapshot: {
        allergies,
        activeProblems,
        currentMedications,
        riskFlags,
        lastVisit: visits[0] ?? null,
        lastAdmission: admissions[0] ?? null,
        primaryDoctor: visits[0]?.doctor_name || admissions[0]?.doctor_name
          ? { name: visits[0]?.doctor_name ?? admissions[0]?.doctor_name }
          : null,
      },
      timeline: timeline.slice(0, 24),
      vitalsTrend: vitals.reverse(),
      careAlerts,
      problemSummary: {
        active: activeProblems.slice(0, 8),
        resolved: resolvedProblems.slice(0, 8),
        inactive: inactiveProblems.slice(0, 8),
      },
      medicationHistory: {
        current: decoratedCurrentMedications.slice(0, 8),
        stopped: decoratedStoppedMedications.slice(0, 8),
      },
      allergySummary: {
        verifiedCount: allergies.filter((item) => Boolean(item.verified_at)).length,
        unverifiedCount: allergies.filter((item) => !item.verified_at).length,
      },
      patientReportedSummary,
      familyRiskSummary: familyRiskOverview,
      provenanceSummary,
      recentLabs: {
        abnormal: abnormalLabs.slice(0, 6),
        pending: pendingLabs.slice(0, 6),
        recent: decoratedLabResults.slice(0, 8),
      },
      documents: decoratedDocuments.slice(0, 8),
      tasks: {
        pendingFollowUps: appointments.filter((item) => item.status === 'scheduled').slice(0, 5),
        pendingOrders: pendingLabs.slice(0, 5),
        activeConsultation,
        vitalAlerts: vitalAlerts.slice(0, 5),
        chronicCareReminders,
      },
      diagnoses: decoratedDiagnoses.slice(0, 10),
      consultations: consultations.slice(0, 6),
      soapNotes: soapNotes.slice(0, 6),
      radiologyOrders: decoratedRadiologyOrders.slice(0, 6),
      radiologyReports: decoratedRadiologyReports.slice(0, 6),
      admissions: admissions.slice(0, 5),
      dischargeSummaries: decoratedDischargeSummaries.slice(0, 5),
      referrals: decoratedReferrals.slice(0, 5),
      prescriptions: prescriptions.slice(0, 8),
      visits: visits.slice(0, 8),
      clinicalNotes: clinicalNotes.slice(0, 10),
      clinicalImages: clinicalImages.slice(0, 10),
      encounters: encountersList.slice(0, 10),
      aiSummary: aiPayload
        ? {
            status: aiPayload.status,
            generatedAt: new Date().toISOString(),
            summary: aiPayload.summary,
            citations: citationSources,
            usage: aiPayload.usage,
          }
        : {
            status: 'not_requested',
            generatedAt: null,
            summary: deterministicSummary,
            citations: citationSources,
          },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('patient chart fetch error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch patient chart' });
  }
});

chartRoutes.get('/:id/chart/source/:sourceId', async (c) => {
  const id = c.req.param('id');
  const sourceId = c.req.param('sourceId');
  const tenantId = requireTenantId(c);

  try {
    const db = getDb(c.env.DB);
    const patientId = Number(id);
    if (Number.isNaN(patientId) || patientId <= 0) {
      throw new HTTPException(400, { message: 'Invalid patient id' });
    }

    const patient = await db.$client.prepare(`
      SELECT id, uhid, age, date_of_birth FROM patients WHERE id = ? AND tenant_id = ?
    `).bind(patientId, tenantId).first();

    if (!patient) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    const { rawType, recordId } = parseChartSourceId(sourceId);

    if (rawType === 'family_risk') {
      const familyRiskOverview = buildChartFamilyRiskSummary(
        await loadChartFamilyRiskOverview(c.env.DB, String((patient as { uhid?: string | null }).uhid ?? '')),
        {
          age: buildPatientAge(patient as { age?: number | null; date_of_birth?: string | null }),
          activeProblems: [],
          latestVitals: null,
        },
      );
      const insight = getFamilyRiskInsightBySourceId(familyRiskOverview, sourceId);
      if (!insight) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'family_risk',
        title: insight.label,
        date: new Date().toISOString(),
        status: insight.severity,
        summary: insight.why_it_matters,
        provenance: buildChartProvenance({
          category: 'family_history',
          sourceLabel: 'Family history',
          reviewStatus: 'verified',
          reviewedAt: new Date().toISOString(),
          reviewedBy: null,
          fallbackVerified: true,
        }),
        sections: [
          { label: 'Rationale', value: insight.rationale },
          { label: 'Chart Context', value: insight.care_context ?? 'No additional chart context available' },
          { label: 'Risk Score', value: insight.risk_score != null ? `${insight.risk_score} / 8` : null },
          { label: 'Screening Priority', value: insight.screening_priority ? insight.screening_priority.replace('_', ' ') : null },
          { label: 'Why It Matters', value: insight.why_it_matters },
          { label: 'Matched Relatives', value: insight.matched_relatives.map((item) => `${item.name ?? 'Relative'} (${item.relationship.replace('_', ' ')})${item.diagnosis ? ` - ${item.diagnosis}` : ''}`).join('\n') },
          { label: 'Screening Prompts', value: insight.screening_prompts?.join('\n') ?? null },
          { label: 'Suggested Follow Up', value: insight.next_steps.join('\n') },
        ],
      }));
    }

    if (rawType === 'consultation') {
      const item = await db.$client.prepare(`
        SELECT con.id, con.scheduled_at, con.status, con.notes, con.prescription, con.chief_complaint,
               con.followup_date, d.name as doctor_name
        FROM consultations con
        LEFT JOIN doctors d ON con.doctor_id = d.id
        WHERE con.id = ? AND con.tenant_id = ? AND con.patient_id = ?
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'consultation',
        title: `Consultation${item.doctor_name ? ` · ${item.doctor_name}` : ''}`,
        date: String(item.scheduled_at ?? ''),
        status: String(item.status ?? ''),
        summary: String(item.notes ?? item.prescription ?? item.chief_complaint ?? ''),
        provenance: buildChartProvenance({
          category: 'clinician_entered',
          sourceLabel: 'Consultation note',
          reviewStatus: 'verified',
          reviewedAt: item.scheduled_at ?? null,
          reviewedBy: null,
          fallbackVerified: true,
        }),
        sections: [
          { label: 'Chief Complaint', value: String(item.chief_complaint ?? '') },
          { label: 'Clinical Note', value: String(item.notes ?? '') },
          { label: 'Prescription', value: String(item.prescription ?? '') },
          { label: 'Follow Up', value: String(item.followup_date ?? '') },
          { label: 'Doctor', value: String(item.doctor_name ?? '') },
        ],
      }));
    }

    if (rawType === 'soap') {
      const item = await db.$client.prepare(`
        SELECT SOAPId, PatientId, EncounterId, ChiefComplaint, Subjective, Objective, Assessment, Plan, CreatedById, CreatedAt
        FROM FormSOAP
        WHERE SOAPId = ? AND tenant_id = ? AND PatientId = ?
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'soap',
        title: `SOAP Note${item.ChiefComplaint ? ` · ${item.ChiefComplaint}` : ''}`,
        date: String(item.CreatedAt ?? ''),
        status: 'completed',
        summary: String(item.Assessment ?? item.Subjective ?? item.Plan ?? ''),
        provenance: buildChartProvenance({
          category: 'clinician_entered',
          sourceLabel: 'SOAP note',
          reviewStatus: 'verified',
          reviewedAt: item.CreatedAt ?? null,
          reviewedBy: item.CreatedById ?? null,
          fallbackVerified: true,
        }),
        sections: [
          { label: 'Chief Complaint', value: String(item.ChiefComplaint ?? '') },
          { label: 'Subjective', value: String(item.Subjective ?? '') },
          { label: 'Objective', value: String(item.Objective ?? '') },
          { label: 'Assessment', value: String(item.Assessment ?? '') },
          { label: 'Plan', value: String(item.Plan ?? '') },
        ],
      }));
    }

    if (rawType === 'problem') {
      const item = await db.$client.prepare(`
        SELECT ProblemId, ICD10Code, Description, Severity, Status, BegDate, EndDate, Comments, ModifiedAt
        FROM CLN_ProblemList
        WHERE ProblemId = ? AND tenant_id = ? AND PatientId = ?
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'problem',
        title: `Problem · ${item.Description ?? 'Clinical problem'}`,
        date: String(item.ModifiedAt ?? item.BegDate ?? ''),
        status: String(item.Status ?? ''),
        summary: String(item.Comments ?? item.Description ?? ''),
        provenance: buildChartProvenance({
          category: 'clinician_entered',
          sourceLabel: 'Problem list',
          reviewStatus: 'verified',
          reviewedAt: item.ModifiedAt ?? item.BegDate ?? null,
          reviewedBy: null,
          fallbackVerified: true,
        }),
        sections: [
          { label: 'ICD-10', value: String(item.ICD10Code ?? '') },
          { label: 'Severity', value: String(item.Severity ?? '') },
          { label: 'Status', value: String(item.Status ?? '') },
          { label: 'Started', value: String(item.BegDate ?? '') },
          { label: 'Ended', value: String(item.EndDate ?? '') },
          { label: 'Comments', value: String(item.Comments ?? '') },
        ],
      }));
    }

    if (rawType === 'medication') {
      const item = await db.$client.prepare(`
        SELECT id, medication_name, generic_name, dosage, frequency, duration, instructions,
               start_date, end_date, status, status_reason, source,
               review_status, reviewed_at, reviewed_by, review_notes
        FROM patient_active_medications
        WHERE id = ? AND tenant_id = ? AND patient_id = ? AND is_active = 1
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'medication',
        title: `Medication · ${item.medication_name ?? item.generic_name ?? 'Medication'}`,
        date: String(item.start_date ?? ''),
        status: String(item.status ?? ''),
        summary: String(item.instructions ?? item.status_reason ?? ''),
        provenance: buildChartProvenance({
          category: String(item.source ?? '') === 'patient_reported'
            ? 'patient_reported'
            : normalizeReviewStatus(item.review_status, String(item.source ?? '') !== 'patient_reported') === 'verified'
              ? 'clinician_verified'
              : 'clinician_entered',
          sourceLabel: 'Medication',
          reviewStatus: item.review_status,
          reviewedAt: item.reviewed_at ?? null,
          reviewedBy: item.reviewed_by ?? null,
          fallbackVerified: String(item.source ?? '') !== 'patient_reported',
        }),
        sections: [
          { label: 'Generic', value: String(item.generic_name ?? '') },
          { label: 'Dose', value: String(item.dosage ?? '') },
          { label: 'Frequency', value: String(item.frequency ?? '') },
          { label: 'Duration', value: String(item.duration ?? '') },
          { label: 'Start Date', value: String(item.start_date ?? '') },
          { label: 'End Date', value: String(item.end_date ?? '') },
          { label: 'Review Status', value: String(normalizeReviewStatus(item.review_status, String(item.source ?? '') !== 'patient_reported')) },
          { label: 'Reviewed At', value: String(item.reviewed_at ?? '') },
          { label: 'Status Reason', value: String(item.status_reason ?? '') },
          { label: 'Review Notes', value: String(item.review_notes ?? '') },
          { label: 'Instructions', value: String(item.instructions ?? '') },
        ],
        reviewActions: {
          review_path: `/api/e-prescribing/patient/${patientId}/medications/${recordId}/review`,
          approve_method: 'PUT',
          reject_method: 'PUT',
        },
      }));
    }

    if (rawType === 'allergy') {
      const item = await db.$client.prepare(`
        SELECT id, allergy_type, allergen, severity, reaction, onset_date, notes, verified_at,
               review_status, reviewed_at, reviewed_by, review_notes
        FROM patient_allergies
        WHERE id = ? AND tenant_id = ? AND patient_id = ? AND is_active = 1
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'allergy',
        title: `Allergy · ${item.allergen ?? 'Allergy'}`,
        date: String(item.onset_date ?? ''),
        status: item.verified_at ? 'verified' : 'unverified',
        summary: String(item.reaction ?? item.notes ?? ''),
        provenance: buildChartProvenance({
          category: normalizeReviewStatus(item.review_status, Boolean(item.verified_at)) === 'verified'
            ? 'clinician_verified'
            : 'clinician_entered',
          sourceLabel: 'Allergy',
          reviewStatus: item.review_status,
          reviewedAt: item.reviewed_at ?? item.verified_at ?? null,
          reviewedBy: item.reviewed_by ?? null,
          fallbackVerified: Boolean(item.verified_at),
        }),
        sections: [
          { label: 'Type', value: String(item.allergy_type ?? '') },
          { label: 'Severity', value: String(item.severity ?? '') },
          { label: 'Reaction', value: String(item.reaction ?? '') },
          { label: 'Onset Date', value: String(item.onset_date ?? '') },
          { label: 'Review Status', value: String(normalizeReviewStatus(item.review_status, Boolean(item.verified_at))) },
          { label: 'Reviewed At', value: String(item.reviewed_at ?? '') },
          { label: 'Verified At', value: String(item.verified_at ?? '') },
          { label: 'Review Notes', value: String(item.review_notes ?? '') },
          { label: 'Notes', value: String(item.notes ?? '') },
        ],
        reviewActions: {
          review_path: `/api/allergies/${recordId}/review`,
          approve_method: 'PUT',
          reject_method: 'PUT',
        },
      }));
    }

    if (rawType === 'patient_reported_adr') {
      const item = await db.$client.prepare(`
        SELECT id, medication_name, generic_name, reaction, severity, onset_date, outcome_status, notes,
               source, review_status, reviewed_by, reviewed_at, review_notes, created_at
        FROM global_patient_adverse_reactions
        WHERE id = ? AND uhid = ?
      `).bind(recordId, (patient as { uhid?: string | null }).uhid ?? null).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'patient_reported_adr',
        title: `Patient-reported ADR · ${item.medication_name ?? item.generic_name ?? 'Reaction'}`,
        date: String(item.created_at ?? item.onset_date ?? ''),
        status: String(normalizeReviewStatus(item.review_status, false)),
        summary: String(item.reaction ?? item.notes ?? ''),
        provenance: buildChartProvenance({
          category: 'patient_reported',
          sourceLabel: 'Patient ADR',
          reviewStatus: item.review_status,
          reviewedAt: item.reviewed_at ?? null,
          reviewedBy: item.reviewed_by ?? null,
          fallbackVerified: false,
        }),
        sections: [
          { label: 'Medication', value: String(item.medication_name ?? '') },
          { label: 'Generic', value: String(item.generic_name ?? '') },
          { label: 'Reaction', value: String(item.reaction ?? '') },
          { label: 'Severity', value: String(item.severity ?? '') },
          { label: 'Onset Date', value: String(item.onset_date ?? '') },
          { label: 'Outcome', value: String(item.outcome_status ?? '') },
          { label: 'Review Status', value: String(normalizeReviewStatus(item.review_status, false)) },
          { label: 'Reviewed At', value: String(item.reviewed_at ?? '') },
          { label: 'Review Notes', value: String(item.review_notes ?? '') },
          { label: 'Notes', value: String(item.notes ?? '') },
        ],
        reviewActions: {
          review_path: `/api/patient-reported/adverse-reactions/${recordId}/review`,
          approve_method: 'PUT',
          reject_method: 'PUT',
        },
      }));
    }

    if (rawType === 'patient_reported_lifestyle') {
      const item = await db.$client.prepare(`
        SELECT id, logged_on, sleep_hours, exercise_minutes, mood, energy_level, symptom_score, symptoms,
               diet_notes, notes, source, review_status, reviewed_by, reviewed_at, review_notes, created_at
        FROM global_patient_lifestyle_logs
        WHERE id = ? AND uhid = ?
      `).bind(recordId, (patient as { uhid?: string | null }).uhid ?? null).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'patient_reported_lifestyle',
        title: `Patient-reported lifestyle · ${item.logged_on ?? 'Daily log'}`,
        date: String(item.logged_on ?? item.created_at ?? ''),
        status: String(normalizeReviewStatus(item.review_status, false)),
        summary: String(item.symptoms ?? item.notes ?? item.diet_notes ?? ''),
        provenance: buildChartProvenance({
          category: 'patient_reported',
          sourceLabel: 'Lifestyle log',
          reviewStatus: item.review_status,
          reviewedAt: item.reviewed_at ?? null,
          reviewedBy: item.reviewed_by ?? null,
          fallbackVerified: false,
        }),
        sections: [
          { label: 'Sleep Hours', value: String(item.sleep_hours ?? '') },
          { label: 'Exercise Minutes', value: String(item.exercise_minutes ?? '') },
          { label: 'Mood', value: String(item.mood ?? '') },
          { label: 'Energy', value: String(item.energy_level ?? '') },
          { label: 'Symptom Score', value: String(item.symptom_score ?? '') },
          { label: 'Symptoms', value: String(item.symptoms ?? '') },
          { label: 'Diet Notes', value: String(item.diet_notes ?? '') },
          { label: 'Review Status', value: String(normalizeReviewStatus(item.review_status, false)) },
          { label: 'Reviewed At', value: String(item.reviewed_at ?? '') },
          { label: 'Review Notes', value: String(item.review_notes ?? '') },
          { label: 'Notes', value: String(item.notes ?? '') },
        ],
        reviewActions: {
          review_path: `/api/patient-reported/lifestyle-logs/${recordId}/review`,
          approve_method: 'PUT',
          reject_method: 'PUT',
        },
      }));
    }

    if (rawType === 'radiology_report') {
      const item = await db.$client.prepare(`
        SELECT rr.id, rr.created_at, rr.imaging_type_name, rr.imaging_item_name, rr.performer_name,
               rr.report_text, rr.indication, rr.radiology_number, rr.order_status
        FROM radiology_reports rr
        WHERE rr.id = ? AND rr.tenant_id = ? AND rr.patient_id = ? AND rr.is_active = 1
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      const review = await loadLatestApprovalAudit(db, tenantId, 'radiology_reports', recordId);
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'radiology_report',
        title: `Radiology Report · ${item.imaging_item_name ?? item.imaging_type_name ?? 'Imaging'}`,
        date: String(item.created_at ?? ''),
        status: String(item.order_status ?? ''),
        summary: String(item.report_text ?? item.indication ?? ''),
        provenance: buildChartProvenance({
          category: review?.created_at ? 'clinician_verified' : 'clinician_entered',
          sourceLabel: 'Radiology report',
          reviewStatus: review?.created_at ? 'verified' : 'pending_review',
          reviewedAt: review?.created_at ?? null,
          reviewedBy: review?.user_id ?? null,
          fallbackVerified: Boolean(review?.created_at),
        }),
        sections: [
          { label: 'Imaging', value: String(item.imaging_item_name ?? item.imaging_type_name ?? '') },
          { label: 'Findings', value: String(item.report_text ?? '') },
          { label: 'Indication', value: String(item.indication ?? '') },
          { label: 'Radiology No', value: String(item.radiology_number ?? '') },
          { label: 'Performer', value: String(item.performer_name ?? '') },
          { label: 'Review Status', value: review?.created_at ? 'verified' : 'pending_review' },
          { label: 'Reviewed At', value: String(review?.created_at ?? '') },
        ],
      }));
    }

    if (rawType === 'radiology_order') {
      const item = await db.$client.prepare(`
        SELECT rr.id, rr.imaging_date, rr.imaging_type_name, rr.imaging_item_name, rr.procedure_code,
               rr.urgency, rr.order_status, rr.requisition_remarks, rr.prescriber_name
        FROM radiology_requisitions rr
        WHERE rr.id = ? AND rr.tenant_id = ? AND rr.patient_id = ? AND rr.is_active = 1
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'radiology_order',
        title: `Radiology Order · ${item.imaging_item_name ?? item.imaging_type_name ?? 'Imaging'}`,
        date: String(item.imaging_date ?? ''),
        status: String(item.order_status ?? ''),
        summary: String(item.requisition_remarks ?? item.procedure_code ?? ''),
        provenance: buildChartProvenance({
          category: 'clinician_entered',
          sourceLabel: 'Radiology order',
          reviewStatus: 'verified',
          reviewedAt: item.imaging_date ?? null,
          reviewedBy: null,
          fallbackVerified: true,
        }),
        sections: [
          { label: 'Imaging', value: String(item.imaging_item_name ?? item.imaging_type_name ?? '') },
          { label: 'Urgency', value: String(item.urgency ?? '') },
          { label: 'Procedure', value: String(item.procedure_code ?? '') },
          { label: 'Requested By', value: String(item.prescriber_name ?? '') },
          { label: 'Remarks', value: String(item.requisition_remarks ?? '') },
        ],
      }));
    }

    if (rawType === 'lab') {
      const item = await db.$client.prepare(`
        SELECT loi.id, loi.result, loi.result_numeric, loi.abnormal_flag, loi.status, loi.completed_at,
               lo.order_no, lo.order_date,
               ltc.name as test_name, ltc.unit, ltc.normal_range
        FROM lab_order_items loi
        JOIN lab_orders lo ON loi.lab_order_id = lo.id
        LEFT JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
        WHERE loi.id = ? AND lo.tenant_id = ? AND lo.patient_id = ?
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      const review = await loadLatestApprovalAudit(db, tenantId, 'lab_order_items', recordId);
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'lab',
        title: `Lab Result · ${item.test_name ?? item.order_no ?? 'Lab result'}`,
        date: String(item.completed_at ?? item.order_date ?? ''),
        status: String(item.abnormal_flag ?? item.status ?? ''),
        summary: `${String(item.result ?? item.result_numeric ?? 'Pending')}${item.unit ? ` ${String(item.unit)}` : ''}${item.normal_range ? ` · ref ${String(item.normal_range)}` : ''}`,
        provenance: buildChartProvenance({
          category: review?.created_at ? 'clinician_verified' : 'clinician_entered',
          sourceLabel: 'Lab result',
          reviewStatus: review?.created_at ? 'verified' : 'pending_review',
          reviewedAt: review?.created_at ?? null,
          reviewedBy: review?.user_id ?? null,
          fallbackVerified: Boolean(review?.created_at),
        }),
        sections: [
          { label: 'Order No', value: String(item.order_no ?? '') },
          { label: 'Completed At', value: String(item.completed_at ?? '') },
          { label: 'Result', value: String(item.result ?? item.result_numeric ?? '') },
          { label: 'Flag', value: String(item.abnormal_flag ?? item.status ?? '') },
          { label: 'Reference Range', value: String(item.normal_range ?? '') },
          { label: 'Review Status', value: review?.created_at ? 'verified' : 'pending_review' },
          { label: 'Reviewed At', value: String(review?.created_at ?? '') },
        ],
      }));
    }

    if (rawType === 'discharge') {
      const item = await db.$client.prepare(`
        SELECT ds.id, ds.admission_id, ds.final_diagnosis, ds.treatment_summary, ds.follow_up_date,
               ds.follow_up_instructions, ds.doctor_notes, ds.status, ds.updated_at, a.admission_no
        FROM discharge_summaries ds
        LEFT JOIN admissions a ON ds.admission_id = a.id AND a.tenant_id = ds.tenant_id
        WHERE ds.id = ? AND ds.tenant_id = ? AND ds.patient_id = ?
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      const isVerified = ['final', 'completed', 'signed'].includes(String(item.status ?? '').toLowerCase());
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'discharge',
        title: `Discharge Summary${item.admission_no ? ` · ${item.admission_no}` : ''}`,
        date: String(item.updated_at ?? ''),
        status: String(item.status ?? ''),
        summary: String(item.final_diagnosis ?? item.treatment_summary ?? ''),
        provenance: buildChartProvenance({
          category: isVerified ? 'clinician_verified' : 'clinician_entered',
          sourceLabel: 'Discharge summary',
          reviewStatus: isVerified ? 'verified' : 'pending_review',
          reviewedAt: item.updated_at ?? null,
          reviewedBy: null,
          fallbackVerified: isVerified,
        }),
        sections: [
          { label: 'Final Diagnosis', value: String(item.final_diagnosis ?? '') },
          { label: 'Treatment Summary', value: String(item.treatment_summary ?? '') },
          { label: 'Follow Up Date', value: String(item.follow_up_date ?? '') },
          { label: 'Follow Up Instructions', value: String(item.follow_up_instructions ?? '') },
          { label: 'Doctor Notes', value: String(item.doctor_notes ?? '') },
          { label: 'Review Status', value: isVerified ? 'verified' : 'pending_review' },
        ],
      }));
    }

    if (rawType === 'document') {
      const item = await db.$client.prepare(`
        SELECT id, medical_record_id, document_type, title, description, file_name, created_at
        FROM document_records
        WHERE id = ? AND tenant_id = ? AND patient_id = ? AND is_active = 1
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'document',
        title: String(item.title ?? 'Clinical document'),
        date: String(item.created_at ?? ''),
        status: String(item.document_type ?? ''),
        summary: String(item.description ?? item.file_name ?? ''),
        provenance: buildChartProvenance({
          category: 'imported_record',
          sourceLabel: 'Imported document',
          reviewStatus: 'pending_review',
          reviewedAt: null,
          reviewedBy: null,
        }),
        sections: [
          { label: 'Document Type', value: String(item.document_type ?? '') },
          { label: 'Description', value: String(item.description ?? '') },
          { label: 'File Name', value: String(item.file_name ?? '') },
          { label: 'Review Status', value: 'pending_review' },
        ],
      }));
    }

    if (rawType === 'referral') {
      const item = await db.$client.prepare(`
        SELECT id, referred_to, referred_date, referred_time, referred_reason, file_number, remarks, created_at
        FROM medical_records
        WHERE id = ? AND tenant_id = ? AND patient_id = ? AND is_active = 1 AND discharge_type = 'referred'
      `).bind(recordId, tenantId, patientId).first<Record<string, unknown>>();
      if (!item) throw new HTTPException(404, { message: 'Chart source not found' });
      return c.json(buildSourceResponse({
        id: sourceId,
        type: 'referral',
        title: `Referral${item.referred_to ? ` · ${item.referred_to}` : ''}`,
        date: String(item.referred_date ?? item.created_at ?? ''),
        status: 'referred',
        summary: String(item.referred_reason ?? item.remarks ?? ''),
        provenance: buildChartProvenance({
          category: 'clinician_entered',
          sourceLabel: 'Referral',
          reviewStatus: 'verified',
          reviewedAt: item.created_at ?? item.referred_date ?? null,
          reviewedBy: null,
          fallbackVerified: true,
        }),
        sections: [
          { label: 'Referred To', value: String(item.referred_to ?? '') },
          { label: 'Reason', value: String(item.referred_reason ?? '') },
          { label: 'File Number', value: String(item.file_number ?? '') },
          { label: 'Referral Time', value: String(item.referred_time ?? '') },
          { label: 'Remarks', value: String(item.remarks ?? '') },
          { label: 'Review Status', value: 'verified' },
        ],
      }));
    }

    throw new HTTPException(404, { message: 'Chart source type not supported yet' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('patient chart source fetch error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch chart source' });
  }
});


export default chartRoutes;
