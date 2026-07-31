import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import billingRoutes from '../src/routes/tenant/billing';
import type { Env, Variables } from '../src/types';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

// ─── Invoice Print: Payment Method & Received By Tests ─────────────────────
// Covers: billing GET /:id resolving received_by to user name,
//         invoiceTemplate.ts accepting paymentMethod/receivedBy fields

describe('Billing Invoice Print — payment method & received by', () => {
  describe('GET /:id resolves received_by to user name', () => {
    it('includes received_by_name in payments when query joins staff', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from bills b join patients p')) {
            return {
              results: [{
                id: 1,
                invoice_no: 'INV-001',
                patient_name: 'Karim',
                patient_code: 'P001',
                mobile: '017',
                address: 'Dhaka',
                subtotal: 1000,
                discount: 0,
                total: 1000,
                paid: 1000,
                total_amount: 1000,
                paid_amount: 1000,
                due: 0,
                outstanding: 0,
                status: 'paid',
                created_at: '2025-01-15T10:00:00Z',
                tenant_id: 'tenant-1',
              }],
            };
          }
          if (lower.includes('from invoice_items')) {
            return {
              results: [{
                id: 1,
                item_category: 'test',
                description: 'CBC',
                quantity: 1,
                unit_price: 500,
                line_total: 500,
              }],
            };
          }
          // Payments query — should JOIN with staff
          if (lower.includes('from payments') && lower.includes('join staff')) {
            return {
              results: [{
                id: 1,
                bill_id: 1,
                amount: 1000,
                payment_method: 'bkash',
                received_by: 5,
                received_by_name: 'Rahim Cashier',
                receipt_no: 'RCP-001',
                created_at: '2025-01-15T10:05:00Z',
                tenant_id: 'tenant-1',
              }],
            };
          }
          if (lower.includes('from billing_deposits')) {
            return { results: [] };
          }
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/1');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        bill: Record<string, unknown>;
        payments: Array<Record<string, unknown>>;
      };

      expect(body.payments).toHaveLength(1);
      expect(body.payments[0]).toHaveProperty('payment_method', 'bkash');
      expect(body.payments[0]).toHaveProperty('received_by_name', 'Rahim Cashier');
    });

    it('includes normalized appointment and doctor details for consultation invoices', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from bills b join patients p')) {
            expect(lower).toContain('left join doctors ad');
            expect(lower).toContain('ad.tenant_id = b.tenant_id');
            expect(lower).toContain('a.appointment_type');
            return {
              results: [{
                id: 2,
                invoice_no: 'INV-002',
                patient_name: 'Rakib Hasan',
                patient_code: 'P002',
                mobile: '018',
                address: 'Dhaka',
                subtotal: 800,
                discount: 0,
                total: 800,
                paid: 800,
                total_amount: 800,
                paid_amount: 800,
                due: 0,
                outstanding: 0,
                status: 'paid',
                created_at: '2026-06-09T10:00:00Z',
                tenant_id: 'tenant-1',
                appt_no: 'APT-000456',
                appt_date: '2026-06-10',
                appt_time: '11:30',
                appointment_type: 'old_patient',
                appointment_doctor_name: 'Sadia Islam',
                appointment_doctor_specialty: 'Cardiology',
                appointment_doctor_department: 'Cardiology',
              }],
            };
          }
          if (lower.includes('from invoice_items')) {
            return {
              results: [{
                id: 2,
                item_category: 'doctor_visit',
                description: 'Consultation - Dr. Sadia Islam',
                quantity: 1,
                unit_price: 800,
                line_total: 800,
              }],
            };
          }
          if (lower.includes('from payments')) return { results: [] };
          if (lower.includes('from billing_deposits')) return { results: [] };
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/2');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        appointment: Record<string, unknown> | null;
      };

      expect(body.appointment).toEqual({
        number: 'APT-000456',
        date: '2026-06-10',
        time: '11:30',
        doctorName: 'Sadia Islam',
        appointmentType: 'old_patient',
        specialty: 'Cardiology',
        department: 'Cardiology',
      });
    });

    it('falls back to the finalized provisional item when the bill has no visit yet', async () => {
      const { app } = createTestApp({
        route: billingRoutes,
        routePath: '/billing',
        role: 'hospital_admin',
        tenantId: 'tenant-1',
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (lower.includes('from bills b join patients p')) {
            expect(lower).toContain('billing_provisional_items');
            expect(lower).toContain('billed_bill_id');
            expect(lower).toContain('coalesce(v.appointment_id');
            return {
              results: [{
                id: 3,
                invoice_no: 'INV-003',
                patient_name: 'Rahmatullah Zisan',
                patient_code: 'P003',
                mobile: '017',
                address: 'Dhaka',
                subtotal: 500,
                discount: 0,
                total: 500,
                paid: 500,
                total_amount: 500,
                paid_amount: 500,
                due: 0,
                outstanding: 0,
                status: 'paid',
                created_at: '2026-06-09T10:00:00Z',
                tenant_id: 'tenant-1',
                visit_id: null,
                visit_serial: 7,
                appt_no: 'APT-000100',
                appt_date: '2026-06-09',
                appt_time: null,
                appointment_doctor_name: 'Aminul Islam',
                appointment_doctor_specialty: 'Medicine',
                appointment_doctor_department: 'OPD',
              }],
            };
          }
          if (lower.includes('from invoice_items')) {
            return {
              results: [{
                id: 3,
                item_category: 'doctor_visit',
                description: 'Consultation - Dr. Aminul Islam',
                quantity: 1,
                unit_price: 500,
                line_total: 500,
              }],
            };
          }
          if (lower.includes('from payments')) return { results: [] };
          if (lower.includes('from billing_deposits')) return { results: [] };
          return null;
        },
      });

      const res = await jsonRequest(app, '/billing/3');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        visitSerial: number | null;
        appointment: Record<string, unknown> | null;
      };

      expect(body.visitSerial).toBe(7);
      expect(body.appointment).toMatchObject({
        number: 'APT-000100',
        doctorName: 'Aminul Islam',
        specialty: 'Medicine',
        department: 'OPD',
      });
    });
  });

  describe('InvoiceData accepts paymentMethod and receivedBy', () => {
    it('printInvoice template data can include payment method and received by', async () => {
      // Dynamically import to verify the interface at runtime
      const { printInvoice } = await import('../web/src/lib/print/invoiceTemplate');

      // Mock window.open for the print function
      const mockDoc = { write: vi.fn(), close: vi.fn() };
      const mockWin = { document: mockDoc, print: vi.fn() };
      vi.stubGlobal('window', {
        open: vi.fn(() => mockWin),
        print: vi.fn(),
      });

      // Call with paymentMethod and receivedBy — should not throw
      expect(() => {
        printInvoice({
          invoiceNo: 'INV-001',
          createdAt: '2025-01-15',
          patient: { name: 'Karim', patientCode: 'P001', mobile: '017' },
          items: [{ itemCategory: 'test', description: 'CBC', quantity: 1, unitPrice: 500, lineTotal: 500 }],
          subtotal: 1000,
          discount: 0,
          totalAmount: 1000,
          paidAmount: 1000,
          paymentMethod: 'bkash',
          receivedBy: 'Rahim Cashier',
          hospital: { name: 'Test Hospital' },
        });
      }).not.toThrow();

      // Verify the rendered HTML contains payment method and received by
      const html = mockDoc.write.mock.calls[0]?.[0] as string;
      expect(html).toContain('bkash');
      expect(html).toContain('Rahim Cashier');
    });

    it('printInvoice works without paymentMethod and receivedBy (backward compat)', async () => {
      const { printInvoice } = await import('../web/src/lib/print/invoiceTemplate');

      const mockDoc = { write: vi.fn(), close: vi.fn() };
      const mockWin = { document: mockDoc, print: vi.fn() };
      vi.stubGlobal('window', {
        open: vi.fn(() => mockWin),
        print: vi.fn(),
      });

      // Call without the new fields — should not throw
      expect(() => {
        printInvoice({
          invoiceNo: 'INV-002',
          createdAt: '2025-01-16',
          patient: { name: 'Ali' },
          items: [],
          subtotal: 500,
          discount: 0,
          totalAmount: 500,
          paidAmount: 500,
        });
      }).not.toThrow();
    });
  });
});
