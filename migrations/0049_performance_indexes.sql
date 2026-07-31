-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 0049: Performance Indexes for Nursing + E-Prescribing
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Nursing tables (high-volume queries by patient/tenant) ─────────────────

CREATE INDEX IF NOT EXISTS idx_nursing_care_plans_patient
  ON nursing_care_plans(tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_nursing_care_plans_status
  ON nursing_care_plans(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_nursing_notes_patient
  ON nursing_notes(tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_nursing_notes_type
  ON nursing_notes(tenant_id, note_type);

CREATE INDEX IF NOT EXISTS idx_nursing_mar_patient
  ON nursing_mar(tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_nursing_mar_status
  ON nursing_mar(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_nursing_io_patient
  ON nursing_io_charts(tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_nursing_io_type
  ON nursing_io_charts(tenant_id, io_type);

CREATE INDEX IF NOT EXISTS idx_nursing_monitoring_patient
  ON nursing_monitoring(tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_nursing_iv_drugs_patient
  ON nursing_iv_drugs(tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_nursing_iv_drugs_status
  ON nursing_iv_drugs(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_nursing_wound_care_patient
  ON nursing_wound_care(tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_nursing_handover_shift
  ON nursing_handover(tenant_id, shift);

-- ─── E-Prescribing tables ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_formulary_items_tenant
  ON formulary_items(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_formulary_items_category
  ON formulary_items(category_id, is_active);

CREATE INDEX IF NOT EXISTS idx_formulary_items_generic
  ON formulary_items(tenant_id, generic_name);

CREATE INDEX IF NOT EXISTS idx_drug_interactions_tenant
  ON drug_interaction_pairs(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_drug_interactions_drugs
  ON drug_interaction_pairs(tenant_id, drug_a_name, drug_b_name);

CREATE INDEX IF NOT EXISTS idx_patient_medications_active
  ON patient_medications(tenant_id, patient_id, status);

CREATE INDEX IF NOT EXISTS idx_safety_checks_patient
  ON prescription_safety_checks(tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS idx_safety_checks_prescription
  ON prescription_safety_checks(tenant_id, prescription_id);

-- ─── OPD visits (nursing triage queries) ──────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_visits_status_date
  ON visits(tenant_id, status, visit_date);
