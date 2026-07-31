# Family Governance Design

## Goal

Extend the managed family graph so one patient profile can be safely managed by multiple trusted adults without weakening identity ownership.

## Research Direction

- Proxy access patterns in Epic MyChart and Patient Access treat claimed adult accounts differently from child dependents.
- OpenEMR related-person structures separate proxy metadata from the patient identity itself.
- For Bangladesh-style usability, the system should stay simple:
  - one obvious primary manager
  - optional additional managers
  - invitation-based delegation for adults with their own login
  - low-friction revocation and transfer

## Product Rules

1. `child` dependents can still be created directly by a caregiver.
2. Claimed adults cannot be silently linked; they must accept a proxy invite from their own account.
3. Each patient profile can have many active managers, but exactly one `primary_manager`.
4. The first active manager becomes `primary_manager`.
5. When the primary manager revokes themselves and other managers remain, the oldest remaining active manager is promoted automatically.
6. Managed-context access is allowed for both `primary_manager` and `manager`.

## API Additions

- `POST /api/global-portal/family/proxy-invites`
- `GET /api/global-portal/family/proxy-invites`
- `POST /api/global-portal/family/proxy-invites/:id/respond`
- `POST /api/global-portal/family/links/:id/make-primary`

## Data Additions

New table: `global_family_proxy_invites`

- `patient_identity_id`
- `inviter_auth_user_id`
- `invitee_auth_user_id`
- `relationship`
- `access_role`
- `status`
- `notes`
- `expires_at`
- `accepted_at`
- `declined_at`
- `revoked_at`

## UI Additions

- Family page shows current role and primary manager badge.
- Claimed adults can accept/decline incoming family manager invites.
- Managers can view outgoing invites.
- Primary managers can transfer the primary role to another active manager.

## Safety Boundaries

- No unverified adult pre-binding.
- No duplicate pending invite for the same patient and invitee pair.
- Only the invitee can accept/decline an invite.
- Only the current primary manager can transfer primary status.
