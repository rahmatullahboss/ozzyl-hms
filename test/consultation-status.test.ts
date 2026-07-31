import { describe, it, expect } from 'vitest';
import { updateConsultationSchema, createConsultationSchema } from '../src/schemas/consultation';

// ─── Consultation Status Enhancement ─────────────────────────────────────────
// Feature: Add waiting, referred, follow_up_required statuses
// TDD RED: These tests should FAIL until we implement the changes

describe('Consultation Status Enhancement', () => {

  // ─── updateConsultationSchema: new statuses ──────────────────────────────
  describe('updateConsultationSchema accepts new statuses', () => {

    it('should accept status "waiting"', () => {
      const result = updateConsultationSchema.parse({ status: 'waiting' });
      expect(result.status).toBe('waiting');
    });

    it('should accept status "referred"', () => {
      const result = updateConsultationSchema.parse({ status: 'referred' });
      expect(result.status).toBe('referred');
    });

    it('should accept status "follow_up_required"', () => {
      const result = updateConsultationSchema.parse({ status: 'follow_up_required' });
      expect(result.status).toBe('follow_up_required');
    });

    it('should still accept existing status "scheduled"', () => {
      const result = updateConsultationSchema.parse({ status: 'scheduled' });
      expect(result.status).toBe('scheduled');
    });

    it('should still accept existing status "in_progress"', () => {
      const result = updateConsultationSchema.parse({ status: 'in_progress' });
      expect(result.status).toBe('in_progress');
    });

    it('should still accept existing status "completed"', () => {
      const result = updateConsultationSchema.parse({ status: 'completed' });
      expect(result.status).toBe('completed');
    });

    it('should still accept existing status "cancelled"', () => {
      const result = updateConsultationSchema.parse({ status: 'cancelled' });
      expect(result.status).toBe('cancelled');
    });

    it('should still accept existing status "no_show"', () => {
      const result = updateConsultationSchema.parse({ status: 'no_show' });
      expect(result.status).toBe('no_show');
    });

    it('should reject unknown status "invalid_status"', () => {
      expect(() => updateConsultationSchema.parse({ status: 'invalid_status' })).toThrow();
    });
  });

  // ─── createConsultationSchema: followupDate ──────────────────────────────
  describe('createConsultationSchema accepts followupDate', () => {

    it('should accept followupDate at creation time', () => {
      const result = createConsultationSchema.parse({
        doctorId: 1,
        patientId: 1,
        scheduledAt: '2026-05-21T10:00:00',
        followupDate: '2026-05-28',
      });
      expect(result.followupDate).toBe('2026-05-28');
    });

    it('should work without followupDate (optional)', () => {
      const result = createConsultationSchema.parse({
        doctorId: 1,
        patientId: 1,
        scheduledAt: '2026-05-21T10:00:00',
      });
      expect(result.followupDate).toBeUndefined();
    });
  });
});
