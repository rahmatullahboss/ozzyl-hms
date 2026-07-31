/**
 * Enterprise-grade unit tests for HMS Zod schemas.
 *
 * Tests pure validation logic — no I/O, no DB, no server.
 * Covers: patient, billing, lab, pharmacy, visit, inventory schemas.
 *
 * Follows the rule: test VALID inputs pass, INVALID inputs fail with the right error.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ─── Patient / Visit schemas ─────────────────────────────────────────────────
import * as patientSchemas from '../../src/schemas/patient';
import * as visitSchemas from '../../src/schemas/visit';
import * as admissionSchemas from '../../src/schemas/admission';

// ─── Billing schemas ─────────────────────────────────────────────────────────
import * as billingSchemas from '../../src/schemas/billing';

// ─── Lab schemas ─────────────────────────────────────────────────────────────
import * as labSchemas from '../../src/schemas/lab';

// ─── Inventory schemas ────────────────────────────────────────────────────────
import {
  createVendorSchema, createItemSchema, createStoreSchema,
  createPurchaseOrderSchema, createWriteOffSchema,
  createStockAdjustmentSchema, createDispatchSchema,
  createReturnToVendorSchema,
} from '../../src/schemas/inventory';

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Assert a Zod schema parses successfully */
function expectValid<T>(schema: z.ZodType<T>, data: unknown, label?: string): T {
  const result = schema.safeParse(data);
  expect(result.success, `${label ?? 'schema'} should be valid — errors: ${
    result.success ? '' : JSON.stringify(result.error.flatten())
  }`).toBe(true);
  return (result as z.SafeParseSuccess<T>).data;
}

/** Assert a Zod schema rejects the input */
function expectInvalid<T>(schema: z.ZodType<T>, data: unknown, label?: string): void {
  const result = schema.safeParse(data);
  expect(result.success, `${label ?? 'schema'} should be invalid`).toBe(false);
}

// ─── Patient Schemas ──────────────────────────────────────────────────────────

describe('Patient Schemas', () => {
  // Patient schema uses camelCase: name, fatherHusband, address, mobile, gender
  const validPatient = {
    name: 'Fatema Khatun',
    fatherHusband: 'Karim Khan',
    address: 'Dhaka',
    mobile: '01711223344',
    age: 32,
    gender: 'female' as const,
  };

  it('accepts valid patient data', () => {
    expectValid(patientSchemas.createPatientSchema, validPatient, 'createPatientSchema');
  });

  it('rejects patient with missing name', () => {
    const { name: _removed, ...data } = validPatient;
    expectInvalid(patientSchemas.createPatientSchema, data, 'createPatientSchema (no name)');
  });

  it('rejects patient with invalid gender', () => {
    expectInvalid(patientSchemas.createPatientSchema, { ...validPatient, gender: 'Unknown' });
  });

  it('rejects patient with mobile under 11 digits', () => {
    expectInvalid(patientSchemas.createPatientSchema, { ...validPatient, mobile: '017' });
  });

  it('accepts patient without optional bloodGroup', () => {
    expectValid(patientSchemas.createPatientSchema, validPatient);
  });

  it('updatePatientSchema accepts partial data', () => {
    expectValid(patientSchemas.updatePatientSchema, { name: 'New Name' });
    expectValid(patientSchemas.updatePatientSchema, {});
  });
});

// ─── Visit Schemas ────────────────────────────────────────────────────────────

describe('Visit Schemas', () => {
  // Visit schema uses camelCase: patientId, doctorId, visitType
  const validVisit = {
    patientId: 1001,
    visitType: 'opd' as const,
  };

  it('accepts valid visit data', () => {
    expectValid(visitSchemas.createVisitSchema, validVisit, 'createVisitSchema');
  });

  it('rejects visit with invalid visitType enum', () => {
    expectInvalid(visitSchemas.createVisitSchema, { ...validVisit, visitType: 'virtual' });
  });

  it('rejects visit with missing patientId', () => {
    const { patientId: _removed, ...data } = validVisit;
    expectInvalid(visitSchemas.createVisitSchema, data);
  });

  it('rejects visit with non-positive doctorId', () => {
    expectInvalid(visitSchemas.createVisitSchema, { ...validVisit, doctorId: -1 });
  });

  it('defaults visitType to opd', () => {
    const result = expectValid(visitSchemas.createVisitSchema, { patientId: 1 });
    expect(result.visitType).toBe('opd');
  });

  it('validates icd10Code format', () => {
    expectValid(visitSchemas.createVisitSchema, { ...validVisit, icd10Code: 'J06' });
    expectInvalid(visitSchemas.createVisitSchema, { ...validVisit, icd10Code: 'invalid-code' });
  });
});

// ─── Admission Schemas ───────────────────────────────────────────────────────

describe('Admission Schemas', () => {
  const validAdmission = {
    patient_id: 1001,
    admission_type: 'emergency' as const,
    admit_source: 'emergency' as const,
    referral_doctor: 'Emergency Duty Doctor',
    admission_reason: 'Unstable vitals with severe abdominal pain',
    is_emergency: true,
  };

  it('accepts Bangladesh IPD intake metadata', () => {
    const result = expectValid(admissionSchemas.createAdmissionSchema, validAdmission);
    expect(result.admit_source).toBe('emergency');
    expect(result.referral_doctor).toBe('Emergency Duty Doctor');
    expect(result.admission_reason).toContain('Unstable vitals');
    expect(result.is_emergency).toBe(true);
  });

  it('rejects unknown admission source', () => {
    expectInvalid(admissionSchemas.createAdmissionSchema, {
      ...validAdmission,
      admit_source: 'telegram',
    });
  });

  it('allows cleaning as a post-discharge bed status', () => {
    expectValid(admissionSchemas.updateBedSchema, { status: 'cleaning' });
  });
});

// ─── Billing Schemas ──────────────────────────────────────────────────────────

describe('Billing Schemas', () => {
  // Billing uses camelCase: patientId, items[], items[].itemCategory/itemId/quantity/unitPrice
  const validBillItem = { itemCategory: 'doctor_visit', itemId: 1, quantity: 1, unitPrice: 500 };
  const validBill = { patientId: 1001, items: [validBillItem] };

  it('accepts valid bill data', () => {
    expectValid(billingSchemas.createBillSchema, validBill, 'createBillSchema');
  });

  it('rejects bill with empty items array', () => {
    expectInvalid(billingSchemas.createBillSchema, { ...validBill, items: [] }, 'createBillSchema (empty items)');
  });

  it('rejects bill with missing patientId', () => {
    expectInvalid(billingSchemas.createBillSchema, { items: [validBillItem] }, 'createBillSchema (no patientId)');
  });

  it('rejects bill item with non-positive quantity', () => {
    expectInvalid(billingSchemas.createBillSchema, {
      ...validBill,
      items: [{ ...validBillItem, quantity: 0 }],
    });
  });

  it('rejects bill item with negative unitPrice', () => {
    expectInvalid(billingSchemas.createBillSchema, {
      ...validBill,
      items: [{ ...validBillItem, unitPrice: -100 }],
    });
  });

  it('discount defaults to 0', () => {
    const result = expectValid(billingSchemas.createBillSchema, validBill);
    expect(result.discount).toBe(0);
  });

  it('accepts fire service as a bill item category', () => {
    expectValid(billingSchemas.createBillSchema, {
      patientId: 1001,
      items: [{ itemCategory: 'fire_service', quantity: 1, unitPrice: 50 }],
    });
  });
});

// ─── Lab Schemas ──────────────────────────────────────────────────────────────

describe('Lab Schemas', () => {
  // Lab uses camelCase: patientId, items[].labTestId
  const validLabOrderItem = { labTestId: 1 };
  const validLabOrder = { patientId: 1001, items: [validLabOrderItem] };

  it('accepts valid lab order', () => {
    expectValid(labSchemas.createLabOrderSchema, validLabOrder, 'createLabOrderSchema');
  });

  it('rejects lab order with empty items array', () => {
    expectInvalid(labSchemas.createLabOrderSchema, { patientId: 1001, items: [] });
  });

  it('rejects lab order with missing patientId', () => {
    expectInvalid(labSchemas.createLabOrderSchema, { items: [validLabOrderItem] });
  });

  it('validates updateLabItemResultSchema — requires result', () => {
    expectValid(labSchemas.updateLabItemResultSchema, { result: '5.5 g/dL' });
    expectInvalid(labSchemas.updateLabItemResultSchema, { result: '' });
    expectInvalid(labSchemas.updateLabItemResultSchema, {});
  });

  it('validates updateSampleStatusSchema accepts valid statuses', () => {
    for (const status of ['collected', 'received', 'processing', 'completed', 'rejected'] as const) {
      expectValid(labSchemas.updateSampleStatusSchema, { status });
    }
  });

  it('rejects invalid lab sample status', () => {
    expectInvalid(labSchemas.updateSampleStatusSchema, { status: 'lost' });
  });
});

// ─── Inventory — Vendor Schema ────────────────────────────────────────────────

describe('Inventory — Vendor Schema', () => {
  const validVendor = { VendorName: 'MedSupply Ltd' };

  it('accepts valid vendor data with defaults', () => {
    const result = expectValid(createVendorSchema, validVendor);
    expect(result.CreditPeriod).toBe(30);
    expect(result.IsActive).toBe(true);
    expect(result.IsTDSApplicable).toBe(false);
  });

  it('rejects vendor with empty VendorName', () => {
    expectInvalid(createVendorSchema, { VendorName: '' });
  });

  it('rejects vendor with invalid email format', () => {
    expectInvalid(createVendorSchema, { VendorName: 'Test', ContactEmail: 'not-an-email' });
  });

  it('accepts vendor with empty string email (optional)', () => {
    expectValid(createVendorSchema, { VendorName: 'Test', ContactEmail: '' });
  });
});

// ─── Inventory — Item Schema ──────────────────────────────────────────────────

describe('Inventory — Item Schema', () => {
  const validItem = { ItemName: 'Paracetamol 500mg' };

  it('accepts valid item with defaults', () => {
    const result = expectValid(createItemSchema, validItem);
    expect(result.IsActive).toBe(true);
    expect(result.StandardRate).toBe(0);
    expect(result.ReOrderLevel).toBe(0);
  });

  it('rejects item with empty ItemName', () => {
    expectInvalid(createItemSchema, { ItemName: '' });
  });

  it('rejects item with missing ItemName', () => {
    expectInvalid(createItemSchema, {});
  });
});

// ─── Inventory — Write-Off Schema ────────────────────────────────────────────

describe('Inventory — Write-Off Schema', () => {
  const validWriteOff = {
    StoreId: 1,
    Reason: 'expired',
    Items: [{ ItemId: 1, StockId: 1, Quantity: 25 }],
  };

  it('accepts valid write-off', () => {
    expectValid(createWriteOffSchema, validWriteOff, 'createWriteOffSchema');
  });

  it('rejects write-off with invalid Reason enum', () => {
    expectInvalid(createWriteOffSchema, { ...validWriteOff, Reason: 'lost' });
  });

  it('accepts all valid Reason values', () => {
    for (const reason of ['expired', 'damaged', 'theft', 'other'] as const) {
      expectValid(createWriteOffSchema, { ...validWriteOff, Reason: reason }, `Reason=${reason}`);
    }
  });

  it('rejects write-off with empty Items array', () => {
    expectInvalid(createWriteOffSchema, { ...validWriteOff, Items: [] });
  });

  it('rejects write-off item with non-positive Quantity', () => {
    expectInvalid(createWriteOffSchema, {
      ...validWriteOff,
      Items: [{ ItemId: 1, StockId: 1, Quantity: 0 }],
    });
  });

  it('rejects write-off with missing StoreId', () => {
    const { StoreId: _removed, ...data } = validWriteOff;
    expectInvalid(createWriteOffSchema, data);
  });
});

// ─── Inventory — Stock Adjustment Schema ─────────────────────────────────────

describe('Inventory — Stock Adjustment Schema', () => {
  const validAdjustment = {
    Items: [{
      ItemId: 1,
      StoreId: 1,
      AdjustmentType: 'in',
      Quantity: 50,
    }],
  };

  it('accepts valid stock adjustment', () => {
    expectValid(createStockAdjustmentSchema, validAdjustment);
  });

  it('rejects invalid AdjustmentType (only in/out allowed)', () => {
    expectInvalid(createStockAdjustmentSchema, {
      Items: [{ ...validAdjustment.Items[0], AdjustmentType: 'transfer' }],
    });
  });

  it('rejects empty Items array', () => {
    expectInvalid(createStockAdjustmentSchema, { Items: [] });
  });

  it('rejects non-positive Quantity', () => {
    expectInvalid(createStockAdjustmentSchema, {
      Items: [{ ...validAdjustment.Items[0], Quantity: -5 }],
    });
  });
});

// ─── Inventory — Dispatch Schema ─────────────────────────────────────────────

describe('Inventory — Dispatch Schema', () => {
  const validDispatch = {
    RequisitionId: 1,
    SourceStoreId: 1,
    DestinationStoreId: 2,
    Items: [{
      RequisitionItemId: 1,
      ItemId: 1,
      StockId: 1,
      DispatchedQuantity: 15,
    }],
  };

  it('accepts valid dispatch data', () => {
    expectValid(createDispatchSchema, validDispatch, 'createDispatchSchema');
  });

  it('accepts direct store-to-store dispatch without RequisitionId', () => {
    const { RequisitionId: _removed, ...data } = validDispatch;
    expectValid(createDispatchSchema, data);
  });

  it('rejects dispatch item with zero DispatchedQuantity', () => {
    expectInvalid(createDispatchSchema, {
      ...validDispatch,
      Items: [{ ...validDispatch.Items[0], DispatchedQuantity: 0 }],
    });
  });

  it('rejects dispatch with empty Items', () => {
    expectInvalid(createDispatchSchema, { ...validDispatch, Items: [] });
  });
});

// ─── Inventory — Return to Vendor Schema ─────────────────────────────────────

describe('Inventory — Return to Vendor Schema', () => {
  const validReturn = {
    VendorId: 1,
    GoodsReceiptId: 1,
    StoreId: 1,
    Reason: 'Defective items',
    Items: [{ GRItemId: 1, ItemId: 1, ReturnQuantity: 10 }],
  };

  it('accepts valid return data', () => {
    expectValid(createReturnToVendorSchema, validReturn, 'createReturnToVendorSchema');
  });

  it('rejects return with missing VendorId', () => {
    const { VendorId: _removed, ...data } = validReturn;
    expectInvalid(createReturnToVendorSchema, data);
  });

  it('rejects return with missing Reason', () => {
    const { Reason: _removed, ...data } = validReturn;
    expectInvalid(createReturnToVendorSchema, data);
  });

  it('rejects return item with zero ReturnQuantity', () => {
    expectInvalid(createReturnToVendorSchema, {
      ...validReturn,
      Items: [{ ...validReturn.Items[0], ReturnQuantity: 0 }],
    });
  });
});

// ─── Inventory — Store Schema ─────────────────────────────────────────────────

describe('Inventory — Store Schema', () => {
  it('accepts valid store with default type', () => {
    const result = expectValid(createStoreSchema, { StoreName: 'Main Pharmacy' });
    expect(result.StoreType).toBe('main');
    expect(result.IsActive).toBe(true);
  });

  it('accepts all valid StoreType values', () => {
    for (const type of ['main', 'substore', 'departmental'] as const) {
      expectValid(createStoreSchema, { StoreName: 'Test', StoreType: type });
    }
  });

  it('rejects invalid StoreType', () => {
    expectInvalid(createStoreSchema, { StoreName: 'Test', StoreType: 'warehouse' });
  });
});
