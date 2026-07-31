import { describe, it, expect } from 'vitest';
import priorAuthRoutes from '../src/routes/tenant/priorAuth';
import { createTestApp } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

function makePriorAuthApp(overrides?: Parameters<typeof createMockDB>[0]) {
  const mockDB = createMockDB({
    universalFallback: true,
    ...overrides,
  });

  return createTestApp({
    route: priorAuthRoutes,
    routePath: '/prior-auth',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    userId: 1,
    mockDB,
  });
}

const validCreateBody = {
  PatientId: 1,
  EncounterId: 1,
  RequestType: 'medication' as const,
  Priority: 'routine' as const,
  ServiceCode: 'J0123',
  ServiceDescription: 'Amoxicillin 500mg',
  DiagnosisCodes: ['J06.9'],
  OrderingProviderId: 1,
};

const validUpdateStatusBody = {
  AuthStatus: 'approved' as const,
  AuthNumber: 'AUTH-001',
  AuthStartDate: '2026-01-01',
  AuthEndDate: '2026-12-31',
};

const validCommunicationBody = {
  CommunicationType: 'phone' as const,
  Direction: 'outbound' as const,
  ContactName: 'Jane Doe',
  Subject: 'Follow-up on auth request',
  Notes: 'Spoke with insurance rep, pending review.',
};

describe('Prior Authorization Routes', () => {
  // ─── GET / ────────────────────────────────────────────────────────────────

  it('GET / returns authorizations list', async () => {
    const { app } = makePriorAuthApp({
      tables: {
        priorauthorization: [
          { AuthId: 1, PatientId: 1, AuthStatus: 'pending', RequestType: 'medication', tenant_id: 'tenant-1', IsActive: 1 },
          { AuthId: 2, PatientId: 2, AuthStatus: 'approved', RequestType: 'procedure', tenant_id: 'tenant-1', IsActive: 1 },
        ],
      },
    });

    const res = await app.request('/prior-auth', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[] };
    expect(body.Results).toBeDefined();
    expect(Array.isArray(body.Results)).toBe(true);
    expect(body.Results.length).toBe(2);
  });

  it('GET / with patientId filter narrows results', async () => {
    const { app } = makePriorAuthApp({
      tables: {
        priorauthorization: [
          { AuthId: 1, PatientId: 10, AuthStatus: 'pending', RequestType: 'medication', tenant_id: 'tenant-1', IsActive: 1 },
          { AuthId: 2, PatientId: 20, AuthStatus: 'approved', RequestType: 'procedure', tenant_id: 'tenant-1', IsActive: 1 },
        ],
      },
    });

    const res = await app.request('/prior-auth?patientId=10', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[] };
    expect(body.Results).toBeDefined();
    expect(body.Results.length).toBe(1);
  });

  // ─── GET /templates ───────────────────────────────────────────────────────

  it('GET /templates returns templates', async () => {
    const { app } = makePriorAuthApp({
      tables: {
        priorauthorizationtemplate: [
          { TemplateId: 1, TemplateName: 'MRI Brain', RequestType: 'imaging', tenant_id: 'tenant-1', IsActive: 1 },
        ],
      },
    });

    const res = await app.request('/prior-auth/templates', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[] };
    expect(body.Results).toBeDefined();
    expect(Array.isArray(body.Results)).toBe(true);
  });

  // ─── GET /:id ─────────────────────────────────────────────────────────────

  it('GET /:id returns single authorization', async () => {
    const { app } = makePriorAuthApp({
      tables: {
        priorauthorization: [
          { AuthId: 1, PatientId: 1, AuthStatus: 'pending', RequestType: 'medication', tenant_id: 'tenant-1', IsActive: 1 },
        ],
        priorauthorizationitem: [],
        priorauthorizationcommunication: [],
      },
    });

    const res = await app.request('/prior-auth/1', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { auth: unknown; items: unknown[]; communications: unknown[] } };
    expect(body.Results).toBeDefined();
    expect(body.Results.auth).toBeDefined();
    expect(Array.isArray(body.Results.items)).toBe(true);
    expect(Array.isArray(body.Results.communications)).toBe(true);
  });

  it('GET /:id returns 404 when authorization not found', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: priorAuthRoutes,
      routePath: '/prior-auth',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      mockDB,
    });

    const res = await app.request('/prior-auth/999', { method: 'GET' });
    expect(res.status).toBe(404);
  });

  // ─── POST / ───────────────────────────────────────────────────────────────

  it('POST / creates authorization with valid data', async () => {
    const { app } = makePriorAuthApp();

    const res = await app.request('/prior-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCreateBody),
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
    expect(typeof body.Results.id).toBe('number');
  });

  it('POST / with invalid request_type returns 400', async () => {
    const { app } = makePriorAuthApp();

    const res = await app.request('/prior-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validCreateBody,
        RequestType: 'invalid_type',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('POST / with missing required fields returns 400', async () => {
    const { app } = makePriorAuthApp();

    const res = await app.request('/prior-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        PatientId: 1,
      }),
    });

    expect(res.status).toBe(400);
  });

  it('POST / creates authorization with items', async () => {
    const { app } = makePriorAuthApp();

    const res = await app.request('/prior-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validCreateBody,
        Items: [
          { ServiceCode: 'J0123', ServiceDescription: 'Amoxicillin 500mg', Quantity: 30, UnitPrice: 0.5 },
        ],
      }),
    });

    expect(res.status).toBe(201);
  });

  // ─── PUT /:id/status ──────────────────────────────────────────────────────

  it('PUT /:id/status updates to approved', async () => {
    const { app } = makePriorAuthApp();

    const res = await app.request('/prior-auth/1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validUpdateStatusBody),
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { success: boolean } };
    expect(body.Results.success).toBe(true);
  });

  it('PUT /:id/status updates to denied with denial reason', async () => {
    const { app } = makePriorAuthApp();

    const res = await app.request('/prior-auth/1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        AuthStatus: 'denied',
        DenialCode: 'D001',
        DenialReason: 'Service not covered under patient plan',
      }),
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { success: boolean } };
    expect(body.Results.success).toBe(true);
  });

  it('PUT /:id/status with invalid status returns 400', async () => {
    const { app } = makePriorAuthApp();

    const res = await app.request('/prior-auth/1/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        AuthStatus: 'invalid_status',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('PUT /:id/status returns 404 when not found', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: priorAuthRoutes,
      routePath: '/prior-auth',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      mockDB,
    });

    const res = await app.request('/prior-auth/999/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ AuthStatus: 'approved' }),
    });

    expect(res.status).toBe(404);
  });

  // ─── POST /:id/communication ──────────────────────────────────────────────

  it('POST /:id/communication adds communication', async () => {
    const { app } = makePriorAuthApp();

    const res = await app.request('/prior-auth/1/communication', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCommunicationBody),
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
    expect(typeof body.Results.id).toBe('number');
  });

  it('POST /:id/communication with invalid type returns 400', async () => {
    const { app } = makePriorAuthApp();

    const res = await app.request('/prior-auth/1/communication', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        CommunicationType: 'invalid',
        Direction: 'outbound',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('POST /:id/communication returns 404 when auth not found', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: priorAuthRoutes,
      routePath: '/prior-auth',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      mockDB,
    });

    const res = await app.request('/prior-auth/999/communication', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validCommunicationBody),
    });

    expect(res.status).toBe(404);
  });
});
