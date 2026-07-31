import type {
  CanonicalBatchDatabase,
  CanonicalCommandExecutionOptions,
  CanonicalPreparedStatement,
} from './command-batch';
import { createRequestFingerprint } from './idempotency';
import { createDeterministicSourceId } from './source-mapping';
import type { StrictFinancialBoundary } from './strict-financial-boundaries';
import {
  CanonicalStrictFinancialError,
  resolveStrictFinancialPolicy,
} from './strict-financial-policy';

export type FinancialMutationExecution<T> =
  | { mode: 'legacy'; result: unknown[] }
  | { mode: 'strict'; result: T }
  | {
      mode: 'shadow';
      result: unknown[];
      canonicalSucceeded: true;
      canonicalResult: T;
    }
  | {
      mode: 'shadow';
      result: unknown[];
      canonicalSucceeded: false;
      canonicalErrorCode: 'CANONICAL_SHADOW_WRITE_FAILED';
    };

export type StrictAuthoritativeStatements =
  | readonly CanonicalPreparedStatement[]
  | (() => readonly CanonicalPreparedStatement[])
  | (() => Promise<readonly CanonicalPreparedStatement[]>);

const CANONICAL_SHADOW_ISSUE_TYPE = 'financial_shadow_write';
const CANONICAL_SHADOW_ISSUE_CODE = 'CANONICAL_SHADOW_WRITE_FAILED';

const SAFE_CANONICAL_ERROR_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

function canonicalFailureName(cause: unknown): string {
  if (cause instanceof Error) {
    const normalized = cause.name.trim();
    return SAFE_CANONICAL_ERROR_IDENTIFIER.test(normalized) ? normalized : 'Error';
  }
  return typeof cause;
}

function canonicalFailureCode(cause: unknown): string | null {
  if (!cause || typeof cause !== 'object') return null;
  const code = (cause as { code?: unknown }).code;
  if (typeof code !== 'string' && typeof code !== 'number') return null;
  const normalized = String(code).trim();
  return SAFE_CANONICAL_ERROR_IDENTIFIER.test(normalized) ? normalized : null;
}

function canonicalFailureMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  return 'Non-Error canonical shadow failure';
}

async function recordCanonicalShadowFailure(input: {
  db: CanonicalBatchDatabase;
  tenantId: string;
  boundary: StrictFinancialBoundary;
  cause: unknown;
}): Promise<void> {
  const causeName = canonicalFailureName(input.cause);
  const causeCode = canonicalFailureCode(input.cause);
  const causeMessageHash = await createRequestFingerprint({
    schemaVersion: 1,
    tenantId: input.tenantId,
    boundary: input.boundary,
    message: canonicalFailureMessage(input.cause),
  });
  const fingerprint = await createRequestFingerprint({
    schemaVersion: 1,
    issueCode: CANONICAL_SHADOW_ISSUE_CODE,
    boundary: input.boundary,
    causeName,
    causeCode,
    causeMessageHash,
  });
  const issuePublicId = await createDeterministicSourceId(
    'canissue',
    input.tenantId,
    CANONICAL_SHADOW_ISSUE_TYPE,
    `${input.boundary}:${fingerprint}`,
  );
  const nowUtc = new Date().toISOString();
  const detailsJson = JSON.stringify({
    schemaVersion: 1,
    boundary: input.boundary,
    causeName,
    causeCode,
    causeMessageHash,
    legacyAuthorityCommitted: true,
  });

  console.error('Canonical financial shadow write failed', {
    tenantId: input.tenantId,
    boundary: input.boundary,
    causeName,
    causeCode,
    causeMessageHash,
  });

  try {
    await input.db.prepare(`
      INSERT INTO canonical_processing_issues (
        tenant_id, issue_public_id, issue_type, issue_code, entity_type, entity_public_id,
        source_type, source_public_id, fingerprint, severity, status, occurrence_count,
        summary, details_json, first_seen_at_utc, last_seen_at_utc, created_at_utc, updated_at_utc
      ) VALUES (
        ?, ?, '${CANONICAL_SHADOW_ISSUE_TYPE}', '${CANONICAL_SHADOW_ISSUE_CODE}',
        'financial_boundary', ?, 'runtime_shadow_write', ?, ?, 'error', 'open', 1,
        'Canonical shadow write failed after the legacy financial mutation committed.', ?, ?, ?, ?, ?
      )
      ON CONFLICT(tenant_id, issue_type, fingerprint) DO UPDATE SET
        occurrence_count = canonical_processing_issues.occurrence_count + 1,
        last_seen_at_utc = excluded.last_seen_at_utc,
        updated_at_utc = excluded.updated_at_utc,
        summary = excluded.summary,
        details_json = excluded.details_json,
        status = CASE
          WHEN canonical_processing_issues.status IN ('resolved', 'waived') THEN 'open'
          ELSE canonical_processing_issues.status
        END,
        resolved_at_utc = CASE
          WHEN canonical_processing_issues.status IN ('resolved', 'waived') THEN NULL
          ELSE canonical_processing_issues.resolved_at_utc
        END,
        resolved_by_public_id = CASE
          WHEN canonical_processing_issues.status IN ('resolved', 'waived') THEN NULL
          ELSE canonical_processing_issues.resolved_by_public_id
        END,
        resolution_code = CASE
          WHEN canonical_processing_issues.status IN ('resolved', 'waived') THEN NULL
          ELSE canonical_processing_issues.resolution_code
        END
    `).bind(
      input.tenantId,
      issuePublicId,
      input.boundary,
      input.boundary,
      fingerprint,
      detailsJson,
      nowUtc,
      nowUtc,
      nowUtc,
      nowUtc,
    ).run();
  } catch (recordingCause) {
    console.error('Canonical financial shadow issue recording failed', {
      tenantId: input.tenantId,
      boundary: input.boundary,
      causeName: canonicalFailureName(recordingCause),
      causeCode: canonicalFailureCode(recordingCause),
    });
  }
}

async function runLegacyStatements(
  db: CanonicalBatchDatabase,
  statements: readonly CanonicalPreparedStatement[],
): Promise<unknown[]> {
  return statements.length > 0 ? db.batch([...statements]) : [];
}

export async function executeStrictFinancialMutation<T>(input: {
  db: CanonicalBatchDatabase;
  tenantId: string;
  boundary: StrictFinancialBoundary;
  /**
   * Original production legacy authority. Risky integrations must provide this
   * executor instead of rebuilding legacy behavior from strict-only statements.
   */
  legacyExecutor?: () => Promise<unknown[]>;
  /**
   * Compatibility input for boundaries whose strict and legacy statement sets
   * are intentionally identical. New guarded integrations should use the split
   * executor and strictAuthoritativeStatements fields.
   */
  legacyStatements?: readonly CanonicalPreparedStatement[];
  /**
   * Guarded statements admitted only to the strict atomic command. Use a factory
   * when preparing them performs strict-only validation or touches strict schema.
   */
  strictAuthoritativeStatements?: StrictAuthoritativeStatements;
  /** Original post-commit legacy side effects; never part of the financial batch. */
  legacyPostCommit?: () => Promise<void>;
  canonical: (execution: CanonicalCommandExecutionOptions) => Promise<T>;
}): Promise<FinancialMutationExecution<T>> {
  const runLegacyAuthority = (): Promise<unknown[]> => input.legacyExecutor
    ? input.legacyExecutor()
    : runLegacyStatements(input.db, input.legacyStatements ?? []);
  const bundledLegacyStatements = input.legacyStatements as (readonly CanonicalPreparedStatement[] & {
    strictAuthoritativeStatements?: StrictAuthoritativeStatements;
    legacyPostCommit?: () => Promise<void>;
  }) | undefined;
  const resolveStrictAuthoritativeStatements = async (): Promise<readonly CanonicalPreparedStatement[]> => {
    const configured = input.strictAuthoritativeStatements
      ?? bundledLegacyStatements?.strictAuthoritativeStatements;
    if (typeof configured === 'function') return await configured();
    return configured ?? input.legacyStatements ?? [];
  };
  const legacyPostCommit = input.legacyPostCommit ?? bundledLegacyStatements?.legacyPostCommit;
  const runLegacyPostCommitBestEffort = async (): Promise<void> => {
    if (!legacyPostCommit) return;
    try {
      await legacyPostCommit();
    } catch (cause) {
      console.error('Legacy financial post-commit side effect failed', {
        boundary: input.boundary,
        tenantId: input.tenantId,
        cause,
      });
    }
  };

  const policy = await resolveStrictFinancialPolicy(input.db, input.tenantId);
  if (!policy.enabled) {
    const legacyResult = await runLegacyAuthority();
    await runLegacyPostCommitBestEffort();
    return {
      mode: 'legacy',
      result: legacyResult,
    };
  }

  if (policy.writePolicy === 'shadow') {
    const legacyResult = await runLegacyAuthority();
    await runLegacyPostCommitBestEffort();
    try {
      return {
        mode: 'shadow',
        result: legacyResult,
        canonicalSucceeded: true,
        canonicalResult: await input.canonical({}),
      };
    } catch (cause) {
      try {
        await recordCanonicalShadowFailure({
          db: input.db,
          tenantId: input.tenantId,
          boundary: input.boundary,
          cause,
        });
      } catch (recordingCause) {
        console.error('Canonical financial shadow issue preparation failed', {
          tenantId: input.tenantId,
          boundary: input.boundary,
          causeName: canonicalFailureName(recordingCause),
          causeCode: canonicalFailureCode(recordingCause),
        });
      }
      return {
        mode: 'shadow',
        result: legacyResult,
        canonicalSucceeded: false,
        canonicalErrorCode: 'CANONICAL_SHADOW_WRITE_FAILED',
      };
    }
  }

  try {
    const authoritativeStatements = await resolveStrictAuthoritativeStatements();
    return {
      mode: 'strict',
      result: await input.canonical({ authoritativeStatements }),
    };
  } catch (cause) {
    throw new CanonicalStrictFinancialError(
      'CANONICAL_STRICT_WRITE_FAILED',
      'Canonical strict financial write failed',
      { cause },
    );
  }
}
