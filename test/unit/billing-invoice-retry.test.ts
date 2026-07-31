import { describe, it, expect } from 'vitest';
import { withInvoiceRetry } from '../../src/lib/invoice-retry';

describe('withInvoiceRetry', () => {
  it('returns result on first attempt when no conflict', async () => {
    let attempts = 0;
    const result = await withInvoiceRetry(async () => {
      attempts++;
      return { invoiceNo: 'INV-000001', billId: 1 };
    });

    expect(result.invoiceNo).toBe('INV-000001');
    expect(result.billId).toBe(1);
    expect(attempts).toBe(1);
  });

  it('retries on UNIQUE constraint violation and succeeds', async () => {
    let attempts = 0;
    const result = await withInvoiceRetry(async () => {
      attempts++;
      if (attempts === 1) {
        const err = new Error('UNIQUE constraint failed: bills.invoice_no') as Error & { code?: string };
        throw err;
      }
      return { invoiceNo: 'INV-000002', billId: 2 };
    });

    expect(result.invoiceNo).toBe('INV-000002');
    expect(attempts).toBe(2);
  });

  it('retries up to maxRetries then throws', async () => {
    let attempts = 0;
    await expect(
      withInvoiceRetry(async () => {
        attempts++;
        const err = new Error('UNIQUE constraint failed: bills.invoice_no') as Error & { code?: string };
        throw err;
      }, 3),
    ).rejects.toThrow('UNIQUE constraint failed');

    expect(attempts).toBe(3);
  });

  it('does not retry non-UNIQUE errors', async () => {
    let attempts = 0;
    await expect(
      withInvoiceRetry(async () => {
        attempts++;
        throw new Error('Database connection lost');
      }),
    ).rejects.toThrow('Database connection lost');

    expect(attempts).toBe(1);
  });

  it('detects SQLite UNIQUE constraint error by message pattern', async () => {
    let attempts = 0;
    const result = await withInvoiceRetry(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('UNIQUE constraint failed: tenant_bills.invoice_no');
      }
      return { invoiceNo: 'INV-000005', billId: 5 };
    });

    expect(result.invoiceNo).toBe('INV-000005');
    expect(attempts).toBe(2);
  });

  it('detects UNIQUE constraint error by SQLITE_CONSTRAINT code', async () => {
    let attempts = 0;
    const result = await withInvoiceRetry(async () => {
      attempts++;
      if (attempts === 1) {
        const err = new Error('constraint failed') as Error & { code?: string };
        err.code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw err;
      }
      return { invoiceNo: 'INV-000010', billId: 10 };
    });

    expect(result.invoiceNo).toBe('INV-000010');
    expect(attempts).toBe(2);
  });
});
