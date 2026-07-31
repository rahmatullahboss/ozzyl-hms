import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'inventory.writeOff.reasons.expired': 'Expired',
        'inventory.writeOff.reasons.damaged': 'Damaged',
        'inventory.writeOff.reasons.theft': 'Theft',
        'inventory.writeOff.reasons.other': 'Other',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

import { REASON_OPTIONS } from './InventoryWriteOffPage';
import { useTranslation } from 'react-i18next';

describe('InventoryWriteOffPage helpers', () => {
  const { t } = useTranslation();
  const labels = REASON_OPTIONS.map(o => t(o.labelKey));

  describe('REASON_OPTIONS', () => {
    it('contains expired reason', () => {
      const expired = REASON_OPTIONS.find(r => r.value === 'expired');
      expect(expired).toBeDefined();
      expect(t(expired!.labelKey)).toBe('Expired');
    });

    it('contains damaged reason', () => {
      const damaged = REASON_OPTIONS.find(r => r.value === 'damaged');
      expect(damaged).toBeDefined();
      expect(t(damaged!.labelKey)).toBe('Damaged');
    });

    it('contains theft reason', () => {
      const theft = REASON_OPTIONS.find(r => r.value === 'theft');
      expect(theft).toBeDefined();
      expect(t(theft!.labelKey)).toBe('Theft');
    });

    it('contains other reason', () => {
      const other = REASON_OPTIONS.find(r => r.value === 'other');
      expect(other).toBeDefined();
      expect(t(other!.labelKey)).toBe('Other');
    });

    it('has 4 options', () => {
      expect(REASON_OPTIONS).toHaveLength(4);
    });

    it('each option has value and labelKey', () => {
      for (const option of REASON_OPTIONS) {
        expect(option).toHaveProperty('value');
        expect(option).toHaveProperty('labelKey');
        expect(typeof option.value).toBe('string');
        expect(typeof option.labelKey).toBe('string');
      }
    });
  });
});
