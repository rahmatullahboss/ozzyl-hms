import { afterEach, describe, expect, it, vi } from 'vitest';
import { sign } from 'hono/jwt';
import globalPortalRoutes from '../../../src/routes/global-portal';
import { createMockDB } from '../helpers/mock-db';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const originalFetch = globalThis.fetch;

describe('patient ai planner routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('generates and lists a saved patient ai plan', async () => {
    let planCountChecks = 0;
    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        headline: 'Focus on blood sugar stability',
        summary: 'Build a consistent meal and walking routine this week.',
        focus_areas: ['Blood sugar', 'Daily routine'],
        eat_more: ['Vegetables', 'Water'],
        avoid_or_reduce: ['Sugary drinks'],
        daily_routine: ['Wake up at the same time', 'Walk after dinner'],
        exercise_plan: ['20 minutes walking 5 days a week'],
        action_checklist: ['Walk after dinner', 'Reduce sugary drinks'],
        follow_up_actions: ['Book a doctor review if symptoms persist'],
        warning_signs: ['Severe dizziness'],
        doctor_consultation_advice: ['Discuss abnormal symptoms with a doctor'],
        disclaimer: 'This is basic guidance and not a diagnosis.',
        confidence: 'medium',
        data_gaps: ['No recent lab report uploaded'],
      }),
      usage: { prompt_tokens: 100, completion_tokens: 80, total_tokens: 180 },
    }));

    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'patient@example.com',
              phone: '01711111111',
              uhid: 'OZ-12345',
              name: 'Test Patient',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity')) {
          return {
            first: {
              id: 11,
              uhid: 'OZ-12345',
              primary_name: 'Test Patient',
              primary_phone: '01711111111',
              primary_email: 'patient@example.com',
              date_of_birth: '1990-01-01',
              gender: 'female',
              claim_status: 'claimed',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patients p') && normalized.includes('join tenants t on t.id = p.tenant_id')) {
          return {
            results: [{ tenant_id: 'tenant-1', hospital_name: 'Hospital One', patient_id: 10 }],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select name from tenants where id = ?')) {
          return { first: { name: 'Hospital One' }, success: true, meta: {} };
        }
        if (normalized.includes('select count(*) as total from patient_ai_plans')) {
          const total = planCountChecks === 0 ? 0 : 1;
          planCountChecks += 1;
          return { first: { total }, success: true, meta: {} };
        }
        if (normalized.includes('select id, headline, summary, confidence, plan_json, source_snapshot_json, created_at') && normalized.includes('from patient_ai_plans')) {
          return {
            results: [{
              id: 1,
              headline: 'Focus on blood sugar stability',
              summary: 'Build a consistent meal and walking routine this week.',
              confidence: 'medium',
              source_snapshot_json: JSON.stringify({
                vault_documents: [{ title: 'HbA1c report', document_type: 'lab_report', entered_at: '2026-04-10' }],
                vitals: [{ blood_sugar: 10.2, logged_on: '2026-04-10' }],
                lifestyle_logs: [{ sleep_hours: 6, exercise_minutes: 10, diet_notes: 'Too much rice' }],
              }),
              plan_json: JSON.stringify({
                headline: 'Focus on blood sugar stability',
                summary: 'Build a consistent meal and walking routine this week.',
                focus_areas: ['Blood sugar', 'Daily routine'],
                eat_more: [
                  'Vegetables',
                  'Build meals around dal, seasonal vegetables, and local fish or egg instead of relying on packaged snacks.',
                ],
                avoid_or_reduce: ['Sugary drinks', 'Cut down mishti, sweet tea, soft drinks, juice, and very large plates of white rice.'],
                daily_routine: ['Wake up at the same time', 'Walk after dinner'],
                exercise_plan: ['20 minutes walking 5 days a week'],
                action_checklist: ['Walk after dinner', 'Reduce sugary drinks'],
                follow_up_actions: ['Book a doctor review if symptoms persist'],
                warning_signs: ['Severe dizziness'],
                doctor_consultation_advice: ['Discuss abnormal symptoms with a doctor'],
                disclaimer: 'This is basic guidance and not a diagnosis.',
                confidence: 'medium',
                data_gaps: ['No recent lab report uploaded'],
              }),
              created_at: '2026-04-11T10:00:00Z',
            }],
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        global_patient_auth: [{ id: 5, identity_id: 11, uhid: 'OZ-12345', email: 'patient@example.com', phone: '01711111111', name: 'Test Patient', is_active: 1 }],
        global_patient_identity: [{ id: 11, uhid: 'OZ-12345', primary_name: 'Test Patient', primary_phone: '01711111111', primary_email: 'patient@example.com', claim_status: 'claimed' }],
        patients: [{ id: 10, tenant_id: 'tenant-1', uhid: 'OZ-12345', name: 'Test Patient', age: 36, gender: 'female', blood_group: 'A+' }],
        tenants: [{ id: 'tenant-1', name: 'Hospital One' }],
        appointments: [{ id: 1, tenant_id: 'tenant-1', patient_id: 10, appt_date: '2026-04-15', appt_time: '10:00', status: 'scheduled' }],
        prescriptions: [{ id: 2, tenant_id: 'tenant-1', patient_id: 10, diagnosis: 'Diabetes', status: 'final', created_at: '2026-04-10' }],
        global_patient_vault_documents: [{ id: 1, uhid: 'OZ-12345', title: 'HbA1c report', document_type: 'lab_report', entered_at: '2026-04-10' }],
        global_patient_reported_data: [{ id: 1, uhid: 'OZ-12345', category: 'chronic_condition', name: 'Diabetes', created_at: '2026-04-10' }],
        global_patient_lifestyle_logs: [{ id: 1, uhid: 'OZ-12345', logged_on: '2026-04-10', sleep_hours: 6, exercise_minutes: 10, diet_notes: 'Too much rice' }],
        global_patient_vitals: [{ id: 1, uhid: 'OZ-12345', logged_on: '2026-04-10', systolic: 140, diastolic: 90, blood_sugar: 10.2 }],
        patient_ai_plans: [],
        ai_interactions: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
      extraEnv: {
        AI: { run: aiRun },
        PATIENT_AI_MODEL: '@cf/moonshotai/kimi-k2.5',
      } as any,
    });

    const token = await sign({ userId: 5, scope: 'global', role: 'patient' }, 'test-secret', 'HS256');

    const generateRes = await jsonRequest(app, '/api/global-portal/ai-plans/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(generateRes.status).toBe(201);

    const listRes = await jsonRequest(app, '/api/global-portal/ai-plans', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(listRes.status).toBe(200);
    const body = await listRes.json() as {
      latest_plan?: { headline: string } | null;
      plans: Array<{ headline: string }>;
      remaining_generations_today: number;
    };

    expect(body.latest_plan?.headline).toBe('Focus on blood sugar stability');
    expect(body.plans[0]?.headline).toBe('Focus on blood sugar stability');
    expect(body.plans[0]?.plan.action_checklist).toEqual(['Walk after dinner', 'Reduce sugary drinks']);
    expect(body.plans[0]?.completed_items).toEqual([]);
    expect(body.remaining_generations_today).toBe(1);
    expect(body.plans[0]?.plan.eat_more.some((item) => item.toLowerCase().includes('dal'))).toBe(true);
    expect(aiRun).toHaveBeenCalledWith('@cf/moonshotai/kimi-k2.5', expect.any(Object));
  });

  it('suggests tracker items from the latest ai plan for the wellness hub', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'patient@example.com',
              phone: '01711111111',
              uhid: 'OZ-12345',
              name: 'Test Patient',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select medication_reminders_json, daily_routines_json, updated_at') && normalized.includes('from patient_wellness_preferences')) {
          return { first: null, success: true, meta: {} };
        }
        if (normalized.includes('select completed_items_json, updated_at') && normalized.includes('from patient_wellness_progress')) {
          return { first: null, success: true, meta: {} };
        }
        if (normalized.includes('select plan_json') && normalized.includes('from patient_ai_plans')) {
          return {
            results: [{
              plan_json: JSON.stringify({
                headline: 'Medication follow-up',
                summary: 'Keep your routine stable.',
                focus_areas: ['Take medicines regularly'],
                eat_more: [],
                avoid_or_reduce: [],
                daily_routine: ['15 minute walk after dinner'],
                exercise_plan: ['Light stretch after Fajr'],
                action_checklist: ['Metformin after dinner', 'Morning BP tablet after breakfast'],
                follow_up_actions: ['Review medicines after 7 days'],
                warning_signs: [],
                doctor_consultation_advice: [],
                disclaimer: 'Talk to your doctor.',
                confidence: 'medium',
                data_gaps: [],
              }),
            }],
            success: true,
            meta: {},
          };
        }
        return undefined;
      },
    });

    const { app } = createTestApp({
      mockDB: mockDB as any,
      routePath: '/api/global-portal',
      route: globalPortalRoutes,
      jwtSecret: 'test-secret',
      extraEnv: {
        JWT_SECRET: 'test-secret',
      },
    });

    const token = await sign({ userId: '7', scope: 'global' }, 'test-secret');
    const res = await jsonRequest(app, '/api/global-portal/wellness-hub', {
      method: 'GET',
      headers: {
        Cookie: `phr_token=${token}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      suggested_medication_reminders: string[];
      suggested_daily_routines: string[];
    };
    expect(body.suggested_medication_reminders).toContain('Metformin after dinner');
    expect(body.suggested_daily_routines).toContain('15 minute walk after dinner');
  });

  it('includes wellness tracker adherence inside the ai planner snapshot', async () => {
    const aiRun = vi.fn(async (_model: string, input: any) => ({
      response: JSON.stringify({
        headline: 'Make the plan easier to follow',
        summary: JSON.stringify(input.messages),
        focus_areas: ['Keep it simple'],
        eat_more: ['Dal'],
        avoid_or_reduce: ['Sugary drinks'],
        daily_routine: ['Walk after dinner'],
        exercise_plan: [],
        action_checklist: ['Walk after dinner'],
        follow_up_actions: ['Review after one week'],
        warning_signs: [],
        doctor_consultation_advice: [],
        disclaimer: 'Talk to your doctor.',
        confidence: 'medium',
        data_gaps: [],
      }),
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }));

    const mockDB = createMockDB({
      tables: {
        global_patient_auth: [{ id: 5, identity_id: 11, uhid: 'OZ-12345', email: 'patient@example.com', phone: '01711111111', name: 'Test Patient', is_active: 1 }],
        global_patient_identity: [{ id: 11, uhid: 'OZ-12345', primary_name: 'Test Patient', primary_phone: '01711111111', primary_email: 'patient@example.com', claim_status: 'claimed' }],
        patients: [{ id: 10, tenant_id: 'tenant-1', uhid: 'OZ-12345', name: 'Test Patient', age: 36, gender: 'female', blood_group: 'A+' }],
        tenants: [{ id: 'tenant-1', name: 'Hospital One' }],
        patient_wellness_preferences: [{ global_user_id: 5, medication_reminders_json: '["Morning BP tablet after breakfast"]', daily_routines_json: '["15 minute walk after dinner"]' }],
        patient_wellness_progress: [{ global_user_id: 5, tracker_date: '2026-04-13', completed_items_json: '["Morning BP tablet after breakfast"]' }],
        patient_ai_plans: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
      extraEnv: {
        AI: { run: aiRun },
        PATIENT_AI_MODEL: '@cf/moonshotai/kimi-k2.5',
      } as any,
    });

    const token = await sign({ userId: 5, scope: 'global', role: 'patient' }, 'test-secret', 'HS256');
    const res = await jsonRequest(app, '/api/global-portal/ai-plans/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(201);
    const aiArg = aiRun.mock.calls[0]?.[1];
    const userMessage = aiArg?.messages?.find((message: any) => message.role === 'user')?.content as string;
    expect(userMessage).toContain('"wellness_tracker"');
    expect(userMessage).toContain('"adherence_percent_today":50');
  });

  it('rejects a second patient ai generation on the same day', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'patient@example.com',
              phone: '01711111111',
              uhid: 'OZ-12345',
              name: 'Test Patient',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity')) {
          return {
            first: {
              id: 11,
              uhid: 'OZ-12345',
              primary_name: 'Test Patient',
              primary_phone: '01711111111',
              primary_email: 'patient@example.com',
              date_of_birth: '1990-01-01',
              gender: 'female',
              claim_status: 'claimed',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select count(*) as total from patient_ai_plans')) {
          return { first: { total: 1 }, success: true, meta: {} };
        }
        return null;
      },
      tables: {
        global_patient_auth: [{ id: 5, identity_id: 11, uhid: 'OZ-12345', email: 'patient@example.com', phone: '01711111111', name: 'Test Patient', is_active: 1 }],
        global_patient_identity: [{ id: 11, uhid: 'OZ-12345', primary_name: 'Test Patient', primary_phone: '01711111111', primary_email: 'patient@example.com', claim_status: 'claimed' }],
        patient_ai_plans: [{ id: 1, global_user_id: 5, uhid: 'OZ-12345', headline: 'Existing plan', summary: 'Saved', confidence: 'medium', plan_json: '{}', source_snapshot_json: '{}', created_at: '2026-04-11 10:00:00' }],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
      extraEnv: {
        OPENROUTER_API_KEY: 'test-key',
      } as any,
    });

    const token = await sign({ userId: 5, scope: 'global', role: 'patient' }, 'test-secret', 'HS256');
    const res = await jsonRequest(app, '/api/global-portal/ai-plans/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status !== 429) {
      const payload = await res.text();
      throw new Error(`Expected 429, got ${res.status}: ${payload}`);
    }

    expect(res.status).toBe(429);
  });

  it('updates checklist completion for a saved patient ai plan', async () => {
    let savedCompletedItems: string[] = [];

    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'patient@example.com',
              phone: '01711111111',
              uhid: 'OZ-12345',
              name: 'Test Patient',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from sqlite_master') && params[0] === 'patient_ai_plan_progress') {
          return {
            first: { name: 'patient_ai_plan_progress' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patient_ai_plans') && normalized.includes('where id = ? and global_user_id = ?')) {
          return {
            first: {
              id: 1,
              headline: 'Focus on blood sugar stability',
              summary: 'Build a consistent meal and walking routine this week.',
              confidence: 'medium',
              plan_json: JSON.stringify({
                headline: 'Focus on blood sugar stability',
                summary: 'Build a consistent meal and walking routine this week.',
                focus_areas: ['Blood sugar'],
                eat_more: ['Vegetables'],
                avoid_or_reduce: ['Sugary drinks'],
                daily_routine: ['Walk after dinner'],
                exercise_plan: ['20 minutes walking 5 days a week'],
                action_checklist: ['Walk after dinner', 'Reduce sugary drinks', 'Book a doctor review if symptoms persist'],
                follow_up_actions: ['Book a doctor review if symptoms persist'],
                warning_signs: ['Severe dizziness'],
                doctor_consultation_advice: ['Discuss abnormal symptoms with a doctor'],
                disclaimer: 'This is basic guidance and not a diagnosis.',
                confidence: 'medium',
                data_gaps: ['No recent lab report uploaded'],
              }),
              created_at: '2026-04-11T10:00:00Z',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patient_ai_plan_progress') && normalized.includes('where global_user_id = ? and plan_id = ?')) {
          return {
            first: savedCompletedItems.length
              ? { plan_id: 1, completed_items_json: JSON.stringify(savedCompletedItems) }
              : null,
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('insert into patient_ai_plan_progress')) {
          savedCompletedItems = JSON.parse(String(params[2] ?? '[]'));
          return {
            first: null,
            success: true,
            meta: { last_row_id: 1, changes: 1, duration: 1 },
          };
        }
        return null;
      },
      tables: {
        global_patient_auth: [{ id: 5, identity_id: 11, uhid: 'OZ-12345', email: 'patient@example.com', phone: '01711111111', name: 'Test Patient', is_active: 1 }],
        patient_ai_plans: [{ id: 1, global_user_id: 5, uhid: 'OZ-12345', headline: 'Existing plan', summary: 'Saved', confidence: 'medium', plan_json: '{}', source_snapshot_json: '{}', created_at: '2026-04-11 10:00:00' }],
        patient_ai_plan_progress: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign({ userId: 5, scope: 'global', role: 'patient' }, 'test-secret', 'HS256');
    const res = await jsonRequest(app, '/api/global-portal/ai-plans/1/checklist', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        completed_items: ['Walk after dinner', 'Book a doctor review if symptoms persist'],
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      plan: {
        completed_items: string[];
        completion_percent: number;
      };
    };

    expect(body.plan.completed_items).toEqual(['Walk after dinner', 'Book a doctor review if symptoms persist']);
    expect(body.plan.completion_percent).toBe(67);
  });

  it('refines a saved patient ai plan into a new version', async () => {
    let insertCount = 0;

    const aiRun = vi.fn(async () => ({
      response: JSON.stringify({
        headline: 'Refined plan for steadier sugar and sleep',
        summary: 'This updated version puts more structure around meals and evening routine.',
        focus_areas: ['Blood sugar', 'Sleep routine'],
        action_checklist: ['Eat dinner earlier', 'Walk for 15 minutes after lunch'],
        eat_more: ['Vegetables', 'Protein-rich breakfast'],
        avoid_or_reduce: ['Late-night sweets'],
        daily_routine: ['Eat dinner before 8pm'],
        exercise_plan: ['15 minute walk after lunch'],
        follow_up_actions: ['Repeat sugar log for 7 days'],
        warning_signs: ['Very high sugar with dizziness'],
        doctor_consultation_advice: ['Talk to a doctor if your sugar stays high'],
        disclaimer: 'This is basic guidance and not a diagnosis.',
        confidence: 'medium',
        data_gaps: ['No recent HbA1c trend uploaded'],
      }),
      usage: { prompt_tokens: 110, completion_tokens: 90, total_tokens: 200 },
    }));

    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'patient@example.com',
              phone: '01711111111',
              uhid: 'OZ-12345',
              name: 'Test Patient',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity')) {
          return {
            first: {
              id: 11,
              uhid: 'OZ-12345',
              primary_name: 'Test Patient',
              primary_phone: '01711111111',
              primary_email: 'patient@example.com',
              date_of_birth: '1990-01-01',
              gender: 'female',
              claim_status: 'claimed',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patients p') && normalized.includes('join tenants t on t.id = p.tenant_id')) {
          return {
            results: [{ tenant_id: 'tenant-1', hospital_name: 'Hospital One', patient_id: 10 }],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select count(*) as total from patient_ai_plans')) {
          return { first: { total: 0 }, success: true, meta: {} };
        }
        if (normalized.includes('from patient_ai_plans') && normalized.includes('where id = ? and global_user_id = ?')) {
          return {
            first: {
              id: 1,
              headline: 'Original plan',
              summary: 'Initial saved summary.',
              confidence: 'medium',
              created_at: '2026-04-11T08:00:00Z',
              plan_json: JSON.stringify({
                headline: 'Original plan',
                summary: 'Initial saved summary.',
                focus_areas: ['Blood sugar'],
                action_checklist: ['Walk after dinner'],
                eat_more: ['Vegetables'],
                avoid_or_reduce: ['Sugary drinks'],
                daily_routine: ['Walk after dinner'],
                exercise_plan: ['20 minutes walking'],
                follow_up_actions: ['Track sugar for 3 days'],
                warning_signs: ['Severe dizziness'],
                doctor_consultation_advice: ['Discuss symptoms with a doctor'],
                disclaimer: 'This is basic guidance and not a diagnosis.',
                confidence: 'medium',
                data_gaps: ['No recent lab report uploaded'],
              }),
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('insert into patient_ai_plans')) {
          insertCount += 1;
          return {
            success: true,
            meta: { last_row_id: 80 + insertCount, changes: 1, duration: 1 },
          };
        }
        return null;
      },
      tables: {
        global_patient_auth: [{ id: 5, identity_id: 11, uhid: 'OZ-12345', email: 'patient@example.com', phone: '01711111111', name: 'Test Patient', is_active: 1 }],
        global_patient_identity: [{ id: 11, uhid: 'OZ-12345', primary_name: 'Test Patient', primary_phone: '01711111111', primary_email: 'patient@example.com', claim_status: 'claimed' }],
        patients: [{ id: 10, tenant_id: 'tenant-1', uhid: 'OZ-12345', name: 'Test Patient', age: 36, gender: 'female', blood_group: 'A+' }],
        tenants: [{ id: 'tenant-1', name: 'Hospital One' }],
        global_patient_vault_documents: [{ id: 1, uhid: 'OZ-12345', title: 'HbA1c report', document_type: 'lab_report', entered_at: '2026-04-10' }],
        global_patient_reported_data: [{ id: 1, uhid: 'OZ-12345', category: 'chronic_condition', name: 'Diabetes', created_at: '2026-04-10' }],
        global_patient_lifestyle_logs: [{ id: 1, uhid: 'OZ-12345', logged_on: '2026-04-10', sleep_hours: 6, exercise_minutes: 10, diet_notes: 'Too much rice' }],
        global_patient_vitals: [{ id: 1, uhid: 'OZ-12345', logged_on: '2026-04-10', systolic: 140, diastolic: 90, blood_sugar: 10.2 }],
        patient_ai_plans: [],
        ai_interactions: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
      extraEnv: {
        AI: { run: aiRun },
        PATIENT_AI_MODEL: '@cf/moonshotai/kimi-k2.5',
      } as any,
    });

    const token = await sign({ userId: 5, scope: 'global', role: 'patient' }, 'test-secret', 'HS256');
    const res = await jsonRequest(app, '/api/global-portal/ai-plans/1/refine', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      plan: { headline: string; plan: { action_checklist: string[] } };
      remaining_generations_today: number;
    };

    expect(body.plan.headline).toBe('Refined plan for steadier sugar and sleep');
    expect(body.plan.plan.action_checklist).toEqual(expect.arrayContaining(['Eat dinner earlier', 'Walk for 15 minutes after lunch']));
    expect(body.remaining_generations_today).toBe(0);
    expect(body.plan.plan.eat_more.some((item) => item.toLowerCase().includes('dal'))).toBe(true);
  });

  it('falls back to Ollama Cloud when Workers AI binding is unavailable', async () => {
    let planCountChecks = 0;
    globalThis.fetch = vi.fn(async (input) => {
      expect(String(input)).toContain('ollama.com/api/chat');
      return new Response(JSON.stringify({
        message: {
          content: JSON.stringify({
            headline: 'Local food focused fallback plan',
            summary: 'Use local meals and simple routines this week.',
            focus_areas: ['Food routine'],
            eat_more: ['Dal and vegetables'],
            avoid_or_reduce: ['Sweet tea'],
            daily_routine: ['Eat dinner on time'],
            exercise_plan: ['Walk after dinner'],
            action_checklist: ['Walk after dinner'],
            follow_up_actions: ['Review with a doctor if symptoms continue'],
            warning_signs: ['New severe symptoms'],
            doctor_consultation_advice: ['See a doctor if symptoms worsen'],
            disclaimer: 'This is basic guidance and not a diagnosis.',
            confidence: 'medium',
            data_gaps: ['No recent lab report uploaded'],
          }),
        },
        prompt_eval_count: 40,
        eval_count: 50,
      }), { status: 200 });
    }) as typeof fetch;

    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'patient@example.com',
              phone: '01711111111',
              uhid: 'OZ-12345',
              name: 'Test Patient',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity')) {
          return {
            first: {
              id: 11,
              uhid: 'OZ-12345',
              primary_name: 'Test Patient',
              primary_phone: '01711111111',
              primary_email: 'patient@example.com',
              date_of_birth: '1990-01-01',
              gender: 'female',
              claim_status: 'claimed',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patients p') && normalized.includes('join tenants t on t.id = p.tenant_id')) {
          return {
            results: [{ tenant_id: 'tenant-1', hospital_name: 'Hospital One', patient_id: 10 }],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select count(*) as total from patient_ai_plans')) {
          const total = planCountChecks === 0 ? 0 : 1;
          planCountChecks += 1;
          return { first: { total }, success: true, meta: {} };
        }
        if (normalized.includes('select id, headline, summary, confidence, plan_json, source_snapshot_json, created_at') && normalized.includes('from patient_ai_plans')) {
          return {
            results: [{
              id: 1,
              headline: 'Local food focused fallback plan',
              summary: 'Use local meals and simple routines this week.',
              confidence: 'medium',
              source_snapshot_json: JSON.stringify({ vitals: [], lifestyle_logs: [] }),
              plan_json: JSON.stringify({
                headline: 'Local food focused fallback plan',
                summary: 'Use local meals and simple routines this week.',
                focus_areas: ['Food routine'],
                eat_more: ['Dal and vegetables'],
                avoid_or_reduce: ['Sweet tea'],
                daily_routine: ['Eat dinner on time'],
                exercise_plan: ['Walk after dinner'],
                action_checklist: ['Walk after dinner'],
                follow_up_actions: ['Review with a doctor if symptoms continue'],
                warning_signs: ['New severe symptoms'],
                doctor_consultation_advice: ['See a doctor if symptoms worsen'],
                disclaimer: 'This is basic guidance and not a diagnosis.',
                confidence: 'medium',
                data_gaps: ['No recent lab report uploaded'],
              }),
              created_at: '2026-04-11T10:00:00Z',
            }],
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        global_patient_auth: [{ id: 5, identity_id: 11, uhid: 'OZ-12345', email: 'patient@example.com', phone: '01711111111', name: 'Test Patient', is_active: 1 }],
        global_patient_identity: [{ id: 11, uhid: 'OZ-12345', primary_name: 'Test Patient', primary_phone: '01711111111', primary_email: 'patient@example.com', claim_status: 'claimed' }],
        patients: [{ id: 10, tenant_id: 'tenant-1', uhid: 'OZ-12345', name: 'Test Patient', age: 36, gender: 'female', blood_group: 'A+' }],
        tenants: [{ id: 'tenant-1', name: 'Hospital One' }],
        patient_ai_plans: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
      extraEnv: {
        OLLAMA_API_KEY: 'ollama-key',
        PATIENT_AI_FALLBACK_MODEL: 'glm-5.1:cloud',
      } as any,
    });

    const token = await sign({ userId: 5, scope: 'global', role: 'patient' }, 'test-secret', 'HS256');
    const res = await jsonRequest(app, '/api/global-portal/ai-plans/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { plan: { plan: { eat_more: string[] } } };
    expect(body.plan.plan.eat_more.some((item) => item.toLowerCase().includes('dal'))).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});
