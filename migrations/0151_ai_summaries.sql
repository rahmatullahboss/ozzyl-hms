-- Migration: 0151_ai_summaries.sql
-- Create table for caching AI-generated patient summaries

CREATE TABLE IF NOT EXISTS ai_patient_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  patient_id INTEGER NOT NULL,
  summary TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  summary_type TEXT DEFAULT 'overview',
  model_used TEXT,
  token_count INTEGER,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_summaries_patient ON ai_patient_summaries(patient_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_ai_summaries_date ON ai_patient_summaries(tenant_id, generated_at);
