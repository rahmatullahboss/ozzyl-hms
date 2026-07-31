import type { CanonicalBatchDatabase } from './command-batch';
import {
  ensureAdmissionEncounter,
  type EnsureAdmissionEncounterInput,
  type EnsureAdmissionEncounterResult,
} from './commands/ensure-admission-encounter';
import { createRequestFingerprint } from './idempotency';
import { resolveStrictFinancialPolicy } from './strict-financial-policy';
import { createDeterministicSourceId } from './source-mapping';
import { normalizeLegacyAdmissionInstantUtc } from '../admission-time';

export function normalizeLegacyAdmissionStartedAtUtc(value: string): string {
  return normalizeLegacyAdmissionInstantUtc({
    admissionDate: value,
    naiveSemantics: 'asia_dhaka',
  });
}

export const ADMISSION_CONTINUITY_ERROR_CODE = 'CANONICAL_ADMISSION_CONTINUITY_FAILED';
const ISSUE_TYPE = 'admission_continuity';

export type LiveAdmissionContinuityResult =
  | { status: 'skipped' }
  | { status: 'applied' | 'replayed'; result: EnsureAdmissionEncounterResult }
  | { status: 'failed'; errorCode: typeof ADMISSION_CONTINUITY_ERROR_CODE };

function safeCauseName(cause: unknown): string {
  if (!(cause instanceof Error)) return typeof cause;
  const name = cause.name.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(name) ? name : 'Error';
}

function safeCauseCode(cause: unknown): string | null {
  if (!cause || typeof cause !== 'object') return null;
  const code = (cause as { code?: unknown }).code;
  if (typeof code !== 'string' && typeof code !== 'number') return null;
  const normalized = String(code).trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(normalized) ? normalized : null;
}

function causeMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'Non-Error admission continuity failure';
}

async function recordAdmissionContinuityIssue(
  db: CanonicalBatchDatabase,
  input: EnsureAdmissionEncounterInput,
  cause: unknown,
): Promise<void> {
  const causeName = safeCauseName(cause);
  const causeCode = safeCauseCode(cause);
  const causeMessageHash = await createRequestFingerprint({
    schemaVersion: 1,
    tenantId: input.tenantId,
    issueCode: ADMISSION_CONTINUITY_ERROR_CODE,
    message: causeMessage(cause),
  });
  const fingerprint = await createRequestFingerprint({
    schemaVersion: 1,
    issueCode: ADMISSION_CONTINUITY_ERROR_CODE,
    legacyAdmissionId: input.legacyAdmissionId,
    causeName,
    causeCode,
    causeMessageHash,
  });
  const issuePublicId = await createDeterministicSourceId(
    'canissue',
    input.tenantId,
    ISSUE_TYPE,
    `${input.legacyAdmissionId}:${fingerprint}`,
  );
  const nowUtc = new Date().toISOString();
  const detailsJson = JSON.stringify({
    schemaVersion: 1,
    causeName,
    causeCode,
    causeMessageHash,
    legacyAuthorityCommitted: true,
  });

  await db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,issue_type,issue_code,entity_type,entity_public_id,
      source_type,source_public_id,fingerprint,severity,status,occurrence_count,
      summary,details_json,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (
      ?,?,'admission_continuity',?,'canonical_encounter',?,
      'runtime_shadow_write',?,?,'error','open',1,
      'Canonical admission continuity projection failed after legacy admission committed.',
      ?,?,?,?,?
    )
    ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,
      updated_at_utc=excluded.updated_at_utc,
      details_json=excluded.details_json,
      status=CASE
        WHEN canonical_processing_issues.status IN ('resolved','waived') THEN 'open'
        ELSE canonical_processing_issues.status
      END,
      resolved_at_utc=CASE
        WHEN canonical_processing_issues.status IN ('resolved','waived') THEN NULL
        ELSE canonical_processing_issues.resolved_at_utc
      END,
      resolved_by_public_id=CASE
        WHEN canonical_processing_issues.status IN ('resolved','waived') THEN NULL
        ELSE canonical_processing_issues.resolved_by_public_id
      END,
      resolution_code=CASE
        WHEN canonical_processing_issues.status IN ('resolved','waived') THEN NULL
        ELSE canonical_processing_issues.resolution_code
      END
  `).bind(
    input.tenantId,
    issuePublicId,
    ADMISSION_CONTINUITY_ERROR_CODE,
    String(input.legacyAdmissionId),
    String(input.legacyAdmissionId),
    fingerprint,
    detailsJson,
    nowUtc,
    nowUtc,
    nowUtc,
    nowUtc,
  ).run();
}

export async function ensureLiveAdmissionContinuity(
  db: CanonicalBatchDatabase,
  input: EnsureAdmissionEncounterInput,
): Promise<LiveAdmissionContinuityResult> {
  try {
    const policy = await resolveStrictFinancialPolicy(db, input.tenantId);
    if (!policy.enabled) return { status: 'skipped' };
    return await ensureAdmissionEncounter(db, input);
  } catch (cause) {
    try {
      await recordAdmissionContinuityIssue(db, input, cause);
    } catch (recordingCause) {
      console.error('Canonical admission continuity issue recording failed', {
        tenantId: input.tenantId,
        legacyAdmissionId: input.legacyAdmissionId,
        causeName: safeCauseName(recordingCause),
        causeCode: safeCauseCode(recordingCause),
      });
    }
    return { status: 'failed', errorCode: ADMISSION_CONTINUITY_ERROR_CODE };
  }
}
