-- Migration 0178: Admission cancel fields
-- Reference: DanpheEMR AdmissionModel.cs → CancelledOn, CancelledBy, CancelledRemark

ALTER TABLE admissions ADD COLUMN cancelled_on TEXT;
ALTER TABLE admissions ADD COLUMN cancelled_by TEXT;
ALTER TABLE admissions ADD COLUMN cancelled_remark TEXT;
