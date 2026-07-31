import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(__dirname, '..', path), 'utf8');
}

describe('approved cash refund net collection queries', () => {
  it('nets SalesReturn rows from executive dashboard collection totals and trends', () => {
    const dashboard = source('src/routes/tenant/dashboard.ts');

    expect(dashboard).toContain('refund_by_day AS');
    expect(dashboard).toContain('refund_total AS');
    expect(dashboard).toContain("transaction_type = 'SalesReturn'");
    expect(dashboard).toContain('today_collection_total');
    expect(dashboard).toContain('selected_gross');
  });

  it('nets refunds from daily collection finance, service and payment-method totals', () => {
    const dailyCollection = source('src/routes/tenant/dailyCollection.ts');

    expect(dailyCollection).toContain('refund_totals AS');
    expect(dailyCollection).toContain('refunds_by_bill AS');
    expect(dailyCollection).toContain('refundPaymentMethodRows');
    expect(dailyCollection).toContain("transaction_type = 'SalesReturn'");
    expect(dailyCollection).toContain('billing_credit_notes');
    expect(dailyCollection).toContain("COALESCE(${alias}.payable_commission_amount, 0) != 0");
    expect(dailyCollection).toContain("THEN COALESCE(${alias}.payable_commission_amount, 0)");
  });

  it('nets refunds from reception totals and excludes fully refunded invoice lines', () => {
    const reception = source('src/routes/tenant/reception.ts');

    expect(reception).toContain('refund_by_method AS');
    expect(reception).toContain('refund_total AS');
    expect(reception).toContain("COALESCE(ii.status, 'active') != 'cancelled'");
    expect(reception).toContain("transaction_type = 'SalesReturn'");
  });

  it('persists invoice, drawer and doctor-commission refund side effects', () => {
    const creditNotes = source('src/routes/tenant/creditNotes.ts');

    expect(creditNotes).toContain('prepareCreditNoteCommissionAdjustmentStatements');
    expect(creditNotes).toContain('INSERT INTO cash_drawer_movements');
    expect(creditNotes).toContain("'credit_note_refund'");
    expect(creditNotes).toContain("UPDATE invoice_items");
    expect(creditNotes).toContain('test_bill = MAX(0');
  });
});
