export type InvoicePaperSize = 'a5' | 'a4';

const PAPER_CONFIG = {
  a5: { pageRule: 'A5 portrait', margin: '0', previewWidth: '148mm' },
  a4: { pageRule: 'A4 portrait', margin: '0', previewWidth: '210mm' },
} as const;

export function parseInvoicePaperSize(value: string | null | undefined): InvoicePaperSize {
  return value === 'a4' ? 'a4' : 'a5';
}

export function getInvoicePaperConfig(size: InvoicePaperSize) {
  return PAPER_CONFIG[size];
}
