import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const componentFile = resolve(__dirname, '../../apps/ozzyl-lifestyle/src/components/patient/PatientHospitalServicesTab.tsx');

describe('patient portal bills UI contract', () => {
  it('loads selected-hospital bill detail and shows financial summary', () => {
    const source = readFileSync(componentFile, 'utf8');

    expect(source).toContain('interface BillDetailResponse');
    expect(source).toContain('const [selectedBillDetail, setSelectedBillDetail]');
    expect(source).toContain('async function handleOpenBillDetail');
    expect(source).toContain('fetchPortalJson<BillDetailResponse>(buildPatientTenantPortalPath(`/bills/${bill.id}`), selectedTenantId)');
    expect(source).toContain('Bill detail');
    expect(source).toContain('Total:');
    expect(source).toContain('Paid:');
    expect(source).toContain('Due:');
  });

  it('keeps payment and receipt actions explicit and disabled when unsupported', () => {
    const source = readFileSync(componentFile, 'utf8');

    expect(source).toContain('Payment coming soon');
    expect(source).toContain('Receipt from counter');
    expect(source).toContain('Pay online');
    expect(source).toContain('disabled={!actions.payment_enabled}');
  });
});
