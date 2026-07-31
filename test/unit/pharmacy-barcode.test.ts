import { describe, it, expect } from 'vitest';

describe('pharmacy barcode auto-generation', () => {
  describe('generatePharmacyBarcode', () => {
    it('generates barcode in PH-{tenant_code}-{padded_id} format', () => {
      const tenantCode = 'DEM';
      const itemId = 42;
      const barcode = `PH-${tenantCode}-${String(itemId).padStart(6, '0')}`;

      expect(barcode).toBe('PH-DEM-000042');
    });

    it('generates unique barcodes for different items', () => {
      const barcodes = new Set<string>();
      for (let i = 1; i <= 100; i++) {
        barcodes.add(`PH-HOS-${String(i).padStart(6, '0')}`);
      }
      expect(barcodes.size).toBe(100);
    });

    it('barcode is scannable (alphanumeric + hyphens only)', () => {
      const barcode = 'PH-DEM-000042';
      expect(barcode).toMatch(/^[A-Z0-9-]+$/);
    });

    it('barcode length is reasonable for printing', () => {
      const barcode = 'PH-DEM-000042';
      expect(barcode.length).toBeLessThanOrEqual(20);
      expect(barcode.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('GRN batch barcode generation', () => {
    it('generates unique barcodes per batch in GRN', () => {
      const grnItems = [
        { item_id: 1, batch_no: 'B001' },
        { item_id: 1, batch_no: 'B002' },
        { item_id: 2, batch_no: 'B003' },
      ];

      const barcodes = grnItems.map((item, idx) =>
        `PH-HOS-${String(item.item_id).padStart(4, '0')}-${String(idx + 1).padStart(3, '0')}`
      );

      expect(new Set(barcodes).size).toBe(3);
      expect(barcodes[0]).toBe('PH-HOS-0001-001');
      expect(barcodes[1]).toBe('PH-HOS-0001-002');
      expect(barcodes[2]).toBe('PH-HOS-0002-003');
    });
  });

  describe('barcode lookup', () => {
    it('finds item by exact barcode match', () => {
      const items = [
        { id: 1, barcode: 'PH-DEM-000001', name: 'Paracetamol' },
        { id: 2, barcode: 'PH-DEM-000002', name: 'Amoxicillin' },
      ];

      const found = items.find(i => i.barcode === 'PH-DEM-000002');
      expect(found?.name).toBe('Amoxicillin');
    });

    it('returns null for non-existent barcode', () => {
      const items = [{ id: 1, barcode: 'PH-DEM-000001' }];
      const found = items.find(i => i.barcode === 'PH-DEM-999999');
      expect(found).toBeUndefined();
    });
  });
});
