import { describe, expect, it } from 'vitest';
import { cellValue } from './InventoryReportsPage';

describe('InventoryReportsPage helpers', () => {
  describe('cellValue', () => {
    it('returns dash for null', () => {
      expect(cellValue(null)).toBe('—');
    });

    it('returns dash for undefined', () => {
      expect(cellValue(undefined)).toBe('—');
    });

    it('returns integer as string without decimals', () => {
      expect(cellValue(42)).toBe('42');
    });

    it('formats decimal number to 2 places', () => {
      expect(cellValue(3.14159)).toBe('3.14');
    });

    it('formats whole number float without trailing zeros', () => {
      expect(cellValue(10.0)).toBe('10');
    });

    it('stringifies objects', () => {
      expect(cellValue({ foo: 'bar' })).toBe('{"foo":"bar"}');
    });

    it('stringifies arrays', () => {
      expect(cellValue([1, 2, 3])).toBe('[1,2,3]');
    });

    it('returns string values as-is', () => {
      expect(cellValue('hello')).toBe('hello');
    });

    it('converts boolean to string', () => {
      expect(cellValue(true)).toBe('true');
      expect(cellValue(false)).toBe('false');
    });

    it('returns zero as string', () => {
      expect(cellValue(0)).toBe('0');
    });
  });
});
