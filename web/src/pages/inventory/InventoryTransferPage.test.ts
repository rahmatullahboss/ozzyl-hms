import { describe, expect, it } from 'vitest';
import InventoryTransferPage from './InventoryTransferPage';

describe('InventoryTransferPage', () => {
  it('exports a default component', () => {
    expect(InventoryTransferPage).toBeDefined();
    expect(typeof InventoryTransferPage).toBe('function');
  });
});
