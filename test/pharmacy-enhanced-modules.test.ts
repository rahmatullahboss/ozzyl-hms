/**
 * Pharmacy Enhanced Module Tests — Gap Coverage
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Tests for endpoints that had ZERO or minimal coverage:
 *  - Narcotics (0 tests before)
 *  - Write-offs (0 schema tests)
 *  - Requisitions (0 schema tests)
 *  - Dispatches (0 schema tests)
 *  - Prescriptions (schema tests)
 *  - Provisional Invoices (schema tests)
 *  - Tax Config (schema tests)
 *  - Dosage Templates (schema tests)
 *  - Barcodes (schema tests)
 *  - Master Drugs/Generics/Companies (0 tests)
 */

import { describe, it, expect } from 'vitest';
import {
  createNarcoticRecordSchema,
  createWriteOffSchema,
  createRequisitionSchema,
  createDispatchSchema,
  createPrescriptionSchema,
  createProvisionalInvoiceSchema,
  createTaxConfigSchema,
  createDosageTemplateSchema,
  barcodeSchema,
} from '../src/schemas/pharmacy';

// ═══════════════════════════════════════════════════════════════════════════════
// NARCOTICS — Schedule drugs tracking
// ═══════════════════════════════════════════════════════════════════════════════

describe('Narcotics Schema', () => {
  it('should accept valid min narcotic record', () => {
    const result = createNarcoticRecordSchema.safeParse({
      itemId: 1,
      quantity: 10,
    });
    expect(result.success).toBe(true);
  });

  it('should accept full narcotic record with buyer/doctor info', () => {
    const result = createNarcoticRecordSchema.safeParse({
      itemId: 1,
      invoiceId: 100,
      patientId: 50,
      batchNo: 'NARC-001',
      quantity: 5,
      buyerName: 'Mr. Rahman',
      doctorName: 'Dr. Karim',
      nmcNumber: 'NMC-12345',
      remarks: 'Controlled substance dispensed per prescription',
    });
    expect(result.success).toBe(true);
  });

  it('should reject narcotic record without itemId', () => {
    const result = createNarcoticRecordSchema.safeParse({
      quantity: 10,
    });
    expect(result.success).toBe(false);
  });

  it('should reject narcotic record without quantity', () => {
    const result = createNarcoticRecordSchema.safeParse({
      itemId: 1,
    });
    expect(result.success).toBe(false);
  });

  it('should reject zero quantity', () => {
    const result = createNarcoticRecordSchema.safeParse({
      itemId: 1,
      quantity: 0,
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative quantity', () => {
    const result = createNarcoticRecordSchema.safeParse({
      itemId: 1,
      quantity: -5,
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative itemId', () => {
    const result = createNarcoticRecordSchema.safeParse({
      itemId: -1,
      quantity: 10,
    });
    expect(result.success).toBe(false);
  });

  it('should accept fractional quantity (e.g., 2.5 ml)', () => {
    const result = createNarcoticRecordSchema.safeParse({
      itemId: 1,
      quantity: 2.5,
    });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// WRITE-OFFS — Expired/damaged stock write-off
// ═══════════════════════════════════════════════════════════════════════════════

describe('Write-offs Schema', () => {
  it('should accept valid write-off', () => {
    const result = createWriteOffSchema.safeParse({
      writeOffDate: '2026-03-19',
      remarks: 'Expired stock removal',
      items: [
        { stockId: 1, itemId: 1, batchNo: 'B001', quantity: 10, itemRate: 500, remarks: 'Expired' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should accept write-off with multiple items', () => {
    const result = createWriteOffSchema.safeParse({
      writeOffDate: '2026-03-19',
      items: [
        { stockId: 1, itemId: 1, quantity: 10, itemRate: 500 },
        { stockId: 2, itemId: 2, quantity: 5, itemRate: 1000 },
        { stockId: 3, itemId: 3, batchNo: 'B003', quantity: 1, itemRate: 200 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should reject write-off without date', () => {
    const result = createWriteOffSchema.safeParse({
      items: [{ stockId: 1, itemId: 1, quantity: 10, itemRate: 500 }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject write-off with invalid date format', () => {
    const result = createWriteOffSchema.safeParse({
      writeOffDate: '19-03-2026', // Wrong format
      items: [{ stockId: 1, itemId: 1, quantity: 10, itemRate: 500 }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject write-off with empty items array', () => {
    const result = createWriteOffSchema.safeParse({
      writeOffDate: '2026-03-19',
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject write-off item with zero quantity', () => {
    const result = createWriteOffSchema.safeParse({
      writeOffDate: '2026-03-19',
      items: [{ stockId: 1, itemId: 1, quantity: 0, itemRate: 500 }],
    });
    expect(result.success).toBe(false);
  });

  it('should accept write-off with zero itemRate (free sample)', () => {
    const result = createWriteOffSchema.safeParse({
      writeOffDate: '2026-03-19',
      items: [{ stockId: 1, itemId: 1, quantity: 5, itemRate: 0 }],
    });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// REQUISITIONS — Inter-store stock requests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Requisitions Schema', () => {
  it('should accept valid requisition', () => {
    const result = createRequisitionSchema.safeParse({
      requisitionDate: '2026-03-19',
      items: [
        { itemId: 1, requestedQty: 50 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should accept requisition with store name and remarks', () => {
    const result = createRequisitionSchema.safeParse({
      requestingStore: 'Ward-3 Sub-pharmacy',
      requisitionDate: '2026-03-19',
      remarks: 'Urgently needed for ICU',
      items: [
        { itemId: 1, requestedQty: 100, remarks: 'Critical' },
        { itemId: 2, requestedQty: 50 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should reject requisition without date', () => {
    const result = createRequisitionSchema.safeParse({
      items: [{ itemId: 1, requestedQty: 50 }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject requisition with empty items', () => {
    const result = createRequisitionSchema.safeParse({
      requisitionDate: '2026-03-19',
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject requisition item with zero qty', () => {
    const result = createRequisitionSchema.safeParse({
      requisitionDate: '2026-03-19',
      items: [{ itemId: 1, requestedQty: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DISPATCHES — Inter-store stock transfers
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dispatches Schema', () => {
  it('should accept valid dispatch', () => {
    const result = createDispatchSchema.safeParse({
      dispatchDate: '2026-03-19',
      items: [
        { itemId: 1, batchNo: 'B001', dispatchedQty: 20, costPrice: 500, salePrice: 600 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should accept dispatch with full details', () => {
    const result = createDispatchSchema.safeParse({
      requisitionId: 1,
      sourceStore: 'Main Pharmacy',
      targetStore: 'Ward-3',
      dispatchDate: '2026-03-19',
      receivedBy: 'Nurse Fatima',
      remarks: 'Partial dispatch',
      items: [
        { requisitionItemId: 1, itemId: 1, stockId: 10, batchNo: 'B001', expiryDate: '2027-12-31', dispatchedQty: 20, costPrice: 500, salePrice: 600 },
        { itemId: 2, batchNo: 'B002', dispatchedQty: 10, costPrice: 800, salePrice: 1000 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should reject dispatch without date', () => {
    const result = createDispatchSchema.safeParse({
      items: [{ itemId: 1, batchNo: 'B001', dispatchedQty: 20, costPrice: 500, salePrice: 600 }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject dispatch with empty items', () => {
    const result = createDispatchSchema.safeParse({
      dispatchDate: '2026-03-19',
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('should reject dispatch item without batchNo', () => {
    const result = createDispatchSchema.safeParse({
      dispatchDate: '2026-03-19',
      items: [{ itemId: 1, dispatchedQty: 20, costPrice: 500, salePrice: 600 }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject dispatch item with zero qty', () => {
    const result = createDispatchSchema.safeParse({
      dispatchDate: '2026-03-19',
      items: [{ itemId: 1, batchNo: 'B001', dispatchedQty: 0, costPrice: 500, salePrice: 600 }],
    });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PRESCRIPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Prescriptions Schema', () => {
  it('should accept valid prescription', () => {
    const result = createPrescriptionSchema.safeParse({
      patientId: 1,
      items: [
        { itemId: 1, dosage: '500mg', frequency: 'TDS', duration: '7 days', quantity: 21 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should reject prescription without patientId', () => {
    const result = createPrescriptionSchema.safeParse({
      items: [
        { itemId: 1, dosage: '500mg', frequency: 'TDS', duration: '7 days', quantity: 21 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('should reject prescription with empty items', () => {
    const result = createPrescriptionSchema.safeParse({
      patientId: 1,
      items: [],
    });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROVISIONAL INVOICES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Provisional Invoices Schema', () => {
  it('should accept valid provisional invoice', () => {
    const result = createProvisionalInvoiceSchema.safeParse({
      patientId: 1,
      items: [
        { itemId: 1, quantity: 2, price: 500, salePrice: 600 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should accept provisional invoice with visit details', () => {
    const result = createProvisionalInvoiceSchema.safeParse({
      patientId: 1,
      patientVisitId: 100,
      counterId: 1,
      prescriberId: 50,
      visitType: 'inpatient',
      items: [
        { itemId: 1, quantity: 2, price: 500, salePrice: 600 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid visitType', () => {
    const result = createProvisionalInvoiceSchema.safeParse({
      patientId: 1,
      visitType: 'emergency', // not in enum
      items: [{ itemId: 1, quantity: 1, price: 100, salePrice: 150 }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject without patientId', () => {
    const result = createProvisionalInvoiceSchema.safeParse({
      items: [{ itemId: 1, quantity: 1, price: 100, salePrice: 150 }],
    });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TAX CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tax Config Schema', () => {
  it('should accept valid percentage tax', () => {
    const result = createTaxConfigSchema.safeParse({
      tax_name: 'VAT',
      tax_rate: 15,
      tax_type: 'percentage',
    });
    expect(result.success).toBe(true);
  });

  it('should accept valid flat tax', () => {
    const result = createTaxConfigSchema.safeParse({
      tax_name: 'Service Charge',
      tax_rate: 500,
      tax_type: 'flat',
    });
    expect(result.success).toBe(true);
  });

  it('should accept zero tax rate', () => {
    const result = createTaxConfigSchema.safeParse({
      tax_name: 'No Tax Zone',
      tax_rate: 0,
    });
    expect(result.success).toBe(true);
  });

  it('should reject without tax_name', () => {
    const result = createTaxConfigSchema.safeParse({
      tax_rate: 15,
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty tax_name', () => {
    const result = createTaxConfigSchema.safeParse({
      tax_name: '',
      tax_rate: 15,
    });
    expect(result.success).toBe(false);
  });

  it('should reject negative tax rate', () => {
    const result = createTaxConfigSchema.safeParse({
      tax_name: 'Bad Tax',
      tax_rate: -5,
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid tax_type', () => {
    const result = createTaxConfigSchema.safeParse({
      tax_name: 'VAT',
      tax_rate: 15,
      tax_type: 'mixed',
    });
    expect(result.success).toBe(false);
  });

  it('should default tax_type to percentage', () => {
    const result = createTaxConfigSchema.safeParse({
      tax_name: 'Default Tax',
      tax_rate: 10,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tax_type).toBe('percentage');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOSAGE TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dosage Templates Schema', () => {
  it('should accept valid dosage template', () => {
    const result = createDosageTemplateSchema.safeParse({
      dosage_label: '500mg TDS x 7d',
      frequency: 'Three times a day',
    });
    expect(result.success).toBe(true);
  });

  it('should accept full dosage template', () => {
    const result = createDosageTemplateSchema.safeParse({
      generic_id: 1,
      dosage_label: '250mg BD x 5d',
      frequency: 'Twice daily',
      route: 'IV',
      duration_days: 5,
      notes: 'Administer with food',
    });
    expect(result.success).toBe(true);
  });

  it('should default route to Oral', () => {
    const result = createDosageTemplateSchema.safeParse({
      dosage_label: '500mg OD',
      frequency: 'Once daily',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.route).toBe('Oral');
    }
  });

  it('should reject without dosage_label', () => {
    const result = createDosageTemplateSchema.safeParse({
      frequency: 'Once daily',
    });
    expect(result.success).toBe(false);
  });

  it('should reject without frequency', () => {
    const result = createDosageTemplateSchema.safeParse({
      dosage_label: '500mg OD',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty dosage_label', () => {
    const result = createDosageTemplateSchema.safeParse({
      dosage_label: '',
      frequency: 'Once daily',
    });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BARCODES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Barcode Schema', () => {
  it('should accept valid barcode', () => {
    const result = barcodeSchema.safeParse({ barcode: '1234567890' });
    expect(result.success).toBe(true);
  });

  it('should accept barcode with special chars', () => {
    const result = barcodeSchema.safeParse({ barcode: 'MED-2026-001-XL' });
    expect(result.success).toBe(true);
  });

  it('should reject empty barcode', () => {
    const result = barcodeSchema.safeParse({ barcode: '' });
    expect(result.success).toBe(false);
  });

  it('should reject barcode > 128 chars', () => {
    const result = barcodeSchema.safeParse({ barcode: 'A'.repeat(129) });
    expect(result.success).toBe(false);
  });

  it('should accept barcode at 128 chars (max)', () => {
    const result = barcodeSchema.safeParse({ barcode: 'B'.repeat(128) });
    expect(result.success).toBe(true);
  });

  it('should reject missing barcode field', () => {
    const result = barcodeSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
