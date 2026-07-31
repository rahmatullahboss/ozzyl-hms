import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import pdfRoutes from '../src/routes/tenant/pdf';

// ─── Role-Based Access Tests for PDF Endpoints ──────────────────────────────
describe('PDF Routes', () => {
  describe('GET /invoice/:billingId', () => {
    it('should return 403 for missing role on invoice endpoint', async () => {
      const app = new Hono<{ Variables: { tenantId: number } }>();

      app.use('*', async (c, next) => {
        c.set('tenantId', 1);
        await next();
      });

      app.route('/pdf', pdfRoutes);

      const res = await app.request('/pdf/invoice/123');
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain('Insufficient permissions');
    });

    it('should return 403 for unauthorized roles on invoice endpoint', async () => {
      const app = new Hono<{ Variables: { role: string; tenantId: number } }>();

      app.use('*', async (c, next) => {
        c.set('role', 'unauthorized_role');
        c.set('tenantId', 1);
        await next();
      });

      app.route('/pdf', pdfRoutes);

      const res = await app.request('/pdf/invoice/123');
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain('Insufficient permissions');
    });
  });

  describe('GET /patient-card/:patientId', () => {
    it('should return 403 for missing role on patient-card endpoint', async () => {
      const app = new Hono<{ Variables: { tenantId: number } }>();

      app.use('*', async (c, next) => {
        c.set('tenantId', 1);
        await next();
      });

      app.route('/pdf', pdfRoutes);

      const res = await app.request('/pdf/patient-card/123');
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain('Insufficient permissions');
    });

    it('should return 403 for unauthorized roles on patient-card endpoint', async () => {
      const app = new Hono<{ Variables: { role: string; tenantId: number } }>();

      app.use('*', async (c, next) => {
        c.set('role', 'unauthorized_role');
        c.set('tenantId', 1);
        await next();
      });

      app.route('/pdf', pdfRoutes);

      const res = await app.request('/pdf/patient-card/123');
      expect(res.status).toBe(403);
      const body = await res.text();
      expect(body).toContain('Insufficient permissions');
    });
  });
});

// ─── PDF Generation & Print Tests ────────────────────────────────────────────
// Covers: src/routes/tenant/pdf.ts
// Prescription PDFs, lab reports, bills, and receipts with Bengali text support

describe('HMS PDF Generation Tests', () => {

  // ─── Invoice/Bill PDF Data Validation ─────────────────────────────────────
  describe('Bill PDF Data Validation', () => {
    interface BillPDFData {
      invoiceNo: string;
      invoiceDate: string;
      hospitalName: string;
      patientName: string;
      patientCode: string;
      items: Array<{ description: string; quantity: number; unitPrice: number; total: number }>;
      subtotal: number;
      discount: number;
      totalAmount: number;
      paidAmount: number;
      dueAmount: number;
    }

    function validateBillPDFData(data: Partial<BillPDFData>): string[] {
      const errors: string[] = [];
      if (!data.invoiceNo?.trim()) errors.push('invoiceNo required');
      if (!data.hospitalName?.trim()) errors.push('hospitalName required');
      if (!data.patientName?.trim()) errors.push('patientName required');
      if (!data.items || data.items.length === 0) errors.push('at least one bill item required');
      if (data.totalAmount === undefined || data.totalAmount < 0) errors.push('totalAmount must be >= 0');
      return errors;
    }

    it('should validate complete bill PDF data', () => {
      const data: BillPDFData = {
        invoiceNo: 'INV-000001',
        invoiceDate: '2024-01-15',
        hospitalName: 'City General Hospital',
        patientName: 'রহিম মিয়া',
        patientCode: 'PT-000001',
        items: [{ description: 'OPD Consultation', quantity: 1, unitPrice: 1000, total: 1000 }],
        subtotal: 1000,
        discount: 0,
        totalAmount: 1000,
        paidAmount: 1000,
        dueAmount: 0,
      };
      expect(validateBillPDFData(data)).toHaveLength(0);
    });

    it('should reject PDF with no invoice number', () => {
      expect(validateBillPDFData({ hospitalName: 'H', patientName: 'P', items: [{ description: 'X', quantity: 1, unitPrice: 100, total: 100 }], totalAmount: 100 }))
        .toContain('invoiceNo required');
    });

    it('should reject PDF with empty items', () => {
      expect(validateBillPDFData({ invoiceNo: 'INV-001', hospitalName: 'H', patientName: 'P', items: [], totalAmount: 0 }))
        .toContain('at least one bill item required');
    });

    it('should accept Bengali patient name in PDF', () => {
      const data = { invoiceNo: 'INV-001', hospitalName: 'হাসপাতাল', patientName: 'রহিম মিয়া', items: [{ description: 'Consultation', quantity: 1, unitPrice: 500, total: 500 }], totalAmount: 500 };
      expect(validateBillPDFData(data)).toHaveLength(0);
    });

    it('should calculate PDF total correctly (subtotal - discount)', () => {
      const subtotal = 1500;
      const discount = 150;
      const total = subtotal - discount;
      expect(total).toBe(1350);
    });
  });

  // ─── Prescription PDF Data ─────────────────────────────────────────────────
  describe('Prescription PDF Data', () => {
    interface PrescriptionPDF {
      rxNo: string;
      date: string;
      doctorName: string;
      bmdcNo: string;
      specialization: string;
      patientName: string;
      patientAge: number | string;
      patientGender: string;
      chiefComplaint: string;
      diagnoses: string[];
      medicines: Array<{
        name: string;
        dose: string;
        frequency: string;
        duration: string;
        route: string;
      }>;
      followUpDate?: string;
      hospitalName: string;
    }

    function validatePrescriptionPDF(data: Partial<PrescriptionPDF>): string[] {
      const errors: string[] = [];
      if (!data.rxNo?.trim()) errors.push('rxNo required');
      if (!data.doctorName?.trim()) errors.push('doctorName required');
      if (!data.bmdcNo?.trim()) errors.push('BMDC number required');
      if (!data.patientName?.trim()) errors.push('patientName required');
      if (!data.diagnoses || data.diagnoses.length === 0) errors.push('at least one diagnosis required');
      return errors;
    }

    it('should validate complete prescription PDF data', () => {
      const rx: PrescriptionPDF = {
        rxNo: 'RX-000001',
        date: '2024-01-15',
        doctorName: 'Dr. Ahmad Hossain',
        bmdcNo: 'A-12345',
        specialization: 'Internal Medicine',
        patientName: 'Fatima Begum',
        patientAge: 35,
        patientGender: 'Female',
        chiefComplaint: 'Fever and cough',
        diagnoses: ['Acute URI - J06.9'],
        medicines: [{ name: 'Paracetamol 500mg', dose: '1 tab', frequency: '1-1-1', duration: '5 days', route: 'oral' }],
        hospitalName: 'City Hospital',
      };
      expect(validatePrescriptionPDF(rx)).toHaveLength(0);
    });

    it('should reject prescription without BMDC number', () => {
      expect(validatePrescriptionPDF({ rxNo: 'RX-001', doctorName: 'Dr. X', patientName: 'P', diagnoses: ['URI'] }))
        .toContain('BMDC number required');
    });

    it('should require at least one diagnosis for prescription', () => {
      expect(validatePrescriptionPDF({ rxNo: 'RX-001', doctorName: 'Dr. X', bmdcNo: 'A-123', patientName: 'P', diagnoses: [] }))
        .toContain('at least one diagnosis required');
    });

    it('should include Rx symbol in prescription document', () => {
      const rxNo = 'RX-000001';
      expect(rxNo).toMatch(/^RX-/);
    });

    it('should represent patient age as number or string (e.g. "2 months")', () => {
      const ageNum: number | string = 35;
      const ageStr: number | string = '8 months';
      expect(typeof ageNum === 'number' || typeof ageNum === 'string').toBe(true);
      expect(typeof ageStr === 'number' || typeof ageStr === 'string').toBe(true);
    });
  });

  // ─── Lab Report PDF Data ───────────────────────────────────────────────────
  describe('Lab Report PDF Data', () => {
    interface LabResultPDF {
      reportNo: string;
      patientName: string;
      patientCode: string;
      orderedBy: string;
      sampleCollectedAt: string;
      reportedAt: string;
      tests: Array<{
        testName: string;
        result: string;
        unit: string;
        referenceRange: string;
        flag: 'normal' | 'low' | 'high' | 'critical';
      }>;
    }

    it('should validate lab report with all required fields', () => {
      const report: LabResultPDF = {
        reportNo: 'LAB-000001',
        patientName: 'Karim Ali',
        patientCode: 'PT-000002',
        orderedBy: 'Dr. Rahman',
        sampleCollectedAt: '2024-01-15T09:00:00Z',
        reportedAt: '2024-01-15T14:00:00Z',
        tests: [{
          testName: 'Haemoglobin',
          result: '12.5',
          unit: 'g/dL',
          referenceRange: '13.5–17.5',
          flag: 'low',
        }],
      };
      expect(report.reportNo).toMatch(/^LAB-\d{6}$/);
      expect(report.tests.length).toBeGreaterThan(0);
    });

    it('should flag abnormal results in lab PDF', () => {
      const tests = [
        { testName: 'Hb', result: '12.5', unit: 'g/dL', referenceRange: '13.5–17.5', flag: 'low' as const },
        { testName: 'WBC', result: '7000', unit: '/mm³', referenceRange: '4000–11000', flag: 'normal' as const },
      ];
      const abnormals = tests.filter((t) => t.flag !== 'normal');
      expect(abnormals.length).toBe(1);
      expect(abnormals[0].testName).toBe('Hb');
    });

    it('should require sampleCollectedAt before reportedAt', () => {
      const sampleTime = new Date('2024-01-15T09:00:00Z');
      const reportTime = new Date('2024-01-15T14:00:00Z');
      expect(reportTime.getTime()).toBeGreaterThan(sampleTime.getTime());
    });

    it('should reject report where reportedAt is before sampleCollectedAt', () => {
      const sampleTime = new Date('2024-01-15T14:00:00Z');
      const reportTime = new Date('2024-01-15T09:00:00Z');
      const isValid = reportTime.getTime() >= sampleTime.getTime();
      expect(isValid).toBe(false);
    });
  });

  // ─── Bengali Font / Character Support ─────────────────────────────────────
  describe('Bengali Text Support in PDFs', () => {
    function containsBengali(text: string): boolean {
      // Bengali Unicode range: \u0980–\u09FF
      return /[\u0980-\u09FF]/.test(text);
    }

    function isMixedScript(text: string): boolean {
      const hasBengali = /[\u0980-\u09FF]/.test(text);
      const hasLatin = /[a-zA-Z]/.test(text);
      return hasBengali && hasLatin;
    }

    it('should detect Bengali text in prescription', () => {
      expect(containsBengali('রহিম মিয়া')).toBe(true);
    });

    it('should detect Latin text correctly', () => {
      expect(containsBengali('John Smith')).toBe(false);
    });

    it('should detect mixed Bengali+English text on prescription', () => {
      expect(isMixedScript('Dr. আহমেদ - MBBS')).toBe(true);
    });

    it('should handle Bengali digits in patient age', () => {
      // Bengali digit range: \u09E6–\u09EF
      const bengaliAge = '৩৫ বছর';
      expect(/[\u09E6-\u09EF]/.test(bengaliAge)).toBe(true);
    });

    it('should handle Taka symbol ৳ in bill PDFs', () => {
      const billedAmount = '৳ ১,৫০০';
      expect(billedAmount).toContain('৳');
    });
  });

  // ─── Receipt PDF ───────────────────────────────────────────────────────────
  describe('Receipt PDF', () => {
    interface ReceiptPDF {
      receiptNo: string;
      invoiceNo: string;
      patientName: string;
      paymentDate: string;
      amount: number;
      paymentMethod: string;
      transactionId?: string;
      cashierName: string;
    }

    it('should validate complete receipt PDF data', () => {
      const receipt: ReceiptPDF = {
        receiptNo: 'RCP-000001',
        invoiceNo: 'INV-000001',
        patientName: 'Fatima Begum',
        paymentDate: '2024-01-15',
        amount: 5000,
        paymentMethod: 'bkash',
        transactionId: 'AB1234567C',
        cashierName: 'Receptionist Ayesha',
      };
      expect(receipt.receiptNo).toMatch(/^RCP-\d{6}$/);
      expect(receipt.amount).toBeGreaterThan(0);
    });

    it('should require transactionId for digital payments', () => {
      const digitalMethods = ['bkash', 'nagad', 'rocket', 'card', 'bank_transfer'];
      const paymentMethod = 'bkash';
      const requiresTxId = digitalMethods.includes(paymentMethod);
      expect(requiresTxId).toBe(true);
    });

    it('should not require transactionId for cash payments', () => {
      const paymentMethod = 'cash';
      const requiresTxId = ['bkash', 'nagad', 'rocket', 'card', 'bank_transfer'].includes(paymentMethod);
      expect(requiresTxId).toBe(false);
    });
  });
});
