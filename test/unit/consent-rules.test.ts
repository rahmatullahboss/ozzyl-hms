/**
 * Unit tests for consent-rules.ts — TPO rule engine
 */
import { describe, it, expect } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  SYSTEM_DEFAULTS,
  getDefaultAccessForPurpose,
  type ConsentPurpose,
} from '../../src/lib/consent-rules';

describe('consent-rules', () => {
  describe('SYSTEM_DEFAULTS', () => {
    it('has entries for all five purposes', () => {
      const keys = Object.keys(SYSTEM_DEFAULTS) as ConsentPurpose[];
      expect(keys).toEqual(
        expect.arrayContaining(['TREATMENT', 'PAYMENT', 'OPERATIONS', 'RESEARCH', 'MARKETING']),
      );
      expect(keys.length).toBe(5);
    });

    it('TREATMENT defaults to auto-grant with view_summary scope', () => {
      const d = SYSTEM_DEFAULTS.TREATMENT;
      expect(d.auto_grant).toBe(true);
      expect(d.default_scope).toBe('view_summary');
      expect(d.default_clinical_areas).toBeNull();
      expect(d.requires_explicit_consent).toBe(false);
    });

    it('PAYMENT defaults to auto-grant with limited areas', () => {
      const d = SYSTEM_DEFAULTS.PAYMENT;
      expect(d.auto_grant).toBe(true);
      expect(d.default_scope).toBe('view_summary');
      expect(d.default_clinical_areas).toEqual(['diagnoses', 'visits']);
    });

    it('RESEARCH and MARKETING require explicit consent', () => {
      expect(SYSTEM_DEFAULTS.RESEARCH.auto_grant).toBe(false);
      expect(SYSTEM_DEFAULTS.MARKETING.auto_grant).toBe(false);
      expect(SYSTEM_DEFAULTS.RESEARCH.default_scope).toBe('none');
      expect(SYSTEM_DEFAULTS.MARKETING.default_scope).toBe('none');
      expect(SYSTEM_DEFAULTS.RESEARCH.requires_explicit_consent).toBe(true);
      expect(SYSTEM_DEFAULTS.MARKETING.requires_explicit_consent).toBe(true);
    });

    it('OPERATIONS is not auto-granted', () => {
      expect(SYSTEM_DEFAULTS.OPERATIONS.auto_grant).toBe(false);
      expect(SYSTEM_DEFAULTS.OPERATIONS.requires_explicit_consent).toBe(true);
    });
  });

  describe('getDefaultAccessForPurpose', () => {
    it('returns TREATMENT defaults when no DB is provided', async () => {
      const result = await getDefaultAccessForPurpose('TREATMENT');
      expect(result.default_scope).toBe('view_summary');
      expect(result.auto_grant).toBe(true);
      expect(result.default_clinical_areas).toBeNull();
    });

    it('returns PAYMENT defaults when no DB is provided', async () => {
      const result = await getDefaultAccessForPurpose('PAYMENT');
      expect(result.default_scope).toBe('view_summary');
      expect(result.auto_grant).toBe(true);
      expect(result.default_clinical_areas).toEqual(['diagnoses', 'visits']);
    });

    it('returns RESEARCH defaults (no auto-grant)', async () => {
      const result = await getDefaultAccessForPurpose('RESEARCH');
      expect(result.default_scope).toBe('none');
      expect(result.auto_grant).toBe(false);
    });

    it('falls back to TREATMENT for unknown purpose', async () => {
      const result = await getDefaultAccessForPurpose('UNKNOWN_PURPOSE' as ConsentPurpose);
      expect(result.default_scope).toBe('view_summary');
      expect(result.auto_grant).toBe(true);
    });

    it('uses DB override when provided and found', async () => {
      const mockDb = {
        prepare: () => ({
          bind: () => ({
            first: async () => ({
              default_scope: 'view_full',
              auto_grant: 1,
              default_clinical_areas: JSON.stringify(['labs', 'vitals']),
              requires_explicit_consent: 0,
            }),
          }),
        }),
      } as unknown as D1Database;

      const result = await getDefaultAccessForPurpose('RESEARCH', mockDb, 'tenant-1');
      expect(result.default_scope).toBe('view_full');
      expect(result.auto_grant).toBe(true);
      expect(result.default_clinical_areas).toEqual(['labs', 'vitals']);
    });

    it('falls back to defaults when DB returns null', async () => {
      const mockDb = {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
          }),
        }),
      } as unknown as D1Database;

      const result = await getDefaultAccessForPurpose('PAYMENT', mockDb, 'tenant-1');
      expect(result.default_scope).toBe('view_summary');
      expect(result.auto_grant).toBe(true);
    });

    it('falls back to defaults when DB throws', async () => {
      const mockDb = {
        prepare: () => ({
          bind: () => ({
            first: async () => { throw new Error('DB down'); },
          }),
        }),
      } as unknown as D1Database;

      const result = await getDefaultAccessForPurpose('TREATMENT', mockDb, 'tenant-1');
      expect(result.default_scope).toBe('view_summary');
      expect(result.auto_grant).toBe(true);
    });
  });
});
