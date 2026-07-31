-- Onboarding requests from landing page Founding Hospital Program form
CREATE TABLE IF NOT EXISTS onboarding_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hospital_name TEXT NOT NULL,
  bed_count TEXT NOT NULL,
  contact_name TEXT,
  whatsapp_number TEXT NOT NULL,
  email TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  reviewed_by INTEGER,
  reviewed_at DATETIME,
  tenant_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_onboarding_status ON onboarding_requests(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_created ON onboarding_requests(created_at DESC);
