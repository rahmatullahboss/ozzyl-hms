import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('doctor module hot-path contracts', () => {
  it('keeps doctor dashboard on production-safe patient and clinical columns', () => {
    const source = readFileSync(resolve(__dirname, '../src/routes/tenant/doctors.ts'), 'utf-8');

    expect(source).not.toContain('pt.mobile_number');
    expect(source).not.toContain('FROM vitals vt');
    expect(source).toContain('p.mobile AS patient_mobile');
    expect(source).toContain('clinical_vitals vt');
    expect(source).toContain('order_status');
  });

  it('does not scrape external medicine sites during prescription autocomplete', () => {
    const source = readFileSync(resolve(__dirname, '../src/routes/tenant/ePrescribing.ts'), 'utf-8');

    expect(source).not.toContain('medex.com.bd');
    expect(source).toContain("source: row.tenant_id === tenantId ? 'local' : 'seed'");
    expect(source).toContain("source: 'bd_master'");
    expect(source).toContain('FROM master_drugs d');
  });
});
