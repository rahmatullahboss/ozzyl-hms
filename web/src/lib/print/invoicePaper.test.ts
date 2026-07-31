import { describe, expect, it } from 'vitest';
import { getInvoicePaperConfig, parseInvoicePaperSize } from './invoicePaper';

describe('invoice paper settings', () => {
  it('defaults invalid or missing values to A5', () => {
    expect(parseInvoicePaperSize(null)).toBe('a5');
    expect(parseInvoicePaperSize('letter')).toBe('a5');
  });

  it('accepts remembered A4 and A5 values', () => {
    expect(parseInvoicePaperSize('a4')).toBe('a4');
    expect(parseInvoicePaperSize('a5')).toBe('a5');
  });

  it('returns portrait page metrics for both sizes', () => {
    expect(getInvoicePaperConfig('a5')).toEqual({
      pageRule: 'A5 portrait',
      margin: '0',
      previewWidth: '148mm',
    });
    expect(getInvoicePaperConfig('a4')).toEqual({
      pageRule: 'A4 portrait',
      margin: '0',
      previewWidth: '210mm',
    });
  });
});
