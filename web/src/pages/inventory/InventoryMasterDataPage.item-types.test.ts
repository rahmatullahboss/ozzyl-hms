import { describe, expect, it } from 'vitest';
import { INVENTORY_ITEM_TYPE_OPTIONS } from './InventoryMasterDataPage';

describe('InventoryMasterDataPage item types', () => {
  it('matches backend-supported inventory types and includes radiology/X-ray stock', () => {
    expect(INVENTORY_ITEM_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      'medicine',
      'consumable',
      'lab_reagent',
      'radiology_consumable',
      'ot_item',
      'ward_item',
      'general',
      'asset',
      'equipment',
    ]);
    expect(INVENTORY_ITEM_TYPE_OPTIONS).toContainEqual({
      value: 'radiology_consumable',
      label: 'Radiology / X-ray Consumable',
    });
    expect(INVENTORY_ITEM_TYPE_OPTIONS.some((option) => option.value === 'capital' || option.value === 'service')).toBe(false);
  });
});
