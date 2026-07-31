-- Add analyzer qualitative result alias mapping to existing machine test mapping.
-- Example JSON: {"POS":"Positive","Detected":"Positive","NEG":"Negative"}

ALTER TABLE lab_machine_test_map ADD COLUMN qualitative_map_json TEXT;
