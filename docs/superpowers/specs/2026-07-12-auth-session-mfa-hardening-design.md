# Authentication, Session and MFA Hardening Design

**Date:** 2026-07-12
**Readiness gate:** W0-01 — Platform, Tenant, Authentication, Session & MFA Review

## Goal

Make staff authentication fail closed, bind MFA verification to a completed password login, separate bearer access tokens from HttpOnly session tokens, rotate the session token on refresh, and invalidate both tokens on logout.

## Security baseline

- Permission resolution failure must deny login, refresh and MFA completion; it must never fall back to static role permissions.
- A password-authenticated user with MFA enabled receives a short-lived MFA challenge, not an authenticated access token.
- MFA verification consumes a server-side challenge that is scoped to one user and tenant and can succeed only once.
- The browser cookie contains a `session` token; API bearer authentication uses an `access` token. A session token is never accepted as a bearer access token.
- Refresh rotates the session token and revokes the previous session token before returning a new access token.
- Logout clears the cookie and revokes both the presented access token and the cookie session token.
- Disabled users and inactive tenants cannot log in directly, refresh, or complete MFA.
- Tenant identity is checked at every login, refresh and MFA boundary.

## Token model

`JWTPayload` gains optional fields:

```ts
tokenUse?: 'access' | 'session' | 'mfa_challenge';
sessionId?: string;
challengeId?: string;
```

Legacy bearer tokens with no `tokenUse` remain accepted during transition. Legacy cookie tokens with no `tokenUse` may be refreshed once and are replaced with a typed rotating session token. New session and challenge tokens include a cryptographically random UUID.

## Shared issuance service

Create `src/lib/staff-auth-tokens.ts` with these responsibilities:

- resolve effective permissions through `resolveUserPermissions` without fallback;
- issue distinct access and session JWTs for an active staff user;
- issue a five-minute MFA challenge JWT;
- validate token purpose before a token is used;
- set the HttpOnly session cookie only with the session token.

## MFA challenge persistence

Create migration `0417_mfa_login_challenges.sql` and the matching fresh-install table in `tenant-schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS mfa_login_challenges (
  challenge_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

A successful password check creates a challenge row. MFA verification verifies the signed challenge token, loads the active challenge by `challenge_id + tenant_id + user_id`, and atomically consumes it only after a valid TOTP or recovery code. Invalid codes increment `failed_attempts`; five failed attempts invalidate the challenge.

## Login behavior

Tenant login and direct login must:

1. Verify tenant and user are active.
2. Verify the password and lockout policy.
3. If MFA is enabled, create and return `{ mfa_required: true, challenge_token }` without an access or session token.
4. Otherwise resolve permissions fail closed and issue an access/session pair.

Direct login must include `u.is_active` and `u.mfa_enabled` in its lookup, exclude deactivated users from hospital selection, and use the same MFA flow as tenant login.

## MFA verification behavior

`POST /api/mfa/verify` is the only public MFA route. Request body:

```json
{
  "challenge_token": "signed-jwt",
  "code": "123456"
}
```

The route does not accept a caller-supplied `user_id`. It verifies the challenge purpose and tenant, checks active user and active tenant state, verifies the TOTP or recovery code, atomically consumes the challenge, resolves permissions fail closed, issues the token pair, sets the session cookie, and returns the access token.

Setup, disable, status and recovery-code regeneration remain authenticated routes.

## Refresh and logout behavior

Refresh:

- reads only the HttpOnly session cookie;
- checks blacklist and token signature;
- accepts typed `session` tokens and one transitional untyped cookie token;
- rejects `access` and `mfa_challenge` tokens;
- checks current user and tenant state;
- resolves permissions fail closed;
- revokes the old cookie token, then sets a newly generated session token.

Logout:

- captures the session cookie before clearing it;
- revokes the bearer access token and cookie session token independently;
- returns an error if server-side revocation cannot be completed, while still clearing the browser cookie.

## Testing strategy

1. Prove permission-resolution failures deny tenant login, direct login, refresh and MFA completion.
2. Prove access and session tokens are distinct and have different `tokenUse` claims.
3. Prove auth middleware rejects a session token used as a bearer token.
4. Prove refresh rotates and blacklists the old session token.
5. Prove logout revokes both bearer and cookie tokens.
6. Prove direct login rejects deactivated users and inactive tenants.
7. Prove MFA verification requires a signed password-bound challenge, rejects caller-supplied identity, is tenant-scoped, rate-limited, and one-time.
8. Prove challenge attempts lock after five invalid codes.
9. Run focused authentication tests, TypeScript verification, the full repository suite and production build.

## Readiness boundary

This automated sub-gate can pass after the above tests and build succeed. Manual browser-cookie inspection, real authenticator enrollment, recovery-code operational handling, privileged-role MFA policy sign-off and production environment smoke remain required before W0-01 receives a final readiness verdict.
