-- Backfill doctor-specific lab quick-pick usage from existing finalized prescriptions.
-- Future prescriptions are tracked at finalization time by prescription-usage-stats.ts.

INSERT INTO prescription_lab_test_usage_stats (
  tenant_id,
  doctor_id,
  test_name,
  usage_count,
  last_used_at,
  created_at,
  updated_at
)
SELECT
  p.tenant_id,
  p.doctor_id,
  TRIM(CAST(j.value AS TEXT)) AS test_name,
  COUNT(*) AS usage_count,
  MAX(COALESCE(p.updated_at, p.created_at, datetime('now', '+6 hours'))) AS last_used_at,
  datetime('now', '+6 hours') AS created_at,
  datetime('now', '+6 hours') AS updated_at
FROM prescriptions p
JOIN json_each(p.lab_tests) j
WHERE p.doctor_id IS NOT NULL
  AND p.lab_tests IS NOT NULL
  AND json_valid(p.lab_tests)
  AND p.status IN ('final', 'dispensed', 'completed')
  AND TRIM(CAST(j.value AS TEXT)) <> ''
GROUP BY p.tenant_id, p.doctor_id, TRIM(CAST(j.value AS TEXT))
ON CONFLICT(tenant_id, doctor_id, test_name) DO UPDATE SET
  usage_count = CASE
    WHEN prescription_lab_test_usage_stats.usage_count > excluded.usage_count
      THEN prescription_lab_test_usage_stats.usage_count
    ELSE excluded.usage_count
  END,
  last_used_at = CASE
    WHEN COALESCE(prescription_lab_test_usage_stats.last_used_at, '') > COALESCE(excluded.last_used_at, '')
      THEN prescription_lab_test_usage_stats.last_used_at
    ELSE excluded.last_used_at
  END,
  updated_at = datetime('now', '+6 hours');
