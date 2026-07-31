/**
 * Integration tests for reception billing workflow:
 *   deposits, IP billing, settlements, admissions, deposit settings.
 *
 * Route mount points (from src/index.ts):
 *   /api/deposits      — deposit collection, refund, adjustment
 *   /api/ip-billing    — IP billing charges and discharge bills
 *   /api/settlements   — pending settlement and settlement creation
 *   /api/admissions    — ward-bed overview, admission create/transfer/discharge
 */

import { describe, it, expect } from 'vitest';
import depositRoutes from '../../../src/routes/tenant/deposits';
import ipBillingRoutes from '../../../src/routes/tenant/ipBilling';
import settlementRoutes from '../../../src/routes/tenant/settlements';
import admissionRoutes from '../../../src/routes/tenant/admissions';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import {
  TENANT_1, PATIENT_1, PATIENT_2, DOCTOR_1, ADMIN_USER,
  ACTIVE_BILLING_COUNTER_TABLES, BED_AVAILABLE, BED_OCCUPIED, RECEPTIONIST_USER,
} from '../helpers/fixtures';

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];

const PATIENT_RECORD = { ...PATIENT_1 };

const BILL_OPEN = {
  id: 30,
  tenant_id: TENANT_1.id,
  invoice_no: 'INV-000030',
  patient_id: PATIENT_1.id,
  total: 2500,
  discount: 0,
  paid: 0,
  due: 2500,
  status: 'open',
  created_at: '2024-01-20T12:00:00Z',
};

const BILLING_SERVICE_ITEM = {
  id: 501,
  tenant_id: TENANT_1.id,
  item_name: 'CBC',
  item_code: 'LAB-CBC',
  service_department_id: 11,
  price: 500,
  allow_discount: 1,
  allow_multiple_qty: 1,
  is_active: 1,
};

const BILLING_SERVICE_DEPARTMENT = {
  id: 11,
  tenant_id: TENANT_1.id,
  department_name: 'Pathology',
  is_active: 1,
};

const BILL_PARTIAL = {
  id: 31,
  tenant_id: TENANT_1.id,
  invoice_no: 'INV-000031',
  patient_id: PATIENT_1.id,
  total: 1000,
  discount: 0,
  paid: 300,
  due: 700,
  status: 'partially_paid',
  created_at: '2024-01-18T12:00:00Z',
};

const ADMISSION_ACTIVE = {
  id: 100,
  tenant_id: TENANT_1.id,
  admission_no: 'ADM-00100',
  patient_id: PATIENT_1.id,
  bed_id: BED_AVAILABLE.id,
  ward_name: BED_AVAILABLE.ward_name,
  bed_number: BED_AVAILABLE.bed_number,
  doctor_id: DOCTOR_1.id,
  doctor_name: DOCTOR_1.name,
  admission_type: 'general',
  status: 'admitted',
  admission_date: '2024-01-25T08:00:00Z',
  admitted_at: '2024-01-25T08:00:00Z',
  discharge_date: null,
};

const BED_AVAILABLE_2 = {
  id: 20,
  tenant_id: TENANT_1.id,
  ward_name: 'Cabin',
  bed_number: 'C-02',
  bed_type: 'cabin',
  rate_per_day: 1200,
  floor: '2',
  status: 'available',
};

const DEPOSIT_SETTING = {
  id: 1,
  tenant_id: TENANT_1.id,
  admission_type: 'emergency',
  bed_feature_id: null,
  min_deposit_amount: 5000,
  is_mandatory: 1,
  is_active: 1,
};

// =============================================================================
//  1. DEPOSIT FLOW TESTS
// =============================================================================

describe('Deposits (/api/deposits)', () => {

  describe('POST / — collect deposit', () => {
    it('creates a deposit and returns receipt_no', async () => {
      const { app, mockDB } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_RECORD],
          billing_deposits: [],
          sequence_counters: [],
          emp_cash_transactions: [],
        },
        universalFallback: false,
      });

      const res = await jsonRequest(app, '/api/deposits', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 5000, payment_method: 'cash' },
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.receipt_no).toBeDefined();
      expect(body.receipt_no).toMatch(/^DEP-/);
      expect(body.message).toBe('Deposit collected');

      // Verify that a billing_deposits insert was attempted
      const depositQueries = mockDB.queries.filter((q) =>
        q.sql.toUpperCase().includes('BILLING_DEPOSITS'),
      );
      expect(depositQueries.length).toBeGreaterThan(0);
    });

    it('returns 404 when patient does not belong to tenant', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { ...ACTIVE_BILLING_COUNTER_TABLES, patients: [], billing_deposits: [] },
      });

      const res = await jsonRequest(app, '/api/deposits', {
        method: 'POST',
        body: { patient_id: 999, amount: 5000 },
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when amount is missing', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { patients: [PATIENT_RECORD] },
      });

      const res = await jsonRequest(app, '/api/deposits', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /balance/:patientId — deposit balance', () => {
    it('returns balance summary for a patient with deposits', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          billing_deposits: [
            {
              id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id,
              amount: 5000, transaction_type: 'deposit', is_active: 1,
            },
            {
              id: 2, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id,
              amount: 3000, transaction_type: 'deposit', is_active: 1,
            },
          ],
        },
      });

      const res = await jsonRequest(app, `/api/deposits/balance/${PATIENT_1.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.patient_id).toBe(PATIENT_1.id);
      expect(body).toHaveProperty('total_deposits');
      expect(body).toHaveProperty('total_refunds');
      expect(body).toHaveProperty('total_adjustments');
      expect(body).toHaveProperty('balance');
    });

    it('returns zero balance when no deposits exist', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { billing_deposits: [] },
      });

      const res = await jsonRequest(app, `/api/deposits/balance/${PATIENT_1.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.balance).toBe(0);
    });
  });

  describe('GET / — list deposits', () => {
    it('returns deposit list for tenant', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          billing_deposits: [
            {
              id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id,
              deposit_receipt_no: 'DEP-000001', amount: 5000,
              transaction_type: 'deposit', payment_method: 'cash',
              is_active: 1, created_at: today,
            },
          ],
        },
      });

      const res = await jsonRequest(app, '/api/deposits');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deposits).toBeDefined();
      expect(Array.isArray(body.deposits)).toBe(true);
    });

    it('filters by patient_id query param', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          billing_deposits: [
            {
              id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id,
              amount: 5000, transaction_type: 'deposit', is_active: 1,
              created_at: today,
            },
            {
              id: 2, tenant_id: TENANT_1.id, patient_id: PATIENT_2.id,
              amount: 3000, transaction_type: 'deposit', is_active: 1,
              created_at: today,
            },
          ],
        },
      });

      const res = await jsonRequest(app, `/api/deposits?patient_id=${PATIENT_1.id}`);
      expect(res.status).toBe(200);
    });
  });

  describe('POST /refund — process refund', () => {
    it('returns 400 when balance is insufficient', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_RECORD],
          billing_deposits: [],
          sequence_counters: [],
          emp_cash_transactions: [],
        },
      });

      const res = await jsonRequest(app, '/api/deposits/refund', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 5000 },
      });

      // Should fail because balance is 0
      expect(res.status).toBe(400);
    });

    it('returns 404 when patient not found', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: { ...ACTIVE_BILLING_COUNTER_TABLES, patients: [], billing_deposits: [] },
      });

      const res = await jsonRequest(app, '/api/deposits/refund', {
        method: 'POST',
        body: { patient_id: 999, amount: 1000 },
      });

      expect(res.status).toBe(404);
    });

    it('processes refund when sufficient balance exists', async () => {
      const { app, mockDB } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_RECORD],
          billing_deposits: [
            {
              id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id,
              deposit_receipt_no: 'DEP-000001', amount: 10000,
              transaction_type: 'deposit', is_active: 1,
            },
          ],
          sequence_counters: [],
          emp_cash_transactions: [],
        },
      });

      const res = await jsonRequest(app, '/api/deposits/refund', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 2000 },
      });

      // With universalFallback=false, the balance check query may behave unexpectedly.
      // The aggregate handler sums "amount" from filtered rows, so balance = 10000.
      // 10000 >= 2000, so refund should proceed.
      expect(res.status).toBe(201);
    });
  });

  describe('POST /adjust — adjust deposit against bill', () => {
    it('returns 404 when bill not found', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_RECORD],
          billing_deposits: [
            {
              id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id,
              amount: 5000, transaction_type: 'deposit', is_active: 1,
            },
          ],
          bills: [],
        },
      });

      const res = await jsonRequest(app, '/api/deposits/adjust', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 1000, bill_id: 999 },
      });

      expect(res.status).toBe(404);
    });

    it('rejects applying one patient advance to another patient bill', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_RECORD, { ...PATIENT_2 }],
          billing_deposits: [
            {
              id: 10, tenant_id: TENANT_1.id, patient_id: PATIENT_2.id,
              amount: 5000, transaction_type: 'deposit', is_active: 1,
            },
          ],
          bills: [BILL_OPEN],
        },
      });

      const res = await jsonRequest(app, '/api/deposits/adjust', {
        method: 'POST',
        body: { patient_id: PATIENT_2.id, amount: 1000, bill_id: BILL_OPEN.id },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error?: string; message?: string };
      expect(body.error ?? body.message).toMatch(/does not match/i);
    });

    it('returns 400 when balance is insufficient', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          patients: [PATIENT_RECORD],
          billing_deposits: [],
          bills: [BILL_OPEN],
        },
      });

      const res = await jsonRequest(app, '/api/deposits/adjust', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 5000, bill_id: BILL_OPEN.id },
      });

      expect(res.status).toBe(400);
    });
  });
});

// =============================================================================
//  2. IP BILLING FLOW TESTS
// =============================================================================

describe('IP Billing (/api/ip-billing)', () => {

  describe('GET /patients — admitted patients list', () => {
    it('returns admitted patients for billing', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/api/ip-billing',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [ADMISSION_ACTIVE],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/api/ip-billing/patients');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns empty data when no admitted patients', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/api/ip-billing',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { admissions: [] },
        universalFallback: false,
      });

      const res = await jsonRequest(app, '/api/ip-billing/patients');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /admitted — admitted patient list', () => {
    it('returns admitted patient records', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/api/ip-billing',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [ADMISSION_ACTIVE],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/api/ip-billing/admitted');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.patients).toBeDefined();
    });
  });

  describe('POST /provisional — add charge', () => {
    it('adds a provisional billing charge', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/api/ip-billing',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          patients: [PATIENT_RECORD],
          admissions: [ADMISSION_ACTIVE],
          billing_provisional_items: [],
          billing_service_items: [BILLING_SERVICE_ITEM],
          billing_service_departments: [BILLING_SERVICE_DEPARTMENT],
        },
      });

      const res = await jsonRequest(app, '/api/ip-billing/provisional', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          admission_id: ADMISSION_ACTIVE.id,
          service_item_id: BILLING_SERVICE_ITEM.id,
          item_category: 'test',
          item_name: 'CBC',
          quantity: 1,
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.message).toBe('Provisional charge added');
      expect(body.total_amount).toBeDefined();

      const inserts = mockDB.queries.filter((q) =>
        q.sql.toUpperCase().includes('BILLING_PROVISIONAL_ITEMS'),
      );
      expect(inserts.length).toBeGreaterThan(0);
    });
  });

  describe('GET /pending/:admissionId — pending charges', () => {
    it('returns pending charges summary for an admission', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/api/ip-billing',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          billing_provisional_items: [
            {
              id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id,
              admission_id: ADMISSION_ACTIVE.id, item_category: 'test',
              item_name: 'CBC', unit_price: 500, quantity: 1,
              total_amount: 500, bill_status: 'provisional', is_active: 1,
              created_at: today,
            },
          ],
          patient_bed_infos: [],
          billing_deposits: [],
          admissions: [ADMISSION_ACTIVE],
        },
        universalFallback: false,
      });

      const res = await jsonRequest(app, `/api/ip-billing/pending/${ADMISSION_ACTIVE.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.items).toBeDefined();
      expect(body.summary).toBeDefined();
    });
  });

  describe('POST /discharge-bill — finalize discharge bill', () => {
    it('returns 404 for non-admitted patient', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/api/ip-billing',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          admissions: [],
          billing_provisional_items: [],
          patient_bed_infos: [],
        },
      });

      const res = await jsonRequest(app, '/api/ip-billing/discharge-bill', {
        method: 'POST',
        body: { admission_id: 999 },
      });

      expect(res.status).toBe(404);
    });
  });
});

// =============================================================================
//  3. SETTLEMENT FLOW TESTS
// =============================================================================

describe('Settlements (/api/settlements)', () => {

  describe('GET /pending — pending bills', () => {
    it('returns bills with due amounts', async () => {
      const { app } = createTestApp({
        route: settlementRoutes,
        routePath: '/api/settlements',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          bills: [BILL_OPEN, BILL_PARTIAL],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/api/settlements/pending');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pending_bills).toBeDefined();
      expect(Array.isArray(body.pending_bills)).toBe(true);
    });

    it('returns empty list when no pending bills', async () => {
      const { app } = createTestApp({
        route: settlementRoutes,
        routePath: '/api/settlements',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          bills: [],
        },
        universalFallback: false,
      });

      const res = await jsonRequest(app, '/api/settlements/pending');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pending_bills).toEqual([]);
    });
  });

  describe('GET /patient/:patientId/info — settlement summary', () => {
    it('returns patient info with pending bills and deposit balance', async () => {
      const { app } = createTestApp({
        route: settlementRoutes,
        routePath: '/api/settlements',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          patients: [PATIENT_RECORD],
          bills: [BILL_OPEN, BILL_PARTIAL],
          billing_deposits: [
            {
              id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id,
              amount: 3000, transaction_type: 'deposit', is_active: 1,
            },
          ],
        },
      });

      const res = await jsonRequest(app, `/api/settlements/patient/${PATIENT_1.id}/info`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.patient).toBeDefined();
      expect(body.patient.name).toBe(PATIENT_1.name);
      expect(body.pending_bills).toBeDefined();
      expect(typeof body.deposit_balance).toBe('number');
      expect(typeof body.total_due).toBe('number');
      expect(typeof body.net_payable).toBe('number');
    });

    it('returns 404 when patient not found', async () => {
      const { app } = createTestApp({
        route: settlementRoutes,
        routePath: '/api/settlements',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: { patients: [], bills: [], billing_deposits: [] },
      });

      const res = await jsonRequest(app, '/api/settlements/patient/999/info');
      expect(res.status).toBe(404);
    });
  });

  describe('POST / — create settlement', () => {
    it('returns 400 when bill does not belong to patient', async () => {
      const { app } = createTestApp({
        route: settlementRoutes,
        routePath: '/api/settlements',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          bills: [{ ...BILL_OPEN, patient_id: PATIENT_2.id }],
          patients: [PATIENT_RECORD],
          billing_deposits: [],
          billing_settlements: [],
          sequence_counters: [],
          emp_cash_transactions: [],
        },
        universalFallback: false,
      });

      const res = await jsonRequest(app, '/api/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_OPEN.id],
          paid_amount: 2500,
        },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when deposit_deducted exceeds available balance', async () => {
      const { app } = createTestApp({
        route: settlementRoutes,
        routePath: '/api/settlements',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          bills: [BILL_OPEN],
          patients: [PATIENT_RECORD],
          billing_deposits: [],
          billing_settlements: [],
          sequence_counters: [],
          emp_cash_transactions: [],
        },
      });

      const res = await jsonRequest(app, '/api/settlements', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_ids: [BILL_OPEN.id],
          deposit_deducted: 5000,
        },
      });

      expect(res.status).toBe(400);
    });
  });
});

// =============================================================================
//  4. ADMISSIONS TESTS
// =============================================================================

describe('Admissions (/api/admissions)', () => {

  describe('GET /ward-bed-overview — bed map', () => {
    it('returns beds grouped by ward', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          beds: [BED_AVAILABLE, BED_OCCUPIED],
        },
        universalFallback: false,
      });

      const res = await jsonRequest(app, '/api/admissions/ward-bed-overview');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.beds).toBeDefined();
      expect(body.wards).toBeDefined();
      expect(typeof body.wards).toBe('object');
      // Should group beds into wards
      const wardNames = Object.keys(body.wards);
      expect(wardNames.length).toBeGreaterThan(0);
    });

    it('includes the configured bed rate for the bed map cards', async () => {
      const { app, mockDB } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          beds: [BED_AVAILABLE_2],
        },
        universalFallback: false,
      });

      const res = await jsonRequest(app, '/api/admissions/ward-bed-overview');
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.beds[0].rate_per_day).toBe(BED_AVAILABLE_2.rate_per_day);
      const overviewSql = mockDB.queries.find(q => q.method === 'all' && q.sql.includes('FROM beds b'))?.sql ?? '';
      expect(overviewSql).toContain('b.rate_per_day');
      expect(overviewSql).toContain('AS effective_rate');
    });

    it('returns 403 when no tenant context', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: '',
        tables: {},
        universalFallback: false,
      });

      const res = await jsonRequest(app, '/api/admissions/ward-bed-overview');
      // requireTenantId throws 403 when tenantId is falsy
      expect(res.status).toBe(403);
    });
  });

  describe('POST / — create admission', () => {
    it('returns 403 when role is not allowed', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'lab_tech',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [],
          patients: [PATIENT_RECORD],
          beds: [BED_AVAILABLE],
          sequence_counters: [],
          emp_cash_transactions: [],
        },
        universalFallback: false,
      });

      const res = await jsonRequest(app, '/api/admissions', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bed_id: BED_AVAILABLE.id,
          doctor_id: DOCTOR_1.id,
          admission_type: 'general',
        },
      });

      expect(res.status).toBe(403);
    });

    it('returns 409 when patient already admitted', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [ADMISSION_ACTIVE],
          patients: [PATIENT_RECORD],
          beds: [BED_AVAILABLE_2],
        },
      });

      const res = await jsonRequest(app, '/api/admissions', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bed_id: BED_AVAILABLE_2.id,
          doctor_id: DOCTOR_1.id,
          admission_type: 'general',
        },
      });

      expect(res.status).toBe(409);
    });
  });

  describe('PUT /:id/transfer — transfer patient', () => {
    it('returns 403 when role is not allowed', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'lab_tech',
        tenantId: TENANT_1.id,
        tables: {},
        universalFallback: false,
      });

      const res = await jsonRequest(app, '/api/admissions/1/transfer', {
        method: 'PUT',
        body: { new_bed_id: 20, reason: 'Upgrade to cabin' },
      });

      expect(res.status).toBe(403);
    });

    it('returns 404 when admission not found', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [],
        },
      });

      const res = await jsonRequest(app, '/api/admissions/999/transfer', {
        method: 'PUT',
        body: { new_bed_id: 20, reason: 'Upgrade to cabin' },
      });

      expect(res.status).toBe(404);
    });

    it('returns 400 when transferring to same bed', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [ADMISSION_ACTIVE],
        },
      });

      const res = await jsonRequest(app, `/api/admissions/${ADMISSION_ACTIVE.id}/transfer`, {
        method: 'PUT',
        body: { new_bed_id: ADMISSION_ACTIVE.bed_id, reason: 'No change' },
      });

      expect(res.status).toBe(400);
    });

    it('returns 409 when new bed is not available', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [ADMISSION_ACTIVE],
          beds: [{ ...BED_OCCUPIED, id: 20, status: 'occupied' }],
        },
      });

      const res = await jsonRequest(app, `/api/admissions/${ADMISSION_ACTIVE.id}/transfer`, {
        method: 'PUT',
        body: { new_bed_id: 20, reason: 'Upgrade' },
      });

      expect(res.status).toBe(409);
    });
  });

  describe('PUT /:id — discharge patient', () => {
    it('returns 403 when role is not allowed', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'lab_tech',
        tenantId: TENANT_1.id,
        tables: {},
        universalFallback: false,
      });

      const res = await jsonRequest(app, '/api/admissions/1', {
        method: 'PUT',
        body: { status: 'discharged' },
      });

      expect(res.status).toBe(403);
    });
  });
});

// =============================================================================
//  5. DEPOSIT SETTINGS TESTS
// =============================================================================

describe('Deposit Settings (/api/admissions/adt/deposit-settings)', () => {

  describe('GET /adt/deposit-settings', () => {
    it('returns empty settings when none configured', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          adt_deposit_settings: [],
        },
      });

      const res = await jsonRequest(app, '/api/admissions/adt/deposit-settings');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings).toBeDefined();
      expect(body.settings).toEqual([]);
    });

    it('returns configured deposit settings', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          adt_deposit_settings: [DEPOSIT_SETTING],
        },
      });

      const res = await jsonRequest(app, '/api/admissions/adt/deposit-settings');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.settings).toHaveLength(1);
      expect(body.settings[0].admission_type).toBe('emergency');
      expect(body.settings[0].min_deposit_amount).toBe(5000);
    });
  });

  describe('POST /adt/deposit-settings — create deposit setting', () => {
    it('creates a new deposit setting', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          adt_deposit_settings: [],
        },
      });

      const res = await jsonRequest(app, '/api/admissions/adt/deposit-settings', {
        method: 'POST',
        body: {
          admission_type: 'emergency',
          min_deposit_amount: 5000,
          is_mandatory: true,
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
    });

    it('returns 400 when admission_type is missing', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          adt_deposit_settings: [],
        },
      });

      const res = await jsonRequest(app, '/api/admissions/adt/deposit-settings', {
        method: 'POST',
        body: { min_deposit_amount: 5000 },
      });

      expect(res.status).toBe(400);
    });
  });
});

// =============================================================================
//  6. AUTHORIZATION TESTS
// =============================================================================

describe('Authorization for billing endpoints', () => {

  describe('Deposit refund — role check', () => {
    it('allows hospital_admin to process refund', async () => {
      const { app } = createTestApp({
        route: depositRoutes,
        routePath: '/api/deposits',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          patients: [PATIENT_RECORD],
          billing_deposits: [
            {
              id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id,
              amount: 10000, transaction_type: 'deposit', is_active: 1,
            },
          ],
          sequence_counters: [],
          emp_cash_transactions: [],
        },
      });

      const res = await jsonRequest(app, '/api/deposits/refund', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, amount: 2000 },
      });

      // Should get past auth check (shows role on non-403 response)
      expect(res.status).not.toBe(403);
    });
  });

  describe('Admission create — role check', () => {
    it('allows receptionist to create admission', async () => {
      const { app } = createTestApp({
        route: admissionRoutes,
        routePath: '/api/admissions',
        role: 'receptionist',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [],
          patients: [PATIENT_RECORD],
          beds: [{ ...BED_AVAILABLE, status: 'available' }],
          doctors: [DOCTOR_1],
          sequence_counters: [],
          emp_cash_transactions: [],
          bed_reservations: [],
          patient_insurance: [],
          billing_schemes: [],
          adt_deposit_settings: [],
        },
        universalFallback: true,
      });

      const res = await jsonRequest(app, '/api/admissions', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bed_id: BED_AVAILABLE.id,
          doctor_id: DOCTOR_1.id,
          admission_type: 'general',
        },
      });

      // Should not be a 403 (allowed roles pass middleware)
      expect(res.status).not.toBe(403);
    });
  });
});
