import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';
import {
  provideCompensationAccrualRead,
  resolveCompensationAccrualProviderMode,
} from '../../src/lib/canonical/contracts/compensation-accrual-provider';

function harness() {
  const h = createSqliteD1Harness();
  h.sqlite.exec(`
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      canonical_source_key TEXT,
      doctor_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      status TEXT NOT NULL,
      accrued_date TEXT,
      commission_amount REAL NOT NULL DEFAULT 0,
      earned_commission_amount REAL NOT NULL DEFAULT 0,
      doctor_waiver_amount REAL NOT NULL DEFAULT 0,
      payable_commission_amount REAL NOT NULL DEFAULT 0,
      paid_amount REAL NOT NULL DEFAULT 0,
      balance_amount REAL NOT NULL DEFAULT 0
    );
  `);
  h.sqlite.prepare(`
    INSERT INTO doctor_commission_accruals (
      id,tenant_id,canonical_source_key,doctor_id,source_type,status,accrued_date,
      commission_amount,earned_commission_amount,doctor_waiver_amount,
      payable_commission_amount,paid_amount,balance_amount
    ) VALUES (1,'tenant-a','acc-source-1',7,'lab_test','approved','2026-07-30',
      120.50,120.50,20.25,100.25,0,100.25)
  `).run();
  return h;
}

function addCanonicalTables(h: ReturnType<typeof harness>) {
  h.sqlite.exec(`
    CREATE TABLE canonical_feature_flags (
      tenant_id TEXT NOT NULL,
      flag_key TEXT NOT NULL,
      mode TEXT NOT NULL,
      is_enabled INTEGER NOT NULL,
      PRIMARY KEY (tenant_id,flag_key)
    );
    CREATE TABLE canonical_source_mappings (
      tenant_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      canonical_public_id TEXT,
      source_type TEXT NOT NULL,
      source_public_id TEXT NOT NULL,
      source_table TEXT NOT NULL,
      mapping_status TEXT NOT NULL,
      mapping_version INTEGER NOT NULL,
      PRIMARY KEY (tenant_id,entity_type,source_type,source_public_id)
    );
    CREATE TABLE canonical_compensation_accruals (
      tenant_id TEXT NOT NULL,
      accrual_public_id TEXT NOT NULL,
      practitioner_public_id TEXT,
      practitioner_role TEXT NOT NULL,
      accrual_stage TEXT NOT NULL,
      currency_code TEXT NOT NULL,
      earned_minor INTEGER NOT NULL,
      adjusted_minor INTEGER NOT NULL,
      settled_minor INTEGER NOT NULL,
      payable_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      business_date TEXT NOT NULL,
      PRIMARY KEY (tenant_id,accrual_public_id)
    );
    CREATE TABLE canonical_reconciliation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      run_public_id TEXT NOT NULL,
      migration_run_id INTEGER,
      domain TEXT NOT NULL,
      reconciliation_type TEXT NOT NULL,
      status TEXT NOT NULL,
      scanned_count INTEGER NOT NULL,
      matched_count INTEGER NOT NULL,
      mismatch_count INTEGER NOT NULL,
      exception_count INTEGER NOT NULL,
      expected_total_minor INTEGER,
      actual_total_minor INTEGER,
      variance_minor INTEGER,
      currency_code TEXT,
      evidence_sha256 TEXT,
      result_summary_json TEXT,
      started_at_utc TEXT NOT NULL,
      completed_at_utc TEXT,
      created_at_utc TEXT,
      updated_at_utc TEXT,
      UNIQUE (tenant_id,run_public_id)
    );
  `);
}

const evidence = {
  tenantId: 'tenant-a',
  legacyAccrualId: 1,
  consumerId: 'cdb040c.commission-accrual-admin',
  observedAtUtc: '2026-07-30T00:00:00.000Z',
  elapsedMs: 8,
  latencyBudgetMs: 100,
  buildSha: 'build-040c',
};

describe('CDB-V1-040C compensation accrual provider', () => {
  it('defaults to legacy without requiring Canonical schema', async () => {
    const h = harness();
    expect(await resolveCompensationAccrualProviderMode(h.db, 'tenant-a')).toBe('legacy');
    const result = await provideCompensationAccrualRead(h.db, evidence);
    expect(result.mode).toBe('legacy');
    expect(result.selectedProvider).toBe('legacy');
    expect(result.selected).toMatchObject({
      legacyAccrualId: 1,
      status: 'accrued',
      earnedMinor: 12050,
      adjustedMinor: 2025,
      settledMinor: 0,
      payableMinor: 10025,
    });
    expect(result.canonical).toBeNull();
    expect(result.shadowEvidence).toBeUndefined();
  });

  it('keeps legacy selected in shadow mode and persists exact zero-variance evidence', async () => {
    const h = harness();
    addCanonicalTables(h);
    h.sqlite.exec(`
      INSERT INTO canonical_feature_flags VALUES (
        'tenant-a','canonical_compensation_accrual_provider_v1','shadow',1
      );
      INSERT INTO canonical_source_mappings VALUES (
        'tenant-a','compensation_accrual','compacc-1','legacy_doctor_commission_accrual',
        'acc-source-1','doctor_commission_accruals','mapped',1
      );
      INSERT INTO canonical_compensation_accruals VALUES (
        'tenant-a','compacc-1','pract-7','performing','commission','BDT',
        12050,2025,0,10025,'accrued','2026-07-30'
      );
    `);

    const result = await provideCompensationAccrualRead(h.db, evidence);
    expect(result.mode).toBe('shadow');
    expect(result.selectedProvider).toBe('legacy');
    expect(result.canonical?.accrualPublicId).toBe('compacc-1');
    expect(result.shadowEvidence).toMatchObject({
      parity: true,
      sourceRowKey: 'doctor_commission_accruals:1',
      canonicalRowKey: 'canonical_compensation_accruals:compacc-1',
      criticalUnexplainedVarianceCount: 0,
      rollbackMode: 'legacy',
    });

    const persisted = h.sqlite.prepare(`
      SELECT status,mismatch_count,result_summary_json
      FROM canonical_reconciliation_runs
    `).get() as { status: string; mismatch_count: number; result_summary_json: string };
    expect(persisted.status).toBe('passed');
    expect(persisted.mismatch_count).toBe(0);
    expect(persisted.result_summary_json).toContain('build-040c');
    expect(persisted.result_summary_json).not.toContain('doctor_name');
  });

  it('fails closed in canonical mode without one exact source mapping', async () => {
    const h = harness();
    addCanonicalTables(h);
    h.sqlite.exec(`
      INSERT INTO canonical_feature_flags VALUES (
        'tenant-a','canonical_compensation_accrual_provider_v1','canonical',1
      );
    `);
    await expect(provideCompensationAccrualRead(h.db, evidence)).rejects.toThrow(
      /requires one exact mapped Canonical accrual/,
    );
  });
});
