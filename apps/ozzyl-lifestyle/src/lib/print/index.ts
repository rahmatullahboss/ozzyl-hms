// Central barrel export for all print functions
export { printHtml, formatMoney, formatDate } from './printUtils';
export { printInvoice } from './invoiceTemplate';
export { printReceipt } from './receiptTemplate';
export { printLabSlip } from './labSlipTemplate';
export { printSalarySlip } from './salarySlipTemplate';

export type { InvoiceData } from './invoiceTemplate';
export type { ReceiptData } from './receiptTemplate';
export type { LabOrderPrintData } from './labSlipTemplate';
export type { SalarySlipData } from './salarySlipTemplate';
