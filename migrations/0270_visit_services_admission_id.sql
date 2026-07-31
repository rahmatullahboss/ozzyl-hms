ALTER TABLE visit_services ADD COLUMN admission_id INTEGER REFERENCES admissions(id);

CREATE INDEX idx_visit_services_admission ON visit_services(tenant_id, admission_id);
