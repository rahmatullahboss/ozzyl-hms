ALTER TABLE patient_visit_passes
  ADD COLUMN wallet_payload_encrypted TEXT;

ALTER TABLE health_cards
  ADD COLUMN wallet_payload_encrypted TEXT;
