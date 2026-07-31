import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import labMachines from '../../src/routes/tenant/labMachines';
import { dispatchLisRetractionNotifications } from '../../src/services/lis-retraction-notification-dispatch';

class SQLitePreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new SQLitePreparedStatement(this.database, this.sql, params);
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }

  async all<T>() {
    const results = this.database.prepare(this.sql).all(...this.params) as T[];
    return { success: true, results, meta: {} };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
      results: [],
    };
  }
}

class SQLiteD1Adapter {
  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string) {
    return new SQLitePreparedStatement(this.database, sql);
  }

  async batch(statements: SQLitePreparedStatement[]) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function createDatabase(options: { malformedPayload?: boolean; noRecipients?: boolean } = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      user_id INTEGER,
      type TEXT NOT NULL DEFAULT 'system',
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      link TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      role TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE lab_orders (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      ordered_by INTEGER
    );
    CREATE TABLE lis_result_retraction_requests (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      lab_order_id INTEGER NOT NULL,
      patient_id INTEGER
    );
    CREATE TABLE lis_result_retraction_notification_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      retraction_request_id INTEGER NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'result_retracted',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
      payload_json TEXT NOT NULL,
      recipient_policy_json TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      next_attempt_at DATETIME,
      sent_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  database.exec(readFileSync('migrations/0408_lis_retraction_notification_dispatch.sql', 'utf8'));
  database.exec(`
    INSERT INTO patients (id, tenant_id, name) VALUES (40, 'tenant-1', 'Patient One');
    INSERT INTO users (id, tenant_id, role, is_active) VALUES
      (1, 'tenant-1', 'hospital_admin', 1),
      (2, 'tenant-1', 'lab', 1),
      (3, 'tenant-1', 'doctor', 1),
      (4, 'tenant-1', 'pathologist', 0),
      (5, 'tenant-2', 'hospital_admin', 1);
    INSERT INTO lab_orders (id, tenant_id, ordered_by) VALUES (20, 'tenant-1', 3);
    INSERT INTO lis_result_retraction_requests (id, tenant_id, lab_order_id, patient_id)
    VALUES (701, 'tenant-1', 20, 40);
  `);

  const payload = options.malformedPayload
    ? '{"requestId":701}'
    : JSON.stringify({
        requestId: 701,
        inboxId: 80,
        labResultId: 601,
        labReportId: 501,
        labOrderItemId: 10,
        labOrderId: 20,
        patientId: 40,
        reasonCode: 'wrong_order',
        reason: 'The report was linked to the wrong laboratory order.',
        requestedBy: 15,
        approvedBy: 16,
      });
  const policy = JSON.stringify(options.noRecipients ? {
    notifyPatient: false,
    notifyOrderingClinician: false,
    notifyLaboratoryGovernance: false,
    channels: [],
  } : {
    notifyPatient: true,
    notifyOrderingClinician: true,
    notifyLaboratoryGovernance: true,
    channels: ['in_app', 'portal'],
  });
  database.prepare(`
    INSERT INTO lis_result_retraction_notification_outbox (
      tenant_id, retraction_request_id, payload_json, recipient_policy_json
    ) VALUES ('tenant-1', 701, ?, ?)
  `).run(payload, policy);

  return database;
}

function adapter(database: DatabaseSync) {
  return new SQLiteD1Adapter(database) as unknown as D1Database;
}

function routeApp(database: DatabaseSync) {
  const instance = new Hono<any>();
  instance.use('*', async (c, next) => {
    c.env = { DB: adapter(database) };
    c.set('tenantId', 'tenant-1');
    c.set('userId', '16');
    c.set('role', 'lab_supervisor');
    await next();
  });
  instance.route('/lab-machines', labMachines);
  return instance;
}

describe('LIS retraction notification dispatcher against real SQLite', () => {
  it('fans out exactly once to governance, ordering clinician, and patient portal', async () => {
    const database = createDatabase();

    await expect(dispatchLisRetractionNotifications(adapter(database))).resolves.toEqual({
      scanned: 1,
      expanded: 4,
      sent: 4,
      retried: 0,
      terminalFailed: 0,
    });

    expect(database.prepare(`
      SELECT user_id, type, dedupe_key FROM notifications ORDER BY user_id
    `).all()).toEqual([
      { user_id: 1, type: 'lab', dedupe_key: 'lis-retraction:1:in_app:user:1' },
      { user_id: 2, type: 'lab', dedupe_key: 'lis-retraction:1:in_app:user:2' },
      { user_id: 3, type: 'lab', dedupe_key: 'lis-retraction:1:in_app:user:3' },
    ]);
    expect(database.prepare(`
      SELECT patient_id, category, dedupe_key FROM patient_portal_notifications
    `).get()).toEqual({
      patient_id: 40,
      category: 'lab_result_retraction',
      dedupe_key: 'lis-retraction:1:portal:patient:40',
    });
    expect(database.prepare(`
      SELECT status, COUNT(*) AS total
      FROM lis_result_retraction_notification_deliveries GROUP BY status
    `).get()).toEqual({ status: 'sent', total: 4 });
    expect(database.prepare(`
      SELECT status, attempt_count, last_error, sent_at IS NOT NULL AS was_sent
      FROM lis_result_retraction_notification_outbox WHERE id = 1
    `).get()).toEqual({ status: 'sent', attempt_count: 1, last_error: null, was_sent: 1 });

    await expect(dispatchLisRetractionNotifications(adapter(database))).resolves.toEqual({
      scanned: 0,
      expanded: 0,
      sent: 0,
      retried: 0,
      terminalFailed: 0,
    });
    expect(database.prepare('SELECT COUNT(*) AS total FROM notifications').get()).toEqual({ total: 3 });
    expect(database.prepare('SELECT COUNT(*) AS total FROM patient_portal_notifications').get()).toEqual({ total: 1 });
  });

  it('retries only the failed recipient channel without duplicating successful deliveries', async () => {
    const database = createDatabase();
    database.exec(`
      CREATE TRIGGER fail_portal_delivery
      BEFORE INSERT ON patient_portal_notifications
      BEGIN
        SELECT RAISE(ABORT, 'simulated portal outage');
      END;
    `);

    await expect(dispatchLisRetractionNotifications(adapter(database), { maxAttempts: 3 }))
      .resolves.toMatchObject({ scanned: 1, sent: 3, retried: 1, terminalFailed: 0 });
    expect(database.prepare('SELECT COUNT(*) AS total FROM notifications').get()).toEqual({ total: 3 });
    expect(database.prepare('SELECT COUNT(*) AS total FROM patient_portal_notifications').get()).toEqual({ total: 0 });
    expect(database.prepare(`
      SELECT status, attempt_count, next_attempt_at IS NOT NULL AS has_retry
      FROM lis_result_retraction_notification_deliveries
      WHERE channel = 'portal'
    `).get()).toEqual({ status: 'failed', attempt_count: 1, has_retry: 1 });
    expect(database.prepare(`SELECT status FROM lis_result_retraction_notification_outbox WHERE id = 1`).get())
      .toEqual({ status: 'pending' });
    const attemptBeforeDue = database.prepare(`
      SELECT attempt_count FROM lis_result_retraction_notification_outbox WHERE id = 1
    `).get();
    await expect(dispatchLisRetractionNotifications(adapter(database), { maxAttempts: 3 }))
      .resolves.toMatchObject({ scanned: 0, sent: 0, retried: 0 });
    expect(database.prepare(`
      SELECT attempt_count FROM lis_result_retraction_notification_outbox WHERE id = 1
    `).get()).toEqual(attemptBeforeDue);

    database.exec('DROP TRIGGER fail_portal_delivery');
    database.exec(`
      UPDATE lis_result_retraction_notification_deliveries
      SET next_attempt_at = DATETIME(CURRENT_TIMESTAMP, '-1 minute')
      WHERE channel = 'portal';
      UPDATE lis_result_retraction_notification_outbox
      SET next_attempt_at = DATETIME(CURRENT_TIMESTAMP, '-1 minute')
      WHERE id = 1;
    `);

    await expect(dispatchLisRetractionNotifications(adapter(database), { maxAttempts: 3 }))
      .resolves.toMatchObject({ scanned: 1, expanded: 0, sent: 1, retried: 0 });
    expect(database.prepare('SELECT COUNT(*) AS total FROM notifications').get()).toEqual({ total: 3 });
    expect(database.prepare('SELECT COUNT(*) AS total FROM patient_portal_notifications').get()).toEqual({ total: 1 });
    expect(database.prepare(`SELECT status FROM lis_result_retraction_notification_outbox WHERE id = 1`).get())
      .toEqual({ status: 'sent' });
  });

  it('reopens only a recoverable failed delivery through an accountable atomic retry command', async () => {
    const database = createDatabase();
    database.exec(`
      CREATE TRIGGER fail_portal_delivery_for_manual_retry
      BEFORE INSERT ON patient_portal_notifications
      BEGIN
        SELECT RAISE(ABORT, 'simulated terminal portal outage');
      END;
    `);

    await expect(dispatchLisRetractionNotifications(adapter(database), { maxAttempts: 1 }))
      .resolves.toMatchObject({ scanned: 1, sent: 3, terminalFailed: 1 });
    database.exec('DROP TRIGGER fail_portal_delivery_for_manual_retry');
    database.prepare(`
      INSERT INTO users (id, tenant_id, role, is_active)
      VALUES (16, 'tenant-1', 'lab_supervisor', 1)
    `).run();

    const response = await routeApp(database).request(
      '/lab-machines/retraction-notification-outbox/1/retry',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Portal service recovered after incident review.' }),
      },
    );

    expect(response.status).toBe(200);
    expect(database.prepare(`
      SELECT status, manual_retry_count, last_manual_retry_by, last_manual_retry_reason
      FROM lis_result_retraction_notification_outbox WHERE id = 1
    `).get()).toEqual({
      status: 'pending',
      manual_retry_count: 1,
      last_manual_retry_by: 16,
      last_manual_retry_reason: 'Portal service recovered after incident review.',
    });
    expect(database.prepare(`
      SELECT status, attempt_count, next_attempt_at, last_error
      FROM lis_result_retraction_notification_deliveries WHERE channel = 'portal'
    `).get()).toEqual({ status: 'pending', attempt_count: 0, next_attempt_at: null, last_error: null });
    expect(database.prepare(`
      SELECT status, requested_by, reason, completed_at IS NOT NULL AS completed
      FROM lis_result_retraction_notification_retry_commands
    `).get()).toEqual({
      status: 'completed',
      requested_by: 16,
      reason: 'Portal service recovered after incident review.',
      completed: 1,
    });
  });

  it('rejects manual retry when terminal failure has no recipient delivery to reset', async () => {
    const database = createDatabase({ noRecipients: true });
    await dispatchLisRetractionNotifications(adapter(database));
    database.prepare(`
      INSERT INTO users (id, tenant_id, role, is_active)
      VALUES (16, 'tenant-1', 'lab_supervisor', 1)
    `).run();

    const response = await routeApp(database).request(
      '/lab-machines/retraction-notification-outbox/1/retry',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Recipient configuration was reviewed by governance.' }),
      },
    );

    expect(response.status).toBe(409);
    expect(database.prepare(`SELECT status, manual_retry_count FROM lis_result_retraction_notification_outbox WHERE id = 1`).get())
      .toEqual({ status: 'failed', manual_retry_count: 0 });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lis_result_retraction_notification_retry_commands`).get())
      .toEqual({ total: 0 });
  });

  it('recovers a stale processing lease without duplicating the channel artifact', async () => {
    const database = createDatabase();
    await dispatchLisRetractionNotifications(adapter(database));

    database.exec(`
      UPDATE lis_result_retraction_notification_outbox
      SET status = 'processing', updated_at = DATETIME(CURRENT_TIMESTAMP, '-20 minutes'), sent_at = NULL
      WHERE id = 1;
      UPDATE lis_result_retraction_notification_deliveries
      SET status = 'processing', processing_started_at = DATETIME(CURRENT_TIMESTAMP, '-20 minutes'),
          sent_at = NULL
      WHERE channel = 'portal';
    `);

    await expect(dispatchLisRetractionNotifications(adapter(database))).resolves.toMatchObject({
      scanned: 1,
      sent: 1,
    });
    expect(database.prepare('SELECT COUNT(*) AS total FROM patient_portal_notifications').get()).toEqual({ total: 1 });
    expect(database.prepare(`SELECT status FROM lis_result_retraction_notification_outbox WHERE id = 1`).get())
      .toEqual({ status: 'sent' });
  });

  it('marks an event with no eligible recipients as terminal failure instead of looping forever', async () => {
    const database = createDatabase({ noRecipients: true });

    await expect(dispatchLisRetractionNotifications(adapter(database))).resolves.toEqual({
      scanned: 1,
      expanded: 0,
      sent: 0,
      retried: 0,
      terminalFailed: 1,
    });
    expect(database.prepare(`
      SELECT status, last_error, next_attempt_at
      FROM lis_result_retraction_notification_outbox WHERE id = 1
    `).get()).toEqual({
      status: 'failed',
      last_error: 'No eligible retraction notification recipients',
      next_attempt_at: null,
    });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lis_result_retraction_notification_deliveries`).get())
      .toEqual({ total: 0 });
  });

  it('marks malformed immutable evidence as terminal failure', async () => {
    const database = createDatabase({ malformedPayload: true });

    await expect(dispatchLisRetractionNotifications(adapter(database))).resolves.toEqual({
      scanned: 1,
      expanded: 0,
      sent: 0,
      retried: 0,
      terminalFailed: 1,
    });
    expect(database.prepare(`
      SELECT status, attempt_count, next_attempt_at, last_error
      FROM lis_result_retraction_notification_outbox WHERE id = 1
    `).get()).toMatchObject({
      status: 'failed',
      attempt_count: 1,
      next_attempt_at: null,
    });
    expect(String((database.prepare(`SELECT last_error FROM lis_result_retraction_notification_outbox WHERE id = 1`).get() as { last_error: string }).last_error))
      .toMatch(/payload is incomplete/i);
  });

  it('keeps delivery identity and portal evidence immutable', async () => {
    const database = createDatabase();
    await dispatchLisRetractionNotifications(adapter(database));

    expect(() => database.prepare(`
      UPDATE lis_result_retraction_notification_deliveries
      SET recipient_id = 99 WHERE id = 1
    `).run()).toThrow(/delivery identity is immutable/i);
    expect(() => database.prepare(`
      UPDATE patient_portal_notifications
      SET message = 'tampered' WHERE id = 1
    `).run()).toThrow(/portal notification evidence is immutable/i);
    expect(() => database.prepare(`
      UPDATE patient_portal_notifications
      SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = 1
    `).run()).not.toThrow();
  });
});
