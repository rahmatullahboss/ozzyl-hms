/**
 * Psychiatry — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Covers MSE, suicide risk assessments, therapy notes, evaluations,
 * medications, and safety plans endpoints.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, doctorHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface MentalStatusExam {
  id: number;
  patient_id: number;
  suicide_risk: string;
  violence_risk: string;
  tenant_id: number;
  created_at: string;
}

interface SuicideRiskAssessment {
  id: number;
  patient_id: number;
  overall_risk: string;
  tenant_id: number;
  created_at: string;
}

interface TherapySessionNote {
  id: number;
  patient_id: number;
  session_type: string;
  tenant_id: number;
  created_at: string;
}

interface PaginatedResponse<T> {
  Results?: T[];
  data?: T[];
  items?: T[];
}

let adminH: Record<string, string>;
let doctorH: Record<string, string>;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  doctorH = await doctorHeaders();
});

// ═══════════════════════════════════════════════════════════════════════════
// Mental Status Examination
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/psychiatry/mse/:patientId', () => {
  it('returns list of MSE records for a patient', async () => {
    const res = await api.get<PaginatedResponse<MentalStatusExam>>(
      '/api/psychiatry/mse/1001',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.Results ?? res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/psychiatry/mse/1001',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/psychiatry/mse', () => {
  let createdId: number | null = null;

  it('creates MSE with valid data', async () => {
    const payload = {
      PatientId: 1001,
      Appearance: 'Well-groomed, appropriate dress',
      Behavior: 'Cooperative, calm',
      Mood: 'Euthymic',
      Affect: 'Congruent, full range',
      ThoughtProcess: 'Linear, goal-directed',
      SuicidalIdeation: false,
      SuicidalPlan: false,
      SuicidalIntent: false,
      HomicidalIdeation: false,
      Delusions: false,
      Hallucinations: false,
      SuicideRisk: 'low',
      ViolenceRisk: 'low',
      ClinicalNotes: 'Integration test MSE entry',
    };

    const res = await api.post<{ Results?: { id: number } }>(
      '/api/psychiatry/mse',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
    if (res.body.Results?.id) {
      createdId = res.body.Results.id;
      expect(typeof createdId).toBe('number');
    }
  });

  it('returns 400 for missing required fields', async () => {
    const res = await api.post(
      '/api/psychiatry/mse',
      adminH,
      { PatientId: 1001 },
    );
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/psychiatry/mse',
      noAuthHeaders(),
      { PatientId: 1001, SuicideRisk: 'low', ViolenceRisk: 'low' },
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suicide Risk Assessment
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/psychiatry/suicide-risk/:patientId', () => {
  it('returns list of suicide risk assessments', async () => {
    const res = await api.get<PaginatedResponse<SuicideRiskAssessment>>(
      '/api/psychiatry/suicide-risk/1001',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.Results ?? res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/psychiatry/suicide-risk/1001',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/psychiatry/suicide-risk', () => {
  it('creates suicide risk assessment', async () => {
    const payload = {
      PatientId: 1001,
      WishToBeDead: false,
      ActiveSuicidalIdeation: false,
      ActiveIdeationWithPlan: false,
      ActiveIdeationWithIntent: false,
      ActualAttempt: false,
      ActualAttemptCount: 0,
      RecentIdeation: false,
      RecentAttempt: false,
      OverallRisk: 'low',
      RiskLevel: 1,
      SafetyPlanCreated: false,
      Disposition: 'routine-followup',
      DispositionNotes: 'Integration test assessment',
    };

    const res = await api.post<{ Results?: { id: number } }>(
      '/api/psychiatry/suicide-risk',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/psychiatry/suicide-risk',
      noAuthHeaders(),
      { PatientId: 1001, OverallRisk: 'low', RiskLevel: 1, Disposition: 'routine-followup' },
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Therapy Session Notes
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/psychiatry/therapy-notes/:patientId', () => {
  it('returns list of therapy notes', async () => {
    const res = await api.get<PaginatedResponse<TherapySessionNote>>(
      '/api/psychiatry/therapy-notes/1001',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.Results ?? res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/psychiatry/therapy-notes/1001',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/psychiatry/therapy-notes', () => {
  it('creates therapy session note', async () => {
    const payload = {
      PatientId: 1001,
      SessionDate: new Date().toISOString(),
      SessionType: 'individual',
      Duration: 50,
      ChiefComplaint: 'Integration test session',
      PatientEngagement: 'good',
      ProgressTowardsGoals: 'moderate',
      SessionSuicideRisk: 'low',
    };

    const res = await api.post<{ Results?: { id: number } }>(
      '/api/psychiatry/therapy-notes',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await api.post(
      '/api/psychiatry/therapy-notes',
      adminH,
      { PatientId: 1001 },
    );
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/psychiatry/therapy-notes',
      noAuthHeaders(),
      { PatientId: 1001, SessionDate: new Date().toISOString(), SessionType: 'individual', Duration: 50, PatientEngagement: 'good', ProgressTowardsGoals: 'moderate', SessionSuicideRisk: 'low' },
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Psychiatric Evaluations
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/psychiatry/evaluations/:patientId', () => {
  it('returns list of evaluations', async () => {
    const res = await api.get<PaginatedResponse<unknown>>(
      '/api/psychiatry/evaluations/1001',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.Results ?? res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/psychiatry/evaluations/1001',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Psychiatric Medications
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/psychiatry/medications/:patientId', () => {
  it('returns list of psychiatric medications', async () => {
    const res = await api.get<PaginatedResponse<unknown>>(
      '/api/psychiatry/medications/1001',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.Results ?? res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('filters by active status', async () => {
    const res = await api.get<PaginatedResponse<unknown>>(
      '/api/psychiatry/medications/1001?status=active',
      adminH,
    );
    expect(res.status).toBe(200);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/psychiatry/medications/1001',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/psychiatry/medications', () => {
  it('creates a psychiatric medication record', async () => {
    const payload = {
      PatientId: 1001,
      MedicationName: 'Sertraline',
      MedicationClass: 'SSRI',
      Dose: '50mg',
      Frequency: 'daily',
      Route: 'oral',
      Indication: 'Major Depressive Disorder',
      IsControlled: false,
    };

    const res = await api.post<{ Results?: { id: number } }>(
      '/api/psychiatry/medications',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/psychiatry/medications',
      noAuthHeaders(),
      { PatientId: 1001, MedicationName: 'Test', Dose: '10mg', Frequency: 'daily' },
    );
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Safety Plans
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/psychiatry/safety-plan/:patientId', () => {
  it('returns safety plan for patient', async () => {
    const res = await api.get<{ Results: unknown }>(
      '/api/psychiatry/safety-plan/1001',
      adminH,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('Results');
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/psychiatry/safety-plan/1001',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/psychiatry/safety-plan', () => {
  it('creates a safety plan', async () => {
    const payload = {
      PatientId: 1001,
      WarningSigns: ['isolation', 'hopelessness'],
      CopingStrategies: ['deep breathing', 'call friend'],
      SocialContacts: ['John Doe - 555-0100'],
      FamilySupport: ['Jane Doe - 555-0101'],
      FriendsSupport: ['Bob Smith - 555-0102'],
      EmergencyContact: 'Jane Doe',
      EmergencyContactPhone: '555-0101',
      CrisisLine: '988',
    };

    const res = await api.post<{ Results?: { id: number } }>(
      '/api/psychiatry/safety-plan',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/psychiatry/safety-plan',
      noAuthHeaders(),
      { PatientId: 1001, WarningSigns: [], CopingStrategies: [], SocialContacts: [], FamilySupport: [], FriendsSupport: [], EmergencyContact: 'Test', EmergencyContactPhone: '555-0000' },
    );
    expect(res.status).toBe(401);
  });
});
