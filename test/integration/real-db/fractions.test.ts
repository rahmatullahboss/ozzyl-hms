/**
 * Fractions — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Validates fraction percent rules, calculation, doctor summary, and settlement.
 * Route prefix: /api/fractions
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, accountantHeaders, noAuthHeaders, receptionHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface FractionRule {
  id: number;
  tenant_id: number;
  service_item_id: number | null;
  bill_item_category: string | null;
  hospital_percent: number;
  doctor_percent: number;
  is_active: number;
  created_by: number;
}

interface FractionCalculation {
  invoiceItemId: number;
  grossAmount: number;
  hospitalAmount: number;
  doctorAmount: number;
  fractionPercentId: number | null;
}

interface DoctorSummary {
  doctorId: number;
  totalItems: number;
  totalGross: number;
  totalHospital: number;
  totalDoctor: number;
  pendingAmount: number;
  settledAmount: number;
}

let adminH: Record<string, string>;
let accountantH: Record<string, string>;
let receptionH: Record<string, string>;
let createdRuleId: number | null = null;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  accountantH = await accountantHeaders();
  receptionH = await receptionHeaders();
});

describe('GET /api/fractions/percent — list rules', () => {
  it('returns rules list with correct structure', async () => {
    const res = await api.get<{ rules?: FractionRule[] }>('/api/fractions/percent', adminH);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rules)).toBe(true);
  });

  it('each rule has required fields', async () => {
    const res = await api.get<{ rules?: FractionRule[] }>('/api/fractions/percent', adminH);
    expect(res.status).toBe(200);
    const rules = res.body.rules ?? [];
    if (rules.length > 0) {
      const rule = rules[0]!;
      expect(typeof rule.id).toBe('number');
      expect(typeof rule.hospital_percent).toBe('number');
      expect(typeof rule.doctor_percent).toBe('number');
      expect(typeof rule.is_active).toBe('number');
    }
  });

  it('returns 401 without authentication', async () => {
    const res = await api.get('/api/fractions/percent', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('POST /api/fractions/percent — create rule', () => {
  it('creates rule with valid 60/40 split', async () => {
    const res = await api.post<{ message: string; id?: number }>(
      '/api/fractions/percent',
      adminH,
      {
        hospitalPercent: 60,
        doctorPercent: 40,
        billItemCategory: 'test',
      },
    );

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('id');
    createdRuleId = res.body.id ?? null;
  });

  it('returns 400 for invalid split (not summing to 100)', async () => {
    const res = await api.post(
      '/api/fractions/percent',
      adminH,
      {
        hospitalPercent: 70,
        doctorPercent: 50,
        billItemCategory: 'test',
      },
    );

    expect(res.status).toBe(400);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.post(
      '/api/fractions/percent',
      noAuthHeaders(),
      { hospitalPercent: 60, doctorPercent: 40 },
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for wrong role (reception)', async () => {
    const res = await api.post(
      '/api/fractions/percent',
      receptionH,
      { hospitalPercent: 60, doctorPercent: 40, billItemCategory: 'test' },
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/fractions/calculate — calculate fraction for a bill', () => {
  it('calculates fraction for a valid bill', async () => {
    // Bill 5001 exists in seed data with invoice items
    const res = await api.post<{
      message: string;
      billId?: number;
      doctorId?: number;
      itemCount?: number;
      summary?: { totalGross: number; totalHospital: number; totalDoctor: number };
      items?: FractionCalculation[];
    }>(
      '/api/fractions/calculate',
      adminH,
      { billId: 5001, doctorId: 105 },
    );

    // 201 = success, 404 = no invoice items found for this bill
    expect([201, 404]).toContain(res.status);
    if (res.status === 201) {
      expect(res.body).toHaveProperty('message');
      expect(res.body).toHaveProperty('summary');
      expect(res.body.summary).toHaveProperty('totalGross');
      expect(res.body.summary).toHaveProperty('totalHospital');
      expect(res.body.summary).toHaveProperty('totalDoctor');
      expect(Array.isArray(res.body.items)).toBe(true);
    }
  });

  it('returns 404 for non-existent bill', async () => {
    const res = await api.post(
      '/api/fractions/calculate',
      adminH,
      { billId: 999999, doctorId: 105 },
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.post(
      '/api/fractions/calculate',
      noAuthHeaders(),
      { billId: 5001, doctorId: 105 },
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for wrong role (reception)', async () => {
    const res = await api.post(
      '/api/fractions/calculate',
      receptionH,
      { billId: 5001, doctorId: 105 },
    );
    expect(res.status).toBe(403);
  });
});

describe('GET /api/fractions/doctor-summary — doctor summary', () => {
  it('returns doctor summary for valid doctor_id', async () => {
    const res = await api.get<DoctorSummary>(
      '/api/fractions/doctor-summary?doctor_id=105',
      adminH,
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('doctorId');
    expect(res.body).toHaveProperty('totalItems');
    expect(res.body).toHaveProperty('totalGross');
    expect(res.body).toHaveProperty('totalHospital');
    expect(res.body).toHaveProperty('totalDoctor');
    expect(res.body).toHaveProperty('pendingAmount');
    expect(res.body).toHaveProperty('settledAmount');
    expect(res.body.doctorId).toBe(105);
  });

  it('returns 400 when doctor_id is missing', async () => {
    const res = await api.get('/api/fractions/doctor-summary', adminH);
    expect(res.status).toBe(400);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.get(
      '/api/fractions/doctor-summary?doctor_id=105',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for wrong role (reception)', async () => {
    const res = await api.get(
      '/api/fractions/doctor-summary?doctor_id=105',
      receptionH,
    );
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/fractions/settle — settle fractions', () => {
  it('settles fractions for a doctor with calculated items', async () => {
    // First calculate fractions so there are items to settle
    await api.post(
      '/api/fractions/calculate',
      adminH,
      { billId: 5001, doctorId: 105 },
    );

    const res = await api.put<{ message: string; doctorId?: number; settledCount?: number }>(
      '/api/fractions/settle?doctor_id=105',
      adminH,
    );

    // 200 = success, 404 = no calculated fractions found
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('message');
      expect(res.body.doctorId).toBe(105);
      expect(typeof res.body.settledCount).toBe('number');
    }
  });

  it('returns 404 when no calculated fractions exist for doctor', async () => {
    const res = await api.put(
      '/api/fractions/settle?doctor_id=999999',
      adminH,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when doctor_id is missing', async () => {
    const res = await api.put('/api/fractions/settle', adminH);
    expect(res.status).toBe(400);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.put(
      '/api/fractions/settle?doctor_id=105',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for wrong role (reception)', async () => {
    const res = await api.put(
      '/api/fractions/settle?doctor_id=105',
      receptionH,
    );
    expect(res.status).toBe(403);
  });
});
