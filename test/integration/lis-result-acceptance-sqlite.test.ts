import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { acceptStagedLisResult } from '../../src/services/lis-result-acceptance';
import { rejectStagedLisResult } from '../../src/services/lis-inbox-review';
import { createLisInboxSupersession } from '../../src/services/lis-inbox-supersession';
import {
  approveLisResultRetraction,
  requestLisResultRetraction,
} from '../../src/services/lis-result-retraction';

const terminalDecisionMigrationSql = readFileSync('migrations/0405_lis_inbox_terminal_decisions.sql', 'utf8');
const supersessionMigrationSql = readFileSync('migrations/0406_lis_inbox_supersession_workflow.sql', 'utf8');
const retractionMigrationSql = readFileSync('migrations/0407_lis_result_retraction_workflow.sql', 'utf8');

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

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
        duration: 0,
      },
      results: [],
    };
  }
}

class SQLiteD1Adapter {
  constructor(
    private readonly database: DatabaseSync,
    private readonly failOnSql?: string,
  ) {}

  prepare(sql: string) {
    return new SQLitePreparedStatement(this.database, sql);
  }

  async batch(statements: SQLitePreparedStatement[]) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) {
        if (this.failOnSql && statement.sql.includes(this.failOnSql)) {
          throw new Error('simulated acceptance batch failure');
        }
        results.push(await statement.run());
      }
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function createDatabase(options: { critical?: boolean } = {}) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE patients (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_machines (id INTEGER PRIMARY KEY);
    CREATE TABLE lis_bridge_agents (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_machine_result_log (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_test_catalog (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT,
      code TEXT
    );
    CREATE TABLE lab_test_components (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_specimens (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_orders (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER,
      order_no TEXT,
      status TEXT DEFAULT 'pending',
      updated_at DATETIME
    );
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      lab_order_id INTEGER NOT NULL,
      lab_test_id INTEGER NOT NULL,
      specimen_id INTEGER,
      result TEXT,
      result_numeric REAL,
      abnormal_flag TEXT,
      status TEXT DEFAULT 'processing'
        CHECK(status IN ('pending','collected','received','processing','completed','verified','rejected','cancelled')),
      result_status TEXT,
      completed_at DATETIME,
      machine_id INTEGER,
      machine_result_log_id INTEGER,
      notes TEXT,
      updated_at DATETIME
    );
    CREATE TABLE lab_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_order_id INTEGER NOT NULL,
      report_status TEXT DEFAULT 'pending',
      review_status TEXT DEFAULT 'pending',
      delivery_status TEXT DEFAULT 'pending',
      corrected_at DATETIME,
      tenant_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE lab_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_report_id INTEGER NOT NULL,
      lab_test_id INTEGER NOT NULL,
      component_id INTEGER,
      result_code TEXT,
      result_text TEXT,
      result_value TEXT,
      result_numeric REAL,
      units TEXT,
      normal_range TEXT,
      abnormal_flag TEXT,
      result_status TEXT,
      comments TEXT,
      machine_id INTEGER,
      tenant_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE lab_observation_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      lab_result_id INTEGER,
      lab_order_item_id INTEGER,
      lab_test_id INTEGER,
      component_id INTEGER,
      specimen_id INTEGER,
      result_value TEXT,
      result_numeric REAL,
      units TEXT,
      reference_range TEXT,
      abnormal_flag TEXT,
      critical_flag INTEGER DEFAULT 0,
      result_status TEXT,
      observation_source TEXT,
      machine_id INTEGER,
      machine_result_log_id INTEGER,
      entered_by INTEGER,
      verified_by INTEGER,
      verified_at DATETIME,
      correction_reason TEXT,
      version_no INTEGER DEFAULT 1,
      supersedes_observation_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  database.exec(readFileSync('migrations/0404_lis_analyzer_safety_inbox.sql', 'utf8'));
  database.exec(terminalDecisionMigrationSql);
  database.exec(supersessionMigrationSql);
  database.exec(retractionMigrationSql);
  database.exec(`
    INSERT INTO users (id) VALUES (9), (15), (16);
    INSERT INTO patients (id) VALUES (40), (41);
    INSERT INTO lab_machines (id) VALUES (1);
    INSERT INTO lab_machine_result_log (id) VALUES (99);
    INSERT INTO lab_test_catalog (id, tenant_id, name, code) VALUES (7, 'tenant-1', 'Hemoglobin', 'HGB');
    INSERT INTO lab_specimens (id) VALUES (30), (31);
    INSERT INTO lab_orders (id, tenant_id, patient_id, order_no, status) VALUES
      (20, 'tenant-1', 40, 'ORD-20', 'processing'),
      (21, 'tenant-1', 40, 'ORD-21', 'processing');
    INSERT INTO lab_order_items (
      id, tenant_id, lab_order_id, lab_test_id, specimen_id, status
    ) VALUES
      (10, 'tenant-1', 20, 7, 30, 'processing'),
      (11, 'tenant-1', 21, 7, 31, 'processing');
    INSERT INTO lis_ingestion_messages (
      id, tenant_id, machine_id, protocol, message_identity,
      payload_sha256, status, raw_payload
    ) VALUES (70, 'tenant-1', 1, 'hl7', 'tenant-1:1:hl7:MSG-1', 'hash-1', 'completed', 'payload');
  `);
  database.prepare(`
    INSERT INTO lis_analyzer_inbox (
      id, tenant_id, ingestion_message_id, observation_index, machine_id,
      machine_result_log_id, machine_test_code, machine_test_name,
      lab_order_item_id, patient_id, specimen_id, lab_test_id,
      raw_value, raw_units, raw_reference_range,
      normalized_value, normalized_numeric, normalized_units,
      selected_reference_range, analyzer_result_status,
      normalized_result_status, analyzer_abnormal_flag,
      normalized_interpretation, critical_flag, match_state,
      qc_state, validation_state, disposition, disposition_reason,
      source_payload_json, staged_by
    ) VALUES (
      80, 'tenant-1', 70, 0, 1,
      99, 'HGB', 'Hemoglobin',
      10, 40, 30, 7,
      ?, 'g/dL', '12-16',
      ?, ?, 'g/dL',
      '12-16', 'F', 'final', ?, ?, ?, 'exact',
      'pass', 'pass', 'review_required', 'manual_acceptance_required',
      '{}', 9
    )
  `).run(
    options.critical ? '2.4' : '14.2',
    options.critical ? '2.4' : '14.2',
    options.critical ? 2.4 : 14.2,
    options.critical ? 'LL' : 'N',
    options.critical ? 'critical' : 'normal',
    options.critical ? 1 : 0,
  );
  return database;
}

describe('LIS acceptance SQL against real SQLite', () => {
  it('commits the canonical result, audit, inbox transition and draft report atomically', async () => {
    const database = createDatabase();
    const adapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await expect(acceptStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 1,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
    })).resolves.toMatchObject({ accepted: true, critical: false, nextVersion: 2 });

    expect(database.prepare(`SELECT result, result_status, status FROM lab_order_items WHERE id = 10`).get()).toEqual({
      result: '14.2',
      result_status: 'final',
      status: 'completed',
    });
    expect(database.prepare(`SELECT report_status, review_status FROM lab_reports`).get()).toEqual({
      report_status: 'pending',
      review_status: 'pending',
    });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lab_results`).get()).toEqual({ total: 1 });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lab_observation_audit`).get()).toEqual({ total: 1 });
    expect(database.prepare(`SELECT disposition, state_version, accepted_by FROM lis_analyzer_inbox WHERE id = 80`).get()).toEqual({
      disposition: 'accepted',
      state_version: 2,
      accepted_by: 15,
    });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lis_critical_event_outbox`).get()).toEqual({ total: 0 });
  });

  it('creates the critical outbox inside the same transaction', async () => {
    const database = createDatabase({ critical: true });
    const adapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await acceptStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 1,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
    });

    expect(database.prepare(`SELECT status, lis_analyzer_inbox_id FROM lis_critical_event_outbox`).get()).toEqual({
      status: 'pending',
      lis_analyzer_inbox_id: 80,
    });
  });

  it('rolls back every canonical write when a later statement fails', async () => {
    const database = createDatabase();
    const adapter = new SQLiteD1Adapter(database, 'INSERT INTO lab_observation_audit') as unknown as D1Database;

    await expect(acceptStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 1,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
    })).rejects.toThrow('simulated acceptance batch failure');

    expect(database.prepare(`SELECT result, status FROM lab_order_items WHERE id = 10`).get()).toEqual({
      result: null,
      status: 'processing',
    });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lab_reports`).get()).toEqual({ total: 0 });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lab_results`).get()).toEqual({ total: 0 });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lis_result_acceptance_commands`).get()).toEqual({ total: 0 });
    expect(database.prepare(`SELECT disposition, state_version FROM lis_analyzer_inbox WHERE id = 80`).get()).toEqual({
      disposition: 'review_required',
      state_version: 1,
    });
  });

  it('rolls back acceptance when canonical result insertion is silently ignored', async () => {
    const database = createDatabase();
    database.exec(`
      CREATE TRIGGER ignore_lis_canonical_result_insert
      BEFORE INSERT ON lab_results
      FOR EACH ROW
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);
    const adapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await expect(acceptStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 1,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
    })).rejects.toThrow(/canonical evidence is incomplete/i);

    expect(database.prepare(`SELECT result, result_status, status FROM lab_order_items WHERE id = 10`).get()).toEqual({
      result: null,
      result_status: null,
      status: 'processing',
    });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lab_reports`).get()).toEqual({ total: 0 });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lab_results`).get()).toEqual({ total: 0 });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lab_observation_audit`).get()).toEqual({ total: 0 });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lis_result_acceptance_commands`).get()).toEqual({ total: 0 });
    expect(database.prepare(`SELECT disposition, state_version FROM lis_analyzer_inbox WHERE id = 80`).get()).toEqual({
      disposition: 'review_required',
      state_version: 1,
    });
  });

  it('records a governed rejection without changing the canonical lab result', async () => {
    const database = createDatabase();
    const adapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await expect(rejectStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 1,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
      reason: 'Analyzer sample was assigned to the wrong patient.',
    })).resolves.toEqual({ rejected: true, inboxId: 80, nextVersion: 2 });

    expect(database.prepare(`
      SELECT disposition, disposition_reason, rejected_by, rejection_reason, state_version
      FROM lis_analyzer_inbox WHERE id = 80
    `).get()).toEqual({
      disposition: 'rejected',
      disposition_reason: 'Analyzer sample was assigned to the wrong patient.',
      rejected_by: 15,
      rejection_reason: 'Analyzer sample was assigned to the wrong patient.',
      state_version: 2,
    });
    expect(database.prepare(`SELECT result, status FROM lab_order_items WHERE id = 10`).get()).toEqual({
      result: null,
      status: 'processing',
    });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lab_results`).get()).toEqual({ total: 0 });
  });

  it('rejects a stale reviewer version without changing evidence', async () => {
    const database = createDatabase();
    const adapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await expect(rejectStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 2,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
      reason: 'Analyzer sample was assigned to the wrong patient.',
    })).rejects.toMatchObject({ code: 'review_conflict', status: 409 });

    expect(database.prepare(`SELECT disposition, state_version FROM lis_analyzer_inbox WHERE id = 80`).get()).toEqual({
      disposition: 'review_required',
      state_version: 1,
    });
  });

  it('closes a nonterminal source as rejected when its immutable successor is created', async () => {
    const database = createDatabase();
    const adapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await expect(createLisInboxSupersession(adapter, {
      tenantId: 'tenant-1',
      sourceInboxId: 80,
      expectedVersion: 1,
      targetLabOrderItemId: 11,
      requestedBy: 15,
      requesterRole: 'pathologist',
      reason: 'Rematch the immutable analyzer observation to order item 11.',
    })).resolves.toMatchObject({ created: true, inboxId: 81 });

    expect(database.prepare(`
      SELECT disposition, disposition_reason, rejected_by, rejection_reason, state_version
      FROM lis_analyzer_inbox WHERE id = 80
    `).get()).toEqual({
      disposition: 'rejected',
      disposition_reason: 'Rematch the immutable analyzer observation to order item 11.',
      rejected_by: 15,
      rejection_reason: 'Rematch the immutable analyzer observation to order item 11.',
      state_version: 2,
    });
  });

  it('creates a new immutable review row while preserving terminal source evidence', async () => {
    const database = createDatabase();
    const adapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await rejectStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 1,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
      reason: 'Analyzer observation was matched to the wrong laboratory order.',
    });

    await expect(createLisInboxSupersession(adapter, {
      tenantId: 'tenant-1',
      sourceInboxId: 80,
      expectedVersion: 2,
      targetLabOrderItemId: 11,
      requestedBy: 15,
      requesterRole: 'pathologist',
      reason: 'Rematch the immutable analyzer observation to order item 11.',
    })).resolves.toEqual({
      created: true,
      sourceInboxId: 80,
      inboxId: 81,
      stateVersion: 1,
      disposition: 'review_required',
    });

    expect(database.prepare(`
      SELECT disposition, state_version, rejection_reason, raw_value
      FROM lis_analyzer_inbox WHERE id = 80
    `).get()).toEqual({
      disposition: 'rejected',
      state_version: 2,
      rejection_reason: 'Analyzer observation was matched to the wrong laboratory order.',
      raw_value: '14.2',
    });
    expect(database.prepare(`
      SELECT disposition, state_version, supersedes_inbox_id, lab_order_item_id,
             patient_id, specimen_id, lab_test_id, raw_value, qc_state,
             validation_state, staged_by, observation_index
      FROM lis_analyzer_inbox WHERE id = 81
    `).get()).toEqual({
      disposition: 'review_required',
      state_version: 1,
      supersedes_inbox_id: 80,
      lab_order_item_id: 11,
      patient_id: 40,
      specimen_id: 31,
      lab_test_id: 7,
      raw_value: '14.2',
      qc_state: 'pass',
      validation_state: 'pass',
      staged_by: 15,
      observation_index: 1,
    });
    expect(database.prepare(`
      SELECT command_status, superseding_inbox_id, target_lab_order_item_id
      FROM lis_inbox_supersession_commands WHERE source_inbox_id = 80
    `).get()).toEqual({
      command_status: 'completed',
      superseding_inbox_id: 81,
      target_lab_order_item_id: 11,
    });

    await expect(acceptStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 81,
      expectedVersion: 1,
      reviewerUserId: 9,
      reviewerRole: 'pathologist',
    })).resolves.toMatchObject({
      accepted: true,
      corrected: true,
      labOrderItemId: 11,
    });

    expect(database.prepare(`
      SELECT result, result_status, status FROM lab_order_items WHERE id = 11
    `).get()).toEqual({
      result: '14.2',
      result_status: 'final',
      status: 'completed',
    });
    expect(database.prepare(`
      SELECT correction_reason, version_no, lis_analyzer_inbox_id
      FROM lab_observation_audit WHERE lab_order_item_id = 11
    `).get()).toEqual({
      correction_reason: 'Rematch the immutable analyzer observation to order item 11.',
      version_no: 1,
      lis_analyzer_inbox_id: 81,
    });
  });

  it('rolls back the supersession command and clone when the atomic batch fails', async () => {
    const database = createDatabase();
    const adapter = new SQLiteD1Adapter(database, 'INSERT INTO lis_analyzer_inbox') as unknown as D1Database;

    await expect(createLisInboxSupersession(adapter, {
      tenantId: 'tenant-1',
      sourceInboxId: 80,
      expectedVersion: 1,
      targetLabOrderItemId: 11,
      requestedBy: 15,
      requesterRole: 'pathologist',
      reason: 'Rematch the immutable analyzer observation to order item 11.',
    })).rejects.toThrow('simulated acceptance batch failure');

    expect(database.prepare(`SELECT COUNT(*) AS total FROM lis_inbox_supersession_commands`).get()).toEqual({ total: 0 });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lis_analyzer_inbox WHERE supersedes_inbox_id = 80`).get()).toEqual({ total: 0 });
    expect(database.prepare(`SELECT disposition, state_version FROM lis_analyzer_inbox WHERE id = 80`).get()).toEqual({
      disposition: 'review_required',
      state_version: 1,
    });
  });

  it('retracts an accepted result with two-person approval and durable notification evidence', async () => {
    const database = createDatabase();
    const adapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await acceptStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 1,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
    });

    const requested = await requestLisResultRetraction(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedInboxVersion: 2,
      requestedBy: 15,
      requesterRole: 'pathologist',
      reasonCode: 'wrong_order',
      reason: 'Result was published against the wrong laboratory order.',
    });
    expect(requested).toMatchObject({ requested: true, requestId: 1, stateVersion: 1 });

    await expect(approveLisResultRetraction(adapter, {
      tenantId: 'tenant-1',
      requestId: requested.requestId,
      expectedVersion: 1,
      reviewedBy: 16,
      reviewerRole: 'lab_supervisor',
      reviewNotes: 'Verified against analyzer source, specimen, and the patient order.',
    })).resolves.toMatchObject({ applied: true, labResultId: 1, labReportId: 1, nextVersion: 2 });

    expect(database.prepare(`
      SELECT result_status, retracted_by, retraction_reason, retraction_request_id
      FROM lab_results WHERE id = 1
    `).get()).toEqual({
      result_status: 'retracted',
      retracted_by: 16,
      retraction_reason: 'Result was published against the wrong laboratory order.',
      retraction_request_id: 1,
    });
    expect(database.prepare(`
      SELECT status, result_status, retracted_by FROM lab_order_items WHERE id = 10
    `).get()).toEqual({ status: 'rejected', result_status: 'retracted', retracted_by: 16 });
    expect(database.prepare(`
      SELECT report_status, review_status, delivery_status, retracted_by, retraction_count
      FROM lab_reports WHERE id = 1
    `).get()).toEqual({
      report_status: 'retracted',
      review_status: 'pending',
      delivery_status: 'retracted',
      retracted_by: 16,
      retraction_count: 1,
    });
    expect(database.prepare(`
      SELECT status, state_version, requested_by, reviewed_by
      FROM lis_result_retraction_requests WHERE id = 1
    `).get()).toEqual({ status: 'applied', state_version: 2, requested_by: 15, reviewed_by: 16 });
    expect(database.prepare(`
      SELECT event_type, status, attempt_count
      FROM lis_result_retraction_notification_outbox WHERE retraction_request_id = 1
    `).get()).toEqual({ event_type: 'result_retracted', status: 'pending', attempt_count: 0 });
    expect(database.prepare(`
      SELECT result_status, observation_source, correction_reason, version_no, supersedes_observation_id
      FROM lab_observation_audit WHERE lab_order_item_id = 10
      ORDER BY version_no DESC LIMIT 1
    `).get()).toEqual({
      result_status: 'retracted',
      observation_source: 'retraction',
      correction_reason: 'Result was published against the wrong laboratory order.',
      version_no: 2,
      supersedes_observation_id: 1,
    });

    expect(() => database.prepare(`UPDATE lab_results SET result_value = 'tampered' WHERE id = 1`).run())
      .toThrow(/retracted laboratory result is immutable/i);
    expect(() => database.prepare(`DELETE FROM lab_results WHERE id = 1`).run())
      .toThrow(/cannot be deleted/i);
  });

  it('creates a versioned amended report after retraction and binds the corrected result only to it', async () => {
    const database = createDatabase();
    const adapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await acceptStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 1,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
    });
    const requested = await requestLisResultRetraction(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedInboxVersion: 2,
      requestedBy: 15,
      requesterRole: 'pathologist',
      reasonCode: 'invalid_result',
      reason: 'Published analyzer result was clinically invalid after source verification.',
    });
    await approveLisResultRetraction(adapter, {
      tenantId: 'tenant-1',
      requestId: requested.requestId,
      expectedVersion: 1,
      reviewedBy: 16,
      reviewerRole: 'lab_supervisor',
      reviewNotes: 'Verified analyzer source, specimen identity, and the original published report.',
    });

    await expect(createLisInboxSupersession(adapter, {
      tenantId: 'tenant-1',
      sourceInboxId: 80,
      expectedVersion: 2,
      targetLabOrderItemId: 10,
      requestedBy: 15,
      requesterRole: 'pathologist',
      reason: 'Create a corrected result after the formally approved retraction.',
    })).resolves.toMatchObject({ created: true, inboxId: 81 });

    await expect(acceptStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 81,
      expectedVersion: 1,
      reviewerUserId: 9,
      reviewerRole: 'pathologist',
    })).resolves.toMatchObject({ accepted: true, corrected: true, inboxId: 81 });

    expect(database.prepare(`
      SELECT id, report_status, report_version, supersedes_report_id, amendment_reason
      FROM lab_reports ORDER BY report_version, id
    `).all()).toEqual([
      {
        id: 1,
        report_status: 'retracted',
        report_version: 1,
        supersedes_report_id: null,
        amendment_reason: null,
      },
      {
        id: 2,
        report_status: 'pending',
        report_version: 2,
        supersedes_report_id: 1,
        amendment_reason: 'Create a corrected result after the formally approved retraction.',
      },
    ]);
    expect(database.prepare(`
      SELECT id, lab_report_id, result_status, lis_analyzer_inbox_id
      FROM lab_results ORDER BY id
    `).all()).toEqual([
      { id: 1, lab_report_id: 1, result_status: 'retracted', lis_analyzer_inbox_id: 80 },
      { id: 2, lab_report_id: 2, result_status: 'final', lis_analyzer_inbox_id: 81 },
    ]);
    expect(database.prepare(`
      SELECT disposition, state_version, canonical_lab_result_id
      FROM lis_analyzer_inbox WHERE id = 81
    `).get()).toEqual({ disposition: 'accepted', state_version: 2, canonical_lab_result_id: 2 });
  });

  it('rolls back retraction when durable notification evidence is silently ignored', async () => {
    const database = createDatabase();
    const adapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await acceptStagedLisResult(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 1,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
    });
    const requested = await requestLisResultRetraction(adapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedInboxVersion: 2,
      requestedBy: 15,
      requesterRole: 'pathologist',
      reasonCode: 'wrong_order',
      reason: 'Result was published against the wrong laboratory order.',
    });

    database.exec(`
      CREATE TRIGGER ignore_lis_retraction_outbox_insert
      BEFORE INSERT ON lis_result_retraction_notification_outbox
      FOR EACH ROW
      BEGIN
        SELECT RAISE(IGNORE);
      END;
    `);

    await expect(approveLisResultRetraction(adapter, {
      tenantId: 'tenant-1',
      requestId: requested.requestId,
      expectedVersion: 1,
      reviewedBy: 16,
      reviewerRole: 'lab_supervisor',
      reviewNotes: 'Verified against analyzer source, specimen, and the patient order.',
    })).rejects.toThrow(/applied evidence is incomplete/i);

    expect(database.prepare(`SELECT result_status, retraction_request_id FROM lab_results WHERE id = 1`).get())
      .toEqual({ result_status: 'final', retraction_request_id: null });
    expect(database.prepare(`SELECT status, result_status FROM lab_order_items WHERE id = 10`).get())
      .toEqual({ status: 'completed', result_status: 'final' });
    expect(database.prepare(`SELECT report_status, retracted_at FROM lab_reports WHERE id = 1`).get())
      .toEqual({ report_status: 'pending', retracted_at: null });
    expect(database.prepare(`SELECT status, state_version, reviewed_by FROM lis_result_retraction_requests WHERE id = 1`).get())
      .toEqual({ status: 'requested', state_version: 1, reviewed_by: null });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lis_result_retraction_notification_outbox`).get())
      .toEqual({ total: 0 });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lab_observation_audit WHERE retraction_request_id = 1`).get())
      .toEqual({ total: 0 });
  });

  it('rolls back every retraction mutation when notification outbox creation fails', async () => {
    const database = createDatabase();
    const baseAdapter = new SQLiteD1Adapter(database) as unknown as D1Database;

    await acceptStagedLisResult(baseAdapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedVersion: 1,
      reviewerUserId: 15,
      reviewerRole: 'pathologist',
    });
    const requested = await requestLisResultRetraction(baseAdapter, {
      tenantId: 'tenant-1',
      inboxId: 80,
      expectedInboxVersion: 2,
      requestedBy: 15,
      requesterRole: 'pathologist',
      reasonCode: 'wrong_order',
      reason: 'Result was published against the wrong laboratory order.',
    });

    const failingAdapter = new SQLiteD1Adapter(
      database,
      'INSERT INTO lis_result_retraction_notification_outbox',
    ) as unknown as D1Database;
    await expect(approveLisResultRetraction(failingAdapter, {
      tenantId: 'tenant-1',
      requestId: requested.requestId,
      expectedVersion: 1,
      reviewedBy: 16,
      reviewerRole: 'lab_supervisor',
      reviewNotes: 'Verified against analyzer source, specimen, and the patient order.',
    })).rejects.toThrow('simulated acceptance batch failure');

    expect(database.prepare(`SELECT result_status, retraction_request_id FROM lab_results WHERE id = 1`).get())
      .toEqual({ result_status: 'final', retraction_request_id: null });
    expect(database.prepare(`SELECT status, state_version, reviewed_by FROM lis_result_retraction_requests WHERE id = 1`).get())
      .toEqual({ status: 'requested', state_version: 1, reviewed_by: null });
    expect(database.prepare(`SELECT COUNT(*) AS total FROM lis_result_retraction_notification_outbox`).get())
      .toEqual({ total: 0 });
  });
});
