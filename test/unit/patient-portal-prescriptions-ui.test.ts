import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const componentFile = resolve(__dirname, '../../apps/ozzyl-lifestyle/src/components/patient/PatientHospitalServicesTab.tsx');

describe('patient portal prescription UI contract', () => {
  it('loads selected-hospital prescription detail before showing medicine details', () => {
    const source = readFileSync(componentFile, 'utf8');

    expect(source).toContain('interface PrescriptionDetailResponse');
    expect(source).toContain('const [selectedPrescriptionDetail, setSelectedPrescriptionDetail]');
    expect(source).toContain('async function handleOpenPrescriptionDetail');
    expect(source).toContain('fetchPortalJson<PrescriptionDetailResponse>(state.detailPath, selectedTenantId)');
    expect(source).toContain('Prescription detail');
    expect(source).toContain('No medicines listed');
  });

  it('provides an explicit prescription share action with clipboard fallback', () => {
    const source = readFileSync(componentFile, 'utf8');

    expect(source).toContain('async function handleSharePrescription');
    expect(source).toContain('navigator.share');
    expect(source).toContain('navigator.clipboard.writeText');
    expect(source.match(/Share/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(source).toContain('Download PDF');
  });
});
