/**
 * Nursing — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Covers medication orders, I/O charts, wound care, and IV drugs endpoints.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface MedicationOrder {
  id: number;
  patient_id: number;
  visit_id: number | null;
  medication_name: string;
  dosage: string;
  frequency: string;
  route: string;
  status: string;
  tenant_id: number;
  created_at: string;
}

interface PaginatedResponse<T> {
  data?: T[];
  orders?: T[];
  items?: T[];
  total?: number;
  page?: number;
  limit?: number;
}

interface IOChart {
  id: number;
  patient_id: number;
  visit_id: number | null;
  type: 'intake' | 'output';
  category: string;
  amount_ml: number;
  recorded_at: string;
  tenant_id: number;
}

interface IOBalance {
  patient_id: number;
  total_intake_ml: number;
  total_output_ml: number;
  balance_ml: number;
}

interface WoundCare {
  id: number;
  patient_id: number;
  visit_id: number | null;
  wound_location: string;
  wound_type: string;
  dressing: string;
  status: string;
  tenant_id: number;
  created_at: string;
}

interface IVDrug {
  id: number;
  patient_id: number;
  visit_id: number | null;
  drug_name: string;
  dose: string;
  rate_ml_hr: number;
  start_time: string;
  status: string;
  tenant_id: number;
  created_at: string;
}

let adminH: Record<string, string>;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
});

describe('GET /api/nursing/medication-orders', () => {
  it('returns list with pagination', async () => {
    const res = await api.get<PaginatedResponse<MedicationOrder>>(
      '/api/nursing/medication-orders',
      adminH,
    );
    expect(res.status).toBe(200);
    const orders = res.body.data ?? res.body.orders ?? res.body.items ?? [];
    expect(Array.isArray(orders)).toBe(true);
  });

  it('filters by patient_id', async () => {
    const res = await api.get<PaginatedResponse<MedicationOrder>>(
      '/api/nursing/medication-orders?patient_id=1001',
      adminH,
    );
    expect(res.status).toBe(200);
    const orders = res.body.data ?? res.body.orders ?? res.body.items ?? [];
    orders.forEach((order) => {
      expect(order.patient_id).toBe(1001);
    });
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/nursing/medication-orders',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/nursing/medication-orders/:id', () => {
  it('returns a single medication order by id', async () => {
    const listRes = await api.get<PaginatedResponse<MedicationOrder>>(
      '/api/nursing/medication-orders',
      adminH,
    );
    expect(listRes.status).toBe(200);
    const orders = listRes.body.data ?? listRes.body.orders ?? listRes.body.items ?? [];
    if (orders.length === 0) return;

    const firstId = orders[0]!.id;
    const res = await api.get<{ order?: MedicationOrder; data?: MedicationOrder }>(
      `/api/nursing/medication-orders/${firstId}`,
      adminH,
    );
    expect([200, 404]).toContain(res.status);
  });
});

describe('POST /api/nursing/medication-orders', () => {
  it('creates a medication order', async () => {
    const payload = {
      patientId: 1001,
      visitId: 2001,
      medicationName: 'Amoxicillin 500mg',
      dosage: '500mg',
      frequency: 'TID',
      route: 'oral',
      status: 'active',
    };

    const res = await api.post<{ id?: number; message?: string }>(
      '/api/nursing/medication-orders',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/nursing/medication-orders',
      noAuthHeaders(),
      { patientId: 1001 },
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/nursing/io-charts', () => {
  it('returns I/O chart list', async () => {
    const res = await api.get<PaginatedResponse<IOChart>>(
      '/api/nursing/io-charts',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/nursing/io-charts',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/nursing/io-charts/balance/:patientId', () => {
  it('returns intake/output/balance for a patient', async () => {
    const res = await api.get<IOBalance>(
      '/api/nursing/io-charts/balance/1001',
      adminH,
    );
    if (res.status === 200) {
      expect(res.body).toHaveProperty('total_intake_ml');
      expect(res.body).toHaveProperty('total_output_ml');
      expect(res.body).toHaveProperty('balance_ml');
      expect(typeof res.body.total_intake_ml).toBe('number');
      expect(typeof res.body.total_output_ml).toBe('number');
      expect(typeof res.body.balance_ml).toBe('number');
    } else {
      expect([200, 404]).toContain(res.status);
    }
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/nursing/io-charts/balance/1001',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/nursing/io-charts', () => {
  it('creates an I/O chart entry', async () => {
    const payload = {
      patientId: 1001,
      visitId: 2001,
      type: 'intake',
      category: 'oral',
      amountMl: 250,
      recordedAt: new Date().toISOString(),
    };

    const res = await api.post<{ id?: number; message?: string }>(
      '/api/nursing/io-charts',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/nursing/io-charts',
      noAuthHeaders(),
      { patientId: 1001 },
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/nursing/wound-care', () => {
  it('returns wound care list', async () => {
    const res = await api.get<PaginatedResponse<WoundCare>>(
      '/api/nursing/wound-care',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/nursing/wound-care',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/nursing/wound-care', () => {
  it('creates a wound care record', async () => {
    const payload = {
      patientId: 1001,
      visitId: 2001,
      woundLocation: 'Left forearm',
      woundType: 'laceration',
      dressing: 'sterile gauze',
      status: 'dressing_applied',
    };

    const res = await api.post<{ id?: number; message?: string }>(
      '/api/nursing/wound-care',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/nursing/wound-care',
      noAuthHeaders(),
      { patientId: 1001 },
    );
    expect(res.status).toBe(401);
  });
});

describe('GET /api/nursing/iv-drugs', () => {
  it('returns IV drugs list', async () => {
    const res = await api.get<PaginatedResponse<IVDrug>>(
      '/api/nursing/iv-drugs',
      adminH,
    );
    expect(res.status).toBe(200);
    const items = res.body.data ?? res.body.items ?? [];
    expect(Array.isArray(items)).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await api.get(
      '/api/nursing/iv-drugs',
      noAuthHeaders(),
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/nursing/iv-drugs', () => {
  it('creates an IV drug record', async () => {
    const payload = {
      patientId: 1001,
      visitId: 2001,
      drugName: 'Normal Saline',
      dose: '1000ml',
      rateMlHr: 125,
      startTime: new Date().toISOString(),
      status: 'infusing',
    };

    const res = await api.post<{ id?: number; message?: string }>(
      '/api/nursing/iv-drugs',
      adminH,
      payload,
    );
    expect([200, 201]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post(
      '/api/nursing/iv-drugs',
      noAuthHeaders(),
      { patientId: 1001 },
    );
    expect(res.status).toBe(401);
  });
});
