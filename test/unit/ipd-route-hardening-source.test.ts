import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const admissionsSource = readFileSync(join(process.cwd(), 'src/routes/tenant/admissions.ts'), 'utf8');
const ipBillingSource = readFileSync(join(process.cwd(), 'src/routes/tenant/ipBilling.ts'), 'utf8');
const billingProvisionalSource = readFileSync(join(process.cwd(), 'src/routes/tenant/billingProvisional.ts'), 'utf8');
const ipdReportsSource = readFileSync(join(process.cwd(), 'src/routes/tenant/ipdReports.ts'), 'utf8');
const indexSource = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf8');
const indexJsSource = readFileSync(join(process.cwd(), 'src/index.js'), 'utf8');
const routePermissionsSource = readFileSync(join(process.cwd(), 'src/lib/route-permissions.ts'), 'utf8');
const routePermissionsJsSource = readFileSync(join(process.cwd(), 'src/lib/route-permissions.js'), 'utf8');
const ipBillingPageSource = readFileSync(join(process.cwd(), 'web/src/pages/IPBillingPage.tsx'), 'utf8');
const apiClientSource = readFileSync(join(process.cwd(), 'web/src/lib/apiClient.ts'), 'utf8');
const adminSidebarSource = readFileSync(join(process.cwd(), 'web/src/components/dashboard/adminSidebarConfig.tsx'), 'utf8');
const appSource = readFileSync(join(process.cwd(), 'web/src/App.tsx'), 'utf8');
const sidebarSource = readFileSync(join(process.cwd(), 'web/src/components/dashboard/Sidebar.tsx'), 'utf8');
const drawerServicesSource = readFileSync(join(process.cwd(), 'web/src/components/nursing/DrawerServicesTab.tsx'), 'utf8');
const queryKeysSource = readFileSync(join(process.cwd(), 'web/src/lib/queryKeys.ts'), 'utf8');
const doctorRoundSource = readFileSync(join(process.cwd(), 'web/src/components/ipd/DoctorRoundForm.tsx'), 'utf8');
const breadcrumbsSource = readFileSync(join(process.cwd(), 'web/src/components/dashboard/Breadcrumbs.tsx'), 'utf8');
const pageHelpSource = readFileSync(join(process.cwd(), 'web/src/components/PageHelpButton.tsx'), 'utf8');
const workerRoutesTestSource = readFileSync(join(process.cwd(), 'test/workers/all-routes.test.ts'), 'utf8');
const nursingSmokeSource = readFileSync(join(process.cwd(), 'test/e2e/smoke/nursing-smoke.spec.ts'), 'utf8');
const nursingWorkflowSource = readFileSync(join(process.cwd(), 'test/e2e/workflows/nursing-flow.spec.ts'), 'utf8');

describe('IPD route hardening source guards', () => {
  it('tenant-scopes admission patient/bed/doctor joins used by sensitive reads', () => {
    expect(admissionsSource.match(/LEFT JOIN patients p ON a\.patient_id = p\.id AND p\.tenant_id = a\.tenant_id/g)?.length).toBeGreaterThanOrEqual(4);
    expect(admissionsSource.match(/LEFT JOIN beds b ON a\.bed_id = b\.id AND b\.tenant_id = a\.tenant_id/g)?.length).toBeGreaterThanOrEqual(4);
    expect(admissionsSource.match(/LEFT JOIN doctors d ON a\.doctor_id = d\.id AND d\.tenant_id = a\.tenant_id/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('prevents IPD provisional charges from being posted to a mismatched admission patient', () => {
    expect(ipBillingSource).toContain('patient_id does not match admission_id');
    expect(ipBillingSource).toContain('Cannot add IPD provisional charge to an inactive admission');
    expect(billingProvisionalSource).toContain('patient_id does not match admission_id');
    expect(billingProvisionalSource).toContain('Cannot add provisional charge to an inactive admission');
  });

  it('uses atomic bed locking and audit logs for IPD transfer state changes', () => {
    expect(admissionsSource).toContain('const transferResult = await lockBedForTransfer');
    expect(admissionsSource).toContain("transfer_status: 'pending_receive'");
    expect(admissionsSource).toContain("transfer_status: 'completed'");
  });

  it('guards high-risk IPD clinical and configuration endpoints with explicit roles', () => {
    expect(admissionsSource).toContain('IPD_ADMIN_CONFIG_ROLES');
    expect(admissionsSource).toContain('IPD_CLINICAL_RECORD_ROLES');
    expect(admissionsSource).toContain('Not authorized to update police-case flag');
    expect(admissionsSource).toContain('Not authorized to manage IPD billing configuration');
  });

  it('blocks generic admission status mutations from bypassing dedicated workflows', () => {
    expect(admissionsSource).toContain('Use the dedicated transfer or discharge workflow for this admission status');
    expect(admissionsSource).toContain('Only doctor/admin can change IPD clinical status');
    expect(admissionsSource).toContain('Invalid admission status transition');
  });

  it('opens IPD HTML print endpoints through authenticated frontend fetch, not direct API window.open', () => {
    expect(apiClientSource).toContain('export async function apiTextFetch');
    expect(apiClientSource).toContain('text: (path: string');
    expect(ipBillingPageSource).toContain('openAuthenticatedHtmlPrint');
    expect(ipBillingPageSource).toContain('api.text(path)');
  });

  it('keeps admin IPD monitoring routes discoverable from the compact sidebar', () => {
    expect(adminSidebarSource).toContain("path: 'admissions'");
    expect(adminSidebarSource).toContain("path: 'ip-billing'");
    expect(adminSidebarSource).toContain("path: 'ipd-reports'");
  });

  it('removes the legacy standalone IPDCharges page from active routing and navigation', () => {
    expect(existsSync(join(process.cwd(), 'web/src/pages/IPDCharges.tsx'))).toBe(false);
    expect(appSource).not.toContain('IPDCharges');
    expect(appSource).not.toContain('ipd-charges');
    expect(sidebarSource).not.toContain('ipdCharges');
    expect(sidebarSource).not.toContain('ipd-charges');
  });

  it('removes the legacy IPD charges API route and permission alias', () => {
    expect(existsSync(join(process.cwd(), 'src/routes/tenant/ipdCharges.ts'))).toBe(false);
    expect(indexSource).not.toContain('ipdChargeRoutes');
    expect(indexSource).not.toContain('/api/ipd-charges');
    expect(indexJsSource).not.toContain('ipdChargeRoutes');
    expect(indexJsSource).not.toContain('/api/ipd-charges');
    expect(routePermissionsSource).not.toContain('/api/ipd-charges');
    expect(routePermissionsJsSource).not.toContain('/api/ipd-charges');
  });

  it('routes nursing service charges through canonical provisional billing', () => {
    expect(drawerServicesSource).toContain('/api/billing-provisional');
    expect(drawerServicesSource).toContain("item_category: 'nursing_service'");
    expect(drawerServicesSource).toContain('unit_price: unitPrice');
    expect(drawerServicesSource).toContain('queryKeys.billing.pending(bed.admission_id)');
    expect(drawerServicesSource).not.toContain('/api/ipd-charges');
    expect(queryKeysSource).not.toContain('ipdCharges');
    expect(doctorRoundSource).not.toContain('ipdCharges');
    expect(breadcrumbsSource).not.toContain('ipd-charges');
    expect(pageHelpSource).not.toContain('ipd-charges');
  });

  it('keeps smoke and workflow tests pointed at canonical provisional billing', () => {
    expect(workerRoutesTestSource).not.toContain('/api/ipd-charges');
    expect(workerRoutesTestSource).toContain('/api/billing-provisional');
    expect(nursingSmokeSource).not.toContain('/api/ipd-charges');
    expect(nursingSmokeSource).toContain('/api/billing-provisional');
    expect(nursingWorkflowSource).not.toContain('/api/ipd-charges');
    expect(nursingWorkflowSource).toContain('/api/billing-provisional');
  });

  it('builds IPD revenue reports from canonical provisional and bed-charge sources', () => {
    expect(ipdReportsSource).toContain('billing_provisional_items');
    expect(ipdReportsSource).toContain('patient_bed_infos');
    expect(ipdReportsSource).toContain("'bed_charge' AS type");
    expect(ipdReportsSource).not.toContain('FROM ipd_charges');
  });
});
