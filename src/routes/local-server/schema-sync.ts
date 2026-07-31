import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import type { D1Database } from '@cloudflare/workers-types';
import { authMiddleware } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import {
  reconcileLocal,
  applyMigration,
  applyMigrationExec,
  recordApproval,
  setApprovalStatus,
  logEvent,
  type Manifest,
  type ManifestEntry,
} from '../../lib/local-server/schema-sync';

const schemaSyncRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

// ─── Signed-secret authentication (P0-06) ─────────────────────────────────
// Per-tenant signed-secret trust replaces the previous X-Internal-Schema-Sync
// static header. Each tenant has its own HMAC-SHA256 secret configured via
// `wrangler secret put HMS_LOCAL_SERVER_SYNC_SECRET`. The caller must send:
//
//   X-Sync-Schema-Version: <version>
//   X-Sync-Timestamp:      <unix ms>
//   X-Sync-Signature:      <hex hmac sha256 of `${version}\n${timestamp}\n${body}`

const SYNC_REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function getSyncSecret(env: Env): string | null {
  const secret =
    env.HMS_LOCAL_SERVER_SYNC_SECRET ?? env.LOCAL_SERVER_SYNC_SECRET ?? null;
  return secret && secret.length >= 32 ? secret : null;
}

function signSyncPayload(secret: string, version: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret)
    .update(`${version}\n${timestamp}\n${body}`)
    .digest('hex');
}

async function verifySyncSignature(c: Ctx, body: string): Promise<{ ok: true; version: string } | { ok: false; reason: string }> {
  const secret = getSyncSecret(c.env);
  if (!secret) {
    return { ok: false, reason: 'sync secret not configured' };
  }
  const version = c.req.header('X-Sync-Schema-Version');
  const timestampHeader = c.req.header('X-Sync-Timestamp');
  const provided = c.req.header('X-Sync-Signature');
  if (!version || !timestampHeader || !provided) {
    return { ok: false, reason: 'missing sync signature headers' };
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'invalid sync timestamp' };
  }
  const drift = Math.abs(Date.now() - timestamp);
  if (drift > SYNC_REPLAY_WINDOW_MS) {
    return { ok: false, reason: 'sync timestamp out of window' };
  }
  const expected = signSyncPayload(secret, version, String(timestamp), body);
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'sync signature mismatch' };
  }
  return { ok: true, version };
}

// ─── Destructive SQL denylist (P0-06) ───────────────────────────────────────
const DESTRUCTIVE_KEYWORDS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bTRUNCATE\b/i,
  /\bDROP\s+INDEX\b/i,
];

function containsDestructiveKeyword(sql: string): string | null {
  for (const re of DESTRUCTIVE_KEYWORDS) {
    if (re.test(sql)) return re.source;
  }
  return null;
}

// ─── Approval payload (P0-06) ──────────────────────────────────────────────
const approvalPayloadSchema = z.object({
  filename: z.string().min(1).max(256),
  sql: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  justification: z.string().min(8).max(2000),
  approverUserId: z.string().min(1).max(128),
});

const manifestEntrySchema = z.object({
  filename: z.string().min(1).max(256),
  order: z.number(),
  safety: z.enum(['safe', 'destructive']),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sql: z.string().min(1),
});

const syncBodySchema = z.object({
  version: z.string().min(1),
  migrations: z.array(manifestEntrySchema),
});

function auditEvent(
  db: D1Database,
  filename: string,
  event: string,
  actor: string,
  message?: string,
): Promise<void> {
  return logEvent(db, filename, event as any, actor, message);
}

async function syncHandler(c: Ctx): Promise<Response> {
  const rawBody = await c.req.text();
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const sig = await verifySyncSignature(c, rawBody);
  if (!sig.ok) {
    return c.json({ error: `Forbidden: ${sig.reason}` }, 403);
  }
  const parsed = syncBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid manifest body' }, 400);
  }
  const manifest: Manifest = parsed.data;

  const result = await reconcileLocal(c.env.DB, manifest);
  const dryRun = c.env.HMS_LOCAL_SCHEMA_SYNC_DRY_RUN === '1';
  const maxPerCycle = Number(c.env.HMS_LOCAL_SCHEMA_SYNC_MAX_PER_CYCLE ?? '5');

  let applied = 0;
  let queued = 0;
  const failures: { filename: string; error: string }[] = [];

  const actor = `signed:${sig.version}`;

  for (const m of result.toApply.slice(0, maxPerCycle)) {
    const destructive = containsDestructiveKeyword(m.sql);
    if (destructive) {
      await recordApproval(c.env.DB, m);
      await auditEvent(c.env.DB, m.filename, 'queued', actor, `destructive SQL blocked: ${destructive}`);
      queued += 1;
      continue;
    }
    if (dryRun) {
      await auditEvent(c.env.DB, m.filename, 'detected', actor, 'dry-run: would apply');
      continue;
    }
    const r = await applyMigration(c.env.DB, m);
    if (r.error) {
      failures.push({ filename: m.filename, error: r.error });
      await auditEvent(c.env.DB, m.filename, 'failed', actor, r.error);
    } else {
      applied += 1;
      await auditEvent(c.env.DB, m.filename, 'applied', actor, `${r.duration_ms}ms`);
    }
  }

  for (const m of result.toQueue) {
    await recordApproval(c.env.DB, m);
    await auditEvent(c.env.DB, m.filename, 'queued', actor, 'destructive migration detected');
    queued += 1;
  }

  for (const d of result.drift) {
    await auditEvent(
      c.env.DB,
      d.filename,
      'drift',
      actor,
      `local=${d.localHash} cloud=${d.cloudHash}`,
    );
  }

  return c.json({
    version: manifest.version,
    applied,
    queued,
    drift: result.drift.length,
    alreadyApplied: result.alreadyApplied.length,
    failures,
  });
}

async function applyApprovedHandler(c: Ctx): Promise<Response> {
  const rawBody = await c.req.text();
  const sig = await verifySyncSignature(c, rawBody);
  if (!sig.ok) {
    return c.json({ error: `Forbidden: ${sig.reason}` }, 403);
  }
  const rows = await c.env.DB
    .prepare(
      `SELECT filename, safety, content_hash, sql_content
       FROM local_schema_sync_approvals
       WHERE status = 'approved'`,
    )
    .all<{ filename: string; safety: string; content_hash: string; sql_content: string }>();

  let applied = 0;
  const failures: { filename: string; error: string }[] = [];
  const actor = `signed:${sig.version}`;

  for (const r of rows.results ?? []) {
    const migration: ManifestEntry = {
      filename: r.filename,
      order: 0,
      safety: r.safety as 'safe' | 'destructive',
      contentHash: r.content_hash,
      sql: r.sql_content,
    };
    const destructive = containsDestructiveKeyword(migration.sql);
    if (destructive) {
      failures.push({ filename: r.filename, error: `destructive SQL blocked: ${destructive}` });
      await c.env.DB
        .prepare(
          `UPDATE local_schema_sync_approvals SET status = 'failed', apply_error = ? WHERE filename = ?`,
        )
        .bind(`destructive SQL blocked: ${destructive}`, r.filename)
        .run();
      await auditEvent(c.env.DB, r.filename, 'failed', actor, `destructive SQL blocked: ${destructive}`);
      continue;
    }
    const result = await applyMigrationExec(c.env.DB, migration);
    if (result.error) {
      failures.push({ filename: r.filename, error: result.error });
      await c.env.DB
        .prepare(
          `UPDATE local_schema_sync_approvals SET status = 'failed', apply_error = ? WHERE filename = ?`,
        )
        .bind(result.error, r.filename)
        .run();
      await auditEvent(c.env.DB, r.filename, 'failed', actor, result.error);
    } else {
      applied += 1;
      await c.env.DB
        .prepare(
          `UPDATE local_schema_sync_approvals SET status = 'applied', applied_at = datetime('now') WHERE filename = ?`,
        )
        .bind(r.filename)
        .run();
      await auditEvent(c.env.DB, r.filename, 'applied', actor, `${result.duration_ms}ms`);
    }
  }
  return c.json({ applied, failures });
}

schemaSyncRoutes.post('/sync', syncHandler);
schemaSyncRoutes.post('/sync/apply-approved', applyApprovedHandler);

schemaSyncRoutes.get('/status', authMiddleware, async (c) => {
  const applied = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM local_schema_migrations')
    .first<{ n: number }>();
  const pending = await c.env.DB
    .prepare(`SELECT COUNT(*) AS n FROM local_schema_sync_approvals WHERE status = 'pending'`)
    .first<{ n: number }>();
  const lastLog = await c.env.DB
    .prepare(
      `SELECT created_at, event, filename FROM local_schema_sync_log ORDER BY id DESC LIMIT 1`,
    )
    .first<{ created_at: string; event: string; filename: string }>();
  return c.json({
    lastSyncAt: lastLog?.created_at ?? null,
    appliedCount: applied?.n ?? 0,
    pendingCount: pending?.n ?? 0,
    dryRun: c.env.HMS_LOCAL_SCHEMA_SYNC_DRY_RUN === '1',
  });
});

schemaSyncRoutes.get('/approvals', authMiddleware, async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, filename, safety, content_hash, sql_content, status, reviewed_by,
              reviewed_at, apply_error, detected_at, applied_at
       FROM local_schema_sync_approvals
       WHERE status IN ('pending', 'approved', 'failed')
       ORDER BY detected_at DESC`,
    )
    .all();
  return c.json({ approvals: rows.results ?? [] });
});

schemaSyncRoutes.get('/log', authMiddleware, async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 500);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, filename, event, actor, message, created_at
       FROM local_schema_sync_log
       ORDER BY id DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all();
  return c.json({ log: rows.results ?? [] });
});

schemaSyncRoutes.post(
  '/approvals/:filename/approve',
  authMiddleware,
  requirePermission('schema.sync.approve'),
  async (c) => {
    const filename = c.req.param('filename');
    const rawBody = await c.req.text();
    let payload: z.infer<typeof approvalPayloadSchema>;
    try {
      payload = approvalPayloadSchema.parse(JSON.parse(rawBody || '{}'));
    } catch (err) {
      return c.json(
        { error: 'Invalid approval payload', detail: err instanceof Error ? err.message : 'parse error' },
        400,
      );
    }
    if (payload.filename !== filename) {
      return c.json({ error: 'filename in payload does not match URL' }, 400);
    }
    const expectedSha = createHash('sha256').update(payload.sql).digest('hex');
    if (expectedSha !== payload.sha256) {
      return c.json({ error: 'sha256 mismatch between payload and sql' }, 400);
    }
    const destructive = containsDestructiveKeyword(payload.sql);
    if (destructive) {
      return c.json(
        { error: `destructive SQL blocked: ${destructive}` },
        400,
      );
    }
    const actor = `${c.get('userId') ?? 'unknown'}:${payload.approverUserId}`;
    await setApprovalStatus(c.env.DB, filename, 'approved', actor);
    await auditEvent(
      c.env.DB,
      filename,
      'approved',
      actor,
      `justification: ${payload.justification.slice(0, 240)}`,
    );
    return c.json({ ok: true });
  },
);

schemaSyncRoutes.post(
  '/approvals/:filename/reject',
  authMiddleware,
  requirePermission('schema.sync.approve'),
  async (c) => {
    const filename = c.req.param('filename');
    const actor = c.get('userId') ?? 'unknown';
    await setApprovalStatus(c.env.DB, filename, 'rejected', actor);
    await auditEvent(c.env.DB, filename, 'rejected', actor);
    return c.json({ ok: true });
  },
);

export default schemaSyncRoutes;
export { schemaSyncRoutes };
