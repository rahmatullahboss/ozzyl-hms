import { createHash } from 'node:crypto';
import {
  resolveAdmissionBedProviderMode,
  type AdmissionBedProviderDatabase,
} from './admission-bed-provider';
import {
  resolveAppointmentProviderMode,
  type AppointmentProviderDatabase,
} from './appointment-provider';
import {
  provideCompensationAccrualRead,
  type CompensationAccrualReadResult,
} from './contracts/compensation-accrual-provider';
import {
  resolveEncounterProviderMode,
  type EncounterProviderDatabase,
} from './encounter-provider';
import {
  exactFinancialReadValue,
  financialReadNonNegativeInteger,
  financialReadUtcTimestamp,
  type FinancialReadDatabase,
} from './financial-read-provider';
import {
  readAdmissionBedAdapter,
  readAppointmentAdapter,
  readEncounterAdapter,
  readPatientIdentityAdapter,
  readPractitionerAdapter,
  type IdentityEpisodeReadAdapterDependencies,
  type IdentityEpisodeReadAdapterResult,
} from './identity-episode-read-adapters';
import type { IdentityEpisodeShadowEvidenceReceipt } from './identity-episode-shadow-evidence';
import {
  resolvePatientIdentityProviderMode,
  type PatientIdentityProviderDatabase,
} from './patient-identity-provider';
import {
  resolvePractitionerProviderMode,
  type PractitionerProviderDatabase,
} from './practitioner-provider';

export type CriticalReadProvider =
  | 'patient_identity'
  | 'practitioner'
  | 'appointment'
  | 'encounter'
  | 'admission_bed'
  | 'compensation_accrual';

export const CRITICAL_READ_CONSUMER_IDS: Readonly<Record<CriticalReadProvider, string>> = Object.freeze({
  patient_identity: 'cdb040c.reception-patient-context.patient',
  practitioner: 'cdb040c.reception-patient-context.practitioner',
  appointment: 'cdb040c.reception-patient-context.appointment',
  encounter: 'cdb040c.reception-patient-context.encounter',
  admission_bed: 'cdb040c.reception-patient-context.admission',
  compensation_accrual: 'cdb040c.commission-accrual-admin',
});

type CriticalReadDatabase = FinancialReadDatabase
  & PatientIdentityProviderDatabase
  & PractitionerProviderDatabase
  & AppointmentProviderDatabase
  & EncounterProviderDatabase
  & AdmissionBedProviderDatabase;

export type CriticalReadShadowBatchRecord =
  | { provider: 'patient_identity'; legacyId: number; elapsedMs: number }
  | { provider: 'practitioner'; legacyId: number; elapsedMs: number }
  | { provider: 'appointment'; legacyId: number; elapsedMs: number; timezone: string }
  | { provider: 'encounter'; legacyId: number; elapsedMs: number }
  | { provider: 'admission_bed'; legacyId: number; elapsedMs: number }
  | { provider: 'compensation_accrual'; legacyId: number; elapsedMs: number };

export interface CriticalReadConsumerDependencies {
  identity: IdentityEpisodeReadAdapterDependencies;
  compensation: typeof provideCompensationAccrualRead;
}

const DEFAULT_DEPENDENCIES: CriticalReadConsumerDependencies = {
  identity: {
    patient: async (db, input) => (await import('./patient-identity-provider')).providePatientIdentityProjection(db, input),
    practitioner: async (db, input) => (await import('./practitioner-provider')).resolvePractitionerProjection(db, input),
    appointment: async (db, input) => (await import('./appointment-provider')).resolveAppointmentProjection(db, input),
    encounter: async (db, input) => (await import('./encounter-provider')).resolveEncounterProjection(db, input),
    admissionBed: async (db, input) => (await import('./admission-bed-provider')).resolveAdmissionBedProjection(db, input),
  },
  compensation: provideCompensationAccrualRead,
};

export type CriticalReadShadowBatchErrorCode =
  | 'EMPTY_BATCH'
  | 'BATCH_LIMIT_EXCEEDED'
  | 'DUPLICATE_SCOPE'
  | 'PROVIDER_FAILURE'
  | 'SHADOW_MODE_REQUIRED'
  | 'SHADOW_EVIDENCE_MISSING'
  | 'MAPPING_REQUIRED'
  | 'UNEXPLAINED_VARIANCE'
  | 'CANONICAL_MODE_BLOCKED';

export class CriticalReadShadowBatchError extends Error {
  readonly name = 'CriticalReadShadowBatchError';
  readonly rollbackMode = 'legacy' as const;

  constructor(
    readonly code: CriticalReadShadowBatchErrorCode,
    message: string,
    readonly varianceIds: string[] = [],
    readonly cause?: unknown,
  ) {
    super(message);
  }
}

export interface CriticalReadShadowBatchInput {
  tenantId: string;
  observedAtUtc: string;
  latencyBudgetMs: number;
  buildSha: string;
  records: readonly CriticalReadShadowBatchRecord[];
}

export interface CriticalReadShadowBatchRow {
  provider: CriticalReadProvider;
  consumerId: string;
  sourceRowKey: string;
  canonicalRowKey: string;
  elapsedMs: number;
  latencyBudgetMs: number;
  varianceIds: [];
  rollbackMode: 'legacy';
}

export interface CriticalReadShadowBatchResult {
  checkpoint: 'CDB-V1-040C';
  tenantId: string;
  buildSha: string;
  observedAtUtc: string;
  recordCount: number;
  parity: true;
  varianceIds: [];
  rollbackMode: 'legacy';
  rows: CriticalReadShadowBatchRow[];
}

interface IdentityEvidencePersistenceInput {
  tenantId: string;
  provider: Exclude<CriticalReadProvider, 'compensation_accrual'>;
  sourceRowKey: string;
  canonicalRowKey: string;
  sourcePublicId: string;
  buildSha: string;
  receipt: IdentityEpisodeShadowEvidenceReceipt;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function scope(record: CriticalReadShadowBatchRecord): string {
  return JSON.stringify([record.provider, positiveInteger(record.legacyId, 'record.legacyId')]);
}

async function persistIdentityEpisodeEvidence(
  db: CriticalReadDatabase,
  input: IdentityEvidencePersistenceInput,
): Promise<void> {
  const tenantId = exactFinancialReadValue(input.tenantId, 'tenantId');
  const sourceRowKey = exactFinancialReadValue(input.sourceRowKey, 'sourceRowKey');
  const canonicalRowKey = exactFinancialReadValue(input.canonicalRowKey, 'canonicalRowKey');
  const sourcePublicId = exactFinancialReadValue(input.sourcePublicId, 'sourcePublicId');
  const buildSha = exactFinancialReadValue(input.buildSha, 'buildSha');
  const runPublicId = `recon_${sha256(JSON.stringify([
    'CDB-V1-040C', input.provider, tenantId, input.receipt.consumerId,
    sourcePublicId, input.receipt.observedAtUtc,
  ])).slice(0, 32)}`;
  const parity = input.receipt.parity
    && input.receipt.criticalUnexplainedVarianceCount === 0
    && input.receipt.varianceIds.length === 0;
  const summary = {
    checkpoint: 'CDB-V1-040C',
    provider: input.provider,
    consumerId: input.receipt.consumerId,
    sourceRowKey,
    canonicalRowKey,
    stableConsumerKeyHash: input.receipt.stableConsumerKeyHash,
    comparisonCount: input.receipt.comparisonCount,
    varianceClasses: input.receipt.varianceClasses,
    varianceIds: input.receipt.varianceIds,
    elapsedMs: input.receipt.elapsedMs,
    observedAtUtc: input.receipt.observedAtUtc,
    buildSha,
    rollbackMode: 'legacy',
  };
  const summaryJson = JSON.stringify(summary);
  await db.prepare(`
    INSERT INTO canonical_reconciliation_runs (
      tenant_id,run_public_id,migration_run_id,domain,reconciliation_type,status,
      scanned_count,matched_count,mismatch_count,exception_count,
      expected_total_minor,actual_total_minor,variance_minor,currency_code,
      evidence_sha256,result_summary_json,started_at_utc,completed_at_utc,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,NULL,'identity_episode','shadow',?,1,?,?,0,NULL,NULL,NULL,NULL,?,?,?, ?,?,?)
    ON CONFLICT(tenant_id,run_public_id) DO UPDATE SET
      status=excluded.status,
      matched_count=excluded.matched_count,
      mismatch_count=excluded.mismatch_count,
      evidence_sha256=excluded.evidence_sha256,
      result_summary_json=excluded.result_summary_json,
      completed_at_utc=excluded.completed_at_utc,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    tenantId,
    runPublicId,
    parity ? 'passed' : 'failed',
    parity ? 1 : 0,
    parity ? 0 : 1,
    sha256(summaryJson),
    summaryJson,
    input.receipt.observedAtUtc,
    input.receipt.observedAtUtc,
    input.receipt.observedAtUtc,
    input.receipt.observedAtUtc,
  ).run();
}

function identityKeys(
  record: Exclude<CriticalReadShadowBatchRecord, { provider: 'compensation_accrual' }>,
  result: IdentityEpisodeReadAdapterResult<unknown>,
): { sourceRowKey: string; canonicalRowKey: string } {
  const projection = result.projection as Record<string, unknown>;
  switch (record.provider) {
    case 'patient_identity': {
      const relationship = projection.relationship as { patientLinkPublicId?: string } | null | undefined;
      const canonicalPublicId = relationship?.patientLinkPublicId;
      if (!canonicalPublicId) throw new CriticalReadShadowBatchError('MAPPING_REQUIRED', 'patient shadow read requires one exact patient link');
      return { sourceRowKey: `patients:${record.legacyId}`, canonicalRowKey: `canonical_tenant_patient_links:${canonicalPublicId}` };
    }
    case 'practitioner': {
      const canonicalPublicId = projection.practitionerPublicId;
      if (typeof canonicalPublicId !== 'string' || canonicalPublicId === '') {
        throw new CriticalReadShadowBatchError('MAPPING_REQUIRED', 'practitioner shadow read requires one exact practitioner mapping');
      }
      return { sourceRowKey: `doctors:${record.legacyId}`, canonicalRowKey: `canonical_practitioners:${canonicalPublicId}` };
    }
    case 'appointment': {
      const canonicalPublicId = projection.appointmentPublicId;
      if (typeof canonicalPublicId !== 'string' || canonicalPublicId === '') {
        throw new CriticalReadShadowBatchError('MAPPING_REQUIRED', 'appointment shadow read requires one exact appointment mapping');
      }
      return { sourceRowKey: `appointments:${record.legacyId}`, canonicalRowKey: `canonical_appointments:${canonicalPublicId}` };
    }
    case 'encounter': {
      const canonicalPublicId = projection.encounterPublicId;
      if (typeof canonicalPublicId !== 'string' || canonicalPublicId === '') {
        throw new CriticalReadShadowBatchError('MAPPING_REQUIRED', 'encounter shadow read requires one exact encounter mapping');
      }
      return { sourceRowKey: `visits:${record.legacyId}`, canonicalRowKey: `canonical_encounters:${canonicalPublicId}` };
    }
    case 'admission_bed': {
      const canonicalPublicId = projection.admissionPublicId;
      if (typeof canonicalPublicId !== 'string' || canonicalPublicId === '') {
        throw new CriticalReadShadowBatchError('MAPPING_REQUIRED', 'admission shadow read requires one exact admission mapping');
      }
      return { sourceRowKey: `admissions:${record.legacyId}`, canonicalRowKey: `canonical_admissions:${canonicalPublicId}` };
    }
  }
}

function assertIdentityShadowResult(
  record: Exclude<CriticalReadShadowBatchRecord, { provider: 'compensation_accrual' }>,
  result: IdentityEpisodeReadAdapterResult<unknown>,
): { receipt: IdentityEpisodeShadowEvidenceReceipt; sourceRowKey: string; canonicalRowKey: string } {
  if (result.projection == null || (result.projection as { mode?: string }).mode !== 'shadow') {
    throw new CriticalReadShadowBatchError('SHADOW_MODE_REQUIRED', `${record.provider}:${record.legacyId} must run in shadow mode`);
  }
  const receipt = result.shadowEvidence;
  if (!receipt) {
    throw new CriticalReadShadowBatchError('SHADOW_EVIDENCE_MISSING', `${record.provider}:${record.legacyId} produced no shadow evidence`);
  }
  if (!receipt.parity || receipt.criticalUnexplainedVarianceCount !== 0 || receipt.varianceIds.length !== 0) {
    throw new CriticalReadShadowBatchError(
      'UNEXPLAINED_VARIANCE',
      `${record.provider}:${record.legacyId} produced unexplained shadow variance`,
      [...receipt.varianceIds],
    );
  }
  return { receipt, ...identityKeys(record, result) };
}

function assertCompensationShadowResult(
  record: Extract<CriticalReadShadowBatchRecord, { provider: 'compensation_accrual' }>,
  result: CompensationAccrualReadResult,
): { sourceRowKey: string; canonicalRowKey: string } {
  if (result.mode !== 'shadow' || result.selectedProvider !== 'legacy') {
    throw new CriticalReadShadowBatchError('SHADOW_MODE_REQUIRED', `compensation_accrual:${record.legacyId} must run in shadow mode`);
  }
  const evidence = result.shadowEvidence;
  if (!evidence) {
    throw new CriticalReadShadowBatchError('SHADOW_EVIDENCE_MISSING', `compensation_accrual:${record.legacyId} produced no shadow evidence`);
  }
  if (evidence.canonicalRowKey == null) {
    throw new CriticalReadShadowBatchError('MAPPING_REQUIRED', `compensation_accrual:${record.legacyId} has no exact Canonical mapping`, [...evidence.varianceIds]);
  }
  if (!evidence.parity || evidence.criticalUnexplainedVarianceCount !== 0 || evidence.varianceIds.length !== 0) {
    throw new CriticalReadShadowBatchError(
      'UNEXPLAINED_VARIANCE',
      `compensation_accrual:${record.legacyId} produced unexplained shadow variance`,
      [...evidence.varianceIds],
    );
  }
  return { sourceRowKey: evidence.sourceRowKey, canonicalRowKey: evidence.canonicalRowKey };
}

async function executeRecord(
  db: CriticalReadDatabase,
  input: Omit<CriticalReadShadowBatchInput, 'records'>,
  record: CriticalReadShadowBatchRecord,
  dependencies: CriticalReadConsumerDependencies,
): Promise<CriticalReadShadowBatchRow> {
  const elapsedMs = financialReadNonNegativeInteger(record.elapsedMs, 'record.elapsedMs');
  const commonEvidence = {
    observedAtUtc: input.observedAtUtc,
    elapsedMs,
    errorCount: 0,
    latencyBudgetMs: input.latencyBudgetMs,
    acceptedExceptionIds: [],
    consumerId: CRITICAL_READ_CONSUMER_IDS[record.provider],
  };

  if (record.provider === 'compensation_accrual') {
    const result = await dependencies.compensation(db, {
      tenantId: input.tenantId,
      legacyAccrualId: positiveInteger(record.legacyId, 'legacyAccrualId'),
      consumerId: CRITICAL_READ_CONSUMER_IDS.compensation_accrual,
      observedAtUtc: input.observedAtUtc,
      elapsedMs,
      latencyBudgetMs: input.latencyBudgetMs,
      buildSha: input.buildSha,
    });
    const keys = assertCompensationShadowResult(record, result);
    return {
      provider: record.provider,
      consumerId: CRITICAL_READ_CONSUMER_IDS[record.provider],
      ...keys,
      elapsedMs,
      latencyBudgetMs: input.latencyBudgetMs,
      varianceIds: [],
      rollbackMode: 'legacy',
    };
  }

  let result: IdentityEpisodeReadAdapterResult<unknown>;
  switch (record.provider) {
    case 'patient_identity':
      result = await readPatientIdentityAdapter(db, {
        tenantId: input.tenantId,
        legacyPatientId: positiveInteger(record.legacyId, 'legacyPatientId'),
      }, commonEvidence, dependencies.identity);
      break;
    case 'practitioner':
      result = await readPractitionerAdapter(db, {
        tenantId: input.tenantId,
        sourceType: 'legacy_doctor',
        legacyId: positiveInteger(record.legacyId, 'legacyPractitionerId'),
      }, commonEvidence, dependencies.identity);
      break;
    case 'appointment':
      result = await readAppointmentAdapter(db, {
        tenantId: input.tenantId,
        sourceType: 'legacy_appointment',
        legacyId: positiveInteger(record.legacyId, 'legacyAppointmentId'),
        timezone: exactFinancialReadValue(record.timezone, 'timezone'),
      }, commonEvidence, dependencies.identity);
      break;
    case 'encounter':
      result = await readEncounterAdapter(db, {
        tenantId: input.tenantId,
        sourceType: 'legacy_visit',
        legacyId: positiveInteger(record.legacyId, 'legacyVisitId'),
      }, commonEvidence, dependencies.identity);
      break;
    case 'admission_bed':
      result = await readAdmissionBedAdapter(db, {
        tenantId: input.tenantId,
        legacyAdmissionId: positiveInteger(record.legacyId, 'legacyAdmissionId'),
      }, commonEvidence, dependencies.identity);
      break;
  }

  const clean = assertIdentityShadowResult(record, result);
  await persistIdentityEpisodeEvidence(db, {
    tenantId: input.tenantId,
    provider: record.provider,
    sourceRowKey: clean.sourceRowKey,
    canonicalRowKey: clean.canonicalRowKey,
    sourcePublicId: String(record.legacyId),
    buildSha: input.buildSha,
    receipt: clean.receipt,
  });
  return {
    provider: record.provider,
    consumerId: CRITICAL_READ_CONSUMER_IDS[record.provider],
    sourceRowKey: clean.sourceRowKey,
    canonicalRowKey: clean.canonicalRowKey,
    elapsedMs,
    latencyBudgetMs: input.latencyBudgetMs,
    varianceIds: [],
    rollbackMode: 'legacy',
  };
}

export async function runCriticalReadShadowBatch(
  db: CriticalReadDatabase,
  raw: CriticalReadShadowBatchInput,
  dependencies: CriticalReadConsumerDependencies = DEFAULT_DEPENDENCIES,
): Promise<CriticalReadShadowBatchResult> {
  const tenantId = exactFinancialReadValue(raw.tenantId, 'tenantId');
  const observedAtUtc = financialReadUtcTimestamp(raw.observedAtUtc, 'observedAtUtc');
  const buildSha = exactFinancialReadValue(raw.buildSha, 'buildSha');
  const latencyBudgetMs = financialReadNonNegativeInteger(raw.latencyBudgetMs, 'latencyBudgetMs');
  if (latencyBudgetMs <= 0) throw new RangeError('latencyBudgetMs must be positive');
  if (raw.records.length === 0) throw new CriticalReadShadowBatchError('EMPTY_BATCH', 'critical read shadow batch requires at least one record');
  if (raw.records.length > 100) throw new CriticalReadShadowBatchError('BATCH_LIMIT_EXCEEDED', 'critical read shadow batch is limited to 100 records');

  const scopes = new Set<string>();
  for (const record of raw.records) {
    const key = scope(record);
    if (scopes.has(key)) throw new CriticalReadShadowBatchError('DUPLICATE_SCOPE', `duplicate critical read shadow scope ${key}`);
    scopes.add(key);
  }

  const rows: CriticalReadShadowBatchRow[] = [];
  for (const record of raw.records) {
    try {
      rows.push(await executeRecord(db, {
        tenantId,
        observedAtUtc,
        latencyBudgetMs,
        buildSha,
      }, record, dependencies));
    } catch (error) {
      if (error instanceof CriticalReadShadowBatchError) throw error;
      throw new CriticalReadShadowBatchError(
        'PROVIDER_FAILURE',
        `${record.provider}:${record.legacyId} failed closed before shadow batch completion`,
        [],
        error,
      );
    }
  }

  return {
    checkpoint: 'CDB-V1-040C',
    tenantId,
    buildSha,
    observedAtUtc,
    recordCount: rows.length,
    parity: true,
    varianceIds: [],
    rollbackMode: 'legacy',
    rows,
  };
}

export interface ReceptionPatientContextCriticalReadInput {
  tenantId: string;
  patientId: number;
  visits: ReadonlyArray<{ id: number; doctorId?: number | null; appointmentId?: number | null }>;
  activeAdmission?: { id: number; doctorId?: number | null } | null;
  timezone: string;
  observedAtUtc: string;
  latencyBudgetMs: number;
  buildSha: string;
}

export async function observeReceptionPatientContextCriticalReads(
  db: CriticalReadDatabase,
  input: ReceptionPatientContextCriticalReadInput,
  dependencies: CriticalReadConsumerDependencies = DEFAULT_DEPENDENCIES,
): Promise<CriticalReadShadowBatchResult | null> {
  const tenantId = exactFinancialReadValue(input.tenantId, 'tenantId');
  const [patientMode, practitionerMode, appointmentMode, encounterMode, admissionMode] = await Promise.all([
    resolvePatientIdentityProviderMode(db, tenantId),
    resolvePractitionerProviderMode(db, tenantId),
    resolveAppointmentProviderMode(db, tenantId),
    resolveEncounterProviderMode(db, tenantId),
    resolveAdmissionBedProviderMode(db, tenantId),
  ]);
  const modes = [patientMode, practitionerMode, appointmentMode, encounterMode, admissionMode];
  if (modes.some((mode) => mode === 'canonical')) {
    throw new CriticalReadShadowBatchError(
      'CANONICAL_MODE_BLOCKED',
      'Reception patient context remains a legacy-response consumer; Canonical promotion requires a separate authorized response contract',
    );
  }

  const records: CriticalReadShadowBatchRecord[] = [];
  if (patientMode === 'shadow') records.push({ provider: 'patient_identity', legacyId: input.patientId, elapsedMs: 0 });
  if (practitionerMode === 'shadow') {
    const doctorIds = new Set<number>();
    for (const visit of input.visits) if (visit.doctorId && visit.doctorId > 0) doctorIds.add(visit.doctorId);
    if (input.activeAdmission?.doctorId && input.activeAdmission.doctorId > 0) doctorIds.add(input.activeAdmission.doctorId);
    for (const doctorId of doctorIds) records.push({ provider: 'practitioner', legacyId: doctorId, elapsedMs: 0 });
  }
  if (appointmentMode === 'shadow') {
    const appointmentIds = new Set<number>();
    for (const visit of input.visits) if (visit.appointmentId && visit.appointmentId > 0) appointmentIds.add(visit.appointmentId);
    for (const appointmentId of appointmentIds) {
      records.push({ provider: 'appointment', legacyId: appointmentId, timezone: input.timezone, elapsedMs: 0 });
    }
  }
  if (encounterMode === 'shadow') {
    for (const visit of input.visits) {
      if (visit.id > 0) records.push({ provider: 'encounter', legacyId: visit.id, elapsedMs: 0 });
    }
  }
  if (admissionMode === 'shadow' && input.activeAdmission?.id && input.activeAdmission.id > 0) {
    records.push({ provider: 'admission_bed', legacyId: input.activeAdmission.id, elapsedMs: 0 });
  }
  if (records.length === 0) return null;

  return runCriticalReadShadowBatch(db, {
    tenantId,
    observedAtUtc: input.observedAtUtc,
    latencyBudgetMs: input.latencyBudgetMs,
    buildSha: input.buildSha,
    records,
  }, dependencies);
}
