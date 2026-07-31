import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/tenant/patients.ts', 'utf8');
const start = source.indexOf("patientRoutes.post('/:id/chart/radiology-order'");
const end = source.indexOf("patientRoutes.post('/:id/chart/follow-up'", start);
const route = source.slice(start, end > start ? end : undefined);
const primaryRadiology = readFileSync('src/routes/tenant/radiology/orders.ts', 'utf8');

describe('patient chart radiology canonical billing source contract', () => {
  it('integrates quick radiology billing through the strict financial coordinator', () => {
    expect(route).toContain('executeStrictFinancialMutation');
    expect(route).toContain("boundary: 'patient-chart.radiology-billing.create'");
    expect(route).toContain('executePatientChartRadiologyOriginalLegacy');
    expect(route).toContain('preparePatientChartRadiologyStrictContext');
    expect(route).toContain('preparePatientChartRadiologyStrictStatements');
    expect(route).toContain('strictAuthoritativeStatements: async () =>');
    expect(route).not.toContain("assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(requireTenantId(c)), 'patient-chart.radiology-billing.create')");
    expect(route).not.toMatch(/INSERT INTO radiology_requisitions/i);
    expect(route).not.toMatch(/INSERT INTO bills/i);
    expect(route).not.toMatch(/INSERT INTO invoice_items/i);
  });

  it('keeps canonical projection lazy and passes guarded legacy authority to the composite command', () => {
    const callback = route.indexOf('canonical: async (execution) => {');
    const command = route.indexOf('createRadiologyRequisitionBilling(c.env.DB', callback);
    const totalMinor = route.indexOf('totalMinor:', callback);

    expect(callback).toBeGreaterThan(-1);
    expect(command).toBeGreaterThan(callback);
    expect(totalMinor).toBeGreaterThan(command);
    expect(route.indexOf('createRadiologyRequisitionBilling(c.env.DB')).toBe(command);
    expect(route).toContain('authoritativeStatements: execution.authoritativeStatements');
  });

  it('resolves committed identities and preserves accounting behavior by mode', () => {
    const coordinator = route.indexOf('executeStrictFinancialMutation');
    const resolveRequisition = route.indexOf('SELECT id FROM radiology_requisitions', coordinator);
    const resolveBill = route.indexOf('SELECT id FROM bills', coordinator);
    const sideEffects = route.indexOf('recordBillFinalizationSideEffects', coordinator);

    expect(resolveRequisition).toBeGreaterThan(coordinator);
    expect(resolveBill).toBeGreaterThan(coordinator);
    expect(sideEffects).toBeGreaterThan(resolveBill);
    expect(route).toContain("skipBillAccountingEvent: financialExecution.mode === 'strict'");
    expect(route).toContain('canonicalSourceLineId: buildLegacyLiveInvoiceSourceLineId');
    expect(route).toContain('referenceId: context.imagingItem.billingServiceItemId');
  });

  it('keeps the primary RIS boundary on its dedicated original and strict adapter', () => {
    expect(primaryRadiology).toContain("boundary: 'radiology.billing.create'");
    expect(primaryRadiology).toContain('executeRadiologyOrderOriginalLegacy');
    expect(primaryRadiology).toContain('prepareRadiologyOrderStrictContext');
    expect(primaryRadiology).not.toContain('assertStrictFinancialBoundaryDisabledOrSupported');
  });
});
