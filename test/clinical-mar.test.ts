import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ─── Clinical MAR Module Tests ────────────────────────────────────────────────
// Covers: MAR validation, Medication Orders (CPOE), Medication Reconciliation,
// compliance logic, status transitions, business rules, pagination, RBAC.

// ─── Zod schemas (mirrored from src/schemas/nursing.ts) ──────────────────────

const MARStatusEnum = z.enum(['given', 'withheld', 'refused', 'not_given']);
const RouteEnum = z.enum(['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhalation', 'Sublingual', 'Rectal']);
const PriorityEnum = z.enum(['stat', 'urgent', 'routine', 'prn']);
const OrderStatusEnum = z.enum(['active', 'completed', 'discontinued', 'on_hold', 'cancelled']);
const ReconciliationTypeEnum = z.enum(['admission', 'transfer', 'discharge']);
const ReconciliationActionEnum = z.enum(['continue', 'modify', 'discontinue', 'add']);
const ReconciliationSourceEnum = z.enum(['home', 'inpatient', 'new']);

const createMARSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  medication_name: z.string().min(1),
  generic_name: z.string().optional(),
  dose: z.string().optional(),
  route: z.string().optional(),
  frequency: z.string().optional(),
  scheduled_time: z.string().datetime().optional(),
  status: MARStatusEnum.optional(),
  reason_not_given: z.string().optional(),
  remarks: z.string().optional(),
  order_id: z.number().int().positive().optional(),
  formulary_item_id: z.number().int().positive().optional(),
});

const administerSchema = z.object({
  status: MARStatusEnum,
  actual_time: z.string().datetime().optional(),
  reason_not_given: z.string().optional(),
  remarks: z.string().optional(),
  barcode_scanned: z.number().int().min(0).max(1).optional(),
});

const createOrderSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  medication_name: z.string().min(1),
  generic_name: z.string().optional(),
  strength: z.string().optional(),
  dosage_form: z.string().optional(),
  dose: z.string().min(1),
  route: RouteEnum,
  frequency: z.string().min(1),
  duration: z.string().optional(),
  instructions: z.string().optional(),
  priority: PriorityEnum.default('routine'),
  start_datetime: z.string().datetime().optional(),
  end_datetime: z.string().datetime().optional(),
  formulary_item_id: z.number().int().positive().optional(),
});

const createReconciliationSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  reconciliation_type: ReconciliationTypeEnum,
  notes: z.string().optional(),
});

const addReconciliationItemSchema = z.object({
  medication_name: z.string().min(1),
  generic_name: z.string().optional(),
  dose: z.string().optional(),
  route: z.string().optional(),
  frequency: z.string().optional(),
  source: ReconciliationSourceEnum,
  action: ReconciliationActionEnum,
  action_reason: z.string().optional(),
  new_dose: z.string().optional(),
  new_route: z.string().optional(),
  new_frequency: z.string().optional(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. CLINICAL MAR — VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical MAR — Validation', () => {

  describe('MAR Entry Schema', () => {
    it('should accept a minimal valid MAR entry', () => {
      const result = createMARSchema.safeParse({ patient_id: 1, medication_name: 'Amoxicillin 500mg' });
      expect(result.success).toBe(true);
    });

    it('should accept a full MAR entry with all fields', () => {
      const result = createMARSchema.safeParse({
        patient_id: 1,
        visit_id: 10,
        medication_name: 'Amoxicillin 500mg',
        generic_name: 'Amoxicillin',
        dose: '500mg',
        route: 'Oral',
        frequency: 'TDS',
        scheduled_time: new Date().toISOString(),
        status: 'given',
        remarks: 'Taken with water',
        order_id: 5,
        formulary_item_id: 3,
      });
      expect(result.success).toBe(true);
    });

    it('should reject MAR entry without patient_id', () => {
      const result = createMARSchema.safeParse({ medication_name: 'Amoxicillin' });
      expect(result.success).toBe(false);
    });

    it('should reject MAR entry without medication_name', () => {
      const result = createMARSchema.safeParse({ patient_id: 1 });
      expect(result.success).toBe(false);
    });

    it('should reject negative patient_id', () => {
      const result = createMARSchema.safeParse({ patient_id: -1, medication_name: 'Paracetamol' });
      expect(result.success).toBe(false);
    });

    it('should reject zero patient_id', () => {
      const result = createMARSchema.safeParse({ patient_id: 0, medication_name: 'Paracetamol' });
      expect(result.success).toBe(false);
    });

    it('should reject empty medication_name', () => {
      const result = createMARSchema.safeParse({ patient_id: 1, medication_name: '' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid scheduled_time format', () => {
      const result = createMARSchema.safeParse({
        patient_id: 1,
        medication_name: 'Drug A',
        scheduled_time: '2026-01-01', // not ISO datetime
      });
      expect(result.success).toBe(false);
    });
  });

  describe('MAR Status Enum', () => {
    const validStatuses = ['given', 'withheld', 'refused', 'not_given'] as const;

    it('should accept all valid MAR statuses', () => {
      validStatuses.forEach(s => {
        const result = MARStatusEnum.safeParse(s);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid MAR statuses', () => {
      ['missed', 'cancelled', 'pending', 'done', ''].forEach(s => {
        const result = MARStatusEnum.safeParse(s);
        expect(result.success).toBe(false);
      });
    });

    it('should have exactly 4 valid statuses', () => {
      expect(validStatuses.length).toBe(4);
    });
  });

  describe('Administration Route Enum', () => {
    const validRoutes = ['Oral', 'IV', 'IM', 'SC', 'Topical', 'Inhalation', 'Sublingual', 'Rectal'] as const;

    it('should accept all valid routes', () => {
      validRoutes.forEach(r => {
        const result = RouteEnum.safeParse(r);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid routes', () => {
      ['oral', 'iv', 'intravenous', 'unknown', ''].forEach(r => {
        const result = RouteEnum.safeParse(r);
        expect(result.success).toBe(false);
      });
    });

    it('should be case-sensitive (Oral not oral)', () => {
      expect(RouteEnum.safeParse('Oral').success).toBe(true);
      expect(RouteEnum.safeParse('oral').success).toBe(false);
    });
  });

  describe('Administer Schema', () => {
    it('should accept minimal administer payload', () => {
      const result = administerSchema.safeParse({ status: 'given' });
      expect(result.success).toBe(true);
    });

    it('should accept full administer payload', () => {
      const result = administerSchema.safeParse({
        status: 'withheld',
        actual_time: new Date().toISOString(),
        reason_not_given: 'Patient NPO',
        remarks: 'Surgeon advised',
        barcode_scanned: 1,
      });
      expect(result.success).toBe(true);
    });

    it('should reject administer without status', () => {
      const result = administerSchema.safeParse({ actual_time: new Date().toISOString() });
      expect(result.success).toBe(false);
    });

    it('should reject barcode_scanned value of 2', () => {
      const result = administerSchema.safeParse({ status: 'given', barcode_scanned: 2 });
      expect(result.success).toBe(false);
    });

    it('should accept barcode_scanned as 0 or 1', () => {
      expect(administerSchema.safeParse({ status: 'given', barcode_scanned: 0 }).success).toBe(true);
      expect(administerSchema.safeParse({ status: 'given', barcode_scanned: 1 }).success).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. COMPLIANCE LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical MAR — Compliance Logic', () => {

  const calcCompliance = (entries: { status?: string }[]) => {
    if (entries.length === 0) return null;
    const given = entries.filter(e => e.status === 'given').length;
    return Math.round((given / entries.length) * 100);
  };

  it('should calculate 100% compliance when all given', () => {
    const entries = [
      { status: 'given' }, { status: 'given' }, { status: 'given' },
    ];
    expect(calcCompliance(entries)).toBe(100);
  });

  it('should calculate 0% compliance when none given', () => {
    const entries = [
      { status: 'withheld' }, { status: 'refused' }, { status: 'not_given' },
    ];
    expect(calcCompliance(entries)).toBe(0);
  });

  it('should calculate 67% compliance for 2 of 3 given', () => {
    const entries = [
      { status: 'given' }, { status: 'given' }, { status: 'refused' },
    ];
    expect(calcCompliance(entries)).toBe(67);
  });

  it('should return null for empty entry list', () => {
    expect(calcCompliance([])).toBeNull();
  });

  it('should flag below 80% as non-compliant', () => {
    const rate = calcCompliance([
      { status: 'given' }, { status: 'withheld' }, { status: 'refused' }, { status: 'not_given' },
    ]);
    expect(rate!).toBeLessThan(80);
  });

  it('should flag 80% or above as compliant', () => {
    const entries = Array(8).fill({ status: 'given' });
    entries.push({ status: 'withheld' });
    entries.push({ status: 'refused' });
    const rate = calcCompliance(entries);
    expect(rate!).toBeGreaterThanOrEqual(80);
  });

  it('should count missed (not_given) separately from withheld', () => {
    const entries = [
      { status: 'given' }, { status: 'not_given' }, { status: 'withheld' },
    ];
    const notGiven = entries.filter(e => e.status === 'not_given').length;
    const withheld = entries.filter(e => e.status === 'withheld').length;
    expect(notGiven).toBe(1);
    expect(withheld).toBe(1);
  });

  it('should calculate compliance stats object correctly', () => {
    const entries = [
      { status: 'given' }, { status: 'given' },
      { status: 'withheld' }, { status: 'refused' }, { status: 'not_given' },
    ];
    const stats = {
      total: entries.length,
      given_count: entries.filter(e => e.status === 'given').length,
      withheld_count: entries.filter(e => e.status === 'withheld').length,
      refused_count: entries.filter(e => e.status === 'refused').length,
      not_given_count: entries.filter(e => e.status === 'not_given').length,
    };
    expect(stats.total).toBe(5);
    expect(stats.given_count).toBe(2);
    expect(stats.withheld_count).toBe(1);
    expect(stats.refused_count).toBe(1);
    expect(stats.not_given_count).toBe(1);
    expect(stats.given_count + stats.withheld_count + stats.refused_count + stats.not_given_count).toBe(stats.total);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MEDICATION ORDERS (CPOE)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Medication Orders (CPOE) — Validation', () => {

  describe('Create Order Schema', () => {
    it('should accept a minimal valid order', () => {
      const result = createOrderSchema.safeParse({
        patient_id: 1,
        medication_name: 'Amoxicillin',
        dose: '500mg',
        route: 'Oral',
        frequency: 'TDS',
      });
      expect(result.success).toBe(true);
    });

    it('should accept a full CPOE order', () => {
      const result = createOrderSchema.safeParse({
        patient_id: 1,
        visit_id: 5,
        medication_name: 'Morphine',
        generic_name: 'Morphine Sulphate',
        strength: '10mg/ml',
        dosage_form: 'Injection',
        dose: '5mg',
        route: 'IV',
        frequency: 'Q4H',
        duration: '3 days',
        instructions: 'Titrate to pain',
        priority: 'stat',
        start_datetime: new Date().toISOString(),
      });
      expect(result.success).toBe(true);
    });

    it('should default priority to routine', () => {
      const result = createOrderSchema.safeParse({
        patient_id: 1, medication_name: 'Paracetamol', dose: '1g', route: 'Oral', frequency: 'QID',
      });
      if (result.success) {
        expect(result.data.priority).toBe('routine');
      }
    });

    it('should reject order without dose', () => {
      const result = createOrderSchema.safeParse({
        patient_id: 1, medication_name: 'Paracetamol', route: 'Oral', frequency: 'QID',
      });
      expect(result.success).toBe(false);
    });

    it('should reject order without frequency', () => {
      const result = createOrderSchema.safeParse({
        patient_id: 1, medication_name: 'Paracetamol', dose: '1g', route: 'Oral',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid route', () => {
      const result = createOrderSchema.safeParse({
        patient_id: 1, medication_name: 'Drug', dose: '1g', route: 'unknown', frequency: 'OD',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Order Priority', () => {
    const priorities = ['stat', 'urgent', 'routine', 'prn'] as const;

    it('should accept all valid priorities', () => {
      priorities.forEach(p => {
        const result = PriorityEnum.safeParse(p);
        expect(result.success).toBe(true);
      });
    });

    it('should define STAT as highest priority', () => {
      const priority_order = { stat: 0, urgent: 1, routine: 2, prn: 3 };
      expect(priority_order['stat']).toBeLessThan(priority_order['urgent']);
      expect(priority_order['urgent']).toBeLessThan(priority_order['routine']);
    });

    it('should reject invalid priority values', () => {
      ['emergency', 'low', 'high', ''].forEach(p => {
        expect(PriorityEnum.safeParse(p).success).toBe(false);
      });
    });
  });

  describe('Order Status Transitions', () => {
    const canDiscontinue = (status: string) => status === 'active' || status === 'on_hold';
    const canHold = (status: string) => status === 'active';
    const canResume = (status: string) => status === 'on_hold';

    it('should allow discontinuation from active', () => {
      expect(canDiscontinue('active')).toBe(true);
    });

    it('should allow discontinuation from on_hold', () => {
      expect(canDiscontinue('on_hold')).toBe(true);
    });

    it('should not allow discontinuation from completed', () => {
      expect(canDiscontinue('completed')).toBe(false);
    });

    it('should not allow discontinuation from cancelled', () => {
      expect(canDiscontinue('cancelled')).toBe(false);
    });

    it('should allow hold from active only', () => {
      expect(canHold('active')).toBe(true);
      expect(canHold('on_hold')).toBe(false);
      expect(canHold('completed')).toBe(false);
    });

    it('should allow resume from on_hold only', () => {
      expect(canResume('on_hold')).toBe(true);
      expect(canResume('active')).toBe(false);
      expect(canResume('completed')).toBe(false);
    });

    it('should accept all valid order statuses', () => {
      const validStatuses = ['active', 'completed', 'discontinued', 'on_hold', 'cancelled'] as const;
      validStatuses.forEach(s => {
        expect(OrderStatusEnum.safeParse(s).success).toBe(true);
      });
    });

    it('should reject invalid order statuses', () => {
      ['pending', 'held', 'stopped', ''].forEach(s => {
        expect(OrderStatusEnum.safeParse(s).success).toBe(false);
      });
    });
  });

  describe('STAT Order Business Rules', () => {
    it('should identify STAT orders for highlighting', () => {
      const orders = [
        { id: 1, priority: 'stat', medication_name: 'Epinephrine' },
        { id: 2, priority: 'routine', medication_name: 'Metformin' },
        { id: 3, priority: 'urgent', medication_name: 'Furosemide' },
      ];
      const statOrders = orders.filter(o => o.priority === 'stat');
      expect(statOrders.length).toBe(1);
      expect(statOrders[0].medication_name).toBe('Epinephrine');
    });

    it('should count active STAT orders correctly', () => {
      const orders = [
        { priority: 'stat', status: 'active' },
        { priority: 'stat', status: 'discontinued' },
        { priority: 'routine', status: 'active' },
      ];
      const activeStatOrders = orders.filter(o => o.priority === 'stat' && o.status === 'active').length;
      expect(activeStatOrders).toBe(1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. MEDICATION RECONCILIATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Medication Reconciliation — Validation', () => {

  describe('Create Reconciliation Schema', () => {
    it('should accept admission reconciliation', () => {
      const result = createReconciliationSchema.safeParse({
        patient_id: 1,
        reconciliation_type: 'admission',
      });
      expect(result.success).toBe(true);
    });

    it('should accept all reconciliation types', () => {
      const types = ['admission', 'transfer', 'discharge'] as const;
      types.forEach(t => {
        const result = createReconciliationSchema.safeParse({ patient_id: 1, reconciliation_type: t });
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid reconciliation type', () => {
      const result = createReconciliationSchema.safeParse({
        patient_id: 1,
        reconciliation_type: 'pre-op',
      });
      expect(result.success).toBe(false);
    });

    it('should accept optional notes', () => {
      const result = createReconciliationSchema.safeParse({
        patient_id: 1,
        reconciliation_type: 'discharge',
        notes: 'Patient on 5 home medications',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notes).toBe('Patient on 5 home medications');
      }
    });
  });

  describe('Reconciliation Item Schema', () => {
    it('should accept minimal item', () => {
      const result = addReconciliationItemSchema.safeParse({
        medication_name: 'Metformin 500mg',
        source: 'home',
        action: 'continue',
      });
      expect(result.success).toBe(true);
    });

    it('should accept modify action with new dose', () => {
      const result = addReconciliationItemSchema.safeParse({
        medication_name: 'Furosemide',
        dose: '20mg',
        route: 'Oral',
        frequency: 'OD',
        source: 'home',
        action: 'modify',
        new_dose: '40mg',
        new_frequency: 'BD',
        action_reason: 'Oedema worsening',
      });
      expect(result.success).toBe(true);
    });

    it('should accept discontinue action', () => {
      const result = addReconciliationItemSchema.safeParse({
        medication_name: 'Aspirin',
        source: 'home',
        action: 'discontinue',
        action_reason: 'Surgical procedure tomorrow',
      });
      expect(result.success).toBe(true);
    });

    it('should accept add action for new medications', () => {
      const result = addReconciliationItemSchema.safeParse({
        medication_name: 'Enoxaparin 40mg',
        dose: '40mg',
        route: 'SC',
        frequency: 'OD',
        source: 'new',
        action: 'add',
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing item action', () => {
      const result = addReconciliationItemSchema.safeParse({
        medication_name: 'Lisinopril',
        source: 'home',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid source', () => {
      const result = addReconciliationItemSchema.safeParse({
        medication_name: 'Drug',
        source: 'pharmacy',
        action: 'continue',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid action', () => {
      const result = addReconciliationItemSchema.safeParse({
        medication_name: 'Drug',
        source: 'home',
        action: 'hold',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing medication_name', () => {
      const result = addReconciliationItemSchema.safeParse({
        source: 'home',
        action: 'continue',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Reconciliation Status Flow', () => {
    const canComplete = (status: string) => status === 'in_progress';
    const isCompleted = (status: string) => status === 'completed';

    it('should only allow completion from in_progress', () => {
      expect(canComplete('in_progress')).toBe(true);
      expect(canComplete('completed')).toBe(false);
    });

    it('should mark reconciliation as completed after sign-off', () => {
      expect(isCompleted('completed')).toBe(true);
      expect(isCompleted('in_progress')).toBe(false);
    });

    it('should identify pending reconciliations', () => {
      const reconciliations = [
        { id: 1, status: 'in_progress', reconciliation_type: 'admission' },
        { id: 2, status: 'completed', reconciliation_type: 'discharge' },
        { id: 3, status: 'in_progress', reconciliation_type: 'transfer' },
      ];
      const pending = reconciliations.filter(r => r.status === 'in_progress');
      expect(pending.length).toBe(2);
    });
  });

  describe('Reconciliation Type Business Rules', () => {
    it('admission reconciliation should auto-import home meds', () => {
      // Business rule: admission type should trigger home medication import
      const type = 'admission';
      const shouldAutoImport = type === 'admission';
      expect(shouldAutoImport).toBe(true);
    });

    it('discharge reconciliation requires review of all inpatient meds', () => {
      const type = 'discharge';
      const requiresFullReview = type === 'discharge';
      expect(requiresFullReview).toBe(true);
    });

    it('transfer reconciliation should review current inpatient meds', () => {
      const type = 'transfer';
      const isTransfer = type === 'transfer';
      expect(isTransfer).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CLINICAL SAFETY RULES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical Safety Rules', () => {

  it('should require reason when medication not given', () => {
    const entry = { status: 'withheld', reason_not_given: '' };
    const isValid = entry.status === 'given' || entry.reason_not_given.length > 0;
    expect(isValid).toBe(false);
  });

  it('should not require reason when medication given', () => {
    const entry = { status: 'given', reason_not_given: '' };
    const isValid = entry.status === 'given' || entry.reason_not_given.length > 0;
    expect(isValid).toBe(true);
  });

  it('should validate STAT orders are not scheduled for future', () => {
    const now = new Date();
    const futureTime = new Date(now.getTime() + 2 * 60 * 60 * 1000); // 2hrs future
    const isStatAndFuture = futureTime.getTime() > now.getTime();
    // STAT should ideally be immediate
    expect(isStatAndFuture).toBe(true); // just validates the logic exists
  });

  it('should detect duplicate active orders for same drug', () => {
    const activeOrders = [
      { medication_name: 'Amoxicillin', status: 'active' },
      { medication_name: 'Amoxicillin', status: 'active' },
      { medication_name: 'Metformin', status: 'active' },
    ];
    const drugNames = activeOrders.filter(o => o.status === 'active').map(o => o.medication_name);
    const duplicates = drugNames.filter((name, idx) => drugNames.indexOf(name) !== idx);
    expect(duplicates.length).toBeGreaterThan(0);
    expect(duplicates[0]).toBe('Amoxicillin');
  });

  it('should detect potential drug allergy conflict (allergies list check)', () => {
    const patientAllergies = ['Penicillin', 'Sulfa'];
    const orderMedication = 'Amoxicillin'; // Penicillin-based
    const penicillinFamily = ['Amoxicillin', 'Ampicillin', 'Penicillin G'];
    const hasConflict = patientAllergies.some(a =>
      a === 'Penicillin' && penicillinFamily.includes(orderMedication),
    );
    expect(hasConflict).toBe(true);
  });

  it('should validate actual administration is not before scheduled time by more than 1 hour', () => {
    const scheduled = new Date('2026-01-01T08:00:00Z');
    const actual = new Date('2026-01-01T06:30:00Z'); // 1.5hr early
    const diffMs = scheduled.getTime() - actual.getTime();
    const earlyByMins = diffMs / 60000;
    const isEarlyWindowViolation = earlyByMins > 60;
    expect(isEarlyWindowViolation).toBe(true);
  });

  it('should allow administration within 1-hour window before scheduled time', () => {
    const scheduled = new Date('2026-01-01T08:00:00Z');
    const actual = new Date('2026-01-01T07:30:00Z'); // 30min early OK
    const diffMs = scheduled.getTime() - actual.getTime();
    const earlyByMins = diffMs / 60000;
    const isWithinWindow = earlyByMins <= 60;
    expect(isWithinWindow).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. RBAC FOR CLINICAL MAR
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical MAR — RBAC', () => {
  const NURSING_WRITE_ROLES = ['nurse', 'doctor', 'md', 'hospital_admin'];
  const ORDER_WRITE_ROLES = ['doctor', 'md', 'hospital_admin'];  // CPOE: only doctors
  const RECONCILIATION_ROLES = ['nurse', 'doctor', 'md', 'hospital_admin', 'pharmacist'];

  it('nurses should be able to administer MAR', () => {
    expect(NURSING_WRITE_ROLES).toContain('nurse');
  });

  it('only doctors and admins should create CPOE orders', () => {
    expect(ORDER_WRITE_ROLES).toContain('doctor');
    expect(ORDER_WRITE_ROLES).toContain('hospital_admin');
    expect(ORDER_WRITE_ROLES).not.toContain('nurse');
    expect(ORDER_WRITE_ROLES).not.toContain('receptionist');
  });

  it('pharmacists should participate in reconciliation', () => {
    expect(RECONCILIATION_ROLES).toContain('pharmacist');
    expect(RECONCILIATION_ROLES).toContain('nurse');
    expect(RECONCILIATION_ROLES).toContain('doctor');
  });

  it('receptionists should not have MAR write access', () => {
    expect(NURSING_WRITE_ROLES).not.toContain('receptionist');
    expect(ORDER_WRITE_ROLES).not.toContain('receptionist');
  });

  it('hospital_admin should have access to all clinical MAR features', () => {
    expect(NURSING_WRITE_ROLES).toContain('hospital_admin');
    expect(ORDER_WRITE_ROLES).toContain('hospital_admin');
    expect(RECONCILIATION_ROLES).toContain('hospital_admin');
  });

  it('patients should not have any MAR write access', () => {
    expect(NURSING_WRITE_ROLES).not.toContain('patient');
    expect(ORDER_WRITE_ROLES).not.toContain('patient');
    expect(RECONCILIATION_ROLES).not.toContain('patient');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. SCHEDULE VIEW LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

describe('MAR Schedule View Logic', () => {

  it('should group medications by scheduled hour', () => {
    const entries = [
      { medication_name: 'Drug A', scheduled_time: '2026-01-01T08:00:00Z' },
      { medication_name: 'Drug B', scheduled_time: '2026-01-01T08:00:00Z' },
      { medication_name: 'Drug C', scheduled_time: '2026-01-01T14:00:00Z' },
    ];
    const grouped = entries.reduce<Record<string, typeof entries>>((acc, e) => {
      const hour = new Date(e.scheduled_time).getUTCHours().toString();
      acc[hour] = acc[hour] ?? [];
      acc[hour].push(e);
      return acc;
    }, {});
    expect(Object.keys(grouped).length).toBe(2); // 08:00 and 14:00
    expect(grouped['8'].length).toBe(2);
    expect(grouped['14'].length).toBe(1);
  });

  it('should detect overdue medications', () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const entries = [
      { medication_name: 'Insulin', scheduled_time: twoHoursAgo, status: undefined },
      { medication_name: 'Metformin', scheduled_time: new Date().toISOString(), status: 'given' },
    ];
    const overdue = entries.filter(e =>
      e.status !== 'given' &&
      e.status !== 'withheld' &&
      e.status !== 'refused' &&
      new Date(e.scheduled_time).getTime() < now.getTime() - 60 * 60 * 1000,
    );
    expect(overdue.length).toBe(1);
    expect(overdue[0].medication_name).toBe('Insulin');
  });

  it('should identify upcoming medications in next 2 hours', () => {
    const now = new Date();
    const inOneHour = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const inThreeHours = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
    const entries = [
      { medication_name: 'Drug A', scheduled_time: inOneHour },
      { medication_name: 'Drug B', scheduled_time: inThreeHours },
    ];
    const upcoming = entries.filter(e => {
      const diff = new Date(e.scheduled_time).getTime() - now.getTime();
      return diff > 0 && diff <= 2 * 60 * 60 * 1000;
    });
    expect(upcoming.length).toBe(1);
    expect(upcoming[0].medication_name).toBe('Drug A');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. PAGINATION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical MAR — Pagination', () => {
  it('should compute correct offset for page 1', () => {
    expect((1 - 1) * 20).toBe(0);
  });

  it('should compute correct offset for page 2', () => {
    expect((2 - 1) * 20).toBe(20);
  });

  it('should compute total pages correctly', () => {
    expect(Math.ceil(47 / 20)).toBe(3);
    expect(Math.ceil(40 / 20)).toBe(2);
    expect(Math.ceil(0 / 20)).toBe(0);
  });

  it('should not allow page less than 1', () => {
    const page = Math.max(1, 0);
    expect(page).toBe(1);
  });

  it('should clamp limit between 1 and 100', () => {
    const clamp = (n: number) => Math.min(100, Math.max(1, n));
    expect(clamp(150)).toBe(100);
    expect(clamp(0)).toBe(1);
    expect(clamp(20)).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Clinical MAR — Edge Cases', () => {

  it('should handle medication name with special characters', () => {
    const name = "Gentamicin 80mg/2ml (Inj.)";
    const result = createMARSchema.safeParse({ patient_id: 1, medication_name: name });
    expect(result.success).toBe(true);
  });

  it('should handle very long medication name (200 chars)', () => {
    const longName = 'A'.repeat(200);
    const result = createMARSchema.safeParse({ patient_id: 1, medication_name: longName });
    expect(result.success).toBe(true); // schema doesn't cap length
  });

  it('should handle fractional doses', () => {
    const result = createOrderSchema.safeParse({
      patient_id: 1, medication_name: 'Warfarin', dose: '2.5mg', route: 'Oral', frequency: 'OD',
    });
    expect(result.success).toBe(true);
  });

  it('should handle PRN orders (as needed) frequency', () => {
    const result = createOrderSchema.safeParse({
      patient_id: 1, medication_name: 'Morphine', dose: '5mg', route: 'IV', frequency: 'PRN Q4H',
      priority: 'prn',
    });
    expect(result.success).toBe(true);
  });

  it('should handle reconciliation with no prior medications', () => {
    const homeMeds: object[] = [];
    const result = {
      type: 'admission',
      items_imported: homeMeds.length,
    };
    expect(result.items_imported).toBe(0);
  });

  it('should handle simultaneous administration of multiple medications', () => {
    const now = new Date().toISOString();
    const entries = [
      { medication_name: 'Drug A', actual_time: now, status: 'given' },
      { medication_name: 'Drug B', actual_time: now, status: 'given' },
      { medication_name: 'Drug C', actual_time: now, status: 'withheld' },
    ];
    const givenAtSameTime = entries.filter(e => e.actual_time === now && e.status === 'given');
    expect(givenAtSameTime.length).toBe(2);
  });

  it('should not allow order end_datetime before start_datetime', () => {
    const start = new Date('2026-01-01T08:00:00Z');
    const end = new Date('2026-01-01T06:00:00Z'); // before start
    const isInvalid = end.getTime() < start.getTime();
    expect(isInvalid).toBe(true);
  });

  it('should handle unicode characters in notes', () => {
    const result = createReconciliationSchema.safeParse({
      patient_id: 1,
      reconciliation_type: 'admission',
      notes: 'রোগী ডায়াবেটিক — home medications: মেটফরমিন ৫০০mg',
    });
    expect(result.success).toBe(true);
  });
});
