import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const pagePath = path.resolve(process.cwd(), 'src/pages/AdmissionIPD.tsx');

describe('AdmissionIPD', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./AdmissionIPD');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('opens the dedicated admission slip preview after a successful admission', () => {
    const source = readFileSync(pagePath, 'utf8');

    expect(source).toContain("import { getAdmissionSlipPrintPath } from '../lib/admissionPrint';");
    expect(source).toContain('admission_id: number');
    expect(source).toContain('const admissionSlipPath = getAdmissionSlipPrintPath(admissionBasePath, data.admission_id);');
    expect(source).toContain('admission_id: data.admission_id,');
    expect(source).toContain('onSettled: () => navigate(admissionSlipPath),');
    expect(source).toContain('navigate(admissionSlipPath);');
  });

  it('uses the dedicated preview for the admissions-list print action', () => {
    const source = readFileSync(pagePath, 'utf8');

    expect(source).toContain('const handlePrintAdmissionSlip = (a: Admission) => {');
    expect(source).toContain('navigate(getAdmissionSlipPrintPath(admissionBasePath, a.id));');
  });
});
