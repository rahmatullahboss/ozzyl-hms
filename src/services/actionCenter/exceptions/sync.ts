import type { D1Database, D1Result } from '@cloudflare/workers-types';
import {
  DEFAULT_EXCEPTION_DETECTORS,
  detectExceptionObservations,
} from './detectors';
import type {
  ExceptionDetector,
  ExceptionObservation,
} from './types';

interface ExceptionCaseRow {
  id: number;
  tenant_id: string;
  rule_key: string;
  fingerprint: string;
  status: string;
  metadata_json?: string | null;
  updated_at: string;
}

interface StoredPolicy {
  autoResolvable: boolean;
  allowRecurrence: boolean;
}

interface StoredMetadata extends Record<string, unknown> {
  _policy?: StoredPolicy;
}

const ACTIVE_STATUSES = new Set(['open', 'acknowledged', 'in_progress', 'snoozed']);

function policyFor(observation: ExceptionObservation): StoredPolicy {
  return {
    autoResolvable: observation.autoResolvable,
    allowRecurrence: observation.allowRecurrence,
  };
}

function serializeMetadata(observation: ExceptionObservation): string {
  return JSON.stringify({
    ...observation.metadata,
    _policy: policyFor(observation),
  } satisfies StoredMetadata);
}

function parsePolicy(metadataJson: string | null | undefined): StoredPolicy {
  try {
    const metadata = JSON.parse(metadataJson || '{}') as StoredMetadata;
    return {
      autoResolvable: metadata._policy?.autoResolvable === true,
      allowRecurrence: metadata._policy?.allowRecurrence === true,
    };
  } catch {
    return { autoResolvable: false, allowRecurrence: false };
  }
}

function changed(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta?.changes ?? 0);
}

async function findCase(
  db: D1Database,
  tenantId: string,
  ruleKey: string,
  fingerprint: string,
): Promise<ExceptionCaseRow | null> {
  return db.prepare(`
    SELECT id, tenant_id, rule_key, fingerprint, status, metadata_json, updated_at
    FROM admin_exception_cases
    WHERE tenant_id = ?
      AND rule_key = ?
      AND fingerprint = ?
    LIMIT 1
  `).bind(tenantId, ruleKey, fingerprint).first<ExceptionCaseRow>();
}

function observationUpsert(
  db: D1Database,
  tenantId: string,
  observation: ExceptionObservation,
  now: string,
) {
  return db.prepare(`
    INSERT INTO admin_exception_cases (
      tenant_id,
      rule_key,
      fingerprint,
      source_type,
      source_id,
      module,
      severity,
      title,
      description,
      source_href,
      status,
      first_detected_at,
      last_detected_at,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, rule_key, fingerprint) DO UPDATE SET
      source_type = excluded.source_type,
      source_id = excluded.source_id,
      module = excluded.module,
      severity = excluded.severity,
      title = excluded.title,
      description = excluded.description,
      source_href = excluded.source_href,
      last_detected_at = excluded.last_detected_at,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).bind(
    tenantId,
    observation.ruleKey,
    observation.fingerprint,
    observation.sourceType,
    observation.sourceId,
    observation.module,
    observation.severity,
    observation.title,
    observation.description,
    observation.sourceHref,
    now,
    now,
    serializeMetadata(observation),
    now,
    now,
  );
}

async function createObservedCase(
  db: D1Database,
  tenantId: string,
  actorId: number | undefined,
  observation: ExceptionObservation,
  now: string,
): Promise<boolean> {
  const statements = [
    observationUpsert(db, tenantId, observation, now),
    db.prepare(`
      INSERT INTO admin_exception_events (
        tenant_id,
        case_id,
        event_type,
        actor_id,
        old_status,
        new_status,
        note,
        metadata_json,
        created_at
      )
      SELECT ?, c.id, 'created', ?, NULL, 'open', ?, ?, ?
      FROM admin_exception_cases c
      WHERE c.tenant_id = ?
        AND c.rule_key = ?
        AND c.fingerprint = ?
        AND NOT EXISTS (
          SELECT 1
          FROM admin_exception_events e
          WHERE e.tenant_id = c.tenant_id
            AND e.case_id = c.id
            AND e.event_type = 'created'
        )
    `).bind(
      tenantId,
      actorId ?? null,
      'Exception detected by operational rule.',
      JSON.stringify({ ruleKey: observation.ruleKey }),
      now,
      tenantId,
      observation.ruleKey,
      observation.fingerprint,
    ),
  ];

  const results = await db.batch(statements);
  return changed(results[0]) > 0;
}

async function updateObservation(
  db: D1Database,
  tenantId: string,
  observation: ExceptionObservation,
  now: string,
): Promise<void> {
  await observationUpsert(db, tenantId, observation, now).run();
}

async function reopenObservedCase(input: {
  db: D1Database;
  tenantId: string;
  actorId?: number;
  caseId: number;
  now: string;
}): Promise<boolean> {
  const { db, tenantId, actorId, caseId, now } = input;
  const results = await db.batch([
    db.prepare(`
      UPDATE admin_exception_cases
      SET status = 'open',
          resolved_by = NULL,
          resolved_at = NULL,
          resolution_code = NULL,
          resolution_note = NULL,
          snoozed_until = NULL,
          updated_at = ?
      WHERE id = ?
        AND tenant_id = ?
        AND status = 'resolved'
        AND updated_at = ?
    `).bind(now, caseId, tenantId, now),
    db.prepare(`
      INSERT INTO admin_exception_events (
        tenant_id, case_id, event_type, actor_id, old_status, new_status, note, created_at
      )
      SELECT ?, id, 'reopened', ?, 'resolved', 'open', ?, ?
      FROM admin_exception_cases
      WHERE id = ?
        AND tenant_id = ?
        AND status = 'open'
        AND updated_at = ?
        AND changes() = 1
    `).bind(
      tenantId,
      actorId ?? null,
      'Recurring source condition detected again.',
      now,
      caseId,
      tenantId,
      now,
    ),
  ]);
  return changed(results[0]) > 0;
}

async function autoResolveCase(input: {
  db: D1Database;
  tenantId: string;
  actorId?: number;
  row: ExceptionCaseRow;
  now: string;
}): Promise<boolean> {
  const { db, tenantId, actorId, row, now } = input;
  const results = await db.batch([
    db.prepare(`
      UPDATE admin_exception_cases
      SET status = 'resolved',
          resolved_by = ?,
          resolved_at = ?,
          resolution_code = 'source_cleared',
          resolution_note = 'The source condition is no longer present.',
          snoozed_until = NULL,
          updated_at = ?
      WHERE id = ?
        AND tenant_id = ?
        AND status IN ('open', 'acknowledged', 'in_progress', 'snoozed')
        AND updated_at = ?
    `).bind(actorId ?? null, now, now, row.id, tenantId, row.updated_at),
    db.prepare(`
      INSERT INTO admin_exception_events (
        tenant_id, case_id, event_type, actor_id, old_status, new_status, note, created_at
      )
      SELECT ?, id, 'auto_resolved', ?, ?, 'resolved', ?, ?
      FROM admin_exception_cases
      WHERE id = ?
        AND tenant_id = ?
        AND status = 'resolved'
        AND updated_at = ?
        AND changes() = 1
    `).bind(
      tenantId,
      actorId ?? null,
      row.status,
      'The source condition is no longer present.',
      now,
      row.id,
      tenantId,
      now,
    ),
  ]);
  return changed(results[0]) > 0;
}

export async function syncExceptionCases(input: {
  db: D1Database;
  tenantId: string;
  actorId?: number;
  now: string;
  detectors?: readonly ExceptionDetector[];
}): Promise<{ observed: number; created: number; updated: number; autoResolved: number }> {
  const detectors = input.detectors ?? DEFAULT_EXCEPTION_DETECTORS;
  const observations = await detectExceptionObservations({
    db: input.db,
    tenantId: input.tenantId,
    now: input.now,
  }, detectors);

  let created = 0;
  let updated = 0;
  let autoResolved = 0;
  const observedKeys = new Set<string>();

  for (const observation of observations) {
    const key = `${observation.ruleKey}:${observation.fingerprint}`;
    observedKeys.add(key);
    const existing = await findCase(
      input.db,
      input.tenantId,
      observation.ruleKey,
      observation.fingerprint,
    );

    if (!existing) {
      if (await createObservedCase(
        input.db,
        input.tenantId,
        input.actorId,
        observation,
        input.now,
      )) {
        created += 1;
      }
      continue;
    }

    await updateObservation(input.db, input.tenantId, observation, input.now);
    updated += 1;

    if (existing.status === 'resolved' && observation.allowRecurrence) {
      await reopenObservedCase({
        db: input.db,
        tenantId: input.tenantId,
        actorId: input.actorId,
        caseId: existing.id,
        now: input.now,
      });
    }
  }

  const tenantCases = await input.db.prepare(`
    SELECT id, tenant_id, rule_key, fingerprint, status, metadata_json, updated_at
    FROM admin_exception_cases
    WHERE tenant_id = ?
  `).bind(input.tenantId).all<ExceptionCaseRow>();

  for (const row of tenantCases.results ?? []) {
    const key = `${row.rule_key}:${row.fingerprint}`;
    if (observedKeys.has(key) || !ACTIVE_STATUSES.has(row.status)) continue;
    const policy = parsePolicy(row.metadata_json);
    if (!policy.autoResolvable) continue;

    if (await autoResolveCase({
      db: input.db,
      tenantId: input.tenantId,
      actorId: input.actorId,
      row,
      now: input.now,
    })) {
      autoResolved += 1;
    }
  }

  return {
    observed: observations.length,
    created,
    updated,
    autoResolved,
  };
}
