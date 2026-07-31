import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PROTECTED_CORE_AUTHORITY_CONTRACT_PATH,
  buildProtectedCoreAuthorityContractFreeze,
  validateProtectedCoreAuthorityContractFreeze,
} from '../../scripts/canonical/protected-core-authority-contract-freeze';

const root = resolve(process.cwd());

function readGeneratedContract() {
  return JSON.parse(readFileSync(resolve(root, PROTECTED_CORE_AUTHORITY_CONTRACT_PATH), 'utf8'));
}

describe('CDB-V1-020 Canonical Core V1 authority and contract freeze', () => {
  it('freezes exactly one owner boundary for every protected concept', () => {
    const freeze = buildProtectedCoreAuthorityContractFreeze(root);

    expect(freeze.task).toBe('CDB-V1-020-CORE-V1-AUTHORITY-AND-CONTRACT-FREEZE');
    expect(freeze.summary.conceptContractCount).toBe(22);
    expect(freeze.summary.unresolvedDuplicateAuthorityCount).toBe(0);
    expect(freeze.summary.nonProductionScopeLeakageCount).toBe(0);
    expect(freeze.unresolvedDuplicateAuthorities).toEqual([]);
    expect(freeze.nonProductionScopeLeakage).toEqual([]);
    expect(validateProtectedCoreAuthorityContractFreeze(freeze, root)).toEqual([]);

    const conceptIds = freeze.concepts.map((contract) => contract.conceptId);
    expect(new Set(conceptIds).size).toBe(22);
    expect(conceptIds).toEqual([...conceptIds].sort((a, b) => a.localeCompare(b)));

    for (const contract of freeze.concepts) {
      expect(contract.authority.ownerId.length).toBeGreaterThan(0);
      expect(contract.authority.ownerKind).toMatch(/^(canonical_tables|governed_external_table|governed_registry)$/);
      expect(contract.commandBoundary.transactionBoundary.length).toBeGreaterThan(0);
      expect(contract.commandBoundary.idempotencyRule.length).toBeGreaterThan(0);
      expect(contract.commandBoundary.auditOutboxRule.length).toBeGreaterThan(0);
      expect(contract.providerBoundary.defaultMode).toMatch(/^(legacy|canonical|external)$/);
      expect(contract.providerBoundary.rollbackMode).toMatch(/^(legacy|canonical|external)$/);
      expect(contract.identityContract.length).toBeGreaterThan(0);
      expect(contract.statusContract.length).toBeGreaterThan(0);
      expect(contract.correctionContract.length).toBeGreaterThan(0);
      expect(contract.compatibilityContract.httpRoutes.length + contract.compatibilityContract.uiRoutes.length)
        .toBeGreaterThanOrEqual(0);
      expect(contract.migrationContract.secondPassRule).toContain('zero new business rows');
      expect(contract.retirementContract.physicalDeletionRequiresSeparateAuthorization).toBe(true);
    }
  });

  it('keeps governed external identity authorities external and reporting registry-owned', () => {
    const freeze = buildProtectedCoreAuthorityContractFreeze(root);
    const byId = new Map(freeze.concepts.map((contract) => [contract.conceptId, contract]));

    expect(byId.get('user_auth_actor')?.authority).toMatchObject({
      ownerKind: 'governed_external_table',
      ownerTables: ['users'],
    });
    expect(byId.get('patient_identity')?.authority).toMatchObject({
      ownerKind: 'governed_external_table',
      ownerTables: ['global_patient_identity'],
    });
    expect(byId.get('reporting_metric_read_promotion')?.authority).toMatchObject({
      ownerKind: 'governed_registry',
      ownerRegistry: 'docs/database/metric-registry.yaml',
    });

    expect(byId.get('user_auth_actor')?.commandBoundary.commandNames).not.toContain('createCanonicalUser');
    expect(byId.get('patient_identity')?.commandBoundary.commandNames).not.toContain('createCanonicalPatient');
  });

  it('freezes exact protected finance equations and immutable correction rules', () => {
    const freeze = buildProtectedCoreAuthorityContractFreeze(root);
    const byId = new Map(freeze.concepts.map((contract) => [contract.conceptId, contract]));

    expect(byId.get('invoice_document')?.moneyContract.equations).toContain(
      'invoice_net_minor = gross_minor - discount_minor + tax_minor',
    );
    expect(byId.get('payment_receipt_tender_allocation')?.moneyContract.equations).toContain(
      'receipt_unallocated_minor = receipt_amount_minor - sum(successful_allocation_minor)',
    );
    expect(byId.get('patient_deposit_liability')?.moneyContract.equations).toContain(
      'deposit_available_minor = deposited_minor - applied_minor - refunded_minor + reversed_refund_minor',
    );
    expect(byId.get('credit_refund_payment_reversal')?.moneyContract.equations).toContain(
      'net_refund_minor = refund_minor - refund_reversal_minor',
    );
    expect(byId.get('practitioner_compensation_settlement')?.moneyContract.equations).toContain(
      'settlement_unallocated_minor = settlement_total_minor - sum(settlement_allocation_minor)',
    );
    expect(byId.get('cash_custody')?.moneyContract.equations).toContain(
      'custody_balance_minor = opening_minor + inflow_minor - outflow_minor',
    );

    for (const conceptId of [
      'invoice_document',
      'payment_receipt_tender_allocation',
      'patient_deposit_liability',
      'credit_refund_payment_reversal',
      'practitioner_compensation_accrual_adjustment',
      'practitioner_compensation_settlement',
      'cash_custody',
    ]) {
      const contract = byId.get(conceptId);
      expect(contract?.moneyContract.unit).toBe('integer_minor_units');
      expect(contract?.moneyContract.unexplainedVarianceMinor).toBe(0);
      expect(contract?.correctionContract).toMatch(/append|reversal|replacement|immutable/i);
    }
  });

  it('binds every protected route family to a compatibility and provider rollback contract', () => {
    const freeze = buildProtectedCoreAuthorityContractFreeze(root);
    const httpRoutes = new Set(freeze.concepts.flatMap((contract) => contract.compatibilityContract.httpRoutes));
    const uiRoutes = new Set(freeze.concepts.flatMap((contract) => contract.compatibilityContract.uiRoutes));

    for (const route of [
      '/api/patients',
      '/api/appointments',
      '/api/reception',
      '/api/billing',
      '/api/payments',
      '/api/deposits',
      '/api/credit-notes',
      '/api/settlements',
      '/api/commissions',
      '/api/settings',
      '/api/access-control',
      '/api/audit',
    ]) expect(httpRoutes).toContain(route);

    for (const route of [
      '/h/:slug/reception/dashboard',
      '/h/:slug/reception/patients/new',
      '/h/:slug/reception/billing',
      '/h/:slug/reception/appointments',
      '/h/:slug/commissions',
      '/h/:slug/settings',
      '/h/:slug/access-control',
    ]) expect(uiRoutes).toContain(route);

    for (const contract of freeze.concepts) {
      expect(contract.providerBoundary.activationRequiresSeparateAuthorization).toBe(true);
      expect(contract.providerBoundary.productionEnabled).toBe(false);
      expect(contract.providerBoundary.rollbackRule).toContain('immediate');
    }
  });

  it('keeps the checked-in contract deterministic and current', () => {
    expect(existsSync(resolve(root, PROTECTED_CORE_AUTHORITY_CONTRACT_PATH))).toBe(true);
    expect(readGeneratedContract()).toEqual(buildProtectedCoreAuthorityContractFreeze(root));
  });
});
