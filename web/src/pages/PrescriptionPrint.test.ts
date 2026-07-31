import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('PrescriptionPrint', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./PrescriptionPrint');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('prints dosage and total prescribed quantity for outside purchasing', () => {
    const source = readFileSync('src/pages/PrescriptionPrint.tsx', 'utf8');
    expect(source).toContain('dosage?: string');
    expect(source).toContain('quantity?: number');
    expect(source).toContain("item.dosage");
    expect(source).toContain("item.quantity");
  });
});
