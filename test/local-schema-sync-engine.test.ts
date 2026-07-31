import { describe, it, expect } from 'vitest';
import { classifyMigration, reconcileLocal, applyMigration, recordApproval, setApprovalStatus, logEvent } from '../src/lib/local-server/schema-sync';
import type { ManifestEntry } from '../src/lib/local-server/schema-sync';
import { createMockDB } from './integration/helpers/mock-db';
import type { D1Database } from '@cloudflare/workers-types';

describe('classifyMigration', () => {
  it('returns "safe" for NNNN_*.sql', () => {
    expect(classifyMigration('0334_add_table.sql')).toBe('safe');
    expect(classifyMigration('0001_init.sql')).toBe('safe');
  });

  it('returns "destructive" for NNNNd_*.sql', () => {
    expect(classifyMigration('0334d_drop_x.sql')).toBe('destructive');
  });

  it('is case-insensitive on the d suffix', () => {
    expect(classifyMigration('0334D_rename_x.sql')).toBe('destructive');
  });

  it('throws for filenames that do not match the convention', () => {
    expect(() => classifyMigration('add_table.sql')).toThrow(/must match/);
    expect(() => classifyMigration('abc_add.sql')).toThrow(/must match/);
    expect(() => classifyMigration('0334.sql')).toThrow(/must match/);
  });
});

describe('placeholder exports', () => {
  it('exports reconcileLocal, applyMigration, recordApproval, setApprovalStatus, logEvent', () => {
    expect(typeof reconcileLocal).toBe('function');
    expect(typeof applyMigration).toBe('function');
    expect(typeof recordApproval).toBe('function');
    expect(typeof setApprovalStatus).toBe('function');
    expect(typeof logEvent).toBe('function');
  });
});

describe('reconcileLocal', () => {
  function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
    return {
      filename: '0334_add_x.sql',
      order: 334,
      safety: 'safe',
      contentHash: 'sha256:abc',
      sql: 'CREATE TABLE x (id INTEGER);',
      ...overrides,
    };
  }

  it('returns empty result for empty local state and empty manifest', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [] };
        }
        return null;
      },
    });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [] });
    expect(result.toApply).toEqual([]);
    expect(result.toQueue).toEqual([]);
    expect(result.drift).toEqual([]);
    expect(result.alreadyApplied).toEqual([]);
  });

  it('puts a safe migration in toApply when local has no row', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [] };
        }
        return null;
      },
    });
    const m = makeEntry({ filename: '0334_add_x.sql', safety: 'safe' });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [m] });
    expect(result.toApply).toHaveLength(1);
    expect(result.toApply[0].filename).toBe('0334_add_x.sql');
  });

  it('puts a destructive migration in toQueue when local has no row', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [] };
        }
        return null;
      },
    });
    const m = makeEntry({ filename: '0334d_drop_y.sql', safety: 'destructive' });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [m] });
    expect(result.toQueue).toHaveLength(1);
    expect(result.toQueue[0].filename).toBe('0334d_drop_y.sql');
  });

  it('puts a migration in alreadyApplied when local has a matching row', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [{ filename: '0334_add_x.sql', content_hash: 'sha256:abc' }] };
        }
        return null;
      },
    });
    const m = makeEntry({ filename: '0334_add_x.sql', contentHash: 'sha256:abc' });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [m] });
    expect(result.alreadyApplied).toHaveLength(1);
    expect(result.toApply).toHaveLength(0);
  });

  it('detects drift when local hash differs from cloud hash', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [{ filename: '0334_add_x.sql', content_hash: 'sha256:local' }] };
        }
        return null;
      },
    });
    const m = makeEntry({ filename: '0334_add_x.sql', contentHash: 'sha256:cloud' });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [m] });
    expect(result.drift).toHaveLength(1);
    expect(result.drift[0]).toEqual({ filename: '0334_add_x.sql', localHash: 'sha256:local', cloudHash: 'sha256:cloud' });
  });

  it('sorts by order ascending', async () => {
    const { db } = createMockDB({
      queryOverride(sql) {
        if (/FROM local_schema_migrations/.test(sql)) {
          return { success: true, results: [] };
        }
        return null;
      },
    });
    const m1 = makeEntry({ filename: '0336_a.sql', order: 336 });
    const m2 = makeEntry({ filename: '0334d_b.sql', order: 334.1, safety: 'destructive' });
    const m3 = makeEntry({ filename: '0334_c.sql', order: 334 });
    const result = await reconcileLocal(db as unknown as D1Database, { version: 'v1', migrations: [m1, m2, m3] });
    expect(result.toApply.map((m) => m.order)).toEqual([334, 336]);
    expect(result.toQueue.map((m) => m.order)).toEqual([334.1]);
  });
});

describe('applyMigration', () => {
  function makeDb(behavior: 'success' | 'throw') {
    return createMockDB({
      batchError: behavior === 'throw' ? new Error('SQL syntax error') : undefined,
    });
  }

  it('records the migration on success', async () => {
    const { db, queries } = makeDb('success');
    const m: ManifestEntry = {
      filename: '0334_add_x.sql',
      order: 334,
      safety: 'safe',
      contentHash: 'sha256:abc',
      sql: 'CREATE TABLE x (id INTEGER);',
    };
    const result = await applyMigration(db as unknown as D1Database, m);
    expect(result.error).toBeUndefined();
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    const sawCreateTable = queries.some((q) => /CREATE TABLE x/.test(q.sql));
    expect(sawCreateTable).toBe(true);
  });

  it('returns the error message on failure', async () => {
    const { db } = makeDb('throw');
    const m: ManifestEntry = {
      filename: '0334_add_x.sql',
      order: 334,
      safety: 'safe',
      contentHash: 'sha256:abc',
      sql: 'INVALID SQL;',
    };
    const result = await applyMigration(db as unknown as D1Database, m);
    expect(result.error).toMatch(/SQL syntax error/);
  });
});

describe('recordApproval', () => {
  it('inserts a pending approval row', async () => {
    const { db, queries } = createMockDB();
    const m: ManifestEntry = {
      filename: '0334d_drop_y.sql',
      order: 334.1,
      safety: 'destructive',
      contentHash: 'sha256:abc',
      sql: 'DROP TABLE y;',
    };
    await recordApproval(db as unknown as D1Database, m);
    const sawInsert = queries.some((q) => /INSERT\s+INTO\s+local_schema_sync_approvals/i.test(q.sql));
    expect(sawInsert).toBe(true);
  });
});

describe('setApprovalStatus', () => {
  it('updates the status and reviewed_by for an approval row', async () => {
    const { db, queries } = createMockDB();
    await setApprovalStatus(db as unknown as D1Database, '0334d_drop_y.sql', 'approved', 'admin-1');
    const sawUpdate = queries.some((q) => /UPDATE\s+local_schema_sync_approvals/i.test(q.sql));
    expect(sawUpdate).toBe(true);
  });
});

describe('logEvent', () => {
  it('inserts a log row with the given event and actor', async () => {
    const { db, queries } = createMockDB();
    await logEvent(db as unknown as D1Database, '0334_add_x.sql', 'detected', 'system', 'first detection');
    const sawInsert = queries.some((q) => /INSERT\s+INTO\s+local_schema_sync_log/i.test(q.sql));
    expect(sawInsert).toBe(true);
  });
});
