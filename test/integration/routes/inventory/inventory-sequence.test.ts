/**
 * Enterprise-grade unit tests for the sequence.ts utility.
 *
 * Covers: whitelist enforcement (SQL injection prevention), counter logic,
 * and correct sequence number formatting.
 *
 * Actual export: `generateSequenceNo(db, prefix, tableName, columnName, tenantId?)`
 * Whitelist: InventoryPurchaseOrder → PONumber, InventoryGoodsReceipt → GoodsReceiptNo, etc.
 */

import { describe, it, expect } from 'vitest';
import { generateSequenceNo } from '../../../../src/utils/sequence';
import { createMockDB } from '../../helpers/mock-db';
import { TENANT_1, TENANT_2 } from '../../helpers/fixtures';

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Create a mock DB for sequence tests.
 *
 * IMPORTANT: mock-db normalizes SQL column names to lowercase when filtering.
 * Keys in fixture rows MUST also be lowercase for conditions to match.
 */
function makeDB(lastCode?: string, tableName = 'InventoryPurchaseOrder', columnName = 'PONumber') {
  // Lowercase keys so mock-db filterRows can match them
  const lowerCol = columnName.toLowerCase();
  return createMockDB({
    tables: {
      // mock-db extracts table name as lowercase
      [tableName.toLowerCase()]: lastCode !== undefined
        ? [{ tenant_id: TENANT_1.id, [lowerCol]: lastCode }]
        : [],
    },
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Inventory — Sequence Utility (utils/sequence.ts)', () => {

  describe('generateSequenceNo — whitelist enforcement', () => {
    it('succeeds for InventoryPurchaseOrder / PONumber pair', async () => {
      const { db } = makeDB(undefined);
      const seq = await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber', TENANT_1.id);
      expect(seq).toMatch(/^PO-\d{4}-\d{5}$/);
    });

    it('succeeds for InventoryGoodsReceipt / GoodsReceiptNo pair', async () => {
      const { db } = makeDB(undefined, 'InventoryGoodsReceipt', 'GoodsReceiptNo');
      const seq = await generateSequenceNo(db, 'GR', 'InventoryGoodsReceipt', 'GoodsReceiptNo', TENANT_1.id);
      expect(seq).toMatch(/^GR-\d{4}-\d{5}$/);
    });

    it('succeeds for InventoryRequisition / RequisitionNo pair', async () => {
      const { db } = makeDB(undefined, 'InventoryRequisition', 'RequisitionNo');
      const seq = await generateSequenceNo(db, 'REQ', 'InventoryRequisition', 'RequisitionNo', TENANT_1.id);
      expect(seq).toMatch(/^REQ-\d{4}-\d{5}$/);
    });

    it('throws for a non-whitelisted table name (SQL injection guard)', async () => {
      const { db } = makeDB();
      await expect(
        generateSequenceNo(db, 'XX', 'users; DROP TABLE users; --', 'col', TENANT_1.id),
      ).rejects.toThrow('Not whitelisted');
    });

    it('throws for a valid table but wrong column name (whitelist mismatch)', async () => {
      const { db } = makeDB();
      await expect(
        generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'WrongColumn', TENANT_1.id),
      ).rejects.toThrow('Not whitelisted');
    });

    it('throws for an entirely unknown table+column pair', async () => {
      const { db } = makeDB();
      await expect(
        generateSequenceNo(db, 'FK', 'InventoryFakeModule', 'FakeNo', TENANT_1.id),
      ).rejects.toThrow('Not whitelisted');
    });
  });

  describe('generateSequenceNo — counter and format logic', () => {
    it('starts from 1 when there are no existing records', async () => {
      const { db } = makeDB(); // no rows
      const year = new Date().getFullYear();
      const seq = await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber', TENANT_1.id);
      expect(seq).toBe(`PO-${year}-00001`);
    });

    it('increments from existing last sequence number', async () => {
      // queryOverride bypasses mock-db's LIKE filtering to return a known last row
      const year = new Date().getFullYear();
      const { db } = createMockDB({
        queryOverride: (sql) => {
          if (sql.toUpperCase().includes('SELECT') && sql.toUpperCase().includes('PURCHASEORDER')) {
            return { results: [{ ponumber: `PO-${year}-00007` }] };
          }
          return null;
        },
      });
      const seq = await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber', TENANT_1.id);
      expect(seq).toBe(`PO-${year}-00008`);
    });

    it('produces the correct prefix in the output string', async () => {
      const { db } = makeDB(undefined, 'InventoryDispatch', 'DispatchNo');
      const seq = await generateSequenceNo(db, 'DSP', 'InventoryDispatch', 'DispatchNo', TENANT_1.id);
      expect(seq.startsWith('DSP-')).toBe(true);
    });

    it('zero-pads sequence number to 5 digits', async () => {
      const year = new Date().getFullYear();
      const { db } = makeDB(); // starts at 1
      const seq = await generateSequenceNo(db, 'GR', 'InventoryGoodsReceipt', 'GoodsReceiptNo', TENANT_1.id);
      expect(seq).toBe(`GR-${year}-00001`);
    });
  });

  describe('generateSequenceNo — tenant isolation', () => {
    it('uses tenant_id in the lookup query (scoped to tenant)', async () => {
      const { db, queries } = makeDB();
      await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber', TENANT_1.id);
      const selectQ = queries.find(q => q.sql.toUpperCase().startsWith('SELECT'));
      expect(selectQ).toBeTruthy();
      expect(selectQ!.params).toContain(TENANT_1.id);
    });

    it('works without tenantId param (no tenant scoping)', async () => {
      const { db } = makeDB();
      const seq = await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber');
      expect(seq).toMatch(/^PO-\d{4}-\d{5}$/);
    });

    it('generates independently for Tenant 1 vs Tenant 2 (via queryOverride)', async () => {
      // Use queryOverride to simulate tenant-specific last sequences
      const year = new Date().getFullYear();

      const { db: db1 } = createMockDB({
        queryOverride: (sql) => {
          if (sql.toUpperCase().includes('SELECT') && sql.toUpperCase().includes('PURCHASEORDER')) {
            return { results: [{ ponumber: `PO-${year}-00010` }] };
          }
          return null;
        },
      });
      const seq1 = await generateSequenceNo(db1, 'PO', 'InventoryPurchaseOrder', 'PONumber', TENANT_1.id);

      const { db: db2 } = createMockDB({}); // no rows — starts at 1
      const seq2 = await generateSequenceNo(db2, 'PO', 'InventoryPurchaseOrder', 'PONumber', TENANT_2.id);

      expect(seq1).toBe(`PO-${year}-00011`);
      expect(seq2).toBe(`PO-${year}-00001`);
    });
  });
});
