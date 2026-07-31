import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  buildReportingActiveFkRepairSql,
  executeReportingActiveFkRepair,
  parseReportingActiveFkRepairExecutionArgs,
  type ReportingActiveFkRepairRunner,
} from '../../scripts/canonical/execute-reporting-active-fk-repair';

function createDatabase(billingOrphans = 4): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE bills (id INTEGER PRIMARY KEY);
    CREATE TABLE visits (id INTEGER PRIMARY KEY);
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY,
      reference_bill_id INTEGER REFERENCES bills(id),
      amount REAL NOT NULL
    );
    CREATE TABLE income (
      id INTEGER PRIMARY KEY,
      bill_id INTEGER REFERENCES bills(id),
      amount REAL NOT NULL
    );
    CREATE TABLE doctor_commission_accruals_old_0391 (
      id INTEGER PRIMARY KEY,
      bill_id INTEGER REFERENCES bills(id),
      visit_id INTEGER REFERENCES visits(id)
    );
    INSERT INTO bills(id) VALUES (1);
    INSERT INTO visits(id) VALUES (1);
  `);
  for (let index = 0; index < billingOrphans; index += 1) {
    db.prepare('INSERT INTO billing_deposits(id, reference_bill_id, amount) VALUES (?, ?, ?)')
      .run(index + 1, 1000 + index, 100 + index);
  }
  for (let index = 0; index < 4; index += 1) {
    db.prepare('INSERT INTO income(id, bill_id, amount) VALUES (?, ?, ?)')
      .run(index + 1, 2000 + index, 200 + index);
  }
  for (let index = 0; index < 26; index += 1) {
    db.prepare('INSERT INTO doctor_commission_accruals_old_0391(id, bill_id, visit_id) VALUES (?, ?, ?)')
      .run(index + 1, 3000 + index, 1);
  }
  for (let index = 0; index < 15; index += 1) {
    db.prepare('INSERT INTO doctor_commission_accruals_old_0391(id, bill_id, visit_id) VALUES (?, ?, ?)')
      .run(100 + index, 1, 4000 + index);
  }
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function scalar(db: DatabaseSync, sql: string): number {
  return Number((db.prepare(sql).get() as { value: unknown }).value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function protectedJson(path: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
  return sha256(text);
}

function createProtectedExecutionInputs(): {
  repositoryRoot: string;
  approvalPath: string;
  diagnosisPath: string;
  planPath: string;
  exportMetadataPath: string;
  outputPath: string;
} {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'cdb101-active-repair-repo-'));
  const protectedRoot = mkdtempSync(join(tmpdir(), 'cdb101-active-repair-protected-'));
  chmodSync(protectedRoot, 0o700);
  const exportPath = join(protectedRoot, 'production.sql');
  const timeTravelPath = join(protectedRoot, 'time-travel.json');
  const diagnosisPath = join(protectedRoot, 'diagnosis.json');
  const planPath = join(protectedRoot, 'plan.json');
  const approvalPath = join(protectedRoot, 'approval.json');
  const exportMetadataPath = join(protectedRoot, 'export-metadata.json');
  const outputPath = join(protectedRoot, 'receipt.json');

  const exportText = '-- protected production export\n';
  writeFileSync(exportPath, exportText, { mode: 0o600 });
  chmodSync(exportPath, 0o600);
  protectedJson(timeTravelPath, { bookmark: '00001f07-00000002-000050ac-f688d60ff40e138de442a65d5606ad1d' });

  const diagnosis = {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    sourceQueryId: 'cdb101_active_fk_diagnosis_v1',
    capturedAtUtc: '2026-07-18T01:10:00.000Z',
    productionDatabase: {
      name: 'hms-super-admin-production-apac',
      id: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
    },
    groups: [
      {
        childTable: 'billing_deposits',
        parentTable: 'bills',
        childColumn: 'reference_bill_id',
        violationCount: 4,
        nullable: true,
        deterministicReplacementCandidateCount: 0,
      },
      {
        childTable: 'income',
        parentTable: 'bills',
        childColumn: 'bill_id',
        violationCount: 4,
        nullable: true,
        deterministicReplacementCandidateCount: 0,
      },
    ],
    totalActiveViolationCount: 8,
    preserveFinancialRowsRequired: true,
    hardDeleteAllowed: false,
    guessedRelinkAllowed: false,
    recommendedStrategyId: 'clear_invalid_optional_bill_reference_v1',
    changedDb: false,
    rowsWritten: 0,
    productionMutationPerformed: false,
  };
  const diagnosisSha256 = protectedJson(diagnosisPath, diagnosis);

  const plan = {
    schemaVersion: 1,
    program: 'CDB-101',
    domain: 'reporting',
    stage: 'active_fk_repair_preparation',
    status: 'review_required',
    authorizationId: 'cdb101-active-fk-repair-20260718-01',
    generatedAtUtc: '2026-07-18T01:11:00.000Z',
    diagnosisCapturedAtUtc: diagnosis.capturedAtUtc,
    productionDatabase: diagnosis.productionDatabase,
    repairOwnerId: 'rahmatullah-zisan',
    observationOwnerId: 'abdullah',
    communicationChannelId: 'whatsapp-direct-rahmatullah-zisan-abdullah',
    strategyId: 'clear_invalid_optional_bill_reference_v1',
    expectedGroups: diagnosis.groups.map((group) => ({
      childTable: group.childTable,
      parentTable: group.parentTable,
      childColumn: group.childColumn,
      expectedViolationCount: 4,
      expectedReplacementCandidateCount: 0,
      nullableReference: true,
    })),
    expectedTotalActiveViolationCount: 8,
    executionCommandIncluded: false,
    executionAuthorized: false,
    decision: 'no_go_until_separately_authorized_and_verified',
    aggregateOnly: true,
    networkRequestPerformed: false,
    productionMutationPerformed: false,
    externalCommandPerformed: false,
  };
  const planSha256 = protectedJson(planPath, plan);

  const exportSha256 = sha256(exportText);
  protectedJson(exportMetadataPath, {
    productionDatabaseName: 'hms-super-admin-production-apac',
    productionDatabaseId: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
    exportFile: exportPath,
    exportSha256,
    exportSizeBytes: Buffer.byteLength(exportText),
    timeTravelTimestampUtc: '2026-07-18T01:00:00.000Z',
    timeTravelEvidenceFile: timeTravelPath,
    createdAtUtc: '2026-07-18T01:01:00.000Z',
  });

  protectedJson(approvalPath, {
    schemaVersion: 1,
    approvalId: 'cdb101-active-fk-repair-approval-20260718-01',
    approved: true,
    ownerId: 'rahmatullah-zisan',
    approvedAtUtc: '2026-07-18T01:12:00.000Z',
    program: 'CDB-101',
    domain: 'reporting',
    scope: 'active_fk_repair_only',
    productionDatabase: diagnosis.productionDatabase,
    strategyId: 'clear_invalid_optional_bill_reference_v1',
    groups: diagnosis.groups.map((group) => ({
      childTable: group.childTable,
      parentTable: group.parentTable,
      childColumn: group.childColumn,
      violationCount: 4,
    })),
    exportSha256,
    exportSizeBytes: Buffer.byteLength(exportText),
    timeTravelBookmark: '00001f07-00000002-000050ac-f688d60ff40e138de442a65d5606ad1d',
    diagnosisSha256,
    planSha256,
    expectedBefore: { billingDepositsToBills: 4, incomeToBills: 4, total: 49 },
    expectedAfter: { billingDepositsToBills: 0, incomeToBills: 0, total: 41 },
    preserveFinancialRows: true,
    hardDeleteAllowed: false,
    guessedRelinkAllowed: false,
    source: 'user_explicit_production_authorization',
  });

  return { repositoryRoot, approvalPath, diagnosisPath, planPath, exportMetadataPath, outputPath };
}

function aggregateRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    billing_orphans: 4,
    income_orphans: 4,
    archival_to_bills: 26,
    archival_to_visits: 15,
    total_fk_violations: 49,
    billing_row_count: 4,
    billing_amount_total: 406,
    income_row_count: 4,
    income_amount_total: 806,
    ...overrides,
  };
}

function createRunner(beforeOverrides: Record<string, unknown> = {}): {
  runner: ReportingActiveFkRepairRunner;
  mutationCalls: string[];
} {
  const mutationCalls: string[] = [];
  let aggregateCalls = 0;
  const runner: ReportingActiveFkRepairRunner = (args) => {
    if (args[0] === 'd1' && args[1] === 'info') {
      return {
        stdout: JSON.stringify({
          name: 'hms-super-admin-production-apac',
          uuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
        }),
        stderr: '',
        exitCode: 0,
      };
    }
    const command = args[args.indexOf('--command') + 1] ?? '';
    if (command.includes('CREATE TABLE cdb101_active_fk_snapshot')
      && command.includes('UPDATE billing_deposits')) {
      mutationCalls.push(command);
      return {
        stdout: JSON.stringify([{ results: [], success: true, meta: { changed_db: true, rows_written: 8 } }]),
        stderr: '',
        exitCode: 0,
      };
    }
    aggregateCalls += 1;
    const row = aggregateCalls === 1
      ? aggregateRow(beforeOverrides)
      : aggregateRow({ billing_orphans: 0, income_orphans: 0, total_fk_violations: 41 });
    return {
      stdout: JSON.stringify([{ results: [row], success: true, meta: { changed_db: false, rows_written: 0 } }]),
      stderr: '',
      exitCode: 0,
    };
  };
  return { runner, mutationCalls };
}

describe('CDB-101 active FK repair SQL', () => {
  it('clears only eight invalid optional references and preserves financial rows and amounts', () => {
    const repairSql = buildReportingActiveFkRepairSql();
    expect(repairSql).not.toMatch(/^BEGIN IMMEDIATE;/);
    expect(repairSql).not.toMatch(/\nCOMMIT;$/);
    expect(repairSql).not.toContain('CREATE TEMP');
    expect(repairSql).not.toContain('CREATE TEMP TRIGGER');
    expect(repairSql).toContain('CHECK (ok = 1)');

    const db = createDatabase();
    const before = {
      billingRows: scalar(db, 'SELECT COUNT(*) AS value FROM billing_deposits'),
      billingAmount: scalar(db, 'SELECT SUM(amount) AS value FROM billing_deposits'),
      incomeRows: scalar(db, 'SELECT COUNT(*) AS value FROM income'),
      incomeAmount: scalar(db, 'SELECT SUM(amount) AS value FROM income'),
      fk: scalar(db, 'SELECT COUNT(*) AS value FROM pragma_foreign_key_check'),
    };

    db.exec(repairSql);

    expect(scalar(db, 'SELECT COUNT(*) AS value FROM billing_deposits WHERE reference_bill_id IS NOT NULL')).toBe(0);
    expect(scalar(db, 'SELECT COUNT(*) AS value FROM income WHERE bill_id IS NOT NULL')).toBe(0);
    expect(scalar(db, 'SELECT COUNT(*) AS value FROM pragma_foreign_key_check')).toBe(41);
    expect(scalar(db, 'SELECT COUNT(*) AS value FROM billing_deposits')).toBe(before.billingRows);
    expect(scalar(db, 'SELECT SUM(amount) AS value FROM billing_deposits')).toBe(before.billingAmount);
    expect(scalar(db, 'SELECT COUNT(*) AS value FROM income')).toBe(before.incomeRows);
    expect(scalar(db, 'SELECT SUM(amount) AS value FROM income')).toBe(before.incomeAmount);
    db.close();
  });

  it('rolls back without changing any reference when the exact count guard drifts', () => {
    const db = createDatabase(3);
    expect(() => db.exec(buildReportingActiveFkRepairSql())).toThrow();
    expect(scalar(db, 'SELECT COUNT(*) AS value FROM billing_deposits WHERE reference_bill_id IS NOT NULL')).toBe(3);
    expect(scalar(db, 'SELECT COUNT(*) AS value FROM income WHERE bill_id IS NOT NULL')).toBe(4);
    expect(scalar(db, 'SELECT COUNT(*) AS value FROM pragma_foreign_key_check')).toBe(48);
    db.close();
  });

  it('executes once after protected evidence and exact before-state validation', () => {
    const paths = createProtectedExecutionInputs();
    const { runner, mutationCalls } = createRunner();
    const receipt = executeReportingActiveFkRepair({
      ...paths,
      executedAtUtc: '2026-07-18T01:13:00.000Z',
      runner,
    });

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      repairCompleted: true,
      strategyId: 'clear_invalid_optional_bill_reference_v1',
      beforeTotalForeignKeyViolationCount: 49,
      afterTotalForeignKeyViolationCount: 41,
      businessRowsUpdated: 8,
      financialRowsPreserved: true,
      productionMutationPerformed: true,
      mutationCommandPerformed: true,
    });
    expect(mutationCalls).toHaveLength(1);
  });

  it('refuses mutation on export mismatch or before-state drift', () => {
    const mismatched = createProtectedExecutionInputs();
    writeFileSync(
      join(mismatched.exportMetadataPath, '..', 'production.sql'),
      'x'.repeat(Buffer.byteLength('-- protected production export\n')),
      { mode: 0o600 },
    );
    const first = createRunner();
    expect(() => executeReportingActiveFkRepair({
      ...mismatched,
      runner: first.runner,
    })).toThrow(/export hash/i);
    expect(first.mutationCalls).toHaveLength(0);

    const drift = createProtectedExecutionInputs();
    const second = createRunner({ billing_orphans: 3, total_fk_violations: 48 });
    expect(() => executeReportingActiveFkRepair({
      ...drift,
      runner: second.runner,
    })).toThrow(/before-state/i);
    expect(second.mutationCalls).toHaveLength(0);
  });

  it('surfaces the D1 API error body when Wrangler also emits a warning', () => {
    const paths = createProtectedExecutionInputs();
    const base = createRunner();
    const runner: ReportingActiveFkRepairRunner = (args) => {
      const command = args[args.indexOf('--command') + 1] ?? '';
      if (command.includes('UPDATE billing_deposits')) {
        return {
          stdout: JSON.stringify({ error: { code: 7500, text: 'D1 rejected the batch' } }),
          stderr: 'Wrangler configuration warning',
          exitCode: 1,
        };
      }
      return base.runner(args);
    };

    expect(() => executeReportingActiveFkRepair({ ...paths, runner }))
      .toThrow(/7500/);
  });

  it('requires protected execution inputs and an exact confirmation token', () => {
    expect(() => parseReportingActiveFkRepairExecutionArgs(['--execute']))
      .toThrow(/unknown argument/i);
    expect(() => parseReportingActiveFkRepairExecutionArgs([
      '--approval', '/tmp/approval.json',
      '--diagnosis', '/tmp/diagnosis.json',
      '--plan', '/tmp/plan.json',
      '--export-metadata', '/tmp/export.json',
      '--output', '/tmp/receipt.json',
      '--confirm', 'WRONG',
    ])).toThrow(/confirmation/i);
  });
});
