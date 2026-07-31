import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('migrations/0378_lab_inventory_bridge_links.sql', 'utf8');
const bridgeSource = readFileSync('src/lib/lab-inventory-bridge.ts', 'utf8');
const goodsReceiptSource = readFileSync('src/routes/tenant/inventory/gr.ts', 'utf8');

describe('lab inventory bridge contracts', () => {
  it('adds durable inventory source links to lab consumable tables', () => {
    expect(migration).toContain('ALTER TABLE lab_consumables ADD COLUMN inventory_item_id INTEGER');
    expect(migration).toContain('ALTER TABLE lab_consumable_stock ADD COLUMN inventory_stock_id INTEGER');
    expect(migration).toContain('ALTER TABLE lab_consumable_stock ADD COLUMN goods_receipt_item_id INTEGER');
    expect(migration).toContain('idx_lab_consumables_inventory_item');
    expect(migration).toContain('idx_lab_consumable_stock_inventory_stock');
  });

  it('mirrors only lab_reagent inventory receipts into lab stock ledger', () => {
    expect(bridgeSource).toContain("ItemType !== 'lab_reagent'");
    expect(bridgeSource).toContain('SELECT id FROM lab_consumables');
    expect(bridgeSource).toContain('inventory_item_id = ?');
    expect(bridgeSource).toContain('INSERT INTO lab_consumables');
    expect(bridgeSource).toContain('inventory_stock_id = ?');
    expect(bridgeSource).toContain('INSERT INTO lab_consumable_stock');
    expect(bridgeSource).toContain('goods_receipt_item_id');
    expect(bridgeSource).toContain("'purchase_in'");
  });

  it('wires inventory goods receipt item creation to the lab reagent bridge', () => {
    expect(goodsReceiptSource).toContain('mirrorInventoryLabReagentReceipt');
    expect(goodsReceiptSource).toContain('inventoryStockId: line.stockId');
    expect(goodsReceiptSource).toContain('goodsReceiptItemId: line.grItemId');
    expect(goodsReceiptSource).toContain('purchasePrice: line.costPrice');
  });
});
