import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routeFile = resolve(__dirname, '../../src/routes/tenant/patientPortal.ts');

describe('tenant patient portal lab result routes', () => {
  it('provides a patient-safe lab result detail route with released-status guards', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(source).toContain("patientPortalRoutes.get('/lab-results/:id'");
    expect(source).toContain("LOWER(COALESCE(lo.status, '')) IN ('verified', 'released', 'completed', 'final')");
    expect(source).toContain("LOWER(COALESCE(loi.sample_status, '')) NOT IN ('draft', 'pending', 'unverified', 'preliminary', 'cancelled', 'canceled', 'void', 'voided')");
    expect(source).toContain("await auditLog(c.env.DB, patientId, 'view_lab_result_detail', tenantId)");
    expect(source).toContain('pdf_url: `/api/patient-portal/lab-results/${orderId}/pdf`');
    expect(source).toContain('share_text: `Lab result ${String(order.order_no ?? orderId)}`');
    expect(source).toContain('return c.json({ order, items: enrichedItems, actions });');
  });

  it('hardens lab result PDF output with the same status filters and patient date format', () => {
    const source = readFileSync(routeFile, 'utf8');

    expect(source).toContain('formatPatientPortalDateMonthYear(order.created_at)');
    expect(source).not.toContain('order.created_at ? new Date(order.created_at).toLocaleDateString()');
    expect((source.match(/LOWER\(COALESCE\(lo\.status, ''\)\) IN \('verified', 'released', 'completed', 'final'\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect((source.match(/LOWER\(COALESCE\(loi\.sample_status, ''\)\) NOT IN \('draft', 'pending', 'unverified', 'preliminary', 'cancelled', 'canceled', 'void', 'voided'\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("await auditLog(c.env.DB, patientId, 'download_lab_pdf', tenantId)");
  });
});
