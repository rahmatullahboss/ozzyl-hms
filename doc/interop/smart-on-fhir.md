# OpenEMR SMART on FHIR Launch Flow

SMART on FHIR is the standard for third-party clinical apps to
integrate with an EHR. OpenEMR implements the SMART v2.2 launch flow
in two flavors:

- **EHR launch** — the user starts the app from a button or menu
  inside OpenEMR. The app receives an opaque launch token, decodes
  the patient/encounter context, and continues to the OAuth2 dance.
- **Standalone launch** — the user starts the app from outside
  OpenEMR. OpenEMR shows a patient picker (or uses the launched-in
  context if the app provided a `patient=` id) and proceeds.

This document walks the launch flow, the controllers that power the
SMART-specific UI, and the data structures that carry context between
the EHR and the app.

- Source root: `openemr-reference/src/FHIR/SMART/`
- Source root: `openemr-reference/src/RestControllers/SMART/`
- Source root: `openemr-reference/src/Common/Auth/OpenIDConnect/`
- Spec: SMART App Launch v2.2.

## Table of contents

- [Capability flags](#capability-flags)
- [EHR launch — flow](#ehr-launch--flow)
- [Standalone launch — flow](#standalone-launch--flow)
- [Patient context (`launch/patient`)](#patient-context-launchpatient)
- [Encounter context (`launch/encounter`)](#patient-context-launchencounter)
- [The `SMARTLaunchToken` opaque blob](#the-smartlaunchtoken-opaque-blob)
- [The patient-select screen](#the-patient-select-screen)
- [Auto-submit launch form](#auto-submit-launch-form)
- [Client registration + admin UI](#client-registration--admin-ui)
- [Style URL for branded launch screens](#style-url-for-branded-launch-screens)
- [Scope consent screen](#scope-consent-screen)
- [Session token context builder](#session-token-context-builder)

## Capability flags

`src/FHIR/SMART/Capability.php` enumerates the SMART v2
capabilities OpenEMR publishes. The relevant launch-flow flags are:

| Constant | Capability string | Used for |
|----------|-------------------|----------|
| `LAUNCH_EHR` | `launch-ehr` | The "EHR launch mode" — required for the in-EHR button |
| `LAUNCH_STANDALONE` | `launch-standalone` | The "Standalone launch mode" — required for external app launches |
| `CONTEXT_EHR_PATIENT` | `context-ehr-patient` | `launch/patient` scope (EHR-launched, patient known) |
| `CONTEXT_EHR_ENCOUNTER` | `context-ehr-encounter` | `launch/encounter` scope (encounter known) |
| `CONTEXT_STANDALONE_PATIENT` | `context-standalone-patient` | `launch/patient` scope (standalone, patient picker shown) |
| `CONTEXT_BANNER` | `context-banner` | `need_patient_banner` token parameter (in-app banner) |
| `CONTEXT_STYLE` | `context-style` | `smart_style_url` token parameter (branded login) |
| `SSO_OPENID_CONNECTION` | `sso-openid-connect` | id_token issued (OpenID Connect) |
| `PERMISSION_AUTHORIZE_POST` | `permission-authorize-post` | `authorization_post` response mode (form post) |
| `PERMISSION_V2` | `permission-v2` | v2 scope syntax |

The capability array is the value of `capabilities` in the
`/.well-known/smart-configuration` response and is also embedded in
the FHIR `CapabilityStatement` at `/fhir/metadata`.

## EHR launch — flow

EHR launch is the most common flow. It happens entirely in the
browser:

1. **User clicks the app button.** A button rendered by
   `SmartLaunchController::renderLaunchButton()` in the patient
   demographics card (or the encounter card, or the appointment card,
   depending on the app's registered launch context). The button
   posts to the SMART-authorize endpoint with the launch token as
   a query param.

2. **Token is built.** `SmartLaunchController::getLaunchCodeContext($puuid)`
   builds a `SMARTLaunchToken` for the current patient, encounter,
   or appointment, and serializes it to a URL-safe string.

3. **Issuer / audience.** The app's registered `redirect_uri` is
   invoked with `launch=<token>&iss=<issuer>&aud=<issuer>`. The
   issuer is `ServerConfig::getFhirUrl()`.

4. **App receives the launch.** The app stores the opaque launch
   token and starts the OAuth2 authorization-code flow by redirecting
   the user-agent to OpenEMR's `/oauth2/<site>/authorize` with
   `response_type=code`, `client_id=<app>`, `redirect_uri=<app cb>`,
   `scope=launch/patient patient/Patient.read openid fhirUser`,
   `state=<app state>`, `code_challenge=<S256 challenge>`,
   `code_challenge_method=S256`, and `launch=<the token>`.

5. **OpenEMR's authorize endpoint** (`AuthorizationController`)
   - Validates the `launch` token (decrypts and looks up the context).
   - If the token's intent is `INTENT_PATIENT_DEMOGRAPHICS_DIALOG`,
     `INTENT_APPOINTMENT_DIALOG`, etc., the controller stores the
     context for the duration of the consent flow.
   - Renders the SMART consent screen (Twig) listing the requested
     scopes.

6. **User consents** (or denies). On consent, the controller
   creates an `oauth_auth_code` row, associates the launch context
   (patient UUID, encounter UUID) with the auth code, and redirects
   the user-agent back to the app's `redirect_uri` with `?code=<auth_code>`.

7. **App exchanges code for token** by calling
   `POST /oauth2/<site>/token` with `grant_type=authorization_code`,
   `code=<code>`, `redirect_uri=<app cb>`, and the PKCE
   `code_verifier`. The token response includes:
   - `access_token`
   - `token_type=Bearer`
   - `expires_in`
   - `refresh_token` (only if `offline_access` was granted)
   - `id_token` (signed JWT)
   - `patient=<uuid>` (in the response, not as a separate field) per
     SMART v2 spec
   - `encounter=<uuid>` (when the launch context included an encounter)
   - `need_patient_banner=<bool>` (when the app requested a banner)
   - `smart_style_url=<url>` (when the app requested branding)
   - `fhirUser=<reference>` (the SMART `fhirUser` claim)

8. **App uses the access token** to call the FHIR API (with scopes
   it was granted).

9. **Refresh.** If the app held an `offline_access` scope, the
   refresh token is rotated by `CustomRefreshTokenGrant`. The app
   can keep the session alive without re-prompting the user.

## Standalone launch — flow

Standalone launch skips step 1. The user starts the app outside
OpenEMR, and the app's first move is to redirect to
`/oauth2/<site>/authorize` with `scope=launch/patient ...`. The
rest of the flow is the same, except:

- If the app already knows which patient (e.g. a kiosk-mode
  registration app), it sends `patient=<uuid>` as an authorize
  query param. OpenEMR validates that the user is allowed to access
  that patient and either uses the patient directly or shows a
  picker.
- If the app does not know the patient, OpenEMR renders the
  **patient-select screen**.

The launch token is *not* included in the standalone flow; instead
the patient context is established at token-issuance time based on
the `patient` parameter and the consented scopes.

## Patient context (`launch/patient`)

`launch/patient` is the SMART v2 scope that asks the EHR to
populate the access token's `patient` field with the patient
context. The source of that context depends on the launch flow:

- **EHR launch from a patient card** — the patient is the
  patient the user is currently viewing. The patient UUID is
  embedded in the `SMARTLaunchToken` and is copied into the access
  token's `context` field at code-issuance time.
- **EHR launch from an encounter card** — the patient is the
  encounter's patient, *and* the encounter UUID is also embedded in
  the token (the `encounter` field).
- **Standalone launch with `patient=<uuid>`** — the patient is
  whatever the app provided.
- **Standalone launch without `patient`** — OpenEMR renders the
  patient-select screen and the user picks.

`SMARTLaunchToken::serialize()` produces the URL-encoded payload
that's sent on the wire:

```json
{
  "p": "<patient-uuid>",
  "e": "<encounter-uuid>",
  "a": "<appointment-uuid>",
  "i": "patient.demographics.dialog"
}
```

`p`/`e`/`a`/`i` are the short keys for patient / encounter /
appointment / intent. The `intent` is what the receiving app uses
to decide which UI to render.

## Encounter context (`launch/encounter`)

`launch/encounter` is the scope that requests the access token
carry both `patient` and `encounter` (the access token's response
body has `patient` *and* `encounter` keys, both populated).

OpenEMR's `EncounterService` and the encounter card in the patient
demographics page both call `SmartLaunchController::getLaunchCodeContext`
with a non-null encounter UUID. The intent is set to
`INTENT_ENCOUNTER_DIALOG` (`encounter.forms.dialog`).

When the app receives the access token, it can issue a FHIR search
like `/fhir/Encounter?_id=<encounter-uuid>` (with the
`patient/Encounter.read` scope) to get the full encounter record.

## The `SMARTLaunchToken` opaque blob

`src/FHIR/SMART/SMARTLaunchToken.php` is a tiny DTO. Fields:

| Field | Type | Meaning |
|-------|------|---------|
| `patient` | UUID string | Patient in context |
| `encounter` | UUID string | Encounter in context (optional) |
| `appointmentUuid` | UUID string | Appointment in context (optional) |
| `intent` | string | One of `INTENT_PATIENT_DEMOGRAPHICS_DIALOG`, `INTENT_APPOINTMENT_DIALOG`, `INTENT_ENCOUNTER_DIALOG`, `INTENT_MAIN_TAB` |

Serialization is `serialize()` (a compact JSON object with the
short keys above), `unserialize($blob)` (parses and validates), and
`getLaunchCodeContext($puuid)` (a static factory on
`SmartLaunchController` that builds the token from a puuid, plus
the current `pid` and `encounter` from session/request).

The blob is not encrypted; the receiver hands it back as the
`launch` query param on the authorize endpoint, where
`CustomAuthCodeGrant::validateAuthorizationRequest()` decodes it
and pulls the patient/encounter context into the auth code's
metadata. The auth code's metadata is what gets bound to the access
token at code-exchange time.

## The patient-select screen

For standalone launches (and EHR launches where the app is launched
from a non-patient-specific context like the main menu), OpenEMR
shows a patient picker. The flow:

1. Authorize endpoint receives a request with `scope=launch/patient`
   and no patient context.
2. `SMARTAuthorizationController` detects the missing patient
   context and redirects to `/smart/patient-select?app=<client_id>&...`
   (the `PATIENT_SELECT_PATH` constant).
3. The patient-select screen is a Twig template that renders a
   search box and result list. The search is performed by
   `PatientContextSearchController::searchPatients($searchParams, $userUUID)`:
   - Caps results at `PATIENT_SEARCH_MAX_RESULTS = 100`.
   - Filters by `AclMain::aclCheckCore('patients', 'demo', $user['username'])`
     — only users with the `patients` / `demo` ACL see the picker
     populated. Without it, the picker is empty.
   - Returns a small record (uuid, name, DOB, sex) for each match.
4. The user picks a patient; the form posts to
   `/smart/patient-select-confirm` (`PATIENT_SELECT_CONFIRM_ENDPOINT`).
5. The confirm endpoint validates the selection, writes the chosen
   patient UUID into the SMART launch context, and redirects back
   to the authorize endpoint to continue the flow.

## Auto-submit launch form

The EHR launch button uses an auto-submitting form so the user
experience is "click → see app". `SmartLaunchController::renderLaunchScript()`
emits a tiny JS shim that:

1. Builds the launch URL (`?launch=<token>&iss=<issuer>&aud=<issuer>`).
2. Submits a hidden POST form to the app's registered launch URL
   (the "Action URL" configured when the SMART client was
   registered).
3. Optionally sets a `window.name` value so the receiving app can
   pull the launch context if the app uses
   `ActionUrlBuilder::postLaunch()` (an iframe-friendly version).

`ActionUrlBuilder` (`src/FHIR/SMART/ActionUrlBuilder.php`) is a
helper for assembling the form action URL and form fields.

## Client registration + admin UI

SMART clients are stored in the `oauth_clients` table. The admin
UI under Admin → System → API Clients lets a privileged admin:

- Create a new client (choose confidential or public).
- Choose the allowed `grant_types` (`authorization_code`,
  `client_credentials`).
- Choose the allowed `scope` set.
- Set the `redirect_uri`s.
- Set the launch context (which patient card renders the app
  button).
- Upload a public key (for `client_confidential_asymmetric`
  clients).
- Set the SMART `client_name` and a custom `smart_style_url`.

`ClientAdminController` (`src/FHIR/SMART/ClientAdminController.php`)
backs the admin UI. The `ClientRepository`
(`src/Common/Auth/OpenIDConnect/Repositories/ClientRepository.php`)
is the data-access layer.

Dynamic registration via `POST /oauth2/<site>/registration` is also
supported (SMART v2).

## Style URL for branded launch screens

`context-style` is a SMART v2 experimental capability. When a SMART
app requests it (via the `need_patient_banner` / `smart_style_url`
parameters or the `launch` payload), the access-token response
includes a `smart_style_url` field pointing at
`/oauth2/<site>/smart/smart-style?client=<id>`.

That endpoint, served by `SMARTAuthorizationController`, returns a
JSON document that the app can consume to apply the EHR's branding
(colors, logos, font) to its UI:

```json
{
  "color_background": "#ffffff",
  "color_text": "#212529",
  "color_error": "#dc3545",
  "logo_url": "https://hms.example/.../logo.png"
}
```

The values are derived from OpenEMR's `LogoService` and the
`OEGlobalsBag` configuration.

## Scope consent screen

`ScopePermissionParser` (`src/RestControllers/SMART/ScopePermissionParser.php`)
parses the requested scope set into a structured form for the
consent screen. The screen is rendered by the `AuthorizationController`
using a Twig template, and shows:

- The app's name and logo.
- Each requested resource (e.g. `Patient`, `Observation`) with its
  CRUDS flags.
- For `Condition` and `Observation`, the ONC-required sub-resource
  categories (`encounter-diagnosis`, `problem-list-item`,
  `health-concern`, `vital-signs`, etc.) so the user can see what
  kinds of data are being requested. The list comes from
  `RESTRICTION_LABELS` in `ScopePermissionParser`.
- The launch context (the patient and encounter names).
- An "Allow" / "Deny" pair of buttons.

## Session token context builder

`SMARTSessionTokenContextBuilder`
(`src/Common/Auth/OpenIDConnect/SMARTSessionTokenContextBuilder.php`)
is the helper that builds the `context` JSON that's persisted on
the access token (and replayed on refresh). It includes:

- `patient` UUID (when a patient context is in play).
- `encounter` UUID (when an encounter context is in play).
- `intent` (one of the four SMART launch intents).
- `need_patient_banner` (bool).
- `smart_style_url` (string, when style was requested).

The context is consumed by
`BearerTokenAuthorizationStrategy::populateTokenContextForRequest()`
on the resource-server side, which is what makes
`HttpRestRequest::getPatientUUIDString()` return the right value
for patient-compartment FHIR queries.

## See also

- `doc/api/oauth2-and-smart.md` — OAuth2 / SMART scope internals
- `doc/api/fhir-api.md` — How the launch context flows into FHIR
  requests
- `doc/api/bulk-export.md` — How `$export` uses SMART client
  credentials
- `doc/interop/portal-vs-api.md` — How SMART differs from the
  patient-portal and core-UI auth flows
