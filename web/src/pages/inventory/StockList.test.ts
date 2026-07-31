import { describe, expect, it } from 'vitest';
import { statusLabel, escapeHtml, buildPath, Filters } from './StockList';

describe('StockList helpers', () => {
  describe('statusLabel', () => {
    it('replaces underscores with spaces', () => {
      expect(statusLabel('low_stock')).toBe('low stock');
    });

    it('handles single word', () => {
      expect(statusLabel('available')).toBe('available');
    });

    it('handles multiple underscores', () => {
      expect(statusLabel('expiring_soon')).toBe('expiring soon');
    });
  });

  describe('escapeHtml', () => {
    it('escapes ampersand', () => {
      expect(escapeHtml('a&b')).toBe('a&amp;b');
    });

    it('escapes less-than', () => {
      expect(escapeHtml('a<b')).toBe('a&lt;b');
    });

    it('escapes greater-than', () => {
      expect(escapeHtml('a>b')).toBe('a&gt;b');
    });

    it('escapes double quotes', () => {
      expect(escapeHtml('a"b')).toBe('a&quot;b');
    });

    it('escapes single quotes', () => {
      expect(escapeHtml("a'b")).toBe('a&#039;b');
    });

    it('converts null to empty string', () => {
      expect(escapeHtml(null)).toBe('');
    });

    it('converts undefined to empty string', () => {
      expect(escapeHtml(undefined)).toBe('');
    });

    it('converts number to string', () => {
      expect(escapeHtml(42)).toBe('42');
    });
  });

  describe('buildPath', () => {
    const baseFilters: Filters = {
      search: '',
      ItemType: '',
      StoreId: '',
      ExpiryTo: '',
      LowStock: false,
      OutOfStock: false,
    };

    it('builds path with page and limit', () => {
      const result = buildPath(1, 25, baseFilters);
      expect(result).toContain('page=1');
      expect(result).toContain('limit=25');
      expect(result).toContain('/api/inventory/stock/overview?');
    });

    it('includes search param when set', () => {
      const result = buildPath(1, 25, { ...baseFilters, search: 'paracetamol' });
      expect(result).toContain('search=paracetamol');
    });

    it('includes ItemType param when set', () => {
      const result = buildPath(1, 25, { ...baseFilters, ItemType: 'medicine' });
      expect(result).toContain('ItemType=medicine');
    });

    it('includes StoreId param when set', () => {
      const result = buildPath(1, 25, { ...baseFilters, StoreId: '5' });
      expect(result).toContain('StoreId=5');
    });

    it('includes ExpiryTo param when set', () => {
      const result = buildPath(1, 25, { ...baseFilters, ExpiryTo: '2026-12-31' });
      expect(result).toContain('ExpiryTo=2026-12-31');
    });

    it('includes LowStock=true when enabled', () => {
      const result = buildPath(1, 25, { ...baseFilters, LowStock: true });
      expect(result).toContain('LowStock=true');
    });

    it('includes OutOfStock=true when enabled', () => {
      const result = buildPath(1, 25, { ...baseFilters, OutOfStock: true });
      expect(result).toContain('OutOfStock=true');
    });

    it('omits false boolean filters', () => {
      const result = buildPath(1, 25, baseFilters);
      expect(result).not.toContain('LowStock');
      expect(result).not.toContain('OutOfStock');
    });
  });
});
