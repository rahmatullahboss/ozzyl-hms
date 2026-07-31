-- Migration 0179: Discharge cancel fields on admissions
-- Reference: DanpheEMR DischargeCancelModel.cs

ALTER TABLE admissions ADD COLUMN discharge_cancelled_on TEXT;
ALTER TABLE admissions ADD COLUMN discharge_cancelled_by TEXT;
ALTER TABLE admissions ADD COLUMN discharge_cancel_remark TEXT;
