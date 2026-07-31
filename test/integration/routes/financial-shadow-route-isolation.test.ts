import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function functionSection(file: string, startMarker: string, endMarker: string): string {
  const start = file.indexOf(startMarker);
  const end = file.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Could not locate ${startMarker}`);
  return file.slice(start, end);
}

describe('financial shadow route isolation', () => {
  it('keeps appointment shadow authority on the original legacy SQL only', () => {
    const route = source('src/routes/tenant/appointments.ts');
    const adapter = source('src/lib/canonical/appointment-billing-finalization.ts');

    expect(route).toContain('prepareAppointmentBillingLegacyStatements');
    expect(adapter).toContain('Object.defineProperties(originalLegacyStatements');
    expect(adapter).toContain('strictAuthoritativeStatements:');
    expect(adapter).toContain('value: () => prepareAppointmentBillingServiceStrictStatements');
    expect(adapter).toContain('legacyPostCommit:');

    const originalLegacy = functionSection(
      adapter,
      'export function prepareAppointmentBillingOriginalLegacyStatements(',
      'export function prepareAppointmentBillingStrictStatements(',
    );
    expect(originalLegacy).not.toContain('prepareFinancialBatchAssertion');
    expect(originalLegacy).not.toContain('canonical_financial_batch_assertions');
    expect(originalLegacy).not.toContain('accounting_posting_events');
    expect(originalLegacy).not.toContain('changes()');
  });

  it('keeps provisional billing shadow authority on the original legacy SQL only', () => {
    const route = source('src/routes/tenant/billingProvisional.ts');
    const adapter = source('src/lib/canonical/provisional-billing-finalization.ts');

    expect(route).toContain('prepareProvisionalBillingLegacyStatements');
    expect(adapter).toContain('Object.defineProperties(originalLegacyStatements');
    expect(adapter).toContain('strictAuthoritativeStatements:');
    expect(adapter).toContain('value: () => prepareProvisionalBillingStrictStatements');
    expect(adapter).toContain('legacyPostCommit:');

    const originalLegacy = functionSection(
      adapter,
      'export function prepareProvisionalBillingOriginalLegacyStatements(',
      'export function prepareProvisionalBillingStrictStatements(',
    );
    expect(originalLegacy).not.toContain('prepareFinancialBatchAssertion');
    expect(originalLegacy).not.toContain('canonical_financial_batch_assertions');
    expect(originalLegacy).not.toContain('accounting_posting_events');
    expect(originalLegacy).not.toContain('changes()');
  });

  it('keeps IPD discharge shadow authority on the untouched route batch', () => {
    const route = source('src/routes/tenant/ipBilling.ts');
    const adapter = source('src/lib/canonical/ipd-discharge-billing-finalization.ts');

    expect(route).toContain('prepareIpdDischargeLegacyStatements');
    expect(adapter).toContain("Object.defineProperty(originalLegacyStatements, 'strictAuthoritativeStatements'");
    expect(adapter).toContain('const originalLegacyStatements = [...input.statements]');
    expect(adapter).toContain('value: buildStrictAuthoritativeStatements');
    expect(adapter).toContain('return { statements: originalLegacyStatements, resultIndexByOriginalIndex }');
  });

  it('keeps lab shadow authority on the original direct inserts and dependent batch', () => {
    const route = source('src/routes/tenant/lab.ts');
    const adapter = source('src/lib/canonical/lab-billing-finalization.ts');

    expect(route).toContain('legacyExecutor: () => executeLabBillingOriginalLegacy');
    expect(route).toContain('const strictAuthoritativeStatements = () =>');
    expect(route).toContain('strictAuthoritativeStatements,');
    expect(route).not.toContain('legacyStatements: preparedLegacy.statements');

    const originalLegacy = functionSection(
      adapter,
      'export async function executeLabBillingOriginalLegacy(',
      'export function prepareLabBillingStrictStatements(',
    );
    expect(originalLegacy).not.toContain('prepareFinancialBatchAssertion');
    expect(originalLegacy).not.toContain('canonical_financial_batch_assertions');
    expect(originalLegacy).not.toContain('billing_service_items');
    expect(originalLegacy).not.toContain('lab_test_catalog');
    expect(originalLegacy).not.toContain('changes()');
  });

  it('keeps patient-chart lab shadow authority on the original quick-order workflow', () => {
    const route = source('src/routes/tenant/patients.ts');
    const adapter = source('src/lib/canonical/patient-chart-lab-billing.ts');

    expect(route).toContain('legacyExecutor: async () =>');
    expect(route).toContain('executePatientChartLabOrderOriginalLegacy');
    expect(route).toContain('strictAuthoritativeStatements: async () =>');
    expect(route).toContain('preparePatientChartLabOrderStrictContext');

    const originalLegacy = functionSection(
      adapter,
      'export async function executePatientChartLabOrderOriginalLegacy(',
      'export async function preparePatientChartLabOrderStrictContext(',
    );
    expect(originalLegacy).toContain('notes, ordered_by, tenant_id');
    expect(originalLegacy).toContain('instructions, notes, tenant_id, source');
    expect(originalLegacy).not.toContain('prepareFinancialBatchAssertion');
    expect(originalLegacy).not.toContain('canonical_financial_batch_assertions');
    expect(originalLegacy).not.toContain('billing_service_items');
    expect(originalLegacy).not.toContain('lab_test_catalog');
    expect(originalLegacy).not.toContain('changes()');
    expect(originalLegacy).not.toContain('visit_services');
  });

  it('keeps patient-chart radiology shadow authority on the original free-text workflow', () => {
    const route = source('src/routes/tenant/patients.ts');
    const adapter = source('src/lib/canonical/patient-chart-radiology-billing.ts');

    expect(route).toContain('executePatientChartRadiologyOriginalLegacy');
    expect(route).toContain('strictAuthoritativeStatements: async () =>');
    expect(route).toContain('preparePatientChartRadiologyStrictContext');

    const originalLegacy = functionSection(
      adapter,
      'export async function executePatientChartRadiologyOriginalLegacy(',
      'export async function preparePatientChartRadiologyStrictContext(',
    );
    expect(originalLegacy).toContain('requisition_remarks, urgency, order_status, created_by');
    expect(originalLegacy).toContain("context.total <= 0 ? 'paid' : 'open'");
    expect(originalLegacy).not.toContain('prepareFinancialBatchAssertion');
    expect(originalLegacy).not.toContain('canonical_financial_batch_assertions');
    expect(originalLegacy).not.toContain('billing_service_items');
    expect(originalLegacy).not.toContain('radiology_imaging_items');
    expect(originalLegacy).not.toContain('changes()');
    expect(originalLegacy).not.toContain('visit_services');
  });

  it('keeps primary RIS radiology shadow authority on the original full-shape workflow', () => {
    const route = source('src/routes/tenant/radiology/orders.ts');
    const adapter = source('src/lib/canonical/radiology-order-billing.ts');

    expect(route).toContain('executeRadiologyOrderOriginalLegacy');
    expect(route).toContain('strictAuthoritativeStatements: async () =>');
    expect(route).toContain('prepareRadiologyOrderStrictContext');

    const originalLegacy = functionSection(
      adapter,
      'export async function executeRadiologyOrderOriginalLegacy(',
      'async function assertStrictCatalogAuthority(',
    );
    expect(originalLegacy).toContain('visit_id, admission_id, imaging_type_id, imaging_type_name');
    expect(originalLegacy).toContain('ward_name, has_insurance, order_status, created_by');
    expect(originalLegacy).toContain("context.total <= 0 ? 'paid' : 'open'");
    expect(originalLegacy).not.toContain('prepareFinancialBatchAssertion');
    expect(originalLegacy).not.toContain('canonical_financial_batch_assertions');
    expect(originalLegacy).not.toContain('canonical_service_');
    expect(originalLegacy).not.toContain('canonical_invoice');
    expect(originalLegacy).not.toContain('billing_service_items');
    expect(originalLegacy).not.toContain('changes()');
  });

  it('keeps reception visit billing shadow authority on the original conditional-claim workflow', () => {
    const route = source('src/routes/tenant/reception.ts');
    const adapter = source('src/lib/canonical/reception-visit-billing.ts');

    expect(route).toContain('executeReceptionVisitBillingOriginalLegacy');
    expect(route).toContain('strictAuthoritativeStatements: async () =>');
    expect(route).toContain('prepareReceptionVisitBillingStrictContext');

    const originalLegacy = functionSection(
      adapter,
      'function originalLegacyStatements(',
      'type StrictEncounterMappingRow',
    );
    expect(originalLegacy).toContain("SET status = 'billing'");
    expect(originalLegacy).toContain('INSERT INTO bills');
    expect(originalLegacy).toContain('INSERT INTO bill_discount_allocations');
    expect(originalLegacy).toContain('INSERT INTO invoice_items');
    expect(originalLegacy).toContain("SET status = 'pending'");
    expect(originalLegacy).not.toContain('prepareFinancialBatchAssertion');
    expect(originalLegacy).not.toContain('canonical_financial_batch_assertions');
    expect(originalLegacy).not.toContain('canonical_service_');
    expect(originalLegacy).not.toContain('canonical_invoice');
    expect(originalLegacy).not.toContain('billing_service_departments');
    expect(originalLegacy).not.toContain('changes()');
  });

  it('keeps pharmacy shadow authority on the two original stock-first workflows', () => {
    const route = source('src/routes/tenant/pharmacy/advanced.ts');
    const provisional = source('src/lib/canonical/pharmacy-provisional-finalization.ts');
    const prescription = source('src/lib/canonical/pharmacy-prescription-finalization.ts');

    expect(route).toContain('executePharmacyProvisionalOriginalLegacy');
    expect(route).toContain('executePharmacyPrescriptionOriginalLegacy');
    expect(route).toContain('strictAuthoritativeStatements: async () =>');

    const originalProvisional = functionSection(
      provisional,
      'export async function executePharmacyProvisionalOriginalLegacy(',
      'export async function preparePharmacyProvisionalStrictContext(',
    );
    const originalPrescription = functionSection(
      prescription,
      'export async function executePharmacyPrescriptionOriginalLegacy(',
      'export async function preparePharmacyPrescriptionStrictContext(',
    );
    for (const originalLegacy of [originalProvisional, originalPrescription]) {
      expect(originalLegacy).toContain('available_qty = available_qty -');
      expect(originalLegacy).toContain('available_qty = available_qty +');
      expect(originalLegacy).not.toContain('prepareFinancialBatchAssertion');
      expect(originalLegacy).not.toContain('canonical_financial_batch_assertions');
      expect(originalLegacy).not.toContain('canonical_inventory_');
      expect(originalLegacy).not.toContain('canonical_service_');
      expect(originalLegacy).not.toContain('changes()');
    }
  });

  it('keeps gateway shadow authority on the original payment settlement batch', () => {
    const route = source('src/routes/tenant/payments.ts');
    const adapter = source('src/lib/canonical/gateway-payment-verification.ts');

    expect(route).toContain('prepareGatewayPaymentLegacyStatements');
    expect(adapter).toContain('Object.defineProperties(originalLegacyStatements');
    expect(adapter).toContain('value: () => prepareGatewayPaymentStrictStatements');
    expect(adapter).toContain('legacyPostCommit:');

    const originalLegacy = functionSection(
      adapter,
      'export function prepareGatewayPaymentOriginalLegacyStatements(',
      'export function prepareGatewayPaymentStrictStatements(',
    );
    expect(originalLegacy).not.toContain('prepareFinancialBatchAssertion');
    expect(originalLegacy).not.toContain('canonical_financial_batch_assertions');
    expect(originalLegacy).not.toContain('accounting_posting_events');
    expect(originalLegacy).not.toContain('changes()');
  });

  it('keeps settlement shadow authority on the original multi-bill allocation batch', () => {
    const route = source('src/routes/tenant/settlements.ts');
    const adapter = source('src/lib/canonical/settlement-finalization.ts');

    expect(route).toContain('executeSettlementOriginalLegacy');
    expect(route).toContain('strictAuthoritativeStatements: async () =>');
    expect(route).toContain('prepareSettlementStrictContext');

    const originalLegacy = functionSection(
      adapter,
      'function originalLegacyStatements(',
      'export async function executeSettlementOriginalLegacy(',
    );
    expect(originalLegacy).toContain('INSERT INTO billing_settlements');
    expect(originalLegacy).toContain('UPDATE bills');
    expect(originalLegacy).toContain('INSERT INTO payments');
    expect(originalLegacy).toContain('INSERT INTO billing_deposits');
    expect(originalLegacy).toContain('INSERT INTO bill_discount_allocations');
    expect(originalLegacy).toContain('INSERT INTO emp_cash_transactions');
    expect(originalLegacy).toContain('INSERT OR IGNORE INTO accounting_posting_events');
    expect(originalLegacy).not.toContain('prepareFinancialBatchAssertion');
    expect(originalLegacy).not.toContain('canonical_financial_batch_assertions');
    expect(originalLegacy).not.toContain('canonical_payment_');
    expect(originalLegacy).not.toContain('canonical_deposit');
    expect(originalLegacy).not.toContain('canonical_credit_note');
    expect(originalLegacy).not.toContain('canonical_invoice');
    expect(originalLegacy).not.toContain('changes()');
  });
});
