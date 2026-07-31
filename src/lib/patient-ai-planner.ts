import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../types';
import { buildPortableHealthSummary } from './health-summary';
import { callAIJson, callOllamaCloudJson, callWorkersAIJson, type ChatMessage } from './ai';
import { patientAiPlanSchema, type PatientAiPlan } from '../schemas/patientAiPlanner';
import { getCurrentAuthIdentity, resolvePatientLinksForIdentity } from './family-graph';

export interface PatientAiPlannerSnapshot {
  identity: {
    global_user_id: number;
    uhid: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  linked_hospitals: Array<{
    tenant_id: string;
    patient_id: number;
  }>;
  summaries: unknown[];
  vault_documents: unknown[];
  reported_data: unknown[];
  adverse_reactions: unknown[];
  lifestyle_logs: unknown[];
  vitals: unknown[];
  wellness_tracker?: {
    medication_reminders: string[];
    daily_routines: string[];
    completed_items_today: string[];
    adherence_percent_today: number;
    tracker_date: string | null;
  };
}

export interface SavedPatientAiPlanRow {
  id: number;
  headline: string;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  created_at: string;
  plan_json: string;
  source_snapshot_json?: string | null;
}

export interface PatientAiPlanProgressRow {
  plan_id: number;
  completed_items_json: string;
}

const DEFAULT_PATIENT_AI_MODEL = '@cf/moonshotai/kimi-k2.5';
const DEFAULT_PATIENT_AI_FALLBACK_MODEL = 'glm-5.1:cloud';
const LOCAL_FOOD_HINTS = [
  'rice (bhat) in controlled portions',
  'dal',
  'atta roti',
  'local fish',
  'egg',
  'chicken',
  'seasonal vegetables',
  'shak',
  'lau',
  'papaya',
  'guava',
  'unsweetened doi',
  'chola',
];

const WESTERN_FOOD_BIAS = [
  'quinoa',
  'kale',
  'avocado toast',
  'turkey bacon',
  'blueberries',
  'granola bar',
  'protein shake',
];

function limitItems<T>(items: T[], max: number): T[] {
  return items.slice(0, max);
}

export async function buildPatientAiPlannerSnapshot(
  env: Env,
  db: D1Database,
  globalUserId: number,
): Promise<PatientAiPlannerSnapshot> {
  const authIdentity = await getCurrentAuthIdentity(db, globalUserId);
  const links = await resolvePatientLinksForIdentity(db, {
    uhid: authIdentity.uhid,
    primaryPhone: authIdentity.phone,
    primaryEmail: authIdentity.email,
  });

  const summaries = await Promise.all(
    links.map(async (link) => {
      try {
        return await buildPortableHealthSummary(db, link.tenantId, link.patientId);
      } catch {
        return null;
      }
    }),
  );

  const [vaultDocuments, reportedData, adverseReactions, lifestyleLogs, vitals, wellnessPreferences, wellnessProgress] = await Promise.all([
    authIdentity.uhid
      ? db.prepare(`SELECT id, title, document_type, document_date, entered_at FROM global_patient_vault_documents WHERE uhid = ? ORDER BY entered_at DESC LIMIT 8`).bind(authIdentity.uhid).all()
      : Promise.resolve({ results: [] }),
    authIdentity.uhid
      ? db.prepare(`SELECT category, name, severity, clinical_status, created_at FROM global_patient_reported_data WHERE uhid = ? ORDER BY created_at DESC LIMIT 10`).bind(authIdentity.uhid).all()
      : Promise.resolve({ results: [] }),
    authIdentity.uhid
      ? db.prepare(`SELECT medication_name, reaction, severity, onset_date, created_at FROM global_patient_adverse_reactions WHERE uhid = ? ORDER BY created_at DESC LIMIT 8`).bind(authIdentity.uhid).all()
      : Promise.resolve({ results: [] }),
    authIdentity.uhid
      ? db.prepare(`SELECT logged_on, sleep_hours, exercise_minutes, mood, energy_level, symptom_score, symptoms, diet_notes FROM global_patient_lifestyle_logs WHERE uhid = ? ORDER BY logged_on DESC, created_at DESC LIMIT 7`).bind(authIdentity.uhid).all()
      : Promise.resolve({ results: [] }),
    authIdentity.uhid
      ? db.prepare(`SELECT logged_on, systolic, diastolic, heart_rate, blood_sugar, blood_sugar_context, notes FROM global_patient_vitals WHERE uhid = ? ORDER BY logged_on DESC, created_at DESC LIMIT 7`).bind(authIdentity.uhid).all()
      : Promise.resolve({ results: [] }),
    db.prepare(`SELECT medication_reminders_json, daily_routines_json FROM patient_wellness_preferences WHERE global_user_id = ? LIMIT 1`).bind(globalUserId).first<{ medication_reminders_json: string | null; daily_routines_json: string | null }>().catch(() => null),
    db.prepare(`SELECT completed_items_json, tracker_date FROM patient_wellness_progress WHERE global_user_id = ? AND tracker_date = date('now') LIMIT 1`).bind(globalUserId).first<{ completed_items_json: string | null; tracker_date: string | null }>().catch(() => null),
  ]);

  const parseStringArray = (value: string | null | undefined) => {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const medicationReminders = parseStringArray(wellnessPreferences?.medication_reminders_json);
  const dailyRoutines = parseStringArray(wellnessPreferences?.daily_routines_json);
  const completedItemsToday = parseStringArray(wellnessProgress?.completed_items_json);
  const totalTrackerItems = new Set([...medicationReminders, ...dailyRoutines]).size;
  const adherencePercentToday = totalTrackerItems > 0
    ? Math.round((completedItemsToday.length / totalTrackerItems) * 100)
    : 0;

  return {
    identity: {
      global_user_id: globalUserId,
      uhid: authIdentity.uhid,
      name: authIdentity.name,
      email: authIdentity.email,
      phone: authIdentity.phone,
    },
    linked_hospitals: links.map((link) => ({ tenant_id: link.tenantId, patient_id: link.patientId })),
    summaries: limitItems(summaries.filter(Boolean), 3),
    vault_documents: limitItems(vaultDocuments.results ?? [], 8),
    reported_data: limitItems(reportedData.results ?? [], 10),
    adverse_reactions: limitItems(adverseReactions.results ?? [], 8),
    lifestyle_logs: limitItems(lifestyleLogs.results ?? [], 7),
    vitals: limitItems(vitals.results ?? [], 7),
    wellness_tracker: {
      medication_reminders: medicationReminders.slice(0, 8),
      daily_routines: dailyRoutines.slice(0, 8),
      completed_items_today: completedItemsToday.slice(0, 16),
      adherence_percent_today: adherencePercentToday,
      tracker_date: wellnessProgress?.tracker_date ?? null,
    },
  };
}

export function buildPatientAiPlannerMessages(snapshot: PatientAiPlannerSnapshot): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are a patient-facing health guidance assistant for Ozzyl Health.
You must provide only basic wellness and health-support guidance.
You are NOT a doctor and must never diagnose diseases or tell the patient to stop prescribed medicines.
Use plain, patient-friendly language that fits Bangladesh. Prefer locally available and affordable foods and routines.
Food and lifestyle guidance MUST be Bangladesh-centric:
- Prefer foods commonly available in Bangladesh such as rice (bhat), dal, atta roti, local fish, egg, chicken, shak, lau, seasonal vegetables, papaya, guava, doi, chola.
- Avoid suggesting expensive or uncommon western foods like quinoa, kale smoothies, turkey bacon, or imported berries unless clearly marked optional.
- When giving meal ideas, think in realistic Bangladeshi patterns: breakfast, lunch, বিকেলের snack/evening snack, dinner, hydration, tea habits, salt, sweets, bakery snacks, chanachur, sugary drinks.
Keep the guidance practical for normal households, not gym-only or luxury diets.
Use the wellness tracker when present. If the patient is not following the saved routine, simplify the next plan instead of making it heavier.
Always include a disclaimer that the patient should consult a doctor for diagnosis or treatment.

Respond ONLY in valid JSON with this structure:
{
  "headline": "",
  "summary": "",
  "focus_areas": [""],
  "action_checklist": [""],
  "eat_more": [""],
  "avoid_or_reduce": [""],
  "daily_routine": [""],
  "exercise_plan": [""],
  "follow_up_actions": [""],
  "warning_signs": [""],
  "doctor_consultation_advice": [""],
  "disclaimer": "",
  "confidence": "low|medium|high",
  "data_gaps": [""]
}`,
    },
    {
      role: 'user',
      content: `Generate a structured patient care plan from this record snapshot:
${JSON.stringify(snapshot)}`,
    },
  ];
}

export function buildPatientAiPlannerRefinementMessages(
  snapshot: PatientAiPlannerSnapshot,
  currentPlan: PatientAiPlan,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are a patient-facing health guidance assistant for Ozzyl Health.
You must refine an existing basic wellness plan using the latest record snapshot.
You are NOT a doctor and must never diagnose diseases or tell the patient to stop prescribed medicines.
Keep the improved plan practical, more structured, and easier to follow than before.
The food and routine advice MUST stay Bangladesh-centric, affordable, and realistic for foods found in Bangladesh.
Prefer local foods such as rice (bhat), dal, atta roti, local fish, egg, chicken, shak, lau, seasonal vegetables, papaya, guava, doi, chola.
Avoid generic western meal plans unless there is no local equivalent.
Use the wellness tracker when present. If adherence is low, simplify the plan and reduce overload.
Always include a disclaimer that the patient should consult a doctor for diagnosis or treatment.

Respond ONLY in valid JSON with this structure:
{
  "headline": "",
  "summary": "",
  "focus_areas": [""],
  "action_checklist": [""],
  "eat_more": [""],
  "avoid_or_reduce": [""],
  "daily_routine": [""],
  "exercise_plan": [""],
  "follow_up_actions": [""],
  "warning_signs": [""],
  "doctor_consultation_advice": [""],
  "disclaimer": "",
  "confidence": "low|medium|high",
  "data_gaps": [""]
}`,
    },
    {
      role: 'user',
      content: `Refine this existing patient care plan using the latest health record snapshot.

Current plan:
${JSON.stringify(currentPlan)}

Latest record snapshot:
${JSON.stringify(snapshot)}`,
    },
  ];
}

export function buildPatientWellnessSeedFromPlan(plan: PatientAiPlan): {
  medicationReminders: string[];
  dailyRoutines: string[];
} {
  const normalize = (items: string[]) => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

  const medicationReminders = normalize(
    [
      ...((plan.follow_up_actions ?? []).filter((item) => /medicine|tablet|capsule|dose|after breakfast|after dinner|before food|after food/i.test(item))),
      ...((plan.action_checklist ?? []).filter((item) => /medicine|tablet|capsule|dose|after breakfast|after dinner|before food|after food/i.test(item))),
    ],
  ).slice(0, 5);

  const dailyRoutines = normalize([
    ...(plan.daily_routine ?? []),
    ...(plan.exercise_plan ?? []),
    ...((plan.action_checklist ?? []).filter((item) => !medicationReminders.includes(item))),
  ]).slice(0, 6);

  return {
    medicationReminders,
    dailyRoutines,
  };
}

function containsKeyword(items: string[], keywords: string[]): boolean {
  const text = items.join(' ').toLowerCase();
  return keywords.some((keyword) => text.includes(keyword));
}

function uniqueTrimmed(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function addIfMissing(items: string[], additions: string[]): string[] {
  return uniqueTrimmed([...items, ...additions]);
}

function localizePlanForBangladesh(plan: PatientAiPlan, snapshot: PatientAiPlannerSnapshot): PatientAiPlan {
  const latestVital = snapshot.vitals?.[0] as Record<string, unknown> | undefined;
  const latestLifestyle = snapshot.lifestyle_logs?.[0] as Record<string, unknown> | undefined;
  const signalText = [
    ...(plan.focus_areas ?? []),
    ...(plan.follow_up_actions ?? []),
    ...(plan.warning_signs ?? []),
    ...(plan.summary ? [plan.summary] : []),
  ].join(' ').toLowerCase();

  let eatMore = uniqueTrimmed(plan.eat_more ?? []);
  let avoid = uniqueTrimmed(plan.avoid_or_reduce ?? []);
  let routine = uniqueTrimmed(plan.daily_routine ?? []);
  let exercise = uniqueTrimmed(plan.exercise_plan ?? []);
  let checklist = uniqueTrimmed(plan.action_checklist ?? []);
  let followUp = uniqueTrimmed(plan.follow_up_actions ?? []);

  if (!containsKeyword(eatMore, LOCAL_FOOD_HINTS)) {
    eatMore = addIfMissing(eatMore, [
      'Build meals around dal, seasonal vegetables, and local fish or egg instead of relying on packaged snacks.',
      'Use rice (bhat) or atta roti in moderate portions with shak, lau, mixed vegetables, and protein.',
      'Choose affordable local options like papaya, guava, chola, or unsweetened doi when you need a lighter snack.',
    ]);
  }

  if (containsKeyword([...eatMore, ...avoid], WESTERN_FOOD_BIAS)) {
    avoid = addIfMissing(avoid, [
      'Do not depend on imported diet foods when a local option like dal, fish, egg, shak, or guava can do the same job.',
    ]);
  }

  if (!routine.some((item) => /tea|water|sleep|walk|meal/i.test(item))) {
    routine = addIfMissing(routine, [
      'Keep breakfast, lunch, and dinner at steady times, and avoid long gaps followed by very heavy meals.',
      'Limit sweet tea, bakery snacks, chanachur, and late-night heavy dinners during busy days.',
      'Drink enough water through the day, especially in hot weather or if you walk outside.',
    ]);
  }

  const bloodSugar = Number(latestVital?.blood_sugar ?? NaN);
  const systolic = Number(latestVital?.systolic ?? NaN);
  const diastolic = Number(latestVital?.diastolic ?? NaN);
  const exerciseMinutes = Number(latestLifestyle?.exercise_minutes ?? NaN);

  const hasSugarSignal = signalText.includes('sugar') || signalText.includes('diabetes') || Number.isFinite(bloodSugar);
  if (hasSugarSignal) {
    eatMore = addIfMissing(eatMore, [
      'If you eat rice, keep the portion controlled and pair it with dal, vegetables, and fish or egg to slow the meal down.',
    ]);
    avoid = addIfMissing(avoid, [
      'Cut down mishti, sweet tea, soft drinks, juice, and very large plates of white rice.',
    ]);
    checklist = addIfMissing(checklist, [
      'Reduce sweet tea, mishti, and sugary drinks this week.',
    ]);
  }

  const hasBPSignal = signalText.includes('pressure') || signalText.includes('bp') || (Number.isFinite(systolic) && Number.isFinite(diastolic));
  if (hasBPSignal) {
    eatMore = addIfMissing(eatMore, [
      'Pick lower-salt home meals with shak, lau, cucumber, dal, and fish more often than salty fast foods.',
    ]);
    avoid = addIfMissing(avoid, [
      'Reduce extra salt, achar, chanachur, instant noodles, and salty packaged snacks.',
    ]);
  }

  if (!Number.isNaN(exerciseMinutes) && exerciseMinutes < 20) {
    exercise = addIfMissing(exercise, [
      'Start with a 10 to 20 minute walk after lunch or dinner, then build up slowly.',
    ]);
    checklist = addIfMissing(checklist, [
      'Walk for 10 to 20 minutes after one meal each day.',
    ]);
  }

  followUp = addIfMissing(followUp, [
    'If symptoms get worse or the plan feels unrealistic, review it with a doctor and adjust based on real clinical advice.',
  ]);

  return {
    ...plan,
    eat_more: eatMore.slice(0, 6),
    avoid_or_reduce: avoid.slice(0, 6),
    daily_routine: routine.slice(0, 6),
    exercise_plan: exercise.slice(0, 6),
    action_checklist: checklist.slice(0, 6),
    follow_up_actions: followUp.slice(0, 6),
  };
}

async function generateStructuredPatientPlan(
  env: Env,
  snapshot: PatientAiPlannerSnapshot,
  messages: ChatMessage[],
): Promise<PatientAiPlan> {
  if (env.AI) {
    const { data } = await callWorkersAIJson<PatientAiPlan>(env.AI, messages, {
      model: env.PATIENT_AI_MODEL ?? DEFAULT_PATIENT_AI_MODEL,
      maxTokens: 1600,
      temperature: 0.2,
    });
    return localizePlanForBangladesh(patientAiPlanSchema.parse(data), snapshot);
  }

  if (env.OLLAMA_API_KEY) {
    const { data } = await callOllamaCloudJson<PatientAiPlan>(env.OLLAMA_API_KEY, messages, {
      model: env.PATIENT_AI_FALLBACK_MODEL ?? DEFAULT_PATIENT_AI_FALLBACK_MODEL,
      maxTokens: 1600,
      temperature: 0.2,
    });
    return localizePlanForBangladesh(patientAiPlanSchema.parse(data), snapshot);
  }

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('AI service not configured');
  }

  const { data } = await callAIJson<PatientAiPlan>(apiKey, messages, {
    model: env.PATIENT_AI_MODEL ?? env.AI_MODEL ?? 'openrouter/healer-alpha',
    maxTokens: 1600,
    temperature: 0.2,
  });

  return localizePlanForBangladesh(patientAiPlanSchema.parse(data), snapshot);
}

export async function generatePatientAiPlan(env: Env, snapshot: PatientAiPlannerSnapshot): Promise<PatientAiPlan> {
  return generateStructuredPatientPlan(env, snapshot, buildPatientAiPlannerMessages(snapshot));
}

export async function refinePatientAiPlan(
  env: Env,
  snapshot: PatientAiPlannerSnapshot,
  currentPlan: PatientAiPlan,
): Promise<PatientAiPlan> {
  return generateStructuredPatientPlan(
    env,
    snapshot,
    buildPatientAiPlannerRefinementMessages(snapshot, currentPlan),
  );
}

export function buildPatientAiActionChecklist(plan: Pick<PatientAiPlan, 'action_checklist' | 'daily_routine' | 'exercise_plan' | 'follow_up_actions'>): string[] {
  const explicitItems = (plan.action_checklist ?? []).map((item) => item.trim()).filter(Boolean);
  if (explicitItems.length > 0) {
    return Array.from(new Set(explicitItems)).slice(0, 6);
  }

  return Array.from(
    new Set([
      ...(plan.daily_routine ?? []),
      ...(plan.exercise_plan ?? []),
      ...(plan.follow_up_actions ?? []),
    ].map((item) => item.trim()).filter(Boolean)),
  ).slice(0, 6);
}

function parseCompletedItems(progressRow?: PatientAiPlanProgressRow | null): string[] {
  if (!progressRow?.completed_items_json) return [];
  try {
    const parsed = JSON.parse(progressRow.completed_items_json);
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseSourceSnapshot(snapshotJson?: string | null): PatientAiPlannerSnapshot | null {
  if (!snapshotJson) return null;
  try {
    return JSON.parse(snapshotJson) as PatientAiPlannerSnapshot;
  } catch {
    return null;
  }
}

export function parseSavedPatientAiPlan(row: SavedPatientAiPlanRow, progressRow?: PatientAiPlanProgressRow | null) {
  const plan = patientAiPlanSchema.parse(JSON.parse(row.plan_json));
  const checklist = buildPatientAiActionChecklist(plan);
  const completedItems = parseCompletedItems(progressRow).filter((item) => checklist.includes(item));
  const completionPercent = checklist.length > 0
    ? Math.round((completedItems.length / checklist.length) * 100)
    : 0;

  return {
    id: row.id,
    headline: row.headline,
    summary: row.summary,
    confidence: row.confidence,
    created_at: row.created_at,
    plan: {
      ...plan,
      action_checklist: checklist,
    },
    completed_items: completedItems,
    completion_percent: completionPercent,
    source_snapshot: parseSourceSnapshot(row.source_snapshot_json),
  };
}
