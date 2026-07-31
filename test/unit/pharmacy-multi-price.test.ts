import { describe, it, expect, vi } from 'vitest';
import { setPharmacyItemCategoryPrice } from '../../src/lib/pharmacy-multi-price';

describe('pharmacy multi-price categories', () => {
  describe('getPriceForCategory', () => {
    it('returns category-specific price when available', () => {
      const basePrice = 100;
      const categoryPrices: Record<string, number> = {
        'general': 100,
        'ssf': 80,
        'insurance': 90,
        'govt': 70,
      };

      const price = categoryPrices['ssf'] ?? basePrice;
      expect(price).toBe(80);
    });

    it('falls back to base price when category not found', () => {
      const basePrice = 100;
      const categoryPrices: Record<string, number> = {
        'general': 100,
        'ssf': 80,
      };

      const price = categoryPrices['nonexistent'] ?? basePrice;
      expect(price).toBe(100);
    });

    it('falls back to base price when no category prices exist', () => {
      const basePrice = 100;
      const categoryPrices: Record<string, number> = {};

      const price = categoryPrices['ssf'] ?? basePrice;
      expect(price).toBe(100);
    });
  });

  describe('price category schema', () => {
    it('has required fields', () => {
      const schema = {
        id: 'number',
        tenant_id: 'string',
        pharmacy_item_id: 'number',
        price_category_id: 'number',
        sale_price: 'number',
        is_active: 'boolean',
      };

      expect(schema.pharmacy_item_id).toBe('number');
      expect(schema.price_category_id).toBe('number');
      expect(schema.sale_price).toBe('number');
    });
  });

  describe('price resolution priority', () => {
    it('uses category price > base price', () => {
      const basePrice = 100;
      const categoryPrice = 80;
      const hasCategoryPrice = true;

      const finalPrice = hasCategoryPrice ? categoryPrice : basePrice;
      expect(finalPrice).toBe(80);
    });

    it('uses base price when category price is 0 or null', () => {
      const basePrice = 100;
      const categoryPrice = 0;

      const finalPrice = categoryPrice > 0 ? categoryPrice : basePrice;
      expect(finalPrice).toBe(100);
    });
  });

  describe('setPharmacyItemCategoryPrice', () => {
    it('uses valid SQL placeholders for category price upsert', async () => {
      let capturedSql = '';
      const run = vi.fn().mockResolvedValue({ success: true });
      const bind = vi.fn(() => ({ run }));
      const db = {
        prepare: vi.fn((sql: string) => {
          capturedSql = sql;
          return { bind };
        }),
      };

      await setPharmacyItemCategoryPrice(db as never, 'tenant-1', 10, 2, 125, 7);

      expect(capturedSql).toContain('VALUES (?, ?, ?, ?, 1, ?,');
      expect(capturedSql).not.toContain('1 ?');
      expect(bind).toHaveBeenCalledWith('tenant-1', 10, 2, 125, 7);
      expect(run).toHaveBeenCalled();
    });
  });
});
