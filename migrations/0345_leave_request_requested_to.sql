-- Migration: 0345_leave_request_requested_to.sql
-- DanpheEMR parity: track the specific approver a leave request was submitted to
-- (Danphe model has `RequestedTo: number`). Our existing `approved_by` records who
-- ultimately approved, not who was asked. Adding `requested_to` closes the gap so
-- the workflow can be directed to a specific manager instead of any approver.

ALTER TABLE hr_leave_requests ADD COLUMN requested_to INTEGER REFERENCES staff(id);
