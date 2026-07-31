import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const componentFile = resolve(__dirname, '../../apps/ozzyl-lifestyle/src/components/patient/PatientHospitalServicesTab.tsx');

describe('patient portal lab result UI contract', () => {
  it('loads selected-hospital lab result detail before showing released test details', () => {
    const source = readFileSync(componentFile, 'utf8');

    expect(source).toContain('interface LabResultDetailResponse');
    expect(source).toContain('const [selectedLabResultDetail, setSelectedLabResultDetail]');
    expect(source).toContain('async function handleOpenLabResultDetail');
    expect(source).toContain('fetchPortalJson<LabResultDetailResponse>(detailPath, selectedTenantId)');
    expect(source).toContain('Lab result detail');
    expect(source).toContain('Reference range:');
    expect(source).toContain('No released result items');
  });

  it('provides lab result share and PDF actions without treatment advice text', () => {
    const source = readFileSync(componentFile, 'utf8');

    expect(source).toContain('async function handleShareLabResult');
    expect(source).toContain('navigator.share');
    expect(source).toContain('navigator.clipboard.writeText');
    expect(source).toContain('Download PDF');
    expect(source).not.toContain('treatment recommendation');
  });
});
