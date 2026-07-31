import type { D1Database } from '@cloudflare/workers-types';

export type Safety = 'safe' | 'destructive';

export interface ManifestEntry {
  filename: string;
  order: number;
  safety: Safety;
  contentHash: string;
  sql: string;
}

export interface Manifest {
  version: string;
  migrations: ManifestEntry[];
}

export interface ReconciliationResult {
  toApply: ManifestEntry[];
  toQueue: ManifestEntry[];
  drift: { filename: string; localHash: string; cloudHash: string }[];
  alreadyApplied: ManifestEntry[];
}

const FILENAME_RE = /^(\d{4})(?:([dD])_|_)([a-z0-9_]+)\.sql$/i;

export function classifyMigration(filename: string): Safety {
  if (!FILENAME_RE.test(filename)) {
    throw new Error(
      `Migration filename must match NNNN_description.sql or NNNNd_description.sql: ${filename}`,
    );
  }
  return /^\d{4}[dD]_/.test(filename) ? 'destructive' : 'safe';
}

export async function reconcileLocal(
  db: D1Database,
  manifest: Manifest,
): Promise<ReconciliationResult> {
  const sorted = [...manifest.migrations].sort((a, b) => a.order - b.order);

  // Skip already-applied migrations by content_hash.
  await ensureMigrationsTable(db);
  const rowsResult = await db
    .prepare('SELECT filename, content_hash FROM local_schema_migrations')
    .all<{ filename: string; content_hash: string }>();
  const localByName = new Map<string, string>();
  for (const r of rowsResult.results ?? []) {
    localByName.set(r.filename, r.content_hash);
  }

  const toApply: ManifestEntry[] = [];
  const toQueue: ManifestEntry[] = [];
  const drift: { filename: string; localHash: string; cloudHash: string }[] = [];
  const alreadyApplied: ManifestEntry[] = [];

  for (const m of sorted) {
    const localHash = localByName.get(m.filename);
    if (localHash === undefined) {
      if (m.safety === 'safe') toApply.push(m);
      else toQueue.push(m);
    } else if (localHash === m.contentHash) {
      alreadyApplied.push(m);
    } else {
      drift.push({ filename: m.filename, localHash, cloudHash: m.contentHash });
    }
  }

  return { toApply, toQueue, drift, alreadyApplied };
}

// ─── Migration tracking table (P0-08 idempotency) ──────────────────────────
let ensuredMigrationsTable = false;
async function ensureMigrationsTable(db: D1Database): Promise<void> {
  if (ensuredMigrationsTable) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS local_schema_migrations (
           filename TEXT PRIMARY KEY,
           safety TEXT NOT NULL,
           content_hash TEXT NOT NULL,
           applied_at TEXT NOT NULL DEFAULT (datetime('now')),
           duration_ms INTEGER
         )`,
      )
      .run();
    ensuredMigrationsTable = true;
  } catch (err) {
    // If the table already exists with a different shape, swallow.
    const message = err instanceof Error ? err.message : String(err);
    if (!/already exists/i.test(message)) {
      throw err;
    }
    ensuredMigrationsTable = true;
  }
}

export async function applyMigration(
  db: D1Database,
  migration: ManifestEntry,
): Promise<{ duration_ms: number; error?: string }> {
  return applyMigrationExec(db, migration);
}

/**
 * Apply a migration via D1's batch API. Splits on semicolons that are NOT
 * inside `$$ ... $$` dollar-quoted blocks. Each statement is bound to its
 * own prepared statement and executed as a single batch. This is the
 * preferred path for fresh migrations.
 */
export async function applyMigrationExec(
  db: D1Database,
  migration: ManifestEntry,
): Promise<{ duration_ms: number; error?: string }> {
  const startedAt = Date.now();
  await ensureMigrationsTable(db);

  // Idempotency: skip migrations that have already been applied with the
  // exact same content_hash.
  const existing = await db
    .prepare('SELECT content_hash FROM local_schema_migrations WHERE filename = ?')
    .bind(migration.filename)
    .first<{ content_hash: string }>();
  if (existing && existing.content_hash === migration.contentHash) {
    return { duration_ms: 0 };
  }

  try {
    const statements = splitSqlStatements(migration.sql).map((s) => db.prepare(s));
    if (statements.length > 0) {
      await db.batch(statements);
    }
    await db
      .prepare(
        `INSERT OR REPLACE INTO local_schema_migrations (filename, safety, content_hash, applied_at, duration_ms)
         VALUES (?, ?, ?, datetime('now'), ?)`,
      )
      .bind(migration.filename, migration.safety, migration.contentHash, Date.now() - startedAt)
      .run();
    await db
      .prepare(
        `INSERT INTO local_schema_sync_log (filename, event, actor, message) VALUES (?, ?, ?, ?)`,
      )
      .bind(migration.filename, 'applied', 'system', `${Date.now() - startedAt}ms`)
      .run();
    return { duration_ms: Date.now() - startedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { duration_ms: Date.now() - startedAt, error: message };
  }
}

/**
 * Split a SQL string on `;` while respecting `$$ ... $$` dollar quoting.
 * Empty fragments are dropped.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inDollar = false;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (!inDollar && ch === '$' && next === '$') {
      buf += '$$';
      inDollar = true;
      i += 2;
      continue;
    }
    if (inDollar && ch === '$' && next === '$') {
      buf += '$$';
      inDollar = false;
      i += 2;
      continue;
    }
    if (!inDollar && ch === ';') {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

export async function recordApproval(
  db: D1Database,
  migration: ManifestEntry,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO local_schema_sync_approvals
        (filename, safety, content_hash, sql_content, status)
       VALUES (?, ?, ?, ?, 'pending')`,
    )
    .bind(migration.filename, migration.safety, migration.contentHash, migration.sql)
    .run();
}

export async function setApprovalStatus(
  db: D1Database,
  filename: string,
  status: 'pending' | 'approved' | 'rejected' | 'applied' | 'failed',
  actor: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE local_schema_sync_approvals
       SET status = ?,
           reviewed_by = ?,
           reviewed_at = datetime('now')
       WHERE filename = ?`,
    )
    .bind(status, actor, filename)
    .run();
}

export async function logEvent(
  db: D1Database,
  filename: string,
  event: 'detected' | 'applied' | 'queued' | 'approved' | 'rejected' | 'failed' | 'drift',
  actor: string,
  message?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO local_schema_sync_log (filename, event, actor, message)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(filename, event, actor, message ?? null)
    .run();
}
