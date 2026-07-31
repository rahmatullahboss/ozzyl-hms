/**
 * SCHEMA VALIDATION TESTS
 *
 * Comprehensive tests for all Zod schemas in src/schemas/*.ts
 * These tests cover the following patterns that v8 tracks:
 * - Schema parse() success  → covers the Zod type expressions
 * - Schema safeParse() failure → covers error branches in Zod internals
 * - Optional field handling → covers undefined vs present branches
 * - Enum validation → covers all enum values
 * - Default values → covers default() resolution branches
 *
 * Target files with uncovered branches:
 * - src/schemas/lab.ts         (L58: enum 'other' branch)
 * - src/schemas/patientPortal.ts (L1161-1177 lines in routes)
 * - src/schemas/billing.ts     (enum branches)
 * - src/schemas/commission.ts  (regex branch)
 * - src/schemas/insurance.ts   (many enum values)
 */
import { describe, it, expect } from 'vitest';

// ── Lab schemas ───────────────────────────────────────────────────────────────
import {
  createLabTestSchema,
  updateLabTestSchema,
  createLabOrderSchema,
  updateLabItemResultSchema,
  updateSampleStatusSchema,
} from '../../../src/schemas/lab';

// ── Patient Portal schemas ────────────────────────────────────────────────────
import {
  requestMagicLinkSchema,
  verifyMagicLinkSchema,
  patientRegisterSchema,
} from '../../../src/schemas/patientPortal';

// ── Billing schemas ───────────────────────────────────────────────────────────
import {
  createBillSchema,
  invoiceItemSchema,
  paymentSchema,
} from '../../../src/schemas/billing';

// ── Commission schemas ────────────────────────────────────────────────────────
import {
  createCommissionSchema,
  markCommissionPaidSchema,
} from '../../../src/schemas/commission';

// ── Insurance schemas ─────────────────────────────────────────────────────────
import {
  insurancePolicySchema,
  insuranceClaimSchema,
  updateInsuranceClaimSchema,
  claimsQuerySchema,
  updateInsurancePolicySchema,
} from '../../../src/schemas/insurance';

// ── Appointment schemas ───────────────────────────────────────────────────────
import {
  createAppointmentSchema,
  updateAppointmentSchema,
} from '../../../src/schemas/appointment';

// ── Patient schemas ───────────────────────────────────────────────────────────
import {
  createPatientSchema,
  updatePatientSchema,
} from '../../../src/schemas/patient';

// ── Doctor schemas ────────────────────────────────────────────────────────────
import {
  createDoctorSchema,
  updateDoctorSchema,
} from '../../../src/schemas/doctor';

// ── Staff schemas ─────────────────────────────────────────────────────────────
import {
  createStaffSchema,
  updateStaffSchema,
} from '../../../src/schemas/staff';

// ── Expense schemas ───────────────────────────────────────────────────────────
import {
  createExpenseSchema,
  updateExpenseSchema,
} from '../../../src/schemas/expense';

// ── Income schemas ────────────────────────────────────────────────────────────
import {
  createIncomeSchema,
} from '../../../src/schemas/income';

// ── Branch schemas ────────────────────────────────────────────────────────────
import {
  createBranchSchema,
  updateBranchSchema,
} from '../../../src/schemas/branch';

// ── Prescription schemas ──────────────────────────────────────────────────────
import {
  createPrescriptionSchema,
} from '../../../src/schemas/prescription';

// ── Visit schemas ─────────────────────────────────────────────────────────────
import {
  createVisitSchema,
} from '../../../src/schemas/visit';

// ── Shareholder schemas ───────────────────────────────────────────────────────
import {
  createShareholderSchema,
} from '../../../src/schemas/shareholder';

// ── Pharmacy schemas ──────────────────────────────────────────────────────────
import {
  createMedicineSchema,
} from '../../../src/schemas/pharmacy';

// ── Website schemas ───────────────────────────────────────────────────────────
import {
  websiteConfigSchema,
} from '../../../src/schemas/website';

// ════════════════════════════════════════════════════════════════════════════════

describe('Schema: lab', () => {
  describe('createLabTestSchema', () => {
    it('valid with all fields', () => {
      const r = createLabTestSchema.safeParse({ code: 'CBC', name: 'Complete Blood Count', price: 500, category: 'blood' });
      expect(r.success).toBe(true);
    });
    it('valid without optional category', () => {
      const r = createLabTestSchema.safeParse({ code: 'LFT', name: 'Liver Function Test', price: 1200 });
      expect(r.success).toBe(true);
    });
    it('accepts admin-managed lab category names', () => {
      for (const cat of ['blood', 'urine', 'xray', 'ultrasound', 'ecg', 'other', 'Hematology', 'Biochemistry'] as const) {
        const r = createLabTestSchema.safeParse({ code: 'X', name: 'Test', price: 100, category: cat });
        expect(r.success).toBe(true);
      }
    });
    it('invalid: missing code', () => {
      const r = createLabTestSchema.safeParse({ name: 'Test', price: 100 });
      expect(r.success).toBe(false);
    });
    it('invalid: negative price', () => {
      const r = createLabTestSchema.safeParse({ code: 'X', name: 'Y', price: -100 });
      expect(r.success).toBe(false);
    });
  });

  describe('updateLabTestSchema', () => {
    it('valid partial update', () => {
      const r = updateLabTestSchema.safeParse({ price: 800 });
      expect(r.success).toBe(true);
    });
    it('valid empty update', () => {
      const r = updateLabTestSchema.safeParse({});
      expect(r.success).toBe(true);
    });
    it('valid active status update from the admin catalog toggle', () => {
      const r = updateLabTestSchema.safeParse({ is_active: 0 });
      expect(r.success).toBe(true);
    });
  });

  describe('createLabOrderSchema', () => {
    it('valid complete order', () => {
      const r = createLabOrderSchema.safeParse({
        patientId: 1, visitId: 2, orderDate: '2025-03-15',
        items: [{ labTestId: 1, discount: 0 }],
      });
      expect(r.success).toBe(true);
    });
    it('valid minimal order (no visitId/orderDate)', () => {
      const r = createLabOrderSchema.safeParse({
        patientId: 1, items: [{ labTestId: 1 }],
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.items[0].discount).toBe(0); // default()
    });
    it('invalid: empty items array', () => {
      const r = createLabOrderSchema.safeParse({ patientId: 1, items: [] });
      expect(r.success).toBe(false);
    });
  });

  describe('updateSampleStatusSchema', () => {
    for (const s of ['collected', 'received', 'processing', 'completed', 'rejected'] as const) {
      it(`valid status: ${s}`, () => {
        const r = updateSampleStatusSchema.safeParse({ status: s });
        expect(r.success).toBe(true);
      });
    }
    it('with notes', () => {
      const r = updateSampleStatusSchema.safeParse({ status: 'completed', notes: 'All good' });
      expect(r.success).toBe(true);
    });
    it('invalid status', () => {
      const r = updateSampleStatusSchema.safeParse({ status: 'unknown' });
      expect(r.success).toBe(false);
    });
  });
});

describe('Schema: patientPortal', () => {
  it('requestMagicLinkSchema valid', () => {
    const r = requestMagicLinkSchema.safeParse({ email: 'patient@example.com' });
    expect(r.success).toBe(true);
  });
  it('requestMagicLinkSchema invalid email', () => {
    const r = requestMagicLinkSchema.safeParse({ email: 'not-an-email' });
    expect(r.success).toBe(false);
  });
  it('verifyMagicLinkSchema valid', () => {
    const r = verifyMagicLinkSchema.safeParse({ token: 'some-jwt-token' });
    expect(r.success).toBe(true);
  });
  it('verifyMagicLinkSchema invalid: empty token', () => {
    const r = verifyMagicLinkSchema.safeParse({ token: '' });
    expect(r.success).toBe(false);
  });
  it('patientRegisterSchema valid', () => {
    const r = patientRegisterSchema.safeParse({ name: 'Test', email: 'p@e.com' });
    expect(r.success).toBe(true);
  });
  it('patientRegisterSchema invalid: missing name', () => {
    const r = patientRegisterSchema.safeParse({ email: 'p@e.com' });
    expect(r.success).toBe(false);
  });
});

describe('Schema: billing', () => {
  it('invoiceItemSchema valid test item', () => {
    const r = invoiceItemSchema.safeParse({ itemCategory: 'test', quantity: 1, unitPrice: 500 });
    expect(r.success).toBe(true);
  });
  it('invoiceItemSchema covers all categories', () => {
    for (const cat of ['test', 'doctor_visit', 'operation', 'medicine', 'admission', 'other'] as const) {
      const r = invoiceItemSchema.safeParse({ itemCategory: cat, unitPrice: 100 });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.quantity).toBe(1); // default
    }
  });
  it('invoiceItemSchema invalid: negative price', () => {
    const r = invoiceItemSchema.safeParse({ itemCategory: 'medicine', unitPrice: -10 });
    expect(r.success).toBe(false);
  });
  it('createBillSchema valid', () => {
    const r = createBillSchema.safeParse({
      patientId: 1, items: [{ itemCategory: 'test', unitPrice: 500 }],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.discount).toBe(0); // default
  });
  it('paymentSchema valid with all payment methods', () => {
    for (const m of ['cash', 'bkash', 'bank', 'other'] as const) {
      const r = paymentSchema.safeParse({
        billId: 1,
        amount: 500,
        paymentMethod: m,
        externalTransactionId: m === 'cash' ? undefined : `REF-${m}`,
      });
      expect(r.success).toBe(true);
    }
  });
  it('paymentSchema requires a reference for non-cash payments', () => {
    const r = paymentSchema.safeParse({ billId: 1, amount: 500, paymentMethod: 'bkash' });
    expect(r.success).toBe(false);
  });
  it('paymentSchema covers type enum', () => {
    for (const t of ['current', 'due'] as const) {
      const r = paymentSchema.safeParse({ billId: 1, amount: 100, type: t });
      expect(r.success).toBe(true);
    }
  });
});

describe('Schema: commission', () => {
  it('createCommissionSchema valid', () => {
    const r = createCommissionSchema.safeParse({ marketingPerson: 'Rahim', commissionAmount: 1000 });
    expect(r.success).toBe(true);
  });
  it('createCommissionSchema with optional fields', () => {
    const r = createCommissionSchema.safeParse({
      marketingPerson: 'Karim', mobile: '01700000000', patientId: 1, billId: 2,
      commissionAmount: 500, notes: 'Q1 2025',
    });
    expect(r.success).toBe(true);
  });
  it('createCommissionSchema invalid: missing marketingPerson', () => {
    const r = createCommissionSchema.safeParse({ commissionAmount: 100 });
    expect(r.success).toBe(false);
  });
  it('markCommissionPaidSchema valid', () => {
    const r = markCommissionPaidSchema.safeParse({ paidDate: '2025-03-15', notes: 'Paid in cash' });
    expect(r.success).toBe(true);
  });
  it('markCommissionPaidSchema valid empty', () => {
    const r = markCommissionPaidSchema.safeParse({});
    expect(r.success).toBe(true);
  });
  it('markCommissionPaidSchema invalid date format', () => {
    const r = markCommissionPaidSchema.safeParse({ paidDate: '15-03-2025' });
    expect(r.success).toBe(false);
  });
});

describe('Schema: insurance', () => {
  it('insurancePolicySchema valid', () => {
    const r = insurancePolicySchema.safeParse({
      patient_id: 1, provider_name: 'Delta Life', policy_no: 'POL-001',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.policy_type).toBe('individual'); // default
      expect(r.data.status).toBe('active');          // default
    }
  });
  it('insurancePolicySchema covers policy_type enum', () => {
    for (const t of ['individual', 'group', 'government'] as const) {
      const r = insurancePolicySchema.safeParse({ patient_id: 1, provider_name: 'X', policy_no: 'Y', policy_type: t });
      expect(r.success).toBe(true);
    }
  });
  it('insurancePolicySchema covers status enum', () => {
    for (const s of ['active', 'expired', 'cancelled'] as const) {
      const r = insurancePolicySchema.safeParse({ patient_id: 1, provider_name: 'X', policy_no: 'Y', status: s });
      expect(r.success).toBe(true);
    }
  });
  it('insuranceClaimSchema valid', () => {
    const r = insuranceClaimSchema.safeParse({ patient_id: 1, bill_amount: 50000, claimed_amount: 40000 });
    expect(r.success).toBe(true);
  });
  it('updateInsuranceClaimSchema covers all status values', () => {
    for (const s of ['submitted', 'under_review', 'approved', 'rejected', 'settled'] as const) {
      const r = updateInsuranceClaimSchema.safeParse({ status: s });
      expect(r.success).toBe(true);
    }
  });
  it('claimsQuerySchema defaults', () => {
    const r = claimsQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe('all');
      expect(r.data.page).toBe('1');
    }
  });
  it('claimsQuerySchema covers status enum including all', () => {
    for (const s of ['submitted', 'under_review', 'approved', 'rejected', 'settled', 'all'] as const) {
      const r = claimsQuerySchema.safeParse({ status: s });
      expect(r.success).toBe(true);
    }
  });
  it('updateInsurancePolicySchema partial', () => {
    const r = updateInsurancePolicySchema.safeParse({ provider_name: 'New Corp' });
    expect(r.success).toBe(true);
  });
});

describe('Schema: appointment', () => {
  it('createAppointmentSchema valid', () => {
    const r = createAppointmentSchema.safeParse({
      patientId: 1, apptDate: '2025-04-01',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.visitType).toBe('opd'); // default
  });
  it('createAppointmentSchema covers visitType enum', () => {
    for (const t of ['opd', 'followup', 'emergency'] as const) {
      const r = createAppointmentSchema.safeParse({ patientId: 1, apptDate: '2025-04-01', visitType: t });
      expect(r.success).toBe(true);
    }
  });
  it('createAppointmentSchema invalid: bad date format', () => {
    const r = createAppointmentSchema.safeParse({ patientId: 1, apptDate: '01-04-2025' });
    expect(r.success).toBe(false);
  });
  it('updateAppointmentSchema valid partial', () => {
    const r = updateAppointmentSchema.safeParse({ status: 'completed' });
    expect(r.success).toBe(true);
  });
});

describe('Schema: patient', () => {
  it('createPatientSchema valid — all required fields', () => {
    const r = createPatientSchema.safeParse({ name: 'John Doe', mobile: '01712345678', age: 30, gender: 'male' });
    expect(r.success).toBe(true);
  });
  it('createPatientSchema covers gender enum', () => {
    for (const g of ['male', 'female', 'other'] as const) {
      const r = createPatientSchema.safeParse({ name: 'A', mobile: '01712345678', age: 30, gender: g });
      expect(r.success).toBe(true);
    }
  });
  it('createPatientSchema invalid: mobile too short', () => {
    const r = createPatientSchema.safeParse({ name: 'A', mobile: '0171', age: 30, gender: 'male' });
    expect(r.success).toBe(false);
  });
  it('updatePatientSchema empty', () => {
    const r = updatePatientSchema.safeParse({});
    expect(r.success).toBe(true);
  });
});

describe('Schema: doctor', () => {
  it('createDoctorSchema valid', () => {
    const r = createDoctorSchema.safeParse({ name: 'Dr. Rahman', consultationFee: 800 });
    expect(r.success).toBe(true);
  });
  it('createDoctorSchema with all fields', () => {
    const r = createDoctorSchema.safeParse({ name: 'Dr. Karim', specialty: 'Cardiology', mobileNumber: '01700000000', consultationFee: 1500 });
    expect(r.success).toBe(true);
  });
  it('updateDoctorSchema partial', () => {
    const r = updateDoctorSchema.safeParse({ specialty: 'Neurology' });
    expect(r.success).toBe(true);
  });
});

describe('Schema: expense', () => {
  it('createExpenseSchema valid', () => {
    const r = createExpenseSchema.safeParse({ date: '2025-03-15', category: 'utilities', amount: 5000 });
    expect(r.success).toBe(true);
  });
  it('createExpenseSchema invalid date format', () => {
    const r = createExpenseSchema.safeParse({ date: '15/03/2025', category: 'rent', amount: 10000 });
    expect(r.success).toBe(false);
  });
  it('updateExpenseSchema partial', () => {
    const r = updateExpenseSchema.safeParse({ amount: 6000 });
    expect(r.success).toBe(true);
  });
});

describe('Schema: income', () => {
  it('createIncomeSchema valid', () => {
    const r = createIncomeSchema.safeParse({ date: '2025-03-15', source: 'pharmacy', amount: 25000 });
    expect(r.success).toBe(true);
  });
  it('createIncomeSchema covers all source values', () => {
    for (const s of ['pharmacy', 'laboratory', 'doctor_visit', 'admission', 'operation', 'ambulance', 'other'] as const) {
      const r = createIncomeSchema.safeParse({ date: '2025-01-01', source: s, amount: 1000 });
      expect(r.success).toBe(true);
    }
  });
  it('createIncomeSchema with optional billId', () => {
    const r = createIncomeSchema.safeParse({ date: '2025-03-15', source: 'pharmacy', amount: 500, billId: 42 });
    expect(r.success).toBe(true);
  });
});

describe('Schema: branch', () => {
  it('createBranchSchema valid', () => {
    const r = createBranchSchema.safeParse({ name: 'Main Branch' });
    expect(r.success).toBe(true);
  });
  it('createBranchSchema with all fields', () => {
    const r = createBranchSchema.safeParse({ name: 'Dhanmondi Branch', address: '5/A Dhanmondi', phone: '01700000000', email: 'dhaka@hospital.com' });
    expect(r.success).toBe(true);
  });
  it('updateBranchSchema empty', () => {
    const r = updateBranchSchema.safeParse({});
    expect(r.success).toBe(true);
  });
});

describe('Schema: prescription', () => {
  it('createPrescriptionSchema valid', () => {
    const r = createPrescriptionSchema.safeParse({
      patientId: 1, visitId: 2,
      medicines: [{ name: 'Paracetamol 500mg', dosage: '1 tab TDS', duration: '5 days' }],
    });
    expect(r.success).toBe(true);
  });
});

describe('Schema: visit', () => {
  it('createVisitSchema valid', () => {
    const r = createVisitSchema.safeParse({ patientId: 1, doctorId: 2 });
    expect(r.success).toBe(true);
  });
});

describe('Schema: shareholder', () => {
  it('createShareholderSchema valid', () => {
    const r = createShareholderSchema.safeParse({ name: 'Rahman Holdings', type: 'owner' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.shareCount).toBe(0); // default
      expect(r.data.isActive).toBe(true); // default
    }
  });
  it('createShareholderSchema covers type enum', () => {
    for (const t of ['profit', 'owner', 'investor', 'doctor', 'shareholder'] as const) {
      const r = createShareholderSchema.safeParse({ name: 'X', type: t });
      expect(r.success).toBe(true);
    }
  });
  it('createShareholderSchema with email (valid email branch)', () => {
    const r = createShareholderSchema.safeParse({ name: 'X', type: 'owner', email: 'x@test.com' });
    expect(r.success).toBe(true);
  });
});

describe('Schema: pharmacy', () => {
  it('createMedicineSchema valid', () => {
    const r = createMedicineSchema.safeParse({ name: 'Paracetamol 500mg', salePrice: 50 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reorderLevel).toBe(10); // default
  });
  it('createMedicineSchema with all optional fields', () => {
    const r = createMedicineSchema.safeParse({ name: 'Amoxil 500mg', genericName: 'Amoxicillin', company: 'Beximco', unit: 'capsule', salePrice: 120, reorderLevel: 20 });
    expect(r.success).toBe(true);
  });
  it('createMedicineSchema invalid: negative sale price', () => {
    const r = createMedicineSchema.safeParse({ name: 'X', salePrice: -10 });
    expect(r.success).toBe(false);
  });
});

describe('Schema: website', () => {
  it('websiteConfigSchema valid', () => {
    const r = websiteConfigSchema.safeParse({ siteName: 'City Hospital', tagline: 'Your health, our priority' });
    expect(r.success).toBe(true);
  });
});
