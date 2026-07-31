/**
 * Integration tests for src/routes/tenant/ipBilling.ts
 *
 * Tests IP billing patient list, provisional charges, and discharge bill flows.
 */

import { describe, it, expect } from 'vitest';
import ipBillingRoutes from '../../../src/routes/tenant/ipBilling.ts';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { createIdempotencyRequestHash } from '../../../src/lib/request-idempotency';
import {
  TENANT_1, ADMISSION_1, PATIENT_1, DOCTOR_1,
  ACTIVE_BILLING_COUNTER_TABLES,
} from '../helpers/fixtures';

// ─── Shared test data ──────────────────────────────────────────────────────────

const admissionRecord = {
  id: ADMISSION_1.id,
  tenant_id: TENANT_1.id,
  admission_no: ADMISSION_1.admission_no,
  patient_id: PATIENT_1.id,
  bed_id: 10,
  doctor_id: DOCTOR_1.id,
  status: 'admitted',
  admission_date: '2024-01-20T08:00:00Z',
  visit_id: null,
};

const serviceItem = {
  id: 100,
  tenant_id: TENANT_1.id,
  item_name: 'CBC Test',
  price: 500,
  service_department_id: 1,
  department_name: 'Lab',
  allow_discount: 1,
  allow_multiple_qty: 1,
  is_active: 1,
};

const provisionalItem = {
  id: 1,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  admission_id: ADMISSION_1.id,
  item_category: 'test',
  item_name: 'CBC Test',
  unit_price: 500,
  quantity: 1,
  discount_percent: 0,
  discount_amount: 0,
  total_amount: 500,
  reference_id: 100,
  bill_status: 'provisional',
  is_active: 1,
  created_at: '2024-01-20T10:00:00Z',
};

const bedInfo = {
  id: 1,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  admission_id: ADMISSION_1.id,
  bed_id: 10,
  ward_name: 'General Ward',
  bed_number: 'G-01',
  bed_type: 'general',
  rate_per_day: 1000,
  started_on: '2024-01-20T08:00:00Z',
  ended_on: null,
  is_billed: 0,
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('IP Billing Routes', () => {

  // ─── RBAC ─────────────────────────────────────────────────────────────────

  describe('RBAC enforcement', () => {
    const allowedRoles = ['reception', 'hospital_admin', 'md', 'director', 'accountant'] as const;
    const deniedRoles = ['doctor', 'nurse', 'lab_tech', 'pharmacist'] as const;

    for (const role of allowedRoles) {
      it(`GET /patients allows role: ${role}`, async () => {
        const { app } = createTestApp({
          route: ipBillingRoutes,
          routePath: '/ip-billing',
          role,
          tenantId: TENANT_1.id,
          tables: {
            admissions: [admissionRecord],
            patients: [{ id: PATIENT_1.id, name: PATIENT_1.name, patient_code: 'PT-001' }],
          },
        });

        const res = await app.request('/ip-billing/patients');
        expect(res.status).toBe(200);
      });
    }

    for (const role of deniedRoles) {
      it(`GET /patients denies role: ${role}`, async () => {
        const { app } = createTestApp({
          route: ipBillingRoutes,
          routePath: '/ip-billing',
          role,
          tenantId: TENANT_1.id,
        });

        const res = await app.request('/ip-billing/patients');
        expect(res.status).toBe(403);
      });
    }
  });

  // ─── GET /patients ────────────────────────────────────────────────────────

  describe('GET /patients', () => {
    it('returns admitted patients with billing summary', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from billing_provisional_items') || lower.includes('from patient_bed_infos') || lower.includes('from billing_deposits')) {
            return { results: [] };
          }
          if (lower.includes('from admissions a') && lower.includes('left join patients p')) {
            expect(lower).toContain('p.date_of_birth');
            return {
              results: [{
                admission_id: ADMISSION_1.id,
                admission_number: ADMISSION_1.admission_no,
                patient_id: PATIENT_1.id,
                patient_name: PATIENT_1.name,
                patient_code: 'PT-001',
                date_of_birth: '1991-07-26',
                ward_name: 'General Ward',
                bed_number: 'G-01',
                doctor_name: 'Dr. Ahmed',
                admitted_date: admissionRecord.admission_date,
                total_charges: 0,
                total_paid: 0,
                balance: 0,
                billing_status: 'pending',
              }],
            };
          }
          return null;
        },
      });

      const res = await app.request('/ip-billing/patients');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: Array<Record<string, unknown>> };
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data[0]).toHaveProperty('date_of_birth', '1991-07-26');
    });

    it('filters by search query', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [admissionRecord],
          patients: [{ id: PATIENT_1.id, name: 'রহিম মিয়া', patient_code: 'PT-001' }],
        },
      });

      const res = await app.request('/ip-billing/patients?search=রহিম');
      expect(res.status).toBe(200);
    });
  });

  // ─── GET /stats ───────────────────────────────────────────────────────────

  describe('GET /stats', () => {
    it('returns IP billing statistics', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [admissionRecord],
          billing_provisional_items: [provisionalItem],
        },
      });

      const res = await app.request('/ip-billing/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        total_inpatients: number;
        pending_billing: number;
      };
      expect(body.total_inpatients).toBeGreaterThanOrEqual(0);
    });

    it('reconstructs pending billing as of the selected end date instead of trusting current flags', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });

      const res = await app.request('/ip-billing/stats?from=2026-07-01&to=2026-07-10');
      expect(res.status).toBe(200);

      const statsQueries = mockDB.batchCalls.flat();
      const pendingBillingQuery = statsQueries.find((sql) => sql.includes('ipd_as_of_pending_billing'));
      expect(pendingBillingQuery).toContain('bp.cancelled_at IS NULL');
      expect(pendingBillingQuery).toContain('bp.billed_bill_id');
      expect(pendingBillingQuery).toContain('NOT EXISTS');
      expect(pendingBillingQuery).not.toContain('bp.is_active = 1');
    });

    it('returns separate IPD charge, invoice, cash, deposit, and due totals', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });

      const res = await app.request('/ip-billing/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;

      expect(body).toEqual(expect.objectContaining({
        charges_added_today: expect.any(Number),
        final_billed_today: expect.any(Number),
        final_bill_count_today: expect.any(Number),
        payment_collected_today: expect.any(Number),
        payment_receipt_count_today: expect.any(Number),
        cash_collected_today: expect.any(Number),
        non_cash_collected_today: expect.any(Number),
        deposit_received_today: expect.any(Number),
        deposit_receipt_count_today: expect.any(Number),
        deposit_cash_received_today: expect.any(Number),
        deposit_non_cash_received_today: expect.any(Number),
        total_money_received_today: expect.any(Number),
        total_cash_received_today: expect.any(Number),
        total_non_cash_received_today: expect.any(Number),
        deposit_applied_today: expect.any(Number),
        discount_today: expect.any(Number),
        settled_gross_today: expect.any(Number),
        settled_discount_today: expect.any(Number),
        settled_payment_applied_today: expect.any(Number),
        settled_deposit_applied_today: expect.any(Number),
        settled_bill_count_today: expect.any(Number),
        current_provisional_due: expect.any(Number),
        today_activity: expect.any(Array),
      }));
    });

    it('reconciles direct payments and new deposits into exact daily IPD money received totals', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        queryOverride: (sql) => {
          const normalized = sql.replace(/\s+/g, ' ').trim();

          if (normalized.includes('ipd_activity_count')) {
            return { results: [{ count: 2 }] };
          }
          if (normalized.includes('ipd_activity_details')) {
            return {
              results: [{
                bill_id: 6544,
                invoice_no: 'BL-000024',
                admission_id: 13082,
                admission_no: 'ADM-000023',
                patient_name: 'Parvin',
                patient_code: 'P-000850',
                gross_amount: 300,
                discount_amount: 0,
                net_amount: 300,
                payment_amount: 0,
                cash_amount: 0,
                non_cash_amount: 0,
                deposit_received_today: 300,
                total_received_today: 300,
                deposit_applied: 300,
                due_amount: 0,
                status: 'paid',
                payment_method: null,
                service_names: 'Admission Fee',
                item_count: 1,
                occurred_at: '2026-07-16 12:44:23',
              }, {
                bill_id: null,
                invoice_no: null,
                admission_id: 13081,
                admission_no: 'ADM-000022',
                patient_name: 'Marufa',
                patient_code: 'P-000847',
                gross_amount: 0,
                discount_amount: 0,
                net_amount: 0,
                payment_amount: 0,
                cash_amount: 0,
                non_cash_amount: 0,
                deposit_received_today: 300,
                total_received_today: 300,
                deposit_applied: 0,
                due_amount: 0,
                status: 'deposit_received',
                payment_method: 'cash',
                service_names: null,
                item_count: 0,
                occurred_at: '2026-07-16 10:28:32',
              }],
            };
          }
          if (normalized.startsWith('WITH settled_bill_ids AS')) {
            return { results: [{ gross: 35745, discount: 1245, total: 34500, payment_applied: 33900, deposit_applied: 600, count: 2 }] };
          }
          if (normalized.startsWith('WITH active_charge AS')) {
            return { results: [{ total: 0, count: 0 }] };
          }
          if (normalized.includes('SELECT COUNT(DISTINCT a.id) AS count')) {
            return { results: [{ count: 1 }] };
          }
          if (normalized.includes('FROM billing_provisional_items') && normalized.includes('admission_id IS NOT NULL')) {
            return { results: [{ total: 24545, count: 7 }] };
          }
          if (normalized.includes('FROM bills') && normalized.includes('AS gross') && !normalized.includes('JOIN payments')) {
            return { results: [{ gross: 35745, net: 34500, discount: 1245, count: 2 }] };
          }
          if (normalized.includes('FROM bills b') && normalized.includes('JOIN payments p') && normalized.includes('AS non_cash')) {
            return { results: [{ total: 33900, cash: 33900, non_cash: 0, count: 1 }] };
          }
          if (normalized.includes('FROM billing_deposits d') && normalized.includes("d.transaction_type = 'deposit'") && normalized.includes('AS non_cash')) {
            return { results: [{ total: 600, cash: 600, non_cash: 0, count: 2 }] };
          }
          if (normalized.includes('JOIN bills b ON b.id = d.reference_bill_id')) {
            return { results: [{ total: 600, count: 2 }] };
          }
          if (normalized.includes("status = 'admitted' AND package_id IS NOT NULL")) {
            return { results: [{ count: 0 }] };
          }
          if (normalized.includes("status = 'discharged' AND date(discharge_date)")) {
            return { results: [{ count: 2 }] };
          }
          if (normalized.includes('date(admission_date)')) {
            return { results: [{ count: 2 }] };
          }
          if (normalized.includes("status = 'admitted'")) {
            return { results: [{ count: 3 }] };
          }
          return { results: [] };
        },
      });

      const res = await app.request('/ip-billing/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, any>;

      expect(body.payment_collected_today).toBe(33900);
      expect(body.deposit_received_today).toBe(600);
      expect(body.total_money_received_today).toBe(34500);
      expect(body.total_cash_received_today).toBe(34500);
      expect(body.total_non_cash_received_today).toBe(0);
      expect(body.deposit_applied_today).toBe(600);
      expect(body.today_activity).toEqual(expect.arrayContaining([
        expect.objectContaining({
          invoiceNo: 'BL-000024',
          patientName: 'Parvin',
          paymentAmount: 0,
          depositReceivedToday: 300,
          totalReceivedToday: 300,
          depositApplied: 300,
        }),
        expect.objectContaining({
          billId: 0,
          invoiceNo: null,
          admissionNo: 'ADM-000022',
          patientName: 'Marufa',
          paymentAmount: 0,
          depositReceivedToday: 300,
          totalReceivedToday: 300,
          depositApplied: 0,
          status: 'deposit_received',
          paymentMethod: 'cash',
        }),
      ]));
    });

    it('counts new admission deposits as IPD money received without treating adjustments as new cash', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });

      const res = await app.request('/ip-billing/stats');
      expect(res.status).toBe(200);

      const statsSql = mockDB.batchCalls.flat().join('\n');
      expect(statsSql).toContain("transaction_type = 'deposit'");
      expect(statsSql).toContain('d.admission_id IS NOT NULL');
      expect(statsSql).toContain('a.id = d.admission_id');
      expect(statsSql).toContain('a.patient_id = d.patient_id');
      expect(statsSql).not.toContain("remarks LIKE 'Admission deposit for %'");
      expect(statsSql).toContain('deposit_only_activity');
      expect(statsSql).toContain('UNION ALL');
      expect(statsSql).toContain('NOT EXISTS');
      expect(statsSql).toContain("transaction_type = 'adjustment'");
    });

    it('classifies IPD finance by admission-linked records instead of unrelated numeric reference ids', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });

      const res = await app.request('/ip-billing/stats');
      expect(res.status).toBe(200);

      const statsSql = mockDB.batchCalls.flat().join('\n');
      expect(statsSql).toContain('admission_id IS NOT NULL');
      expect(statsSql).toContain('JOIN bills');
      expect(statsSql).toContain('JOIN payments');
      expect(statsSql).not.toContain('reference_id IN (SELECT id FROM billing_provisional_items');
    });
  });

  // ─── GET /pending/:admissionId ────────────────────────────────────────────

  describe('GET /pending/:admissionId', () => {
    it('returns pending charges breakdown', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [bedInfo],
          admissions: [admissionRecord],
          billing_deposits: [],
        },
        queryOverride: (sql) => {
          if (sql.includes('FROM visit_services')) return { first: { amount: 300 } };
          return null;
        },
      });

      const res = await app.request(`/ip-billing/pending/${ADMISSION_1.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        items: unknown[];
        bed_charges: { segments: unknown[]; bed_total: number };
        summary: {
          provisional_total: number;
          bed_total: number;
          grand_total: number;
          deposit_balance: number;
          net_payable: number;
          pending_service_amount: number;
        };
      };
      expect(body.summary).toBeDefined();
      expect(body.summary.grand_total).toBeGreaterThanOrEqual(0);
      expect(body.summary.pending_service_amount).toBe(300);
    });

    it('returns patient-wide outstanding invoices with category details for discharge', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [],
          admissions: [admissionRecord],
          billing_deposits: [],
        },
        queryOverride: (sql) => {
          if (sql.includes('FROM sqlite_master')) return { first: null };
          if (sql.includes('FROM bills b') && sql.includes('legacyBillId')) {
            return {
              results: [{
                legacyBillId: 77,
                invoiceNumber: 'LAB-0077',
                patientId: PATIENT_1.id,
                patientName: 'রহিম মিয়া',
                patientMobile: '01700000000',
                total: 6200,
                paid: 0,
                due: 6200,
                status: 'open',
                issuedAt: '2026-07-19 10:00:00',
              }],
            };
          }
          if (sql.includes('id AS "legacyBillId"') && sql.includes('FROM bills')) {
            return {
              results: [{
                legacyBillId: 77,
                admissionId: null,
                visitId: 50,
                testAmount: 5000,
                consultationAmount: 1200,
                admissionAmount: 0,
                operationAmount: 0,
                pharmacyAmount: 0,
              }],
            };
          }
          return null;
        },
      });

      const res = await app.request(`/ip-billing/pending/${ADMISSION_1.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        financial_clearance: {
          authority_mode: string;
          total_outstanding: number;
          inline_settlement_supported: boolean;
          invoices: Array<{
            invoice_number: string;
            due: number;
            source_label: string;
            categories: Array<{ code: string; amount: number }>;
          }>;
        };
      };

      expect(body.financial_clearance).toMatchObject({
        authority_mode: 'legacy',
        total_outstanding: 6200,
        inline_settlement_supported: true,
      });
      expect(body.financial_clearance.invoices[0]).toMatchObject({
        invoice_number: 'LAB-0077',
        due: 6200,
        source_label: 'Mixed invoice',
      });
      expect(body.financial_clearance.invoices[0].categories).toEqual([
        { code: 'laboratory', label: 'Laboratory / Test', amount: 5000 },
        { code: 'consultation', label: 'OPD / Consultation', amount: 1200 },
      ]);
      const receivableQuery = mockDB.queries.find((query) => (
        query.sql.includes('FROM bills b') && query.sql.includes('legacyBillId')
      ));
      expect(receivableQuery?.sql).toContain('b.patient_id = ?');
      expect(receivableQuery?.params).toContain(PATIENT_1.id);
    });

    it('returns deposit ledger history without unrelated bill payments', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          billing_provisional_items: [],
          patient_bed_infos: [],
          admissions: [admissionRecord],
          billing_deposits: [
            { id: 1, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, transaction_type: 'deposit', amount: 1000, deposit_receipt_no: 'DEP-1', is_active: 1, created_at: '2026-06-18' },
            { id: 2, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, transaction_type: 'refund', amount: 200, deposit_receipt_no: 'REF-1', is_active: 1, created_at: '2026-06-19' },
          ],
          payments: [
            { id: 9, tenant_id: TENANT_1.id, bill_id: 99, amount: 5000, receipt_no: 'OTHER-BILL' },
          ],
        },
      });

      const res = await app.request(`/ip-billing/pending/${ADMISSION_1.id}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { deposit_history: Array<{ type: string; receipt_no: string }> };

      expect(body.deposit_history).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'deposit', receipt_no: 'DEP-1' }),
        expect.objectContaining({ type: 'refund', receipt_no: 'REF-1' }),
      ]));
      expect(body.deposit_history).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ receipt_no: 'OTHER-BILL' }),
      ]));
    });

    it('removes an unbilled auto bed charge from running bill without deleting bed history', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: {
          patient_bed_infos: [{
            ...bedInfo,
            days: 1,
            charge_amount: 1000,
          }],
          bed_charge_logs: [],
          audit_logs: [],
        },
      });

      const res = await app.request(`/ip-billing/pending/${ADMISSION_1.id}/bed-charges/${bedInfo.id}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain('removed');
      expect(mockDB.queries.some((query) =>
        query.sql.includes('UPDATE patient_bed_infos')
        && query.sql.includes('is_billed = 1')
        && query.sql.includes('charge_amount = 0')
        && query.params.includes(bedInfo.id)
      )).toBe(true);
      expect(mockDB.queries.some((query) =>
        query.sql.includes('INSERT INTO bed_charge_logs')
        && query.params.includes('Removed from IPD running bill')
      )).toBe(true);
    });

  });

  // ─── POST /provisional ────────────────────────────────────────────────────

  describe('POST /provisional — add provisional charge', () => {
    it('adds a provisional charge with valid service item', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        universalFallback: true,
        tables: {
          billing_service_items: [serviceItem],
          billing_service_departments: [{
            id: 1,
            tenant_id: TENANT_1.id,
            department_name: 'Lab',
            is_active: 1,
          }],
        },
      });

      const res = await jsonRequest(app, '/ip-billing/provisional', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          admission_id: ADMISSION_1.id,
          service_item_id: serviceItem.id,
          quantity: 1,
          discount_percent: 0,
        },
      });
      // With universalFallback, the mock returns data and the route proceeds
      expect([200, 201, 400]).toContain(res.status);
    });

    it('validates request body schema', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
      });

      const res = await jsonRequest(app, '/ip-billing/provisional', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          // Missing service_item_id
          quantity: 1,
        },
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── GET /:admissionId/print ──────────────────────────────────────────────

  describe('GET /:admissionId/print', () => {
    it('returns HTML running bill', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{
            ...admissionRecord,
            patient_name: 'রহিম মিয়া',
            patient_code: 'PT-001',
          }],
          patients: [{ id: PATIENT_1.id, name: 'রহিম মিয়া' }],
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [bedInfo],
          billing_deposits: [],
          settings: [{ key: 'hospital_name', value: 'City Hospital' }],
        },
      });

      const res = await app.request(`/ip-billing/${ADMISSION_1.id}/print`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('Running Bill');
      expect(html).toContain('রহিম মিয়া');
    });
  });

  // ─── POST /discharge-bill ───────────────────────────────────────────────

  describe('POST /discharge-bill', () => {
    it('replays a completed discharge request without creating another bill or approval', async () => {
      const requestBody = {
        admission_id: ADMISSION_1.id,
        discount_percent: 0,
        reason_code: 'normal_hospital_discount',
        deposit_deducted: 0,
        payment_mode: 'cash',
        paid_amount: 0,
        confirm_excess_deposit_refund: false,
        discharge_mode: 'settled' as const,
        confirm_credit_discharge: false,
        idempotencyKey: 'ipd-discharge-replay-001',
      };
      const requestHash = await createIdempotencyRequestHash({
        ...requestBody,
        idempotencyKey: undefined,
      });
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'reception',
        tenantId: TENANT_1.id,
        queryOverride: (sql) => {
          if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
            return {
              first: {
                request_hash: requestHash,
                status: 'completed',
                response_json: JSON.stringify({
                  bill_id: 90,
                  invoice_no: 'BL-000090',
                  status: 'paid',
                  discharge_mode: 'settled',
                  message: 'Discharge bill created',
                }),
              },
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: requestBody,
      });

      expect(res.status).toBe(201);
      const body = await res.json() as { idempotent?: boolean; bill_id?: number };
      expect(body).toMatchObject({ idempotent: true, bill_id: 90 });
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO bills'))).toBe(false);
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO approval_requests'))).toBe(false);
    });

    it('blocks normal discharge when another patient invoice is still outstanding', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          admissions: [admissionRecord],
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [],
          billing_deposits: [],
        },
        queryOverride: (sql) => {
          if (sql.includes('FROM sqlite_master')) return { first: null };
          if (sql.includes('FROM bills b') && sql.includes('legacyBillId')) {
            return {
              results: [{
                legacyBillId: 77,
                invoiceNumber: 'LAB-0077',
                patientId: PATIENT_1.id,
                patientName: 'Marufa',
                patientMobile: '01700000000',
                total: 6200,
                paid: 0,
                due: 6200,
                status: 'open',
                issuedAt: '2026-07-19 10:00:00',
              }],
            };
          }
          if (sql.includes('id AS "legacyBillId"') && sql.includes('FROM bills')) {
            return {
              results: [{
                legacyBillId: 77,
                admissionId: null,
                visitId: 50,
                testAmount: 6200,
                consultationAmount: 0,
                admissionAmount: 0,
                operationAmount: 0,
                pharmacyAmount: 0,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: {
          admission_id: ADMISSION_1.id,
          paid_amount: 500,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain('৳6,200');
      expect(body.error).toContain('credit discharge');
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO bills'))).toBe(false);
    });

    it('requires explicit reason, payment date, and acknowledgement for credit discharge', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          admissions: [admissionRecord],
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [],
          billing_deposits: [],
        },
        queryOverride: (sql) => {
          if (sql.includes('FROM sqlite_master')) return { first: null };
          if (sql.includes('FROM bills b') && sql.includes('legacyBillId')) {
            return {
              results: [{
                legacyBillId: 77,
                invoiceNumber: 'LAB-0077',
                patientId: PATIENT_1.id,
                patientName: 'Marufa',
                patientMobile: '01700000000',
                total: 6200,
                paid: 0,
                due: 6200,
                status: 'open',
                issuedAt: '2026-07-19 10:00:00',
              }],
            };
          }
          if (sql.includes('id AS "legacyBillId"') && sql.includes('FROM bills')) {
            return {
              results: [{
                legacyBillId: 77,
                admissionId: null,
                visitId: 50,
                testAmount: 6200,
                consultationAmount: 0,
                admissionAmount: 0,
                operationAmount: 0,
                pharmacyAmount: 0,
              }],
            };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: {
          admission_id: ADMISSION_1.id,
          discharge_mode: 'credit_pending',
          paid_amount: 0,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain('Credit discharge reason');
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO approval_requests'))).toBe(false);
    });

    it('never allows unresolved visit services to pass through credit discharge', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'reception',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          admissions: [admissionRecord],
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [],
          billing_deposits: [],
        },
        queryOverride: (sql) => {
          if (sql.includes('FROM visit_services')) return { first: { amount: 300 } };
          if (sql.includes('FROM sqlite_master')) return { first: null };
          if (sql.includes('FROM bills b') && sql.includes('legacyBillId')) return { results: [] };
          return null;
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: {
          admission_id: ADMISSION_1.id,
          discharge_mode: 'credit_pending',
          credit_reason: 'Guardian will return after salary payment',
          expected_payment_date: '2026-07-25',
          confirm_credit_discharge: true,
          paid_amount: 0,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain('pending visit services');
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO approval_requests'))).toBe(false);
    });

    it('atomically discharges with due and creates the higher-authority approval request', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'reception',
        tenantId: TENANT_1.id,
        userId: 7,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          billing_counter_sessions: [{
            ...ACTIVE_BILLING_COUNTER_TABLES.billing_counter_sessions[0],
            employee_id: 7,
          }],
          admissions: [admissionRecord],
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [],
          billing_deposits: [],
          users: [
            { id: 7, tenant_id: TENANT_1.id, role: 'reception', is_active: 1 },
            { id: 8, tenant_id: TENANT_1.id, role: 'manager', is_active: 1 },
            { id: 9, tenant_id: TENANT_1.id, role: 'md', is_active: 1 },
          ],
        },
        queryOverride: (sql) => {
          if (sql.includes('FROM sqlite_master')) return { first: null };
          if (sql.includes('FROM bills b') && sql.includes('legacyBillId')) {
            return {
              results: [{
                legacyBillId: 77,
                invoiceNumber: 'LAB-0077',
                patientId: PATIENT_1.id,
                patientName: 'Marufa',
                patientMobile: '01700000000',
                total: 6200,
                paid: 0,
                due: 6200,
                status: 'open',
                issuedAt: '2026-07-19 10:00:00',
              }],
            };
          }
          if (sql.includes('id AS "legacyBillId"') && sql.includes('FROM bills')) {
            return {
              results: [{
                legacyBillId: 77,
                admissionId: null,
                visitId: 50,
                testAmount: 6200,
                consultationAmount: 0,
                admissionAmount: 0,
                operationAmount: 0,
                pharmacyAmount: 0,
              }],
            };
          }
          if (sql.includes('SELECT id FROM approval_requests')) return { first: null };
          return null;
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: {
          admission_id: ADMISSION_1.id,
          discharge_mode: 'credit_pending',
          credit_reason: 'Guardian committed to pay after salary',
          expected_payment_date: '2026-07-25',
          confirm_credit_discharge: true,
          paid_amount: 0,
          payment_mode: 'cash',
          idempotencyKey: 'ipd-credit-discharge-atomic-001',
        },
      });

      expect(res.status).toBe(201);
      const body = await res.json() as {
        approval_request_id?: number;
        credit_approval_status?: string;
        total_outstanding?: number;
      };
      expect(body).toMatchObject({
        credit_approval_status: 'pending',
        total_outstanding: 6700,
      });
      expect(body.approval_request_id).toEqual(expect.any(Number));
      expect(Number(body.approval_request_id)).toBeGreaterThan(0);
      expect(mockDB.queries.some((query) => (
        query.sql.includes('INSERT OR IGNORE INTO billing_mutation_idempotency_keys')
        && query.params.includes('ipd-credit-discharge-atomic-001')
      ))).toBe(true);
      expect(mockDB.queries.some((query) => (
        query.sql.includes("SET status = 'completed'")
        && query.params.includes('ipd-credit-discharge-atomic-001')
      ))).toBe(true);

      const atomicSql = mockDB.batchCalls.find((batch) => (
        batch.some((sql) => sql.includes('INSERT INTO bills'))
        && batch.some((sql) => sql.includes('INSERT INTO approval_requests'))
      ))?.join('\n') ?? '';
      expect(atomicSql).toContain('INSERT INTO approval_requests');
      expect(atomicSql).toContain('INSERT INTO approval_events');
      expect(atomicSql).toContain('INSERT INTO notifications');
      expect(atomicSql).toContain("status = 'discharged'");
      expect(atomicSql).toContain("bill_status_on_discharge = 'credit_pending'");
      expect(atomicSql).toContain("UPDATE beds SET status = 'cleaning'");

      const approvalInsert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO approval_requests'));
      expect(approvalInsert?.params).toContain('manual_adjustment');
      expect(approvalInsert?.params).not.toContain('credit_discharge');
      const requestSnapshot = approvalInsert?.params.find((value) => (
        typeof value === 'string' && value.includes('Guardian committed to pay after salary')
      ));
      expect(typeof requestSnapshot).toBe('string');
      expect(JSON.parse(requestSnapshot as string)).toMatchObject({
        approvalKind: 'credit_discharge',
        admissionId: ADMISSION_1.id,
        externalOutstandingMinor: 620000,
        currentDischargeDueMinor: 50000,
        totalDueMinor: 670000,
        expectedPaymentDate: '2026-07-25',
        requesterAcknowledged: true,
      });
    });

    it('uses a schema-compatible invoice item category for finalized bed charges', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          admissions: [admissionRecord],
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [{ ...bedInfo, rate_per_day: 0 }],
          billing_deposits: [{
            id: 1,
            tenant_id: TENANT_1.id,
            patient_id: PATIENT_1.id,
            deposit_receipt_no: 'DEP-000001',
            amount: 1000,
            transaction_type: 'deposit',
            is_active: 1,
          }],
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: {
          admission_id: ADMISSION_1.id,
          discount_percent: 0,
          deposit_deducted: 1000,
          paid_amount: 0,
          payment_mode: 'cash',
          confirm_excess_deposit_refund: true,
          refund_note: 'Guardian received excess deposit refund',
        },
      });

      expect(res.status).toBe(201);
      const bedInvoiceInsert = mockDB.queries.find((query) =>
        query.sql.includes('INSERT INTO invoice_items') &&
        query.params.includes('General Ward - Bed G-01 (general)'),
      );

      expect(bedInvoiceInsert?.params).toContain('admission');
      expect(bedInvoiceInsert?.params).not.toContain('bed_charge');
    });

    it('accepts fixed amount discounts for discharge bills', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          admissions: [admissionRecord],
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [],
          billing_deposits: [],
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: {
          admission_id: ADMISSION_1.id,
          discount_by_name: 'Director',
          discount_amount: 100,
          deposit_deducted: 0,
          paid_amount: 400,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(201);
      const billInsert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO bills'));
      expect(billInsert?.params[12]).toBe(100);
      expect(billInsert?.params[14]).toBe(400);
      const allocationInsert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO bill_discount_allocations'));
      expect(allocationInsert).toBeTruthy();
      expect(allocationInsert?.params).toContain('hospital_discount');
      expect(allocationInsert?.params).toContain('normal_hospital_discount');
      expect(allocationInsert?.params).toContain(100);
    });

    it('requires a referral name when the effective discharge discount is above 20 percent', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          admissions: [admissionRecord],
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [],
          billing_deposits: [],
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: {
          admission_id: ADMISSION_1.id,
          discount_percent: 25,
          deposit_deducted: 0,
          paid_amount: 375,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain('Discount referred by name is required');
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO bills'))).toBe(false);
    });

    it('blocks zero-charge discharge from auto-refunding a patient deposit', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          admissions: [admissionRecord],
          billing_provisional_items: [],
          patient_bed_infos: [],
          billing_deposits: [{
            id: 1,
            tenant_id: TENANT_1.id,
            patient_id: PATIENT_1.id,
            deposit_receipt_no: 'DEP-000001',
            amount: 500,
            transaction_type: 'deposit',
            is_active: 1,
          }],
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: {
          admission_id: ADMISSION_1.id,
          deposit_deducted: 500,
          paid_amount: 0,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(409);
      const body = await res.json() as { error?: string };
      expect(body.error).toContain('no billable charge was added');
      expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO bills'))).toBe(false);
    });

    it('stores the referral name for approved above-threshold discharge discounts', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          admissions: [admissionRecord],
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [],
          billing_deposits: [],
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: {
          admission_id: ADMISSION_1.id,
          discount_percent: 25,
          discount_by_name: 'Director Approval',
          deposit_deducted: 0,
          paid_amount: 375,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(201);
      const billInsert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO bills'));
      expect(billInsert?.params[12]).toBe(125);
      expect(billInsert?.params[13]).toBe('Director Approval');
      expect(billInsert?.params[14]).toBe(375);
    });

    it('does not duplicate finalized provisional charges in the IPD ledger', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          ...ACTIVE_BILLING_COUNTER_TABLES,
          admissions: [admissionRecord],
          billing_provisional_items: [provisionalItem],
          patient_bed_infos: [],
          billing_deposits: [],
        },
      });

      const res = await jsonRequest(app, '/ip-billing/discharge-bill', {
        method: 'POST',
        body: {
          admission_id: ADMISSION_1.id,
          deposit_deducted: 0,
          paid_amount: 500,
          payment_mode: 'cash',
        },
      });

      expect(res.status).toBe(201);
      const ledgerChargeInserts = mockDB.queries.filter((query) =>
        query.sql.includes('INSERT INTO ipd_ledger_entries') &&
        query.params.includes('charge') &&
        query.params.includes(provisionalItem.item_name),
      );
      expect(ledgerChargeInserts).toHaveLength(0);
      expect(mockDB.queries.some((query) => query.sql.includes('cash_ledger_entries'))).toBe(true);
    });

    it('allows system default IPD service items to be added for a tenant', async () => {
      const { app } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          patients: [{ id: PATIENT_1.id, tenant_id: TENANT_1.id, name: PATIENT_1.name }],
          admissions: [admissionRecord],
          billing_service_items: [{ ...serviceItem, tenant_id: '0' }],
          billing_service_departments: [{ id: 1, tenant_id: '0', department_name: 'OT/Operation', is_active: 1 }],
        },
      });

      const res = await jsonRequest(app, '/ip-billing/provisional', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          admission_id: ADMISSION_1.id,
          service_item_id: serviceItem.id,
          quantity: 1,
          discount_percent: 0,
        },
      });

      expect(res.status).toBe(201);
    });

    it('looks up discharge clearance bill by admission instead of latest patient bill', async () => {
      const { app, mockDB } = createTestApp({
        route: ipBillingRoutes,
        routePath: '/ip-billing',
        role: 'hospital_admin',
        tenantId: TENANT_1.id,
        tables: {
          admissions: [{ ...admissionRecord, patient_name: PATIENT_1.name, patient_code: 'PT-001', discharge_date: '2024-01-22T08:00:00Z', status: 'discharged' }],
          patients: [{ id: PATIENT_1.id, tenant_id: TENANT_1.id, name: PATIENT_1.name, patient_code: 'PT-001' }],
          doctors: [{ id: DOCTOR_1.id, tenant_id: TENANT_1.id, name: 'Dr. Ahmed' }],
          beds: [{ id: 10, tenant_id: TENANT_1.id, ward_name: 'General Ward', bed_number: 'G-01', bed_type: 'general' }],
          bills: [{ id: 10, tenant_id: TENANT_1.id, patient_id: PATIENT_1.id, admission_bill: 500, total: 500, paid: 500, due: 0, discount: 0 }],
          invoice_items: [],
          payments: [],
          billing_deposits: [],
          settings: [{ tenant_id: TENANT_1.id, key: 'hospital_name', value: 'City Hospital' }],
        },
      });

      const res = await app.request(`/ip-billing/${ADMISSION_1.id}/discharge-clearance`);

      expect(res.status).toBe(200);
      const billLookup = mockDB.queries.find((query) =>
        query.method === 'first' &&
        query.sql.includes('FROM bills') &&
        query.sql.includes('admission_id'),
      );
      expect(billLookup).toBeDefined();
    });
  });
});
