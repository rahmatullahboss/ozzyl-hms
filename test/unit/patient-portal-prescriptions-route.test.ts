import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeFile = resolve(__dirname, '../../src/routes/tenant/patientPortal.ts');

describe('tenant patient portal prescription routes', () => {
  it('keeps prescription list and detail patient-safe and final-only', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(source).toContain("patientPortalRoutes.get('/prescriptions'");
    expect(source).toContain("patientPortalRoutes.get('/prescriptions/:id'");
    expect(source).toContain("WHERE p.id = ? AND p.patient_id = ? AND p.tenant_id = ? AND p.status = 'final'");
    expect(source).toContain("await auditLog(c.env.DB, patientId, 'view_prescription_detail', tenantId)");
    expect(source).toContain('return c.json({ prescription, items: items ?? [], actions });');
  });

  it('filters replaced or void medicine items from patient detail actions and PDF output', () => {
    const source = readFileSync(routeFile, 'utf8');

    const itemFilterMatches = source.match(/LOWER\(COALESCE\(pi.status, 'active'\)\) NOT IN \('replaced', 'void', 'voided', 'cancelled', 'canceled', 'deleted'\)/g) ?? [];
    expect(itemFilterMatches).toHaveLength(2);
    expect(source).toContain('detail_url: `/api/patient-portal/prescriptions/${prescriptionId}`');
    expect(source).toContain('items_url: `/api/patient-portal/prescriptions/${prescriptionId}/items`');
    expect(source).toContain('pdf_url: `/api/patient-portal/prescriptions/${prescriptionId}/pdf`');
    expect(source).toContain('refill_url: `/api/patient-portal/prescriptions/${prescriptionId}/refill`');
  });

  it('uses the enterprise patient date-month-year format inside prescription PDFs', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(source).toContain('function formatPatientPortalDateMonthYear');
    expect(source).toContain('formatPatientPortalDateMonthYear(rx.created_at)');
    expect(source).toContain('formatPatientPortalDateMonthYear(rx.follow_up_date)');
    expect(source).not.toContain('new Date(rx.created_at).toLocaleDateString()');
    expect(source).not.toContain('new Date(rx.follow_up_date).toLocaleDateString()');
  });
});
