import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateCommissionRefundImpact } from '../src/lib/billing-refund-commission';

type DriftEntry = {
  filename: string;
  disposition: 'abandoned' | 'superseded' | 'active_compatibility_recovery_ledger_pending_canonical_retirement';
  productionLedgerRecorded: false;
  productionSchemaEffect: 'absent' | 'present' | 'superseded_equivalent_present';
  replacementMigrations: string[];
  orphanObjects: string[];
  activeCompatibilityObjects?: string[];
  retirementGates?: string[];
  currentRuntimeAuthority: boolean;
  action: 'do_not_apply' | 'preserve_active_compatibility_until_canonical_retirement';
};

type DriftRegistry = {
  version: 2;
  incidentId: string;
  productionMutationPerformed: false;
  entries: DriftEntry[];
};

const root = process.cwd();
const registryPath = join(root, 'docs/database/production-schema-drift-disposition.json');
const dirtyRootMigrations = [
  '0424_canonical_financial_reconciliation.sql',
  '0425_canonical_cash_ledger_event_identity.sql',
  '0426_canonical_cash_ledger_business_date.sql',
  '0427_financial_event_outbox.sql',
  '0428_shift_closing_canonical_evidence.sql',
  '0429_financial_provider_config_backfill.sql',
  '0430_doctor_commission_ledger_hardening.sql',
  '0431_doctor_commission_settlement_accounting.sql',
  '0432_lab_test_commission_eligibility.sql',
] as const;

function registry(): DriftRegistry {
  return JSON.parse(readFileSync(registryPath, 'utf8')) as DriftRegistry;
}

describe('production schema drift disposition', () => {
  it('records one reviewed disposition for every dirty-root migration', () => {
    const entries = registry().entries;
    expect(entries.map((entry) => entry.filename).sort()).toEqual([...dirtyRootMigrations].sort());
    expect(new Set(entries.map((entry) => entry.filename)).size).toBe(dirtyRootMigrations.length);
    expect(entries.every((entry) => entry.productionLedgerRecorded === false)).toBe(true);
  });

  it('keeps every old dirty-root SQL file out of the reviewed migration chain', () => {
    for (const entry of registry().entries) {
      expect(existsSync(join(root, 'migrations', entry.filename))).toBe(false);
      if (entry.disposition === 'active_compatibility_recovery_ledger_pending_canonical_retirement') {
        expect(entry.currentRuntimeAuthority).toBe(true);
        expect(entry.action).toBe('preserve_active_compatibility_until_canonical_retirement');
      } else {
        expect(entry.currentRuntimeAuthority).toBe(false);
        expect(entry.action).toBe('do_not_apply');
      }
    }
  });

  it('keeps every superseded replacement migration present', () => {
    const superseded = registry().entries.filter((entry) => entry.disposition === 'superseded');
    expect(superseded.length).toBeGreaterThan(0);
    for (const entry of superseded) {
      expect(entry.replacementMigrations.length).toBeGreaterThan(0);
      for (const filename of entry.replacementMigrations) {
        expect(existsSync(join(root, 'migrations', filename))).toBe(true);
      }
    }
  });

  it('classifies the recovery tables as active compatibility authority with explicit retirement gates', () => {
    const entries = registry().entries.filter((entry) =>
      entry.disposition === 'active_compatibility_recovery_ledger_pending_canonical_retirement');
    expect(entries.map((entry) => entry.filename).sort()).toEqual([
      '0430_doctor_commission_ledger_hardening.sql',
      '0431_doctor_commission_settlement_accounting.sql',
    ]);
    expect(entries.every((entry) => entry.productionSchemaEffect === 'present')).toBe(true);
    expect(entries.every((entry) => (entry.activeCompatibilityObjects?.length ?? 0) > 0)).toBe(true);
    expect(entries.every((entry) => (entry.retirementGates?.length ?? 0) > 0)).toBe(true);
    expect(entries.every((entry) => entry.currentRuntimeAuthority)).toBe(true);
    expect(entries.every((entry) => entry.action === 'preserve_active_compatibility_until_canonical_retirement')).toBe(true);
  });

  it('preserves the reviewed paid-commission refund blocking policy', () => {
    const result = calculateCommissionRefundImpact({
      commissionBaseAmount: 400,
      commissionRateBps: 2500,
      commissionFlatAmount: 0,
      earnedCommissionAmount: 100,
      doctorWaiverAmount: 0,
      payableCommissionAmount: 100,
      paidAmount: 100,
      allocatedRefundAmount: 200,
      itemRefundableBalance: 400,
    });
    expect(result.blockedReason).toMatch(/already paid/i);
  });
});
