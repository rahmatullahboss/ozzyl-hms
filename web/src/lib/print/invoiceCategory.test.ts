import { describe, expect, it } from 'vitest';
import { filterLabTestInvoiceItems, getInvoiceBannerLabel, getInvoiceLayout } from './invoiceCategory';

describe('getInvoiceBannerLabel', () => {
  it('returns APPOINTMENT INVOICE when all items are doctor_visit', () => {
    const items = [
      { item_category: 'doctor_visit' },
      { item_category: 'consultation' },
      { item_category: 'opd' },
    ];
    expect(getInvoiceBannerLabel(items, 'en')).toBe('APPOINTMENT INVOICE');
  });

  it('returns LABORATORY TEST when items are lab', () => {
    const items = [{ item_category: 'test' }, { item_category: 'lab' }];
    expect(getInvoiceBannerLabel(items, 'en')).toBe('LABORATORY TEST');
  });

  it('joins consultation and lab in priority order (consultation first)', () => {
    const items = [{ item_category: 'test' }, { item_category: 'doctor_visit' }];
    expect(getInvoiceBannerLabel(items, 'en')).toBe('APPOINTMENT INVOICE + LABORATORY TEST');
  });

  it('joins three categories in priority order', () => {
    const items = [
      { item_category: 'radiology' },
      { item_category: 'doctor_visit' },
      { item_category: 'test' },
    ];
    expect(getInvoiceBannerLabel(items, 'en')).toBe(
      'APPOINTMENT INVOICE + LABORATORY TEST + RADIOLOGY',
    );
  });

  it('returns IPD / ADMISSION BILL for bed-charge discharge items', () => {
    expect(getInvoiceBannerLabel([{ item_category: 'bed_charge' }, { item_category: 'admission' }], 'en')).toBe('IPD / ADMISSION BILL');
  });

  it('returns INVOICE for empty items', () => {
    expect(getInvoiceBannerLabel([], 'en')).toBe('INVOICE');
  });

  it('returns INVOICE for unknown categories', () => {
    expect(getInvoiceBannerLabel([{ item_category: 'bogus_value' }], 'en')).toBe('INVOICE');
  });

  it('returns INVOICE for items with null category', () => {
    expect(getInvoiceBannerLabel([{ item_category: null }], 'en')).toBe('INVOICE');
  });

  it('returns Bengali label for consultation', () => {
    expect(getInvoiceBannerLabel([{ item_category: 'doctor_visit' }], 'bn')).toBe('অ্যাপয়েন্টমেন্ট ইনভয়েস');
  });

  it('returns Bengali joined label for mixed categories', () => {
    const items = [{ item_category: 'test' }, { item_category: 'doctor_visit' }];
    expect(getInvoiceBannerLabel(items, 'bn')).toBe('অ্যাপয়েন্টমেন্ট ইনভয়েস + ল্যাবরেটরি পরীক্ষা');
  });

  it('is case-insensitive on item_category', () => {
    const items = [{ item_category: 'DOCTOR_VISIT' }];
    expect(getInvoiceBannerLabel(items, 'en')).toBe('APPOINTMENT INVOICE');
  });
});

describe('filterLabTestInvoiceItems', () => {
  it('keeps laboratory/test/pathology items and excludes radiology and non-diagnostic IPD charges', () => {
    const items = [
      { id: 1, item_category: 'test' },
      { id: 2, item_category: 'lab' },
      { id: 3, item_category: 'laboratory' },
      { id: 4, item_category: 'pathology' },
      { id: 5, item_category: 'radiology' },
      { id: 6, item_category: 'bed_charge' },
    ];

    expect(filterLabTestInvoiceItems(items).map((item) => item.id)).toEqual([1, 2, 3, 4]);
  });
});

describe('getInvoiceLayout', () => {
  it('selects consultation for doctor-only categories', () => {
    expect(getInvoiceLayout([
      { item_category: 'doctor_visit' },
      { item_category: 'consultation' },
    ])).toBe('consultation');
  });

  it('selects diagnostic for lab and radiology categories', () => {
    expect(getInvoiceLayout([
      { item_category: 'test' },
      { item_category: 'radiology' },
    ])).toBe('diagnostic');
  });

  it('selects generic for mixed consultation and diagnostic items', () => {
    expect(getInvoiceLayout([
      { item_category: 'doctor_visit' },
      { item_category: 'test' },
    ])).toBe('generic');
  });

  it('selects generic for empty or unsupported categories', () => {
    expect(getInvoiceLayout([])).toBe('generic');
    expect(getInvoiceLayout([{ item_category: 'medicine' }])).toBe('generic');
  });
});
