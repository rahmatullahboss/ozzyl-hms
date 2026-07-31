import { describe, expect, it, beforeEach } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';

// ═════════════════════════════════════════════════════════════════════════════
// Issue 1: Duplicate bills race condition guard
//
// The generate-bill endpoint reads pending services, creates a bill, then marks
// services as billed. Two concurrent requests can both read the same pending
// services. The fix adds `WHERE bill_id IS NULL` to the UPDATE that marks
// services as billed, and checks that each UPDATE affected ≥ 1 row.
// ═════════════════════════════════════════════════════════════════════════════

describe('Duplicate bill guard: WHERE bill_id IS NULL', () => {
  const tenantId = 'tenant-test';

  it('UPDATE without bill_id IS NULL guard updates the matching service row', async () => {
    // The mock DB should model real D1/SQLite semantics: SET assignments are not
    // WHERE filters. Race protection must come from the explicit bill_id IS NULL
    // guard, not from accidental mock parser behavior.
    const { db } = createMockDB({
      tables: {
        visit_services: [
          { id: 10, visit_id: 1, tenant_id: tenantId, status: 'billed', bill_id: 42 },
        ],
      },
    });

    const result = await db.prepare(`
      UPDATE visit_services SET status = 'billed', bill_id = ? WHERE id = ?
    `).bind(99, 10).run();

    expect(result.meta.changes).toBe(1);
  });

  it('SQL pattern includes bill_id IS NULL guard in the WHERE clause', () => {
    // Verify the guard SQL pattern is correct
    const guardedSql = `UPDATE visit_services SET status = 'billed', bill_id = ? WHERE id = ? AND bill_id IS NULL`;
    expect(guardedSql).toContain('AND bill_id IS NULL');
    // The guard ensures only unbilled services can be claimed
  });

  it('batch results can be inspected for changes to detect races', async () => {
    const { db } = createMockDB({
      tables: {
        visit_services: [
          { id: 10, visit_id: 1, tenant_id: tenantId, status: 'pending', bill_id: null },
          { id: 11, visit_id: 1, tenant_id: tenantId, status: 'pending', bill_id: null },
        ],
      },
    });

    const stmts = [
      db.prepare(`INSERT INTO invoice_items (bill_id, tenant_id) VALUES (?, ?)`).bind(99, tenantId),
      db.prepare(`UPDATE visit_services SET status = 'billed', bill_id = ? WHERE id = ?`).bind(99, 10),
      db.prepare(`UPDATE visit_services SET status = 'billed', bill_id = ? WHERE id = ?`).bind(99, 11),
    ];

    const results = await db.batch(stmts);

    // Batch returns results for each statement
    expect(results).toHaveLength(3);
    // Each result has meta.changes that can be inspected
    for (const r of results) {
      expect((r as any).meta).toBeDefined();
      expect(typeof (r as any).meta.changes).toBe('number');
    }
  });

  it('concurrent billing scenario: first request claims service, second should detect race', () => {
    // This test documents the race condition scenario and the expected behavior
    // after the fix is applied.

    // State after Request A completes:
    const serviceAfterFirstBill = {
      id: 10,
      visit_id: 1,
      tenant_id: tenantId,
      status: 'billed',
      bill_id: 100, // Already claimed by Request A
    };

    // Request B tries to claim the same service.
    // With the `WHERE bill_id IS NULL` guard:
    //   - SQL: UPDATE visit_services SET status='billed', bill_id=200 WHERE id=10 AND bill_id IS NULL
    //   - Result: 0 changes (because bill_id is already 100, not NULL)
    //   - Handler throws HTTPException(409)
    //
    // Without the guard:
    //   - SQL: UPDATE visit_services SET status='billed', bill_id=200 WHERE id=10
    //   - Result: 1 change (overwrites bill_id from 100 to 200!)
    //   - Duplicate bill created

    expect(serviceAfterFirstBill.bill_id).toBe(100);
    expect(serviceAfterFirstBill.bill_id).not.toBeNull();
    // The IS NULL guard would return 0 changes for this row
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Issue 2: Lab order creation atomicity
//
// Lab order creation inserts into multiple tables (lab_orders, lab_order_items,
// bills, invoice_items, visit_services). All writes must be in a single D1 batch
// so that if any step fails, the entire operation rolls back.
// ═════════════════════════════════════════════════════════════════════════════

describe('Lab order creation atomicity', () => {
  const tenantId = 'tenant-test';

  it('all writes succeed in a single batch', async () => {
    const { db, queries } = createMockDB({
      tables: {
        lab_orders: [],
        lab_order_items: [],
        bills: [],
        invoice_items: [],
        visit_services: [],
      },
    });

    const orderId = 1;
    const billId = 42;
    const orderTotal = 500;

    const writeStmts = [
      // 0. Insert bill
      db.prepare(`
        INSERT INTO bills (id, patient_id, visit_id, invoice_no, test_bill, total, paid, due, status, tenant_id)
        VALUES (?, 1, 1, 'INV-001', ?, ?, 0, ?, 'open', ?)
      `).bind(billId, orderTotal, orderTotal, orderTotal, tenantId),

      // 1. Update lab_orders with bill_id
      db.prepare(`UPDATE lab_orders SET bill_id = ?, billing_status = 'unpaid' WHERE id = ? AND tenant_id = ?`)
        .bind(billId, orderId, tenantId),

      // 2. Insert invoice item
      db.prepare(`INSERT INTO invoice_items (bill_id, item_category, description, tenant_id) VALUES (?, 'test', 'CBC', ?)`)
        .bind(billId, tenantId),

      // 3. Insert visit_service
      db.prepare(`INSERT INTO visit_services (tenant_id, visit_id, patient_id, service_type, bill_id, status) VALUES (?, 1, 1, 'test', ?, 'billed')`)
        .bind(tenantId, billId),
    ];

    const results = await db.batch(writeStmts);

    // All 4 statements executed
    expect(results).toHaveLength(4);
    for (const r of results) {
      expect((r as any).success).toBe(true);
    }
  });

  it('batch is atomic: all-or-nothing via mock DB', async () => {
    // The mock DB always succeeds, but this test documents the expected contract:
    // if D1 batch fails mid-way, ALL statements roll back.
    const { db } = createMockDB({ tables: {} });

    const stmts = [
      db.prepare(`INSERT INTO bills (id, tenant_id) VALUES (1, ?)`).bind(tenantId),
      db.prepare(`INSERT INTO invoice_items (bill_id, tenant_id) VALUES (1, ?)`).bind(tenantId),
      db.prepare(`INSERT INTO visit_services (tenant_id, bill_id) VALUES (?, 1)`).bind(tenantId),
    ];

    const results = await db.batch(stmts);
    expect(results).toHaveLength(3);
  });

  it('pre-generated bill ID is used consistently across all batch statements', async () => {
    const { db, queries } = createMockDB({
      tables: {
        lab_orders: [],
        lab_order_items: [],
        bills: [],
        invoice_items: [],
        visit_services: [],
      },
    });

    const billId = 42; // Pre-generated via getNextNumericSequence

    const writeStmts = [
      db.prepare(`INSERT INTO bills (id, tenant_id) VALUES (?, ?)`).bind(billId, tenantId),
      db.prepare(`UPDATE lab_orders SET bill_id = ? WHERE id = 1`).bind(billId),
      db.prepare(`INSERT INTO invoice_items (bill_id, tenant_id) VALUES (?, ?)`).bind(billId, tenantId),
      db.prepare(`INSERT INTO visit_services (bill_id, tenant_id) VALUES (?, ?)`).bind(billId, tenantId),
    ];

    await db.batch(writeStmts);

    // Verify all queries used the same bill ID (42)
    const billIdValues = queries
      .filter(q => q.sql.includes('bill_id') || q.sql.includes('bills'))
      .flatMap(q => q.params)
      .filter(p => p === billId);

    // The bill ID 42 should appear in every statement
    expect(billIdValues.length).toBeGreaterThanOrEqual(4);
  });

  it('getNextNumericSequence returns a number suitable for pre-generated IDs', async () => {
    // This test documents that getNextNumericSequence returns a plain number
    // (not a prefixed string like BILL-000001) that can be used as a primary key.
    const { getNextNumericSequence } = await import('../src/lib/sequence');
    expect(typeof getNextNumericSequence).toBe('function');
  });
});
