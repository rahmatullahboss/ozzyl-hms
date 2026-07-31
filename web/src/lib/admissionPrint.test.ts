import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const helperPath = path.resolve(process.cwd(), 'src/lib/admissionPrint.ts');
const appPath = path.resolve(process.cwd(), 'src/App.tsx');

describe('admission slip print routing', () => {
  it('provides stable print paths for admin and reception surfaces', async () => {
    expect(existsSync(helperPath)).toBe(true);

    const modulePath = './admissionPrint';
    const { getAdmissionSlipPrintPath } = await import(/* @vite-ignore */ modulePath);
    expect(getAdmissionSlipPrintPath('/h/demo-hospital', 91)).toBe('/h/demo-hospital/admissions/91/print');
    expect(getAdmissionSlipPrintPath('/h/demo-hospital/reception', 91)).toBe('/h/demo-hospital/reception/admissions/91/print');
  });

  it('registers admission slip preview routes for both surfaces', () => {
    const appSource = readFileSync(appPath, 'utf8');

    expect(appSource).toContain("const AdmissionSlipPrint = lazy(() => import('./pages/AdmissionSlipPrint'));");
    expect(appSource).toContain('path="admissions/:admissionId/print"');
    expect(appSource).toContain('path="reception/admissions/:admissionId/print"');
  });
});
