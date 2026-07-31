import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('daily collection route mounting', () => {
  it('mounts the specific daily collection route before generic reports routes', () => {
    const source = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf-8');
    const dailyCollectionIndex = source.indexOf("app.route('/api/reports/daily-collection', dailyCollectionRoutes);");
    const reportsIndex = source.indexOf("app.route('/api/reports', reportsRoutes);");

    expect(dailyCollectionIndex).toBeGreaterThan(-1);
    expect(reportsIndex).toBeGreaterThan(-1);
    expect(dailyCollectionIndex).toBeLessThan(reportsIndex);
  });

  it('returns invoice numbers for collection detail references instead of receipt-only descriptions', () => {
    const source = readFileSync(resolve(__dirname, '../src/routes/tenant/dailyCollection.ts'), 'utf-8');

    expect(source).toContain('b.invoice_no');
    expect(source).toContain('COALESCE(b.invoice_no, ect.description');
    expect(source).toContain('COALESCE(b.invoice_no, p.receipt_no');
  });

  it('keeps test invoice detail rows even when no doctor is assigned', () => {
    const source = readFileSync(resolve(__dirname, '../src/routes/tenant/dailyCollection.ts'), 'utf-8');
    const blockStart = source.indexOf('const { results: doctorTestInvoiceRows }');
    const blockEnd = source.indexOf('const readyStatusSql', blockStart);
    const doctorTestInvoiceQuery = source.slice(blockStart, blockEnd);

    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    expect(doctorTestInvoiceQuery).toContain('LEFT JOIN doctors d ON d.id = COALESCE(b.referring_doctor_id, v.doctor_id)');
    expect(doctorTestInvoiceQuery).toContain("'Unassigned / No Doctor'");
  });

  it('includes patient deposit collection in daily collection totals and payment methods', () => {
    const source = readFileSync(resolve(__dirname, '../src/routes/tenant/dailyCollection.ts'), 'utf-8');

    expect(source).toContain('const depositCollectionRow');
    expect(source).toContain('FROM billing_deposits');
    expect(source).toContain('deposit_collection: depositCollection');
    expect(source).toContain('depositPaymentMethodRows');
  });

  it('allocates actual paid receipts to each doctor for visit and test collection', () => {
    const source = readFileSync(resolve(__dirname, '../src/routes/tenant/dailyCollection.ts'), 'utf-8');

    expect(source).toContain('doctorPaidServiceRows');
    expect(source).toContain('payment_totals AS');
    expect(source).toContain('visit_collection_amount');
    expect(source).toContain('test_collection_amount');
    expect(source).toContain('paid_amount * visit_base / allocation_base');
    expect(source).toContain('paid_amount * test_base / allocation_base');
    expect(source).toContain('ii.reference_id');
  });

  it('keeps invoice joins tenant-scoped and exposes paid expense lines', () => {
    const source = readFileSync(resolve(__dirname, '../src/routes/tenant/dailyCollection.ts'), 'utf-8');

    expect(source).not.toContain('b.tenant_id = b.tenant_id');
    expect(source).toContain('expense_details: expenseDetails');
    expect(source).toContain("category: 'Doctor payouts'");
    expect(source).toContain('payment_method');
  });

});
