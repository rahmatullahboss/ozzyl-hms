import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/lab-consumables.ts', 'utf8');

describe('inventory-backed lab consumable stock policy', () => {
  it('uses usable rather than gross available quantity for reagent prechecks', () => {
    expect(source).toContain('AvailableQuantity - COALESCE(ReservedQuantity, 0) - COALESCE(DamagedQuantity, 0) - COALESCE(BlockedQuantity, 0)');
    expect(source).toContain('AND AvailableQuantity - COALESCE(ReservedQuantity, 0) - COALESCE(DamagedQuantity, 0) - COALESCE(BlockedQuantity, 0) > 0');
  });
});
