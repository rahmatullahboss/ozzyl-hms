import { describe, it, expect } from 'vitest';
import { createBillSchema } from '../../src/schemas/billing';

describe('createBillSchema - discountByName validation', () => {
  it('should accept discountByName when discount is applied', () => {
    const result = createBillSchema.safeParse({
      patientId: 1,
      items: [{ itemCategory: 'test', quantity: 1, unitPrice: 1000 }],
      discount: 50,
      discountReason: 'Staff discount',
      discountByName: 'Dr. Ahmed',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.discountByName).toBe('Dr. Ahmed');
    }
  });

  it('should reject discountByName when discount is 0', () => {
    const result = createBillSchema.safeParse({
      patientId: 1,
      items: [{ itemCategory: 'test', quantity: 1, unitPrice: 100 }],
      discount: 0,
      discountByName: 'Dr. Ahmed',
    });
    // This should fail because discountByName without discount is meaningless
    expect(result.success).toBe(false);
  });

  it('should require discountByName for any applied discount amount', () => {
    const result = createBillSchema.safeParse({
      patientId: 1,
      items: [{ itemCategory: 'test', quantity: 1, unitPrice: 1000 }],
      discount: 10,
      discountReason: 'Staff discount',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => /discount referred by name is required/i.test(issue.message))).toBe(true);
    }
  });

  it('should accept bill without discountByName when no discount', () => {
    const result = createBillSchema.safeParse({
      patientId: 1,
      items: [{ itemCategory: 'test', quantity: 1, unitPrice: 100 }],
      discount: 0,
    });
    expect(result.success).toBe(true);
  });
});
