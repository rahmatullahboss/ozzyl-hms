import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import { carePlanRoutes } from '../src/routes/tenant/clinical/care-plans';

const ROUTE_PATH = '/clinical/care-plans';

function setupApp(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: carePlanRoutes,
    routePath: ROUTE_PATH,
    role: 'doctor',
    mockDB,
  });
  return { app, mockDB };
}

describe('Care Plans API', () => {

  // ─── GET / ──────────────────────────────────────────────────────────────

  it('GET / returns care plans for a patient', async () => {
    const { app } = setupApp({
      cln_careplan: [
        { CarePlanId: 1, tenant_id: 'tenant-1', PatientId: 10, PlanStatus: 'active', CarePlanType: 'chronic', IsDeleted: 0 },
        { CarePlanId: 2, tenant_id: 'tenant-1', PatientId: 10, PlanStatus: 'draft', CarePlanType: 'acute', IsDeleted: 0 },
      ],
    });

    const res = await jsonRequest(app, `${ROUTE_PATH}?patientId=10`);
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[] };
    expect(body.Results).toBeDefined();
    expect(Array.isArray(body.Results)).toBe(true);
  });

  it('GET / returns 400 when patientId is missing', async () => {
    const { app } = setupApp();

    const res = await jsonRequest(app, ROUTE_PATH);
    expect(res.status).toBe(400);
  });

  // ─── GET /:id ───────────────────────────────────────────────────────────

  it('GET /:id returns care plan with related data', async () => {
    const { app } = setupApp({
      cln_careplan: [
        { CarePlanId: 1, tenant_id: 'tenant-1', PatientId: 10, PlanStatus: 'active', IsDeleted: 0 },
      ],
      cln_careplangoal: [
        { GoalId: 1, CarePlanId: 1, tenant_id: 'tenant-1', IsDeleted: 0 },
      ],
      cln_careplanintervention: [],
      cln_careplantask: [],
      cln_careplanteammember: [],
      cln_careplanprogressnote: [],
    });

    const res = await jsonRequest(app, `${ROUTE_PATH}/1`);
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, unknown> };
    expect(body.Results).toBeDefined();
    expect(body.Results.Goals).toBeDefined();
    expect(body.Results.Interventions).toBeDefined();
    expect(body.Results.Tasks).toBeDefined();
    expect(body.Results.TeamMembers).toBeDefined();
    expect(body.Results.ProgressNotes).toBeDefined();
  });

  // ─── POST / ─────────────────────────────────────────────────────────────

  it('POST / creates care plan with valid data', async () => {
    const { app } = setupApp();

    const res = await jsonRequest(app, ROUTE_PATH, {
      method: 'POST',
      body: {
        PatientId: 10,
        CarePlanType: 'chronic',
        Description: 'Diabetes management plan',
        PlanStatus: 'active',
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

  it('POST / returns 400 with invalid status', async () => {
    const { app } = setupApp();

    const res = await jsonRequest(app, ROUTE_PATH, {
      method: 'POST',
      body: {
        PatientId: 10,
        CarePlanType: 'chronic',
        Description: 'Test plan',
        PlanStatus: 'invalid-status',
      },
    });

    expect(res.status).toBe(400);
  });

  it('POST / returns 400 when required fields are missing', async () => {
    const { app } = setupApp();

    const res = await jsonRequest(app, ROUTE_PATH, {
      method: 'POST',
      body: {
        PatientId: 10,
      },
    });

    expect(res.status).toBe(400);
  });

  // ─── PUT /:id ───────────────────────────────────────────────────────────

  it('PUT /:id updates care plan', async () => {
    const { app } = setupApp({
      cln_careplan: [
        { CarePlanId: 1, tenant_id: 'tenant-1', PatientId: 10, PlanStatus: 'active', IsDeleted: 0 },
      ],
    });

    const res = await jsonRequest(app, `${ROUTE_PATH}/1`, {
      method: 'PUT',
      body: {
        PlanStatus: 'completed',
        Description: 'Updated description',
      },
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { message: string } };
    expect(body.Results.message).toBe('Care plan updated');
  });

  it('PUT /:id returns 404 for non-existent plan', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: carePlanRoutes,
      routePath: ROUTE_PATH,
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, `${ROUTE_PATH}/999`, {
      method: 'PUT',
      body: { PlanStatus: 'completed' },
    });

    expect(res.status).toBe(404);
  });

  // ─── DELETE /:id ────────────────────────────────────────────────────────

  it('DELETE /:id soft deletes care plan', async () => {
    const { app } = setupApp({
      cln_careplan: [
        { CarePlanId: 1, tenant_id: 'tenant-1', PatientId: 10, IsDeleted: 0 },
      ],
    });

    const res = await jsonRequest(app, `${ROUTE_PATH}/1`, {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { message: string } };
    expect(body.Results.message).toBe('Care plan deleted');
  });

  // ─── POST /:id/goals ────────────────────────────────────────────────────

  it('POST /:id/goals adds goal to care plan', async () => {
    const { app } = setupApp({
      cln_careplan: [
        { CarePlanId: 1, tenant_id: 'tenant-1', PatientId: 10, IsDeleted: 0 },
      ],
    });

    const res = await jsonRequest(app, `${ROUTE_PATH}/1/goals`, {
      method: 'POST',
      body: {
        GoalDescription: 'Reduce HbA1c to below 7',
        Priority: 'high',
        CurrentStatus: 'in-progress',
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

  it('POST /:id/goals returns 400 with invalid priority', async () => {
    const { app } = setupApp();

    const res = await jsonRequest(app, `${ROUTE_PATH}/1/goals`, {
      method: 'POST',
      body: {
        GoalDescription: 'Test goal',
        Priority: 'invalid',
        CurrentStatus: 'in-progress',
      },
    });

    expect(res.status).toBe(400);
  });

  // ─── POST /:id/interventions ────────────────────────────────────────────

  it('POST /:id/interventions adds intervention', async () => {
    const { app } = setupApp({
      cln_careplan: [
        { CarePlanId: 1, tenant_id: 'tenant-1', PatientId: 10, IsDeleted: 0 },
      ],
    });

    const res = await jsonRequest(app, `${ROUTE_PATH}/1/interventions`, {
      method: 'POST',
      body: {
        InterventionDescription: 'Daily blood glucose monitoring',
        Status: 'active',
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

  // ─── POST /:id/tasks ────────────────────────────────────────────────────

  it('POST /:id/tasks adds task', async () => {
    const { app } = setupApp({
      cln_careplan: [
        { CarePlanId: 1, tenant_id: 'tenant-1', PatientId: 10, IsDeleted: 0 },
      ],
    });

    const res = await jsonRequest(app, `${ROUTE_PATH}/1/tasks`, {
      method: 'POST',
      body: {
        TaskDescription: 'Review lab results',
        Status: 'pending',
        Priority: 'medium',
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

  // ─── POST /:id/team-members ─────────────────────────────────────────────

  it('POST /:id/team-members adds team member', async () => {
    const { app } = setupApp({
      cln_careplan: [
        { CarePlanId: 1, tenant_id: 'tenant-1', PatientId: 10, IsDeleted: 0 },
      ],
    });

    const res = await jsonRequest(app, `${ROUTE_PATH}/1/team-members`, {
      method: 'POST',
      body: {
        ProviderName: 'Dr. Smith',
        ProviderRole: 'Endocrinologist',
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

  it('POST /:id/team-members returns 400 when ProviderName is missing', async () => {
    const { app } = setupApp();

    const res = await jsonRequest(app, `${ROUTE_PATH}/1/team-members`, {
      method: 'POST',
      body: {
        ProviderRole: 'Nurse',
      },
    });

    expect(res.status).toBe(400);
  });
});
