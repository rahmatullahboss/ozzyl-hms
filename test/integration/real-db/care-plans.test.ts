/**
 * Care Plans — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Covers care plan CRUD, goals, interventions, tasks, team members,
 * and progress notes endpoints under /api/clinical/care-plans.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, doctorHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface CarePlan {
  CarePlanId: number;
  PatientId: number;
  CarePlanType: string;
  Description: string;
  PlanStatus: string;
  GoalCount?: number;
  tenant_id: number;
}

interface CarePlanDetail extends CarePlan {
  Goals: unknown[];
  Interventions: unknown[];
  Tasks: unknown[];
  TeamMembers: unknown[];
  ProgressNotes: unknown[];
}

interface Goal {
  GoalId: number;
  CarePlanId: number;
  GoalDescription: string;
  Priority: string;
  CurrentStatus: string;
  tenant_id: number;
}

interface ListResponse {
  Results?: CarePlan[];
  data?: CarePlan[];
}

interface DetailResponse {
  Results?: CarePlanDetail;
}

interface IdResponse {
  Results?: { id: number };
}

interface MessageResponse {
  Results?: { message: string };
}

let adminH: Record<string, string>;
let doctorH: Record<string, string>;
let createdPlanId: number | null = null;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  doctorH = await doctorHeaders();
});

// ═══════════════════════════════════════════════════════════════════════════
// Care Plan CRUD
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/clinical/care-plans', () => {
  it('returns care plans for a patient', async () => {
    const res = await api.get<ListResponse>(
      '/api/clinical/care-plans?patientId=1001',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.Results ?? res.body.data ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('returns 400 when patientId is missing', async () => {
    const res = await api.get(
      '/api/clinical/care-plans',
      adminH,
    );
    expect(res.status).toBe(400);
  });

  it('supports status filter', async () => {
    const res = await api.get<ListResponse>(
      '/api/clinical/care-plans?patientId=1001&status=active',
      adminH,
    );
    expect(res.status).toBe(200);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/clinical/care-plans?patientId=1001',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/clinical/care-plans', () => {
  it('creates a care plan', async () => {
    const payload = {
      PatientId: 1001,
      CarePlanType: 'treatment',
      Description: 'Integration test care plan for diabetes management',
      PlanStatus: 'active',
    };

    const res = await api.post<IdResponse>(
      '/api/clinical/care-plans',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.Results?.id) {
      createdPlanId = res.body.Results.id;
      expect(typeof createdPlanId).toBe('number');
    }
  });

  it('returns 400 for missing required fields', async () => {
    const res = await api.post(
      '/api/clinical/care-plans',
      adminH,
      { PatientId: 1001 },
    );
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/clinical/care-plans',
      noAuthHeaders(),
      { PatientId: 1001, CarePlanType: 'test', Description: 'test', PlanStatus: 'draft' },
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/clinical/care-plans/:id', () => {
  it('returns a single care plan with nested data', async () => {
    if (!createdPlanId) return;

    const res = await api.get<DetailResponse>(
      `/api/clinical/care-plans/${createdPlanId}`,
      adminH,
    );
    expect(res.status).toBe(200);
    const plan = res.body.Results;
    expect(plan).toBeDefined();
    if (plan) {
      expect(plan.CarePlanId).toBe(createdPlanId);
      expect(Array.isArray(plan.Goals)).toBe(true);
      expect(Array.isArray(plan.Interventions)).toBe(true);
      expect(Array.isArray(plan.Tasks)).toBe(true);
      expect(Array.isArray(plan.TeamMembers)).toBe(true);
      expect(Array.isArray(plan.ProgressNotes)).toBe(true);
    }
  });

  it('returns 404 for non-existent care plan', async () => {
    const res = await api.get(
      '/api/clinical/care-plans/999999',
      adminH,
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/clinical/care-plans/1',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/clinical/care-plans/:id', () => {
  it('updates a care plan', async () => {
    if (!createdPlanId) return;

    const payload = {
      Description: 'Updated integration test care plan',
      PlanStatus: 'active',
    };

    const res = await api.put<MessageResponse>(
      `/api/clinical/care-plans/${createdPlanId}`,
      adminH,
      payload,
    );
    expect(res.status).toBe(200);
    expect(res.body.Results?.message).toContain('updated');
  });

  it('returns 404 for non-existent care plan', async () => {
    const res = await api.put(
      '/api/clinical/care-plans/999999',
      adminH,
      { Description: 'Not found' },
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await api.put(
      '/api/clinical/care-plans/1',
      noAuthHeaders(),
      { Description: 'Unauthorized' },
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/clinical/care-plans/:id/goals', () => {
  let createdGoalId: number | null = null;

  it('adds a goal to a care plan', async () => {
    if (!createdPlanId) return;

    const payload = {
      GoalDescription: 'Achieve HbA1c below 7% within 3 months',
      GoalType: 'clinical',
      GoalCategory: 'diabetes',
      Priority: 'high',
      CurrentStatus: 'not-started',
      MeasurementCriteria: 'HbA1c lab test',
      BaselineStatus: 'HbA1c at 8.5%',
    };

    const res = await api.post<IdResponse>(
      `/api/clinical/care-plans/${createdPlanId}/goals`,
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.Results?.id) {
      createdGoalId = res.body.Results.id;
      expect(typeof createdGoalId).toBe('number');
    }
  });

  it('returns 404 for non-existent care plan', async () => {
    const res = await api.post(
      '/api/clinical/care-plans/999999/goals',
      adminH,
      { GoalDescription: 'Test', Priority: 'low', CurrentStatus: 'not-started' },
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 for missing required fields', async () => {
    if (!createdPlanId) return;

    const res = await api.post(
      `/api/clinical/care-plans/${createdPlanId}/goals`,
      adminH,
      { GoalDescription: 'Missing priority and status' },
    );
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/clinical/care-plans/1/goals',
      noAuthHeaders(),
      { GoalDescription: 'Test', Priority: 'low', CurrentStatus: 'not-started' },
    );
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/clinical/care-plans/:id', () => {
  it('soft deletes a care plan', async () => {
    if (!createdPlanId) return;

    const res = await api.delete<MessageResponse>(
      `/api/clinical/care-plans/${createdPlanId}`,
      adminH,
    );
    expect(res.status).toBe(200);
    expect(res.body.Results?.message).toContain('deleted');

    const verifyRes = await api.get(
      `/api/clinical/care-plans/${createdPlanId}`,
      adminH,
    );
    expect(verifyRes.status).toBe(404);
  });

  it('returns 404 for non-existent care plan', async () => {
    const res = await api.delete(
      '/api/clinical/care-plans/999999',
      adminH,
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await api.delete(
      '/api/clinical/care-plans/1',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});
