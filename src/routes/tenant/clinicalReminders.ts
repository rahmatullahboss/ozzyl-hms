import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getPagination, paginationMeta } from '../../lib/pagination';
import { getDb } from '../../db';

type REnv = { Bindings: Env; Variables: Variables };
const reminderRoutes = new Hono<REnv>();

// ─── Schemas ────────────────────────────────────────────────────────────────

const createRuleSchema = z.object({
  rule_code: z.string().min(1).max(50),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.enum(['screening', 'vaccination', 'lab_monitoring', 'follow_up', 'preventive_care', 'chronic_disease']),
  priority: z.enum(['routine', 'important', 'urgent']).default('routine'),
  min_age: z.number().int().optional(),
  max_age: z.number().int().optional(),
  sex: z.enum(['M', 'F']).optional(),
  condition_codes: z.array(z.string()).optional(),
  medication_names: z.array(z.string()).optional(),
  interval_days: z.number().int().positive(),
  grace_period_days: z.number().int().nonnegative().default(30),
  action_type: z.enum(['lab_order', 'screening', 'vaccination', 'referral', 'assessment', 'counseling']),
  action_code: z.string().optional(),
  action_description: z.string().optional(),
  guideline_source: z.string().optional(),
  evidence_level: z.enum(['A', 'B', 'C', 'D', 'expert_consensus']).optional(),
});

const completeReminderSchema = z.object({
  notes: z.string().optional(),
});

const skipReminderSchema = z.object({
  skip_reason: z.string().min(1, 'Skip reason required'),
});

// ─── Auto-clone seed rules ─────────────────────────────────────────────────

async function ensureSeedRules(db: ReturnType<typeof getDb>, tenantId: string) {
  const existing = await db.$client.prepare(
    'SELECT COUNT(*) as count FROM clinical_reminder_rules WHERE tenant_id = ?',
  ).bind(tenantId).first<{ count: number }>();
  if (existing && existing.count > 0) return;

  const seeds = await db.$client.prepare(
    "SELECT * FROM clinical_reminder_rules WHERE tenant_id = '__seed__'",
  ).all();

  for (const seed of seeds.results || []) {
    const s = seed as Record<string, unknown>;
    await db.$client.prepare(`
      INSERT OR IGNORE INTO clinical_reminder_rules (rule_code, title, description, category, priority,
        min_age, max_age, sex, condition_codes, medication_names, interval_days, grace_period_days,
        action_type, action_code, action_description, guideline_source, evidence_level, is_active, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).bind(
      s.rule_code, s.title, s.description, s.category, s.priority,
      s.min_age, s.max_age, s.sex, s.condition_codes, s.medication_names,
      s.interval_days, s.grace_period_days, s.action_type, s.action_code,
      s.action_description, s.guideline_source, s.evidence_level, tenantId,
    ).run();
  }
}

// ─── Rule CRUD ──────────────────────────────────────────────────────────────

/** GET / — List all reminder rules */
reminderRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  await ensureSeedRules(db, tenantId);

  const { category } = c.req.query();
  let query = 'SELECT * FROM clinical_reminder_rules WHERE tenant_id = ? AND is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (category) { query += ' AND category = ?'; params.push(category); }
  query += ' ORDER BY priority DESC, category, title';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ data: results });
});

/** POST / — Create custom rule */
reminderRoutes.post('/', zValidator('json', createRuleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO clinical_reminder_rules (rule_code, title, description, category, priority,
      min_age, max_age, sex, condition_codes, medication_names, interval_days, grace_period_days,
      action_type, action_code, action_description, guideline_source, evidence_level, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.rule_code, data.title, data.description ?? null, data.category, data.priority,
    data.min_age ?? null, data.max_age ?? null, data.sex ?? null,
    data.condition_codes ? JSON.stringify(data.condition_codes) : null,
    data.medication_names ? JSON.stringify(data.medication_names) : null,
    data.interval_days, data.grace_period_days, data.action_type,
    data.action_code ?? null, data.action_description ?? null,
    data.guideline_source ?? null, data.evidence_level ?? null, tenantId,
  ).run();

  return c.json({ id: result.meta.last_row_id, message: 'Rule created' }, 201);
});

/** DELETE /:id — Deactivate rule */
reminderRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  await db.$client.prepare(
    'UPDATE clinical_reminder_rules SET is_active = 0 WHERE id = ? AND tenant_id = ?',
  ).bind(c.req.param('id'), tenantId).run();
  return c.json({ message: 'Rule deactivated' });
});

// ─── Patient Reminder Evaluation ────────────────────────────────────────────

/** GET /patient/:patientId — Evaluate all reminders for a patient */
reminderRoutes.get('/patient/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  await ensureSeedRules(db, tenantId);

  // Fetch patient
  const patient = await db.$client.prepare(
    'SELECT id, name, date_of_birth AS dob, gender, blood_group FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(patientId, tenantId).first() as any;
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // Calculate age
  let age: number | null = null;
  if (patient.dob) {
    const birth = new Date(patient.dob);
    const now = new Date();
    age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  }
  const sex = (patient.gender || '').toUpperCase().startsWith('M') ? 'M' : (patient.gender || '').toUpperCase().startsWith('F') ? 'F' : null;

  // Fetch patient diagnoses/problem list
  const { results: diagRows } = await db.$client.prepare(
    "SELECT diagnosis_code, diagnosis_text FROM patient_diagnoses WHERE patient_id = ? AND tenant_id = ? AND is_active = 1 UNION SELECT title as diagnosis_code, title as diagnosis_text FROM patient_problem_list WHERE patient_id = ? AND tenant_id = ? AND is_active = 1",
  ).bind(patientId, tenantId, patientId, tenantId).all().catch(() => ({ results: [] }));
  const diagnoses = (diagRows || []).map((d: any) => ((d.diagnosis_code || '') + ' ' + (d.diagnosis_text || '')).toLowerCase());

  // Fetch active medications
  const { results: medRows } = await db.$client.prepare(
    "SELECT medication_name, generic_name FROM patient_active_medications WHERE patient_id = ? AND tenant_id = ? AND status = 'active'",
  ).bind(patientId, tenantId).all().catch(() => ({ results: [] }));
  const medications = (medRows || []).map((m: any) => ((m.medication_name || '') + ' ' + (m.generic_name || '')).toLowerCase());

  // Fetch all active rules
  const { results: rules } = await db.$client.prepare(
    'SELECT * FROM clinical_reminder_rules WHERE tenant_id = ? AND is_active = 1',
  ).bind(tenantId).all();

  // Fetch existing reminder statuses for this patient
  const { results: statuses } = await db.$client.prepare(
    'SELECT * FROM patient_reminder_status WHERE tenant_id = ? AND patient_id = ?',
  ).bind(tenantId, patientId).all();
  const statusByRuleId = new Map((statuses || []).map((s: any) => [s.rule_id, s]));

  const now = new Date();
  const reminders: any[] = [];

  for (const rule of (rules || []) as any[]) {
    // Check age criteria
    if (rule.min_age != null && age != null && age < rule.min_age) continue;
    if (rule.max_age != null && age != null && age > rule.max_age) continue;
    // Check sex criteria
    if (rule.sex && sex && rule.sex !== sex) continue;

    // Check condition criteria
    if (rule.condition_codes) {
      const condCodes: string[] = JSON.parse(rule.condition_codes);
      const hasCondition = condCodes.some(code =>
        diagnoses.some(d => d.includes(code.toLowerCase())),
      );
      if (!hasCondition) continue;
    }

    // Check medication criteria
    if (rule.medication_names) {
      const medNames: string[] = JSON.parse(rule.medication_names);
      const hasMed = medNames.some(name =>
        medications.some(m => m.includes(name.toLowerCase())),
      );
      if (!hasMed && !rule.condition_codes) continue; // medication-only rule
    }

    // Determine status
    const existing = statusByRuleId.get(rule.id) as any;
    let status = 'due';
    let nextDue = now;
    let lastCompleted: string | null = null;

    if (existing) {
      lastCompleted = existing.last_completed_at;
      if (existing.status === 'skipped' || existing.status === 'not_applicable') {
        status = existing.status;
        reminders.push({ rule, status, lastCompleted, nextDue: existing.next_due_at, statusId: existing.id, skip_reason: existing.skip_reason });
        continue;
      }
      if (existing.last_completed_at) {
        const completedAt = new Date(existing.last_completed_at);
        const nextDueDate = new Date(completedAt.getTime() + rule.interval_days * 86400000);
        nextDue = nextDueDate;
        if (nextDueDate > now) {
          status = 'completed';
        } else {
          const graceDue = new Date(nextDueDate.getTime() + (rule.grace_period_days || 0) * 86400000);
          status = now > graceDue ? 'overdue' : 'due';
        }
      }
    }

    reminders.push({
      rule: { id: rule.id, rule_code: rule.rule_code, title: rule.title, category: rule.category, priority: rule.priority, action_type: rule.action_type, action_description: rule.action_description, guideline_source: rule.guideline_source },
      status,
      lastCompleted,
      nextDue: nextDue.toISOString().split('T')[0],
      statusId: existing?.id || null,
    });
  }

  // Sort: overdue first, then due, then completed
  const statusOrder: Record<string, number> = { overdue: 0, due: 1, completed: 2, skipped: 3, not_applicable: 4 };
  reminders.sort((a, b) => (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5));

  const summary = {
    overdue: reminders.filter(r => r.status === 'overdue').length,
    due: reminders.filter(r => r.status === 'due').length,
    completed: reminders.filter(r => r.status === 'completed').length,
    total: reminders.length,
  };

  return c.json({ patient: { id: patient.id, name: patient.name, age, sex }, summary, reminders });
});

/** POST /patient/:patientId/complete/:ruleId — Mark a reminder as completed */
reminderRoutes.post('/patient/:patientId/complete/:ruleId', zValidator('json', completeReminderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = c.req.param('patientId');
  const ruleId = c.req.param('ruleId');
  const data = c.req.valid('json');

  const rule = await db.$client.prepare(
    'SELECT interval_days FROM clinical_reminder_rules WHERE id = ? AND tenant_id = ?',
  ).bind(ruleId, tenantId).first<{ interval_days: number }>();
  if (!rule) throw new HTTPException(404, { message: 'Rule not found' });

  const now = new Date();
  const nextDue = new Date(now.getTime() + rule.interval_days * 86400000);

  await db.$client.prepare(`
    INSERT INTO patient_reminder_status (patient_id, rule_id, status, last_completed_at, next_due_at, completed_by, notes, tenant_id)
    VALUES (?, ?, 'completed', datetime('now', '+6 hours'), ?, ?, ?, ?)
    ON CONFLICT(tenant_id, patient_id, rule_id) DO UPDATE SET
      status = 'completed', last_completed_at = datetime('now', '+6 hours'), next_due_at = excluded.next_due_at,
      completed_by = excluded.completed_by, notes = excluded.notes, updated_at = datetime('now', '+6 hours')
  `).bind(patientId, ruleId, nextDue.toISOString(), userId, data.notes ?? null, tenantId).run();

  return c.json({ message: 'Reminder completed', next_due: nextDue.toISOString().split('T')[0] });
});

/** POST /patient/:patientId/skip/:ruleId — Skip/defer a reminder */
reminderRoutes.post('/patient/:patientId/skip/:ruleId', zValidator('json', skipReminderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const patientId = c.req.param('patientId');
  const ruleId = c.req.param('ruleId');
  const data = c.req.valid('json');

  await db.$client.prepare(`
    INSERT INTO patient_reminder_status (patient_id, rule_id, status, skip_reason, completed_by, tenant_id)
    VALUES (?, ?, 'skipped', ?, ?, ?)
    ON CONFLICT(tenant_id, patient_id, rule_id) DO UPDATE SET
      status = 'skipped', skip_reason = excluded.skip_reason, completed_by = excluded.completed_by, updated_at = datetime('now', '+6 hours')
  `).bind(patientId, ruleId, data.skip_reason, userId, tenantId).run();

  return c.json({ message: 'Reminder skipped' });
});

// ─── Dashboard: Population-Level Reminders ──────────────────────────────────

/** GET /dashboard/overdue — List all overdue reminders across patients */
reminderRoutes.get('/dashboard/overdue', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, offset } = getPagination(c);

  const countResult = await db.$client.prepare(
    `SELECT COUNT(*) as total FROM patient_reminder_status prs
     WHERE prs.tenant_id = ? AND prs.status = 'overdue'`,
  ).bind(tenantId).first<{ total: number }>();

  const { results } = await db.$client.prepare(`
    SELECT prs.*, p.name as patient_name, p.patient_code, p.mobile,
           crr.title as rule_title, crr.category, crr.priority, crr.action_description
    FROM patient_reminder_status prs
    JOIN patients p ON prs.patient_id = p.id
    JOIN clinical_reminder_rules crr ON prs.rule_id = crr.id
    WHERE prs.tenant_id = ? AND prs.status = 'overdue'
    ORDER BY crr.priority DESC, prs.next_due_at ASC
    LIMIT ? OFFSET ?
  `).bind(tenantId, limit, offset).all();

  return c.json({ data: results, meta: paginationMeta(page, limit, countResult?.total ?? 0) });
});

/** GET /dashboard/summary — Aggregate counts by category */
reminderRoutes.get('/dashboard/summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(`
    SELECT crr.category, prs.status, COUNT(*) as count
    FROM patient_reminder_status prs
    JOIN clinical_reminder_rules crr ON prs.rule_id = crr.id
    WHERE prs.tenant_id = ?
    GROUP BY crr.category, prs.status
  `).bind(tenantId).all();

  return c.json({ data: results });
});

export default reminderRoutes;
