import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationSql = readFileSync('migrations/0404_lis_analyzer_safety_inbox.sql', 'utf8');
const terminalDecisionMigrationSql = readFileSync('migrations/0405_lis_inbox_terminal_decisions.sql', 'utf8');
const supersessionMigrationSql = readFileSync('migrations/0406_lis_inbox_supersession_workflow.sql', 'utf8');
const retractionMigrationSql = readFileSync('migrations/0407_lis_result_retraction_workflow.sql', 'utf8');
const retractionDispatchMigrationSql = readFileSync('migrations/0408_lis_retraction_notification_dispatch.sql', 'utf8');

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE lab_machines (id INTEGER PRIMARY KEY);
    CREATE TABLE lis_bridge_agents (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_machine_result_log (id INTEGER PRIMARY KEY);
    CREATE TABLE patients (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_specimens (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_test_catalog (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_test_components (id INTEGER PRIMARY KEY);
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE lab_orders (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER
    );
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT,
      lab_order_id INTEGER,
      lab_test_id INTEGER,
      status TEXT DEFAULT 'processing'
        CHECK(status IN ('pending','collected','received','processing','completed','verified','rejected','cancelled')),
      result_status TEXT
    );
    CREATE TABLE lab_reports (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      lab_order_id INTEGER,
      report_status TEXT,
      review_status TEXT,
      delivery_status TEXT,
      corrected_at DATETIME
    );
    CREATE TABLE lab_results (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT,
      lab_report_id INTEGER,
      lab_test_id INTEGER,
      result_status TEXT,
      result_value TEXT,
      updated_at DATETIME
    );
    CREATE TABLE lab_observation_audit (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT,
      result_status TEXT
    );
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
  `);
  database.exec(migrationSql);
  database.exec(terminalDecisionMigrationSql);
  database.exec(supersessionMigrationSql);
  database.exec(retractionMigrationSql);
  database.exec(retractionDispatchMigrationSql);
  database.prepare('INSERT INTO lab_machines (id) VALUES (?)').run(1);
  return database;
}

function insertMessage(
  database: DatabaseSync,
  input: { tenantId?: string; machineId?: number; identity?: string; hash?: string } = {},
): number {
  const result = database.prepare(`
    INSERT INTO lis_ingestion_messages (
      tenant_id, machine_id, protocol, message_identity, payload_sha256,
      status, raw_payload
    ) VALUES (?, ?, 'hl7', ?, ?, 'received', ?)
  `).run(
    input.tenantId ?? 'tenant-1',
    input.machineId ?? 1,
    input.identity ?? 'ANALYZER|LAB|ORU^R01|MSG-1',
    input.hash ?? 'hash-1',
    'MSH|...|OBX|...',
  );
  return Number(result.lastInsertRowid);
}

function insertInbox(database: DatabaseSync, messageId: number): number {
  const result = database.prepare(`
    INSERT INTO lis_analyzer_inbox (
      tenant_id, ingestion_message_id, observation_index, machine_id,
      identifier_type, identifier_value, machine_test_code,
      raw_value, raw_units, analyzer_result_status, analyzer_abnormal_flag,
      match_state, qc_state, validation_state, disposition, source_payload_json
    ) VALUES (
      'tenant-1', ?, 0, 1,
      'barcode', 'BC-100', 'HGB',
      '14.2', 'g/dL', 'F', 'N',
      'exact', 'pass', 'pass', 'review_required', '{}'
    )
  `).run(messageId);
  return Number(result.lastInsertRowid);
}

function insertAcceptedClinicalResult(database: DatabaseSync) {
  database.exec(`
    INSERT INTO users (id) VALUES (15), (16);
    INSERT INTO patients (id) VALUES (40);
    INSERT INTO lab_test_catalog (id) VALUES (7);
    INSERT INTO lab_orders (id, tenant_id, patient_id) VALUES (20, 'tenant-1', 40);
    INSERT INTO lab_order_items (
      id, tenant_id, lab_order_id, lab_test_id, status, result_status
    ) VALUES (10, 'tenant-1', 20, 7, 'completed', 'final');
    INSERT INTO lab_reports (
      id, tenant_id, lab_order_id, report_status, review_status, delivery_status
    ) VALUES (501, 'tenant-1', 20, 'published', 'approved', 'delivered');
    INSERT INTO lab_results (
      id, tenant_id, lab_report_id, lab_test_id, result_status, result_value
    ) VALUES (601, 'tenant-1', 501, 7, 'final', '14.2');
  `);
  const inboxId = insertInbox(database, insertMessage(database));
  database.prepare(`
    UPDATE lis_analyzer_inbox
    SET disposition = 'accepted',
        state_version = 2,
        accepted_by = 15,
        accepted_at = CURRENT_TIMESTAMP,
        canonical_lab_result_id = 601
    WHERE id = ?
  `).run(inboxId);
  return { inboxId, labResultId: 601, labReportId: 501, labOrderItemId: 10 };
}

function insertRetractionRequest(
  database: DatabaseSync,
  input: { inboxId: number; status?: string; reason?: string } ,
): number {
  const result = database.prepare(`
    INSERT INTO lis_result_retraction_requests (
      tenant_id, lis_analyzer_inbox_id, lab_result_id, lab_report_id,
      lab_order_item_id, lab_order_id, patient_id, expected_inbox_version,
      requested_by, requester_role, reason_code, reason, status
    ) VALUES (
      'tenant-1', ?, 601, 501,
      10, 20, 40, 2,
      15, 'pathologist', 'wrong_order', ?, ?
    )
  `).run(
    input.inboxId,
    input.reason ?? 'Result was published against the wrong laboratory order.',
    input.status ?? 'requested',
  );
  return Number(result.lastInsertRowid);
}

describe('LIS analyzer safety schema', () => {
  it('enforces replay identity per tenant and machine', () => {
    const database = createDatabase();
    insertMessage(database);

    expect(() => insertMessage(database)).toThrow(/UNIQUE constraint failed/);
    expect(() => insertMessage(database, { tenantId: 'tenant-2' })).not.toThrow();

    database.prepare('INSERT INTO lab_machines (id) VALUES (?)').run(2);
    expect(() => insertMessage(database, { machineId: 2 })).not.toThrow();
  });

  it('prevents mutation of replay identity and raw analyzer message evidence', () => {
    const database = createDatabase();
    const messageId = insertMessage(database);

    expect(() => database.prepare(`
      UPDATE lis_ingestion_messages SET payload_sha256 = 'tampered' WHERE id = ?
    `).run(messageId)).toThrow(/immutable ingestion evidence/i);
    expect(() => database.prepare(`
      UPDATE lis_ingestion_messages SET raw_payload = 'tampered' WHERE id = ?
    `).run(messageId)).toThrow(/immutable ingestion evidence/i);
    expect(() => database.prepare(`
      UPDATE lis_ingestion_messages SET message_identity = 'tampered' WHERE id = ?
    `).run(messageId)).toThrow(/immutable ingestion evidence/i);

    expect(() => database.prepare(`
      UPDATE lis_ingestion_messages
      SET status = 'completed', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(messageId)).not.toThrow();
  });

  it('allows one observation index per ingestion message', () => {
    const database = createDatabase();
    const messageId = insertMessage(database);
    insertInbox(database, messageId);

    expect(() => insertInbox(database, messageId)).toThrow(/UNIQUE constraint failed/);
  });

  it('prevents mutation of analyzer evidence while allowing disposition transitions', () => {
    const database = createDatabase();
    const inboxId = insertInbox(database, insertMessage(database));

    expect(() => database.prepare(`
      UPDATE lis_analyzer_inbox SET raw_value = '99.9' WHERE id = ?
    `).run(inboxId)).toThrow(/immutable analyzer evidence/i);
    expect(() => database.prepare(`
      UPDATE lis_analyzer_inbox SET normalized_value = '99.9' WHERE id = ?
    `).run(inboxId)).toThrow(/immutable analyzer evidence/i);
    expect(() => database.prepare(`
      UPDATE lis_analyzer_inbox SET patient_id = 999 WHERE id = ?
    `).run(inboxId)).toThrow(/immutable analyzer evidence/i);
    expect(() => database.prepare(`
      UPDATE lis_analyzer_inbox SET qc_state = 'override' WHERE id = ?
    `).run(inboxId)).toThrow(/immutable analyzer evidence/i);

    expect(() => database.prepare(`
      UPDATE lis_analyzer_inbox
      SET disposition = 'accepted', state_version = state_version + 1
      WHERE id = ?
    `).run(inboxId)).not.toThrow();

    const row = database.prepare(`
      SELECT raw_value, disposition, state_version
      FROM lis_analyzer_inbox WHERE id = ?
    `).get(inboxId) as { raw_value: string; disposition: string; state_version: number };

    expect(row).toEqual({ raw_value: '14.2', disposition: 'accepted', state_version: 2 });
  });

  it('makes accepted and rejected reviewer decisions terminal at the database boundary', () => {
    const database = createDatabase();
    const acceptedId = insertInbox(database, insertMessage(database));

    database.prepare(`
      UPDATE lis_analyzer_inbox
      SET disposition = 'accepted', state_version = state_version + 1
      WHERE id = ?
    `).run(acceptedId);

    expect(() => database.prepare(`
      UPDATE lis_analyzer_inbox SET disposition = 'rejected' WHERE id = ?
    `).run(acceptedId)).toThrow(/terminal analyzer inbox decision/i);
    expect(() => database.prepare(`
      UPDATE lis_analyzer_inbox SET updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(acceptedId)).toThrow(/terminal analyzer inbox decision/i);

    const rejectedMessageId = insertMessage(database, { identity: 'ANALYZER|LAB|ORU^R01|MSG-2', hash: 'hash-2' });
    const rejectedId = insertInbox(database, rejectedMessageId);
    database.prepare(`
      UPDATE lis_analyzer_inbox
      SET disposition = 'rejected', rejection_reason = 'Wrong patient', state_version = state_version + 1
      WHERE id = ?
    `).run(rejectedId);

    expect(() => database.prepare(`
      UPDATE lis_analyzer_inbox SET rejection_reason = 'Changed later' WHERE id = ?
    `).run(rejectedId)).toThrow(/terminal analyzer inbox decision/i);
  });

  it('rejects unknown message and inbox states', () => {
    const database = createDatabase();

    expect(() => database.prepare(`
      INSERT INTO lis_ingestion_messages (
        tenant_id, machine_id, protocol, message_identity, payload_sha256, status, raw_payload
      ) VALUES ('tenant-1', 1, 'hl7', 'bad-state', 'hash', 'mystery', 'payload')
    `).run()).toThrow(/CHECK constraint failed/);

    const messageId = insertMessage(database);
    expect(() => database.prepare(`
      INSERT INTO lis_analyzer_inbox (
        tenant_id, ingestion_message_id, observation_index, machine_id,
        machine_test_code, raw_value, disposition, source_payload_json
      ) VALUES ('tenant-1', ?, 0, 1, 'HGB', '14.2', 'mystery', '{}')
    `).run(messageId)).toThrow(/CHECK constraint failed/);
  });

  it('records conflicting payloads without mutating the original message', () => {
    const database = createDatabase();
    const messageId = insertMessage(database);

    database.prepare(`
      INSERT INTO lis_ingestion_collisions (
        tenant_id, machine_id, original_message_id, message_identity,
        incoming_payload_sha256, incoming_raw_payload
      ) VALUES ('tenant-1', 1, ?, 'ANALYZER|LAB|ORU^R01|MSG-1', 'hash-2', 'different payload')
    `).run(messageId);

    const original = database.prepare(`
      SELECT payload_sha256, raw_payload FROM lis_ingestion_messages WHERE id = ?
    `).get(messageId) as { payload_sha256: string; raw_payload: string };
    const collision = database.prepare(`
      SELECT incoming_payload_sha256, incoming_raw_payload FROM lis_ingestion_collisions
      WHERE original_message_id = ?
    `).get(messageId) as { incoming_payload_sha256: string; incoming_raw_payload: string };

    expect(original).toEqual({ payload_sha256: 'hash-1', raw_payload: 'MSH|...|OBX|...' });
    expect(collision).toEqual({ incoming_payload_sha256: 'hash-2', incoming_raw_payload: 'different payload' });
  });

  it('links accepted clinical evidence to one inbox row and enforces one acceptance claim', () => {
    const database = createDatabase();
    const messageId = insertMessage(database);
    const inboxId = insertInbox(database, messageId);
    database.prepare('INSERT INTO users (id) VALUES (?), (?)').run(15, 16);

    const inboxColumns = database.prepare('PRAGMA table_info(lis_analyzer_inbox)').all() as Array<{ name: string }>;
    const resultColumns = database.prepare('PRAGMA table_info(lab_results)').all() as Array<{ name: string }>;
    const auditColumns = database.prepare('PRAGMA table_info(lab_observation_audit)').all() as Array<{ name: string }>;

    expect(inboxColumns.map((column) => column.name)).toContain('staged_by');
    expect(resultColumns.map((column) => column.name)).toContain('lis_analyzer_inbox_id');
    expect(auditColumns.map((column) => column.name)).toContain('lis_analyzer_inbox_id');

    database.prepare(`
      INSERT INTO lis_result_acceptance_commands (
        tenant_id, lis_analyzer_inbox_id, expected_version, reviewer_user_id, reviewer_role
      ) VALUES ('tenant-1', ?, 1, 15, 'pathologist')
    `).run(inboxId);

    expect(() => database.prepare(`
      INSERT INTO lis_result_acceptance_commands (
        tenant_id, lis_analyzer_inbox_id, expected_version, reviewer_user_id, reviewer_role
      ) VALUES ('tenant-1', ?, 1, 16, 'lab_supervisor')
    `).run(inboxId)).toThrow(/UNIQUE constraint failed/);
  });

  it('enforces one direct successor and one supersession command per source evidence row', () => {
    const database = createDatabase();
    const messageId = insertMessage(database);
    const sourceId = insertInbox(database, messageId);

    const insertSuccessor = (observationIndex: number) => database.prepare(`
      INSERT INTO lis_analyzer_inbox (
        tenant_id, ingestion_message_id, observation_index, machine_id,
        identifier_type, identifier_value, machine_test_code,
        raw_value, raw_units, analyzer_result_status, analyzer_abnormal_flag,
        match_state, qc_state, validation_state, disposition,
        source_payload_json, supersedes_inbox_id
      ) VALUES (
        'tenant-1', ?, ?, 1,
        'barcode', 'BC-100', 'HGB',
        '14.2', 'g/dL', 'F', 'N',
        'exact', 'pass', 'pass', 'review_required', '{}', ?
      )
    `).run(messageId, observationIndex, sourceId);

    expect(() => insertSuccessor(1)).not.toThrow();
    expect(() => insertSuccessor(2)).toThrow(/UNIQUE constraint failed/);

    database.prepare('INSERT INTO users (id) VALUES (?)').run(15);
    database.prepare('INSERT INTO lab_order_items (id) VALUES (?)').run(10);
    const insertCommand = () => database.prepare(`
      INSERT INTO lis_inbox_supersession_commands (
        tenant_id, source_inbox_id, source_state_version,
        target_lab_order_item_id, requested_by, requester_role, reason
      ) VALUES ('tenant-1', ?, 1, 10, 15, 'pathologist', 'Documented rematch reason')
    `).run(sourceId);

    expect(() => insertCommand()).not.toThrow();
    expect(() => insertCommand()).toThrow(/UNIQUE constraint failed/);
  });

  it('allows only one open result retraction request per accepted analyzer evidence row', () => {
    const database = createDatabase();
    const { inboxId } = insertAcceptedClinicalResult(database);

    const firstRequestId = insertRetractionRequest(database, { inboxId });
    expect(() => insertRetractionRequest(database, { inboxId })).toThrow(/UNIQUE constraint failed/);

    database.prepare(`
      UPDATE lis_result_retraction_requests
      SET status = 'rejected', reviewed_by = 16, reviewed_at = CURRENT_TIMESTAMP,
          review_notes = 'Independent review found the published result is correct.',
          state_version = 2
      WHERE id = ?
    `).run(firstRequestId);

    expect(() => insertRetractionRequest(database, {
      inboxId,
      reason: 'New evidence confirms the result belongs to another laboratory order.',
    })).not.toThrow();
  });

  it('keeps retraction request evidence and terminal decisions immutable', () => {
    const database = createDatabase();
    const { inboxId } = insertAcceptedClinicalResult(database);
    const requestId = insertRetractionRequest(database, { inboxId });

    expect(() => database.prepare(`
      UPDATE lis_result_retraction_requests SET reason = 'Changed later' WHERE id = ?
    `).run(requestId)).toThrow(/retraction request evidence is immutable/i);

    database.prepare(`
      UPDATE lis_result_retraction_requests
      SET status = 'rejected', reviewed_by = 16, reviewed_at = CURRENT_TIMESTAMP,
          review_notes = 'Independent review found the published result is correct.',
          state_version = 2
      WHERE id = ?
    `).run(requestId);

    expect(() => database.prepare(`
      UPDATE lis_result_retraction_requests SET review_notes = 'Changed later' WHERE id = ?
    `).run(requestId)).toThrow(/terminal decision is immutable/i);
  });

  it('keeps retraction notification evidence immutable while allowing delivery lifecycle updates', () => {
    const database = createDatabase();
    const { inboxId } = insertAcceptedClinicalResult(database);
    const requestId = insertRetractionRequest(database, { inboxId, status: 'applied' });

    database.prepare(`
      INSERT INTO lis_result_retraction_notification_outbox (
        tenant_id, retraction_request_id, payload_json, recipient_policy_json
      ) VALUES ('tenant-1', ?, '{"result":"withdrawn"}', '{"notifyPatient":true}')
    `).run(requestId);

    expect(() => database.prepare(`
      UPDATE lis_result_retraction_notification_outbox
      SET payload_json = '{"tampered":true}'
      WHERE retraction_request_id = ?
    `).run(requestId)).toThrow(/notification evidence is immutable/i);

    expect(() => database.prepare(`
      UPDATE lis_result_retraction_notification_outbox
      SET status = 'sent', attempt_count = 1, sent_at = CURRENT_TIMESTAMP
      WHERE retraction_request_id = ?
    `).run(requestId)).not.toThrow();
  });

  it('prevents mutation or deletion of retracted canonical result and report evidence', () => {
    const database = createDatabase();
    const { inboxId, labResultId, labReportId } = insertAcceptedClinicalResult(database);
    const requestId = insertRetractionRequest(database, { inboxId, status: 'applied' });

    database.prepare(`
      UPDATE lab_results
      SET result_status = 'retracted', retraction_request_id = ?,
          retracted_by = 16, retracted_at = CURRENT_TIMESTAMP,
          retraction_reason = 'Result belongs to another laboratory order.'
      WHERE id = ?
    `).run(requestId, labResultId);
    database.prepare(`
      UPDATE lab_reports
      SET report_status = 'retracted', retracted_by = 16,
          retracted_at = CURRENT_TIMESTAMP,
          retraction_reason = 'Result belongs to another laboratory order.'
      WHERE id = ?
    `).run(labReportId);

    expect(() => database.prepare(`
      UPDATE lab_results SET result_value = '99.9' WHERE id = ?
    `).run(labResultId)).toThrow(/retracted laboratory result is immutable/i);
    expect(() => database.prepare(`DELETE FROM lab_results WHERE id = ?`).run(labResultId))
      .toThrow(/cannot be deleted/i);
    expect(() => database.prepare(`
      UPDATE lab_reports SET report_status = 'published' WHERE id = ?
    `).run(labReportId)).toThrow(/retracted laboratory report is immutable/i);
    expect(() => database.prepare(`DELETE FROM lab_reports WHERE id = ?`).run(labReportId))
      .toThrow(/cannot be deleted/i);
  });

  it('enforces per-recipient notification dedupe and immutable dispatch evidence', () => {
    const database = createDatabase();
    const { inboxId } = insertAcceptedClinicalResult(database);
    const requestId = insertRetractionRequest(database, { inboxId });
    const outboxId = Number(database.prepare(`
      INSERT INTO lis_result_retraction_notification_outbox (
        tenant_id, retraction_request_id, payload_json, recipient_policy_json
      ) VALUES ('tenant-1', ?, '{}', '{}')
    `).run(requestId).lastInsertRowid);

    const insertDelivery = () => database.prepare(`
      INSERT INTO lis_result_retraction_notification_deliveries (
        tenant_id, outbox_id, channel, recipient_type, recipient_id,
        delivery_key, status
      ) VALUES ('tenant-1', ?, 'portal', 'patient', 40, ?, 'pending')
    `).run(outboxId, `lis-retraction:${outboxId}:portal:patient:40`);
    expect(() => insertDelivery()).not.toThrow();
    expect(() => insertDelivery()).toThrow(/UNIQUE constraint failed/);
    expect(() => database.prepare(`
      UPDATE lis_result_retraction_notification_deliveries
      SET recipient_id = 41 WHERE outbox_id = ?
    `).run(outboxId)).toThrow(/delivery identity is immutable/i);

    database.prepare(`
      INSERT INTO patient_portal_notifications (
        tenant_id, patient_id, title, message, dedupe_key
      ) VALUES ('tenant-1', 40, 'Report withdrawn', 'Do not use this report', ?)
    `).run(`lis-retraction:${outboxId}:portal:patient:40`);
    expect(() => database.prepare(`
      INSERT INTO patient_portal_notifications (
        tenant_id, patient_id, title, message, dedupe_key
      ) VALUES ('tenant-1', 40, 'Duplicate', 'Duplicate', ?)
    `).run(`lis-retraction:${outboxId}:portal:patient:40`)).toThrow(/UNIQUE constraint failed/);
    expect(() => database.prepare(`
      UPDATE patient_portal_notifications SET message = 'tampered' WHERE patient_id = 40
    `).run()).toThrow(/portal notification evidence is immutable/i);
    expect(() => database.prepare(`
      UPDATE patient_portal_notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE patient_id = 40
    `).run()).not.toThrow();
  });

  it('deduplicates critical communication events for the same accepted inbox result', () => {
    const database = createDatabase();
    const inboxId = insertInbox(database, insertMessage(database));

    database.prepare(`
      INSERT INTO lis_critical_event_outbox (
        tenant_id, lis_analyzer_inbox_id, event_type, status, payload_json
      ) VALUES ('tenant-1', ?, 'critical_result', 'pending', '{}')
    `).run(inboxId);

    expect(() => database.prepare(`
      INSERT INTO lis_critical_event_outbox (
        tenant_id, lis_analyzer_inbox_id, event_type, status, payload_json
      ) VALUES ('tenant-1', ?, 'critical_result', 'pending', '{}')
    `).run(inboxId)).toThrow(/UNIQUE constraint failed/);
  });
});
