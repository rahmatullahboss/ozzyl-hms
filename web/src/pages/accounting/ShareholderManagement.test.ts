import { describe, expect, it, vi } from 'vitest';

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
}));

describe('ShareholderManagement', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ShareholderManagement');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });
});
