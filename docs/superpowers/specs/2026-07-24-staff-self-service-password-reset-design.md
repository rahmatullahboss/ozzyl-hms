# Staff Self-Service Password Reset Design

## Problem

Hospital staff invitations already let the invitee create a password, but the admin UI exposes the raw invitation link without clearly warning the administrator not to open it. An administrator can therefore accept the invitation on the invitee's behalf and end up knowing the staff member's password. The staff login page also shows a non-functional “Forgot password” link, leaving an accepted account without a secure self-service recovery path.

## Goals

- The invited staff member, not the administrator, chooses and knows the password.
- Existing staff accounts can request a password-reset email without administrator involvement.
- A successful reset clears both D1 login lock state and the direct-login KV lock counter.
- Password-reset responses do not reveal whether an email exists.
- Reset tokens are one-time, short-lived, hashed at rest, tenant-scoped, and auditable.
- Invitation UI explicitly tells administrators to send the link to the recipient and not open it themselves.

## Non-goals

- Changing patient password recovery.
- Allowing administrators to view or recover passwords.
- Replacing MFA or session-management behavior.
- Automatically mutating the already accepted production account.

## Architecture

### Storage

Add a `staff_password_resets` D1 table containing:

- `id`
- `user_id`
- `tenant_id`
- `token_hash` (unique)
- `expires_at`
- `used_at`
- `created_at`

Indexes support token lookup and per-user invalidation. D1 remains the source of truth; KV is used only for the existing login lock counter.

### Public API

`POST /api/auth/forgot-password`

- Accepts an email address.
- Normalizes the email and finds active staff accounts under active tenants.
- Always returns the same generic success message.
- Invalidates prior unused reset tokens for each matching account.
- Creates a cryptographically random token, stores only its SHA-256 hash, and emails a one-hour reset link.
- Does not log raw tokens or passwords.

`GET /api/auth/reset-password/:token`

- Validates that the hashed token exists, is unused, and has not expired.
- Returns only the minimum display context needed by the reset page.

`POST /api/auth/reset-password/:token`

- Validates a strong password and confirmation in the client.
- Atomically updates the user's password hash, clears `login_attempts` and `locked_until`, and marks the token used.
- Invalidates other unused reset tokens for that user.
- Clears the existing direct-login KV key for the user's normalized email.
- Writes an audit event without sensitive values.

### Web UI

- Replace the dead “Forgot password” anchor with a route to `/forgot-password`.
- Add a request page that always shows a neutral confirmation after submission.
- Add a reset page that validates the token and lets the recipient create and confirm a strong password.
- After success, redirect to login.
- Update invitation result text to say the recipient must open the link and create their own password; the administrator must not open or complete it.

## Error Handling and Security

- Unknown emails receive the same status and message as known emails.
- Expired, used, or invalid tokens return a generic invalid-link response.
- Email delivery failure is recorded server-side but does not expose account existence.
- Password hashes use the existing `hashPassword` helper.
- Reset-token hashes use Web Crypto SHA-256.
- No raw token, password, or full sensitive payload is written to audit logs.
- Existing rate limiting for public auth endpoints should be reused or applied to the request route.

## Testing

- Migration/schema contract tests.
- API tests for unknown email neutrality, token creation, valid reset, expired/used token rejection, D1 lock clearing, and KV lock clearing.
- Email-template test confirming the reset URL is present and escaped.
- UI tests for forgot-password navigation, request submission, token validation, password mismatch, successful reset, and invitation warning copy.

## Operational Note for the Current Account

The account created on July 24, 2026 is not currently locked in D1, and the corresponding KV lock key has already expired. Until this feature is deployed, that user can use the current password and change it after login; after deployment, the user can choose a private password through the self-service reset link.
