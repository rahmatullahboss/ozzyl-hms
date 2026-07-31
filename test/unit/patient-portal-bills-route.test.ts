import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeFile = resolve(__dirname, '../../src/routes/tenant/patientPortal.ts');

describe('tenant patient portal bills route', () => {
  it('provides a patient-safe selected-hospital bill detail route', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(source).toContain("patientPortalRoutes.get('/bills/:id'");
    expect(source).toContain('WHERE id = ? AND patient_id = ? AND tenant_id = ?');
    expect(source).toContain('(total - paid) as due');
    expect(source).toContain('payment_enabled: false');
    expect(source).toContain('payment_message:');
    expect(source).toContain("await auditLog(c.env.DB, patientId, 'view_bill_detail', tenantId)");
    expect(source).toContain('return c.json({ bill, actions });');
    expect(source).toContain('receipt_url: null');
  });
});
