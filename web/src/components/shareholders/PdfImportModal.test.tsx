import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'blob:mock-worker-url',
}));

vi.mock('../../lib/shareholderPdfParser', () => ({
  parseShareholderPDF: vi.fn(() => []),
  validateParsedShareholder: vi.fn(() => ({ valid: true, warnings: [] })),
  previewParsedData: vi.fn(() => []),
}));

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe('PdfImportModal', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PdfImportModal');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });
});
