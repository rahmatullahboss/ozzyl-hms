import { describe, expect, it } from 'vitest';
import type { ProductionCanonicalImportManifest } from '../../scripts/canonical/import-production-canonical-bundle';
import {
  createProductionTenantFinancialImportGateway,
  executeProductionTenantFinancialImport,
  expectedFinancialFlagConfigForOperation,
  parseProductionTenantFinancialImportArgs,
  prepareProductionTenantFinancialImport,
  type CanonicalTableState,
  type ProductionTenantFinancialImportEvidence,
  type ProductionTenantFinancialImportGateway,
} from '../../scripts/canonical/execute-production-tenant-financial-import';
import {
  CDB101_FINANCIAL_IMPORT_TABLES,
} from '../../scripts/canonical/tenant-financial-import-contract';
import type {
  TenantFinancialAggregate,
  TenantFinancialReconciliationReceipt,
} from '../../scripts/canonical/tenant-financial-reconciliation';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

const AUTHORIZATION = 'cdb101-financial-import-20260718';
const BUNDLE_HASH = 'a'.repeat(64);
const MANIFEST_HASH = 'b'.repeat(64);
const SOURCE_HASH = 'c'.repeat(64);
const RECONCILIATION_HASH = 'd'.repeat(64);
const TIME_TRAVEL_HASH = 'e'.repeat(64);
const ACTIVE_WORKER = '773c19f6-e992-4a75-a734-bb1f90eff376';

function aggregate(seed = 0): TenantFinancialAggregate {
  return {
    invoiceCount: seed,
    invoiceGrossMinor: seed,
    invoiceDiscountMinor: seed,
    invoiceNetMinor: seed,
    invoicePaidMinor: seed,
    invoiceDueMinor: seed,
    receiptCount: seed,
    receiptTotalMinor: seed,
    allocationTotalMinor: seed,
    depositReceivedMinor: seed,
    depositAppliedMinor: seed,
    depositRefundedMinor: seed,
    creditNoteMinor: seed,
    refundMinor: seed,
    reversalMinor: seed,
  };
}

function state(final = false): CanonicalTableState[] {
  return CDB101_FINANCIAL_IMPORT_TABLES.map((tableName, index) => ({
    tableName,
    globalRowCount: final ? index + 10 : index,
    maxId: final ? index + 100 : index,
    tenantRowCount: final ? index + 10 : index,
  }));
}

function manifest(): ProductionCanonicalImportManifest {
  return {
    schemaVersion: 1,
    authorizationId: AUTHORIZATION,
    productionDatabaseId: CDB101_PRODUCTION_DATABASE_ID,
    tenantIds: ['100'],
    allowedTables: [...CDB101_FINANCIAL_IMPORT_TABLES],
    bundleSha256: BUNDLE_HASH,
    sourceExportSha256: SOURCE_HASH,
    deterministicRunId: 'cdb101-financial-import-run-20260718',
    secondPassRequired: true,
    rowCountSummary: Object.fromEntries(state(true).map((row) => [row.tableName, row.tenantRowCount])),
  };
}

function reconciliation(): TenantFinancialReconciliationReceipt {
  return {
    schemaVersion: 1,
    evidenceReady: true,
    activationReady: true,
    tenantId: '100',
    cutoffUtc: '2026-07-18T14:16:00.000Z',
    variance: aggregate(0),
    controls: {
      secondPassNewRows: 0,
      sourceMappingDuplicates: 0,
      crossTenantRows: 0,
      unresolvedCriticalIssues: 0,
      blockedOutbox: 0,
      blockedAccounting: 0,
    },
    issues: [],
    aggregateOnly: true,
    productionMutationPerformed: false,
  };
}

function evidence(operation: 'initial-import' | 'shadow-repair' = 'initial-import'): ProductionTenantFinancialImportEvidence {
  return {
    schemaVersion: 1,
    operation,
    authorizationId: AUTHORIZATION,
    tenantId: '100',
    operator: 'Rahmatullah Zisan',
    productionDatabaseId: CDB101_PRODUCTION_DATABASE_ID,
    activeWorkerVersionId: ACTIVE_WORKER,
    expectedFlagVersion: operation === 'shadow-repair' ? 3 : 2,
    expectedFlagConfigJson: operation === 'shadow-repair'
      ? '{"tenantScope":["100"],"writePolicy":"shadow"}'
      : '{"tenantScope":["100"],"writePolicy":"canonical-only"}',
    sourceCapturedAtUtc: '2026-07-18T14:10:00.000Z',
    observedAtUtc: '2026-07-18T14:11:00.000Z',
    expiresAtUtc: '2026-07-18T14:25:00.000Z',
    sourceExportSha256: SOURCE_HASH,
    sourceExportSizeBytes: 42_000_000,
    timeTravelEvidenceSha256: operation === 'shadow-repair' ? null : TIME_TRAVEL_HASH,
    bundleSha256: BUNDLE_HASH,
    manifestSha256: MANIFEST_HASH,
    localReconciliationSha256: RECONCILIATION_HASH,
    deterministicRunId: 'cdb101-financial-import-run-20260718',
    secondPassNewRows: 0,
    sourceCanonicalState: state(false),
    targetCanonicalState: state(true),
    sourceLegacyAggregate: aggregate(7),
  };
}

const validBundleSql = CDB101_FINANCIAL_IMPORT_TABLES
  .map((table) => `INSERT OR IGNORE INTO \"${table}\" (tenant_id) VALUES ('100');`)
  .join('\n');

function input(operation: 'initial-import' | 'shadow-repair' = 'initial-import') {
  return {
    evidence: evidence(operation),
    manifest: manifest(),
    bundlePath: '/protected/tenant-100-canonical-import.sql',
    bundleSql: validBundleSql,
    actualBundleSha256: BUNDLE_HASH,
    actualManifestSha256: MANIFEST_HASH,
    actualSourceExportSha256: SOURCE_HASH,
    actualLocalReconciliationSha256: RECONCILIATION_HASH,
    localReconciliation: reconciliation(),
    atUtc: '2026-07-18T14:12:00.000Z',
    approval: AUTHORIZATION,
    execute: true,
  } as const;
}

function zeroSecondPassOutput(): string {
  return JSON.stringify([{ success: true, meta: { changed_db: false, changes: 0, rows_written: 0 } }]);
}

function activeRowForGateway() {
  return {
    tenant_id: '100',
    flag_key: 'canonical_financial_dual_write_v1',
    domain: 'financial',
    mode: 'disabled',
    is_enabled: 0,
    version: 2,
    config_json: evidence().expectedFlagConfigJson,
  };
}

function gateway(
  patch: Partial<ProductionTenantFinancialImportGateway> = {},
  operation: 'initial-import' | 'shadow-repair' = 'initial-import',
) {
  const calls: string[] = [];
  const value: ProductionTenantFinancialImportGateway = {
    async readDatabaseIdentity() {
      calls.push('identity');
      return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
    },
    async readActiveWorkerVersion() {
      calls.push('worker');
      return ACTIVE_WORKER;
    },
    async readFinancialFlag() {
      calls.push('flag');
      return [{
        tenant_id: '100',
        flag_key: 'canonical_financial_dual_write_v1',
        domain: 'financial',
        mode: operation === 'shadow-repair' ? 'shadow' : 'disabled',
        is_enabled: operation === 'shadow-repair' ? 1 : 0,
        version: operation === 'shadow-repair' ? 3 : 2,
        config_json: evidence(operation).expectedFlagConfigJson,
      }];
    },
    async readCanonicalTableState() {
      const count = calls.filter((call) => call === 'canonical-state').length;
      calls.push('canonical-state');
      return count === 0 ? state(false) : state(true);
    },
    async readLegacyAggregate() {
      calls.push('legacy-aggregate');
      return aggregate(7);
    },
    async executeBundle(_path) {
      const pass = calls.filter((call) => call.startsWith('execute-')).length + 1;
      calls.push(`execute-${pass}`);
      return {
        exitCode: 0,
        stdout: pass === 2 ? zeroSecondPassOutput() : JSON.stringify([{ success: true }]),
        stderr: '',
      };
    },
    async readProductionReconciliation() {
      calls.push('reconciliation');
      return reconciliation();
    },
    ...patch,
  };
  return { value, calls };
}

describe('production tenant financial import', () => {
  it('accepts the package-manager separator before CLI options', () => {
    expect(parseProductionTenantFinancialImportArgs([
      '--',
      '--operation', 'shadow-repair',
      '--authorization-id', AUTHORIZATION,
      '--approval', AUTHORIZATION,
      '--active-worker-version', ACTIVE_WORKER,
      '--expected-flag-version', '2',
      '--source-export', '/protected/source.sql',
      '--export-metadata', '/protected/metadata.json',
      '--bundle', '/protected/bundle.sql',
      '--manifest', '/protected/manifest.json',
      '--local-reconciliation', '/protected/reconciliation.json',
      '--observed-at-utc', '2026-07-18T14:11:00Z',
      '--expires-at-utc', '2026-07-18T14:25:00Z',
      '--output', '/protected/receipt.json',
      '--execute',
    ])).toMatchObject({
      operation: 'shadow-repair',
      authorizationId: AUTHORIZATION,
      execute: true,
    });
  });

  it('still requires Time Travel evidence for an initial import', () => {
    expect(() => parseProductionTenantFinancialImportArgs([
      '--authorization-id', AUTHORIZATION,
      '--approval', AUTHORIZATION,
      '--active-worker-version', ACTIVE_WORKER,
      '--expected-flag-version', '2',
      '--source-export', '/protected/source.sql',
      '--export-metadata', '/protected/metadata.json',
      '--bundle', '/protected/bundle.sql',
      '--manifest', '/protected/manifest.json',
      '--local-reconciliation', '/protected/reconciliation.json',
      '--observed-at-utc', '2026-07-18T14:11:00Z',
      '--expires-at-utc', '2026-07-18T14:25:00Z',
      '--output', '/protected/receipt.json',
      '--execute',
    ])).toThrow('--time-travel-evidence is required');
  });

  it('accepts only the exact protected financial import scope', () => {
    const plan = prepareProductionTenantFinancialImport(input());
    expect(plan).toEqual({ allowed: true, issues: [], productionMutationPerformed: false });
  });

  it('binds shadow repair to the approved non-blocking shadow flag config', () => {
    expect(expectedFinancialFlagConfigForOperation('shadow-repair'))
      .toBe('{"tenantScope":["100"],"writePolicy":"shadow"}');
  });

  it('accepts an exact active-shadow reconciliation repair scope', async () => {
    const repairInput = input('shadow-repair');
    const plan = prepareProductionTenantFinancialImport(repairInput);
    expect(plan).toEqual({ allowed: true, issues: [], productionMutationPerformed: false });

    const harness = gateway({}, 'shadow-repair');
    await expect(executeProductionTenantFinancialImport(repairInput, harness.value)).resolves.toMatchObject({
      allowed: true,
      productionMutationPerformed: true,
      secondPassRowsWritten: 0,
      productionReconciliationReady: true,
    });
  });

  it('rejects a shadow repair unless the exact approved shadow flag is active', async () => {
    const repairInput = input('shadow-repair');
    const disabledFlag = gateway({}, 'initial-import');
    await expect(executeProductionTenantFinancialImport(repairInput, disabledFlag.value))
      .rejects.toThrow('financial flag pre-state mismatch');
  });

  it('fails closed before external work for missing approval, stale source, or hash drift', () => {
    const stale = input();
    const plan = prepareProductionTenantFinancialImport({
      ...stale,
      atUtc: '2026-07-18T15:00:00.000Z',
      approval: null,
      actualBundleSha256: 'f'.repeat(64),
    });
    expect(plan.allowed).toBe(false);
    expect(plan.issues).toEqual(expect.arrayContaining([
      'CDB101_FINANCIAL_IMPORT_APPROVAL_MISMATCH',
      'CDB101_FINANCIAL_IMPORT_SOURCE_STALE',
      'CDB101_FINANCIAL_IMPORT_BUNDLE_HASH_MISMATCH',
    ]));
  });

  it('executes first pass, proves second-pass zero writes, verifies exact state, and reconciles', async () => {
    const harness = gateway();
    const result = await executeProductionTenantFinancialImport(input(), harness.value);
    expect(result).toMatchObject({
      allowed: true,
      productionMutationPerformed: true,
      secondPassChanges: 0,
      secondPassRowsWritten: 0,
      productionReconciliationReady: true,
    });
    expect(harness.calls).toEqual([
      'identity',
      'worker',
      'flag',
      'canonical-state',
      'legacy-aggregate',
      'execute-1',
      'execute-2',
      'canonical-state',
      'reconciliation',
    ]);
  });

  it('refuses to import when production drifted after the source export', async () => {
    let executions = 0;
    const harness = gateway({
      async readLegacyAggregate() {
        return aggregate(8);
      },
      async executeBundle() {
        executions += 1;
        throw new Error('must not execute');
      },
    });
    await expect(executeProductionTenantFinancialImport(input(), harness.value))
      .rejects.toThrow('legacy aggregate drift');
    expect(executions).toBe(0);
  });

  it('refuses to import when canonical high-watermarks or the disabled flag drifted', async () => {
    const canonicalDrift = gateway({
      async readCanonicalTableState() {
        return state(false).map((row, index) => index === 0 ? { ...row, maxId: row.maxId + 1 } : row);
      },
    });
    await expect(executeProductionTenantFinancialImport(input(), canonicalDrift.value))
      .rejects.toThrow('canonical table state drift');

    const flagDrift = gateway({
      async readFinancialFlag() {
        return [{
          tenant_id: '100', flag_key: 'canonical_financial_dual_write_v1', domain: 'financial',
          mode: 'shadow', is_enabled: 1, version: 3, config_json: '{}',
        }];
      },
    });
    await expect(executeProductionTenantFinancialImport(input(), flagDrift.value))
      .rejects.toThrow('financial flag pre-state mismatch');
  });

  it('parses only successful D1 envelopes and binds execution to the exact bundle path', async () => {
    const commands: string[][] = [];
    const productionGateway = createProductionTenantFinancialImportGateway(
      '/protected/tenant-100-canonical-import.sql',
      async (args) => {
        commands.push(args);
        if (args.includes('--command')) {
          return {
            status: 0,
            stdout: JSON.stringify([{ success: true, results: [{ ...activeRowForGateway() }] }]),
            stderr: '',
          };
        }
        return { status: 0, stdout: zeroSecondPassOutput(), stderr: '' };
      },
    );

    await expect(productionGateway.readFinancialFlag()).resolves.toEqual([activeRowForGateway()]);
    await expect(productionGateway.executeBundle('/protected/tenant-100-canonical-import.sql'))
      .resolves.toMatchObject({ exitCode: 0 });
    expect(commands.at(-1)).toEqual(expect.arrayContaining([
      '--json', '--file', '/protected/tenant-100-canonical-import.sql', '--yes',
    ]));
    await expect(productionGateway.executeBundle('/protected/other.sql'))
      .rejects.toThrow('bundle path mismatch');
  });

  it('rejects an unsuccessful D1 response envelope', async () => {
    const productionGateway = createProductionTenantFinancialImportGateway(
      '/protected/tenant-100-canonical-import.sql',
      async () => ({
        status: 0,
        stdout: JSON.stringify([{ success: false, results: [] }]),
        stderr: '',
      }),
    );
    await expect(productionGateway.readFinancialFlag())
      .rejects.toThrow('unsuccessful envelope');
  });

  it('fails closed when the first import exits zero but reports an unsuccessful D1 envelope', async () => {
    let executions = 0;
    const harness = gateway({
      async executeBundle() {
        executions += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ success: false, results: [] }]),
          stderr: '',
        };
      },
    });

    await expect(executeProductionTenantFinancialImport(input(), harness.value))
      .rejects.toThrow('unsuccessful envelope');
    expect(executions).toBe(1);
  });

  it('stops after import if row counts or production reconciliation are not exact', async () => {
    const rowMismatch = gateway({
      async readCanonicalTableState() {
        return state(false);
      },
    });
    await expect(executeProductionTenantFinancialImport(input(), rowMismatch.value))
      .rejects.toThrow('post-import canonical table state mismatch');

    let stateReads = 0;
    const reconciliationFailure = gateway({
      async readCanonicalTableState() {
        stateReads += 1;
        return stateReads === 1 ? state(false) : state(true);
      },
      async readProductionReconciliation() {
        return { ...reconciliation(), activationReady: false, issues: ['variance'] };
      },
    });
    await expect(executeProductionTenantFinancialImport(input(), reconciliationFailure.value))
      .rejects.toThrow('production financial reconciliation failed');
  });
});
