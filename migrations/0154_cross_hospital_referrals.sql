-- Cross-Hospital Referrals System
-- Enables hospitals to send/receive patient referrals with documents

CREATE TABLE IF NOT EXISTS cross_hospital_referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_tenant_id TEXT NOT NULL,
  to_tenant_id TEXT NOT NULL,
  patient_global_id TEXT NOT NULL,
  from_local_patient_id INTEGER,
  to_local_patient_id INTEGER,
  referring_doctor_id INTEGER,
  receiving_doctor_id INTEGER,
  urgency TEXT NOT NULL DEFAULT 'routine',
  reason TEXT,
  clinical_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decline_reason TEXT,
  accepted_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_referrals_from_tenant ON cross_hospital_referrals(from_tenant_id);
CREATE INDEX idx_referrals_to_tenant ON cross_hospital_referrals(to_tenant_id);
CREATE INDEX idx_referrals_patient ON cross_hospital_referrals(patient_global_id);
CREATE INDEX idx_referrals_status ON cross_hospital_referrals(status);

CREATE TABLE IF NOT EXISTS referral_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referral_id INTEGER NOT NULL,
  document_type TEXT NOT NULL,
  title TEXT,
  storage_key TEXT,
  document_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (referral_id) REFERENCES cross_hospital_referrals(id) ON DELETE CASCADE
);

CREATE INDEX idx_referral_docs_referral ON referral_documents(referral_id);
