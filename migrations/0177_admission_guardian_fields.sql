-- Migration 0177: Add guardian/care-of-person fields to admissions
-- Reference: DanpheEMR AdmissionModel.cs → CareOfPersonName, CareOfPersonPhoneNo, CareOfPersonRelation

ALTER TABLE admissions ADD COLUMN care_of_name TEXT;
ALTER TABLE admissions ADD COLUMN care_of_phone TEXT;
ALTER TABLE admissions ADD COLUMN care_of_relation TEXT;
