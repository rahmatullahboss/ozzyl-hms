import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const migrationSql = readFileSync(join(process.cwd(), 'migrations/0423_repair_clean_cash_handover_pending_approvals.sql'), 'utf8');

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE billing_handovers (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      handover_type TEXT NOT NULL,
      handover_amount REAL NOT NULL,
      due_amount REAL,
      status TEXT NOT NULL,
      received_by INTEGER,
      received_at TEXT,
      received_remarks TEXT,
      receiver_counted_amount REAL,
      receiver_variance REAL NOT NULL DEFAULT 0,
      admin_verification_status TEXT,
      admin_verification_remarks TEXT,
      created_at TEXT
    );

    CREATE TABLE cash_handover_verification_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      handover_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL,
      actor_role TEXT,
      counted_amount REAL,
      expected_amount REAL,
      variance REAL NOT NULL DEFAULT 0,
      decision TEXT NOT NULL,
      remarks TEXT,
      workstation_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('0423 clean cash handover pending repair', () => {
  it('backfills receiver evidence and auto-completes only exact-count rows with complete receiver data', () => {
    const db = createDatabase();
    const insert = db.prepare(`
      INSERT INTO billing_handovers
        (id, tenant_id, handover_type, handover_amount, due_amount, status, received_by, received_at, received_remarks,
         receiver_counted_amount, receiver_variance, admin_verification_status, created_at)
      VALUES (?, 'tenant-1', 'counter', ?, ?, ?, ?, '2026-07-14 09:00:00', ?, ?, ?, 'pending_admin', '2026-07-14 08:00:00')
    `);

    insert.run(1, 1500, 0, 'receiver_verified', 2, 'Exact count', 1500, 0);
    insert.run(2, 1500, 0, 'receiver_verified', 2, 'Short cash', 1450, 0);
    insert.run(3, 1500, 0, 'disputed', 2, 'Explicit dispute', 1500, 0);
    insert.run(4, 1500, 0, 'receiver_verified', null, 'Missing actor', 1500, 0);
    insert.run(5, 1500, 0, 'receiver_verified', 2, 'Missing count', null, 0);

    db.exec(migrationSql);

    const rows = db.prepare(`
      SELECT id, status, admin_verification_status
      FROM billing_handovers
      ORDER BY id
    `).all() as Array<{ id: number; status: string; admin_verification_status: string | null }>;

    expect(rows).toEqual([
      { id: 1, status: 'received', admin_verification_status: null },
      { id: 2, status: 'receiver_verified', admin_verification_status: 'pending_admin' },
      { id: 3, status: 'disputed', admin_verification_status: 'pending_admin' },
      { id: 4, status: 'receiver_verified', admin_verification_status: 'pending_admin' },
      { id: 5, status: 'receiver_verified', admin_verification_status: 'pending_admin' },
    ]);

    const events = db.prepare(`
      SELECT handover_id, event_type, actor_user_id, counted_amount, expected_amount, variance, decision, remarks
      FROM cash_handover_verification_events
      ORDER BY handover_id
    `).all() as Array<Record<string, unknown>>;

    expect(events).toEqual([expect.objectContaining({
      handover_id: 1,
      event_type: 'receiver_verified',
      actor_user_id: 2,
      counted_amount: 1500,
      expected_amount: 1500,
      variance: 0,
      decision: 'verify',
      remarks: 'Exact count',
    })]);
  });

  it('is idempotent and does not duplicate an existing receiver event', () => {
    const db = createDatabase();
    db.exec(`
      INSERT INTO billing_handovers
        (id, tenant_id, handover_type, handover_amount, due_amount, status, received_by, received_at, receiver_counted_amount,
         receiver_variance, admin_verification_status, created_at)
      VALUES (10, 'tenant-1', 'counter', 1000, 0, 'receiver_verified', 4, '2026-07-14 09:00:00', 1000, 0, 'pending_admin', '2026-07-14 08:00:00');

      INSERT INTO cash_handover_verification_events
        (tenant_id, handover_id, event_type, actor_user_id, counted_amount, expected_amount, variance, decision, created_at)
      VALUES ('tenant-1', 10, 'receiver_verified', 4, 1000, 1000, 0, 'verify', '2026-07-14 09:00:00');
    `);

    db.exec(migrationSql);
    db.exec(migrationSql);

    const eventCount = db.prepare('SELECT COUNT(*) AS total FROM cash_handover_verification_events WHERE handover_id = 10').get() as { total: number };
    const handover = db.prepare('SELECT status, admin_verification_status FROM billing_handovers WHERE id = 10').get() as { status: string; admin_verification_status: string | null };

    expect(eventCount.total).toBe(1);
    expect(handover).toEqual({ status: 'received', admin_verification_status: null });
  });
});
