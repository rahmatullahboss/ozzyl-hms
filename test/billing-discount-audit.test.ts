import { describe, it, expect } from 'vitest';
import { createBillSchema, editBillSchema } from '../src/schemas/billing';

// ─── Discount Audit Tests ──────────────────────────────────────────────────────
// Tests for discount_reason and approved_by fields on the bills table.
// These fields provide audit trail for compliance.

type ZodEffectLike = { _def: { schema?: unknown } };
type ZodObjectLike = { _def: { shape: () => Record<string, unknown> } };

function unwrapSchemaShape(schema: unknown): Record<string, unknown> {
  let inner = schema;
  while ((inner as ZodEffectLike)._def.schema) {
    inner = (inner as ZodEffectLike)._def.schema;
  }
  return (inner as ZodObjectLike)._def.shape();
}

describe('Discount Audit Fields', () => {
  describe('createBillSchema - discountReason', () => {
    it('should accept discountReason when provided with a discount reference', () => {
      const result = createBillSchema.safeParse({
        patientId: 1,
        items: [{ itemCategory: 'test', quantity: 1, unitPrice: 5000 }],
        discount: 500,
        discountReason: 'Staff discount',
        discountByName: 'Manager',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.discountReason).toBe('Staff discount');
      }
    });

    it('should accept when discount is 0 and discountReason is omitted', () => {
      const result = createBillSchema.safeParse({
        patientId: 1,
        items: [{ itemCategory: 'test', quantity: 1, unitPrice: 5000 }],
        discount: 0,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.discountReason).toBeUndefined();
      }
    });

    it('should reject when discount > 0 and discountReason is missing', () => {
      const result = createBillSchema.safeParse({
        patientId: 1,
        items: [{ itemCategory: 'test', quantity: 1, unitPrice: 5000 }],
        discount: 500,
        discountByName: 'Manager',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Discount reason is required when discount is applied');
      }
    });

    it('should reject discountReason longer than 300 characters', () => {
      const result = createBillSchema.safeParse({
        patientId: 1,
        items: [{ itemCategory: 'test', quantity: 1, unitPrice: 5000 }],
        discount: 500,
        discountReason: 'a'.repeat(301),
        discountByName: 'Manager',
      });
      expect(result.success).toBe(false);
    });

    it('should trim whitespace from discountReason when reference is present', () => {
      const result = createBillSchema.safeParse({
        patientId: 1,
        items: [{ itemCategory: 'test', quantity: 1, unitPrice: 5000 }],
        discount: 500,
        discountReason: '  Staff discount  ',
        discountByName: 'Manager',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.discountReason).toBe('Staff discount');
      }
    });
  });

  describe('createBillSchema - discountByName required on any discount', () => {
    it('requires discountByName when any discount is applied', () => {
      const result = createBillSchema.safeParse({
        patientId: 1,
        items: [{ itemCategory: 'test', unitPrice: 1000, quantity: 1 }],
        discount: 250,
        discountReason: 'Director approval',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.message.includes('Discount referred by name'))).toBe(true);
      }
    });

    it('requires discountByName even when discount is 20 percent or below', () => {
      const result = createBillSchema.safeParse({
        patientId: 1,
        items: [{ itemCategory: 'test', unitPrice: 1000, quantity: 1 }],
        discount: 200,
        discountReason: 'Reception approval',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) => issue.message.includes('Discount referred by name'))).toBe(true);
      }
    });
  });

  describe('editBillSchema - discountReason', () => {
    it('should accept discountReason in edit schema when reference is present', () => {
      const result = editBillSchema.safeParse({
        items: [{ itemCategory: 'test', quantity: 1, unitPrice: 5000 }],
        discount: 500,
        discountReason: 'Patient loyalty discount',
        discountByName: 'Manager',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.discountReason).toBe('Patient loyalty discount');
      }
    });

    it('should reject when discount > 0 and discountReason is missing in edit schema', () => {
      const result = editBillSchema.safeParse({
        items: [{ itemCategory: 'test', quantity: 1, unitPrice: 5000 }],
        discount: 500,
        discountByName: 'Manager',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe('Discount reason is required when discount is applied');
      }
    });
  });

  describe('Schema field definitions', () => {
    it('createBillSchema shape should include discountReason', () => {
      const shape = unwrapSchemaShape(createBillSchema);
      expect(shape.discountReason).toBeDefined();
    });

    it('createBillSchema shape should include discountByName', () => {
      const shape = unwrapSchemaShape(createBillSchema);
      expect(shape.discountByName).toBeDefined();
    });

    it('editBillSchema shape should include discountReason', () => {
      const shape = unwrapSchemaShape(editBillSchema);
      expect(shape.discountReason).toBeDefined();
    });

    it('editBillSchema shape should include discountByName', () => {
      const shape = unwrapSchemaShape(editBillSchema);
      expect(shape.discountByName).toBeDefined();
    });
  });
});
