import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import {
  callAIJson,
  checkAIRateLimit,
  AIError,
  SYSTEM_PROMPTS,
  type ChatMessage,
} from '../../lib/ai';
import {
  prescriptionAssistSchema,
  diagnosisSuggestSchema,
  billingFromNotesSchema,
  triageChatSchema,
  noteSummarySchema,
  labInterpretSchema,
  dashboardInsightsSchema,
} from '../../schemas/ai';
import {
  saveInteraction,
  buildMemoryContext,
  recordFeedback,
  type AIFeature,
  type UserAction,
} from '../../lib/ai-memory';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';


const aiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Middleware: check API key + rate limit ──────────────────────────────────

aiRoutes.use('*', async (c, next) => {
  const db = getDb(c.env.DB);
  if (!c.env.OPENROUTER_API_KEY) {
    throw new HTTPException(503, { message: 'AI service not configured. Contact your administrator.' });
  }

  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  if (!tenantId || !userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  const allowed = await checkAIRateLimit(c.env.KV, tenantId, userId);
  if (!allowed) {
    throw new HTTPException(429, { message: 'AI rate limit exceeded. Please wait a moment.' });
  }

  await next();
});

// ─── Helper: get API key and model ──────────────────────────────────────────

function getConfig(env: Env) {
  return {
    apiKey: env.OPENROUTER_API_KEY!,
    model: env.AI_MODEL ?? 'openrouter/healer-alpha',
  };
}

// ─── Helper: wrap AI errors ─────────────────────────────────────────────────

function handleAIError(err: unknown): never {
  if (err instanceof HTTPException) throw err;
  if (err instanceof AIError) {
    const code = (err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500) as 400 | 401 | 403 | 404 | 408 | 429 | 500 | 502 | 503;
    throw new HTTPException(code, { message: err.message });
  }
  console.error('[AI] Unexpected error:', err);
  throw new HTTPException(500, { message: 'AI service temporarily unavailable' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Feature 1: Prescription AI Assistant
// ═══════════════════════════════════════════════════════════════════════════════

aiRoutes.post('/prescription-assist', zValidator('json', prescriptionAssistSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const { apiKey, model } = getConfig(c.env);

  try {
    // Fetch patient info if patientId is provided
    let patientContext = '';
    if (data.patientId) {
      const patient = await db.$client.prepare(
        `SELECT name, date_of_birth, gender, blood_group FROM patients WHERE id = ? AND tenant_id = ?`,
      ).bind(data.patientId, tenantId).first<{
        name: string; date_of_birth?: string; gender?: string; blood_group?: string;
      }>();

      if (patient) {
        const age = patient.date_of_birth
          ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
          : data.patientAge;
        patientContext = `\nPatient: ${patient.name}, Age: ${age ?? 'unknown'}, Gender: ${patient.gender ?? data.patientGender ?? 'unknown'}, Blood Group: ${patient.blood_group ?? 'unknown'}`;
      }
    }

    const inputSummary = `Rx: ${data.medications.map((m) => m.name).join(', ')}`;
    const memoryContext = await buildMemoryContext(c.env, tenantId, userId, 'prescription_assist', inputSummary);

    const userMessage = `Medications being prescribed:
${data.medications.map((m, i) => `${i + 1}. ${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.frequency ? ` ${m.frequency}` : ''}${m.duration ? ` for ${m.duration}` : ''}`).join('\n')}
${patientContext}
${data.knownAllergies?.length ? `Known allergies: ${data.knownAllergies.join(', ')}` : ''}
${data.patientAge ? `Age: ${data.patientAge}` : ''}
${data.patientWeight ? `Weight: ${data.patientWeight}kg` : ''}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPTS.prescriptionAssist + memoryContext },
      { role: 'user', content: userMessage },
    ];

    const aiResult = await callAIJson<Record<string, unknown>>(apiKey, messages, { model });
    const responseJson = JSON.stringify(aiResult.data);

    // Save interaction for learning (non-blocking)
    const interactionId = await saveInteraction(c.env, tenantId, userId, 'prescription_assist', inputSummary, responseJson);

    return c.json({ ...aiResult.data, interactionId, usage: aiResult.usage });
  } catch (err) {
    handleAIError(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature 2: Smart Diagnosis Suggestions
// ═══════════════════════════════════════════════════════════════════════════════

aiRoutes.post('/diagnosis-suggest', zValidator('json', diagnosisSuggestSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const { apiKey, model } = getConfig(c.env);

  try {
    const vitalsStr = data.vitals
      ? Object.entries(data.vitals)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')
      : 'Not provided';

    const inputSummary = `Dx: ${data.symptoms.substring(0, 100)}`;
    const memoryContext = await buildMemoryContext(c.env, tenantId, userId, 'diagnosis_suggest', inputSummary);

    const userMessage = `Patient Symptoms: ${data.symptoms}
Vitals: ${vitalsStr}
Age: ${data.patientAge ?? 'unknown'}, Gender: ${data.patientGender ?? 'unknown'}
${data.medicalHistory ? `Medical History: ${data.medicalHistory}` : ''}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPTS.diagnosisSuggest + memoryContext },
      { role: 'user', content: userMessage },
    ];

    const aiResult = await callAIJson<Record<string, unknown>>(apiKey, messages, { model });
    const responseJson = JSON.stringify(aiResult.data);
    const interactionId = await saveInteraction(c.env, tenantId, userId, 'diagnosis_suggest', inputSummary, responseJson);

    return c.json({ ...aiResult.data, interactionId, usage: aiResult.usage });
  } catch (err) {
    handleAIError(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature 3: Auto-generate Billing from Consultation Notes
// ═══════════════════════════════════════════════════════════════════════════════

aiRoutes.post('/billing-from-notes', zValidator('json', billingFromNotesSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const { apiKey, model } = getConfig(c.env);

  try {
    const { results: tests } = await db.$client.prepare(
      `SELECT name, price FROM lab_test_catalog WHERE tenant_id = ? AND is_active = 1 ORDER BY name LIMIT 50`,
    ).bind(tenantId).all<{ name: string; price: number }>();

    const priceContext = tests.length
      ? `\nAvailable services and their prices:\n${tests.map((t) => `- ${t.name}: ${t.price} BDT`).join('\n')}`
      : '';

    const inputSummary = `Billing: ${data.consultationNotes.substring(0, 100)}`;
    const memoryContext = await buildMemoryContext(c.env, tenantId, userId, 'billing_from_notes', inputSummary);

    const userMessage = `Consultation Notes:\n${data.consultationNotes}${priceContext}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPTS.billingFromNotes + memoryContext },
      { role: 'user', content: userMessage },
    ];

    const aiResult = await callAIJson<Record<string, unknown>>(apiKey, messages, { model });
    const responseJson = JSON.stringify(aiResult.data);
    const interactionId = await saveInteraction(c.env, tenantId, userId, 'billing_from_notes', inputSummary, responseJson);

    return c.json({ ...aiResult.data, interactionId, usage: aiResult.usage });
  } catch (err) {
    handleAIError(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature 4: Patient Symptom Triage Chatbot
// ═══════════════════════════════════════════════════════════════════════════════

aiRoutes.post('/triage', zValidator('json', triageChatSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const { apiKey, model } = getConfig(c.env);

  try {
    const { results: specialties } = await db.$client.prepare(
      `SELECT DISTINCT specialty FROM doctors WHERE tenant_id = ? AND is_active = 1 ORDER BY specialty`,
    ).bind(tenantId).all<{ specialty: string }>();

    const deptList = specialties.length
      ? specialties.map((s) => s.specialty).filter(Boolean).join(', ')
      : 'General Medicine, Surgery, Pediatrics, Obstetrics & Gynecology, Orthopedics, ENT, Ophthalmology, Dermatology, Cardiology, Neurology';

    const systemPrompt = SYSTEM_PROMPTS.triage.replace(
      'Available departments: General Medicine, Surgery, Pediatrics, Obstetrics & Gynecology,\nOrthopedics, ENT, Ophthalmology, Dermatology, Cardiology, Neurology, Urology,\nPsychiatry, Emergency, Dental.',
      `Available departments at this hospital: ${deptList}.`,
    );

    const inputSummary = `Triage: ${data.message.substring(0, 100)}`;
    const memoryContext = await buildMemoryContext(c.env, tenantId, userId, 'triage', inputSummary);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt + memoryContext },
      ...data.conversationHistory.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: data.message },
    ];

    const aiResult = await callAIJson<Record<string, unknown>>(apiKey, messages, { model, temperature: 0.5 });
    const responseJson = JSON.stringify(aiResult.data);
    const interactionId = await saveInteraction(c.env, tenantId, userId, 'triage', inputSummary, responseJson);

    return c.json({ ...aiResult.data, interactionId, usage: aiResult.usage });
  } catch (err) {
    handleAIError(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature 5: Clinical Note Summarization
// ═══════════════════════════════════════════════════════════════════════════════

aiRoutes.post('/summarize-note', zValidator('json', noteSummarySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const { apiKey, model } = getConfig(c.env);

  try {
    const inputSummary = `Summary: ${data.note.substring(0, 100)}`;
    const memoryContext = await buildMemoryContext(c.env, tenantId, userId, 'summarize_note', inputSummary);
    const userMessage = `Format: ${data.format.toUpperCase()}\n\nClinical Note:\n${data.note}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPTS.summarizeNote + memoryContext },
      { role: 'user', content: userMessage },
    ];

    const aiResult = await callAIJson<Record<string, unknown>>(apiKey, messages, { model });
    const responseJson = JSON.stringify(aiResult.data);
    const interactionId = await saveInteraction(c.env, tenantId, userId, 'summarize_note', inputSummary, responseJson);

    return c.json({ ...aiResult.data, interactionId, usage: aiResult.usage });
  } catch (err) {
    handleAIError(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature 6: Lab Report Interpretation
// ═══════════════════════════════════════════════════════════════════════════════

aiRoutes.post('/interpret-lab', zValidator('json', labInterpretSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const { apiKey, model } = getConfig(c.env);

  try {
    const inputSummary = `Lab: ${data.results.map((r) => r.testName).join(', ').substring(0, 100)}`;
    const memoryContext = await buildMemoryContext(c.env, tenantId, userId, 'interpret_lab', inputSummary);

    const userMessage = `Lab Results:
${data.results.map((r, i) => `${i + 1}. ${r.testName}: ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.normalRange ? ` (ref: ${r.normalRange})` : ''}`).join('\n')}
${data.patientAge ? `Patient Age: ${data.patientAge}` : ''}
${data.patientGender ? `Patient Gender: ${data.patientGender}` : ''}`;

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPTS.interpretLab + memoryContext },
      { role: 'user', content: userMessage },
    ];

    const aiResult = await callAIJson<Record<string, unknown>>(apiKey, messages, { model });
    const responseJson = JSON.stringify(aiResult.data);
    const interactionId = await saveInteraction(c.env, tenantId, userId, 'interpret_lab', inputSummary, responseJson);

    return c.json({ ...aiResult.data, interactionId, usage: aiResult.usage });
  } catch (err) {
    handleAIError(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Feature 7: Dashboard Predictive Analytics / Insights
// ═══════════════════════════════════════════════════════════════════════════════

aiRoutes.post('/dashboard-insights', zValidator('json', dashboardInsightsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const { apiKey, model } = getConfig(c.env);

  try {
    // Fetch aggregate data from D1
    const [revenueData, patientData, visitData, expenseData] = await Promise.all([
      db.$client.prepare(`
        SELECT strftime('%Y-%m', created_at) AS month,
               SUM(total) AS revenue,
               COUNT(*) AS bill_count
        FROM bills WHERE tenant_id = ? AND date(created_at) BETWEEN ? AND ?
        GROUP BY month ORDER BY month
      `).bind(tenantId, data.dateRange.from, data.dateRange.to).all(),

      db.$client.prepare(`
        SELECT COUNT(*) AS total_patients,
               SUM(CASE WHEN date(created_at) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS new_patients
        FROM patients WHERE tenant_id = ?
      `).bind(data.dateRange.from, data.dateRange.to, tenantId).first(),

      db.$client.prepare(`
        SELECT strftime('%Y-%m', visit_date) AS month,
               COUNT(*) AS visit_count
        FROM visits WHERE tenant_id = ? AND date(visit_date) BETWEEN ? AND ?
        GROUP BY month ORDER BY month
      `).bind(tenantId, data.dateRange.from, data.dateRange.to).all(),

      db.$client.prepare(`
        SELECT SUM(amount) AS total_expenses
        FROM expenses WHERE tenant_id = ? AND date(date) BETWEEN ? AND ?
      `).bind(tenantId, data.dateRange.from, data.dateRange.to).first(),
    ]);

    const userMessage = `Hospital Operational Data (${data.dateRange.from} to ${data.dateRange.to}):

Revenue by Month:
${revenueData.results.map((r: Record<string, unknown>) => `${r.month}: ৳${r.revenue} (${r.bill_count} bills)`).join('\n') || 'No data'}

Patients: Total ${(patientData as Record<string, unknown>)?.total_patients ?? 0}, New in period: ${(patientData as Record<string, unknown>)?.new_patients ?? 0}

Visits by Month:
${visitData.results.map((r: Record<string, unknown>) => `${r.month}: ${r.visit_count} visits`).join('\n') || 'No data'}

Total Expenses: ৳${(expenseData as Record<string, unknown>)?.total_expenses ?? 0}`;

    const inputSummary = `Dashboard insights ${data.dateRange.from} to ${data.dateRange.to}`;
    const memoryContext = await buildMemoryContext(c.env, tenantId, requireUserId(c), 'dashboard_insights', inputSummary);

    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPTS.dashboardInsights + memoryContext },
      { role: 'user', content: userMessage },
    ];

    const aiResult = await callAIJson<Record<string, unknown>>(apiKey, messages, { model, temperature: 0.4 });
    const responseJson = JSON.stringify(aiResult.data);
    const interactionId = await saveInteraction(c.env, tenantId, requireUserId(c), 'dashboard_insights', inputSummary, responseJson);

    return c.json({ ...aiResult.data, interactionId, usage: aiResult.usage });
  } catch (err) {
    handleAIError(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Doctor Feedback Endpoint
// ═══════════════════════════════════════════════════════════════════════════════

const feedbackSchema = z.object({
  interactionId: z.number().int().positive(),
  action: z.enum(['accepted', 'rejected', 'modified']),
  modification: z.string().optional(),
});

aiRoutes.post('/feedback', zValidator('json', feedbackSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    // Verify ownership: interaction must belong to this tenant + user
    const interaction = await db.$client.prepare(
      `SELECT id FROM ai_interactions WHERE id = ? AND tenant_id = ? AND user_id = ?`,
    ).bind(data.interactionId, tenantId, userId).first<{ id: number }>();

    if (!interaction) {
      throw new HTTPException(404, { message: 'Interaction not found' });
    }

    await recordFeedback(
      c.env,
      tenantId,
      data.interactionId,
      data.action as UserAction,
      data.modification,
    );
    return c.json({ success: true, message: 'Feedback recorded. AI will learn from this.' });
  } catch (err) {
    handleAIError(err);
  }
});

// ─── Patient Summary Helpers ────────────────────────────────────────

interface PatientSummaryDemographics {
  id: number;
  date_of_birth?: string | null;
  gender?: string | null;
}

interface PatientSummaryAllergy {
  allergen?: string | null;
  reaction?: string | null;
  severity?: string | null;
}

interface PatientSummaryVital {
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  heart_rate?: number | null;
}

interface PatientSummaryLab {
  test_name?: string | null;
  result?: string | null;
  flag?: string | null;
}

interface PatientSummaryData {
  patient: PatientSummaryDemographics;
  allergies: PatientSummaryAllergy[];
  vitals: PatientSummaryVital[];
  medications: Array<{ drug_name?: string | null }>;
  labs: PatientSummaryLab[];
}

interface GeneratedPatientSummary {
  summary: string;
  fallback: boolean;
  model: string | null;
}

async function gatherPatientData(db: ReturnType<typeof getDb>, patientId: number, tenantId: string): Promise<PatientSummaryData> {
  // Get patient demographics
  const patient = await db.$client.prepare(`
    SELECT id, date_of_birth, gender
    FROM patients WHERE id = ? AND tenant_id = ?
  `).bind(patientId, tenantId).first<PatientSummaryDemographics>();

  if (!patient) {
    throw new HTTPException(404, { message: 'Patient not found' });
  }

  // Get allergies
  const { results: allergies } = await db.$client.prepare(`
    SELECT allergen, reaction, severity FROM allergies 
    WHERE patient_id = ? AND tenant_id = ?
    ORDER BY created_at DESC LIMIT 10
  `).bind(patientId, tenantId).all<PatientSummaryAllergy>();

  // Get recent vitals
  const { results: vitals } = await db.$client.prepare(`
    SELECT bp_systolic, bp_diastolic, heart_rate FROM vitals
    WHERE patient_id = ? AND tenant_id = ? 
    ORDER BY measured_at DESC LIMIT 5
  `).bind(patientId, tenantId).all<PatientSummaryVital>();

  // Get active medications
  const { results: medications } = await db.$client.prepare(`
    SELECT p.rx_no, p.status, md.name as drug_name 
    FROM prescriptions p 
    JOIN master_drugs md ON p.drug_id = md.id 
    WHERE p.patient_id = ? AND p.tenant_id = ? AND p.status = 'active'
    ORDER BY p.created_at DESC LIMIT 10
  `).bind(patientId, tenantId).all<{ drug_name?: string | null }>();

  // Get recent lab results (critical ones first)
  const { results: labs } = await db.$client.prepare(`
    SELECT test_name, result, flag, test_date FROM lab_results 
    WHERE patient_id = ? AND tenant_id = ?
      AND COALESCE(result_status, '') <> 'retracted'
    ORDER BY 
      CASE WHEN flag IN ('high', 'low') THEN 1 ELSE 2 END,
      test_date DESC 
    LIMIT 10
  `).bind(patientId, tenantId).all<PatientSummaryLab>();

  return { patient, allergies, vitals, medications, labs };
}

function ageFromDateOfBirth(dateOfBirth?: string | null): number | null {
  if (!dateOfBirth) return null;
  const birthDate = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(birthDate.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < birthDate.getUTCMonth()
    || (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

async function generatePatientSummary(env: Env, data: PatientSummaryData): Promise<GeneratedPatientSummary> {
  const latestVital = data.vitals[0];
  const abnormalLabs = data.labs.filter((lab) => lab.flag === 'high' || lab.flag === 'low');
  const age = ageFromDateOfBirth(data.patient.date_of_birth);
  const prompt = `Generate a concise clinical overview from this de-identified context:
- Age: ${age ?? 'unknown'}
- Gender: ${data.patient.gender ?? 'unknown'}
- Recorded allergies: ${data.allergies.length}${data.allergies.length ? ` (${data.allergies.map((allergy) => allergy.allergen ?? 'unspecified').join(', ')})` : ''}
- Latest vitals: BP ${latestVital?.bp_systolic ?? 'N/A'}/${latestVital?.bp_diastolic ?? 'N/A'}, HR ${latestVital?.heart_rate ?? 'N/A'}
- Active medication count: ${data.medications.length}
- Recent abnormal lab count: ${abnormalLabs.length}

Do not provide medical advice or diagnosis.`;

  const { apiKey, model } = getConfig(env);
  try {
    const aiResult = await callAIJson<{ summary?: string }>(apiKey, [
      { role: 'system', content: SYSTEM_PROMPTS.patientSummary },
      { role: 'user', content: prompt },
    ], { model });
    const summary = aiResult.data.summary?.trim();
    if (!summary) throw new AIError('AI returned an empty patient summary', 502);
    return { summary, fallback: false, model };
  } catch (error) {
    console.error('[ai-patient-summary] external generation failed', error);
    return {
      summary: [
        `• Patient has ${data.allergies.length} recorded allergies`,
        `• Latest vitals: BP ${latestVital?.bp_systolic ?? 'N/A'}/${latestVital?.bp_diastolic ?? 'N/A'}`,
        `• ${data.medications.length} active prescriptions`,
        `• Recent labs: ${abnormalLabs.length} abnormal results`,
      ].join('\n'),
      fallback: true,
      model: null,
    };
  }
}

// ─── Patient Summary Route ─────────────────────────────────────────

aiRoutes.get(
  '/patient-summary/:patientId',
  requireRole('hospital_admin', 'md', 'director', 'doctor', 'nurse'),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    requireUserId(c);
    const patientId = Number(c.req.param('patientId'));

    if (!Number.isInteger(patientId) || patientId <= 0) {
      throw new HTTPException(400, { message: 'Invalid patient ID' });
    }

    // Check if AI addon is enabled
    const tenant = await db.$client.prepare('SELECT addons, ai_enabled FROM tenants WHERE id = ?')
      .bind(tenantId).first<{ addons: string; ai_enabled: number }>();
    let addons: string[] = [];
    try { addons = JSON.parse(tenant?.addons || '[]'); } catch {}
    const hasAiAddon = addons.includes('ai-summary') || tenant?.ai_enabled === 1;
    if (!hasAiAddon) {
      throw new HTTPException(402, { message: 'AI feature not enabled' });
    }

    try {
      // Check cache first (valid for 24 hours)
      const cached = await db.$client.prepare(`
      SELECT summary, generated_at, model_used FROM ai_patient_summaries
      WHERE patient_id = ? AND tenant_id = ?
      AND datetime(generated_at) > datetime('now', '-1 day')
      ORDER BY generated_at DESC LIMIT 1
    `).bind(patientId, tenantId).first<{ summary: string; generated_at: string; model_used: string | null }>();

      if (cached) {
        return c.json({
          summary: cached.summary,
          cached: true,
          generated_at: cached.generated_at,
          fallback: false,
          model: cached.model_used,
        });
      }

      // Gather patient data
      const patientData = await gatherPatientData(db, patientId, tenantId);

      // Generate AI summary
      const generated = await generatePatientSummary(c.env, patientData);

      if (!generated.fallback && generated.model) {
        await db.$client.prepare(`
        INSERT INTO ai_patient_summaries (tenant_id, patient_id, summary, model_used)
        VALUES (?, ?, ?, ?)
      `).bind(tenantId, patientId, generated.summary, generated.model).run();
      }

      return c.json({ ...generated, cached: false });
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      console.error('[ai-patient-summary]', error);
      throw new HTTPException(500, { message: 'Failed to generate summary' });
    }
  },
);

export default aiRoutes;
