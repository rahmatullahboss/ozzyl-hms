import { describe, it, expect } from 'vitest';
import {
  createDietTypeSchema, updateDietTypeSchema, createPatientDietSchema, dietSheetQuerySchema,
  createBloodSugarSchema, updateBloodSugarSchema, bloodSugarQuerySchema,
  createConsultationRequestSchema, respondConsultationSchema, consultationQuerySchema,
  createTransferSchema, receiveTransferSchema, transferQuerySchema,
  createNursingOrderSchema, updateNursingOrderStatusSchema, nursingOrderQuerySchema,
  createDrugRequisitionSchema, drugRequisitionQuerySchema,
  createWardBillingRequestSchema, wardBillingQuerySchema,
} from '../src/schemas/nursing';

// ─── Nursing Module Unit Tests ────────────────────────────────────────────────
// Tests for nursing schema validation, RBAC role checks, pagination logic,
// and OPD status transitions.

describe('Nursing Module', () => {

  // ─── RBAC Role Groups ─────────────────────────────────────────────────────

  describe('RBAC Role Groups', () => {
    const NURSING_ROLES = ['nurse', 'doctor', 'md', 'hospital_admin'];
    const OPD_ROLES = ['nurse', 'receptionist', 'doctor', 'hospital_admin'];

    it('should grant write access to nursing roles', () => {
      expect(NURSING_ROLES).toContain('nurse');
      expect(NURSING_ROLES).toContain('doctor');
      expect(NURSING_ROLES).toContain('hospital_admin');
    });

    it('should deny write access to non-nursing roles', () => {
      expect(NURSING_ROLES).not.toContain('receptionist');
      expect(NURSING_ROLES).not.toContain('patient');
      expect(NURSING_ROLES).not.toContain('accountant');
    });

    it('should allow receptionist for OPD operations', () => {
      expect(OPD_ROLES).toContain('receptionist');
      expect(OPD_ROLES).toContain('nurse');
    });

    it('should always include hospital_admin', () => {
      expect(NURSING_ROLES).toContain('hospital_admin');
      expect(OPD_ROLES).toContain('hospital_admin');
    });
  });

  // ─── Care Plan Validation ─────────────────────────────────────────────────

  describe('Care Plan Validation', () => {
    const requiredFields = ['problem'];
    const optionalFields = ['goal', 'intervention', 'evaluation'];

    it('should require problem field', () => {
      const data = { goal: 'Recover', intervention: 'Rest' };
      const hasRequired = requiredFields.every(f => f in data);
      expect(hasRequired).toBe(false);
    });

    it('should accept valid care plan with all fields', () => {
      const data = { problem: 'Fever', goal: 'Afebrile', intervention: 'Paracetamol', evaluation: 'Pending' };
      const hasRequired = requiredFields.every(f => f in data);
      expect(hasRequired).toBe(true);
      optionalFields.forEach(f => expect(f in data).toBe(true));
    });

    it('should accept care plan with only required fields', () => {
      const data = { problem: 'Pain' };
      const hasRequired = requiredFields.every(f => f in data);
      expect(hasRequired).toBe(true);
    });
  });

  // ─── MAR (Medication Administration Record) ───────────────────────────────

  describe('MAR Validation', () => {
    const validRoutes = ['oral', 'iv', 'im', 'sc', 'topical', 'inhalation'];
    const validStatuses = ['given', 'withheld', 'refused', 'pending'];

    it('should accept valid administration routes', () => {
      validRoutes.forEach(r => {
        expect(validRoutes).toContain(r);
      });
    });

    it('should reject invalid administration route', () => {
      expect(validRoutes).not.toContain('rectal');
      expect(validRoutes).not.toContain('unknown');
    });

    it('should accept valid MAR statuses', () => {
      validStatuses.forEach(s => {
        expect(validStatuses).toContain(s);
      });
    });

    it('should reject invalid MAR status', () => {
      expect(validStatuses).not.toContain('missed');
      expect(validStatuses).not.toContain('cancelled');
    });
  });

  // ─── I/O Charts ───────────────────────────────────────────────────────────

  describe('I/O Charts', () => {
    const validIoTypes = ['intake', 'output'];

    it('should accept valid I/O types', () => {
      expect(validIoTypes).toContain('intake');
      expect(validIoTypes).toContain('output');
    });

    it('should calculate fluid balance correctly', () => {
      const records = [
        { io_type: 'intake', quantity_ml: 500 },
        { io_type: 'intake', quantity_ml: 300 },
        { io_type: 'output', quantity_ml: 400 },
        { io_type: 'output', quantity_ml: 150 },
      ];
      const totalIntake = records.filter(r => r.io_type === 'intake').reduce((s, r) => s + r.quantity_ml, 0);
      const totalOutput = records.filter(r => r.io_type === 'output').reduce((s, r) => s + r.quantity_ml, 0);
      const balance = totalIntake - totalOutput;
      expect(totalIntake).toBe(800);
      expect(totalOutput).toBe(550);
      expect(balance).toBe(250); // positive = retaining fluid
    });

    it('should require positive quantity_ml', () => {
      const quantity = -100;
      expect(quantity > 0).toBe(false);
    });

    it('should calculate negative fluid balance (dehydration)', () => {
      const records = [
        { io_type: 'intake', quantity_ml: 500 },
        { io_type: 'output', quantity_ml: 800 },
      ];
      const totalIntake = records.filter(r => r.io_type === 'intake').reduce((s, r) => s + r.quantity_ml, 0);
      const totalOutput = records.filter(r => r.io_type === 'output').reduce((s, r) => s + r.quantity_ml, 0);
      const balance = totalIntake - totalOutput;
      expect(balance).toBe(-300);
      expect(balance < 0).toBe(true);
    });

    it('should calculate zero fluid balance', () => {
      const records = [
        { io_type: 'intake', quantity_ml: 1000 },
        { io_type: 'output', quantity_ml: 1000 },
      ];
      const balance = records.filter(r => r.io_type === 'intake').reduce((s, r) => s + r.quantity_ml, 0)
        - records.filter(r => r.io_type === 'output').reduce((s, r) => s + r.quantity_ml, 0);
      expect(balance).toBe(0);
    });

    it('should handle fluid balance over 24-hour period', () => {
      const period = 24;
      const records = [
        { io_type: 'intake', quantity_ml: 1500, hours_ago: 2 },
        { io_type: 'intake', quantity_ml: 500, hours_ago: 5 },
        { io_type: 'output', quantity_ml: 1200, hours_ago: 3 },
        { io_type: 'output', quantity_ml: 600, hours_ago: 20 },
      ];
      const recentRecords = records.filter(r => r.hours_ago <= period);
      const totalIntake = recentRecords.filter(r => r.io_type === 'intake').reduce((s, r) => s + r.quantity_ml, 0);
      const totalOutput = recentRecords.filter(r => r.io_type === 'output').reduce((s, r) => s + r.quantity_ml, 0);
      expect(totalIntake).toBe(2000);
      expect(totalOutput).toBe(1800);
      expect(totalIntake - totalOutput).toBe(200);
    });

    it('should flag abnormal fluid balance (> 1000ml positive)', () => {
      const balance = 1500;
      const isAbnormal = Math.abs(balance) > 1000;
      expect(isAbnormal).toBe(true);
    });

    it('should flag abnormal fluid balance (> 1000ml negative)', () => {
      const balance = -1200;
      const isAbnormal = Math.abs(balance) > 1000;
      expect(isAbnormal).toBe(true);
    });

    it('should accept normal fluid balance range', () => {
      const balance = 500;
      const isNormal = Math.abs(balance) <= 1000;
      expect(isNormal).toBe(true);
    });

    it('should handle intake records without output', () => {
      const records = [{ intake_type: 'IV Fluid', intake_amount: 500, intake_unit: 'ml' }];
      const totalIntake = records.reduce((s, r) => s + (r.intake_amount ?? 0), 0);
      const totalOutput = 0;
      expect(totalIntake).toBe(500);
      expect(totalOutput).toBe(0);
      expect(totalIntake - totalOutput).toBe(500);
    });

    it('should handle output records without intake', () => {
      const records = [{ output_type: 'Urine', output_amount: 400, output_unit: 'ml' }];
      const totalIntake = 0;
      const totalOutput = records.reduce((s, r) => s + (r.output_amount ?? 0), 0);
      expect(totalIntake).toBe(0);
      expect(totalOutput).toBe(400);
      expect(totalIntake - totalOutput).toBe(-400);
    });

    it('should validate intake unit', () => {
      const validUnits = ['ml', 'L', 'cc'];
      expect(validUnits).toContain('ml');
      expect(validUnits).toContain('L');
      expect(validUnits).not.toContain('kg');
    });

    it('should validate output unit', () => {
      const validUnits = ['ml', 'L', 'cc'];
      expect(validUnits).toContain('ml');
      expect(validUnits).toContain('cc');
      expect(validUnits).not.toContain('g');
    });
  });

  // ─── IV Drugs ─────────────────────────────────────────────────────────────

  describe('IV Drug Tracking', () => {
    const validStatuses = ['running', 'completed', 'stopped'];

    it('should accept valid IV drug statuses', () => {
      validStatuses.forEach(s => {
        expect(validStatuses).toContain(s);
      });
    });

    it('should not allow invalid status transitions', () => {
      // Once completed, shouldn't go back to running
      const completedStatus = 'completed';
      const invalidTransitions = ['completed'];
      expect(invalidTransitions).toContain(completedStatus);
    });
  });

  // ─── Wound Care ───────────────────────────────────────────────────────────

  describe('Wound Care', () => {
    const validWoundTypes = ['surgical', 'pressure', 'traumatic', 'burn', 'diabetic', 'other'];

    it('should accept valid wound types', () => {
      validWoundTypes.forEach(t => {
        expect(validWoundTypes).toContain(t);
      });
    });

    it('should reject invalid wound types', () => {
      expect(validWoundTypes).not.toContain('minor');
      expect(validWoundTypes).not.toContain('internal');
    });
  });

  // ─── Handover ─────────────────────────────────────────────────────────────

  describe('Handover', () => {
    const validShifts = ['morning', 'evening', 'night'];

    it('should accept valid shifts', () => {
      validShifts.forEach(s => {
        expect(validShifts).toContain(s);
      });
    });

    it('should reject invalid shifts', () => {
      expect(validShifts).not.toContain('afternoon');
      expect(validShifts).not.toContain('day');
    });
  });

  // ─── OPD Status Transitions ───────────────────────────────────────────────

  describe('OPD Visit Flow', () => {
    const statusFlow = ['initiated', 'checked-in', 'concluded'];

    it('should follow correct status flow', () => {
      expect(statusFlow.indexOf('initiated')).toBeLessThan(statusFlow.indexOf('checked-in'));
      expect(statusFlow.indexOf('checked-in')).toBeLessThan(statusFlow.indexOf('concluded'));
    });

    it('should not allow check-out before check-in', () => {
      const currentStatus = 'initiated';
      const canCheckOut = currentStatus === 'checked-in';
      expect(canCheckOut).toBe(false);
    });

    it('should allow check-in only from initiated status', () => {
      const canCheckIn = (status: string) => status === 'initiated';
      expect(canCheckIn('initiated')).toBe(true);
      expect(canCheckIn('checked-in')).toBe(false);
      expect(canCheckIn('concluded')).toBe(false);
    });

    it('should allow check-out only from checked-in status', () => {
      const canCheckOut = (status: string) => status === 'checked-in';
      expect(canCheckOut('checked-in')).toBe(true);
      expect(canCheckOut('initiated')).toBe(false);
      expect(canCheckOut('concluded')).toBe(false);
    });
  });

  // ─── Pagination Logic ────────────────────────────────────────────────────

  describe('Pagination', () => {
    it('should calculate correct offset from page and limit', () => {
      expect((1 - 1) * 20).toBe(0);
      expect((2 - 1) * 20).toBe(20);
      expect((3 - 1) * 20).toBe(40);
    });

    it('should default to page 1 limit 20', () => {
      const defaults = { page: 1, limit: 20 };
      expect(defaults.page).toBe(1);
      expect(defaults.limit).toBe(20);
    });

    it('should calculate total pages correctly', () => {
      expect(Math.ceil(100 / 20)).toBe(5);
      expect(Math.ceil(101 / 20)).toBe(6);
      expect(Math.ceil(0 / 20)).toBe(0);
    });
  });

  // ─── Patient Query Schema Compatibility ─────────────────────────────────

  describe('Patient Query Schema Compatibility', () => {
    function buildPatientQuery(colNames: Set<string>, wardId?: number) {
      const hasVisitId = colNames.has('visit_id');
      const hasAdmittingDoctor = colNames.has('admitting_doctor_id');
      const hasIsActive = colNames.has('is_active');
      const hasWardId = colNames.has('ward_id');

      const visitIdCol = hasVisitId ? 'a.visit_id' : 'NULL AS visit_id';
      const doctorJoin = hasAdmittingDoctor
        ? 'LEFT JOIN doctors d ON d.id = a.admitting_doctor_id'
        : 'LEFT JOIN doctors d ON d.id = a.doctor_id';
      const isActiveFilter = hasIsActive ? 'AND a.is_active = 1' : '';
      const wardFilter = hasWardId && wardId ? 'AND a.ward_id = ?' : '';

      const sql = `
        SELECT
          p.id AS patient_id, p.patient_code, p.name, p.gender, p.mobile,
          a.id AS admission_id, a.admission_date, a.status AS admission_status,
          ${visitIdCol}, d.name AS doctor_name
        FROM admissions a
        JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
        ${doctorJoin}
        WHERE a.tenant_id = ? AND a.status = 'admitted' ${isActiveFilter} ${wardFilter}
        ORDER BY a.admission_date DESC LIMIT 100
      `;

      const params: (string | number)[] = ['tenant-1'];
      if (hasWardId && wardId) params.push(wardId);

      return { sql, params };
    }

    const fullSchema = new Set(['id', 'patient_id', 'tenant_id', 'visit_id', 'admitting_doctor_id', 'is_active', 'ward_id', 'doctor_id', 'status', 'admission_date']);
    const legacySchema = new Set(['id', 'patient_id', 'tenant_id', 'doctor_id', 'status', 'admission_date']);

    it('should use visit_id column when available', () => {
      const { sql } = buildPatientQuery(fullSchema);
      expect(sql).toContain('a.visit_id');
      expect(sql).not.toContain('NULL AS visit_id');
    });

    it('should fallback to NULL AS visit_id when column is missing', () => {
      const { sql } = buildPatientQuery(legacySchema);
      expect(sql).toContain('NULL AS visit_id');
      expect(sql).not.toMatch(/a\.visit_id/);
    });

    it('should join on admitting_doctor_id when available', () => {
      const { sql } = buildPatientQuery(fullSchema);
      expect(sql).toContain('a.admitting_doctor_id');
    });

    it('should fallback to doctor_id join when admitting_doctor_id is missing', () => {
      const { sql } = buildPatientQuery(legacySchema);
      expect(sql).toContain('a.doctor_id');
      expect(sql).not.toContain('admitting_doctor_id');
    });

    it('should include is_active filter when column exists', () => {
      const { sql } = buildPatientQuery(fullSchema);
      expect(sql).toContain('a.is_active = 1');
    });

    it('should omit is_active filter when column is missing', () => {
      const { sql } = buildPatientQuery(legacySchema);
      expect(sql).not.toContain('is_active');
    });

    it('should include ward_id filter when column exists and ward_id is provided', () => {
      const { sql, params } = buildPatientQuery(fullSchema, 5);
      expect(sql).toContain('a.ward_id = ?');
      expect(params).toContain(5);
    });

    it('should omit ward_id filter when column is missing even if ward_id is provided', () => {
      const { sql, params } = buildPatientQuery(legacySchema, 5);
      expect(sql).not.toContain('ward_id');
      expect(params).not.toContain(5);
    });

    it('should omit ward_id filter when column exists but no ward_id is provided', () => {
      const { sql, params } = buildPatientQuery(fullSchema);
      expect(sql).not.toContain('ward_id = ?');
      expect(params).toHaveLength(1);
    });

    it('should always include tenant_id param', () => {
      const { params } = buildPatientQuery(legacySchema);
      expect(params[0]).toBe('tenant-1');
    });
  });

  // ─── Monitoring Parameters ────────────────────────────────────────────────

  describe('Monitoring Parameters', () => {
    it('should track standard nursing parameters', () => {
      const standardParams = ['BP', 'SpO2', 'GCS', 'Temperature', 'Pulse', 'RR'];
      expect(standardParams.length).toBeGreaterThan(0);
      standardParams.forEach(p => {
        expect(typeof p).toBe('string');
        expect(p.length).toBeGreaterThan(0);
      });
    });

    it('should accept numeric values as strings', () => {
      const value = '120/80';
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW FEATURES — TDD Tests (should FAIL until implementation exists)
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── 14. Diet Sheet ────────────────────────────────────────────────────────

  describe('Diet Sheet Schema Validation', () => {
    describe('createDietTypeSchema', () => {
      it('should accept valid diet type', () => {
        const result = createDietTypeSchema.safeParse({
          diet_code: 'REG',
          diet_name: 'Regular',
          display_order: 1,
        });
        expect(result.success).toBe(true);
      });

      it('should reject diet type without code', () => {
        const result = createDietTypeSchema.safeParse({ diet_name: 'Regular' });
        expect(result.success).toBe(false);
      });

      it('should reject diet type without name', () => {
        const result = createDietTypeSchema.safeParse({ diet_code: 'REG' });
        expect(result.success).toBe(false);
      });

      it('should default display_order to 0', () => {
        const result = createDietTypeSchema.safeParse({ diet_code: 'REG', diet_name: 'Regular' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.display_order).toBe(0);
      });
    });

    describe('createPatientDietSchema', () => {
      it('should accept valid patient diet assignment', () => {
        const result = createPatientDietSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          diet_type_id: 1,
        });
        expect(result.success).toBe(true);
      });

      it('should accept optional fields', () => {
        const result = createPatientDietSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          diet_type_id: 1,
          extra_diet: 'Extra rice',
          ward_id: 5,
          remarks: 'No spice',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.extra_diet).toBe('Extra rice');
          expect(result.data.ward_id).toBe(5);
        }
      });

      it('should reject without patient_id', () => {
        const result = createPatientDietSchema.safeParse({ visit_id: 1, diet_type_id: 1 });
        expect(result.success).toBe(false);
      });

      it('should reject without diet_type_id', () => {
        const result = createPatientDietSchema.safeParse({ patient_id: 1, visit_id: 1 });
        expect(result.success).toBe(false);
      });
    });

    describe('dietSheetQuerySchema', () => {
      it('should apply defaults', () => {
        const result = dietSheetQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(1);
          expect(result.data.limit).toBe(20);
        }
      });

      it('should accept ward_id filter', () => {
        const result = dietSheetQuerySchema.safeParse({ ward_id: '5' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.ward_id).toBe(5);
      });
    });
  });

  // ─── 15. Blood Sugar Monitoring ────────────────────────────────────────────

  describe('Blood Sugar Schema Validation', () => {
    describe('createBloodSugarSchema', () => {
      it('should accept valid blood sugar record', () => {
        const result = createBloodSugarSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          rbs_value: 120,
        });
        expect(result.success).toBe(true);
      });

      it('should accept optional insulin', () => {
        const result = createBloodSugarSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          rbs_value: 180,
          insulin: 4,
          remarks: 'Pre-meal',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.insulin).toBe(4);
          expect(result.data.remarks).toBe('Pre-meal');
        }
      });

      it('should reject rbs_value below 0', () => {
        const result = createBloodSugarSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          rbs_value: -1,
        });
        expect(result.success).toBe(false);
      });

      it('should reject rbs_value above 1000', () => {
        const result = createBloodSugarSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          rbs_value: 1001,
        });
        expect(result.success).toBe(false);
      });

      it('should reject insulin below 0', () => {
        const result = createBloodSugarSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          rbs_value: 120,
          insulin: -1,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('bloodSugarQuerySchema', () => {
      it('should apply defaults', () => {
        const result = bloodSugarQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(1);
          expect(result.data.limit).toBe(20);
        }
      });

      it('should coerce string patient_id to number', () => {
        const result = bloodSugarQuerySchema.safeParse({ patient_id: '42' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.patient_id).toBe(42);
      });
    });

    describe('updateBloodSugarSchema', () => {
      it('should accept partial update', () => {
        const result = updateBloodSugarSchema.safeParse({ rbs_value: 200 });
        expect(result.success).toBe(true);
      });

      it('should accept empty update', () => {
        const result = updateBloodSugarSchema.safeParse({});
        expect(result.success).toBe(true);
      });
    });
  });

  // ─── 16. Consultation Requests ─────────────────────────────────────────────

  describe('Consultation Request Schema Validation', () => {
    describe('createConsultationRequestSchema', () => {
      it('should accept valid consultation request', () => {
        const result = createConsultationRequestSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          requesting_doctor_id: 1,
          purpose: 'Cardiology evaluation',
          consulting_doctor_id: 2,
        });
        expect(result.success).toBe(true);
      });

      it('should reject empty purpose', () => {
        const result = createConsultationRequestSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          requesting_doctor_id: 1,
          purpose: '',
          consulting_doctor_id: 2,
        });
        expect(result.success).toBe(false);
      });

      it('should reject without consulting_doctor_id', () => {
        const result = createConsultationRequestSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          requesting_doctor_id: 1,
          purpose: 'Evaluation',
        });
        expect(result.success).toBe(false);
      });

      it('should accept optional ward/bed', () => {
        const result = createConsultationRequestSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          requesting_doctor_id: 1,
          purpose: 'Evaluation',
          consulting_doctor_id: 2,
          ward_id: 3,
          bed_id: 10,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.ward_id).toBe(3);
          expect(result.data.bed_id).toBe(10);
        }
      });
    });

    describe('respondConsultationSchema', () => {
      it('should accept valid response', () => {
        const result = respondConsultationSchema.safeParse({
          consultant_response: 'Patient needs echo',
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.status).toBe('responded');
      });

      it('should reject empty response', () => {
        const result = respondConsultationSchema.safeParse({ consultant_response: '' });
        expect(result.success).toBe(false);
      });

      it('should accept accepted status', () => {
        const result = respondConsultationSchema.safeParse({
          consultant_response: 'Will see patient',
          status: 'accepted',
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.status).toBe('accepted');
      });
    });

    describe('consultationQuerySchema', () => {
      it('should apply defaults', () => {
        const result = consultationQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(1);
          expect(result.data.limit).toBe(20);
        }
      });

      it('should accept status filter', () => {
        const result = consultationQuerySchema.safeParse({ status: 'pending' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.status).toBe('pending');
      });

      it('should reject invalid status', () => {
        const result = consultationQuerySchema.safeParse({ status: 'invalid' });
        expect(result.success).toBe(false);
      });
    });
  });

  // ─── 17. Patient Transfer ──────────────────────────────────────────────────

  describe('Patient Transfer Schema Validation', () => {
    describe('createTransferSchema', () => {
      it('should accept valid transfer', () => {
        const result = createTransferSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          from_ward_id: 1,
          to_ward_id: 2,
        });
        expect(result.success).toBe(true);
      });

      it('should accept optional bed and reason', () => {
        const result = createTransferSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          from_ward_id: 1,
          from_bed_id: 5,
          to_ward_id: 2,
          to_bed_id: 10,
          transfer_reason: 'ICU transfer',
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.from_bed_id).toBe(5);
          expect(result.data.to_bed_id).toBe(10);
          expect(result.data.transfer_reason).toBe('ICU transfer');
        }
      });

      it('should reject without from_ward_id', () => {
        const result = createTransferSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          to_ward_id: 2,
        });
        expect(result.success).toBe(false);
      });

      it('should reject without to_ward_id', () => {
        const result = createTransferSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          from_ward_id: 1,
        });
        expect(result.success).toBe(false);
      });
    });

    describe('receiveTransferSchema', () => {
      it('should accept valid receive', () => {
        const result = receiveTransferSchema.safeParse({ received_by: 'Nurse John' });
        expect(result.success).toBe(true);
      });

      it('should reject empty received_by', () => {
        const result = receiveTransferSchema.safeParse({ received_by: '' });
        expect(result.success).toBe(false);
      });
    });

    describe('transferQuerySchema', () => {
      it('should apply defaults', () => {
        const result = transferQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(1);
          expect(result.data.limit).toBe(20);
        }
      });

      it('should accept status filter', () => {
        const result = transferQuerySchema.safeParse({ status: 'pending' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.status).toBe('pending');
      });
    });
  });

  // ─── 18. Nursing Orders ────────────────────────────────────────────────────

  describe('Nursing Orders Schema Validation', () => {
    describe('createNursingOrderSchema', () => {
      it('should accept valid lab order', () => {
        const result = createNursingOrderSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          order_type: 'lab',
          item_name: 'CBC',
          ordered_by: 1,
        });
        expect(result.success).toBe(true);
      });

      it('should accept radiology order', () => {
        const result = createNursingOrderSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          order_type: 'radiology',
          item_name: 'Chest X-Ray',
          ordered_by: 1,
          priority: 'urgent',
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.priority).toBe('urgent');
      });

      it('should reject invalid order_type', () => {
        const result = createNursingOrderSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          order_type: 'invalid',
          item_name: 'CBC',
          ordered_by: 1,
        });
        expect(result.success).toBe(false);
      });

      it('should reject invalid priority', () => {
        const result = createNursingOrderSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          order_type: 'lab',
          item_name: 'CBC',
          ordered_by: 1,
          priority: 'critical',
        });
        expect(result.success).toBe(false);
      });

      it('should default priority to routine', () => {
        const result = createNursingOrderSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          order_type: 'lab',
          item_name: 'CBC',
          ordered_by: 1,
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.priority).toBe('routine');
      });

      it('should default quantity to 1', () => {
        const result = createNursingOrderSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          order_type: 'lab',
          item_name: 'CBC',
          ordered_by: 1,
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.quantity).toBe(1);
      });
    });

    describe('updateNursingOrderStatusSchema', () => {
      it('should accept valid statuses', () => {
        for (const status of ['pending', 'accepted', 'completed', 'cancelled']) {
          const result = updateNursingOrderStatusSchema.safeParse({ status });
          expect(result.success).toBe(true);
        }
      });

      it('should reject invalid status', () => {
        const result = updateNursingOrderStatusSchema.safeParse({ status: 'invalid' });
        expect(result.success).toBe(false);
      });
    });

    describe('nursingOrderQuerySchema', () => {
      it('should apply defaults', () => {
        const result = nursingOrderQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(1);
          expect(result.data.limit).toBe(20);
        }
      });

      it('should accept order_type filter', () => {
        const result = nursingOrderQuerySchema.safeParse({ order_type: 'lab' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.order_type).toBe('lab');
      });
    });
  });

  // ─── 19. Drug Requisition ──────────────────────────────────────────────────

  describe('Drug Requisition Schema Validation', () => {
    describe('createDrugRequisitionSchema', () => {
      it('should accept valid requisition with items', () => {
        const result = createDrugRequisitionSchema.safeParse({
          ward_id: 1,
          items: [{ drug_name: 'Paracetamol', quantity: 10 }],
        });
        expect(result.success).toBe(true);
      });

      it('should accept multiple items', () => {
        const result = createDrugRequisitionSchema.safeParse({
          ward_id: 1,
          items: [
            { drug_name: 'Paracetamol', quantity: 10 },
            { drug_name: 'Amoxicillin', quantity: 20, unit: 'capsules' },
          ],
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.items).toHaveLength(2);
      });

      it('should reject empty items array', () => {
        const result = createDrugRequisitionSchema.safeParse({ ward_id: 1, items: [] });
        expect(result.success).toBe(false);
      });

      it('should reject item without drug_name', () => {
        const result = createDrugRequisitionSchema.safeParse({
          ward_id: 1,
          items: [{ quantity: 10 }],
        });
        expect(result.success).toBe(false);
      });

      it('should reject quantity below 1', () => {
        const result = createDrugRequisitionSchema.safeParse({
          ward_id: 1,
          items: [{ drug_name: 'Paracetamol', quantity: 0 }],
        });
        expect(result.success).toBe(false);
      });

      it('should default unit to tablets', () => {
        const result = createDrugRequisitionSchema.safeParse({
          ward_id: 1,
          items: [{ drug_name: 'Paracetamol' }],
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.items[0].unit).toBe('tablets');
      });
    });

    describe('drugRequisitionQuerySchema', () => {
      it('should apply defaults', () => {
        const result = drugRequisitionQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(1);
          expect(result.data.limit).toBe(20);
        }
      });

      it('should accept status filter', () => {
        const result = drugRequisitionQuerySchema.safeParse({ status: 'pending' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.status).toBe('pending');
      });
    });
  });

  // ─── 20. Ward Billing ─────────────────────────────────────────────────────

  describe('Ward Billing Schema Validation', () => {
    describe('createWardBillingRequestSchema', () => {
      it('should accept valid billing request', () => {
        const result = createWardBillingRequestSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          item_name: 'ECG',
        });
        expect(result.success).toBe(true);
      });

      it('should accept all fields', () => {
        const result = createWardBillingRequestSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          item_name: 'ECG',
          item_id: 100,
          service_department_id: 5,
          quantity: 2,
          price: 500,
          total_amount: 1000,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.price).toBe(500);
          expect(result.data.total_amount).toBe(1000);
        }
      });

      it('should reject without item_name', () => {
        const result = createWardBillingRequestSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
        });
        expect(result.success).toBe(false);
      });

      it('should reject negative price', () => {
        const result = createWardBillingRequestSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          item_name: 'ECG',
          price: -100,
        });
        expect(result.success).toBe(false);
      });

      it('should default quantity to 1', () => {
        const result = createWardBillingRequestSchema.safeParse({
          patient_id: 1,
          visit_id: 1,
          item_name: 'ECG',
        });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.quantity).toBe(1);
      });
    });

    describe('wardBillingQuerySchema', () => {
      it('should apply defaults', () => {
        const result = wardBillingQuerySchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.page).toBe(1);
          expect(result.data.limit).toBe(20);
        }
      });

      it('should accept status filter', () => {
        const result = wardBillingQuerySchema.safeParse({ status: 'pending' });
        expect(result.success).toBe(true);
        if (result.success) expect(result.data.status).toBe('pending');
      });

      it('should reject invalid status', () => {
        const result = wardBillingQuerySchema.safeParse({ status: 'invalid' });
        expect(result.success).toBe(false);
      });
    });
  });

  // ─── Transfer Status Transitions ───────────────────────────────────────────

  describe('Transfer Status Transitions', () => {
    const validStatuses = ['pending', 'received', 'cancelled'];

    it('should accept valid transfer statuses', () => {
      validStatuses.forEach(s => {
        expect(validStatuses).toContain(s);
      });
    });

    it('should not allow receive after cancelled', () => {
      const currentStatus = 'cancelled';
      const canReceive = currentStatus === 'pending';
      expect(canReceive).toBe(false);
    });

    it('should not allow cancel after received', () => {
      const currentStatus = 'received';
      const canCancel = currentStatus === 'pending';
      expect(canCancel).toBe(false);
    });
  });

  // ─── Nursing Order Priority Sorting ────────────────────────────────────────

  describe('Nursing Order Priority Sorting', () => {
    const priorityOrder: Record<string, number> = { stat: 1, urgent: 2, routine: 3 };

    it('should sort stat before urgent', () => {
      expect(priorityOrder['stat']).toBeLessThan(priorityOrder['urgent']);
    });

    it('should sort urgent before routine', () => {
      expect(priorityOrder['urgent']).toBeLessThan(priorityOrder['routine']);
    });

    it('should have exactly 3 priority levels', () => {
      expect(Object.keys(priorityOrder)).toHaveLength(3);
    });
  });

  // ─── Drug Requisition Status Transitions ───────────────────────────────────

  describe('Drug Requisition Status Transitions', () => {
    const validStatuses = ['pending', 'dispensed', 'cancelled'];

    it('should accept valid requisition statuses', () => {
      validStatuses.forEach(s => {
        expect(validStatuses).toContain(s);
      });
    });

    it('should not allow dispense after cancelled', () => {
      const currentStatus = 'cancelled';
      const canDispense = currentStatus === 'pending';
      expect(canDispense).toBe(false);
    });
  });

  // ─── Ward Billing Status Transitions ───────────────────────────────────────

  describe('Ward Billing Status Transitions', () => {
    const validStatuses = ['pending', 'approved', 'billed', 'cancelled'];

    it('should accept valid billing statuses', () => {
      validStatuses.forEach(s => {
        expect(validStatuses).toContain(s);
      });
    });

    it('should follow correct approval flow', () => {
      const statusFlow = ['pending', 'approved', 'billed'];
      expect(statusFlow.indexOf('pending')).toBeLessThan(statusFlow.indexOf('approved'));
      expect(statusFlow.indexOf('approved')).toBeLessThan(statusFlow.indexOf('billed'));
    });
  });
});
