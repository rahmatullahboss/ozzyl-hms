-- 0423: Remove completed zero-variance cash handovers from the admin approval queue.
-- Backfill structured receiver evidence first so repaired legacy rows retain a complete audit timeline.

INSERT INTO cash_handover_verification_events
  (tenant_id, handover_id, event_type, actor_user_id, actor_role, counted_amount, expected_amount, variance, decision, remarks, workstation_id, created_at)
SELECT
  h.tenant_id,
  h.id,
  'receiver_verified',
  h.received_by,
  NULL,
  COALESCE(h.receiver_counted_amount, h.handover_amount - COALESCE(h.due_amount, 0)),
  h.handover_amount - COALESCE(h.due_amount, 0),
  0,
  'verify',
  COALESCE(h.received_remarks, 'Legacy exact-count handover auto-completed; admin approval not required'),
  NULL,
  COALESCE(h.received_at, h.created_at, datetime('now', '+6 hours'))
FROM billing_handovers h
WHERE h.handover_type = 'counter'
  AND h.status = 'receiver_verified'
  AND h.received_by IS NOT NULL
  AND h.receiver_counted_amount IS NOT NULL
  AND COALESCE(h.admin_verification_status, 'pending_admin') = 'pending_admin'
  AND ROUND(
    CASE
      WHEN h.receiver_counted_amount IS NOT NULL
        THEN h.receiver_counted_amount - (h.handover_amount - COALESCE(h.due_amount, 0))
      ELSE COALESCE(h.receiver_variance, 0)
    END,
    2
  ) = 0
  AND NOT EXISTS (
    SELECT 1
    FROM cash_handover_verification_events e
    WHERE e.tenant_id = h.tenant_id
      AND e.handover_id = h.id
      AND e.event_type IN ('receiver_verified', 'receiver_disputed')
  );

UPDATE billing_handovers
SET status = 'received',
    admin_verification_status = NULL,
    admin_verification_remarks = COALESCE(
      admin_verification_remarks,
      'Auto-completed: receiver count matched expected cash; admin approval not required'
    )
WHERE handover_type = 'counter'
  AND status = 'receiver_verified'
  AND received_by IS NOT NULL
  AND receiver_counted_amount IS NOT NULL
  AND COALESCE(admin_verification_status, 'pending_admin') = 'pending_admin'
  AND ROUND(
    CASE
      WHEN receiver_counted_amount IS NOT NULL
        THEN receiver_counted_amount - (handover_amount - COALESCE(due_amount, 0))
      ELSE COALESCE(receiver_variance, 0)
    END,
    2
  ) = 0;
