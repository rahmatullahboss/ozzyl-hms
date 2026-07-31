import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { eq, and, like, or, lt, sql, desc, count } from 'drizzle-orm';
import { createPatientSchema, updatePatientSchema } from '../../schemas/patient';
import { createSOAPSchema, soapTemplateSchema, updateSoapTemplateSchema } from '../../schemas/clinical-assessments';
import soapTemplateRoutes from './patients-soap-templates';
import patientTimelineRoutes from './patients-timeline';
import patientSummaryRoutes from './patients-summary';
import patientChartRoutes from './patients-chart';
import { callAIJson, type ChatMessage } from '../../lib/ai';
import { getNextSequence } from '../../lib/sequence';
import { getNextInvoiceNumber } from '../../lib/invoice-sequence';
import { createAuditLog } from '../../lib/accounting-helpers';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import { postPendingAccountingEvents } from '../../lib/accounting-posting';
import { recordBillFinalizationSideEffects } from '../../lib/billing-finalization';
import { accrueLabOrderDoctorCommissions } from '../../lib/lab-finance';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { createLabOrderBilling } from '../../lib/canonical/commands/create-lab-order-billing';
import { createRadiologyRequisitionBilling } from '../../lib/canonical/commands/create-radiology-requisition-billing';
import { isFinancialBatchAssertionError } from '../../lib/canonical/financial-batch-assertion';
import { buildLegacyLiveInvoiceSourceLineId } from '../../lib/canonical/live-invoice-line-identity';
import { toMinorUnits } from '../../lib/canonical/money';
import {
  executePatientChartLabOrderOriginalLegacy,
  preparePatientChartLabOrderStrictContext,
  preparePatientChartLabOrderStrictStatements,
  type PatientChartLabBillingContext,
  type PatientChartLabBillingPreparationInput,
} from '../../lib/canonical/patient-chart-lab-billing';
import {
  executePatientChartRadiologyOriginalLegacy,
  preparePatientChartRadiologyStrictContext,
  preparePatientChartRadiologyStrictStatements,
  type PatientChartRadiologyBillingContext,
  type PatientChartRadiologyBillingPreparationInput,
} from '../../lib/canonical/patient-chart-radiology-billing';
import { getDb } from '../../db';
import { patients } from '../../db/schema';
import { resolveOrCreateGlobalIdentity } from '../../lib/global-identity';
import {
  buildLocalSyncOutboxStatement,
  buildLocalSyncPatientCreateOutboxStatement,
  recordLocalSyncOutboxEvent,
} from '../../lib/local-sync-outbox';
import { buildLocalSyncPatientPayload } from '../../lib/local-sync-patient-payload';
import { markCardsStale } from '../../lib/health-card-utils';
import { calculateAgeFromDateOfBirth } from '../../lib/patient-age';
import {
  beginPatientRegistrationAttempt,
  completePatientRegistrationAttempt,
  ensurePatientRegistrationSerial,
  failPatientRegistrationAttempt,
  recoverPatientRegistrationResponse,
  type PatientRegistrationAttempt,
} from '../../lib/patient-registration-idempotency';
import { normalizeBangladeshMobile } from '../../lib/bangladesh-phone';
import { requirePermission } from '../../middleware/rbac';
import { composeDeterministicChartSummary, sanitizeAiSummaryOutput, type PhysicianSummary } from '../../lib/chart-ai-summary';
import {
  buildChartFamilyRiskSummary,
  buildFamilyRiskCitationSources,
  getFamilyRiskInsightBySourceId,
  loadChartFamilyRiskOverview,
} from '../../lib/family-risk';
import { resolveLabTestBillingRow, resolveRadiologyBillingRow } from '../../lib/diagnostic-catalog';

const patientRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

type PatientChartRow = Record<string, any>;

function queuePatientChartAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post patient chart diagnostic billing accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function isPatientChartDiagnosticCanonicalConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/canonical|mapping|catalog|invoice|idempotency|constraint|concurrent|strict financial/i.test(message)) {
      return true;
    }
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function syncText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function syncNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildGlobalIdentitySyncPayload(identity: Record<string, unknown>, fallback: {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
}): Record<string, unknown> | null {
  const uhid = syncText(identity.uhid);
  if (!uhid) return null;
  return {
    id: syncNumber(identity.id),
    uhid,
    national_id: syncText(identity.national_id) ?? syncText(identity.nationalId),
    primary_name: syncText(identity.primary_name) ?? fallback.name ?? null,
    primary_phone: syncText(identity.primary_phone) ?? fallback.phone ?? null,
    primary_email: syncText(identity.primary_email) ?? fallback.email ?? null,
    date_of_birth: syncText(identity.date_of_birth) ?? fallback.dateOfBirth ?? null,
    gender: syncText(identity.gender) ?? fallback.gender ?? null,
    blood_group: syncText(identity.blood_group),
  };
}

type PatientHealthLinkSyncInput = {
  tenantId: string;
  patientId: number;
  uhid: string | null;
  nationalId?: string | null;
  hospitalName?: string | null;
};

function buildPatientHealthLinkSyncEvent(input: PatientHealthLinkSyncInput) {
  if (!input.uhid) return null;
  return {
    tenantId: input.tenantId,
    entityType: 'patient_health_links',
    entityId: `${input.tenantId}:${input.patientId}:${input.uhid}`,
    operation: 'upsert' as const,
    payload: {
      tenant_id: input.tenantId,
      patient_id: input.patientId,
      uhid: input.uhid,
      national_id: input.nationalId ?? input.uhid,
      hospital_name: input.hospitalName ?? null,
    },
  };
}

async function buildPatientHealthLinkSyncStatement(
  env: Env,
  input: PatientHealthLinkSyncInput,
): Promise<D1PreparedStatement | null> {
  const event = buildPatientHealthLinkSyncEvent(input);
  return event ? buildLocalSyncOutboxStatement(env, event) : null;
}

async function recordPatientHealthLinkSyncEvent(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  input: PatientHealthLinkSyncInput,
): Promise<void> {
  const statement = await buildPatientHealthLinkSyncStatement(c.env, input);
  if (statement) await statement.run();
}

async function findPatientCreateDuplicateWarnings(
  db: D1Database,
  tenantId: string,
  data: {
    name?: string;
    mobile?: string | null;
    dateOfBirth?: string;
    gender?: string;
    email?: string;
    [key: string]: unknown;
  },
): Promise<Array<Record<string, unknown>>> {
  const warnings: Array<Record<string, unknown>> = [];
  const seenWarningKeys = new Set<string>();

  const pushWarning = (warning: Record<string, unknown>) => {
    const key = `${warning.scope}:${warning.patient_id ?? warning.identity_id ?? warning.uhid ?? warning.mobile ?? warning.phone}`;
    if (seenWarningKeys.has(key)) return;
    seenWarningKeys.add(key);
    warnings.push(warning);
  };

  // Only query the local mobile index when the receptionist actually
  // typed a number. When `mobile` is null, the duplicate warning is
  // driven entirely by the (name + DOB + gender) match below.
  const localMobileMatches = data.mobile
    ? await db.prepare(`
      SELECT id, patient_code, uhid, name, mobile, date_of_birth, gender
      FROM patients
      WHERE tenant_id = ? AND mobile = ?
      LIMIT 5
    `).bind(
      tenantId,
      data.mobile,
    ).all<Record<string, unknown>>()
    : { results: [] };

  const localNameDobMatches = data.dateOfBirth
    ? await db.prepare(`
      SELECT id, patient_code, uhid, name, mobile, date_of_birth, gender
      FROM patients
      WHERE tenant_id = ?
        AND LOWER(name) = LOWER(?)
        AND date_of_birth = ?
        AND (? IS NULL OR gender IS NULL OR gender = ?)
      LIMIT 5
    `).bind(
      tenantId,
      data.name,
      data.dateOfBirth,
      data.gender ?? null,
      data.gender ?? null,
    ).all<Record<string, unknown>>()
    : { results: [] };

  for (const row of [...(localMobileMatches.results ?? []), ...(localNameDobMatches.results ?? [])]) {
    const sameMobile = typeof row.mobile === 'string' && row.mobile === data.mobile;
    const sameNameDob =
      typeof row.name === 'string'
      && typeof data.name === 'string'
      && row.name.toLowerCase() === data.name.toLowerCase()
      && typeof row.date_of_birth === 'string'
      && row.date_of_birth === data.dateOfBirth
      && (!data.gender || !row.gender || row.gender === data.gender);

    if (!sameMobile && !sameNameDob) continue;

    pushWarning({
      scope: 'current_hospital',
      patient_id: row.id,
      patient_code: row.patient_code,
      uhid: row.uhid,
      name: row.name,
      mobile: row.mobile,
      date_of_birth: row.date_of_birth,
      gender: row.gender,
    });
  }

  const globalMatches = await db.prepare(`
    SELECT id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status
    FROM global_patient_identity
    WHERE (
      (? IS NOT NULL AND primary_phone = ?)
      OR (? IS NOT NULL AND primary_email = ?)
      OR (
        LOWER(primary_name) = LOWER(?)
        AND date_of_birth IS NOT NULL
        AND date_of_birth = ?
      )
    )
    LIMIT 5
  `).bind(
    data.mobile ?? null,
    data.mobile ?? null,
    data.email ?? null,
    data.email ?? null,
    data.name,
    data.dateOfBirth ?? '',
  ).all<Record<string, unknown>>();

  for (const row of globalMatches.results ?? []) {
    const samePhone = typeof row.primary_phone === 'string' && data.mobile && row.primary_phone === data.mobile;
    const sameEmail =
      !!data.email &&
      typeof row.primary_email === 'string' &&
      row.primary_email.toLowerCase() === data.email.toLowerCase();
    const sameNameDob =
      typeof row.primary_name === 'string'
      && typeof data.name === 'string'
      && row.primary_name.toLowerCase() === data.name.toLowerCase()
      && typeof row.date_of_birth === 'string'
      && row.date_of_birth === data.dateOfBirth;

    if (!samePhone && !sameEmail && !sameNameDob) continue;

    pushWarning({
      scope: 'global_identity',
      identity_id: row.id,
      uhid: row.uhid,
      name: row.primary_name,
      phone: row.primary_phone,
      email: row.primary_email,
      date_of_birth: row.date_of_birth,
      gender: row.gender,
      claim_status: row.claim_status,
    });
  }

  return warnings;
}

async function handleGlobalPatientSearch(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const tenantId = requireTenantId(c);
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 3) return c.json({ results: [] });
  const results = await queryLocalGlobalPatients(c.env.DB, tenantId, q);

  if (c.env.ENVIRONMENT === 'local_server' && shouldFetchCloudGlobalPatients(q, results)) {
    const cloudRows = await fetchCloudGlobalPatients(c, tenantId, q);
    if (cloudRows.length > 0) {
      await cacheCloudGlobalPatients(c.env.DB, cloudRows);
      const refreshed = await queryLocalGlobalPatients(c.env.DB, tenantId, q);
      return c.json({ results: refreshed });
    }
  }

  return c.json({ results });
}

function shouldFetchCloudGlobalPatients(q: string, localResults: Array<Record<string, unknown>>): boolean {
  const digits = q.replace(/\D/g, '');
  return localResults.length === 0 || digits.length >= 10;
}

async function queryLocalGlobalPatients(db: D1Database, tenantId: string, q: string) {
  const normalizedMobile = normalizeBangladeshMobile(q);
  const digits = q.replace(/\D/g, '');
  const e164Mobile = normalizedMobile ? `880${normalizedMobile.slice(1)}` : digits;
  const phoneLike = digits.length >= 6 ? `%${digits.slice(-10)}%` : `%${q}%`;
  const exactPhone1 = normalizedMobile ?? q;
  const exactPhone2 = e164Mobile || q;
  const exactPhone3 = e164Mobile ? `+${e164Mobile}` : q;

  const { results } = await db.prepare(`
    SELECT
      gpi.id,
      gpi.uhid,
      gpi.primary_name,
      gpi.primary_phone,
      gpi.primary_email,
      gpi.date_of_birth,
      gpi.gender,
      gpi.claim_status,
      phl.patient_id AS linked_patient_id
    FROM global_patient_identity gpi
    LEFT JOIN patient_health_links phl
      ON phl.uhid = gpi.uhid
      AND phl.tenant_id = ?
      AND COALESCE(phl.is_active, 1) = 1
    WHERE gpi.primary_phone IN (?, ?, ?)
       OR REPLACE(REPLACE(REPLACE(COALESCE(gpi.primary_phone, ''), '+', ''), '-', ''), ' ', '') LIKE ?
       OR gpi.primary_email LIKE ?
       OR gpi.uhid = ?
       OR LOWER(gpi.primary_name) LIKE LOWER(?)
    ORDER BY CASE WHEN gpi.primary_phone IN (?, ?, ?) THEN 0 WHEN gpi.primary_phone LIKE ? THEN 1 ELSE 2 END,
             gpi.updated_at DESC,
             gpi.id DESC
    LIMIT 10
  `).bind(
    tenantId,
    exactPhone1,
    exactPhone2,
    exactPhone3,
    phoneLike,
    `%${q}%`,
    q,
    `%${q}%`,
    exactPhone1,
    exactPhone2,
    exactPhone3,
    `${exactPhone1}%`,
  ).all();

  return (results ?? []) as Array<Record<string, unknown>>;
}

async function fetchCloudGlobalPatients(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  tenantId: string,
  q: string,
): Promise<Array<Record<string, unknown>>> {
  const cloudBaseUrl = c.env.CLOUD_SYNC_BASE_URL?.trim().replace(/\/+$/, '');
  const token = c.env.CLOUD_SYNC_TOKEN?.trim();
  if (!cloudBaseUrl || !token) return [];

  const response = await fetch(
    `${cloudBaseUrl}/api/sync/global-patient-lookup?tenantId=${encodeURIComponent(tenantId)}&q=${encodeURIComponent(q)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
  ).catch(() => null);
  if (!response?.ok) return [];

  const body = await response.json<{ results?: Array<Record<string, unknown>> }>().catch(() => null);
  return Array.isArray(body?.results) ? body.results : [];
}

async function cacheCloudGlobalPatients(db: D1Database, rows: Array<Record<string, unknown>>): Promise<void> {
  for (const row of rows) {
    const uhid = syncText(row.uhid);
    if (!uhid) continue;
    await db.prepare(`
      INSERT INTO global_patient_identity (
        uhid, national_id, primary_name, primary_phone, primary_email,
        date_of_birth, gender, blood_group, claim_status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'unclaimed'), datetime('now'))
      ON CONFLICT(uhid) DO UPDATE SET
        national_id = COALESCE(excluded.national_id, global_patient_identity.national_id),
        primary_name = COALESCE(excluded.primary_name, global_patient_identity.primary_name),
        primary_phone = COALESCE(excluded.primary_phone, global_patient_identity.primary_phone),
        primary_email = COALESCE(excluded.primary_email, global_patient_identity.primary_email),
        date_of_birth = COALESCE(excluded.date_of_birth, global_patient_identity.date_of_birth),
        gender = COALESCE(excluded.gender, global_patient_identity.gender),
        blood_group = COALESCE(excluded.blood_group, global_patient_identity.blood_group),
        claim_status = COALESCE(excluded.claim_status, global_patient_identity.claim_status),
        updated_at = datetime('now')
    `).bind(
      uhid,
      syncText(row.national_id),
      syncText(row.primary_name),
      syncText(row.primary_phone),
      syncText(row.primary_email),
      syncText(row.date_of_birth),
      syncText(row.gender),
      syncText(row.blood_group),
      syncText(row.claim_status),
    ).run();
  }
}

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
patientRoutes.get('/', async (c) => {
  const tenantId = requireTenantId(c);
  const search = (c.req.query('search') || '').trim();
  const rawLimit = c.req.query('perPage') || c.req.query('limit') || '50';
  const limit = Math.min(parseInt(rawLimit, 10), 200);
  const cursor = c.req.query('cursor');
  const pageParam = c.req.query('page');
  const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : null;

  try {
    const db = getDb(c.env.DB);

    // Build conditions
    const conditions = [eq(patients.tenantId, tenantId)];

    if (search) {
      const searchPattern = `%${search}%`;
      const normalizedMobile = normalizeBangladeshMobile(search);
      const digits = search.replace(/\D/g, '');
      const phoneTailPattern = digits.length >= 6 ? `%${digits.slice(-10)}%` : null;
      conditions.push(
        or(
          like(patients.name, searchPattern),
          like(patients.mobile, searchPattern),
          ...(normalizedMobile ? [like(patients.mobile, `%${normalizedMobile}%`)] : []),
          ...(phoneTailPattern ? [like(patients.mobile, phoneTailPattern)] : []),
          like(patients.patientCode, searchPattern),
          eq(sql`CAST(${patients.id} AS TEXT)`, search),
        )!,
      );
    }
    const normalizedPriorityMobile = search ? normalizeBangladeshMobile(search) : null;
    const mobilePriorityTerm = normalizedPriorityMobile ?? search;
    const mobileMatchPriority = search
      ? sql`CASE WHEN ${patients.mobile} = ${mobilePriorityTerm} THEN 0 WHEN ${patients.mobile} LIKE ${`${mobilePriorityTerm}%`} THEN 1 ELSE 2 END`
      : null;

    let items: typeof patients.$inferSelect[] = [];
    let hasMore = false;
    let nextCursor: string | null = null;
    let total: number | undefined;

    if (page !== null) {
      // ── Page-based pagination (used by PatientList UI) ──
      const offset = (page - 1) * limit;

      // Get total count
      const [countResult] = await db
        .select({ total: count() })
        .from(patients)
        .where(and(...conditions));
      total = countResult?.total ?? 0;

      // Fetch one extra row to determine hasMore / nextCursor
      const pageQuery = db
        .select()
        .from(patients)
        .where(and(...conditions));
      const results = mobileMatchPriority
        ? await pageQuery
          .orderBy(mobileMatchPriority, desc(patients.id))
          .limit(limit + 1)
          .offset(offset)
        : await pageQuery
          .orderBy(desc(patients.id))
          .limit(limit + 1)
          .offset(offset);

      hasMore = results.length > limit;
      items = hasMore ? results.slice(0, limit) : results;
      nextCursor = hasMore ? String(items[items.length - 1].id) : null;
    } else {
      // ── Cursor-based pagination (legacy, backward-compatible) ──
      if (cursor) {
        conditions.push(lt(patients.id, parseInt(cursor, 10)));
      }

      const cursorQuery = db
        .select()
        .from(patients)
        .where(and(...conditions));
      const results = mobileMatchPriority
        ? await cursorQuery
          .orderBy(mobileMatchPriority, desc(patients.id))
          .limit(limit + 1)
        : await cursorQuery
          .orderBy(desc(patients.id))
          .limit(limit + 1);

      hasMore = results.length > limit;
      items = hasMore ? results.slice(0, limit) : results;
      nextCursor = hasMore ? String(items[items.length - 1].id) : null;
    }

    const response: Record<string, unknown> = {
      patients: items.map((p) => ({
        id: p.id,
        patient_code: p.patientCode,
        uhid: p.uhid ?? null,
        name: p.name,
        father_husband: p.fatherHusband,
        address: p.address,
        mobile: p.mobile,
        guardian_mobile: p.guardianMobile ?? null,
        email: p.email ?? null,
        age: p.age ?? null,
        gender: p.gender ?? null,
        blood_group: p.bloodGroup ?? null,
        date_of_birth: p.dateOfBirth ?? null,
        tenant_id: Number(p.tenantId),
        created_at: p.createdAt,
      })),
      nextCursor,
      hasMore,
    };
    if (total !== undefined) response.total = total;

    return c.json(response);
  } catch (error) {
    console.error('patients fetch error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch patients' });
  }
});

// Keep literal routes before /:id; otherwise Hono treats "global-search" as an ID.
patientRoutes.get('/global-search', handleGlobalPatientSearch);

/**
 * GET /api/patients/:id/chart
 * Aggregated doctor workspace payload for one patient.
 */
patientRoutes.get('/:id/chart', async (c) => {
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

    // Replaced Promise.all() with c.env.DB.batch() for patient chart summary fetching.
    // Why: Promise.all() sends 25 separate HTTP network requests to Cloudflare D1.
    const batchResults = await c.env.DB.batch([
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
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT ProblemId as id, ICD10Code as icd10_code, Description as description, Severity as severity,
               Status as status, BegDate as onset_date, EndDate as end_date, Comments as comments,
               COALESCE(ModifiedAt, CreatedAt) as updated_at
        FROM CLN_ProblemList
        WHERE tenant_id = ? AND PatientId = ? AND Status != 'deleted'
        ORDER BY CASE Status WHEN 'active' THEN 0 ELSE 1 END, COALESCE(ModifiedAt, CreatedAt) DESC
        LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT DiagnosisId as id, ICD10Code as icd10_code, ICD10Description as description,
               DiagnosisType as diagnosis_type, Notes as notes, CreatedOn as created_at,
               review_status, reviewed_at, reviewed_by, review_notes
        FROM ClinicalDiagnosis
        WHERE tenant_id = ? AND PatientId = ? AND IsActive = 1
        ORDER BY CreatedOn DESC
        LIMIT 12
      `).bind(tenantId, patientId),
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
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, medication_name, generic_name, dosage, frequency, duration, instructions,
               start_date, end_date, status, status_reason, source, prescription_id,
               review_status, reviewed_at, reviewed_by, review_notes
        FROM patient_active_medications
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, COALESCE(start_date, created_at) DESC
        LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT v.id, v.visit_no, v.visit_type, v.created_at, v.discharge_date,
               v.icd10_code, v.icd10_description, v.notes, d.name as doctor_name
        FROM visits v
        LEFT JOIN doctors d ON v.doctor_id = d.id
        WHERE v.tenant_id = ? AND v.patient_id = ?
        ORDER BY v.created_at DESC
        LIMIT 12
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT con.id, con.scheduled_at, con.status, con.notes, con.prescription, con.chief_complaint,
               con.followup_date, d.name as doctor_name
        FROM consultations con
        LEFT JOIN doctors d ON con.doctor_id = d.id
        WHERE con.tenant_id = ? AND con.patient_id = ?
        ORDER BY con.scheduled_at DESC
        LIMIT 10
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT SOAPId, PatientId, EncounterId, ChiefComplaint, Subjective, Objective, Assessment, Plan, CreatedById, CreatedAt
        FROM FormSOAP
        WHERE tenant_id = ? AND PatientId = ?
        ORDER BY CreatedAt DESC
        LIMIT 8
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT p.id, p.rx_no, p.created_at, p.status, p.chief_complaint, p.diagnosis, p.advice,
               d.name as doctor_name,
               (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescription_id = p.id) AS item_count
        FROM prescriptions p
        LEFT JOIN doctors d ON p.doctor_id = d.id
        WHERE p.tenant_id = ? AND p.patient_id = ?
        ORDER BY p.created_at DESC
        LIMIT 12
      `).bind(tenantId, patientId),
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
      `).bind(tenantId, patientId),
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
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT rr.id, rr.imaging_date, rr.imaging_type_name, rr.imaging_item_name, rr.procedure_code,
               rr.urgency, rr.order_status, rr.requisition_remarks, rr.prescriber_name
        FROM radiology_requisitions rr
        WHERE rr.tenant_id = ? AND rr.patient_id = ? AND rr.is_active = 1
        ORDER BY COALESCE(rr.imaging_date, rr.created_at) DESC, rr.id DESC
        LIMIT 10
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT rr.id, rr.requisition_id, rr.created_at, rr.imaging_type_name, rr.imaging_item_name,
               rr.performer_name, rr.report_text, rr.indication, rr.radiology_number, rr.order_status
        FROM radiology_reports rr
        WHERE rr.tenant_id = ? AND rr.patient_id = ? AND rr.is_active = 1
        ORDER BY COALESCE(rr.updated_at, rr.created_at) DESC, rr.id DESC
        LIMIT 10
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT a.id, a.admission_no, a.admission_date, a.discharge_date, a.status,
               a.provisional_diagnosis, a.notes, b.ward_name, b.bed_number, d.name as doctor_name
        FROM admissions a
        LEFT JOIN beds b ON a.bed_id = b.id
        LEFT JOIN doctors d ON a.doctor_id = d.id
        WHERE a.tenant_id = ? AND a.patient_id = ?
        ORDER BY a.admission_date DESC
        LIMIT 8
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT ds.id, ds.admission_id, ds.final_diagnosis, ds.treatment_summary, ds.follow_up_date,
               ds.follow_up_instructions, ds.doctor_notes, ds.status, ds.updated_at, a.admission_no
        FROM discharge_summaries ds
        LEFT JOIN admissions a ON ds.admission_id = a.id AND a.tenant_id = ds.tenant_id
        WHERE ds.tenant_id = ? AND ds.patient_id = ?
        ORDER BY COALESCE(ds.updated_at, ds.created_at) DESC
        LIMIT 6
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, medical_record_id, document_type, title, description, file_name, created_at
        FROM document_records
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, referred_to, referred_date, referred_time, referred_reason, file_number, remarks, created_at
        FROM medical_records
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 AND discharge_type = 'referred'
        ORDER BY COALESCE(referred_date, created_at) DESC
        LIMIT 8
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, taken_at as recorded_at, temperature, pulse,
               blood_pressure_systolic as systolic, blood_pressure_diastolic as diastolic,
               respiratory_rate, spo2, weight, height, bmi, blood_sugar, notes
        FROM clinical_vitals
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY taken_at DESC
        LIMIT 12
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, vital_type, recorded_value, threshold_min, threshold_max, severity, status, acknowledged_at, created_at
        FROM vital_alerts
        WHERE tenant_id = ? AND patient_id = ? AND status IN ('active', 'acknowledged')
        ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC
        LIMIT 8
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT a.id, a.appt_date as appointment_date, a.appt_time as time_slot, a.status, d.name as doctor_name
        FROM appointments a
        LEFT JOIN doctors d ON a.doctor_id = d.id
        WHERE a.tenant_id = ? AND a.patient_id = ?
        ORDER BY a.appt_date DESC, a.appt_time DESC
        LIMIT 8
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, medication_name, generic_name, reaction, severity, onset_date, outcome_status, notes,
               source, review_status, reviewed_by, reviewed_at, review_notes, created_at, updated_at
        FROM global_patient_adverse_reactions
        WHERE uhid = (SELECT uhid FROM patients WHERE tenant_id = ? AND id = ?)
        ORDER BY created_at DESC
        LIMIT 6
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, logged_on, sleep_hours, exercise_minutes, mood, energy_level, symptom_score, symptoms,
               diet_notes, notes, source, review_status, reviewed_by, reviewed_at, review_notes, created_at, updated_at
        FROM global_patient_lifestyle_logs
        WHERE uhid = (SELECT uhid FROM patients WHERE tenant_id = ? AND id = ?)
        ORDER BY logged_on DESC, created_at DESC
        LIMIT 6
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, visit_id, note_type, title, content, chief_complaint, subjective, objective,
               assessment, plan, follow_up, is_signed, signed_by, signed_at, created_by, created_at
        FROM clinical_notes
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, visit_id, image_type, title, description, file_key, file_name, body_part, created_at
        FROM clinical_images
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 10
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, visit_id, encounter_type, status, start_time, end_time, provider_id,
               reason_for_visit, chief_complaint, disposition_code, disposition_note, created_at
        FROM encounters
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY start_time DESC
        LIMIT 10
      `).bind(tenantId, patientId),
    ]);

    const rawFamilyRiskOverview = await familyRiskPromise;

    const allergiesResult = batchResults[0];
    const problemsResult = batchResults[1];
    const diagnosisResult = batchResults[2];
    const finalDiagnosisResult = batchResults[3];
    const medicationsResult = batchResults[4];
    const visitsResult = batchResults[5];
    const consultationsResult = batchResults[6];
    const soapNotesResult = batchResults[7];
    const prescriptionsResult = batchResults[8];
    const labOrdersResult = batchResults[9];
    const labResultsResult = batchResults[10];
    const radiologyOrdersResult = batchResults[11];
    const radiologyReportsResult = batchResults[12];
    const admissionsResult = batchResults[13];
    const dischargeSummariesResult = batchResults[14];
    const documentRecordsResult = batchResults[15];
    const referralsResult = batchResults[16];
    const vitalsResult = batchResults[17];
    const vitalAlertsResult = batchResults[18];
    const appointmentsResult = batchResults[19];
    const adverseReactionsResult = batchResults[20];
    const lifestyleLogsResult = batchResults[21];
    const clinicalNotesResult = batchResults[22];
    const clinicalImagesResult = batchResults[23];
    const encountersResult = batchResults[24];

    const allergies = (allergiesResult.results ?? []) as PatientChartRow[];
    const problems = (problemsResult.results ?? []) as PatientChartRow[];
    const diagnosisRows = (diagnosisResult.results ?? []) as PatientChartRow[];
    const finalDiagnosisRows = (finalDiagnosisResult.results ?? []) as PatientChartRow[];
    const diagnoses = diagnosisRows.length > 0 ? diagnosisRows : finalDiagnosisRows;
    const medications = (medicationsResult.results ?? []) as PatientChartRow[];
    const visits = (visitsResult.results ?? []) as PatientChartRow[];
    const consultations = (consultationsResult.results ?? []) as PatientChartRow[];
    const soapNotes = (soapNotesResult.results ?? []) as PatientChartRow[];
    const prescriptions = (prescriptionsResult.results ?? []) as PatientChartRow[];
    const labOrders = (labOrdersResult.results ?? []) as PatientChartRow[];
    const labResults = (labResultsResult.results ?? []) as PatientChartRow[];
    const radiologyOrders = (radiologyOrdersResult.results ?? []) as PatientChartRow[];
    const radiologyReports = (radiologyReportsResult.results ?? []) as PatientChartRow[];
    const admissions = (admissionsResult.results ?? []) as PatientChartRow[];
    const dischargeSummaries = (dischargeSummariesResult.results ?? []) as PatientChartRow[];
    const documents = (documentRecordsResult.results ?? []) as PatientChartRow[];
    const referrals = (referralsResult.results ?? []) as PatientChartRow[];
    const vitals = (vitalsResult.results ?? []) as PatientChartRow[];
    const vitalAlerts = (vitalAlertsResult.results ?? []) as PatientChartRow[];
    const appointments = (appointmentsResult.results ?? []) as PatientChartRow[];
    const adverseReactions = (adverseReactionsResult.results ?? []) as PatientChartRow[];
    const lifestyleLogs = (lifestyleLogsResult.results ?? []) as PatientChartRow[];
    const clinicalNotes = (clinicalNotesResult.results ?? []) as PatientChartRow[];
    const clinicalImages = (clinicalImagesResult.results ?? []) as PatientChartRow[];
    const encountersList = (encountersResult.results ?? []) as PatientChartRow[];
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

/**
 * GET /api/patients/:id/chart/source/:sourceId
 * Full source payload for doctor source panel drill-down.
 */
patientRoutes.get('/:id/chart/source/:sourceId', async (c) => {
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

/**
 * POST /api/patients/:id/chart/soap
 * Create SOAP note from doctor workspace.
 */
patientRoutes.post('/:id/chart/soap', async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const body = await c.req.json<Record<string, unknown>>();
  const patientId = Number(id);

  if (Number.isNaN(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient id' });
  }

  const payload = {
    PatientId: patientId,
    EncounterId: body.encounterId ? Number(body.encounterId) : undefined,
    ChiefComplaint: typeof body.chiefComplaint === 'string' ? body.chiefComplaint : undefined,
    Subjective: typeof body.subjective === 'string' ? body.subjective : undefined,
    Objective: typeof body.objective === 'string' ? body.objective : undefined,
    Assessment: typeof body.assessment === 'string' ? body.assessment : undefined,
    Plan: typeof body.plan === 'string' ? body.plan : undefined,
  };

  const parsed = createSOAPSchema.safeParse(payload);
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid SOAP note payload' });
  }

  const db = getDb(c.env.DB);
  const patient = await db.$client.prepare(`
    SELECT id FROM patients WHERE id = ? AND tenant_id = ?
  `).bind(patientId, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  const result = await db.$client.prepare(`
    INSERT INTO FormSOAP (
      tenant_id, PatientId, EncounterId,
      ChiefComplaint, Subjective, Objective, Assessment, Plan,
      CreatedById
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId,
    parsed.data.PatientId,
    parsed.data.EncounterId ?? null,
    parsed.data.ChiefComplaint ?? null,
    parsed.data.Subjective ?? null,
    parsed.data.Objective ?? null,
    parsed.data.Assessment ?? null,
    parsed.data.Plan ?? null,
    userId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'SOAP note saved' }, 201);
});

/**
 * PUT /api/patients/:id/chart/soap/:soapId
 * Edit an existing SOAP note.
 */
patientRoutes.put('/:id/chart/soap/:soapId', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = Number(c.req.param('id'));
  const soapId = Number(c.req.param('soapId'));
  if (Number.isNaN(patientId) || Number.isNaN(soapId)) {
    throw new HTTPException(400, { message: 'Invalid IDs' });
  }

  const body = await c.req.json<Record<string, unknown>>();
  const payload = {
    PatientId: patientId,
    ChiefComplaint: typeof body.chiefComplaint === 'string' ? body.chiefComplaint : undefined,
    Subjective: typeof body.subjective === 'string' ? body.subjective : undefined,
    Objective: typeof body.objective === 'string' ? body.objective : undefined,
    Assessment: typeof body.assessment === 'string' ? body.assessment : undefined,
    Plan: typeof body.plan === 'string' ? body.plan : undefined,
  };

  const parsed = createSOAPSchema.safeParse(payload);
  if (!parsed.success) {
    throw new HTTPException(400, { message: 'Invalid SOAP note payload' });
  }

  const db = getDb(c.env.DB);
  const existing = await db.$client.prepare(
    'SELECT SOAPId FROM FormSOAP WHERE SOAPId = ? AND tenant_id = ? AND PatientId = ?'
  ).bind(soapId, tenantId, patientId).first();
  if (!existing) throw new HTTPException(404, { message: 'SOAP note not found' });

  await db.$client.prepare(`
    UPDATE FormSOAP SET ChiefComplaint = ?, Subjective = ?, Objective = ?, Assessment = ?, Plan = ?
    WHERE SOAPId = ? AND tenant_id = ?
  `).bind(
    parsed.data.ChiefComplaint ?? null,
    parsed.data.Subjective ?? null,
    parsed.data.Objective ?? null,
    parsed.data.Assessment ?? null,
    parsed.data.Plan ?? null,
    soapId, tenantId,
  ).run();

  return c.json({ message: 'SOAP note updated' });
});

// ─── SOAP Note Templates CRUD ─────────────────────────────────────────

/**
 * GET /api/patients/soap-templates
 * List all SOAP templates for the tenant.
 */
patientRoutes.get('/soap-templates', async (c) => {
  const tenantId = requireTenantId(c);
  const specialty = c.req.query('specialty');
  const db = getDb(c.env.DB);

  let query = 'SELECT * FROM soap_templates WHERE (tenant_id = ? OR is_global = 1)';
  const params: (string | number)[] = [tenantId];

  if (specialty) {
    query += ' AND specialty = ?';
    params.push(specialty);
  }
  query += ' ORDER BY name ASC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ templates: results });
});

/**
 * POST /api/patients/soap-templates
 * Create a SOAP template.
 */
patientRoutes.post('/soap-templates', zValidator('json', soapTemplateSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const db = getDb(c.env.DB);

  const result = await db.$client.prepare(`
    INSERT INTO soap_templates (tenant_id, name, name_bn, chief_complaint, subjective, objective, assessment, plan, specialty, is_global, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.name, data.name_bn ?? null, data.chief_complaint,
    data.subjective ?? null, data.objective ?? null, data.assessment ?? null, data.plan ?? null,
    data.specialty ?? null, data.is_global ?? 0, userId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Template created' }, 201);
});

/**
 * PUT /api/patients/soap-templates/:templateId
 * Update a SOAP template.
 */
patientRoutes.put('/soap-templates/:templateId', zValidator('json', updateSoapTemplateSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const templateId = Number(c.req.param('templateId'));
  if (Number.isNaN(templateId)) throw new HTTPException(400, { message: 'Invalid template ID' });

  const data = c.req.valid('json');
  const db = getDb(c.env.DB);

  const existing = await db.$client.prepare(
    'SELECT id FROM soap_templates WHERE id = ? AND tenant_id = ?'
  ).bind(templateId, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Template not found' });

  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (key === 'is_global' || key === 'name' || key === 'name_bn' || key === 'chief_complaint' || key === 'subjective' || key === 'objective' || key === 'assessment' || key === 'plan' || key === 'specialty') {
      sets.push(`${key} = ?`);
      vals.push(val ?? null);
    }
  }
  if (sets.length === 0) return c.json({ message: 'No fields to update' });

  sets.push("updated_at = datetime('now')");
  vals.push(templateId, tenantId);

  await db.$client.prepare(
    `UPDATE soap_templates SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...vals).run();

  return c.json({ message: 'Template updated' });
});

/**
 * DELETE /api/patients/soap-templates/:templateId
 * Delete a SOAP template.
 */
patientRoutes.delete('/soap-templates/:templateId', async (c) => {
  const tenantId = requireTenantId(c);
  const templateId = Number(c.req.param('templateId'));
  if (Number.isNaN(templateId)) throw new HTTPException(400, { message: 'Invalid template ID' });

  const db = getDb(c.env.DB);
  const existing = await db.$client.prepare(
    'SELECT id FROM soap_templates WHERE id = ? AND tenant_id = ?'
  ).bind(templateId, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Template not found' });

  await db.$client.prepare(
    'DELETE FROM soap_templates WHERE id = ? AND tenant_id = ?'
  ).bind(templateId, tenantId).run();

  return c.json({ message: 'Template deleted' });
});

patientRoutes.post('/:id/chart/lab-order', zValidator('json', quickLabOrderSchema), async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = Number(id);
  const data = c.req.valid('json');

  if (Number.isNaN(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient id' });
  }

  const db = getDb(c.env.DB);
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Patient chart lab order billing');
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  const activeVisit = await c.env.DB.prepare(
    'SELECT id, doctor_id FROM visits WHERE tenant_id = ? AND patient_id = ? AND visit_date = ? ORDER BY created_at DESC LIMIT 1',
  ).bind(tenantId, patientId, today).first<{ id: number; doctor_id: number | null }>();
  const visitId = activeVisit?.id ?? null;
  const orderedAtUtc = new Date(`${today}T00:00:00+06:00`).toISOString();
  const preparationInput: PatientChartLabBillingPreparationInput = {
    tenantId: String(tenantId),
    userId: Number(userId),
    patientId,
    visitId,
    orderingClinicianDoctorId: activeVisit?.doctor_id ?? null,
    orderDate: today,
    orderedAtUtc,
    notes: data.notes ?? null,
    requestItems: data.tests.map((test) => ({
      labTestId: test.lab_test_id,
      instructions: test.instructions ?? null,
    })),
    dependencies: {
      nextOrderNo: () => getNextSequence(c.env.DB, tenantId, 'lab_order', 'LAB'),
      nextInvoiceNo: () => getNextInvoiceNumber(c.env.DB, tenantId, 'diagnostic'),
      resolveLabTest: (labTestId) => resolveLabTestBillingRow(c.env.DB, tenantId, labTestId),
    },
  };

  const preparedContextRef: { current: PatientChartLabBillingContext | null } = { current: null };
  let financialExecution: Awaited<ReturnType<typeof executeStrictFinancialMutation>>;
  try {
    financialExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'patient-chart.lab-billing.create',
      legacyExecutor: async () => {
        const legacy = await executePatientChartLabOrderOriginalLegacy(c.env.DB, preparationInput);
        preparedContextRef.current = legacy.context;
        return legacy.results;
      },
      strictAuthoritativeStatements: async () => {
        preparedContextRef.current = await preparePatientChartLabOrderStrictContext(preparationInput);
        return preparePatientChartLabOrderStrictStatements(c.env.DB, preparedContextRef.current);
      },
      canonical: async (execution) => {
        const context = preparedContextRef.current;
        if (!context) throw new Error('Patient-chart lab billing context is unavailable');
        const canonicalItems = context.items.map((item) => {
          if (!item.billingServiceItemId) {
            throw new Error(`Canonical billing service mapping is unavailable for lab test ${item.labTestId}`);
          }
          return {
            lineNumber: item.lineNumber,
            duplicateOrdinal: item.duplicateOrdinal,
            labTestId: item.labTestId,
            billingServiceItemId: item.billingServiceItemId,
            name: item.name,
            category: item.category,
            grossMinor: Number(toMinorUnits(item.price)),
            discountMinor: 0,
          };
        });
        return createLabOrderBilling(c.env.DB, {
          tenantId: String(tenantId),
          commandIdempotencyKey: `patient-chart-lab-billing:${context.orderNo}:${context.invoiceNo}`,
          orderNo: context.orderNo,
          invoiceNo: context.invoiceNo,
          legacyPatientId: patientId,
          legacyVisitId: context.visitId,
          orderingClinicianDoctorId: context.orderingClinicianDoctorId,
          orderedAtUtc: context.orderedAtUtc,
          businessDate: context.orderDate,
          items: canonicalItems,
        }, { authoritativeStatements: execution.authoritativeStatements });
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^Lab test \d+ not found$/.test(message)) {
      throw new HTTPException(400, { message });
    }
    if (isFinancialBatchAssertionError(error) || isPatientChartDiagnosticCanonicalConflict(error)) {
      throw new HTTPException(409, {
        message: 'Lab billing changed concurrently or canonical authority is unavailable. Refresh and try again.',
      });
    }
    throw error;
  }

  const context = preparedContextRef.current;
  if (!context) throw new Error('Committed patient-chart lab billing context is unavailable');

  const orderRow = await db.$client.prepare(
    'SELECT id FROM lab_orders WHERE tenant_id = ? AND order_no = ? ORDER BY id DESC LIMIT 1',
  ).bind(tenantId, context.orderNo).first<{ id: number }>();
  const billRow = await db.$client.prepare(
    'SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? ORDER BY id DESC LIMIT 1',
  ).bind(tenantId, context.invoiceNo).first<{ id: number }>();
  const labOrderId = Number(orderRow?.id ?? 0);
  const billId = Number(billRow?.id ?? 0);
  if (!(labOrderId > 0) || !(billId > 0)) {
    throw new Error('Committed patient-chart lab order or bill could not be resolved');
  }

  const actualItemRows = (await db.$client.prepare(`
    SELECT loi.id AS lab_order_item_id, loi.lab_test_id, ii.id AS invoice_item_id
    FROM lab_order_items loi
    JOIN invoice_items ii
      ON ii.bill_id = ? AND ii.reference_id = loi.id AND ii.tenant_id = ?
    WHERE loi.lab_order_id = ? AND loi.tenant_id = ?
    ORDER BY loi.id
  `).bind(billId, tenantId, labOrderId, tenantId).all<{
    lab_order_item_id: number;
    lab_test_id: number;
    invoice_item_id: number;
  }>()).results ?? [];
  if (actualItemRows.length !== context.items.length) {
    throw new Error('Committed patient-chart lab item identities could not be resolved');
  }

  const billItems = context.items.map((item, index) => ({
    orderItemId: Number(actualItemRows[index]?.lab_order_item_id ?? 0),
    invoiceItemId: Number(actualItemRows[index]?.invoice_item_id ?? 0),
    name: item.name,
    price: item.price,
    labTestId: item.labTestId,
    category: item.category,
  }));
  const total = context.total;
  const categoryTotals = context.categoryTotals;

  if (total > 0) {
    await recordBillFinalizationSideEffects(c.env.DB, {
      tenantId,
      userId,
      patientId,
      visitId,
      billId,
      invoiceNo: context.invoiceNo,
      billDate: today,
      subtotal: total,
      discount: 0,
      total,
      categoryTotals,
      extraPayload: { labOrderId },
      skipBillAccountingEvent: financialExecution.mode === 'strict',
      items: billItems.map((item) => ({
        itemCategory: 'test',
        description: item.name,
        lineTotal: item.price,
        referenceId: item.orderItemId,
      })),
    });
    queuePatientChartAccountingPosting(c, tenantId);
  }

  await accrueLabOrderDoctorCommissions(c.env.DB, {
    tenantId,
    userId,
    patientId,
    visitId,
    billId,
    labOrderId,
    orderDate: today,
    items: billItems.map((item) => ({
      labOrderItemId: item.orderItemId,
      labTestId: item.labTestId,
      category: item.category,
      lineTotal: item.price,
    })),
  });

  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'lab_orders', labOrderId, null, {
    action: 'patient_chart_lab_order',
    orderNo: context.orderNo,
    billId,
    invoiceNo: context.invoiceNo,
    total,
  });

  return c.json({
    id: labOrderId,
    orderNo: context.orderNo,
    billId,
    invoiceNo: context.invoiceNo,
    total,
    billingStatus: total <= 0 ? 'paid' : 'unpaid',
    message: 'Lab order created',
  }, 201);
});

patientRoutes.post('/:id/chart/radiology-order', zValidator('json', quickRadiologyOrderSchema), async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = Number(id);
  const data = c.req.valid('json');

  if (Number.isNaN(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient id' });
  }

  const db = getDb(c.env.DB);
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Patient chart radiology order billing');
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  const preparationInput: PatientChartRadiologyBillingPreparationInput = {
    tenantId: String(tenantId),
    userId: Number(userId),
    patientId,
    orderDate: today,
    requestedAtUtc: new Date(`${today}T00:00:00+06:00`).toISOString(),
    submittedImagingTypeName: data.imaging_type_name,
    submittedImagingItemName: data.imaging_item_name,
    urgency: data.urgency,
    requisitionRemarks: data.requisition_remarks ?? null,
    dependencies: {
      async resolveImagingItemByName(name) {
        const itemRecord = await db.$client.prepare(`
          SELECT id
          FROM radiology_imaging_items
          WHERE tenant_id = ? AND is_active = 1 AND LOWER(name) = LOWER(?)
          LIMIT 1
        `).bind(tenantId, name).first<{ id: number }>();
        return itemRecord
          ? resolveRadiologyBillingRow(c.env.DB, tenantId, itemRecord.id)
          : null;
      },
      nextAccessionNo: () => getNextSequence(c.env.DB, tenantId, 'radiology_accession', 'RADACC'),
      nextInvoiceNo: () => getNextInvoiceNumber(c.env.DB, tenantId, 'diagnostic'),
    },
  };

  const preparedContextRef: { current: PatientChartRadiologyBillingContext | null } = { current: null };
  let financialExecution: Awaited<ReturnType<typeof executeStrictFinancialMutation>>;
  try {
    financialExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'patient-chart.radiology-billing.create',
      legacyExecutor: async () => {
        const legacy = await executePatientChartRadiologyOriginalLegacy(c.env.DB, preparationInput);
        preparedContextRef.current = legacy.context;
        return legacy.results;
      },
      strictAuthoritativeStatements: async () => {
        preparedContextRef.current = await preparePatientChartRadiologyStrictContext(preparationInput);
        return preparePatientChartRadiologyStrictStatements(c.env.DB, preparedContextRef.current);
      },
      canonical: async (execution) => {
        const context = preparedContextRef.current;
        const item = context?.imagingItem;
        if (!context || !item?.billingServiceItemId) {
          throw new Error('Patient-chart radiology billing context or canonical service mapping is unavailable');
        }
        return createRadiologyRequisitionBilling(c.env.DB, {
          tenantId: String(tenantId),
          commandIdempotencyKey: `patient-chart-radiology-billing:${context.accessionNo}:${context.invoiceNo}`,
          accessionNo: context.accessionNo,
          invoiceNo: context.invoiceNo,
          legacyPatientId: patientId,
          imagingItemId: item.id,
          billingServiceItemId: item.billingServiceItemId,
          displayName: context.imagingItemName,
          totalMinor: item.pricePaisa,
          requestedAtUtc: context.requestedAtUtc,
          businessDate: context.orderDate,
        }, { authoritativeStatements: execution.authoritativeStatements });
      },
    });
  } catch (error) {
    if (isFinancialBatchAssertionError(error) || isPatientChartDiagnosticCanonicalConflict(error)) {
      throw new HTTPException(409, {
        message: 'Radiology billing changed concurrently or canonical authority is unavailable. Refresh and try again.',
      });
    }
    throw error;
  }

  const context = preparedContextRef.current;
  if (!context) throw new Error('Committed patient-chart radiology billing context is unavailable');

  const requisitionRow = await db.$client.prepare(
    'SELECT id FROM radiology_requisitions WHERE tenant_id = ? AND accession_no = ? ORDER BY id DESC LIMIT 1',
  ).bind(tenantId, context.accessionNo).first<{ id: number }>();
  const billRow = await db.$client.prepare(
    'SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? ORDER BY id DESC LIMIT 1',
  ).bind(tenantId, context.invoiceNo).first<{ id: number }>();
  const requisitionId = Number(requisitionRow?.id ?? 0);
  const billId = Number(billRow?.id ?? 0);
  if (!(requisitionId > 0) || !(billId > 0)) {
    throw new Error('Committed patient-chart radiology requisition or bill could not be resolved');
  }

  const total = context.total;
  if (total > 0) {
    await recordBillFinalizationSideEffects(c.env.DB, {
      tenantId,
      userId,
      patientId,
      visitId: null,
      billId,
      invoiceNo: context.invoiceNo,
      billDate: today,
      subtotal: total,
      discount: 0,
      total,
      categoryTotals: context.categoryTotals,
      extraPayload: { requisitionId },
      skipBillAccountingEvent: financialExecution.mode === 'strict',
      items: [{
        itemCategory: 'test',
        description: context.imagingItemName,
        lineTotal: total,
        referenceId: requisitionId,
        ...(financialExecution.mode === 'strict' && context.imagingItem?.billingServiceItemId
          ? {
              canonicalSourceLineId: buildLegacyLiveInvoiceSourceLineId({
                lineNumber: 1,
                itemCategory: 'test',
                referenceId: context.imagingItem.billingServiceItemId,
              }),
            }
          : {}),
      }],
    });
    queuePatientChartAccountingPosting(c, tenantId);
  }

  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'radiology_requisitions', requisitionId, null, {
    action: 'patient_chart_radiology_order',
    accessionNo: context.accessionNo,
    billId,
    invoiceNo: context.invoiceNo,
    total,
  });

  return c.json({
    id: requisitionId,
    accessionNo: context.accessionNo,
    billId,
    invoiceNo: context.invoiceNo,
    total,
    billingStatus: total <= 0 ? 'paid' : 'unpaid',
    message: 'Radiology order created',
  }, 201);
});

patientRoutes.post('/:id/chart/follow-up', zValidator('json', quickFollowUpSchema), async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = Number(id);
  const data = c.req.valid('json');

  if (Number.isNaN(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient id' });
  }

  const db = getDb(c.env.DB);
  const patient = await db.$client.prepare('SELECT id FROM patients WHERE id = ? AND tenant_id = ?').bind(patientId, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  const tokenRow = await db.$client.prepare(`
    SELECT COALESCE(MAX(token_no), 0) + 1 AS next_token
    FROM appointments
    WHERE tenant_id = ? AND appt_date = ?
  `).bind(tenantId, data.apptDate).first<{ next_token: number }>();
  const tokenNo = tokenRow?.next_token ?? 1;
  const apptNo = await getNextSequence(c.env.DB, tenantId, 'appointment', 'APT');

  const result = await db.$client.prepare(`
    INSERT INTO appointments
      (appt_no, token_no, patient_id, appt_date, appt_time, visit_type, status, notes, fee, billing_status, created_by, tenant_id)
    VALUES (?, ?, ?, ?, ?, 'followup', 'scheduled', ?, 0, 'no_charge', ?, ?)
  `).bind(apptNo, tokenNo, patientId, data.apptDate, data.apptTime ?? null, data.notes ?? null, userId, tenantId).run();

  return c.json({ id: result.meta.last_row_id, apptNo, tokenNo, message: 'Follow-up appointment created' }, 201);
});

/**
 * GET /api/patients/:id/timeline
 * Real clinical timeline without demo fallback data.
 */
patientRoutes.get('/:id/timeline', async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);

  try {
    const db = getDb(c.env.DB);
    const patientId = Number(id);
    if (Number.isNaN(patientId) || patientId <= 0) {
      throw new HTTPException(400, { message: 'Invalid patient id' });
    }

    // Replaced Promise.all() with c.env.DB.batch() for patient timeline fetching.
    // Why: Promise.all() sends 13 separate HTTP network requests to Cloudflare D1.
    const batchResults = await c.env.DB.batch([
      db.$client.prepare(`SELECT name FROM patients WHERE id = ? AND tenant_id = ?`).bind(patientId, tenantId),
      db.$client.prepare(`
        SELECT v.id, v.visit_no, v.visit_type, v.created_at, v.notes, v.icd10_description, d.name as doctor_name
        FROM visits v
        LEFT JOIN doctors d ON v.doctor_id = d.id
        WHERE v.tenant_id = ? AND v.patient_id = ?
        ORDER BY v.created_at DESC
        LIMIT 30
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT con.id, con.scheduled_at, con.status, con.notes, con.prescription, con.chief_complaint, d.name as doctor_name
        FROM consultations con
        LEFT JOIN doctors d ON con.doctor_id = d.id
        WHERE con.tenant_id = ? AND con.patient_id = ?
        ORDER BY con.scheduled_at DESC
        LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT SOAPId, ChiefComplaint, Subjective, Objective, Assessment, Plan, CreatedAt
        FROM FormSOAP
        WHERE tenant_id = ? AND PatientId = ?
        ORDER BY CreatedAt DESC
        LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT p.id, p.rx_no, p.created_at, p.status, p.diagnosis, p.chief_complaint, d.name as doctor_name
        FROM prescriptions p
        LEFT JOIN doctors d ON p.doctor_id = d.id
        WHERE p.tenant_id = ? AND p.patient_id = ?
        ORDER BY p.created_at DESC
        LIMIT 30
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT lo.id, lo.order_no, lo.order_date,
               COUNT(loi.id) as total_items,
               SUM(CASE WHEN loi.status = 'pending' THEN 1 ELSE 0 END) as pending_items
        FROM lab_orders lo
        LEFT JOIN lab_order_items loi ON lo.id = loi.lab_order_id
        WHERE lo.tenant_id = ? AND lo.patient_id = ?
        GROUP BY lo.id
        ORDER BY lo.created_at DESC
        LIMIT 30
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, imaging_date, imaging_type_name, imaging_item_name, order_status, requisition_remarks, prescriber_name
        FROM radiology_requisitions
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY COALESCE(imaging_date, created_at) DESC, id DESC
        LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, imaging_type_name, imaging_item_name, performer_name, report_text, order_status, created_at
        FROM radiology_reports
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
        LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT a.id, a.admission_no, a.admission_date, a.status, a.provisional_diagnosis, d.name as doctor_name
        FROM admissions a
        LEFT JOIN doctors d ON a.doctor_id = d.id
        WHERE a.tenant_id = ? AND a.patient_id = ?
        ORDER BY a.admission_date DESC
        LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT ds.id, ds.updated_at, ds.status, ds.final_diagnosis, a.admission_no
        FROM discharge_summaries ds
        LEFT JOIN admissions a ON ds.admission_id = a.id AND a.tenant_id = ds.tenant_id
        WHERE ds.tenant_id = ? AND ds.patient_id = ?
        ORDER BY COALESCE(ds.updated_at, ds.created_at) DESC
        LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, title, description, document_type, created_at
        FROM document_records
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT id, referred_to, referred_date, referred_reason, created_at
        FROM medical_records
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1 AND discharge_type = 'referred'
        ORDER BY COALESCE(referred_date, created_at) DESC
        LIMIT 20
      `).bind(tenantId, patientId),
      db.$client.prepare(`
        SELECT a.id, a.appt_date as appointment_date, a.appt_time as time_slot, a.status, d.name as doctor_name
        FROM appointments a
        LEFT JOIN doctors d ON a.doctor_id = d.id
        WHERE a.tenant_id = ? AND a.patient_id = ?
        ORDER BY a.appt_date DESC, a.appt_time DESC
        LIMIT 20
      `).bind(tenantId, patientId),
    ]);

    const patient = batchResults[0]?.results?.[0] as PatientChartRow | undefined;
    const visitsResult = batchResults[1];
    const consultationsResult = batchResults[2];
    const soapNotesResult = batchResults[3];
    const prescriptionsResult = batchResults[4];
    const labOrdersResult = batchResults[5];
    const radiologyOrdersResult = batchResults[6];
    const radiologyReportsResult = batchResults[7];
    const admissionsResult = batchResults[8];
    const dischargeSummariesResult = batchResults[9];
    const documentsResult = batchResults[10];
    const referralsResult = batchResults[11];
    const appointmentsResult = batchResults[12];

    if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

    const events = [
      ...((visitsResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'visit',
        title: `${String(item.visit_type ?? 'visit').toUpperCase()} visit ${item.visit_no ? `· ${item.visit_no}` : ''}`.trim(),
        description: String(item.icd10_description ?? item.notes ?? 'Clinical visit'),
        date: String(item.created_at ?? new Date().toISOString()),
        doctor: String(item.doctor_name ?? ''),
        status: 'completed',
      })),
      ...((consultationsResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'consultation',
        title: `Consultation${item.doctor_name ? ` · ${item.doctor_name}` : ''}`,
        description: String(item.chief_complaint ?? item.notes ?? item.prescription ?? 'Consultation note'),
        date: String(item.scheduled_at ?? new Date().toISOString()),
        doctor: String(item.doctor_name ?? ''),
        status: String(item.status ?? 'scheduled'),
      })),
      ...((soapNotesResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.SOAPId),
        type: 'soap',
        title: `SOAP Note${item.ChiefComplaint ? ` · ${item.ChiefComplaint}` : ''}`,
        description: String(item.Assessment ?? item.Subjective ?? 'SOAP note'),
        date: String(item.CreatedAt ?? new Date().toISOString()),
        status: 'completed',
        details: {
          ...(item.Objective ? { objective: String(item.Objective).slice(0, 120) } : {}),
          ...(item.Plan ? { plan: String(item.Plan).slice(0, 120) } : {}),
        },
      })),
      ...((prescriptionsResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'prescription',
        title: `Prescription ${item.rx_no}`,
        description: String(item.diagnosis ?? item.chief_complaint ?? 'Prescription updated'),
        date: String(item.created_at ?? new Date().toISOString()),
        doctor: String(item.doctor_name ?? ''),
        status: String(item.status ?? 'draft'),
      })),
      ...((labOrdersResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'lab',
        title: `Lab Order ${item.order_no}`,
        description: `${Number(item.total_items ?? 0)} test(s), ${Number(item.pending_items ?? 0)} pending`,
        date: String(item.order_date ?? new Date().toISOString()),
        status: Number(item.pending_items ?? 0) > 0 ? 'pending' : 'completed',
        details: {
          total_tests: String(item.total_items ?? 0),
          pending_tests: String(item.pending_items ?? 0),
        },
      })),
      ...((radiologyOrdersResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'radiology_order',
        title: `Radiology Order · ${String(item.imaging_item_name ?? item.imaging_type_name ?? 'Imaging')}`,
        description: String(item.requisition_remarks ?? 'Radiology requisition'),
        date: String(item.imaging_date ?? new Date().toISOString()),
        doctor: String(item.prescriber_name ?? ''),
        status: String(item.order_status ?? 'pending'),
      })),
      ...((radiologyReportsResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'radiology_report',
        title: `Radiology Report · ${String(item.imaging_item_name ?? item.imaging_type_name ?? 'Imaging')}`,
        description: String(item.report_text ?? 'Radiology findings available'),
        date: String(item.created_at ?? new Date().toISOString()),
        doctor: String(item.performer_name ?? ''),
        status: String(item.order_status ?? 'pending'),
      })),
      ...((admissionsResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'admission',
        title: `Admission ${item.admission_no}`,
        description: String(item.provisional_diagnosis ?? 'Hospital admission'),
        date: String(item.admission_date ?? new Date().toISOString()),
        doctor: String(item.doctor_name ?? ''),
        status: String(item.status ?? 'admitted'),
      })),
      ...((dischargeSummariesResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'discharge',
        title: `Discharge Summary${item.admission_no ? ` · ${item.admission_no}` : ''}`,
        description: String(item.final_diagnosis ?? 'Discharge summary updated'),
        date: String(item.updated_at ?? new Date().toISOString()),
        status: String(item.status ?? 'draft'),
      })),
      ...((documentsResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'visit',
        title: String(item.title ?? 'Clinical document'),
        description: String(item.description ?? item.document_type ?? 'Document attached'),
        date: String(item.created_at ?? new Date().toISOString()),
        status: String(item.document_type ?? 'document'),
      })),
      ...((referralsResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'visit',
        title: `Referral${item.referred_to ? ` · ${item.referred_to}` : ''}`,
        description: String(item.referred_reason ?? 'Referral recorded'),
        date: String(item.referred_date ?? item.created_at ?? new Date().toISOString()),
        status: 'referred',
      })),
      ...((appointmentsResult.results ?? []) as PatientChartRow[]).map((item) => ({
        id: Number(item.id),
        type: 'appointment',
        title: `Appointment${item.doctor_name ? ` with ${item.doctor_name}` : ''}`,
        description: String(item.time_slot ?? 'Scheduled appointment'),
        date: String(item.appointment_date ?? new Date().toISOString()),
        doctor: String(item.doctor_name ?? ''),
        status: String(item.status ?? 'scheduled'),
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return c.json({ patient_name: patient.name, events });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('patient timeline fetch error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch patient timeline' });
  }
});

patientRoutes.post('/:id/chart/encounter-close', zValidator('json', quickEncounterCloseSchema), async (c) => {
  const id = c.req.param('id');
  const patientId = Number(id);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const db = getDb(c.env.DB);
  const payload = c.req.valid('json');

  if (!['doctor', 'md', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Only doctors can close encounters from chart workspace' });
  }

  if (!Number.isFinite(patientId) || patientId <= 0) {
    throw new HTTPException(400, { message: 'Invalid patient id' });
  }

  try {
    const consultation = payload.consultation_id
      ? await db.$client.prepare(`
          SELECT id, status, notes, prescription, followup_date
          FROM consultations
          WHERE id = ? AND tenant_id = ? AND patient_id = ? AND status IN ('scheduled', 'in_progress')
        `).bind(payload.consultation_id, tenantId, patientId).first<Record<string, unknown>>()
      : await db.$client.prepare(`
          SELECT id, status, notes, prescription, followup_date
          FROM consultations
          WHERE tenant_id = ? AND patient_id = ? AND status IN ('scheduled', 'in_progress')
          ORDER BY scheduled_at DESC
          LIMIT 1
        `).bind(tenantId, patientId).first<Record<string, unknown>>();

    if (!consultation) {
      throw new HTTPException(404, { message: 'No active consultation found to close' });
    }

    const noteParts = [
      payload.summary?.trim() ? payload.summary.trim() : null,
      payload.diagnosis?.trim() ? `Diagnosis: ${payload.diagnosis.trim()}` : null,
      payload.medication_reconciliation_done
        ? `Medication reconciliation completed.${payload.reconciliation_summary?.trim() ? ` ${payload.reconciliation_summary.trim()}` : ''}`
        : (payload.reconciliation_summary?.trim() ? `Medication reconciliation pending: ${payload.reconciliation_summary.trim()}` : null),
    ].filter(Boolean);
    const mergedNotes = noteParts.length > 0
      ? [String(consultation.notes ?? '').trim(), ...noteParts].filter(Boolean).join('\n\n')
      : String(consultation.notes ?? '').trim() || null;
    const nextPrescription = payload.prescription?.trim() ? payload.prescription.trim() : consultation.prescription ?? null;
    const nextFollowUp = payload.followup_date?.trim() ? payload.followup_date.trim() : consultation.followup_date ?? null;

    await db.$client.prepare(`
      UPDATE consultations
      SET status = 'completed',
          notes = ?,
          prescription = ?,
          followup_date = ?,
          updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `).bind(
      mergedNotes,
      nextPrescription,
      nextFollowUp,
      consultation.id,
      tenantId,
    ).run();

    await createAuditLog(
      c.env,
      String(tenantId),
      String(userId),
      'UPDATE',
      'consultations',
      Number(consultation.id),
      { status: consultation.status, followup_date: consultation.followup_date, prescription: consultation.prescription },
      {
        status: 'completed',
        followup_date: nextFollowUp,
        prescription: nextPrescription,
        patientId,
        mode: 'chart-encounter-close',
        medication_reconciliation_done: Boolean(payload.medication_reconciliation_done),
        reconciliation_summary: payload.reconciliation_summary ?? null,
      },
    );

    let followUpAppointmentId: number | null = null;
    const shouldBookFollowUp = Boolean(payload.book_followup && nextFollowUp);

    if (shouldBookFollowUp) {
      const existingScheduled = await db.$client.prepare(`
        SELECT id
        FROM appointments
        WHERE tenant_id = ? AND patient_id = ? AND appt_date = ? AND status = 'scheduled'
        LIMIT 1
      `).bind(tenantId, patientId, nextFollowUp).first<Record<string, unknown>>();

      if (!existingScheduled) {
        const tokenRow = await db.$client.prepare(`
          SELECT COALESCE(MAX(token_no), 0) + 1 AS next_token
          FROM appointments
          WHERE tenant_id = ? AND appt_date = ?
        `).bind(tenantId, nextFollowUp).first<{ next_token?: number }>();

        const apptNo = await getNextSequence(c.env.DB, tenantId, 'appointment', 'APT');
        const followUpResult = await db.$client.prepare(`
          INSERT INTO appointments
            (appt_no, token_no, patient_id, appt_date, appt_time, visit_type, status, notes, fee, billing_status, created_by, tenant_id)
          VALUES (?, ?, ?, ?, ?, 'followup', 'scheduled', ?, 0, 'no_charge', ?, ?)
        `).bind(
          apptNo,
          tokenRow?.next_token ?? 1,
          patientId,
          nextFollowUp,
          payload.followup_time ?? null,
          payload.followup_notes ?? payload.summary ?? null,
          userId,
          tenantId,
        ).run();

        followUpAppointmentId = Number(followUpResult.meta.last_row_id ?? 0) || null;

        if (followUpAppointmentId) {
          await createAuditLog(
            c.env,
            String(tenantId),
            String(userId),
            'CREATE',
            'appointments',
            followUpAppointmentId,
            null,
            { patientId, apptNo, apptDate: nextFollowUp, apptTime: payload.followup_time ?? null, mode: 'chart-wrap-up-follow-up' },
          );
        }
      } else {
        followUpAppointmentId = Number(existingScheduled.id ?? 0) || null;
      }
    }

    return c.json({
      message: 'Encounter closed',
      consultationId: Number(consultation.id),
      status: 'completed',
      followUpAppointmentId,
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('chart encounter close failed:', error);
    throw new HTTPException(500, { message: 'Failed to close encounter' });
  }
});

patientRoutes.put('/:id/chart/alerts/:alertId/acknowledge', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const patientId = Number(c.req.param('id'));
  const alertId = Number(c.req.param('alertId'));
  const db = getDb(c.env.DB);

  if (!['doctor', 'md', 'nurse', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to acknowledge alerts' });
  }

  if (!Number.isFinite(patientId) || !Number.isFinite(alertId) || patientId <= 0 || alertId <= 0) {
    throw new HTTPException(400, { message: 'Invalid chart alert request' });
  }

  try {
    const existing = await db.$client.prepare(`
      SELECT id, status
      FROM vital_alerts
      WHERE id = ? AND tenant_id = ? AND patient_id = ? AND status = 'active'
    `).bind(alertId, tenantId, patientId).first<Record<string, unknown>>();

    if (!existing) {
      throw new HTTPException(404, { message: 'Active alert not found' });
    }

    await db.$client.prepare(`
      UPDATE vital_alerts
      SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = datetime('now')
      WHERE id = ? AND tenant_id = ? AND patient_id = ? AND status = 'active'
    `).bind(userId, alertId, tenantId, patientId).run();

    return c.json({ success: true, alertId, status: 'acknowledged' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('chart alert acknowledge failed:', error);
    throw new HTTPException(500, { message: 'Failed to acknowledge alert' });
  }
});

patientRoutes.put('/:id/chart/results/lab/:itemId/acknowledge', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const patientId = Number(c.req.param('id'));
  const itemId = Number(c.req.param('itemId'));
  const db = getDb(c.env.DB);

  if (!['doctor', 'md', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to review lab results' });
  }

  try {
    const existing = await db.$client.prepare(`
      SELECT loi.id, loi.result, loi.status
      FROM lab_order_items loi
      JOIN lab_orders lo ON loi.lab_order_id = lo.id
      WHERE loi.id = ? AND lo.tenant_id = ? AND lo.patient_id = ?
    `).bind(itemId, tenantId, patientId).first<Record<string, unknown>>();

    if (!existing) throw new HTTPException(404, { message: 'Lab result not found' });

    await createAuditLog(
      c.env,
      String(tenantId),
      String(userId),
      'APPROVE',
      'lab_order_items',
      itemId,
      null,
      { mode: 'chart-result-review', patientId, reviewType: 'lab', status: existing.status ?? null },
    );

    return c.json({ success: true, itemId, status: 'reviewed' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('lab result acknowledge failed:', error);
    throw new HTTPException(500, { message: 'Failed to acknowledge lab result' });
  }
});

patientRoutes.put('/:id/chart/results/radiology/:reportId/acknowledge', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const patientId = Number(c.req.param('id'));
  const reportId = Number(c.req.param('reportId'));
  const db = getDb(c.env.DB);

  if (!['doctor', 'md', 'hospital_admin'].includes(role)) {
    throw new HTTPException(403, { message: 'Not authorized to review radiology reports' });
  }

  try {
    const existing = await db.$client.prepare(`
      SELECT id, order_status
      FROM radiology_reports
      WHERE id = ? AND tenant_id = ? AND patient_id = ? AND is_active = 1
    `).bind(reportId, tenantId, patientId).first<Record<string, unknown>>();

    if (!existing) throw new HTTPException(404, { message: 'Radiology report not found' });

    await createAuditLog(
      c.env,
      String(tenantId),
      String(userId),
      'APPROVE',
      'radiology_reports',
      reportId,
      null,
      { mode: 'chart-result-review', patientId, reviewType: 'radiology', status: existing.order_status ?? null },
    );

    return c.json({ success: true, reportId, status: 'reviewed' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('radiology report acknowledge failed:', error);
    throw new HTTPException(500, { message: 'Failed to acknowledge radiology report' });
  }
});

/**
 * GET /api/patients/:id
 * Retrieves a single patient by their ID for the current tenant.
 */
patientRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);

  try {
    const db = getDb(c.env.DB);

    const [patient] = await db
      .select()
      .from(patients)
      .where(and(eq(patients.id, Number(id)), eq(patients.tenantId, tenantId)))
      .limit(1);

    if (!patient) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    return c.json({
      patient: {
        id: patient.id,
        patient_code: patient.patientCode,
        uhid: patient.uhid,
        name: patient.name,
        father_husband: patient.fatherHusband,
        address: patient.address,
        mobile: patient.mobile,
        guardian_mobile: patient.guardianMobile,
        age: patient.age,
        gender: patient.gender,
        blood_group: patient.bloodGroup,
        date_of_birth: patient.dateOfBirth,
        email: patient.email,
        tenant_id: Number(patient.tenantId),
        created_at: patient.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch patient' });
  }
});

/**
 * POST /api/patients
 * Creates a new patient record for the current tenant.
 */
patientRoutes.post('/', requirePermission('patients:write'), zValidator('json', createPatientSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const registrationDate = new Date().toISOString().split('T')[0];
  const registrationIdempotencyKey = (
    c.req.header('Idempotency-Key')
    ?? c.req.header('X-Idempotency-Key')
    ?? data.idempotencyKey
    ?? ''
  ).trim() || undefined;
  if (registrationIdempotencyKey && (registrationIdempotencyKey.length < 8 || registrationIdempotencyKey.length > 256)) {
    throw new HTTPException(400, { message: 'Patient registration idempotency key must be 8-256 characters' });
  }
  let registrationAttempt: PatientRegistrationAttempt | null = null;

  try {
    const db = getDb(c.env.DB);


    registrationAttempt = await beginPatientRegistrationAttempt(c.env.DB, {
      tenantId,
      userId,
      idempotencyKey: registrationIdempotencyKey,
      requestData: { ...data, idempotencyKey: registrationIdempotencyKey } as Record<string, unknown>,
      reserveIfMissing: false,
    });
    if (registrationAttempt.kind === 'replay') {
      return c.json({ ...registrationAttempt.responseBody, idempotent: true }, 201);
    }
    if (registrationAttempt.kind === 'recover') {
      const recoveredResponse = await recoverPatientRegistrationResponse(c.env.DB, {
        tenantId,
        patientId: registrationAttempt.patientId,
        patientCode: registrationAttempt.patientCode,
        uhid: registrationAttempt.uhid,
        date: registrationDate,
      });
      await completePatientRegistrationAttempt(c.env.DB, {
        tenantId,
        attempt: registrationAttempt,
        sourceId: registrationAttempt.patientId,
        responseBody: recoveredResponse,
      });
      return c.json({ ...recoveredResponse, idempotent: true, recovered: true }, 201);
    }

    {
      const duplicateWarnings = await findPatientCreateDuplicateWarnings(c.env.DB, tenantId, data);
      if (duplicateWarnings.length > 0 && !data.duplicateOverrideReason) {
        return c.json(
          {
            error: 'Possible duplicate patient found',
            code: 'POSSIBLE_DUPLICATE_PATIENT',
            message: 'Search and confirm the existing patient before creating a new hospital record.',
            possibleDuplicates: duplicateWarnings,
            overrideRequired: true,
          },
          409,
        );
      }
    }

    registrationAttempt = await beginPatientRegistrationAttempt(c.env.DB, {
      tenantId,
      userId,
      idempotencyKey: registrationIdempotencyKey,
      requestData: { ...data, idempotencyKey: registrationIdempotencyKey } as Record<string, unknown>,
    });
    if (registrationAttempt.kind === 'replay') {
      return c.json({ ...registrationAttempt.responseBody, idempotent: true }, 201);
    }
    if (registrationAttempt.kind === 'recover') {
      const recoveredResponse = await recoverPatientRegistrationResponse(c.env.DB, {
        tenantId,
        patientId: registrationAttempt.patientId,
        patientCode: registrationAttempt.patientCode,
        uhid: registrationAttempt.uhid,
        date: registrationDate,
      });
      await completePatientRegistrationAttempt(c.env.DB, {
        tenantId,
        attempt: registrationAttempt,
        sourceId: registrationAttempt.patientId,
        responseBody: recoveredResponse,
      });
      return c.json({ ...recoveredResponse, idempotent: true, recovered: true }, 201);
    }

    const identity = await resolveOrCreateGlobalIdentity(c.env.DB, {
      tenantId,
      uhid: data.uhid ?? null,
      nationalId: data.nationalId ?? null,
      phone: data.mobile ?? null,
      email: data.email ?? null,
      name: data.name ?? null,
      dateOfBirth: data.dateOfBirth ?? null,
      gender: data.gender ?? null,
      source: 'hospital',
    });

    // Generate unique patient code: P-000001 (raw D1 for sequence_counters)
    const patientCode = await getNextSequence(c.env.DB, tenantId!, 'patient', 'P');
    const patientAge = data.age ?? (data.dateOfBirth ? calculateAgeFromDateOfBirth(data.dateOfBirth) : null);

    const [inserted] = await db
      .insert(patients)
      .values({
        patientCode,
        uhid: identity.uhid,
        // The conditional Zod refinements already enforced these as
        // non-empty strings; the fallbacks keep Drizzle's NOT NULL
        // type happy and only run on a degenerate input.
        name: data.name ?? 'UNKNOWN',
        fatherHusband: data.fatherHusband ?? '',
        address: data.address ?? '',
        // `mobile` is now optional — the conditional validation in the
        // Zod schema already enforced a reason + alternative contact
        // when the receptionist could not provide a number.
        mobile: data.mobile ?? null,
        mobileMissingReason: data.mobileMissingReason ?? null,
        guardianMobile: data.guardianMobile ?? null,
        registrationIdempotencyKey: registrationIdempotencyKey ?? null,
        age: patientAge,
        gender: data.gender ?? null,
        bloodGroup: data.bloodGroup ?? null,
        tenantId: tenantId,
        createdAt: sql`datetime('now')`,
      })
      .returning({ id: patients.id });

    const patientId = inserted.id;

    // Update fields added via migrations (not in Drizzle schema)
    if (
      data.dateOfBirth
      || data.email
      || data.emergencyContactName
      || data.nationalId
      || data.village
      || data.unionName
      || data.upazila
      || data.district
      || data.division
      || identity.uhid
      || identity.id
      || patientCode
    ) {
      await db.$client.prepare(`
        UPDATE patients
        SET date_of_birth = ?,
            email = ?,
            secondary_contact = ?,
            national_id = ?,
            village = ?,
            union_name = ?,
            upazila = ?,
            district = ?,
            division = ?,
            patient_code = ?,
            uhid = ?,
            global_identity_id = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(
        data.dateOfBirth ?? null,
        data.email ?? null,
        data.emergencyContactName ? JSON.stringify({
          name: data.emergencyContactName,
          phone: data.emergencyContactPhone ?? null,
          relation: data.emergencyContactRelation ?? null,
        }) : null,
        data.nationalId ?? null,
        data.village ?? null,
        data.unionName ?? null,
        data.upazila ?? null,
        data.district ?? null,
        data.division ?? null,
        patientCode,
        identity.uhid,
        identity.id,
        patientId,
        tenantId,
      ).run();
    }

    // When the receptionist could not provide a mobile but did supply
    // a named guardian contact, persist that as the primary guardian
    // on the patient so the chart / SMS / voice-call flows can find
    // the patient through family in the future.
    if (data.guardianName && data.guardianRelation && !data.mobile) {
      await db.$client.prepare(`
        INSERT INTO patient_guardians (
          tenant_id, patient_id, guardian_name, relationship,
          phone, address, is_primary, is_active, created_by
        )
        VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)
      `).bind(
        tenantId,
        patientId,
        data.guardianName,
        data.guardianRelation,
        data.guardianMobile ?? null,
        data.address ?? null,
        requireUserId(c),
      ).run();
    }

    // ─── Duplicate patient detection (post-insert) ─────────────────────────────
    let duplicateInfo: Record<string, unknown> | null = null;
    const duplicateMatch = await db.$client.prepare(`
      SELECT id, patient_code, name, mobile, date_of_birth
      FROM patients
      WHERE tenant_id = ?
        AND id != ?
        AND is_duplicate = 0
        AND (
          (LOWER(name) = LOWER(?) AND mobile = ?)
          OR (
            LOWER(name) = LOWER(?) AND date_of_birth IS NOT NULL AND date_of_birth = ?
          )
        )
      ORDER BY id ASC
      LIMIT 1
    `).bind(
      tenantId,
      patientId,
      data.name,
      data.mobile ?? '',
      data.name,
      data.dateOfBirth ?? '',
    ).first<{ id: number; patient_code: string; name: string; mobile: string; date_of_birth: string }>();

    if (duplicateMatch) {
      await db.$client.prepare(`
        UPDATE patients
        SET is_duplicate = 1, duplicate_of_patient_id = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(duplicateMatch.id, patientId, tenantId).run();

      duplicateInfo = {
        is_duplicate: true,
        duplicate_of_patient_id: duplicateMatch.id,
        duplicate_patient_code: duplicateMatch.patient_code,
        duplicate_name: duplicateMatch.name,
        duplicate_mobile: duplicateMatch.mobile,
      };
    }

    // Auto-link in Master Patient Index. Prefer NID, but keep UHID-only
    // patients linkable for app claim and consented cross-hospital sharing.
    const portableIdentityKey = data.nationalId ?? identity.uhid;
    if (portableIdentityKey) {
      const hospitalRow = await db.$client.prepare('SELECT name FROM tenants WHERE id = ?').bind(tenantId).first<{ name: string }>();
      await db.$client.prepare(`
        INSERT OR IGNORE INTO patient_health_links (national_id, tenant_id, patient_id, hospital_name, uhid)
        VALUES (?, ?, ?, ?, ?)
      `).bind(portableIdentityKey, tenantId, patientId, hospitalRow?.name ?? null, identity.uhid).run();

      await recordPatientHealthLinkSyncEvent(c, {
        tenantId,
        patientId,
        uhid: identity.uhid,
        nationalId: portableIdentityKey,
        hospitalName: hospitalRow?.name ?? null,
      });
    }

    const globalIdentityPayload = buildGlobalIdentitySyncPayload(identity as unknown as Record<string, unknown>, {
      name: data.name ?? null,
      phone: data.mobile ?? null,
      email: data.email ?? null,
      dateOfBirth: data.dateOfBirth ?? null,
      gender: data.gender ?? null,
    });
    if (globalIdentityPayload) {
      await recordLocalSyncOutboxEvent(c.env, {
        tenantId,
        entityType: 'global_patient_identity',
        entityId: String(globalIdentityPayload.uhid),
        operation: 'upsert',
        payload: globalIdentityPayload,
      });
    }

    await recordLocalSyncOutboxEvent(c.env, {
      tenantId,
      entityType: 'patients',
      entityId: patientId,
      operation: 'upsert',
      payload: buildLocalSyncPatientPayload({
        id: patientId,
        tenantId,
        name: data.name ?? null,
        fatherHusband: data.fatherHusband ?? '',
        address: data.address ?? '',
        mobile: data.mobile ?? null,
        email: data.email ?? null,
        patientCode,
        uhid: identity.uhid,
        nationalId: data.nationalId ?? null,
        dateOfBirth: data.dateOfBirth ?? null,
        gender: data.gender ?? null,
        age: patientAge,
      }),
    });

    const serialNumber = await ensurePatientRegistrationSerial(c.env.DB, {
      tenantId,
      patientId,
      date: registrationDate,
    });

    // Audit log
    void createAuditLog(c.env, tenantId, userId, 'CREATE', 'patients', patientId, null, { ...data, idempotencyKey: undefined });

    const response: Record<string, unknown> = {
      message: 'Patient registered',
      patientId,
      patientCode,
      uhid: identity.uhid,
      serial: serialNumber,
    };

    if (duplicateInfo) {
      response.duplicate = duplicateInfo;
    }

    if (registrationAttempt) {
      await completePatientRegistrationAttempt(c.env.DB, {
        tenantId,
        attempt: registrationAttempt,
        sourceId: patientId,
        responseBody: response,
      });
    }

    return c.json(response, 201);
  } catch (error) {
    await failPatientRegistrationAttempt(c.env.DB, {
      tenantId,
      attempt: registrationAttempt,
    }).catch((idempotencyError) => {
      console.error('patient registration idempotency failure update failed:', idempotencyError);
    });
    if (error instanceof HTTPException) throw error;
    console.error('patient create error:', error);
    throw new HTTPException(500, { message: 'Failed to create patient' });
  }
});

/**
 * PUT /api/patients/:id
 * Updates an existing patient record for the current tenant.
 */
patientRoutes.put('/:id', requirePermission('patients:write'), zValidator('json', updatePatientSchema), async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  try {
    const db = getDb(c.env.DB);

    const [existing] = await db
      .select()
      .from(patients)
      .where(and(eq(patients.id, Number(id)), eq(patients.tenantId, tenantId)))
      .limit(1);

    if (!existing) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    const recalculatedAge = data.age !== undefined
      ? data.age
      : data.dateOfBirth !== undefined
        ? calculateAgeFromDateOfBirth(data.dateOfBirth)
        : existing.age;

    const updatedPatient = {
      name: data.name ?? existing.name,
      fatherHusband: data.fatherHusband ?? existing.fatherHusband,
      address: data.address ?? existing.address,
      mobile: data.mobile ?? existing.mobile,
      guardianMobile: data.guardianMobile !== undefined ? data.guardianMobile : existing.guardianMobile,
      age: recalculatedAge,
      gender: data.gender ?? existing.gender,
      bloodGroup: data.bloodGroup ?? existing.bloodGroup,
      email: data.email !== undefined ? data.email : existing.email,
      dateOfBirth: data.dateOfBirth !== undefined ? data.dateOfBirth : existing.dateOfBirth,
    };
    const patientPayload = buildLocalSyncPatientPayload({
      id: Number(id),
      tenantId,
      name: updatedPatient.name,
      fatherHusband: updatedPatient.fatherHusband,
      address: updatedPatient.address,
      mobile: updatedPatient.mobile,
      email: updatedPatient.email,
      patientCode: existing.patientCode,
      uhid: existing.uhid,
      nationalId: existing.nationalId,
      dateOfBirth: updatedPatient.dateOfBirth,
      gender: updatedPatient.gender,
      age: updatedPatient.age,
      createdAt: existing.createdAt,
    });
    const patientUpdateStatement = c.env.DB.prepare(`
      UPDATE patients
      SET name = ?,
          father_husband = ?,
          address = ?,
          mobile = ?,
          guardian_mobile = ?,
          age = ?,
          gender = ?,
          blood_group = ?,
          email = ?,
          date_of_birth = ?,
          updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `).bind(
      updatedPatient.name,
      updatedPatient.fatherHusband,
      updatedPatient.address,
      updatedPatient.mobile,
      updatedPatient.guardianMobile,
      updatedPatient.age,
      updatedPatient.gender,
      updatedPatient.bloodGroup,
      updatedPatient.email,
      updatedPatient.dateOfBirth,
      Number(id),
      tenantId,
    );
    const updateStatements: D1PreparedStatement[] = [patientUpdateStatement];
    const patientOutboxStatement = await buildLocalSyncOutboxStatement(c.env, {
      tenantId,
      entityType: 'patients',
      entityId: Number(id),
      operation: 'upsert',
      payload: patientPayload,
    });
    if (patientOutboxStatement) updateStatements.push(patientOutboxStatement);
    await c.env.DB.batch(updateStatements);

    // Audit log
    void createAuditLog(c.env, tenantId!, requireUserId(c), 'UPDATE', 'patients', Number(id), existing, data);

    // If critical fields changed, mark active health cards as stale
    if (data.bloodGroup && data.bloodGroup !== existing.bloodGroup) {
      markCardsStale(c.env.DB, tenantId, Number(id)).catch((err) => {
        console.error('markCardsStale failed:', err);
      });
    }

    return c.json({ message: 'Patient updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update patient' });
  }
});

/**
 * GET /api/patients/duplicates
 * List all patients flagged as duplicates for the current tenant.
 */
patientRoutes.get('/duplicates', async (c) => {
  const tenantId = requireTenantId(c);

  try {
    const db = getDb(c.env.DB);
    const { results } = await db.$client.prepare(`
      SELECT p.*, original.patient_code as original_patient_code, original.name as original_name
      FROM patients p
      LEFT JOIN patients original ON p.duplicate_of_patient_id = original.id
      WHERE p.tenant_id = ? AND p.is_duplicate = 1
      ORDER BY p.created_at DESC
    `).bind(tenantId).all();

    return c.json({ duplicates: results ?? [] });
  } catch (error) {
    console.error('patients duplicates fetch error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch duplicate patients' });
  }
});

/**
 * PUT /api/patients/:id/merge
 * Merge a duplicate patient into the original patient.
 * Updates references in visits, bills, admissions, lab_orders.
 */
patientRoutes.put('/:id/merge', requirePermission('patients:write'), async (c) => {
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  try {
    const db = getDb(c.env.DB);
    const duplicateId = Number(id);

    if (Number.isNaN(duplicateId) || duplicateId <= 0) {
      throw new HTTPException(400, { message: 'Invalid patient id' });
    }

    const duplicate = await db.$client.prepare(`
      SELECT id, is_duplicate, duplicate_of_patient_id, name, mobile
      FROM patients
      WHERE id = ? AND tenant_id = ?
    `).bind(duplicateId, tenantId).first<{
      id: number;
      is_duplicate: number;
      duplicate_of_patient_id: number | null;
      name: string;
      mobile: string;
    }>();

    if (!duplicate) {
      throw new HTTPException(404, { message: 'Patient not found' });
    }

    const originalId = duplicate.duplicate_of_patient_id ?? Number(c.req.query('original_id'));
    if (!originalId || originalId === duplicateId) {
      throw new HTTPException(400, { message: 'Valid original patient id required for merge' });
    }

    const original = await db.$client.prepare(`
      SELECT id FROM patients WHERE id = ? AND tenant_id = ?
    `).bind(originalId, tenantId).first<{ id: number }>();

    if (!original) {
      throw new HTTPException(404, { message: 'Original patient not found' });
    }

    const tablesToUpdate = [
      { table: 'visits', col: 'patient_id' },
      { table: 'bills', col: 'patient_id' },
      { table: 'admissions', col: 'patient_id' },
      { table: 'lab_orders', col: 'patient_id' },
      { table: 'appointments', col: 'patient_id' },
      { table: 'deposits', col: 'patient_id' },
      { table: 'prescriptions', col: 'patient_id' },
      { table: 'queue_entries', col: 'patient_id' },
    ];

    const updated: Record<string, number> = {};

    for (const { table, col } of tablesToUpdate) {
      try {
        const result = await db.$client.prepare(
          `UPDATE ${table} SET ${col} = ? WHERE ${col} = ? AND tenant_id = ?`
        ).bind(originalId, duplicateId, tenantId).run();
        if (result.meta.changes > 0) {
          updated[table] = result.meta.changes;
        }
      } catch {
        // table might not exist, skip
      }
    }

    // Mark duplicate as merged (inactive)
    await db.$client.prepare(`
      UPDATE patients
      SET name = name || ' [MERGED→' || ? || ']',
          mobile = 'MERGED-' || mobile,
          is_duplicate = 1,
          duplicate_of_patient_id = ?,
          updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?
    `).bind(originalId, originalId, duplicateId, tenantId).run();

    void createAuditLog(c.env, tenantId!, userId!, 'UPDATE', 'patients', duplicateId, duplicate, {
      merged_into: originalId,
      tables_updated: updated,
    });

    return c.json({
      message: `Patient #${duplicateId} merged into #${originalId}`,
      original_id: originalId,
      duplicate_id: duplicateId,
      tables_updated: updated,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('patient merge error:', error);
    throw new HTTPException(500, { message: 'Failed to merge patient' });
  }
});

// ─── Link Global Patient to Current Hospital ──────────────────────────

patientRoutes.post('/link-global', requirePermission('patients:write'), async (c) => {
  const tenantId = requireTenantId(c);
  const { uhid } = await c.req.json<{ uhid: string }>();

  if (!uhid?.trim()) {
    throw new HTTPException(400, { message: 'UHID is required' });
  }

  const db = getDb(c.env.DB);

  // Check if already linked
  const existing = await db.$client.prepare(
    'SELECT patient_id FROM patient_health_links WHERE uhid = ? AND tenant_id = ? AND is_active = 1'
  ).bind(uhid, tenantId).first<{ patient_id: number }>();

  if (existing) {
    const patient = await db.$client.prepare(
      'SELECT id, name, mobile, patient_code FROM patients WHERE id = ? AND tenant_id = ?'
    ).bind(existing.patient_id, tenantId).first();
    return c.json({ patientId: existing.patient_id, alreadyLinked: true, patient });
  }

  // Get global identity
  const mpi = await db.$client.prepare(
    'SELECT * FROM global_patient_identity WHERE uhid = ?'
  ).bind(uhid).first<Record<string, unknown>>();

  if (!mpi) {
    throw new HTTPException(404, { message: 'Patient not found in global system' });
  }

  const patientCode = await getNextSequence(c.env.DB, tenantId, 'patient', 'P');
  const patientAge = mpi.date_of_birth ? calculateAgeFromDateOfBirth(String(mpi.date_of_birth)) : null;
  const mpiMobile = normalizeBangladeshMobile(String(mpi.primary_phone ?? '')) ?? (mpi.primary_phone ? String(mpi.primary_phone) : null);
  const hospitalRow = await db.$client.prepare(
    'SELECT name FROM tenants WHERE id = ?'
  ).bind(tenantId).first<{ name: string }>();

  const reusableLocalPatient = await db.$client.prepare(`
    SELECT id, name, father_husband, address, mobile, patient_code
    FROM patients
    WHERE tenant_id = ?
      AND (
        uhid = ?
        OR (? IS NOT NULL AND mobile = ?)
      )
    ORDER BY CASE WHEN uhid = ? THEN 0 WHEN mobile = ? THEN 1 ELSE 2 END,
             id ASC
    LIMIT 1
  `).bind(tenantId, uhid, mpiMobile, mpiMobile, uhid, mpiMobile).first<{ id: number; name: string; father_husband: string; address: string; mobile: string | null; patient_code: string | null }>();

  if (reusableLocalPatient) {
    const linkedPatientCode = reusableLocalPatient.patient_code ?? patientCode;
    const patientPayload = buildLocalSyncPatientPayload({
      id: reusableLocalPatient.id,
      tenantId,
      name: reusableLocalPatient.name,
      fatherHusband: reusableLocalPatient.father_husband,
      address: reusableLocalPatient.address,
      mobile: reusableLocalPatient.mobile ?? mpiMobile,
      patientCode: linkedPatientCode,
      uhid,
      nationalId: typeof mpi.national_id === 'string' ? mpi.national_id : null,
      dateOfBirth: typeof mpi.date_of_birth === 'string' ? mpi.date_of_birth : null,
      gender: typeof mpi.gender === 'string' ? mpi.gender : null,
      age: patientAge,
    });
    const globalIdentityPayload = buildGlobalIdentitySyncPayload(mpi, {
      name: String(mpi.primary_name ?? reusableLocalPatient.name ?? ''),
      phone: mpiMobile,
      email: typeof mpi.primary_email === 'string' ? mpi.primary_email : null,
      dateOfBirth: typeof mpi.date_of_birth === 'string' ? mpi.date_of_birth : null,
      gender: typeof mpi.gender === 'string' ? mpi.gender : null,
    });
    const linkStatements: D1PreparedStatement[] = [
      c.env.DB.prepare(`
        UPDATE patients
        SET patient_code = COALESCE(patient_code, ?),
            uhid = COALESCE(uhid, ?),
            global_identity_id = COALESCE(global_identity_id, ?),
            date_of_birth = COALESCE(date_of_birth, ?),
            gender = COALESCE(gender, ?),
            age = COALESCE(age, ?)
        WHERE id = ? AND tenant_id = ?
      `).bind(
        patientCode,
        uhid,
        mpi.id ?? null,
        mpi.date_of_birth ?? null,
        mpi.gender ?? null,
        patientAge,
        reusableLocalPatient.id,
        tenantId,
      ),
      c.env.DB.prepare(`
        INSERT OR IGNORE INTO patient_health_links
          (national_id, tenant_id, patient_id, hospital_name, uhid)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        String(mpi.national_id ?? uhid),
        tenantId,
        reusableLocalPatient.id,
        hospitalRow?.name ?? null,
        uhid,
      ),
    ];

    const healthLinkOutbox = await buildPatientHealthLinkSyncStatement(c.env, {
      tenantId,
      patientId: reusableLocalPatient.id,
      uhid,
      nationalId: String(mpi.national_id ?? uhid),
      hospitalName: hospitalRow?.name ?? null,
    });
    if (healthLinkOutbox) linkStatements.push(healthLinkOutbox);

    if (globalIdentityPayload) {
      const globalIdentityOutbox = await buildLocalSyncOutboxStatement(c.env, {
        tenantId,
        entityType: 'global_patient_identity',
        entityId: String(globalIdentityPayload.uhid),
        operation: 'upsert',
        payload: globalIdentityPayload,
      });
      if (globalIdentityOutbox) linkStatements.push(globalIdentityOutbox);
    }

    const patientOutbox = await buildLocalSyncOutboxStatement(c.env, {
      tenantId,
      entityType: 'patients',
      entityId: reusableLocalPatient.id,
      operation: 'upsert',
      payload: patientPayload,
    });
    if (patientOutbox) linkStatements.push(patientOutbox);

    await c.env.DB.batch(linkStatements);

    const patient = await db.$client.prepare(
      'SELECT id, name, mobile, patient_code FROM patients WHERE id = ? AND tenant_id = ?'
    ).bind(reusableLocalPatient.id, tenantId).first();

    return c.json({ patientId: reusableLocalPatient.id, alreadyLinked: false, patient });
  }

  // Create the patient and its patient outbox together. If the second-stage
  // health-link batch fails, a retry finds this row by UHID and completes via
  // the reusable-patient branch instead of creating a duplicate patient.
  const patientPayload = buildLocalSyncPatientPayload({
    tenantId,
    name: typeof mpi.primary_name === 'string' ? mpi.primary_name : null,
    fatherHusband: '',
    address: '',
    mobile: mpiMobile,
    email: typeof mpi.primary_email === 'string' ? mpi.primary_email : null,
    patientCode,
    uhid,
    nationalId: typeof mpi.national_id === 'string' ? mpi.national_id : null,
    dateOfBirth: typeof mpi.date_of_birth === 'string' ? mpi.date_of_birth : null,
    gender: typeof mpi.gender === 'string' ? mpi.gender : null,
    age: patientAge,
  });
  const patientCreateStatements: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT INTO patients (tenant_id, name, father_husband, address, mobile, email, national_id,
        blood_group, date_of_birth, gender, age, patient_code, uhid, global_identity_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      tenantId,
      mpi.primary_name,
      '',
      '',
      mpiMobile,
      mpi.primary_email ?? null,
      mpi.national_id ?? null,
      mpi.blood_group ?? null,
      mpi.date_of_birth ?? null,
      mpi.gender ?? null,
      patientAge,
      patientCode,
      uhid,
      mpi.id ?? null,
    ),
  ];
  const patientCreateOutbox = await buildLocalSyncPatientCreateOutboxStatement(c.env, {
    tenantId,
    patientCode,
    payload: patientPayload,
  });
  if (patientCreateOutbox) patientCreateStatements.push(patientCreateOutbox);

  const [patientInsertResult] = await c.env.DB.batch(patientCreateStatements);
  let patientId = Number(patientInsertResult?.meta?.last_row_id ?? 0);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    const createdPatient = await db.$client.prepare(`
      SELECT id FROM patients WHERE tenant_id = ? AND patient_code = ? LIMIT 1
    `).bind(tenantId, patientCode).first<{ id: number }>();
    patientId = Number(createdPatient?.id ?? 0);
  }
  if (!Number.isInteger(patientId) || patientId <= 0) {
    throw new HTTPException(500, { message: 'Global patient linkage could not resolve the local patient record' });
  }

  const linkStatements: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO patient_health_links
        (national_id, tenant_id, patient_id, hospital_name, uhid)
      VALUES (?, ?, ?, ?, ?)
    `).bind(String(mpi.national_id ?? uhid), tenantId, patientId, hospitalRow?.name ?? null, uhid),
  ];
  const healthLinkOutbox = await buildPatientHealthLinkSyncStatement(c.env, {
    tenantId,
    patientId,
    uhid,
    nationalId: String(mpi.national_id ?? uhid),
    hospitalName: hospitalRow?.name ?? null,
  });
  if (healthLinkOutbox) linkStatements.push(healthLinkOutbox);

  const globalIdentityPayload = buildGlobalIdentitySyncPayload(mpi, {
    name: typeof mpi.primary_name === 'string' ? mpi.primary_name : null,
    phone: mpiMobile,
    email: typeof mpi.primary_email === 'string' ? mpi.primary_email : null,
    dateOfBirth: typeof mpi.date_of_birth === 'string' ? mpi.date_of_birth : null,
    gender: typeof mpi.gender === 'string' ? mpi.gender : null,
  });
  if (globalIdentityPayload) {
    const globalIdentityOutbox = await buildLocalSyncOutboxStatement(c.env, {
      tenantId,
      entityType: 'global_patient_identity',
      entityId: String(globalIdentityPayload.uhid),
      operation: 'upsert',
      payload: globalIdentityPayload,
    });
    if (globalIdentityOutbox) linkStatements.push(globalIdentityOutbox);
  }
  await c.env.DB.batch(linkStatements);

  const patient = await db.$client.prepare(
    'SELECT id, name, mobile, patient_code FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first();

  return c.json({ patientId, alreadyLinked: false, patient });
});

// ─── GET /api/patients/:id/summary — aggregated patient summary for pre-consultation ──
patientRoutes.get('/:id/summary', async (c) => {
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
      `).bind(tenantId, patientId)
    ]);

    const vitalsResult = batchResults[0].results[0];
    const allergiesResult = batchResults[1];
    const medicationsResult = batchResults[2];
    const visitsResult = batchResults[3];
    const diagnosesResult = batchResults[4];
    const prescriptionsResult = batchResults[5].results[0];
    const labResultsResult = batchResults[6];

    return c.json({
      patient,
      vitals: vitalsResult ?? null,
      allergies: allergiesResult.results ?? [],
      active_medications: medicationsResult.results ?? [],
      recent_visits: visitsResult.results ?? [],
      recent_diagnoses: diagnosesResult.results ?? [],
      last_prescription: prescriptionsResult ?? null,
      recent_lab_results: labResultsResult.results ?? [],
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('patient summary error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch patient summary' });
  }
});

export default patientRoutes;
