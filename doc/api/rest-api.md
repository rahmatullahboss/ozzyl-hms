# OpenEMR REST API

OpenEMR exposes three parallel API surfaces from a single Symfony HttpKernel
backbone. This document focuses on the structure, the request lifecycle, and
the controllers that power the standard and portal surfaces. The FHIR surface
has its own deep-dive at `doc/api/fhir-api.md`.

- Source root: `openemr-reference/apis/`
- Source root: `openemr-reference/src/RestControllers/`
- Source root: `openemr-reference/src/Common/Http/`

## Table of contents

- [Three API surfaces](#three-api-surfaces)
- [Site-based routing](#site-based-routing)
- [Boot flow (`apis/dispatch.php` → `ApiApplication`)](#boot-flow)
- [The 10 event subscribers in `ApiApplication`](#the-10-event-subscribers)
- [`HttpRestRequest` — the request object](#httprestrequest)
- [`HttpRestRouteHandler` — the dispatcher](#httprestroutehandler)
- [`HttpRestParsedRoute` — route matching](#httprestparsedroute)
- [Authorization — `AuthorizationListener` and strategies](#authorization)
- [Standard REST controllers](#standard-rest-controllers)
- [Standard route map (selected)](#standard-route-map-selected)
- [Portal route map](#portal-route-map)
- [OpenAPI 3.0 spec](#openapi-30-spec)

## Three API surfaces

| Path prefix | Audience | Auth model | File with routes |
|-------------|----------|------------|------------------|
| `/api/...` | Provider/staff | OAuth2 bearer with `api:oemr` scope and per-resource `user/<Resource>.<c|r|u|d|s>` scopes | `apis/routes/_rest_routes_standard.inc.php` |
| `/portal/...` | Patient | OAuth2 bearer with `api:port` scope and per-resource `patient/<Resource>.<c|r|u|d|s>` scopes | `apis/routes/_rest_routes_portal.inc.php` |
| `/fhir/...` | SMART apps | OAuth2 bearer (PKCE or Backend Services) with SMART scopes | `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php` |

All three share the same Symfony HttpKernel pipeline
(`src/RestControllers/ApiApplication.php:71`). The only thing that differs is
which `apis/routes/*.inc.php` file is loaded and which authorization strategies
apply.

## Site-based routing

Every API call carries a site segment because OpenEMR is multi-tenant. The
URL pattern is:

```
https://<host>/apis/<site>/<api|portal|fhir>/...
```

The site segment (`default` in single-tenant installs) is parsed out of the
path by the kernel and stashed on the request as
`HttpRestRequest::setRequestSite($site)`. The rest of the path is matched
against the route table.

Multi-site DB isolation happens in the `SiteSetupListener`; the request never
sees a different database connection unless the listener wires it.

## Boot flow

The single entry point is `apis/dispatch.php`:

```php
// apis/dispatch.php:26
$request = HttpRestRequest::createFromGlobals();
$apiApplication = new ApiApplication();
$apiApplication->run($request);
```

`HttpRestRequest::createFromGlobals()` does a small but important bit of
preprocessing: if Apache's `mod_rewrite` populated `$_GET['_REWRITE_COMMAND']`,
it converts that into Symfony-friendly `PATH_INFO` and `REQUEST_URI` so the
route matcher works on clean URLs. The presence of an `APICSRFTOKEN` header
also flags the request as a local API call.

The `ApiApplication` then:

1. Builds a Symfony `EventDispatcher`.
2. Registers 10 event subscribers in a fixed order
   (`src/RestControllers/ApiApplication.php:71`).
3. Constructs `OEHttpKernel` (an OpenEMR extension of `Symfony\HttpKernel`).
4. Calls `$kernel->handle($request)` and either echoes or returns the
   response.

The Symfony events fired during `handle()` are:

- `kernel.request`
- `kernel.controller`
- `kernel.controller_arguments`
- `kernel.view`
- `kernel.response`
- `kernel.finish_request`
- `kernel.exception`

`$kernel->terminate()` runs after the response is sent and triggers
`kernel.terminate`.

## The 10 event subscribers

Registered in this exact order in `ApiApplication::run()`:

| # | Subscriber | Responsibility | File |
|---|------------|----------------|------|
| 1 | `ExceptionHandlerListener` | Catches `Throwable`s from later listeners and turns them into JSON error responses | `src/RestControllers/Subscriber/ExceptionHandlerListener.php` |
| 2 | `TelemetryListener` | Sends end-of-request telemetry | `src/RestControllers/Subscriber/TelemetryListener.php` |
| 3 | `ApiResponseLoggerListener` | Logs API responses (skipped for local API calls) | `src/RestControllers/Subscriber/ApiResponseLoggerListener.php` |
| 4 | `SessionCleanupListener` | Cleans session state at request end (skipped for local API calls) | `src/RestControllers/Subscriber/SessionCleanupListener.php` |
| 5 | `SiteSetupListener` | Resolves the site id, opens the per-site DB connection, populates globals | `src/RestControllers/Subscriber/SiteSetupListener.php` |
| 6 | `CORSListener` | Emits CORS headers and handles `OPTIONS` preflight early | `src/RestControllers/Subscriber/CORSListener.php` |
| 7 | `OAuth2AuthorizationListener` | Bridges OAuth2 token introspection to REST access tokens | `src/RestControllers/Subscriber/OAuth2AuthorizationListener.php` |
| 8 | `AuthorizationListener` | Applies the chosen authorization strategy and the per-scope `RestApiSecurityCheckEvent` | `src/RestControllers/Subscriber/AuthorizationListener.php` |
| 9 | `RoutesExtensionListener` | Matches the request against the route table, runs `checkSecurity()`, attaches the controller callback | `src/RestControllers/Subscriber/RoutesExtensionListener.php` |
| 10 | `ViewRendererListener` | Turns controller return values (or thrown `HttpException`s) into Symfony `Response` objects | `src/RestControllers/Subscriber/ViewRendererListener.php` |

The first four are "early" listeners that must run before any other logic so
that errors and session state are always handled cleanly.

## `HttpRestRequest`

`src/Common/Http/HttpRestRequest.php` extends `Symfony\Component\HttpFoundation\Request`
and is the *only* kind of request object any controller should accept.

Key state on the request:

| Field | Type | Purpose |
|-------|------|---------|
| `$resource` | `?string` | The FHIR / API resource name parsed from the route (e.g. `Patient`, `patient`) |
| `$operation` | `?string` | The FHIR operation name if the route is an operation (e.g. `$export`, `$docref`) |
| `$requestUser` | `array` | The resolved user account (provider, staff, or patient) |
| `$requestUserUUID` | `?string` | Binary form of the user UUID |
| `$requestUserUUIDString` | `?string` | String form of the user UUID |
| `$requestUserRole` | `string` | One of `patient`, `users`, or `system` |
| `$patientUUIDString` | `?string` | For patient-context requests, the patient whose compartment we are bound to |
| `$accessTokenScopes` | `ResourceScopeEntityList[]` | Parsed scopes from the access token |
| `$resourceScopeContexts` | `array` | Per-resource context (`patient`, `user`, `system`) — used to bind queries to a compartment |
| `$patientRequest` | `bool` | True when the route is a `patient/<Resource>.*` scope (write-restricted for patient role) |
| `$requestSite` | `string` | The site id from the path |
| `$clientId` | `?string` | OAuth2 client id (null for PKCE-only flows) |
| `$accessTokenId` | `string` | The OAuth2 access token id (also used as the CSRF token for local API) |
| `$isLocalApi` | `bool` | True if `APICSRFTOKEN` header was present |
| `$apiType` | `?string` | One of `fhir`, `oemr`, `port` |
| `$apiBaseFullUrl` | `string` | Fully-qualified API server base URL |
| `$requiredEndpointScope` | `ScopeEntity` | The scope needed to satisfy the matched route |

Convenience helpers worth noting:

- `isFhirRequest()`, `isPortalRequest()`, `isStandardApiRequest()` — sniff the
  `PATH_INFO` for the surface prefix.
- `isPatientRequest()` — true when at least one `patient/<Resource>` scope is
  active.
- `isPatientWriteRequest()` — true when a patient-role user is doing a
  non-`GET` against FHIR. OpenEMR refuses this with
  `AccessDeniedException("Patient user role is not allowed to write FHIR
  resources.")` in `AuthorizationListener::onRestApiSecurityCheck`.
- `requestHasScopeEntity(ScopeEntity $scope)` — checks parsed access-token
  scopes (the right way; `requestHasScope(string)` is deprecated).
- `getScopeContextForResource($resource)` — returns the highest-priority
  context (`system` > `user` > `patient`) for a given resource.

## `HttpRestRouteHandler`

`src/Common/Http/HttpRestRouteHandler.php` is the workhorse that walks the
route table, picks the first match, and binds the controller.

For each `(method, pathPattern, callback)` entry from
`apis/routes/_rest_routes_*.inc.php`, the handler:

1. Builds an `HttpRestParsedRoute` and asks it `isValid()`.
2. If the resource's scope context is `patient`, sets
   `request->setPatientRequest(true)`.
3. Calls `checkSecurity()` which dispatches a
   `RestApiSecurityCheckEvent` for the route. This is where
   `AuthorizationListener::onRestApiSecurityCheck` validates the per-resource
   scope. If it fails, the event carries a 401/403 `ResponseInterface` and
   the handler returns it directly.
4. On success, attaches the parsed route to the request attributes
   (`_route`, `setResource`, `setOperation`) and stores the controller
   callback in `attributes[_controller]`.
5. Returns `null` to let the kernel run the controller and then
   `ViewRendererListener` render the response.

`checkSecurity()` derives the permission from the HTTP method using
`getGetRequestPermission()` for `GET` and a match expression for the rest:

- `GET` with no instance id → `s` (search)
- `GET` with instance id → `r` (read)
- `POST` → `c`
- `PUT` / `PATCH` → `u`
- `DELETE` → `d`
- Anything else → 501 Not Implemented

The resolved scope is `{scopeType}/{resource}.{permission}`, e.g.
`user/Patient.read` for a staff `GET /fhir/Patient/abc`.

## `HttpRestParsedRoute`

`src/Common/Http/HttpRestParsedRoute.php` is a tiny regex matcher. The
constructor takes the request method, request path (with the site segment
stripped via `HttpRestRequest::getRequestPathWithoutSite()`), and the
route definition (`"GET /api/patient/:puuid"`).

It does three things:

1. Splits the definition on the first space, then converts `:param` tokens
   to capture groups using `preg_quote` and a substitution.
2. Extracts the resource (the segment after `/api/`, `/portal/`, or `/fhir/`)
   and the operation (the segment after the final `/` if it starts with `$`).
3. Captures the last positional `:param` as the "instance identifier", which
   `checkSecurity()` then uses to decide between `r` and `s` for `GET`s.

The parsed route is exposed on the request as `attributes[_route]` so other
subscribers can read it.

## Authorization

`src/RestControllers/Subscriber/AuthorizationListener.php` is the policy
enforcement point. It is responsible for two events:

- `kernel.request` (priority 50) — picks a strategy and authenticates the
  request.
- `RestApiSecurityCheckEvent::EVENT_HANDLE` (priority 50) — enforces the
  per-resource scope.

Three strategies are registered in `getAuthorizationStrategies()`, in this
order (`src/RestControllers/Subscriber/AuthorizationListener.php:86`):

### 1. `LocalApiAuthorizationController`

Handles calls from the in-EHR JS/Angular UI. Recognized by the
`APICSRFTOKEN` header. Validates the token against the session
(`CsrfUtils::verifyCsrfToken`) and binds the request to the current
`authUserID`. Sets `skipAuthorization = true` on the request so downstream
listeners skip scope checks.

Source: `src/RestControllers/Authorization/LocalApiAuthorizationController.php`

### 2. `SkipAuthorizationStrategy`

Whitelist of routes that need no auth at all:

- `/fhir/metadata` (FHIR CapabilityStatement)
- `/fhir/.well-known/smart-configuration` (SMART discovery)
- `/fhir/OperationDefinition` (FHIR `$op` definition list)
- `/api/version`
- `/api/product`

Also skips all `OPTIONS` requests (CORS preflight) by default.

Source: `src/RestControllers/Authorization/SkipAuthorizationStrategy.php`

### 3. `BearerTokenAuthorizationStrategy`

The default for any other call. Steps performed in
`authorizeRequest()` (`src/RestControllers/Authorization/BearerTokenAuthorizationStrategy.php:141`):

1. Build a `ResourceServer` (League OAuth2) with the REST public key and
   `AccessTokenRepository`.
2. Convert the Symfony request to PSR-7, call `validateAuthenticatedRequest`.
   The signed JWT must be valid and unexpired.
3. Check the access token id is not in the `oauth_access_tokens` revocation
   table via `AccessTokenRepository::isAccessTokenRevokedInDatabase`.
4. Verify the user is still a "trusted user" via
   `TrustedUserService::isTrustedUser($clientId, $userId)` — this is the
   mechanism that revokes an access token when the underlying provider
   logs out or when the refresh token is revoked.
5. Re-check token expiration and audit the success/failure via
   `EventAuditLogger::newEvent('api', ...)`.
6. Build a `UuidUserAccount` from the token's `oauth_user_id` to resolve
   the user role (`users`, `patient`, or `system`).
7. Enforce surface/role compatibility: `users` role can call `/api/` and
   `/fhir/`, `patient` role can call `/portal/` and `/fhir/`, `system` role
   can only call `/fhir/`. A wrong pairing throws 403.
8. Build `ResourceScopeEntityList[]` from the access token scopes, stash
   them on the request, and set the user role / user record / patient UUID
   (for patient role).
9. If the request holds a `launch` or `launch/patient` scope, populate the
   patient context from the access token's stored `context` JSON via
   `populateTokenContextForRequest()`.

If no strategy authorizes the request, `AuthorizationListener` throws
`UnauthorizedHttpException("Bearer", ...)` (401).

## Standard REST controllers

All standard controllers live in `src/RestControllers/` and follow the same
pattern: a thin layer that delegates to a service (under
`src/Services/`) and wraps the result with `RestControllerHelper`.

| Controller | File | Routes | Service used |
|------------|------|--------|--------------|
| `PatientRestController` | `PatientRestController.php` | Patient CRUD, search, demographics | `PatientService` |
| `EncounterRestController` | `EncounterRestController.php` | Encounter CRUD + vitals + SOAP notes | `EncounterService` |
| `AppointmentRestController` | `AppointmentRestController.php` | Appointment CRUD, portal view | `AppointmentService` |
| `AllergyIntoleranceRestController` | `AllergyIntoleranceRestController.php` | Allergies on `lists` table | `ListService` |
| `ConditionRestController` | `ConditionRestController.php` | Medical problems (Condition) | `ConditionService` |
| `DrugRestController` | `DrugRestController.php` | Drug catalog | `DrugService` |
| `PrescriptionRestController` | `PrescriptionRestController.php` | Prescriptions (create, soft-delete) | `PrescriptionService` |
| `DocumentRestController` | `DocumentRestController.php` | Patient document upload/download | `DocumentService` |
| `PractitionerRestController` | `PractitionerRestController.php` | Provider directory | `PractitionerService` |
| `FacilityRestController` | `FacilityRestController.php` | Facility list | `FacilityService` |
| `UserRestController` | `UserRestController.php` | User lookup (admin) | `UserService` |
| `InsuranceRestController` | `InsuranceRestController.php` | Patient insurance, `$swap-insurance` op | `InsuranceService` |
| `InsuranceCompanyRestController` | `InsuranceCompanyRestController.php` | Insurance company directory | `InsuranceCompanyService` |
| `EmployerRestController` | `EmployerRestController.php` | Patient employer | `EmployerService` |
| `ImmunizationRestController` | `ImmunizationRestController.php` | Immunizations | `ImmunizationService` |
| `ProcedureRestController` | `ProcedureRestController.php` | Procedures | `ProcedureService` |
| `MessageRestController` | `MessageRestController.php` | Per-patient messages | `MessageService` |
| `TransactionRestController` | `TransactionRestController.php` | Patient ledger transactions | `TransactionService` |
| `ListRestController` | `ListRestController.php` | Medication, surgery, dental issue lists | `ListService` |
| `VersionRestController` | `VersionRestController.php` | `GET /api/version` | n/a |
| `ProductRegistrationRestController` | `ProductRegistrationRestController.php` | `GET /api/product` | n/a |
| `TokenIntrospectionRestController` | `TokenIntrospectionRestController.php` | OAuth2 introspection | `AccessTokenRepository` |

Each controller's methods are richly annotated with `OpenApi\Attributes` so the
spec at `swagger/openemr-api.yaml` can be generated mechanically.

## Standard route map (selected)

Below is a representative subset of the routes in
`apis/routes/_rest_routes_standard.inc.php`. The ACL column is the value
passed to `RestConfig::request_authorization_check($request, $section,
$value[, $permission])` and the FHIR-equivalent scope is the scope string
that satisfies the same check under OAuth2.

| Method + path | Controller | ACL section | ACL value | FHIR scope equivalent |
|---------------|-----------|-------------|-----------|------------------------|
| `GET /api/facility` | `FacilityRestController` | admin | users | user/Organization.read |
| `GET /api/facility/:fuuid` | `FacilityRestController` | admin | users | user/Organization.read |
| `POST /api/facility` | `FacilityRestController` | admin | super | user/Organization.write |
| `PUT /api/facility/:fuuid` | `FacilityRestController` | admin | super | user/Organization.write |
| `GET /api/patient` | `PatientRestController` | patients | demo | user/Patient.read |
| `POST /api/patient` | `PatientRestController` | patients | demo | user/Patient.write |
| `PUT /api/patient/:puuid` | `PatientRestController` | patients | demo | user/Patient.write |
| `GET /api/patient/:puuid` | `PatientRestController` | patients | demo | user/Patient.read |
| `GET /api/patient/:puuid/encounter` | `EncounterRestController` | encounters | auth_a | user/Encounter.read |
| `POST /api/patient/:puuid/encounter` | `EncounterRestController` | encounters | auth_a | user/Encounter.write |
| `PUT /api/patient/:puuid/encounter/:euuid` | `EncounterRestController` | encounters | auth_a | user/Encounter.write |
| `GET /api/patient/:pid/encounter/:eid/soap_note` | `EncounterRestController` | encounters | notes | user/DocumentReference.read |
| `POST /api/patient/:pid/encounter/:eid/soap_note` | `EncounterRestController` | encounters | notes | user/DocumentReference.write |
| `GET /api/patient/:pid/encounter/:eid/vital` | `EncounterRestController` | encounters | notes | user/Observation.read |
| `POST /api/patient/:pid/encounter/:eid/vital` | `EncounterRestController` | encounters | notes | user/Observation.write |
| `GET /api/practitioner` | `PractitionerRestController` | admin | users | user/Practitioner.read |
| `POST /api/practitioner` | `PractitionerRestController` | admin | users | user/Practitioner.write |
| `GET /api/medical_problem` | `ConditionRestController` | encounters | notes | user/Condition.read |
| `GET /api/patient/:puuid/medical_problem` | `ConditionRestController` | encounters | notes | user/Condition.read |
| `POST /api/patient/:puuid/medical_problem` | `ConditionRestController` | patients | med | user/Condition.write |
| `PUT /api/patient/:puuid/medical_problem/:muuid` | `ConditionRestController` | patients | med | user/Condition.write |
| `DELETE /api/patient/:puuid/medical_problem/:muuid` | `ConditionRestController` | patients | med | user/Condition.delete |
| `GET /api/allergy` | `AllergyIntoleranceRestController` | patients | med | user/AllergyIntolerance.read |
| `POST /api/patient/:puuid/allergy` | `AllergyIntoleranceRestController` | patients | med | user/AllergyIntolerance.write |
| `DELETE /api/patient/:puuid/allergy/:auuid` | `AllergyIntoleranceRestController` | patients | med | user/AllergyIntolerance.delete |
| `GET /api/patient/:pid/medication` | `ListRestController` | patients | med | user/MedicationRequest.read |
| `POST /api/patient/:pid/medication` | `ListRestController` | patients | med | user/MedicationRequest.write |
| `DELETE /api/patient/:pid/medication/:mid` | `ListRestController` | patients | med | user/MedicationRequest.delete |
| `GET /api/patient/:pid/appointment` | `AppointmentRestController` | patients | appt | user/Appointment.read |
| `POST /api/patient/:pid/appointment` | `AppointmentRestController` | patients | appt | user/Appointment.write |
| `DELETE /api/patient/:pid/appointment/:eid` | `AppointmentRestController` | patients | appt | user/Appointment.delete |
| `GET /api/immunization` | `ImmunizationRestController` | patients | med | user/Immunization.read |
| `GET /api/procedure` | `ProcedureRestController` | patients | med | user/Procedure.read |
| `GET /api/drug` | `DrugRestController` | patients | med | user/Medication.read |
| `GET /api/prescription` | `PrescriptionRestController` | patients | med | user/MedicationRequest.read |
| `POST /api/prescription` | `PrescriptionRestController` | patients | med | user/MedicationRequest.write |
| `DELETE /api/prescription/:uuid` | `PrescriptionRestController` | patients | med | user/MedicationRequest.delete |
| `POST /api/patient/:pid/document` | `DocumentRestController` | patients | docs (write\|addonly) | user/DocumentReference.write |
| `GET /api/patient/:pid/document` | `DocumentRestController` | patients | docs | user/DocumentReference.read |
| `GET /api/patient/:pid/document/:did` | `DocumentRestController` | patients | docs | user/DocumentReference.read |
| `GET /api/patient/:puuid/employer` | `EmployerRestController` | patients | demo (staff) / bind (patient) | user/RelatedPerson.read |
| `GET /api/patient/:puuid/insurance` | `InsuranceRestController` | patients | demo | user/Coverage.read |
| `GET /api/patient/:puuid/insurance/:uuid` | `InsuranceRestController` | patients | demo | user/Coverage.read |
| `POST /api/patient/:puuid/insurance` | `InsuranceRestController` | patients | demo (write\|addonly) | user/Coverage.write |
| `PUT /api/patient/:puuid/insurance/:insuranceUuid` | `InsuranceRestController` | patients | demo (write) | user/Coverage.write |
| `GET /api/patient/:puuid/insurance/$swap-insurance` | `InsuranceRestController` | patients | demo (write) | user/Coverage.write |
| `POST /api/patient/:pid/message` | `MessageRestController` | patients | notes | user/Communication.write |
| `GET /api/patient/:pid/transaction` | `TransactionRestController` | patients | trans | user/ChargeItem.read |
| `POST /api/patient/:pid/transaction` | `TransactionRestController` | patients | trans | user/ChargeItem.write |
| `PUT /api/transaction/:tid` | `TransactionRestController` | patients | trans | user/ChargeItem.write |
| `GET /api/version` | `VersionRestController` | — (open) | — | — |
| `GET /api/product` | `ProductRegistrationRestController` | — (open) | — | — |

A few routes use a `request_authorization_check` with explicit permission
overrides — the most common patterns are:

- `['write','addonly']` — allowed to create, but not edit/delete
- `'write'` — single permission

See `src/RestControllers/Config/RestConfig::request_authorization_check` for
how those collapse into the legacy ACL system.

## Portal route map

`apis/routes/_rest_routes_portal.inc.php` is a deliberately tiny
patient-only subset. Every call is bound to the access token's `patient`
context — the route handlers read the patient UUID off the request, never
from the URL.

| Method + path | Controller | Notes |
|---------------|-----------|-------|
| `GET /portal/patient` | `PatientRestController::getOne` | Returns the authenticated patient's demographics |
| `GET /portal/patient/encounter` | `EncounterRestController::getAll` | All encounters for the authenticated patient |
| `GET /portal/patient/encounter/:euuid` | `EncounterRestController::getOne` | One encounter |
| `GET /portal/patient/appointment` | `AppointmentRestController::getAllForPatientByUuid` | All appointments |
| `GET /portal/patient/appointment/:auuid` | `AppointmentRestController::getOneForPatient` | One appointment |

The portal ACL is enforced by `AuthorizationListener::onRestApiSecurityCheck`,
which throws unless `requestUserRole === 'patient'` and the route starts
with `/portal/`. A standard `/api/...` call with a patient-role bearer
token is refused with 401.

The richer portal UI (widgets, messaging, payments, account) lives outside
the REST surface and is covered in `doc/interop/patient-portal-api.md`.

## OpenAPI 3.0 spec

OpenEMR's REST surface is documented in `swagger/openemr-api.yaml` as an
OpenAPI 3.0 spec. It is generated from the `OpenApi\Attributes` annotations
on each controller method (e.g. `#[OA\Get(path: '/api/patient/{puuid}',
...)]` on `PatientRestController::getOne`).

To regenerate the spec:

```bash
composer openapi
```

(or whatever the `openapi` composer script resolves to in this version — see
`composer.json` scripts). The CI pipeline runs PHPStan level 10 against the
same annotations to keep them in sync with the controllers.

The spec is served at the OpenEMR Swagger UI route (configured under
`/swagger` in the admin UI) and used by the patient portal's "API explorer"
screens.

## See also

- `doc/api/fhir-api.md` — FHIR R4 + US Core implementation
- `doc/api/oauth2-and-smart.md` — OAuth2 / SMART scope and grant internals
- `doc/api/bulk-export.md` — `$export` and `$bulkdata-status` operations
- `doc/api/fhir-api.md` — per-resource FHIR coverage
- `doc/interop/portal-vs-api.md` — how portal, REST, and core UI auth differ
