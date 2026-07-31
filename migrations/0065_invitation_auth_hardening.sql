CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_token_unique ON invitations(token);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_tenant_unique ON users(tenant_id, email);

-- Canonicalize legacy role aliases before tightening constraints.
UPDATE users SET role = 'reception' WHERE role = 'receptionist';
UPDATE users SET role = 'laboratory' WHERE role IN ('lab', 'lab_tech');
UPDATE invitations SET role = 'reception' WHERE role = 'receptionist';
UPDATE invitations SET role = 'laboratory' WHERE role IN ('lab', 'lab_tech');

-- D1 does not support altering CHECK constraints in-place without table rebuild.
-- Runtime auth now normalizes aliases in code; this migration focuses on data cleanup
-- and uniqueness protection for invitation acceptance.
