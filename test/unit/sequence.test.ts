/**
 * Unit tests for generateSequenceNo utility.
 *
 * Tests pure sequence number generation logic:
 * - Format output: PREFIX-YEAR-NNNNN
 * - Increments from last existing number in DB
 * - Starts at 00001 when no existing records
 * - Case-insensitive column name handling (D1 vs mock-db)
 * - Whitelist enforcement prevents SQL injection
 * - Tenant scoping
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSequenceNo } from '../../src/utils/sequence';

// ─── Minimal D1 stub factory ─────────────────────────────────────────────────

/** Creates a minimal D1Database stub for testing generateSequenceNo. */
function makeD1Stub(firstResult: Record<string, unknown> | null): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (..._params: unknown[]) => ({
        first: async <T>() => firstResult as T | null,
        all: async <T>() => ({ results: firstResult ? [firstResult] as T[] : [] as T[], success: true, meta: {} }),
        run: async () => ({ success: true, meta: { last_row_id: 1, changes: 1, duration: 0 } }),
      }),
    }),
    batch: async () => [],
    dump: () => Promise.resolve(new ArrayBuffer(0)),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  } as unknown as D1Database;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const YEAR = new Date().getFullYear();

describe('generateSequenceNo', () => {

  describe('output format', () => {
    it('produces PREFIX-YEAR-NNNNN format when no prior records exist', async () => {
      const db = makeD1Stub(null); // no existing records
      const result = await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber');
      expect(result).toBe(`PO-${YEAR}-00001`);
    });

    it('zero-pads sequence number to 5 digits', async () => {
      const db = makeD1Stub(null);
      const result = await generateSequenceNo(db, 'GRN', 'InventoryGoodsReceipt', 'GoodsReceiptNo');
      expect(result).toMatch(/^GRN-\d{4}-\d{5}$/);
    });
  });

  describe('increment logic', () => {
    it('increments from last sequence number (PascalCase column — D1 native)', async () => {
      // D1 returns column in original PascalCase
      const db = makeD1Stub({ PONumber: `PO-${YEAR}-00042` });
      const result = await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber');
      expect(result).toBe(`PO-${YEAR}-00043`);
    });

    it('increments from last sequence number (lowercase column — mock-db)', async () => {
      // mock-db normalizes column names to lowercase
      const db = makeD1Stub({ ponumber: `PO-${YEAR}-00010` });
      const result = await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber');
      expect(result).toBe(`PO-${YEAR}-00011`);
    });

    it('returns 00001 when prior result has null column value', async () => {
      const db = makeD1Stub({ PONumber: null });
      const result = await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber');
      expect(result).toBe(`PO-${YEAR}-00001`);
    });

    it('increments from a high sequence number correctly', async () => {
      const db = makeD1Stub({ GoodsReceiptNo: `GRN-${YEAR}-00999` });
      const result = await generateSequenceNo(db, 'GRN', 'InventoryGoodsReceipt', 'GoodsReceiptNo');
      expect(result).toBe(`GRN-${YEAR}-01000`);
    });
  });

  describe('all whitelisted table/column pairs', () => {
    const WHITELIST_CASES = [
      { prefix: 'PO',  table: 'InventoryPurchaseOrder',     col: 'PONumber' },
      { prefix: 'GRN', table: 'InventoryGoodsReceipt',      col: 'GoodsReceiptNo' },
      { prefix: 'REQ', table: 'InventoryRequisition',       col: 'RequisitionNo' },
      { prefix: 'DSP', table: 'InventoryDispatch',          col: 'DispatchNo' },
      { prefix: 'RET', table: 'InventoryReturnToVendor',    col: 'ReturnNo' },
      { prefix: 'WO',  table: 'InventoryWriteOff',          col: 'WriteOffNo' },
      { prefix: 'RFQ', table: 'InventoryRFQ',               col: 'RFQNo' },
      { prefix: 'QTN', table: 'InventoryQuotation',         col: 'QuotationNo' },
      { prefix: 'DPO', table: 'InventoryPurchaseOrderDraft', col: 'DraftPurchaseOrderNo' },
    ] as const;

    for (const { prefix, table, col } of WHITELIST_CASES) {
      it(`generates sequence for ${table}.${col}`, async () => {
        const db = makeD1Stub(null);
        const result = await generateSequenceNo(db, prefix, table, col);
        expect(result).toMatch(new RegExp(`^${prefix}-${YEAR}-\\d{5}$`));
      });
    }
  });

  describe('whitelist security', () => {
    it('throws for a non-whitelisted table', async () => {
      const db = makeD1Stub(null);
      await expect(
        generateSequenceNo(db, 'XX', 'SomeArbitraryTable', 'SomeColumn'),
      ).rejects.toThrow('Not whitelisted');
    });

    it('throws if table is whitelisted but column does not match', async () => {
      const db = makeD1Stub(null);
      // Table exists in whitelist but column is wrong
      await expect(
        generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'WrongColumn'),
      ).rejects.toThrow('Not whitelisted');
    });

    it('throws for SQL-injection-like table name', async () => {
      const db = makeD1Stub(null);
      await expect(
        generateSequenceNo(db, 'X', "InventoryPurchaseOrder; DROP TABLE--", 'PONumber'),
      ).rejects.toThrow('Not whitelisted');
    });
  });

  describe('tenant scoping', () => {
    it('resolves with tenantId param without error', async () => {
      const db = makeD1Stub(null);
      // Verifies tenant-scoped query is built without throwing
      const result = await generateSequenceNo(
        db, 'PO', 'InventoryPurchaseOrder', 'PONumber', 'tenant-abc',
      );
      expect(result).toBe(`PO-${YEAR}-00001`);
    });

    it('resolves without tenantId param — generates global sequence', async () => {
      const db = makeD1Stub(null);
      const result = await generateSequenceNo(
        db, 'PO', 'InventoryPurchaseOrder', 'PONumber',
      );
      expect(result).toBe(`PO-${YEAR}-00001`);
    });
  });

  describe('edge cases', () => {
    it('handles malformed last sequence number (no hyphen-delimited number)', async () => {
      const db = makeD1Stub({ PONumber: 'CORRUPT' });
      // NaN parseInt → resets to 1
      const result = await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber');
      expect(result).toBe(`PO-${YEAR}-00001`);
    });

    it('uses current year in format', async () => {
      const db = makeD1Stub(null);
      const result = await generateSequenceNo(db, 'PO', 'InventoryPurchaseOrder', 'PONumber');
      expect(result).toContain(String(YEAR));
    });
  });
});
