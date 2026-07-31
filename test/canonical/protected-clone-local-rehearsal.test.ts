import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalProtectedCloneDependencies } from '../../scripts/canonical/protected-clone-local-rehearsal';
import type { ProtectedCloneRehearsalExecutionContext } from '../../scripts/canonical/protected-clone-rehearsal-execution';
import type { ProtectedCloneRehearsalAuthorization } from '../../scripts/canonical/protected-clone-rehearsal-authorization';

const roots: string[] = [];

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fixture(): { root: string; dbPath: string; context: ProtectedCloneRehearsalExecutionContext } {
  const root = mkdtempSync(join(tmpdir(), 'cdb-v1-050-local-'));
  roots.push(root);
  chmodSync(root, 0o700);
  mkdirSync(join(root, 'migrations'));
  const migrationName = '0001_test_authorized.sql';
  const migrationPath = join(root, 'migrations', migrationName);
  writeFileSync(migrationPath, 'CREATE TABLE authorized_table (id INTEGER PRIMARY KEY);\n');
  const dbPath = join(root, 'target.sqlite3');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE canonical_feature_flags (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, flag_key TEXT NOT NULL,
      domain TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'legacy', is_enabled INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1, config_json TEXT, effective_at_utc TEXT, expires_at_utc TEXT,
      updated_by_public_id TEXT, created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
      UNIQUE(tenant_id, flag_key)
    );
  `);
  db.close();
  chmodSync(dbPath, 0o600);
  const authorization = {
    repository: { repositoryCommit: 'f'.repeat(40), buildSha: 'f'.repeat(40) },
    target: { platform: 'local_sqlite_d1_equivalent', remote: false },
    scope: { tenantIds: ['100'], records: [] },
    migrations: [{ name: migrationName, sha256: sha256File(migrationPath) }],
    backfills: [],
  } as unknown as ProtectedCloneRehearsalAuthorization;
  return {
    root,
    dbPath,
    context: {
      authorizationPath: join(root, 'authorization.json'),
      repositoryRoot: root,
      sourceSnapshotPath: join(root, 'source.sqlite3'),
      rollbackBackupPath: join(root, 'backup.sqlite3'),
      targetClonePath: dbPath,
      detailedEvidencePath: join(root, 'evidence.json'),
      nowUtc: '2026-07-29T21:45:00.000Z',
      authorization,
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('CDB-V1-050 local protected-clone dependencies', () => {
  it('applies only the exact authorized migration and records the ledger entry', async () => {
    const setup = fixture();
    const dependencies = createLocalProtectedCloneDependencies();

    const evidence = await dependencies.applyMigrations(setup.context);
    const db = new DatabaseSync(setup.dbPath, { readOnly: true });
    const tableCount = Number(db.prepare("SELECT COUNT(*) c FROM sqlite_schema WHERE type='table' AND name='authorized_table'").get().c);
    const ledger = db.prepare('SELECT name FROM d1_migrations').all();
    db.close();

    expect(evidence.appliedMigrationCount).toBe(1);
    expect(tableCount).toBe(1);
    expect(ledger).toEqual([{ name: '0001_test_authorized.sql' }]);
  });

  it('uses exact financial public identifiers and numeric critical IDs in protected-core smoke checks', async () => {
    const setup = fixture();
    const db = new DatabaseSync(setup.dbPath);
    db.exec(`
      CREATE TABLE bills (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, invoice_no TEXT NOT NULL);
      CREATE TABLE payments (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, receipt_no TEXT NOT NULL);
      CREATE TABLE billing_deposits (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, deposit_receipt_no TEXT NOT NULL);
      CREATE TABLE patients (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE doctors (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE appointments (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE visits (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE admissions (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE doctor_commission_accruals (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL);
      INSERT INTO bills VALUES (1,'100','INV-001');
      INSERT INTO payments VALUES (2,'100','RCPT-002');
      INSERT INTO billing_deposits VALUES (3,'100','DEP-003');
      INSERT INTO patients VALUES (11,'100');
      INSERT INTO doctors VALUES (12,'100');
      INSERT INTO appointments VALUES (13,'100');
      INSERT INTO visits VALUES (14,'100');
      INSERT INTO admissions VALUES (15,'100');
      INSERT INTO doctor_commission_accruals VALUES (16,'100');
    `);
    db.close();
    setup.context.authorization.scope.records = [
      { tenantId: '100', providerKey: 'canonical_invoice_provider_v1', consumerId: 'cdb040b.billing-detail', sourceTable: 'bills', sourceRowKey: 'bills:INV-001' },
      { tenantId: '100', providerKey: 'canonical_payment_provider_v1', consumerId: 'cdb040b.billing-detail', sourceTable: 'payments', sourceRowKey: 'payments:RCPT-002' },
      { tenantId: '100', providerKey: 'canonical_deposit_provider_v1', consumerId: 'cdb040b.billing-detail', sourceTable: 'billing_deposits', sourceRowKey: 'billing_deposits:DEP-003' },
      { tenantId: '100', providerKey: 'canonical_patient_identity_provider_v1', consumerId: 'cdb040c.reception-patient-context.patient', sourceTable: 'patients', sourceRowKey: 'patients:11' },
      { tenantId: '100', providerKey: 'canonical_practitioner_provider_v1', consumerId: 'cdb040c.reception-patient-context.practitioner', sourceTable: 'doctors', sourceRowKey: 'doctors:12' },
      { tenantId: '100', providerKey: 'canonical_appointment_provider_v1', consumerId: 'cdb040c.reception-patient-context.appointment', sourceTable: 'appointments', sourceRowKey: 'appointments:13' },
      { tenantId: '100', providerKey: 'canonical_encounter_provider_v1', consumerId: 'cdb040c.reception-patient-context.encounter', sourceTable: 'visits', sourceRowKey: 'visits:14' },
      { tenantId: '100', providerKey: 'canonical_admission_bed_provider_v1', consumerId: 'cdb040c.reception-patient-context.admission', sourceTable: 'admissions', sourceRowKey: 'admissions:15' },
      { tenantId: '100', providerKey: 'canonical_compensation_accrual_provider_v1', consumerId: 'cdb040c.commission-accrual-admin', sourceTable: 'doctor_commission_accruals', sourceRowKey: 'doctor_commission_accruals:16' },
    ];
    const dependencies = createLocalProtectedCloneDependencies();

    await expect(dependencies.runSmokeWorkflows(setup.context)).resolves.toEqual({
      reception: true,
      billing: true,
      payment: true,
      commission: true,
    });
  });

  it('rehearses all provider modes and always finishes disabled on legacy', async () => {
    const setup = fixture();
    const dependencies = createLocalProtectedCloneDependencies();

    const evidence = await dependencies.rehearseProviderPromotionRollback(setup.context);
    const db = new DatabaseSync(setup.dbPath, { readOnly: true });
    const rows = db.prepare('SELECT mode,is_enabled FROM canonical_feature_flags WHERE tenant_id=?').all('100');
    db.close();

    expect(evidence).toEqual({ promotedProviderCount: 9, finalProvider: 'legacy' });
    expect(rows).toHaveLength(9);
    expect(rows.every((row) => row.mode === 'legacy' && Number(row.is_enabled) === 0)).toBe(true);
  });
});
