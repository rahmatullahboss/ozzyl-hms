/**
 * Wellness Routes (tenant-agnostic, global)
 *
 * Endpoints for OzzyLife wellness features:
 *   GET  /api/wellness/score              — get health score for a date
 *   GET  /api/wellness/streaks            — get all streaks for patient
 *   POST /api/wellness/streaks/log        — log a streak activity
 *   POST /api/wellness/logs/mood          — log mood entry
 *   POST /api/wellness/logs/sleep         — log sleep entry
 *   POST /api/wellness/logs/activity      — log activity entry
 *   POST /api/wellness/logs/water         — log water intake
 *   POST /api/wellness/logs/symptom       — log symptom entry
 *   POST /api/wellness/logs/batch         — daily check-in (writes all normalized logs + streak)
 *   GET  /api/wellness/insights           — get today's stored insights
 *   POST /api/wellness/insights/generate   — generate & store insights from recent data
 *   POST /api/wellness/insights/:id/read   — mark an insight as read
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { verify } from 'hono/jwt';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Env, Variables } from '../types';
import { calculateHealthScore, type SubScores } from '../lib/health-score';
import { generateInsights } from '../lib/daily-insights';
import { checkAchievements, ACHIEVEMENT_CATALOG } from '../lib/achievements';
import { scorePHQ9, scoreGAD7 } from '../lib/mental-health-scoring';

const VALID_GOAL_TYPES = ['steps', 'sleep_hours', 'water_glasses', 'exercise_minutes', 'weight_kg', 'meditation_minutes'] as const;
const VALID_GOAL_STATUSES = ['active', 'completed', 'abandoned'] as const;
const VALID_MOODS = ['great', 'good', 'okay', 'low', 'struggling'] as const;
const VALID_ACTIVITY_TYPES = ['walk', 'run', 'cycle', 'gym', 'yoga', 'namaz', 'housework', 'swim', 'other'] as const;
const VALID_SOURCES = ['manual', 'wearable'] as const;
const VALID_BS_CONTEXTS = ['fasting', 'post_prandial', 'random'] as const;

const moodLogSchema = z.object({
  mood: z.enum(VALID_MOODS),
  energy_level: z.number().int().min(1).max(10).optional(),
  note: z.string().max(2000).optional(),
  tags: z.string().max(500).optional(),
});

const sleepLogSchema = z.object({
  bedtime: z.string().optional(),
  wake_time: z.string().optional(),
  duration_min: z.number().int().min(0).max(1440).optional(),
  quality_rating: z.number().int().min(1).max(5).optional(),
  sleep_stages: z.string().max(500).optional(),
  source: z.enum(VALID_SOURCES).default('manual'),
});

const activityLogSchema = z.object({
  activity_type: z.enum(VALID_ACTIVITY_TYPES),
  duration_min: z.number().int().min(1).max(1440),
  calories_burned: z.number().int().min(0).optional(),
  steps: z.number().int().min(0).optional(),
  distance_m: z.number().min(0).optional(),
  source: z.enum(VALID_SOURCES).default('manual'),
  started_at: z.string().optional(),
  ended_at: z.string().optional(),
});

const waterLogSchema = z.object({
  amount_ml: z.number().int().min(1),
});

const symptomLogSchema = z.object({
  symptom: z.string().trim().min(1).max(500),
  severity: z.number().int().min(1).max(10).optional(),
  note: z.string().max(2000).optional(),
});

const vitalsLogSchema = z.object({
  systolic: z.number().int().min(50).max(250).optional(),
  diastolic: z.number().int().min(30).max(150).optional(),
  heart_rate: z.number().int().min(30).max(200).optional(),
  blood_sugar: z.number().min(2).max(40).optional(),
  blood_sugar_context: z.enum(VALID_BS_CONTEXTS).optional(),
  weight_kg: z.number().min(20).max(300).optional(),
  temperature_f: z.number().min(90).max(115).optional(),
  spo2: z.number().int().min(70).max(100).optional(),
}).superRefine((val, ctx) => {
  if (val.systolic != null && val.diastolic == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Diastolic is required if systolic is provided', path: ['diastolic'] });
  }
  if (val.diastolic != null && val.systolic == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Systolic is required if diastolic is provided', path: ['systolic'] });
  }
  if (val.blood_sugar != null && val.blood_sugar_context == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Context is required when blood sugar is provided', path: ['blood_sugar_context'] });
  }
});

const goalCreateSchema = z.object({
  goal_type: z.enum(VALID_GOAL_TYPES),
  target_value: z.number().positive(),
  unit: z.string().max(50).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  ai_suggested: z.boolean().optional(),
});

const goalUpdateSchema = z.object({
  status: z.enum(VALID_GOAL_STATUSES).optional(),
  current_value: z.number().min(0).optional(),
  target_value: z.number().positive().optional(),
  end_date: z.string().nullable().optional(),
});

const batchLogSchema = z.object({
  mood: z.enum(VALID_MOODS).optional(),
  energy_level: z.number().int().min(1).max(10).optional(),
  sleep_hours: z.number().min(0).max(24).optional(),
  sleep_quality: z.number().int().min(1).max(5).optional(),
  exercise_minutes: z.number().int().min(0).optional(),
  exercise_type: z.enum(VALID_ACTIVITY_TYPES).optional(),
  water_glasses: z.number().int().min(0).max(20).optional(),
  symptoms: z.string().max(2000).optional(),
  symptom_severity: z.number().int().min(1).max(10).optional(),
  notes: z.string().max(2000).optional(),
});

const wellnessRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Auth helper ──────────────────────────────────────────────────────
async function getPatientId(c: import('hono').Context<{ Bindings: Env; Variables: Variables }>): Promise<number> {
  const cookieToken = getCookie(c, 'phr_token');
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = cookieToken || bearerToken;

  if (!token) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }

  let decoded: { userId: string; scope: string };
  try {
    decoded = await verify(token, c.env.JWT_SECRET, 'HS256') as any;
  } catch {
    throw new HTTPException(401, { message: 'Invalid or expired token' });
  }

  if (decoded.scope !== 'global') {
    throw new HTTPException(403, { message: 'Invalid token scope' });
  }

  return parseInt(decoded.userId, 10);
}

// ─── GET /score ───────────────────────────────────────────────────────
wellnessRoutes.get('/score', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);

  // Check cached score first
  const cached = await db.prepare(
    'SELECT * FROM daily_health_score WHERE patient_id = ? AND date = ?',
  ).bind(patientId, date).first();

  if (cached) {
    return c.json({
      total: cached.total_score,
      breakdown: {
        sleep: cached.sleep_score,
        activity: cached.activity_score,
        nutrition: cached.nutrition_score,
        mood: cached.mood_score,
        medication: cached.medication_score,
        vitals: cached.vitals_score,
      },
      date,
    });
  }

  // Calculate from today's logs
  const subScores = await computeSubScores(db, patientId, date);
  const result = calculateHealthScore(subScores, false);

  // Upsert into daily_health_score
  await db.prepare(`
    INSERT INTO daily_health_score (patient_id, date, total_score, sleep_score, activity_score, nutrition_score, mood_score, medication_score, vitals_score, breakdown_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(patient_id, date) DO UPDATE SET
      total_score = excluded.total_score,
      sleep_score = excluded.sleep_score,
      activity_score = excluded.activity_score,
      nutrition_score = excluded.nutrition_score,
      mood_score = excluded.mood_score,
      medication_score = excluded.medication_score,
      vitals_score = excluded.vitals_score,
      breakdown_json = excluded.breakdown_json,
      calculated_at = datetime('now')
  `).bind(
    patientId, date, result.total,
    subScores.sleep, subScores.activity, subScores.nutrition,
    subScores.mood, subScores.medication, subScores.vitals,
    JSON.stringify(result.breakdown),
  ).run();

  return c.json({ total: result.total, breakdown: result.breakdown, label: result.label, color: result.color, date });
});

// ─── GET /score/trend ─────────────────────────────────────────────────
wellnessRoutes.get('/score/trend', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const days = parseInt(c.req.query('days') || '7', 10);

  const rows = await db.prepare(
    'SELECT date, total_score FROM daily_health_score WHERE patient_id = ? ORDER BY date DESC LIMIT ?',
  ).bind(patientId, days).all();

  return c.json({ trend: rows.results || [] });
});

// ─── GET /trends ──────────────────────────────────────────────────────
wellnessRoutes.get('/trends', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const days = parseInt(c.req.query('days') || '7', 10);

  const rows = await db.prepare(
    'SELECT date, total_score, breakdown_json FROM daily_health_score WHERE patient_id = ? ORDER BY date DESC LIMIT ?',
  ).bind(patientId, days).all();

  const trends = (rows.results || []).map((row: any) => ({
    date: row.date,
    overall: row.total_score,
    breakdown: row.breakdown_json ? JSON.parse(row.breakdown_json) : null
  }));

  // Ensure it's sorted chronologically ascending if UI expects standard chart behavior, 
  // but let's reverse it so it goes oldest -> newest for charts
  return c.json({ trends: trends.reverse() });
});

// ─── GET /streaks ─────────────────────────────────────────────────────
wellnessRoutes.get('/streaks', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;

  const rows = await db.prepare(
    'SELECT streak_type, current_count, longest_count, last_logged_date FROM streaks WHERE patient_id = ?',
  ).bind(patientId).all();

  return c.json({ streaks: rows.results || [] });
});

// ─── POST /streaks/log ────────────────────────────────────────────────
wellnessRoutes.post('/streaks/log', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const body = await c.req.json<{ streak_type: string }>();

  const validTypes = ['daily_checkin', 'food_log', 'activity', 'sleep_log', 'medication', 'water'];
  if (!validTypes.includes(body.streak_type)) {
    return c.json({ error: 'Invalid streak type' }, 400);
  }

  const today = new Date().toISOString().slice(0, 10);

  const existing = await db.prepare(
    'SELECT current_count, longest_count, last_logged_date FROM streaks WHERE patient_id = ? AND streak_type = ?',
  ).bind(patientId, body.streak_type).first() as any;

  if (existing) {
    // Already logged today
    if (existing.last_logged_date === today) {
      return c.json({ streak: existing });
    }

    // Check if consecutive (yesterday)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const isConsecutive = existing.last_logged_date === yesterdayStr;
    const newCount = isConsecutive ? existing.current_count + 1 : 1;
    const newLongest = Math.max(existing.longest_count, newCount);

    await db.prepare(`
      UPDATE streaks SET current_count = ?, longest_count = ?, last_logged_date = ?
      WHERE patient_id = ? AND streak_type = ?
    `).bind(newCount, newLongest, today, patientId, body.streak_type).run();

    return c.json({ streak: { streak_type: body.streak_type, current_count: newCount, longest_count: newLongest, last_logged_date: today } });
  }

  // First time
  await db.prepare(`
    INSERT INTO streaks (patient_id, streak_type, current_count, longest_count, last_logged_date)
    VALUES (?, ?, 1, 1, ?)
  `).bind(patientId, body.streak_type, today).run();

  return c.json({ streak: { streak_type: body.streak_type, current_count: 1, longest_count: 1, last_logged_date: today } });
});

// ─── POST /logs/mood ─────────────────────────────────────────────────
wellnessRoutes.post('/logs/mood', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = moodLogSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid mood log data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const result = await c.env.DB.prepare(
    'INSERT INTO mood_log (patient_id, mood, energy_level, note, tags) VALUES (?, ?, ?, ?, ?)',
  ).bind(patientId, d.mood, d.energy_level ?? null, d.note ?? null, d.tags ?? null).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

// ─── GET /logs/sleep ─────────────────────────────────────────────────
wellnessRoutes.get('/logs/sleep', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const days = parseInt(c.req.query('days') || '7', 10);

  const rows = await db.prepare(
    'SELECT id, bedtime, wake_time, duration_min, quality_rating, sleep_stages, source, logged_at FROM sleep_log WHERE patient_id = ? ORDER BY logged_at DESC LIMIT ?',
  ).bind(patientId, days).all();

  return c.json({ logs: rows.results || [] });
});

// ─── POST /logs/sleep ────────────────────────────────────────────────
wellnessRoutes.post('/logs/sleep', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = sleepLogSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid sleep log data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const result = await c.env.DB.prepare(
    'INSERT INTO sleep_log (patient_id, bedtime, wake_time, duration_min, quality_rating, sleep_stages, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(patientId, d.bedtime ?? null, d.wake_time ?? null, d.duration_min ?? null, d.quality_rating ?? null, d.sleep_stages ?? null, d.source).run();

  const newAchievements = await checkAchievements(c.env.DB, patientId, { justLoggedSleep: true });

  return c.json({ success: true, id: result.meta.last_row_id, new_achievements: newAchievements }, 201);
});

// ─── GET /logs/activity ───────────────────────────────────────────────
wellnessRoutes.get('/logs/activity', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);

  const rows = await db.prepare(
    'SELECT id, activity_type, duration_min, calories_burned, steps, distance_m, source, started_at, ended_at, logged_at FROM activity_log WHERE patient_id = ? AND DATE(logged_at) = ? ORDER BY logged_at DESC',
  ).bind(patientId, date).all();

  return c.json({ logs: rows.results || [] });
});

// ─── POST /logs/activity ─────────────────────────────────────────────
wellnessRoutes.post('/logs/activity', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = activityLogSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid activity log data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const result = await c.env.DB.prepare(
    'INSERT INTO activity_log (patient_id, activity_type, duration_min, calories_burned, steps, distance_m, source, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(patientId, d.activity_type, d.duration_min, d.calories_burned ?? null, d.steps ?? null, d.distance_m ?? null, d.source, d.started_at ?? null, d.ended_at ?? null).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

// ─── POST /logs/water ────────────────────────────────────────────────
wellnessRoutes.post('/logs/water', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = waterLogSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid water log data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const result = await c.env.DB.prepare(
    'INSERT INTO water_log (patient_id, amount_ml) VALUES (?, ?)',
  ).bind(patientId, d.amount_ml).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

// ─── POST /logs/symptom ──────────────────────────────────────────────
wellnessRoutes.post('/logs/symptom', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = symptomLogSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid symptom log data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const result = await c.env.DB.prepare(
    'INSERT INTO symptom_log (patient_id, symptom, severity, note) VALUES (?, ?, ?, ?)',
  ).bind(patientId, d.symptom, d.severity ?? null, d.note ?? null).run();

  return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

// ─── POST /logs/batch (daily check-in) ───────────────────────────────
wellnessRoutes.post('/logs/batch', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = batchLogSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid batch log data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const db = c.env.DB;
  let logsCreated = 0;

  if (d.mood) {
    await db.prepare(
      'INSERT INTO mood_log (patient_id, mood, energy_level, note) VALUES (?, ?, ?, ?)',
    ).bind(patientId, d.mood, d.energy_level ?? null, d.notes ?? null).run();
    logsCreated++;
  }

  if (d.sleep_hours != null) {
    const durationMin = Math.round(d.sleep_hours * 60);
    await db.prepare(
      'INSERT INTO sleep_log (patient_id, duration_min, quality_rating, source) VALUES (?, ?, ?, ?)',
    ).bind(patientId, durationMin, d.sleep_quality ?? null, 'manual').run();
    logsCreated++;
  }

  if (d.exercise_minutes != null && d.exercise_minutes > 0) {
    await db.prepare(
      'INSERT INTO activity_log (patient_id, activity_type, duration_min, source) VALUES (?, ?, ?, ?)',
    ).bind(patientId, d.exercise_type ?? 'walk', d.exercise_minutes, 'manual').run();
    logsCreated++;
  }

  if (d.water_glasses != null && d.water_glasses > 0) {
    const amountMl = d.water_glasses * 250;
    await db.prepare(
      'INSERT INTO water_log (patient_id, amount_ml) VALUES (?, ?)',
    ).bind(patientId, amountMl).run();
    logsCreated++;
  }

  if (d.symptoms) {
    await db.prepare(
      'INSERT INTO symptom_log (patient_id, symptom, severity) VALUES (?, ?, ?)',
    ).bind(patientId, d.symptoms, d.symptom_severity ?? null).run();
    logsCreated++;
  }

  const today = new Date().toISOString().slice(0, 10);

  const existingStreak = await db.prepare(
    'SELECT current_count, longest_count, last_logged_date FROM streaks WHERE patient_id = ? AND streak_type = ?',
  ).bind(patientId, 'daily_checkin').first() as any;

  let streak: { streak_type: string; current_count: number; longest_count: number; last_logged_date: string };

  if (existingStreak) {
    if (existingStreak.last_logged_date === today) {
      streak = { streak_type: 'daily_checkin', current_count: existingStreak.current_count, longest_count: existingStreak.longest_count, last_logged_date: today };
    } else {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);
      const isConsecutive = existingStreak.last_logged_date === yesterdayStr;
      const newCount = isConsecutive ? existingStreak.current_count + 1 : 1;
      const newLongest = Math.max(existingStreak.longest_count, newCount);
      await db.prepare(
        'UPDATE streaks SET current_count = ?, longest_count = ?, last_logged_date = ? WHERE patient_id = ? AND streak_type = ?',
      ).bind(newCount, newLongest, today, patientId, 'daily_checkin').run();
      streak = { streak_type: 'daily_checkin', current_count: newCount, longest_count: newLongest, last_logged_date: today };
    }
  } else {
    await db.prepare(
      'INSERT INTO streaks (patient_id, streak_type, current_count, longest_count, last_logged_date) VALUES (?, ?, 1, 1, ?)',
    ).bind(patientId, 'daily_checkin', today).run();
    streak = { streak_type: 'daily_checkin', current_count: 1, longest_count: 1, last_logged_date: today };
  }

  const newAchievements = await checkAchievements(db, patientId, {
    justCheckedIn: true,
    justLoggedFood: false,
    justLoggedSleep: d.sleep_hours != null,
    justSetGoal: false,
  });

  return c.json({ success: true, logs_created: logsCreated, streak, new_achievements: newAchievements }, 201);
});

// ─── Vitals classification helpers ─────────────────────────────────────
function classifyBP(systolic: number, diastolic: number): string {
  if (systolic <= 120 && diastolic <= 80) return 'normal';
  if (systolic <= 139 && diastolic <= 89) return 'elevated';
  if (systolic <= 159 && diastolic <= 99) return 'high_stage1';
  return 'high_stage2';
}

function classifyBloodSugar(mmol: number, context: string): string {
  if (context === 'fasting') return mmol <= 5.6 ? 'normal' : 'high';
  if (context === 'post_prandial') return mmol <= 7.8 ? 'normal' : 'high';
  return mmol <= 7.8 ? 'normal' : 'high';
}

function classifySpO2(spo2: number): string {
  if (spo2 >= 95) return 'normal';
  if (spo2 >= 92) return 'low_normal';
  return 'low_oxygen';
}

function classifyTemperature(tempF: number): string {
  if (tempF <= 99.5) return 'normal';
  if (tempF <= 100.4) return 'low_grade_fever';
  return 'fever';
}

function buildVitalsAlert(classification: Record<string, string | undefined>): { type: string; severity: string; message: string; disclaimer: string } | null {
  const alerts: { type: string; severity: string; message: string }[] = [];

  if (classification.bp === 'high_stage2' || classification.bp === 'hypertensive_crisis') {
    const isCrisis = classification.bp === 'hypertensive_crisis';
    alerts.push({
      type: isCrisis ? 'hypertensive_crisis' : 'high_blood_pressure',
      severity: isCrisis ? 'critical' : 'warning',
      message: isCrisis ? 'Blood pressure is dangerously high. Seek medical attention.' : 'Blood pressure is elevated. Consider consulting your doctor.',
    });
  }

  if (classification.blood_sugar === 'high') {
    alerts.push({
      type: 'high_blood_sugar',
      severity: 'warning',
      message: 'Blood sugar reading is above the normal range.',
    });
  }

  if (classification.spo2 === 'low_oxygen') {
    alerts.push({
      type: 'low_oxygen',
      severity: 'critical',
      message: 'Oxygen saturation is below safe levels. Seek medical attention.',
    });
  }

  if (classification.temperature === 'fever') {
    alerts.push({
      type: 'fever',
      severity: 'warning',
      message: 'Temperature indicates fever. Monitor closely.',
    });
  }

  if (alerts.length === 0) return null;

  const primary = alerts.find(a => a.severity === 'critical') || alerts[0];
  return {
    ...primary,
    disclaimer: 'This is not a diagnosis. Please consult a healthcare professional for medical advice.',
  };
}

// ─── POST /vitals ────────────────────────────────────────────────────
wellnessRoutes.post('/vitals', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = vitalsLogSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid vitals data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;

  const classification: Record<string, string | undefined> = {};

  if (d.systolic != null && d.diastolic != null) {
    if (d.systolic > 180 || d.diastolic > 120) {
      classification.bp = 'hypertensive_crisis';
    } else {
      classification.bp = classifyBP(d.systolic, d.diastolic);
    }
  }

  if (d.blood_sugar != null && d.blood_sugar_context) {
    classification.blood_sugar = classifyBloodSugar(d.blood_sugar, d.blood_sugar_context);
  }

  if (d.spo2 != null) {
    classification.spo2 = classifySpO2(d.spo2);
  }

  if (d.temperature_f != null) {
    classification.temperature = classifyTemperature(d.temperature_f);
  }

  if (d.weight_kg != null) {
    classification.weight = 'logged';
  }

  const alert = buildVitalsAlert(classification);

  const result = await c.env.DB.prepare(
    'INSERT INTO global_patient_vitals (patient_id, systolic, diastolic, heart_rate, blood_sugar, blood_sugar_context, weight_kg, temperature_f, spo2, classification_json, alert_json, logged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime("now"))',
  ).bind(
    patientId,
    d.systolic ?? null,
    d.diastolic ?? null,
    d.heart_rate ?? null,
    d.blood_sugar ?? null,
    d.blood_sugar_context ?? null,
    d.weight_kg ?? null,
    d.temperature_f ?? null,
    d.spo2 ?? null,
    JSON.stringify(classification),
    alert ? JSON.stringify(alert) : null,
  ).run();

  return c.json({
    success: true,
    id: result.meta.last_row_id,
    classification,
    alert,
  }, 201);
});

// ─── Sub-score computation from raw logs ──────────────────────────────
async function computeSubScores(db: any, patientId: number, date: string): Promise<SubScores> {
  // Get normalized logs for the date
  const moodLog = await db.prepare('SELECT mood, energy_level FROM mood_log WHERE patient_id = ? AND DATE(logged_at) = ? ORDER BY logged_at DESC LIMIT 1').bind(patientId, date).first() as any;
  const sleepLog = await db.prepare('SELECT duration_min FROM sleep_log WHERE patient_id = ? AND DATE(logged_at) = ? ORDER BY logged_at DESC LIMIT 1').bind(patientId, date).first() as any;
  const activityLog = await db.prepare('SELECT SUM(duration_min) as total_min FROM activity_log WHERE patient_id = ? AND DATE(logged_at) = ?').bind(patientId, date).first() as any;
  const waterLog = await db.prepare('SELECT SUM(amount_ml) as total_ml FROM water_log WHERE patient_id = ? AND DATE(logged_at) = ?').bind(patientId, date).first() as any;

  const scores: SubScores = {
    sleep: 0,
    activity: 0,
    nutrition: 0,
    mood: 0,
    medication: 0,
    vitals: 0,
  };

  // Sleep score: 7-9h (420-540m) = 100
  if (sleepLog?.duration_min != null) {
    const hours = sleepLog.duration_min / 60;
    if (hours >= 7 && hours <= 9) {
      scores.sleep = 100;
    } else if (hours >= 5 && hours < 7) {
      scores.sleep = Math.round(((hours - 5) / 2) * 100);
    } else if (hours > 9 && hours <= 11) {
      scores.sleep = Math.round(((11 - hours) / 2) * 100);
    }
  }

  // Activity score: 30+ min = 100, 0 = 0, linear
  if (activityLog?.total_min != null && activityLog.total_min > 0) {
    scores.activity = Math.min(100, Math.round((activityLog.total_min / 30) * 100));
  } else {
    scores.activity = 0;
  }

  // Nutrition score (based on water for now)
  if (waterLog?.total_ml != null && waterLog.total_ml > 0) {
    scores.nutrition = Math.min(100, Math.round((waterLog.total_ml / 2000) * 100));
  }

  // Mood score: map mood text to number
  const moodMap: Record<string, number> = {
    excellent: 100, great: 100,
    good: 80,
    okay: 60,
    bad: 30, low: 30,
    terrible: 10, struggling: 10,
  };
  if (moodLog?.mood) {
    scores.mood = moodMap[moodLog.mood.toLowerCase()] ?? 50;
  }

  // Energy as activity bonus
  if (moodLog?.energy_level != null) {
    scores.activity = Math.min(100, Math.round((scores.activity + (moodLog.energy_level * 10)) / 2));
  }

  return scores;
}

// ─── GET /insights ────────────────────────────────────────────────────
wellnessRoutes.get('/insights', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const today = new Date().toISOString().slice(0, 10);

  const rows = await db.prepare(
    'SELECT id, insight_type, content, severity, read, created_at FROM ai_insights WHERE patient_id = ? AND DATE(created_at) = ? ORDER BY created_at DESC',
  ).bind(patientId, today).all();

  const insights = (rows.results || []).map((r: any) => {
    let parsed = r.content;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { parsed = { body: parsed }; }
    }
    return {
      id: r.id,
      type: r.insight_type,
      severity: r.severity,
      read: !!r.read,
      ...parsed,
    };
  });

  return c.json({ insights });
});

// ─── POST /insights/generate ──────────────────────────────────────────
wellnessRoutes.post('/insights/generate', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const today = new Date().toISOString().slice(0, 10);

  // Gather today's data from normalized wellness tables
  const sleepRow = await db.prepare(
    'SELECT duration_min, quality_rating FROM sleep_log WHERE patient_id = ? ORDER BY logged_at DESC LIMIT 1',
  ).bind(patientId).first() as any;

  const activityRow = await db.prepare(
    'SELECT SUM(duration_min) as total_min FROM activity_log WHERE patient_id = ? AND DATE(logged_at) = ?',
  ).bind(patientId, today).first() as any;

  const moodRow = await db.prepare(
    'SELECT mood FROM mood_log WHERE patient_id = ? ORDER BY logged_at DESC LIMIT 1',
  ).bind(patientId).first() as any;

  const waterRow = await db.prepare(
    'SELECT SUM(amount_ml) as total_ml FROM water_log WHERE patient_id = ? AND DATE(logged_at) = ?',
  ).bind(patientId, today).first() as any;

  const scoreRow = await db.prepare(
    'SELECT total_score FROM daily_health_score WHERE patient_id = ? ORDER BY date DESC LIMIT 1',
  ).bind(patientId).first() as any;

  const recentScores = await db.prepare(
    'SELECT total_score, mood FROM daily_health_score LEFT JOIN mood_log ON daily_health_score.patient_id = mood_log.patient_id WHERE daily_health_score.patient_id = ? ORDER BY date DESC LIMIT 7',
  ).bind(patientId).all() as any;

  const recentMoods = await db.prepare(
    'SELECT mood FROM mood_log WHERE patient_id = ? ORDER BY logged_at DESC LIMIT 7',
  ).bind(patientId).all() as any;

  const streaks = await db.prepare(
    'SELECT streak_type, current_count FROM streaks WHERE patient_id = ?',
  ).bind(patientId).all() as any;

  const todayData = {
    sleep_hours: sleepRow?.duration_min != null ? sleepRow.duration_min / 60 : undefined,
    exercise_minutes: activityRow?.total_min ?? undefined,
    mood: moodRow?.mood ?? undefined,
    water_glasses: waterRow?.total_ml != null ? Math.round(waterRow.total_ml / 250) : undefined,
    total_score: scoreRow?.total_score ?? undefined,
  };

  const recentDays = [
    todayData,
    ...(recentMoods?.results || []).map((r: any) => ({ mood: r.mood })),
  ];

  const insights = generateInsights(
    todayData,
    recentDays,
    (streaks?.results || []) as Array<{ streak_type: string; current_count: number }>,
  );

  // Delete today's existing insights before storing new ones (idempotent)
  await db.prepare(
    'DELETE FROM ai_insights WHERE patient_id = ? AND DATE(created_at) = ?',
  ).bind(patientId, today).run();

  // Store generated insights
  for (const insight of insights) {
    const content = JSON.stringify({
      title_bn: insight.title_bn,
      title_en: insight.title_en,
      body_bn: insight.body_bn,
      body_en: insight.body_en,
      icon: insight.icon,
    });
    const severity = insight.priority <= 2 ? 'warning' : insight.priority <= 5 ? 'info' : 'positive';
    await db.prepare(
      'INSERT INTO ai_insights (patient_id, insight_type, content, severity) VALUES (?, ?, ?, ?)',
    ).bind(patientId, insight.type, content, severity).run();
  }

  return c.json({ insights, generated: insights.length });
});

// ─── POST /insights/:id/read ──────────────────────────────────────────
wellnessRoutes.post('/insights/:id/read', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const insightId = parseInt(c.req.param('id'), 10);

  if (isNaN(insightId)) {
    return c.json({ error: 'Invalid insight ID' }, 400);
  }

  await db.prepare(
    'UPDATE ai_insights SET read = 1 WHERE id = ? AND patient_id = ?',
  ).bind(insightId, patientId).run();

  return c.json({ success: true });
});

// ─── GET /achievements ───────────────────────────────────────────────
wellnessRoutes.get('/achievements', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;

  const rows = await db.prepare(
    'SELECT id, achievement_key, earned_at FROM achievements WHERE patient_id = ? ORDER BY earned_at DESC',
  ).bind(patientId).all();

  return c.json({
    earned: rows.results || [],
    catalog: [...ACHIEVEMENT_CATALOG],
  });
});

// ─── GET /goals ───────────────────────────────────────────────────────
wellnessRoutes.get('/goals', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const status = c.req.query('status');

  let query = 'SELECT id, goal_type, target_value, current_value, unit, start_date, end_date, status, ai_suggested, created_at FROM user_goals WHERE patient_id = ?';
  const params: any[] = [patientId];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC';

  const rows = await db.prepare(query).bind(...params).all();
  return c.json({ goals: rows.results || [] });
});

// ─── POST /goals ─────────────────────────────────────────────────────
wellnessRoutes.post('/goals', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = goalCreateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid goal data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const today = new Date().toISOString().slice(0, 10);
  const unit = d.unit ?? d.goal_type;
  const startDate = d.start_date ?? today;

  const result = await c.env.DB.prepare(
    'INSERT INTO user_goals (patient_id, goal_type, target_value, current_value, unit, start_date, end_date, status, ai_suggested) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)',
  ).bind(patientId, d.goal_type, d.target_value, unit, startDate, d.end_date ?? null, 'active', d.ai_suggested ? 1 : 0).run();

  const newAchievements = await checkAchievements(c.env.DB, patientId, { justSetGoal: true });

  return c.json({ success: true, id: result.meta.last_row_id, new_achievements: newAchievements }, 201);
});

// ─── PATCH /goals/:id ────────────────────────────────────────────────
wellnessRoutes.patch('/goals/:id', async (c) => {
  const patientId = await getPatientId(c);
  const goalId = parseInt(c.req.param('id'), 10);
  if (isNaN(goalId)) {
    return c.json({ error: 'Invalid goal ID' }, 400);
  }

  const body = await c.req.json();
  const parsed = goalUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid update data', details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;

  const sets: string[] = [];
  const params: any[] = [];

  if (d.status != null) { sets.push('status = ?'); params.push(d.status); }
  if (d.current_value != null) { sets.push('current_value = ?'); params.push(d.current_value); }
  if (d.target_value != null) { sets.push('target_value = ?'); params.push(d.target_value); }
  if (d.end_date !== undefined) { sets.push('end_date = ?'); params.push(d.end_date); }

  if (sets.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  params.push(goalId, patientId);
  await c.env.DB.prepare(
    `UPDATE user_goals SET ${sets.join(', ')} WHERE id = ? AND patient_id = ?`,
  ).bind(...params).run();

  return c.json({ success: true });
});

// ─── DELETE /goals/:id (abandon) ────────────────────────────────────
wellnessRoutes.delete('/goals/:id', async (c) => {
  const patientId = await getPatientId(c);
  const goalId = parseInt(c.req.param('id'), 10);
  if (isNaN(goalId)) {
    return c.json({ error: 'Invalid goal ID' }, 400);
  }

  await c.env.DB.prepare(
    'UPDATE user_goals SET status = ? WHERE id = ? AND patient_id = ?',
  ).bind('abandoned', goalId, patientId).run();

  return c.json({ success: true });
});

// ─── POST /sync/wearable — Bulk wearable data sync ──────────────────
const VALID_SAMPLE_TYPES = [
  'steps', 'heart_rate', 'sleep_minutes', 'spo2',
  'active_calories', 'exercise_minutes', 'distance_m',
  'resting_heart_rate', 'stand_hours',
] as const;

const wearableSampleSchema = z.object({
  type: z.enum(VALID_SAMPLE_TYPES),
  value: z.number().min(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timestamp: z.string(),
});

const wearableSyncSchema = z.object({
  device_name: z.string().max(200).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  samples: z.array(wearableSampleSchema).min(1).max(500),
});

wellnessRoutes.post('/sync/wearable', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = wearableSyncSchema.safeParse(body);

  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join(', ');
    return c.json({ error: `Invalid wearable data: ${msg}. Max 500 samples per batch.` }, 400);
  }

  const { samples, device_name, platform } = parsed.data;
  const db = c.env.DB;
  let synced = 0;

  const stmt = db.prepare(`
    INSERT INTO wearable_samples (patient_id, sample_type, value, date, timestamp, device_name, platform)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const batch = samples.map((sample: any) => stmt.bind(
    patientId, sample.type, sample.value, sample.date,
    sample.timestamp, device_name ?? null, platform ?? null,
  ));

  await db.batch(batch);
  synced = samples.length;

  return c.json({ success: true, synced }, 201);
});

// ─── GET /daily-totals — Activity Rings + daily summary ─────────────
const DEFAULT_GOALS = { move_cal: 400, exercise_min: 30, stand_hrs: 8, steps: 10000, water_ml: 2000, sleep_min: 480 };

wellnessRoutes.get('/daily-totals', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);

  // Aggregate wearable samples for the date
  const stepsRow = await db.prepare(
    'SELECT COALESCE(SUM(value), 0) AS total FROM wearable_samples WHERE patient_id = ? AND date = ? AND sample_type = ?',
  ).bind(patientId, date, 'steps').first() as any;

  const caloriesRow = await db.prepare(
    'SELECT COALESCE(SUM(value), 0) AS total FROM wearable_samples WHERE patient_id = ? AND date = ? AND sample_type = ?',
  ).bind(patientId, date, 'active_calories').first() as any;

  const exerciseRow = await db.prepare(
    'SELECT COALESCE(SUM(value), 0) AS total FROM wearable_samples WHERE patient_id = ? AND date = ? AND sample_type = ?',
  ).bind(patientId, date, 'exercise_minutes').first() as any;

  const standRow = await db.prepare(
    'SELECT COALESCE(SUM(value), 0) AS total FROM wearable_samples WHERE patient_id = ? AND date = ? AND sample_type = ?',
  ).bind(patientId, date, 'stand_hours').first() as any;

  const sleepRow = await db.prepare(
    'SELECT COALESCE(SUM(value), 0) AS total FROM wearable_samples WHERE patient_id = ? AND date = ? AND sample_type = ?',
  ).bind(patientId, date, 'sleep_minutes').first() as any;

  const hrRow = await db.prepare(
    'SELECT AVG(value) AS avg_hr FROM wearable_samples WHERE patient_id = ? AND date = ? AND sample_type = ?',
  ).bind(patientId, date, 'heart_rate').first() as any;

  // Water from water log
  const waterRow = await db.prepare(
    "SELECT COALESCE(SUM(amount_ml), 0) AS total FROM water_log WHERE patient_id = ? AND date(logged_at) = ?",
  ).bind(patientId, date).first() as any;

  // Fetch user goals if they have custom ones
  const steps = Number(stepsRow?.total ?? stepsRow?.balance ?? 0);
  const moveCal = Number(caloriesRow?.total ?? caloriesRow?.balance ?? 0);
  const exerciseMin = Number(exerciseRow?.total ?? exerciseRow?.balance ?? 0);
  const standHrs = Number(standRow?.total ?? standRow?.balance ?? 0);
  const sleepMin = Number(sleepRow?.total ?? sleepRow?.balance ?? 0);
  const waterMl = Number(waterRow?.total ?? waterRow?.balance ?? 0);
  const heartRateAvg = hrRow?.avg_hr ? Math.round(Number(hrRow.avg_hr)) : null;

  return c.json({
    date,
    steps,
    water_ml: waterMl,
    sleep_min: sleepMin,
    heart_rate_avg: heartRateAvg,
    rings: {
      move: { current: moveCal, goal: DEFAULT_GOALS.move_cal },
      exercise: { current: exerciseMin, goal: DEFAULT_GOALS.exercise_min },
      stand: { current: standHrs, goal: DEFAULT_GOALS.stand_hrs },
    },
  });
});

// ─── POST /screening — Submit PHQ-9 or GAD-7 ───────────────────────
const screeningSubmitSchema = z.object({
  type: z.enum(['phq9', 'gad7']),
  answers: z.array(z.number().int().min(0).max(3)),
  notes: z.string().max(2000).optional(),
});

wellnessRoutes.post('/screening', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = screeningSubmitSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid screening data' }, 400);
  }

  const { type, answers, notes } = parsed.data;

  try {
    // Rate limit: 1 submission per type per day per user
    const existing = await c.env.DB.prepare(
      "SELECT id FROM mental_health_screenings WHERE patient_id = ? AND screening_type = ? AND DATE(created_at) = DATE('now')"
    ).bind(patientId, type).first();
    
    if (existing) {
      return c.json({ error: `You have already completed a ${type.toUpperCase()} assessment today. Please try again tomorrow.` }, 429);
    }

    if (type === 'phq9') {
      const result = scorePHQ9(answers);
      await c.env.DB.prepare(
        'INSERT INTO mental_health_screenings (patient_id, screening_type, answers, total_score, severity, suicidal_risk, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(patientId, 'phq9', JSON.stringify(answers), result.total, result.severity, result.suicidal_risk ? 1 : 0, notes ?? null).run();

      return c.json({ type: 'phq9', total: result.total, severity: result.severity, suicidal_risk: result.suicidal_risk }, 201);
    } else {
      const result = scoreGAD7(answers);
      await c.env.DB.prepare(
        'INSERT INTO mental_health_screenings (patient_id, screening_type, answers, total_score, severity, notes) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(patientId, 'gad7', JSON.stringify(answers), result.total, result.severity, notes ?? null).run();

      return c.json({ type: 'gad7', total: result.total, severity: result.severity }, 201);
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
});

// ─── GET /screenings — Screening history ────────────────────────────
wellnessRoutes.get('/screenings', async (c) => {
  const patientId = await getPatientId(c);
  const type = c.req.query('type'); // optional filter

  let query = 'SELECT * FROM mental_health_screenings WHERE patient_id = ?';
  const params: any[] = [patientId];

  if (type === 'phq9' || type === 'gad7') {
    query += ' AND screening_type = ?';
    params.push(type);
  }

  query += ' ORDER BY created_at DESC LIMIT 50';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ screenings: results ?? [] });
});

// ─── POST /cycle/log — Log period ───────────────────────────────────
const cycleLogSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  flow_intensity: z.enum(['light', 'medium', 'heavy']).optional(),
  symptoms: z.array(z.string().max(100)).max(20).optional(),
  notes: z.string().max(2000).optional(),
});

wellnessRoutes.post('/cycle/log', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = cycleLogSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid cycle data' }, 400);
  }

  const { start_date, end_date, flow_intensity, symptoms, notes } = parsed.data;

  await c.env.DB.prepare(
    'INSERT INTO cycle_logs (patient_id, start_date, end_date, flow_intensity, symptoms, notes) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    patientId, start_date, end_date ?? null,
    flow_intensity ?? null, symptoms ? JSON.stringify(symptoms) : null, notes ?? null,
  ).run();

  return c.json({ success: true }, 201);
});

// ─── GET /cycle/history — Cycle history + prediction ────────────────
wellnessRoutes.get('/cycle/history', async (c) => {
  const patientId = await getPatientId(c);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM cycle_logs WHERE patient_id = ? ORDER BY start_date DESC LIMIT 24'
  ).bind(patientId).all();

  return c.json({ cycles: results ?? [] });
});

// ─── POST /meditation/log — Log meditation session ──────────────────
const meditationLogSchema = z.object({
  duration_min: z.number().int().min(1).max(120),
  type: z.enum(['unguided', 'guided', 'breathing']).optional(),
  mood_before: z.enum(['great', 'good', 'okay', 'low', 'struggling']).optional(),
  mood_after: z.enum(['great', 'good', 'okay', 'low', 'struggling']).optional(),
});

wellnessRoutes.post('/meditation/log', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = meditationLogSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid meditation data' }, 400);
  }

  const { duration_min, type, mood_before, mood_after } = parsed.data;

  await c.env.DB.prepare(
    'INSERT INTO meditation_sessions (patient_id, duration_min, type, mood_before, mood_after) VALUES (?, ?, ?, ?, ?)'
  ).bind(patientId, duration_min, type ?? 'unguided', mood_before ?? null, mood_after ?? null).run();

  return c.json({ success: true }, 201);
});

// ─── POST /challenges — Create walking challenge ────────────────────
const challengeCreateSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['steps', 'distance_km']),
  target: z.number().int().positive(),
  duration_days: z.number().int().min(1).max(90),
});

wellnessRoutes.post('/challenges', async (c) => {
  const patientId = await getPatientId(c);
  const body = await c.req.json();
  const parsed = challengeCreateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Invalid challenge data' }, 400);
  }

  const { name, type, target, duration_days } = parsed.data;
  const startDate = new Date().toISOString().slice(0, 10);
  const endDate = new Date(Date.now() + duration_days * 86400000).toISOString().slice(0, 10);

  const result = await c.env.DB.prepare(
    'INSERT INTO walking_challenges (name, type, target, duration_days, created_by, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(name, type, target, duration_days, patientId, startDate, endDate).run();

  // Auto-join creator
  const challengeId = result.meta?.last_row_id ?? 1;
  await c.env.DB.prepare(
    'INSERT INTO challenge_participants (challenge_id, patient_id) VALUES (?, ?)'
  ).bind(challengeId, patientId).run();

  return c.json({ success: true, challenge_id: challengeId }, 201);
});

// ─── POST /challenges/:id/join — Join a challenge ───────────────────
wellnessRoutes.post('/challenges/:id/join', async (c) => {
  const patientId = await getPatientId(c);
  const challengeId = parseInt(c.req.param('id'), 10);

  if (isNaN(challengeId)) {
    return c.json({ error: 'Invalid challenge ID' }, 400);
  }

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO challenge_participants (challenge_id, patient_id) VALUES (?, ?)'
  ).bind(challengeId, patientId).run();

  return c.json({ success: true }, 201);
});

// ─── GET /challenges — List active challenges ───────────────────────
wellnessRoutes.get('/challenges', async (c) => {
  const patientId = await getPatientId(c);

  const { results } = await c.env.DB.prepare(
    `SELECT wc.*, cp.current_value, cp.joined_at
     FROM walking_challenges wc
     LEFT JOIN challenge_participants cp ON cp.challenge_id = wc.id AND cp.patient_id = ?
     WHERE wc.status = 'active' AND (wc.created_by = ? OR wc.created_by IS NULL)
     ORDER BY wc.created_at DESC LIMIT 20`
  ).bind(patientId, patientId).all();

  return c.json({ challenges: results ?? [] });
});

// ─── Onboarding Progression (First-Week Guided Experience) ────────

import { getOnboardingDay, getCurrentTask, checkAutoComplete, ONBOARDING_DAYS } from '../lib/onboarding-progression';

// GET /onboarding-progress — current day + completed days
wellnessRoutes.get('/onboarding-progress', async (c) => {
  const patientId = await getPatientId(c);
  const db = c.env.DB;

  // Get signup date from wellness_profile
  const profile = await db.prepare(
    'SELECT created_at FROM wellness_profile WHERE patient_id = ?'
  ).bind(patientId).first<{ created_at: string }>();

  if (!profile) {
    return c.json({ day: 0, completed: [], current_task: null, all_done: true });
  }

  const day = getOnboardingDay(profile.created_at);

  // Get completed days from onboarding_progress table
  const { results } = await db.prepare(
    'SELECT day FROM onboarding_progress WHERE patient_id = ? ORDER BY day'
  ).bind(patientId).all<{ day: number }>();

  const completed = (results ?? []).map((r) => r.day);
  const currentTask = getCurrentTask(day, completed);

  return c.json({
    day,
    completed,
    current_task: currentTask,
    all_done: day === 0 || currentTask === null,
    total_days: 7,
  });
});

// POST /onboarding-progress/:day — mark a day as complete
wellnessRoutes.post('/onboarding-progress/:day', async (c) => {
  const patientId = await getPatientId(c);
  const dayParam = parseInt(c.req.param('day'), 10);

  if (isNaN(dayParam) || dayParam < 1 || dayParam > 7) {
    return c.json({ error: 'Day must be 1-7' }, 400);
  }

  const db = c.env.DB;

  await db.prepare(
    `INSERT OR IGNORE INTO onboarding_progress (patient_id, day, completed_at)
     VALUES (?, ?, datetime('now'))`
  ).bind(patientId, dayParam).run();

  return c.json({ success: true, day: dayParam });
});

export default wellnessRoutes;
