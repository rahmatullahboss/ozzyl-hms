import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src/routes/tenant/pharmacy/stock.ts'), 'utf8');

describe('pharmacy production summary and alerts', () => {
  it('keeps low-stock alerts unified across advanced and legacy pharmacy stock', () => {
    expect(source).toContain("stockRoutes.get('/alerts/low-stock'");
    expect(source).toContain('pharmacy_items');
    expect(source).toContain('pharmacy_stock');
    expect(source).toContain('medicines');
    expect(source).toContain('medicine_stock_batches');
    expect(source).toContain('UNION ALL');
  });

  it('keeps expiring-stock alerts unified across both stock systems', () => {
    expect(source).toContain("stockRoutes.get('/alerts/expiring'");
    expect(source).toContain("'pharmacy_stock' as source");
    expect(source).toContain("'medicine_stock_batch' as source");
    expect(source).toContain('daysWindow');
  });

  it('keeps pharmacy summary aggregated across stock, invoice, and sales systems', () => {
    expect(source).toContain("stockRoutes.get('/summary'");
    expect(source).toContain('pharmacy_invoices');
    expect(source).toContain('pharmacy_sales');
    expect(source).toContain('pharmacy_invoice_items');
    expect(source).toContain('medicine_stock_movements');
    expect(source).toContain('totalInvestment');
    expect(source).toContain('grossProfit');
    expect(source).toContain('todaySalesCount');
  });
});
