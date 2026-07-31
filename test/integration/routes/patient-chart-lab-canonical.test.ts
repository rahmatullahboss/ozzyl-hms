import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/routes/tenant/patients.ts', 'utf8');
const start = source.indexOf("patientRoutes.post('/:id/chart/lab-order'");
const end = source.indexOf("patientRoutes.post('/:id/chart/radiology-order'", start);
const route = source.slice(start, end > start ? end : undefined);

describe('patient chart lab canonical billing source contract', () => {
  it('integrates quick lab billing through the strict financial coordinator', () => {
    expect(route).toContain('executeStrictFinancialMutation');
    expect(route).toContain("boundary: 'patient-chart.lab-billing.create'");
    expect(route).toContain('executePatientChartLabOrderOriginalLegacy');
    expect(route).toContain('preparePatientChartLabOrderStrictContext');
    expect(route).toContain('preparePatientChartLabOrderStrictStatements');
    expect(route).toContain('strictAuthoritativeStatements: async () =>');
    expect(route).not.toContain("assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(requireTenantId(c)), 'patient-chart.lab-billing.create')");
    expect(route).not.toMatch(/INSERT INTO lab_orders/i);
    expect(route).not.toMatch(/INSERT INTO bills/i);
    expect(route).not.toMatch(/INSERT INTO invoice_items/i);
  });

  it('keeps canonical projection lazy and passes the guarded legacy batch to the command', () => {
    const callback = route.indexOf('canonical: async (execution) => {');
    const command = route.indexOf('createLabOrderBilling(c.env.DB', callback);
    const itemMapping = route.indexOf('grossMinor:', callback);

    expect(callback).toBeGreaterThan(-1);
    expect(itemMapping).toBeGreaterThan(callback);
    expect(command).toBeGreaterThan(itemMapping);
    expect(route.indexOf('createLabOrderBilling(c.env.DB')).toBe(command);
    expect(route).toContain('authoritativeStatements: execution.authoritativeStatements');
  });

  it('resolves committed identities and preserves post-commit side effects', () => {
    const coordinator = route.indexOf('executeStrictFinancialMutation');
    const resolveOrder = route.indexOf('SELECT id FROM lab_orders', coordinator);
    const resolveBill = route.indexOf('SELECT id FROM bills', coordinator);
    const reserve = route.indexOf('recordBillFinalizationSideEffects', coordinator);
    const commission = route.indexOf('accrueLabOrderDoctorCommissions', coordinator);

    expect(resolveOrder).toBeGreaterThan(coordinator);
    expect(resolveBill).toBeGreaterThan(coordinator);
    expect(reserve).toBeGreaterThan(resolveBill);
    expect(commission).toBeGreaterThan(reserve);
    expect(route).toContain("skipBillAccountingEvent: financialExecution.mode === 'strict'");
    expect(route).not.toMatch(/visit_services/i);
  });
});
