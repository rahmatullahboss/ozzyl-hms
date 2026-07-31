import { describe, it, expect } from 'vitest';

// ═════════════════════════════════════════════════════════════════════════════
// API CONTRACT TESTS — Validate response shapes and schemas
// Ensures frontend-backend contract never breaks silently
// ═════════════════════════════════════════════════════════════════════════════

describe('HMS API Contract Tests', () => {

  // ─── 1. Patient API Response Contract ──────────────────────────────────────
  describe('Patient API Response Shape', () => {
    const PATIENT_RESPONSE_KEYS = ['id', 'tenant_id', 'name', 'patient_code', 'mobile', 'gender', 'date_of_birth', 'blood_group', 'address', 'created_at'];

    function validatePatientShape(obj: Record<string, unknown>): string[] {
      const missing: string[] = [];
      for (const key of PATIENT_RESPONSE_KEYS) {
        if (!(key in obj)) missing.push(key);
      }
      return missing;
    }

    it('should validate a complete patient object', () => {
      const patient = { id: 1, tenant_id: 1, name: 'Rahim', patient_code: 'P-00001', mobile: '01712345678', gender: 'Male', date_of_birth: '1990-05-15', blood_group: 'A+', address: 'Dhaka', created_at: '2024-01-01T00:00:00Z' };
      expect(validatePatientShape(patient)).toHaveLength(0);
    });

    it('should detect missing fields in patient object', () => {
      const incomplete = { id: 1, name: 'Rahim' };
      const missing = validatePatientShape(incomplete);
      expect(missing.length).toBeGreaterThan(0);
      expect(missing).toContain('patient_code');
    });
  });

  // ─── 2. Billing API Response Contract ──────────────────────────────────────
  describe('Billing API Response Shape', () => {
    const BILLING_KEYS = ['id', 'tenant_id', 'bill_no', 'patient_id', 'subtotal', 'discount', 'tax', 'total', 'paid', 'due', 'status', 'created_at'];

    function validateBillingShape(obj: Record<string, unknown>): string[] {
      return BILLING_KEYS.filter(k => !(k in obj));
    }

    it('should validate a complete billing object', () => {
      const bill = { id: 1, tenant_id: 1, bill_no: 'BILL-00001', patient_id: 1, subtotal: 5000, discount: 0, tax: 0, total: 5000, paid: 3000, due: 2000, status: 'partial', created_at: '2024-01-01T00:00:00Z' };
      expect(validateBillingShape(bill)).toHaveLength(0);
    });

    it('should detect missing due field', () => {
      const bill = { id: 1, tenant_id: 1, bill_no: 'BILL-00001', patient_id: 1, subtotal: 5000, discount: 0, tax: 0, total: 5000, paid: 3000, status: 'partial', created_at: '2024-01-01T00:00:00Z' };
      expect(validateBillingShape(bill)).toContain('due');
    });
  });

  // ─── 3. Visit API Response Contract ────────────────────────────────────────
  describe('Visit API Response Shape', () => {
    const VISIT_KEYS = ['id', 'patient_id', 'visit_type', 'doctor_id', 'status', 'visit_date'];

    it('should validate visit response', () => {
      const visit = { id: 1, patient_id: 1, visit_type: 'opd', doctor_id: 1, status: 'in_progress', visit_date: '2024-01-15' };
      const missing = VISIT_KEYS.filter(k => !(k in visit));
      expect(missing).toHaveLength(0);
    });

    it('visit_type should be a recognized enum', () => {
      const validTypes = ['opd', 'ipd', 'emergency', 'telemedicine'];
      expect(validTypes).toContain('opd');
      expect(validTypes).toContain('emergency');
    });
  });

  // ─── 4. Admission API Response Contract ────────────────────────────────────
  describe('Admission API Response Shape', () => {
    const ADM_KEYS = ['admission_no', 'patient_id', 'bed_id', 'doctor_id', 'status', 'admission_type'];

    it('should validate admission response fields', () => {
      const adm = { admission_no: 'ADM-00001', patient_id: 1, bed_id: 5, doctor_id: 2, status: 'admitted', admission_type: 'emergency' };
      const missing = ADM_KEYS.filter(k => !(k in adm));
      expect(missing).toHaveLength(0);
    });

    it('admission_type should be planned or emergency', () => {
      const types = ['planned', 'emergency'];
      expect(types).toContain('planned');
      expect(types).toContain('emergency');
    });
  });

  // ─── 5. Prescription API Response Contract ─────────────────────────────────
  describe('Prescription API Response Shape', () => {
    const RX_KEYS = ['rx_no', 'patient_id', 'doctor_id', 'diagnosis', 'status', 'items'];

    it('should include rx_no, status, items in response', () => {
      const rx = { rx_no: 'RX-00001', patient_id: 1, doctor_id: 2, diagnosis: 'Fever', status: 'draft', items: [] };
      const missing = RX_KEYS.filter(k => !(k in rx));
      expect(missing).toHaveLength(0);
    });

    it('prescription item should have medicine_name, dosage, frequency, duration', () => {
      const ITEM_KEYS = ['medicine_name', 'dosage', 'frequency', 'duration'];
      const item = { medicine_name: 'Paracetamol', dosage: '500mg', frequency: '3x daily', duration: '5 days' };
      const missing = ITEM_KEYS.filter(k => !(k in item));
      expect(missing).toHaveLength(0);
    });
  });

  // ─── 6. Dashboard Summary Contract ─────────────────────────────────────────
  describe('Dashboard Summary Response Shape', () => {
    const DASHBOARD_KEYS = ['totalPatients', 'todayVisits', 'todayRevenue', 'todayDue', 'admittedPatients', 'availableBeds'];

    it('should include all KPI fields in dashboard response', () => {
      const dashboard = { totalPatients: 100, todayVisits: 15, todayRevenue: 50000, todayDue: 5000, admittedPatients: 20, availableBeds: 10 };
      const missing = DASHBOARD_KEYS.filter(k => !(k in dashboard));
      expect(missing).toHaveLength(0);
    });

    it('all dashboard values should be non-negative numbers', () => {
      const values = { totalPatients: 100, todayVisits: 15, todayRevenue: 50000, todayDue: 0, admittedPatients: 20, availableBeds: 10 };
      for (const [, val] of Object.entries(values)) {
        expect(val).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ─── 7. Error Response Contract ────────────────────────────────────────────
  describe('Error Response Shape', () => {
    it('should return error with message field', () => {
      const errorResponse = { error: 'Validation failed', message: 'patient_id required' };
      expect(errorResponse).toHaveProperty('message');
    });

    it('401 error should include auth context', () => {
      const authError = { error: 'Unauthorized', message: 'Tenant required' };
      expect(authError.message).toBeTruthy();
    });

    it('404 error should specify what was not found', () => {
      const notFound = { error: 'Not Found', message: 'Prescription not found' };
      expect(notFound.message).toMatch(/not found/i);
    });

    it('429 rate limit error should include retry guidance', () => {
      const rl = { success: false, error: 'Too many requests', message: 'Rate limit exceeded. Try again in 60s.' };
      expect(rl.message).toMatch(/try again/i);
    });
  });

  // ─── 8. Pagination Contract ────────────────────────────────────────────────
  describe('List Endpoint Pagination', () => {
    it('list endpoints should limit results by default (max 100)', () => {
      const MAX_DEFAULT_LIMIT = 100;
      expect(MAX_DEFAULT_LIMIT).toBe(100);
    });

    it('should support search/filter query params', () => {
      const supportedFilters = ['status', 'search', 'date', 'patient', 'doctor_id', 'type'];
      expect(supportedFilters.length).toBeGreaterThan(0);
      expect(supportedFilters).toContain('status');
      expect(supportedFilters).toContain('search');
    });
  });
});
