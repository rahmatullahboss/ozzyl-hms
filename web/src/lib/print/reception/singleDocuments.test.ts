import { describe, expect, it } from 'vitest';
import {
  buildDenominationSheetHtml,
  buildDiscountVoucherHtml,
  buildDueCollectionReceiptHtml,
  buildDuplicateReceiptHtml,
  buildExpenseVoucherHtml,
  buildHandoverSlipHtml,
  buildRefundVoucherHtml,
  buildReportDeliverySlipHtml,
  buildShiftOpeningSlipHtml,
  type DenominationSheetInput,
  type DiscountVoucherInput,
  type DueCollectionInput,
  type DuplicateReceiptInput,
  type ExpenseVoucherInput,
  type HandoverInput,
  type RefundVoucherInput,
  type ReportDeliveryInput,
  type ShiftOpeningInput,
} from './singleDocuments';
import type { ReceptionContext } from './receptionPrint';

const baseCtx: ReceptionContext = {
  hospitalName: 'Test Hospital',
  branchName: 'Main',
  counterName: 'R01',
  shiftId: 1,
  shiftName: 'Morning',
  cashierName: 'Test Cashier',
  generatedBy: 'Test Cashier',
};

describe('singleDocuments', () => {
  describe('buildDuplicateReceiptHtml', () => {
    it('renders DUPLICATE watermark and copy number', () => {
      const input: DuplicateReceiptInput = {
        bill: { id: 42, invoiceNo: 'INV-42', total: 1500, paid: 1500, due: 0 },
        copyNumber: 2,
      };
      const html = buildDuplicateReceiptHtml(input, baseCtx);
      expect(html).toContain('DUPLICATE COPY');
      expect(html).toContain('COPY #2');
      expect(html).toContain('INV-42');
    });

    it('includes payment summary', () => {
      const input: DuplicateReceiptInput = {
        bill: { id: 1, total: 2000, paid: 1000, due: 1000, discount: 0 },
        copyNumber: 2,
      };
      const html = buildDuplicateReceiptHtml(input, baseCtx);
      expect(html).toContain('Total');
      expect(html).toContain('Paid');
      expect(html).toContain('Due');
    });
  });

  describe('buildShiftOpeningSlipHtml', () => {
    it('renders opening cash + denomination breakdown', () => {
      const input: ShiftOpeningInput = {
        session: {
          id: 1,
          openedAt: '2026-06-23 09:00:00',
          openingCash: 5000,
          counterName: 'R01',
          cashierName: 'Test',
        },
        denominations: { note1000: 5 },
      };
      const html = buildShiftOpeningSlipHtml(input, baseCtx);
      expect(html).toContain('Shift Opening Slip');
      expect(html).toContain('1000'); // denomination note label
      expect(html).toContain('5');
    });

    it('handles no denominations gracefully', () => {
      const input: ShiftOpeningInput = {
        session: { id: 1, openingCash: 1000, cashierName: 'Test' },
      };
      const html = buildShiftOpeningSlipHtml(input, baseCtx);
      expect(html).toContain('No denomination breakdown');
    });
  });

  describe('buildDenominationSheetHtml', () => {
    it('renders all 10 denominations and variance check', () => {
      const input: DenominationSheetInput = {
        shift: { id: 1, expectedCash: 12000, variance: 0, cashierName: 'Test' },
        denominations: { note1000: 10, note500: 4 },
      };
      const html = buildDenominationSheetHtml(input, baseCtx);
      expect(html).toContain('1000');
      expect(html).toContain('500');
      expect(html).toContain('100');
      expect(html).toContain('BALANCED');
    });

    it('shows EXCESS status for positive variance', () => {
      const input: DenominationSheetInput = {
        shift: { id: 1, expectedCash: 1000 },
        denominations: { note1000: 2 },
      };
      const html = buildDenominationSheetHtml(input, baseCtx);
      expect(html).toContain('EXCESS');
    });

    it('shows SHORTAGE for negative variance', () => {
      const input: DenominationSheetInput = {
        shift: { id: 1, expectedCash: 5000 },
        denominations: { note1000: 1 },
      };
      const html = buildDenominationSheetHtml(input, baseCtx);
      expect(html).toContain('SHORTAGE');
    });
  });

  describe('buildHandoverSlipHtml', () => {
    it('renders from/to and amount', () => {
      const input: HandoverInput = {
        handover: {
          id: 1,
          handoverNo: 'HO-1',
          amount: 5000,
          fromName: 'Alice',
          fromCounter: 'R01',
          toName: 'Bob',
          toRole: 'Admin',
          status: 'submitted',
        },
      };
      const html = buildHandoverSlipHtml(input, baseCtx);
      expect(html).toContain('HO-1');
      expect(html).toContain('Alice');
      expect(html).toContain('Bob');
    });
  });

  describe('buildExpenseVoucherHtml', () => {
    it('renders voucher with category and amount', () => {
      const input: ExpenseVoucherInput = {
        expense: {
          id: 1,
          voucherNo: 'EXP-1',
          amount: 250,
          category: 'Maintenance',
          vendor: 'Vendor X',
          status: 'pending',
        },
      };
      const html = buildExpenseVoucherHtml(input, baseCtx);
      expect(html).toContain('EXP-1');
      expect(html).toContain('Maintenance');
      expect(html).toContain('Vendor X');
      expect(html).toContain('PENDING');
    });
  });

  describe('buildRefundVoucherHtml', () => {
    it('renders refund with original bill ref and amount', () => {
      const input: RefundVoucherInput = {
        refund: {
          id: 1,
          voucherNo: 'REF-1',
          originalInvoiceNo: 'INV-99',
          patientName: 'John Doe',
          amount: 500,
          reason: 'Service cancelled',
          status: 'pending',
        },
      };
      const html = buildRefundVoucherHtml(input, baseCtx);
      expect(html).toContain('REF-1');
      expect(html).toContain('INV-99');
      expect(html).toContain('John Doe');
      expect(html).toContain('Service cancelled');
    });
  });

  describe('buildDiscountVoucherHtml', () => {
    it('renders discount with original/net and percent', () => {
      const input: DiscountVoucherInput = {
        bill: {
          id: 1,
          invoiceNo: 'INV-1',
          originalAmount: 1000,
          discountAmount: 200,
          netAmount: 800,
          discountPercent: 20,
          patientName: 'Test Patient',
          reason: 'Senior citizen',
          status: 'approved',
        },
      };
      const html = buildDiscountVoucherHtml(input, baseCtx);
      expect(html).toContain('20.0%');
      expect(html).toContain('Senior citizen');
      expect(html).toContain('APPROVED');
    });
  });

  describe('buildDueCollectionReceiptHtml', () => {
    it('renders previous/collected/remaining due', () => {
      const input: DueCollectionInput = {
        bill: {
          id: 1,
          invoiceNo: 'INV-1',
          patientName: 'Test',
          total: 1000,
          paid: 0,
          due: 1000,
          previousDue: 1000,
          collectedNow: 500,
          remainingDue: 500,
        },
      };
      const html = buildDueCollectionReceiptHtml(input, baseCtx);
      expect(html).toContain('Previous Due');
      expect(html).toContain('Collected Now');
      expect(html).toContain('Remaining Due');
      expect(html).toContain('PARTIAL'); // status pill because remaining > 0
    });
  });

  describe('buildReportDeliverySlipHtml', () => {
    it('renders patient + tests + receiver fields', () => {
      const input: ReportDeliveryInput = {
        order: {
          id: 1,
          orderNo: 'LAB-1',
          patientName: 'Test Patient',
          patientId: 'P-001',
          tests: [
            { name: 'CBC', status: 'ready' },
            { name: 'X-Ray', status: 'ready' },
          ],
          deliveredTo: 'Patient attendant',
          receiverPhone: '+880 1700 000000',
        },
      };
      const html = buildReportDeliverySlipHtml(input, baseCtx);
      expect(html).toContain('Report Delivery Slip');
      expect(html).toContain('LAB-1');
      expect(html).toContain('CBC');
      expect(html).toContain('X-Ray');
      expect(html).toContain('Patient attendant');
    });
  });
});
