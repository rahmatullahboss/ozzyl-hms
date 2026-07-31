import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('D1 batch metadata with triggers', () => {
  it('reports per-statement changes for direct and trigger side effects', async () => {
    await env.DB.prepare('DROP TRIGGER IF EXISTS meta_parent_insert').run();
    await env.DB.prepare('DROP TABLE IF EXISTS meta_child').run();
    await env.DB.prepare('DROP TABLE IF EXISTS meta_parent').run();
    await env.DB.prepare(`
      CREATE TABLE meta_parent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value TEXT NOT NULL
      )
    `).run();
    await env.DB.prepare(`
      CREATE TABLE meta_child (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER NOT NULL,
        value TEXT NOT NULL
      )
    `).run();
    await env.DB.prepare(`
      CREATE TRIGGER meta_parent_insert
      AFTER INSERT ON meta_parent
      FOR EACH ROW
      BEGIN
        INSERT INTO meta_child(parent_id, value) VALUES (NEW.id, 'trigger');
      END
    `).run();

    const results = await env.DB.batch([
      env.DB.prepare("INSERT INTO meta_parent(value) VALUES ('direct')"),
      env.DB.prepare('DELETE FROM meta_child'),
      env.DB.prepare('DELETE FROM meta_parent'),
    ]);

    const metadata = results.map((result) => ({
      changes: result.meta.changes,
      rowsWritten: result.meta.rows_written,
      changedDb: result.meta.changed_db,
    }));
    console.log(`CDB101_D1_META=${JSON.stringify(metadata)}`);

    expect(metadata).toEqual([
      { changes: 2, rowsWritten: 4, changedDb: true },
      { changes: 1, rowsWritten: 1, changedDb: true },
      { changes: 1, rowsWritten: 1, changedDb: true },
    ]);
  });
});
