-- Migration 0181: Enhanced discharge summary fields
-- Reference: DanpheEMR DischargeSummaryModel.cs

ALTER TABLE discharge_summaries ADD COLUMN chief_complaint TEXT;
ALTER TABLE discharge_summaries ADD COLUMN presenting_illness TEXT;
ALTER TABLE discharge_summaries ADD COLUMN hospital_course TEXT;
ALTER TABLE discharge_summaries ADD COLUMN clinical_findings TEXT;
ALTER TABLE discharge_summaries ADD COLUMN past_history TEXT;
ALTER TABLE discharge_summaries ADD COLUMN pending_reports TEXT;
ALTER TABLE discharge_summaries ADD COLUMN operative_procedure TEXT;
ALTER TABLE discharge_summaries ADD COLUMN operative_findings TEXT;
ALTER TABLE discharge_summaries ADD COLUMN histology_report TEXT;
ALTER TABLE discharge_summaries ADD COLUMN special_notes TEXT;
ALTER TABLE discharge_summaries ADD COLUMN allergies TEXT;
ALTER TABLE discharge_summaries ADD COLUMN activities TEXT;
ALTER TABLE discharge_summaries ADD COLUMN diet TEXT;
ALTER TABLE discharge_summaries ADD COLUMN rest_days INTEGER;
ALTER TABLE discharge_summaries ADD COLUMN lab_results TEXT;
ALTER TABLE discharge_summaries ADD COLUMN imaging_results TEXT;
ALTER TABLE discharge_summaries ADD COLUMN provisional_diagnosis TEXT;
ALTER TABLE discharge_summaries ADD COLUMN discharge_condition TEXT;
ALTER TABLE discharge_summaries ADD COLUMN discharge_type TEXT;
