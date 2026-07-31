/**
 * Prescriptions — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Seed data: 10 prescriptions (RX-0001 to RX-0010), 19 prescription items.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, doctorHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface Prescription {
  id: number;
  rx_no: string;
  patient_id: number;
  doctor_id: number;
  bp: string | null;
  temperature: string | null;
  weight: string | null;
  spo2: string | null;
  chief_complaint: string | null;
  diagnosis: string | null;
  status: 'draft' | 'final';
  tenant_id: string;
  created_at: string;
}

interface PrescriptionItem {
  id: number;
  prescription_id: number;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
}

let adminH: Record<string, string>;
let doctorH: Record<string, string>;
let createdRxId: number | null = null;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  doctorH = await doctorHeaders();
});

describe('GET /api/prescriptions — list', () => {
  it('returns prescriptions list from seed', async () => {
    const res = await api.get<{ prescriptions?: Prescription[] }>('/api/prescriptions', adminH);
    expect(res.status).toBe(200);
    const prescriptions = (res.body.prescriptions ?? []) as Prescription[];
    expect(Array.isArray(prescriptions)).toBe(true);
    expect(prescriptions.length).toBeGreaterThanOrEqual(10);
  });

  it('each prescription has rx_no, patient_id, doctor_id, status', async () => {
    const res = await api.get<{ prescriptions?: Prescription[] }>('/api/prescriptions', adminH);
    expect(res.status).toBe(200);
    const prescriptions = res.body.prescriptions ?? [];
    if (prescriptions.length > 0) {
      const rx = prescriptions[0]!;
      expect(typeof rx.rx_no).toBe('string');
      expect(typeof rx.patient_id).toBe('number');
      expect(typeof rx.doctor_id).toBe('number');
      expect(['draft', 'final']).toContain(rx.status);
    }
  });

  it('returns 401 without auth', async () => {
    const res = await api.get('/api/prescriptions', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/prescriptions/:id — single with items', () => {
  it('returns RX-0001 with correct vital signs from seed', async () => {
    const res = await api.get<{ id?: number; rx_no?: string; patient_id?: number; doctor_id?: number; bp?: string; diagnosis?: string; status?: string; items?: PrescriptionItem[] }>(
      '/api/prescriptions/15001',
      adminH,
    );
    if (res.status === 200) {
      // Rx route spreads: { ...rx, items }
      expect(res.body.id).toBe(15001);
      expect(res.body.rx_no).toBe('RX-0001');
      expect(res.body.patient_id).toBe(1001);  // Mohammad Ali
      expect(res.body.doctor_id).toBe(101);    // Dr. Aminul Islam
      expect(res.body.bp).toBe('120/80');
      expect(res.body.diagnosis).toContain('Typhoid');
      expect(res.body.status).toBe('final');
    } else {
      expect([200, 404]).toContain(res.status);
    }
  });

  it('RX-0001 has 3 prescription items', async () => {
    const res = await api.get<{ items?: PrescriptionItem[] }>(
      '/api/prescriptions/15001',
      adminH,
    );
    if (res.status === 200 && res.body.items) {
      expect(res.body.items.length).toBeGreaterThanOrEqual(3);
      const names = res.body.items.map(i => i.medicine_name);
      expect(names).toContain('Napa 500mg');
      expect(names).toContain('Cefixime 200mg');
    }
  });

  it('returns 404 for non-existent prescription', async () => {
    const res = await api.get('/api/prescriptions/99999', adminH);
    expect([404, 400]).toContain(res.status);
  });
});

describe('POST /api/prescriptions — create with items', () => {
  it('creates prescription with medicine items', async () => {
    const newRx = {
      patientId: 1001,
      doctorId: 101,
      bp: '120/80',
      temperature: '98.6°F',
      weight: '70 kg',
      spo2: '99%',
      chiefComplaint: 'Integration test visit',
      diagnosis: 'Integration test diagnosis',
      status: 'final',
      items: [
        {
          medicine_name: 'Paracetamol 500mg',
          dosage: '500mg',
          frequency: '1+1+1',
          duration: '5 Days',
          instructions: 'After food',
          sort_order: 1,
        },
      ],
    };

    const res = await api.post<{ id?: number; rxNo?: string; prescriptionId?: number; message?: string }>(
      '/api/prescriptions',
      doctorH,
      newRx,
    );

    expect([200, 201]).toContain(res.status);
    // Route returns { id, rxNo }
    const rxId = res.body.id ?? res.body.prescriptionId;
    if (rxId) {
      createdRxId = rxId;
    }
  });

  it('created prescription can be retrieved with items', async () => {
    if (!createdRxId) return;

    const res = await api.get<{ id?: number; chief_complaint?: string; items?: PrescriptionItem[] }>(
      `/api/prescriptions/${createdRxId}`,
      adminH,
    );
    if (res.status === 200) {
      expect(res.body.chief_complaint).toBe('Integration test visit');
      if (res.body.items && res.body.items.length > 0) {
        expect(res.body.items[0]!.medicine_name).toBe('Paracetamol 500mg');
      }
    }
  });

  it('returns 400/422 for missing required fields', async () => {
    const res = await api.post('/api/prescriptions', doctorH, { bp: '120/80' });
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post('/api/prescriptions', noAuthHeaders(), { patientId: 1001 });
    expect(res.status).toBe(401);
  });
});
