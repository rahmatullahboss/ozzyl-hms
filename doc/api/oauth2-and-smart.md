# OpenEMR OAuth2 + SMART on FHIR

OpenEMR is both a SMART on FHIR v2.2 authorization server *and* a
resource server. The same OAuth2 issuer serves the standard `/api/`
clients, the patient-portal `/portal/` clients, and the SMART `/fhir/`
apps. This document is the deep-dive on the grants, scopes, and
claims.

- Source root: `openemr-reference/src/RestControllers/AuthorizationController.php`
- Source root: `openemr-reference/src/Common/Auth/OpenIDConnect/`
- Source root: `openemr-reference/src/Services/JWTClientAuthenticationService.php`
- Standard: RFC 6749 (OAuth2), RFC 7523 (JWT client auth), RFC 7636 (PKCE),
  SMART v2.2, ONC §170.315(g)(10).

## Table of contents

- [Roles and surfaces](#roles-and-surfaces)
- [Capability flags](#capability-flags)
- [Launch contexts and intents](#launch-contexts-and-intents)
- [Endpoints](#endpoints)
- [Dynamic client registration](#dynamic-client-registration)
- [Token endpoint grants](#token-endpoint-grants)
- [PKCE flow](#pkce-flow)
- [Backend Services (Client Credentials + JWT assertion)](#backend-services-client-credentials--jwt-assertion)
- [Scope syntax v1 vs v2](#scope-syntax-v1-vs-v2)
- [Permission flags and context types](#permission-flags-and-context-types)
- [Replay prevention via JWT `jti`](#replay-prevention-via-jwt-jti)
- [The `fhirUser` claim](#the-fhiruser-claim)
- [SMART launch controllers](#smart-launch-controllers)
- [Token introspection and revocation](#token-introspection-and-revocation)
- [Trusted-user revocation](#trusted-user-revocation)

## Roles and surfaces

`src/Common/Auth/UuidUserAccount` resolves an OpenEMR UUID into a role
of one of:

- `users` — staff / provider (any role in the legacy `users` table).
- `patient` — patient portal account (linked to `patient_data` via
  `patient_access_onsite`).
- `system` — synthetic service user (the `system` user record used by
  Backend Services / client_credentials grant).

The role is stashed on the bearer token, then on the request object
(`HttpRestRequest::setRequestUserRole`) so authorization decisions can
short-circuit on the surface:

| Role | Allowed surfaces | Notes |
|------|------------------|-------|
| `users` | `/api/...`, `/fhir/...` | Patient compartment bind optional (default `user/...` scope) |
| `patient` | `/portal/...`, `/fhir/...` | Patient compartment bind REQUIRED for patient-context writes; FHIR patient writes are rejected for this role (see `AuthorizationListener::onRestApiSecurityCheck`) |
| `system` | `/fhir/...` only | Implies `system/...` scopes only |

## Capability flags

`src/FHIR/SMART/Capability.php` enumerates the SMART v2 capabilities
OpenEMR advertises in the `/.well-known/smart-configuration` response:

| Constant | String | Meaning |
|----------|--------|---------|
| `LAUNCH_EHR` | `launch-ehr` | EHR-launched apps are supported |
| `LAUNCH_STANDALONE` | `launch-standalone` | Standalone-launched apps are supported |
| `CLIENT_PUBLIC` | `client-public` | Public clients (no secret) are supported |
| `CLIENT_CONFIDENTIAL_SYMMETRIC` | `client-confidential-symmetric` | Confidential clients using `client_secret_post`/`basic` |
| `CLIENT_CONFIDENTIAL_ASYMETRIC` | `client-confidential-asymmetric` | Confidential clients using JWT assertion (RFC 7523) |
| `SSO_OPENID_CONNECTION` | `sso-openid-connect` | OpenID Connect id_token issuance |
| `CONTEXT_BANNER` | `context-banner` | `need_patient_banner` launch context |
| `CONTEXT_STYLE` | `context-style` | `smart_style_url` launch context (branded login screens) |
| `CONTEXT_EHR_PATIENT` | `context-ehr-patient` | `launch/patient` scope (EHR-launched, patient is known) |
| `CONTEXT_EHR_ENCOUNTER` | `context-ehr-encounter` | `launch/encounter` scope (encounter known) |
| `CONTEXT_STANDALONE_PATIENT` | `context-standalone-patient` | `launch/patient` scope (standalone, patient picker) |
| `PERMISSION_USER` | `permission-user` | `user/...` scopes |
| `PERMISSION_PATIENT` | `permission-patient` | `patient/...` scopes |
| `PERMISSION_OFFLINE` | `permission-offline` | `offline_access` scope for refresh tokens |
| `PERMISSION_V1` | `permission-v1` | v1 scope syntax (legacy) |
| `PERMISSION_V2` | `permission-v2` | v2 scope syntax |
| `PERMISSION_AUTHORIZE_POST` | `permission-authorize-post` | `authorization_post` response mode (v2) |

`Capability::SUPPORTED_CAPABILITIES` is the public list published in
the SMART configuration.

## Launch contexts and intents

`SMARTLaunchToken` (`src/FHIR/SMART/SMARTLaunchToken.php`) is the
opaque, encrypted-on-the-wire blob the EHR hands to a SMART app at
launch. It carries:

- `patient` UUID
- `encounter` UUID
- `appointmentUuid`
- `intent` (one of the four constants below)

Valid intents (also in `SMARTLaunchToken::VALID_INTENTS`):

| Intent | Where it shows up | Notes |
|--------|-------------------|-------|
| `INTENT_PATIENT_DEMOGRAPHICS_DIALOG` (`patient.demographics.dialog`) | Patient demographics card | Default EHR launch |
| `INTENT_APPOINTMENT_DIALOG` (`appointment.edit.dialog`) | Appointment add/edit dialog | Used by 2nd-step custom apps |
| `INTENT_ENCOUNTER_DIALOG` (`encounter.forms.dialog`) | Encounter forms | |
| `INTENT_MAIN_TAB` (`main.tab`) | Main tab menu | |

The token is serialized as a short URL-encoded JSON blob (not JWT)
because the receiving app hands it back as a `launch=` query param
during the OAuth2 authorize call.

## Endpoints

All endpoints are site-scoped at `/oauth2/<site>/...`:

| Method + path | Purpose | File |
|---------------|---------|------|
| `GET /oauth2/<site>/.well-known/openid-configuration` | OIDC discovery | `AuthorizationController` |
| `GET /oauth2/<site>/.well-known/jwks.json` | Public JWK set | `OAuth2PublicJsonWebKeyController` |
| `GET /oauth2/<site>/authorize` | Authorize endpoint (interactive) | `AuthorizationController` |
| `POST /oauth2/<site>/token` | Token endpoint | `AuthorizationController` |
| `POST /oauth2/<site>/introspect` | RFC 7662 introspection | `TokenIntrospectionRestController` |
| `POST /oauth2/<site>/revoke` | RFC 7009 revocation | (revoke grant) |
| `POST /oauth2/<site>/registration` | Dynamic client registration | `AuthorizationController` (SMART v2) |
| `GET /oauth2/<site>/smart/patient-select` | Patient picker for standalone launch | `SMARTAuthorizationController` |
| `GET /oauth2/<site>/smart/patient-select-confirm` | Patient picker submit | `SMARTAuthorizationController` |
| `GET /oauth2/<site>/smart/ehr-launch-autosubmit` | Auto-submit launch form | `SMARTAuthorizationController` |
| `GET /oauth2/<site>/smart/smart-style` | Branded login CSS/JSON | `SMARTAuthorizationController` |

The `ServerConfig` (in `src/FHIR/Config/ServerConfig.php`) is the
single source of truth for these URLs. Helper methods include
`getFhirUrl()`, `getAuthorizeUrl()`, `getTokenUrl()`, `getJsonWebKeySetUrl()`.

## Dynamic client registration

SMART v2 dynamic registration is implemented as
`POST /oauth2/<site>/registration`. The body is a SMART client
registration payload:

```json
{
  "client_name": "My App",
  "redirect_uris": ["https://app.example.com/cb"],
  "token_endpoint_auth_method": "client_secret_basic",
  "grant_types": ["authorization_code"],
  "scope": "launch/patient patient/Patient.read online_access openid fhirUser"
}
```

The handler in `AuthorizationController` validates the payload, creates
a row in the `oauth_clients` table, and returns the issued
`client_id` (and `client_secret` if confidential). The SMART
system-scopes admin UI in the core admin section also writes through
this path.

## Token endpoint grants

Four OAuth2 grants are wired in `AuthorizationController::oneTimeLogin`
/`AuthorizationController::authorize` paths. The grant-specific logic
lives under `src/Common/Auth/OpenIDConnect/Grant/`:

| Grant | Class | Use case |
|-------|-------|----------|
| `authorization_code` | `CustomAuthCodeGrant` | Interactive SMART launches (EHR or standalone) |
| `client_credentials` | `CustomClientCredentialsGrant` | SMART Backend Services — system-to-system bulk export |
| `password` | `CustomPasswordGrant` | Legacy username/password (deprecated) |
| `refresh_token` | `CustomRefreshTokenGrant` | Rotating refresh tokens |

Authorization server key/TTL configuration (in
`AuthorizationController`):

```php
const GRANT_TYPE_ACCESS_CODE_TTL = "PT300S";   // 5 minutes, Bulk Data spec
const GRANT_TYPE_ACCESS_TOKEN_TTL = 'PT1H';    // 1 hour access token
const GRANT_TYPE_REFRESH_TOKEN_TTL = 'P3M';    // 3 months refresh token
```

`offline_access` scope is required to receive a refresh token
(handled in `IdTokenSMARTResponse::generateHttpResponse`).

## PKCE flow

`CustomAuthCodeGrant` whitelists the S256 code-challenge method only
(`$this->openEMRCodeChallengeVerifiers = ['S256' => true];`). The
plain (`plain`) method is rejected. Code challenge is required for
public clients per the SMART v2 spec.

For confidential clients, PKCE is also supported but optional.

`code_challenge_methods_supported` in the `/.well-known/smart-configuration`
response advertises `S256` only.

## Backend Services (Client Credentials + JWT assertion)

`CustomClientCredentialsGrant` extends the League
`ClientCredentialsGrant` and adds:

1. JWT client authentication — clients send
   `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`
   and a signed JWT. `JWTClientAuthenticationService` (`src/Services/JWTClientAuthenticationService.php`)
   validates:
   - `iss` = client_id
   - `sub` = client_id
   - `aud` = token endpoint URL
   - `jti` (replay protection — see below)
   - `exp` ≤ 24h in the future
2. The `sub` of the issued access token is set to the system user UUID
   (`UserService::SYSTEM_USER_USERNAME`) so resource-server ACL checks
   can short-circuit to the system role.
3. A `TrustedUser` row is written so the access token can be revoked
   by logging out the system user.

The grant is what implements ONC's
`(g)(10) Standardized API — Bulk Data Access`. Without it, a
client_credentials request would never see a `system/...` scope.

## Scope syntax v1 vs v2

`ScopeEntity::createFromString` (`src/Common/Auth/OpenIDConnect/Entities/ScopeEntity.php:56`)
parses both:

| Version | Example | Format |
|---------|---------|--------|
| v1 | `patient/Patient.read` | `patient/<Resource>.<v1Read\|v1Write>` (`.read`/`.write` are the only flags) |
| v2 | `patient/Patient.rs` | `patient/<Resource>.<c\|r\|u\|d\|s>` (CRUDS) |
| v2 constrained | `patient/Observation.rs?category=vital-signs` | Adds `?<key>=<value>` to restrict to a code |
| v2 system | `system/Patient.*` | `system/...` means the resource is not bound to a patient |
| v2 user | `user/Patient.read` | Staff-role resource access |
| v2 ops | `patient/Patient.$export` | Operation-scoped access (FHIR `$export`, `$docref`, etc.) |

`SCOPE_OFFLINE_ACCESS` (`offline_access`) is handled separately by
`IdTokenSMARTResponse` to gate refresh-token issuance.

`SCOPE_SMART_LAUNCH` (`launch`), `SCOPE_SMART_LAUNCH_PATIENT`
(`launch/patient`), and `launch/encounter` are the launch-context
scopes.

## Permission flags and context types

Inside `ScopeEntity`, the `ScopePermissionObject` holds booleans for
each v2 permission flag:

| Flag | String | Meaning |
|------|--------|---------|
| `c` | `create` | Create a new resource |
| `r` | `read` | Read an instance |
| `u` | `update` | Update an instance |
| `d` | `delete` | Delete an instance |
| `s` | `search` | Run a search across instances |
| `v1Read` | (legacy) | v1-style `.read` shorthand |
| `v1Write` | (legacy) | v1-style `.write` shorthand |
| `constraints` | (assoc. array) | Code/value constraints (`?category=...`) |

`ScopeEntity::addScopePermissions()` merges two scopes when they share
`getScopeLookupKey()` (`<context>/<resource>`).

`ScopeEntity::getContext()` is one of `patient`, `user`, `system`. The
request-level `buildResourceScopeContexts()` in `HttpRestRequest` picks
the highest-priority context per resource (system > user > patient) so
that one access token can carry a mix.

## Replay prevention via JWT `jti`

`JWTClientAuthenticationService` enforces single-use JWT assertions
through the `UniqueID` constraint. Every `client_assertion` JWT must
carry a `jti` claim; on first use the `jti` is recorded in the
`oauth_jwt_tracking` table. Subsequent token requests with the same
`jti` are rejected.

The `JWTRepository` (`src/Common/Auth/OpenIDConnect/Repositories/JWTRepository.php`)
owns the table reads/writes.

## The `fhirUser` claim

`FhirUserClaim` (`src/Common/Auth/OpenIDConnect/FhirUserClaim.php`)
constructs the SMART `fhirUser` claim on id_tokens. The logic:

- If the user's role is `users`:
  - If `PractitionerService::isValidPractitionerUuid($userUUID)` → emit
    `fhirUser = <base>/Practitioner/<uuid>`.
  - Otherwise → emit `fhirUser = <base>/Person/<uuid>`.
- If the user's role is `patient` → emit
  `fhirUser = <base>/Patient/<uuid>`.
- If the user's role is `system` → no `fhirUser` claim.

The base URL is the FHIR server base (`ServerConfig::getFhirUrl()`).

## SMART launch controllers

`src/RestControllers/SMART/`:

- `SMARTConfigurationController` — `/.well-known/smart-configuration`
  discovery document.
- `SMARTAuthorizationController` — `authorize`, `token`, `introspect`,
  `revoke`, plus the `/smart/...` UI endpoints (patient picker,
  EHR launch auto-submit, smart-style).
- `PatientContextSearchController` — search results for the standalone
  patient picker. Caps the result count at
  `PATIENT_SEARCH_MAX_RESULTS = 100` and filters by
  `AclMain::aclCheckCore('patients', 'demo', $user['username'])`.
- `ScopePermissionParser` — converts an array of scope strings into the
  structured `parseScopes()` form the consent screen uses. Includes
  `RESTRICTION_LABELS` and `ONC_REQUIRED_RESTRICTIONS` so the
  Condition/Observation sub-categories show up explicitly.
- `ActionUrlBuilder` — small helper for building the per-app launch
  URLs.

## Token introspection and revocation

- `TokenIntrospectionRestController` — RFC 7662 introspection at
  `POST /oauth2/<site>/introspect`. Used by resource servers
  (or by OpenEMR itself when acting as a resource server for
  /api/ calls) to learn the active state, scopes, expiration, and
  user/client of a bearer token.
- `CustomRefreshTokenGrant` — rotates refresh tokens. Old refresh
  tokens are marked `revoked` in the `oauth_refresh_tokens` table;
  reuse of a revoked refresh token revokes the entire chain.

## Trusted-user revocation

`TrustedUserService` (`src/Services/TrustedUserService.php`) is the
keystone of the revocation model. Every successful bearer-token
authorization (auth_code, client_credentials, refresh) creates a
`trusted_user` row keyed by `(clientId, userUUID, refreshTokenId)`.
When the user logs out (or the system user is reset), the
`trusted_user` rows are deleted; subsequent calls fail at
`BearerTokenAuthorizationStrategy::authorizeRequest` step 4 with
`'Refresh Token revoked or logged out'`.

`BearerTokenAuthorizationStrategy` (see `doc/api/rest-api.md` for the
full flow) is the resource-server side of the same dance: it calls
`TrustedUserService::isTrustedUser($clientId, $userId)` on every
incoming API request.

## See also

- `doc/api/rest-api.md` — Standard `/api/` and `/portal/` controllers
- `doc/api/fhir-api.md` — FHIR R4 + US Core 8.0 surface
- `doc/interop/smart-on-fhir.md` — Launch flow UI in detail
- `doc/api/bulk-export.md` — How `$export` uses these scopes
- `doc/interop/portal-vs-api.md` — How portal vs API auth differs
