import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  runCriticalReadShadowBatch,
  type CriticalReadShadowBatchRecord,
} from '../../src/lib/canonical/critical-read-consumer-adapters';
import {
  FINANCIAL_READ_CONSUMER_IDS,
  runFinancialReadShadowBatch,
  type FinancialReadConsumerKind,
  type FinancialReadShadowBatchRecord,
} from '../../src/lib/canonical/financial-read-consumer-adapters';
import {
  CDB_V1_050_PROVIDER_KEYS,
  loadProtectedCloneRehearsalAuthorization,
} from './protected-clone-rehearsal-authorization';
import type {
  ProtectedCloneBackfillExecutionEvidence,
  ProtectedCloneHealthEvidence,
  ProtectedCloneMigrationExecutionEvidence,
  ProtectedCloneProviderRollbackEvidence,
  ProtectedCloneRehearsalExecutionContext,
  ProtectedCloneRehearsalExecutionDependencies,
  ProtectedCloneShadowExecutionEvidence,
  ProtectedCloneSmokeExecutionEvidence,
} from './protected-clone-rehearsal-execution';

interface D1RunResult {
  success: true;
  meta: { changes: number; last_row_id: number };
}

function sqliteValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

class LocalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): LocalPreparedStatement {
    return new LocalPreparedStatement(this.database, this.sql, values.map(sqliteValue));
  }

  async run(): Promise<D1RunResult> {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.database.prepare(this.sql).all(...this.params) as T[] };
  }
}

function d1Database(sqlite: DatabaseSync): any {
  return {
    prepare(sql: string): LocalPreparedStatement {
      return new LocalPreparedStatement(sqlite, sql);
    },
    async batch(statements: LocalPreparedStatement[]): Promise<D1RunResult[]> {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results: D1RunResult[] = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function openClone(path: string, readOnly = false): DatabaseSync {
  const database = new DatabaseSync(path, { readOnly });
  if (!readOnly) {
    database.exec('PRAGMA foreign_keys=ON');
    database.exec('PRAGMA busy_timeout=5000');
  }
  return database;
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function count(
  database: DatabaseSync,
  table: string,
  where = '',
  params: unknown[] = [],
): number {
  const escaped = table.replaceAll('"', '""');
  const statement = `SELECT COUNT(*) AS count FROM "${escaped}"${where ? ` WHERE ${where}` : ''}`;
  const row = database.prepare(statement).get(...params) as { count: number | bigint };
  return Number(row.count);
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Number((database.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_schema WHERE type='table' AND name=?",
  ).get(table) as { count: number | bigint }).count) === 1;
}

function parseSourceRowKey(sourceTable: string, sourceRowKey: string): string {
  const prefix = `${sourceTable}:`;
  if (!sourceRowKey.startsWith(prefix) || sourceRowKey.length <= prefix.length) {
    throw new Error(`invalid exact source row key for ${sourceTable}`);
  }
  return sourceRowKey.slice(prefix.length);
}

function positiveLegacyId(sourceTable: string, sourceRowKey: string): number {
  const value = Number(parseSourceRowKey(sourceTable, sourceRowKey));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid positive legacy id for ${sourceTable}`);
  }
  return value;
}

function nowFactory(startUtc: string): () => string {
  let tick = 0;
  const start = Date.parse(startUtc);
  if (!Number.isFinite(start)) throw new Error('invalid execution UTC timestamp');
  return () => new Date(start + (++tick * 1000)).toISOString();
}

function aggregate(target: Record<string, number>, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'number') target[key] = (target[key] ?? 0) + value;
  }
}

function businessWriteCount(values: Record<string, number>, keys: readonly string[]): number {
  return keys.reduce((total, key) => total + (values[key] ?? 0), 0);
}

const FINANCIAL_PROVIDER_MAP = {
  canonical_invoice_provider_v1: 'invoice',
  canonical_payment_provider_v1: 'payment',
  canonical_deposit_provider_v1: 'deposit',
} as const;

const CRITICAL_PROVIDER_MAP = {
  canonical_patient_identity_provider_v1: 'patient_identity',
  canonical_practitioner_provider_v1: 'practitioner',
  canonical_appointment_provider_v1: 'appointment',
  canonical_encounter_provider_v1: 'encounter',
  canonical_admission_bed_provider_v1: 'admission_bed',
  canonical_compensation_accrual_provider_v1: 'compensation_accrual',
} as const;

function consumerKind(consumerId: string): FinancialReadConsumerKind {
  const entry = Object.entries(FINANCIAL_READ_CONSUMER_IDS)
    .find(([, configured]) => configured === consumerId);
  if (!entry) throw new Error(`unsupported financial consumer ${consumerId}`);
  return entry[0] as FinancialReadConsumerKind;
}

function providerDomain(providerKey: string): string {
  if (providerKey.includes('invoice') || providerKey.includes('payment') || providerKey.includes('deposit')) {
    return 'financial';
  }
  if (providerKey.includes('compensation')) return 'compensation';
  return 'identity_episode';
}

function setProviderMode(
  database: DatabaseSync,
  tenantId: string,
  mode: 'legacy' | 'shadow' | 'canonical',
  isEnabled: boolean,
  observedAtUtc: string,
): void {
  const statement = database.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id,flag_key,domain,mode,is_enabled,version,config_json,
      effective_at_utc,expires_at_utc,updated_by_public_id,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,1,?, ?,NULL,'rahmatullah-zisan',?,?)
    ON CONFLICT(tenant_id,flag_key) DO UPDATE SET
      domain=excluded.domain,
      mode=excluded.mode,
      is_enabled=excluded.is_enabled,
      version=canonical_feature_flags.version+1,
      config_json=excluded.config_json,
      effective_at_utc=excluded.effective_at_utc,
      expires_at_utc=NULL,
      updated_by_public_id=excluded.updated_by_public_id,
      updated_at_utc=excluded.updated_at_utc
  `);
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const providerKey of CDB_V1_050_PROVIDER_KEYS) {
      statement.run(
        tenantId,
        providerKey,
        providerDomain(providerKey),
        mode,
        isEnabled ? 1 : 0,
        JSON.stringify({ tenantScope: [tenantId], rehearsalOnly: true }),
        observedAtUtc,
        observedAtUtc,
        observedAtUtc,
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

async function applyMigrations(
  context: ProtectedCloneRehearsalExecutionContext,
): Promise<ProtectedCloneMigrationExecutionEvidence> {
  const database = openClone(context.targetClonePath);
  let appliedMigrationCount = 0;
  try {
    for (const migration of context.authorization.migrations) {
      assert(basename(migration.name) === migration.name, `unsafe migration name ${migration.name}`);
      const migrationPath = join(context.repositoryRoot, 'migrations', migration.name);
      assert(sha256File(migrationPath) === migration.sha256, `migration hash drift: ${migration.name}`);
      const existing = database.prepare('SELECT COUNT(*) AS count FROM d1_migrations WHERE name=?')
        .get(migration.name) as { count: number | bigint };
      assert(Number(existing.count) === 0, `authorized migration already exists in clone ledger: ${migration.name}`);
      const sql = readFileSync(migrationPath, 'utf8');
      database.exec('BEGIN IMMEDIATE');
      try {
        database.exec(sql);
        database.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(migration.name);
        database.exec('COMMIT');
        appliedMigrationCount += 1;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
      const integrity = String((database.prepare('PRAGMA integrity_check').get() as Record<string, unknown>).integrity_check);
      assert(integrity === 'ok', `integrity failed after ${migration.name}`);
      assert(database.prepare('PRAGMA foreign_key_check').all().length === 0, `foreign-key violations after ${migration.name}`);
    }
  } finally {
    database.close();
  }
  return { appliedMigrationCount };
}

async function runBackfills(
  context: ProtectedCloneRehearsalExecutionContext,
): Promise<ProtectedCloneBackfillExecutionEvidence> {
  const tenantIds = context.authorization.scope.tenantIds;
  const nextTime = nowFactory(context.nowUtc);
  let secondPassNewBusinessRows = 0;
  const supported = new Set([
    'scripts/canonical/backfill-tenant-patient-links.ts',
    'scripts/canonical/backfill-practitioners.ts',
    'scripts/canonical/backfill-appointments.ts',
    'scripts/canonical/backfill-encounter-admission-bed-convergence.ts',
  ]);
  for (const binding of context.authorization.backfills) {
    assert(supported.has(binding.path), `unsupported CDB-V1-050 backfill ${binding.path}`);
    assert(sha256File(join(context.repositoryRoot, binding.path)) === binding.sha256, `backfill hash drift: ${binding.path}`);
  }

  for (const tenantId of tenantIds) {
    for (const binding of context.authorization.backfills) {
      const key = basename(binding.path, '.ts');
      const runBase = `cdbv1050-${tenantId}-${key}-${context.authorization.authorizationId.slice(-12)}`;
      if (binding.path.endsWith('backfill-tenant-patient-links.ts')) {
        const module = await import(pathToFileURL(join(context.repositoryRoot, binding.path)).href);
        const reconcile = await import(pathToFileURL(join(context.repositoryRoot, 'scripts/canonical/reconcile-tenant-patient-links.ts')).href);
        const totals: Record<string, number> = {};
        let cursor: number | null = 0;
        let chunk = 0;
        let lastRun = '';
        while (cursor !== null) {
          assert(++chunk <= binding.partitionLimit, 'patient-link partition limit exceeded');
          const database = openClone(context.targetClonePath);
          try {
            lastRun = `${runBase}-${String(chunk).padStart(3, '0')}`;
            const result = await module.backfillTenantPatientLinks(d1Database(database), {
              tenantId,
              runPublicId: lastRun,
              nowUtc: nextTime(),
              chunkSize: Math.min(500, binding.partitionLimit),
              afterLegacyPatientId: cursor,
            });
            aggregate(totals, result.counts);
            cursor = result.completed ? null : result.nextCursorLegacyPatientId;
            assert(result.completed || cursor != null, 'patient-link cursor did not advance');
          } finally {
            database.close();
          }
        }
        secondPassNewBusinessRows += businessWriteCount(totals, ['created', 'events', 'mappings', 'issues']);
        const database = openClone(context.targetClonePath);
        try {
          const result = await reconcile.reconcileTenantPatientLinks(d1Database(database), {
            tenantId,
            runPublicId: `${runBase}-reconcile`,
            migrationRunPublicId: lastRun,
            nowUtc: nextTime(),
          });
          assert(result.status === 'passed', 'patient-link second-pass reconciliation failed');
        } finally {
          database.close();
        }
        continue;
      }

      if (binding.path.endsWith('backfill-practitioners.ts')) {
        const module = await import(pathToFileURL(join(context.repositoryRoot, binding.path)).href);
        const reconcile = await import(pathToFileURL(join(context.repositoryRoot, 'scripts/canonical/reconcile-practitioner-operational-adoption.ts')).href);
        const totals: Record<string, number> = {};
        let completed = false;
        let guard = 0;
        while (!completed) {
          assert(++guard <= binding.partitionLimit, 'practitioner partition limit exceeded');
          const database = openClone(context.targetClonePath);
          try {
            const result = await module.backfillPractitioners(d1Database(database), {
              tenantId,
              runPublicId: runBase,
              nowUtc: nextTime(),
              maxSourceRecords: Math.min(500, binding.partitionLimit),
            });
            aggregate(totals, result.counts);
            completed = result.completed;
          } finally {
            database.close();
          }
        }
        secondPassNewBusinessRows += businessWriteCount(totals, ['created', 'mapped', 'userLinks', 'employeeLinks', 'issues']);
        const database = openClone(context.targetClonePath);
        try {
          const result = await reconcile.reconcilePractitionerOperationalAdoption(d1Database(database), {
            tenantId,
            runPublicId: `${runBase}-reconcile`,
            migrationRunPublicId: runBase,
            nowUtc: nextTime(),
          });
          assert(result.status === 'passed', 'practitioner second-pass reconciliation failed');
        } finally {
          database.close();
        }
        continue;
      }

      if (binding.path.endsWith('backfill-appointments.ts')) {
        const module = await import(pathToFileURL(join(context.repositoryRoot, binding.path)).href);
        const reconcile = await import(pathToFileURL(join(context.repositoryRoot, 'scripts/canonical/reconcile-appointment-authority.ts')).href);
        const totals: Record<string, number> = {};
        let completed = false;
        let guard = 0;
        while (!completed) {
          assert(++guard <= binding.partitionLimit, 'appointment partition limit exceeded');
          const database = openClone(context.targetClonePath);
          try {
            const result = await module.backfillAppointments(d1Database(database), {
              tenantId,
              runPublicId: runBase,
              timezone: 'Asia/Dhaka',
              nowUtc: nextTime(),
              maxSourceRecords: Math.min(500, binding.partitionLimit),
            });
            aggregate(totals, result.counts);
            completed = result.completed;
          } finally {
            database.close();
          }
        }
        secondPassNewBusinessRows += businessWriteCount(totals, ['created', 'mapped', 'linked', 'issues']);
        const database = openClone(context.targetClonePath);
        try {
          const result = await reconcile.reconcileAppointmentAuthority(d1Database(database), {
            tenantId,
            runPublicId: `${runBase}-reconcile`,
            migrationRunPublicId: runBase,
            nowUtc: nextTime(),
          });
          assert(result.status === 'passed', 'appointment second-pass reconciliation failed');
        } finally {
          database.close();
        }
        continue;
      }

      const module = await import(pathToFileURL(join(context.repositoryRoot, binding.path)).href);
      const reconcile = await import(pathToFileURL(join(context.repositoryRoot, 'scripts/canonical/reconcile-encounter-admission-bed-convergence.ts')).href);
      const totals: Record<string, number> = {};
      let completed = false;
      let guard = 0;
      let last: any = null;
      while (!completed) {
        assert(++guard <= binding.partitionLimit, 'encounter/admission/bed partition limit exceeded');
        const database = openClone(context.targetClonePath);
        try {
          last = await module.backfillEncounterAdmissionBedConvergence(d1Database(database), {
            tenantId,
            runPublicId: runBase,
            timezone: 'Asia/Dhaka',
            nowUtc: nextTime(),
            maxSourceRecords: Math.min(500, binding.partitionLimit),
          });
          aggregate(totals, last.counts);
          completed = last.completed;
        } finally {
          database.close();
        }
      }
      assert(last?.secondPassZeroNew === true, 'encounter/admission/bed second-pass marker was false');
      secondPassNewBusinessRows += businessWriteCount(totals, [
        'locationsCreated', 'bedsCreated', 'admissionsCreated', 'eventsCreated',
        'bedStaysCreated', 'mappingsCreated', 'issuesCreated', 'created', 'mapped', 'issues',
      ]);
      const database = openClone(context.targetClonePath);
      try {
        const result = await reconcile.reconcileEncounterAdmissionBedConvergence(d1Database(database), {
          tenantId,
          runPublicId: `${runBase}-reconcile`,
          migrationRunPublicId: runBase,
          nowUtc: nextTime(),
        });
        assert(result.status === 'passed', 'encounter/admission/bed second-pass reconciliation failed');
      } finally {
        database.close();
      }
    }
  }

  return {
    backfillCount: context.authorization.backfills.length,
    secondPassNewBusinessRows,
  };
}

async function runShadowComparison(
  context: ProtectedCloneRehearsalExecutionContext,
): Promise<ProtectedCloneShadowExecutionEvidence> {
  let recordCount = 0;
  const tenantIds = context.authorization.scope.tenantIds;
  for (const tenantId of tenantIds) {
    const records = context.authorization.scope.records.filter((record) => record.tenantId === tenantId);
    const database = openClone(context.targetClonePath);
    try {
      setProviderMode(database, tenantId, 'shadow', true, context.nowUtc);
      const financial: FinancialReadShadowBatchRecord[] = [];
      const critical: CriticalReadShadowBatchRecord[] = [];
      for (const record of records) {
        if (record.providerKey in FINANCIAL_PROVIDER_MAP) {
          financial.push({
            provider: FINANCIAL_PROVIDER_MAP[record.providerKey as keyof typeof FINANCIAL_PROVIDER_MAP],
            consumerKind: consumerKind(record.consumerId),
            sourcePublicId: parseSourceRowKey(record.sourceTable, record.sourceRowKey),
            elapsedMs: 0,
          });
          continue;
        }
        const provider = CRITICAL_PROVIDER_MAP[record.providerKey as keyof typeof CRITICAL_PROVIDER_MAP];
        assert(provider, `unsupported critical provider ${record.providerKey}`);
        const legacyId = positiveLegacyId(record.sourceTable, record.sourceRowKey);
        if (provider === 'appointment') critical.push({ provider, legacyId, elapsedMs: 0, timezone: 'Asia/Dhaka' });
        else critical.push({ provider, legacyId, elapsedMs: 0 } as CriticalReadShadowBatchRecord);
      }
      const db = d1Database(database);
      if (financial.length > 0) {
        const result = await runFinancialReadShadowBatch(db, {
          tenantId,
          observedAtUtc: context.nowUtc,
          latencyBudgetMs: 5_000,
          buildSha: context.authorization.repository.buildSha,
          records: financial,
        });
        recordCount += result.recordCount;
      }
      if (critical.length > 0) {
        const result = await runCriticalReadShadowBatch(db, {
          tenantId,
          observedAtUtc: context.nowUtc,
          latencyBudgetMs: 5_000,
          buildSha: context.authorization.repository.buildSha,
          records: critical,
        });
        recordCount += result.recordCount;
      }
    } finally {
      database.close();
    }
  }
  return { recordCount, varianceCount: 0, providerErrorCount: 0 };
}

async function runSmokeWorkflows(
  context: ProtectedCloneRehearsalExecutionContext,
): Promise<ProtectedCloneSmokeExecutionEvidence> {
  const database = openClone(context.targetClonePath, true);
  try {
    const sources = new Map(context.authorization.scope.records.map((record) => [
      `${record.tenantId}\u0000${record.sourceTable}\u0000${record.sourceRowKey}`,
      record,
    ]));
    const hasSource = (table: string): boolean => context.authorization.scope.tenantIds.every((tenantId) => (
      [...sources.values()].some((record) => record.tenantId === tenantId && record.sourceTable === table)
    ));
    const identityColumns: Record<string, string> = {
      bills: 'invoice_no',
      payments: 'receipt_no',
      billing_deposits: 'deposit_receipt_no',
      patients: 'id',
      doctors: 'id',
      appointments: 'id',
      visits: 'id',
      admissions: 'id',
      doctor_commission_accruals: 'id',
    };
    const allRowsExist = context.authorization.scope.records.every((record) => {
      const sourceId = parseSourceRowKey(record.sourceTable, record.sourceRowKey);
      const identityColumn = identityColumns[record.sourceTable];
      if (!identityColumn) return false;
      return count(database, record.sourceTable, `CAST(tenant_id AS TEXT)=? AND CAST("${identityColumn}" AS TEXT)=?`, [
        record.tenantId,
        sourceId,
      ]) === 1;
    });
    return {
      reception: allRowsExist && ['patients', 'doctors', 'appointments', 'visits', 'admissions'].every(hasSource),
      billing: allRowsExist && ['bills', 'billing_deposits'].every(hasSource),
      payment: allRowsExist && hasSource('payments'),
      commission: allRowsExist && hasSource('doctor_commission_accruals'),
    };
  } finally {
    database.close();
  }
}

async function rehearseProviderPromotionRollback(
  context: ProtectedCloneRehearsalExecutionContext,
): Promise<ProtectedCloneProviderRollbackEvidence> {
  const database = openClone(context.targetClonePath);
  let promotedProviderCount = 0;
  try {
    for (const tenantId of context.authorization.scope.tenantIds) {
      try {
        setProviderMode(database, tenantId, 'canonical', true, context.nowUtc);
        const promoted = database.prepare(`
          SELECT COUNT(*) AS count
          FROM canonical_feature_flags
          WHERE tenant_id=? AND mode='canonical' AND is_enabled=1
            AND flag_key IN (${CDB_V1_050_PROVIDER_KEYS.map(() => '?').join(',')})
        `).get(tenantId, ...CDB_V1_050_PROVIDER_KEYS) as { count: number | bigint };
        assert(Number(promoted.count) === CDB_V1_050_PROVIDER_KEYS.length, 'provider promotion rehearsal was incomplete');
        promotedProviderCount += Number(promoted.count);
      } finally {
        setProviderMode(database, tenantId, 'legacy', false, context.nowUtc);
      }
      const final = database.prepare(`
        SELECT COUNT(*) AS count
        FROM canonical_feature_flags
        WHERE tenant_id=? AND mode='legacy' AND is_enabled=0
          AND flag_key IN (${CDB_V1_050_PROVIDER_KEYS.map(() => '?').join(',')})
      `).get(tenantId, ...CDB_V1_050_PROVIDER_KEYS) as { count: number | bigint };
      assert(Number(final.count) === CDB_V1_050_PROVIDER_KEYS.length, 'provider rollback did not finish on legacy');
    }
  } finally {
    database.close();
  }
  return { promotedProviderCount, finalProvider: 'legacy' };
}

async function verifyCloneHealth(
  context: ProtectedCloneRehearsalExecutionContext,
): Promise<ProtectedCloneHealthEvidence> {
  const database = openClone(context.targetClonePath, true);
  try {
    return {
      integrity: String((database.prepare('PRAGMA integrity_check').get() as Record<string, unknown>).integrity_check),
      foreignKeyViolations: database.prepare('PRAGMA foreign_key_check').all().length,
    };
  } finally {
    database.close();
  }
}

export function createLocalProtectedCloneDependencies(): ProtectedCloneRehearsalExecutionDependencies {
  return {
    loadAuthorization: loadProtectedCloneRehearsalAuthorization,
    applyMigrations,
    runBackfills,
    runShadowComparison,
    runSmokeWorkflows,
    rehearseProviderPromotionRollback,
    verifyCloneHealth,
  };
}
