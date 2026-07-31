import { describe, it, expect } from 'vitest';

/**
 * Phase 7 (fix/pharmacy-inventory) — schema and route guard unit tests.
 *
 * These tests are textual — they assert the source files in this branch
 * include the canonical/stock/invoice hardening pieces (P0-21..P0-24 +
 * stock adjustment approval). They do not need a live D1 binding.
 */

const fs = require('node:fs');
const path = require('node:path');

function readFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('P0-21 — canonical stock model (single source of truth)', () => {
  it('exposes a canonical pharmacy service module', () => {
    const src = readFile('src/lib/pharmacy-canonical.ts');
    expect(src).toMatch(/createCanonicalPharmacyInvoice/);
    expect(src).toMatch(/FROZEN/i);
    expect(src).toMatch(/selectFefoStockAllocations/);
  });

  it('legacy /api/pharmacy/sales forwards to canonical service', () => {
    const src = readFile('src/routes/tenant/pharmacy/index.ts');
    expect(src).toMatch(/pharmacyRoutes\.post\('\/sales'[\s\S]*?forwardLegacySaleToCanonical/);
  });

  it('legacy /api/pharmacy/billing forwards to canonical service', () => {
    const src = readFile('src/routes/tenant/pharmacy/index.ts');
    expect(src).toMatch(/pharmacyRoutes\.post\('\/billing'[\s\S]*?forwardLegacyBillToCanonical/);
  });

  it('legacy legacy_medicine_create writes still emit a deprecation warning', () => {
    const src = readFile('src/routes/tenant/pharmacy/index.ts');
    expect(src).toMatch(/emitDeprecationWarning/);
    expect(src).toMatch(/legacy_medicine_create/);
  });
});

describe('P0-22 — legacy sales/billing endpoints return 410 Gone on refusal', () => {
  it('legacy /sales returns HTTPException(410) when canonical refuses', () => {
    const src = readFile('src/routes/tenant/pharmacy/index.ts');
    expect(src).toMatch(/if \(err instanceof CanonicalRefusalError\)[\s\S]*?HTTPException\(410/);
  });

  it('legacy /billing returns HTTPException(410) when canonical refuses', () => {
    const src = readFile('src/routes/tenant/pharmacy/index.ts');
    expect(src).toMatch(/if \(err instanceof CanonicalRefusalError\)[\s\S]*?HTTPException\(410/);
  });
});

describe('P0-23 — invoice / return transaction safety', () => {
  it('canonical invoice create wraps in single batched transaction', () => {
    const src = readFile('src/lib/pharmacy-canonical.ts');
    expect(src).toMatch(/UPDATE pharmacy_stock SET available_qty = available_qty - \?/);
    expect(src).toMatch(/INSERT INTO pharmacy_invoice_items/);
    expect(src).toMatch(/INSERT INTO pharmacy_stock_transactions/);
  });

  it('canonical invoice supports idempotency key', () => {
    const src = readFile('src/lib/pharmacy-canonical.ts');
    expect(src).toMatch(/reserveMutationIdempotencyKey/);
    expect(src).toMatch(/completeMutationIdempotencyKey/);
    expect(src).toMatch(/markMutationIdempotencyKeyFailed/);
  });

  it('canonical invoice supports pending_repair state', () => {
    const src = readFile('src/lib/pharmacy-canonical.ts');
    expect(src).toMatch(/pending_repair/);
    expect(src).toMatch(/pharmacy_invoice_repair_queue/);
  });

  it('repair endpoint exists and requires supervisor permission', () => {
    const src = readFile('src/routes/tenant/pharmacy/invoices.ts');
    expect(src).toMatch(/pharmacy:invoice_repair/);
    expect(src).toMatch(/invoices\/repair-queue\/:id\/repair/);
  });
});

describe('P0-24 — purchase / GRN transaction safety', () => {
  it('validates supplier tenant ownership before insert', () => {
    const src = readFile('src/routes/tenant/pharmacy/purchase.ts');
    expect(src).toMatch(/Supplier \$\{data\.supplierId\} does not belong to this tenant/);
    expect(src).toMatch(/Number\(po\.supplier_id\)/);
  });

  it('canonical /goods-receipts/v2 supports idempotency', () => {
    const src = readFile('src/routes/tenant/pharmacy/purchase.ts');
    expect(src).toMatch(/mutationType: 'pharmacy_grn'/);
    expect(src).toMatch(/completeMutationIdempotencyKey/);
  });

  it('GRN is wrapped in a single batched transaction (header + items + stock + PO update)', () => {
    const src = readFile('src/routes/tenant/pharmacy/purchase.ts');
    expect(src).toMatch(/UPDATE pharmacy_purchase_orders/);
    expect(src).toMatch(/UPDATE pharmacy_stock/);
  });
});

describe('E — stock adjustment approval (supervisor-gated for high-value / narcotic)', () => {
  it('exposes a request endpoint that queues for approval when needed', () => {
    const src = readFile('src/routes/tenant/pharmacy/stock.ts');
    expect(src).toMatch(/stock_adjustment_approvals/);
    expect(src).toMatch(/STOCK_ADJUSTMENT_APPROVAL_THRESHOLD_PAISA/);
    expect(src).toMatch(/deferApply/);
  });

  it('approve endpoint requires the pharmacy:stock_adjustment_approve permission', () => {
    const src = readFile('src/routes/tenant/pharmacy/stock.ts');
    expect(src).toMatch(/pharmacy:stock_adjustment_approve/);
    expect(src).toMatch(/separation of duties/);
  });

  it('all stock-adjustment paths emit audit log entries', () => {
    const src = readFile('src/routes/tenant/pharmacy/stock.ts');
    expect(src).toMatch(/STOCK_ADJUSTMENT_DIRECT/);
    expect(src).toMatch(/STOCK_ADJUSTMENT_QUEUED/);
    expect(src).toMatch(/STOCK_ADJUSTMENT_APPROVED/);
    expect(src).toMatch(/STOCK_ADJUSTMENT_REJECTED/);
  });
});

describe('migrations — Phase 7 inventory hardening', () => {
  it('adds pharmacy_invoice_repair_queue', () => {
    const src = readFile('migrations/0351_pharmacy_phase7_inventory_hardening.sql');
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS pharmacy_invoice_repair_queue/);
  });

  it('adds stock_adjustment_approvals', () => {
    const src = readFile('migrations/0351_pharmacy_phase7_inventory_hardening.sql');
    expect(src).toMatch(/CREATE TABLE IF NOT EXISTS stock_adjustment_approvals/);
  });
});

describe('schemas — Phase 7 stock adjustment + idempotency + repair schemas', () => {
  it('exports the new schemas', () => {
    const src = readFile('src/schemas/pharmacy.ts');
    expect(src).toMatch(/stockAdjustmentRequestSchema/);
    expect(src).toMatch(/reviewStockAdjustmentSchema/);
    expect(src).toMatch(/idempotencyKeySchema/);
    expect(src).toMatch(/invoiceRepairSchema/);
  });
});
