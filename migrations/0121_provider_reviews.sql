-- Provider reviews: ratings for both doctors and hospitals
CREATE TABLE provider_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reviewer_global_patient_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_tenant_id TEXT NOT NULL,
  target_doctor_id INTEGER,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  is_verified_visit INTEGER DEFAULT 0,
  is_approved INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_provider_reviews_target ON provider_reviews(target_type, target_tenant_id);
CREATE INDEX idx_provider_reviews_doctor ON provider_reviews(target_doctor_id);
CREATE INDEX idx_provider_reviews_reviewer ON provider_reviews(reviewer_global_patient_id);
