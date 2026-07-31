-- Consultation Requests (Inter-department)
CREATE TABLE IF NOT EXISTS nur_consultation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  patient_id INTEGER NOT NULL,
  visit_id INTEGER NOT NULL,
  ward_id INTEGER,
  bed_id INTEGER,
  requested_on TEXT DEFAULT (datetime('now', '+6 hours')),
  requesting_doctor_id INTEGER NOT NULL,
  requesting_department_id INTEGER,
  purpose TEXT NOT NULL,
  consulting_doctor_id INTEGER NOT NULL,
  consulting_department_id INTEGER,
  consultant_response TEXT,
  consulted_on TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'responded', 'cancelled')),
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_consultation_req_visit
  ON nur_consultation_requests(tenant_id, visit_id, is_active);

CREATE INDEX IF NOT EXISTS idx_consultation_req_consultant
  ON nur_consultation_requests(tenant_id, consulting_doctor_id, status);
