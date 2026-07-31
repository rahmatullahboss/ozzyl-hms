import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, doctorHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface PriorAuthorization {
  AuthId: number;
  PatientId: number;
  EncounterId: number;
  RequestType: string;
  Priority: string;
  ServiceCode: string;
  ServiceDescription: string;
  AuthStatus: string;
  DiagnosisCodes: string;
  OrderingProviderId: number;
  tenant_id: number;
  IsActive: number;
}

let adminH: Record<string, string>;
let doctorH: Record<string, string>;
let createdAuthId: number | null = null;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  doctorH = await doctorHeaders();
});

describe('GET /api/prior-auth — list', () => {
  it('returns authorizations list with Results array', async () => {
    const res = await api.get<{ Results: PriorAuthorization[] }>('/api/prior-auth', adminH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.Results)).toBe(true);
  });

  it('filters by patientId', async () => {
    const res = await api.get<{ Results: PriorAuthorization[] }>('/api/prior-auth?patientId=1001', adminH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.Results)).toBe(true);
    if (res.body.Results.length > 0) {
      res.body.Results.forEach(auth => {
        expect(auth.PatientId).toBe(1001);
      });
    }
  });

  it('returns 401 without authentication', async () => {
    const res = await api.get('/api/prior-auth', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/prior-auth/templates — list templates', () => {
  it('returns templates list', async () => {
    const res = await api.get<{ Results: unknown[] }>('/api/prior-auth/templates', adminH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.Results)).toBe(true);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.get('/api/prior-auth/templates', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('POST /api/prior-auth — create authorization', () => {
  it('creates authorization with valid data', async () => {
    const payload = {
      PatientId: 1001,
      EncounterId: 2001,
      RequestType: 'medication',
      Priority: 'routine',
      ServiceCode: 'MED-001',
      ServiceDescription: 'Prior auth for specialty medication',
      DiagnosisCodes: ['E11.9', 'I10'],
      OrderingProviderId: 105,
      ClinicalNotes: 'Patient requires this medication for chronic condition.',
    };

    const res = await api.post<{ Results: { id: number } }>('/api/prior-auth', adminH, payload);
    expect(res.status).toBe(201);
    expect(res.body.Results).toHaveProperty('id');
    createdAuthId = res.body.Results.id;
  });

  it('returns 400 for invalid request_type', async () => {
    const payload = {
      PatientId: 1001,
      EncounterId: 2001,
      RequestType: 'invalid_type',
      Priority: 'routine',
      ServiceCode: 'MED-001',
      ServiceDescription: 'Test',
      DiagnosisCodes: ['E11.9'],
      OrderingProviderId: 105,
    };

    const res = await api.post('/api/prior-auth', adminH, payload);
    expect(res.status).toBe(400);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.post('/api/prior-auth', noAuthHeaders(), { PatientId: 1001 });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/prior-auth/:id — single authorization', () => {
  it('returns authorization with items and communications', async () => {
    if (!createdAuthId) return;

    const res = await api.get<{ Results: { auth: PriorAuthorization; items: unknown[]; communications: unknown[] } }>(
      `/api/prior-auth/${createdAuthId}`,
      adminH,
    );
    expect(res.status).toBe(200);
    expect(res.body.Results).toHaveProperty('auth');
    expect(res.body.Results).toHaveProperty('items');
    expect(res.body.Results).toHaveProperty('communications');
    expect(res.body.Results.auth.AuthId).toBe(createdAuthId);
  });

  it('returns 404 for non-existent authorization', async () => {
    const res = await api.get('/api/prior-auth/999999', adminH);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/prior-auth/:id/status — update status', () => {
  it('updates status to approved', async () => {
    if (!createdAuthId) return;

    const res = await api.put<{ Results: { success: boolean } }>(
      `/api/prior-auth/${createdAuthId}/status`,
      adminH,
      {
        AuthStatus: 'approved',
        AuthNumber: 'AUTH-2024-001',
        AuthStartDate: '2024-01-01',
        AuthEndDate: '2024-12-31',
        ApprovedAmount: 5000,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.Results.success).toBe(true);
  });

  it('updates status to denied with denial reason', async () => {
    if (!createdAuthId) return;

    const res = await api.put<{ Results: { success: boolean } }>(
      `/api/prior-auth/${createdAuthId}/status`,
      adminH,
      {
        AuthStatus: 'denied',
        DenialCode: 'DENY-001',
        DenialReason: 'Service not covered under patient plan.',
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.Results.success).toBe(true);
  });

  it('returns 404 for non-existent authorization', async () => {
    const res = await api.put('/api/prior-auth/999999/status', adminH, { AuthStatus: 'approved' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/prior-auth/:id/communication — add communication', () => {
  it('adds communication log', async () => {
    if (!createdAuthId) return;

    const res = await api.post<{ Results: { id: number } }>(
      `/api/prior-auth/${createdAuthId}/communication`,
      adminH,
      {
        CommunicationType: 'phone',
        Direction: 'outbound',
        ContactName: 'Insurance Rep',
        ContactPhone: '555-0100',
        Subject: 'Follow-up on prior auth request',
        Notes: 'Spoke with representative, awaiting decision.',
        FollowupRequired: true,
        FollowupDate: '2024-02-01',
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.Results).toHaveProperty('id');
  });

  it('returns 404 for non-existent authorization', async () => {
    const res = await api.post('/api/prior-auth/999999/communication', adminH, {
      CommunicationType: 'phone',
      Direction: 'outbound',
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/prior-auth/:id — soft delete', () => {
  it('soft deletes authorization', async () => {
    if (!createdAuthId) return;

    const res = await api.delete<{ Results: { success: boolean } }>(
      `/api/prior-auth/${createdAuthId}`,
      adminH,
    );
    expect(res.status).toBe(200);
    expect(res.body.Results.success).toBe(true);
  });

  it('deleted authorization no longer appears in active list', async () => {
    if (!createdAuthId) return;

    const res = await api.get<{ Results: PriorAuthorization[] }>('/api/prior-auth', adminH);
    expect(res.status).toBe(200);
    const found = res.body.Results.find(a => a.AuthId === createdAuthId);
    expect(found).toBeUndefined();
  });

  it('returns 404 for non-existent authorization', async () => {
    const res = await api.delete('/api/prior-auth/999999', adminH);
    expect(res.status).toBe(404);
  });
});
