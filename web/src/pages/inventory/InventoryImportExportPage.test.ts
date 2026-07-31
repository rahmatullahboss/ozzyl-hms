import { describe, expect, it } from 'vitest';

describe('InventoryImportExportPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./InventoryImportExportPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('exposes opening stock import for new hospital onboarding', async () => {
    const mod = await import('./InventoryImportExportPage');
    const source = await import('./InventoryImportExportPage?raw');
    const text = String(source.default ?? '');

    expect(text).toContain('/api/inventory/import-export/import/opening-stock');
    expect(text).toContain('Lab reagent lots mirrored');
    expect(text).toContain('Opening stock columns');
    expect(text).toContain('item_code,store_code,lot_number,batch_number,expiry_date,quantity,unit_cost,supplier_code');
    expect(text).toContain('Opening ref');
    expect(text).toContain('Hospital-grade checklist warnings');
    expect(mod.sampleCsvForInventoryImportType('opening_stock')).toContain('CBC-REAGENT,LAB-STORE');
    expect(mod.inventoryImportTypeLabel('opening_stock', (key: string) => key)).toBe('Opening stock');
    expect(mod.inventoryImportTypeLabel('items', (key: string) => `translated:${key}`)).toBe('translated:inventory.importExport.items');
  });
});
