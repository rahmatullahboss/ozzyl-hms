import { describe, expect, it } from 'vitest';
import { REASONS } from './InventoryReturnPage';

describe('InventoryReturnPage helpers', () => {
  describe('REASONS', () => {
    it('contains expected return reasons', () => {
      expect(REASONS).toContain('unused');
      expect(REASONS).toContain('damaged');
      expect(REASONS).toContain('expired');
    });

    it('contains patient-specific reasons', () => {
      expect(REASONS).toContain('patient_refused');
      expect(REASONS).toContain('over_issued');
    });

    it('has 7 items', () => {
      expect(REASONS).toHaveLength(7);
    });

    it('starts with unused', () => {
      expect(REASONS[0]).toBe('unused');
    });

    it('ends with other', () => {
      expect(REASONS[REASONS.length - 1]).toBe('other');
    });
  });
});
