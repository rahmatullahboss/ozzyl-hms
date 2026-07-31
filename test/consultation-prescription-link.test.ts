import { describe, it, expect } from 'vitest';
import { updateConsultationSchema } from '../src/schemas/consultation';

// ─── Consultation → Prescription Link ────────────────────────────────────────
// Feature: Add prescription_id to consultations table
// TDD RED: These tests should FAIL until we implement the changes

describe('Consultation → Prescription Link', () => {

  describe('updateConsultationSchema accepts prescriptionId', () => {

    it('should accept prescriptionId when updating consultation', () => {
      const result = updateConsultationSchema.parse({ prescriptionId: 42 });
      expect(result.prescriptionId).toBe(42);
    });

    it('should accept prescriptionId alongside status update', () => {
      const result = updateConsultationSchema.parse({
        status: 'completed',
        prescriptionId: 15,
      });
      expect(result.status).toBe('completed');
      expect(result.prescriptionId).toBe(15);
    });

    it('should work without prescriptionId (optional)', () => {
      const result = updateConsultationSchema.parse({ notes: 'some notes' });
      expect(result.prescriptionId).toBeUndefined();
    });

    it('should reject negative prescriptionId', () => {
      expect(() => updateConsultationSchema.parse({ prescriptionId: -1 })).toThrow();
    });

    it('should reject zero prescriptionId', () => {
      expect(() => updateConsultationSchema.parse({ prescriptionId: 0 })).toThrow();
    });
  });
});
