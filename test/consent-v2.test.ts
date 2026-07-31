import { describe, expect, it } from 'vitest';
import {
  globalBlockListSchema,
  globalEmergencyAccessSchema,
  globalConsentSchema,
  globalShareTokenSchema,
} from '../src/schemas/globalHealth';
import {
  createConsentSchema,
  emergencyAccessSchema,
  nationalIdSchema,
  revokeConsentSchema,
} from '../src/schemas/healthRecord';

/**
 * Consent Model V2 Tests
 * Validates Break-Glass emergency access schemas, Block-List schemas,
 * and consent rules at the schema layer — no Cloudflare runtime needed.
 */
describe('Consent Model V2 (Privacy & Security)', () => {

  // ─── Block-List Schema Validation ────────────────────────────────────
  describe('Block-List schema', () => {
    it('accepts a valid block-list entry with blocked_tenant_id', () => {
      const result = globalBlockListSchema.safeParse({
        blocked_tenant_id: 10,
        reason: 'Privacy concerns',
      });
      expect(result.success).toBe(true);
    });

    it('accepts a valid block-list entry with blocked_doctor_id', () => {
      const result = globalBlockListSchema.safeParse({
        blocked_doctor_id: 42,
        reason: 'Personal preference',
      });
      expect(result.success).toBe(true);
    });

    it('rejects block-list entry with neither tenant nor doctor', () => {
      const result = globalBlockListSchema.safeParse({
        reason: 'No target specified',
      });
      expect(result.success).toBe(false);
    });

    it('rejects block-list entry with non-positive tenant id', () => {
      const result = globalBlockListSchema.safeParse({
        blocked_tenant_id: 0,
      });
      expect(result.success).toBe(false);
    });

    it('accepts block-list entry without reason (optional)', () => {
      const result = globalBlockListSchema.safeParse({
        blocked_tenant_id: 5,
      });
      expect(result.success).toBe(true);
    });
  });

  // ─── Emergency Access (Break-Glass) Schema Validation ────────────────
  describe('Emergency Access (Break-Glass) schema', () => {
    it('accepts valid emergency access with ETREAT reason', () => {
      const result = globalEmergencyAccessSchema.safeParse({
        patient_id: 50,
        emergency_reason_code: 'ETREAT',
        emergency_reason_details: 'Unconscious after accident',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid emergency access with EMERGENCY reason', () => {
      const result = globalEmergencyAccessSchema.safeParse({
        patient_id: 1,
        emergency_reason_code: 'EMERGENCY',
        emergency_reason_details: 'Chest pain with unstable vitals',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid emergency access with LEGAL reason', () => {
      const result = globalEmergencyAccessSchema.safeParse({
        patient_id: 99,
        emergency_reason_code: 'LEGAL',
        emergency_reason_details: 'Court order #12345',
      });
      expect(result.success).toBe(true);
    });

    it('rejects emergency access without patient_id', () => {
      const result = globalEmergencyAccessSchema.safeParse({
        emergency_reason_code: 'ETREAT',
      });
      expect(result.success).toBe(false);
    });

    it('rejects emergency access with invalid reason code', () => {
      const result = globalEmergencyAccessSchema.safeParse({
        patient_id: 50,
        emergency_reason_code: 'INVALID_CODE',
        emergency_reason_details: 'Invalid emergency code',
      });
      expect(result.success).toBe(false);
    });

    it('rejects emergency access with non-positive patient_id', () => {
      const result = globalEmergencyAccessSchema.safeParse({
        patient_id: 0,
        emergency_reason_code: 'EMERGENCY',
        emergency_reason_details: 'Chest pain with unstable vitals',
      });
      expect(result.success).toBe(false);
    });

    it('rejects emergency access without written reason details', () => {
      const result = globalEmergencyAccessSchema.safeParse({
        patient_id: 1,
        emergency_reason_code: 'EMERGENCY',
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Health Record Emergency Access Schema ───────────────────────────
  describe('Health Record emergency access schema', () => {
    it('accepts valid 10-digit NID with justification', () => {
      const result = emergencyAccessSchema.safeParse({
        national_id: '1234567890',
        justification: 'Patient unconscious, immediate treatment required',
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid 17-digit smart card NID', () => {
      const result = emergencyAccessSchema.safeParse({
        national_id: '12345678904256780',
        justification: 'Emergency surgery needed immediately',
      });
      expect(result.success).toBe(true);
    });

    it('rejects NID with wrong length', () => {
      const result = emergencyAccessSchema.safeParse({
        national_id: '12345',
        justification: 'Emergency treatment needed for the patient',
      });
      expect(result.success).toBe(false);
    });

    it('rejects justification shorter than 10 characters', () => {
      const result = emergencyAccessSchema.safeParse({
        national_id: '1234567890',
        justification: 'Short',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing justification', () => {
      const result = emergencyAccessSchema.safeParse({
        national_id: '1234567890',
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Global Consent Schema ───────────────────────────────────────────
  describe('Global consent schema', () => {
    it('accepts consent with view_summary type', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'view_summary',
        purpose: 'TREATMENT',
      });
      expect(result.success).toBe(true);
    });

    it('accepts emergency_access consent type', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'emergency_access',
        granted_to_tenant_id: 10,
        duration_hours: 4,
        purpose: 'TREATMENT',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid consent_type', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'full_control',
        purpose: 'TREATMENT',
      });
      expect(result.success).toBe(false);
    });

    it('defaults duration_hours to 720 (30 days)', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'view_full',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.duration_hours).toBe(720);
      }
    });

    it('defaults purpose to TREATMENT', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'view_summary',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.purpose).toBe('TREATMENT');
      }
    });

    it('accepts clinical_areas filter', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'view_full',
        clinical_areas: ['labs', 'prescriptions', 'vitals'],
        purpose: 'TREATMENT',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid clinical area', () => {
      const result = globalConsentSchema.safeParse({
        consent_type: 'view_full',
        clinical_areas: ['labs', 'invalid_area'],
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── NID Validation ──────────────────────────────────────────────────
  describe('National ID validation', () => {
    it('accepts 10-digit old NID', () => {
      expect(nationalIdSchema.safeParse('1234567890').success).toBe(true);
    });

    it('accepts 17-digit smart card NID', () => {
      expect(nationalIdSchema.safeParse('12345678904256780').success).toBe(true);
    });

    it('rejects 5-digit NID', () => {
      expect(nationalIdSchema.safeParse('12345').success).toBe(false);
    });

    it('rejects 15-digit NID (between valid lengths)', () => {
      expect(nationalIdSchema.safeParse('123456789012345').success).toBe(false);
    });

    it('rejects NID with letters', () => {
      expect(nationalIdSchema.safeParse('12345ABCDE').success).toBe(false);
    });
  });

  // ─── Revoke Consent Schema ───────────────────────────────────────────
  describe('Revoke consent schema', () => {
    it('accepts revocation with reason', () => {
      const result = revokeConsentSchema.safeParse({
        reason: 'No longer want this hospital to access my records',
      });
      expect(result.success).toBe(true);
    });

    it('accepts revocation without reason (optional)', () => {
      const result = revokeConsentSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('rejects reason longer than 500 characters', () => {
      const result = revokeConsentSchema.safeParse({
        reason: 'x'.repeat(501),
      });
      expect(result.success).toBe(false);
    });
  });

  // ─── Share Token Schema ──────────────────────────────────────────────
  describe('Share token schema', () => {
    it('defaults scope to summary and duration to 24h', () => {
      const result = globalShareTokenSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scope).toBe('summary');
        expect(result.data.duration_hours).toBe(24);
      }
    });

    it('accepts full scope with custom duration', () => {
      const result = globalShareTokenSchema.safeParse({
        scope: 'full',
        duration_hours: 48,
      });
      expect(result.success).toBe(true);
    });

    it('rejects duration exceeding 720 hours', () => {
      const result = globalShareTokenSchema.safeParse({
        duration_hours: 721,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid scope', () => {
      const result = globalShareTokenSchema.safeParse({
        scope: 'admin',
      });
      expect(result.success).toBe(false);
    });
  });
});
