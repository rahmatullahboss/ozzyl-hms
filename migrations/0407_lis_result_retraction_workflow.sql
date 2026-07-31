-- Formal two-person retraction workflow for accepted analyzer results.
-- The accepted inbox evidence and original clinical values remain immutable.

CREATE TABLE IF NOT EXISTS lis_result_retraction_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  lis_analyzer_inbox_id INTEGER NOT NULL REFERENCES lis_analyzer_inbox(id),
  lab_result_id INTEGER NOT NULL REFERENCES lab_results(id),
  lab_report_id INTEGER NOT NULL REFERENCES lab_reports(id),
  lab_order_item_id INTEGER NOT NULL REFERENCES lab_order_items(id),
  lab_order_id INTEGER NOT NULL REFERENCES lab_orders(id),
  patient_id INTEGER REFERENCES patients(id),
  expected_inbox_version INTEGER NOT NULL CHECK (expected_inbox_version >= 1),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  requester_role TEXT NOT NULL,
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'wrong_patient', 'wrong_order', 'wrong_specimen', 'invalid_result',
    'duplicate_result', 'analyzer_error', 'other'
  )),
  reason TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'applying', 'applied', 'rejected')),
  state_version INTEGER NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at DATETIME,
  review_notes TEXT,
  applied_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_lis_result_retraction_open
  ON lis_result_retraction_requests(tenant_id, lis_analyzer_inbox_id)
  WHERE status IN ('requested', 'applying');
CREATE INDEX IF NOT EXISTS idx_lis_result_retraction_queue
  ON lis_result_retraction_requests(tenant_id, status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_lis_result_retraction_result
  ON lis_result_retraction_requests(tenant_id, lab_result_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_lis_result_retraction_request_evidence_immutable
BEFORE UPDATE ON lis_result_retraction_requests
FOR EACH ROW
WHEN
  NEW.tenant_id IS NOT OLD.tenant_id OR
  NEW.lis_analyzer_inbox_id IS NOT OLD.lis_analyzer_inbox_id OR
  NEW.lab_result_id IS NOT OLD.lab_result_id OR
  NEW.lab_report_id IS NOT OLD.lab_report_id OR
  NEW.lab_order_item_id IS NOT OLD.lab_order_item_id OR
  NEW.lab_order_id IS NOT OLD.lab_order_id OR
  NEW.patient_id IS NOT OLD.patient_id OR
  NEW.expected_inbox_version IS NOT OLD.expected_inbox_version OR
  NEW.requested_by IS NOT OLD.requested_by OR
  NEW.requester_role IS NOT OLD.requester_role OR
  NEW.reason_code IS NOT OLD.reason_code OR
  NEW.reason IS NOT OLD.reason OR
  NEW.notes IS NOT OLD.notes OR
  NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'LIS retraction request evidence is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_lis_result_retraction_terminal_immutable
BEFORE UPDATE ON lis_result_retraction_requests
FOR EACH ROW
WHEN OLD.status IN ('applied', 'rejected')
BEGIN
  SELECT RAISE(ABORT, 'LIS retraction terminal decision is immutable');
END;

CREATE TABLE IF NOT EXISTS lis_result_retraction_notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  retraction_request_id INTEGER NOT NULL REFERENCES lis_result_retraction_requests(id),
  event_type TEXT NOT NULL DEFAULT 'result_retracted'
    CHECK (event_type IN ('result_retracted')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  payload_json TEXT NOT NULL,
  recipient_policy_json TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  next_attempt_at DATETIME,
  sent_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, retraction_request_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_lis_result_retraction_outbox_dispatch
  ON lis_result_retraction_notification_outbox(status, next_attempt_at, created_at);

CREATE TRIGGER IF NOT EXISTS trg_lis_result_retraction_outbox_evidence_immutable
BEFORE UPDATE ON lis_result_retraction_notification_outbox
FOR EACH ROW
WHEN
  NEW.tenant_id IS NOT OLD.tenant_id OR
  NEW.retraction_request_id IS NOT OLD.retraction_request_id OR
  NEW.event_type IS NOT OLD.event_type OR
  NEW.payload_json IS NOT OLD.payload_json OR
  NEW.recipient_policy_json IS NOT OLD.recipient_policy_json OR
  NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'LIS retraction notification evidence is immutable');
END;

ALTER TABLE lab_observation_audit ADD COLUMN retraction_request_id INTEGER REFERENCES lis_result_retraction_requests(id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_observation_audit_retraction_request
  ON lab_observation_audit(tenant_id, retraction_request_id)
  WHERE retraction_request_id IS NOT NULL;

ALTER TABLE lab_results ADD COLUMN retracted_at DATETIME;
ALTER TABLE lab_results ADD COLUMN retracted_by INTEGER REFERENCES users(id);
ALTER TABLE lab_results ADD COLUMN retraction_reason TEXT;
ALTER TABLE lab_results ADD COLUMN retraction_request_id INTEGER REFERENCES lis_result_retraction_requests(id);

ALTER TABLE lab_order_items ADD COLUMN retracted_at DATETIME;
ALTER TABLE lab_order_items ADD COLUMN retracted_by INTEGER REFERENCES users(id);
ALTER TABLE lab_order_items ADD COLUMN retraction_reason TEXT;

ALTER TABLE lab_reports ADD COLUMN retracted_at DATETIME;
ALTER TABLE lab_reports ADD COLUMN retracted_by INTEGER REFERENCES users(id);
ALTER TABLE lab_reports ADD COLUMN retraction_reason TEXT;
ALTER TABLE lab_reports ADD COLUMN retraction_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE lab_reports ADD COLUMN report_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE lab_reports ADD COLUMN supersedes_report_id INTEGER REFERENCES lab_reports(id);
ALTER TABLE lab_reports ADD COLUMN amendment_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_lab_reports_direct_amendment
  ON lab_reports(tenant_id, supersedes_report_id)
  WHERE supersedes_report_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lab_results_retraction_request
  ON lab_results(tenant_id, retraction_request_id);
CREATE INDEX IF NOT EXISTS idx_lab_reports_retracted
  ON lab_reports(tenant_id, report_status, retracted_at);

CREATE TRIGGER IF NOT EXISTS trg_lis_acceptance_completion_requires_canonical
BEFORE UPDATE OF command_status ON lis_result_acceptance_commands
FOR EACH ROW
WHEN NEW.command_status = 'completed'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM lis_analyzer_inbox inbox
    JOIN lab_results result
      ON result.id = inbox.canonical_lab_result_id
     AND result.tenant_id = inbox.tenant_id
     AND result.lis_analyzer_inbox_id = inbox.id
    WHERE inbox.id = NEW.lis_analyzer_inbox_id
      AND inbox.tenant_id = NEW.tenant_id
      AND inbox.disposition = 'accepted'
  ) THEN RAISE(ABORT, 'LIS acceptance canonical evidence is incomplete') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_lis_retraction_applied_requires_complete_evidence
BEFORE UPDATE OF status ON lis_result_retraction_requests
FOR EACH ROW
WHEN NEW.status = 'applied'
BEGIN
  SELECT CASE WHEN
    OLD.status <> 'applying' OR
    NEW.reviewed_by IS NULL OR
    NEW.applied_at IS NULL OR
    NOT EXISTS (
      SELECT 1
      FROM lab_results result
      WHERE result.id = NEW.lab_result_id
        AND result.tenant_id = NEW.tenant_id
        AND result.result_status = 'retracted'
        AND result.retraction_request_id = NEW.id
    ) OR
    NOT EXISTS (
      SELECT 1
      FROM lab_order_items item
      WHERE item.id = NEW.lab_order_item_id
        AND item.tenant_id = NEW.tenant_id
        AND item.result_status = 'retracted'
        AND item.retracted_by = NEW.reviewed_by
    ) OR
    NOT EXISTS (
      SELECT 1
      FROM lab_reports report
      WHERE report.id = NEW.lab_report_id
        AND report.tenant_id = NEW.tenant_id
        AND report.report_status = 'retracted'
        AND report.retracted_by = NEW.reviewed_by
    ) OR
    NOT EXISTS (
      SELECT 1
      FROM lab_observation_audit audit
      WHERE audit.tenant_id = NEW.tenant_id
        AND audit.retraction_request_id = NEW.id
        AND audit.result_status = 'retracted'
    ) OR
    NOT EXISTS (
      SELECT 1
      FROM lis_result_retraction_notification_outbox outbox
      WHERE outbox.tenant_id = NEW.tenant_id
        AND outbox.retraction_request_id = NEW.id
        AND outbox.event_type = 'result_retracted'
    )
  THEN RAISE(ABORT, 'LIS retraction applied evidence is incomplete') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_lab_reports_retracted_immutable
BEFORE UPDATE ON lab_reports
FOR EACH ROW
WHEN OLD.report_status = 'retracted'
BEGIN
  SELECT RAISE(ABORT, 'Retracted laboratory report is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_lab_reports_retracted_no_delete
BEFORE DELETE ON lab_reports
FOR EACH ROW
WHEN OLD.report_status = 'retracted'
BEGIN
  SELECT RAISE(ABORT, 'Retracted laboratory report cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS trg_lab_results_retracted_immutable
BEFORE UPDATE ON lab_results
FOR EACH ROW
WHEN OLD.result_status = 'retracted'
BEGIN
  SELECT RAISE(ABORT, 'Retracted laboratory result is immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_lab_results_retracted_no_delete
BEFORE DELETE ON lab_results
FOR EACH ROW
WHEN OLD.result_status = 'retracted'
BEGIN
  SELECT RAISE(ABORT, 'Retracted laboratory result cannot be deleted');
END;
