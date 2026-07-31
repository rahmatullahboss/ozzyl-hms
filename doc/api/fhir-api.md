# OpenEMR FHIR R4 API

OpenEMR ships a SMART on FHIR R4 API that implements the US Core 3.1.0
profile set, with US Core 7/8 elements already in motion. This document
covers the resource surface, search parameters, controllers, and the
service locator plumbing that turns OpenEMR rows into FHIR resources.

- Source root: `openemr-reference/apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php`
- Source root: `openemr-reference/src/FHIR/`
- Source root: `openemr-reference/src/Services/FHIR/`
- Source root: `openemr-reference/src/RestControllers/FHIR/`
- Profile documents: US Core 3.1.0 + 7.0.0/8.0.0 elements; SMART v2.2

## Table of contents

- [FHIR version and profile conformance](#fhir-version-and-profile-conformance)
- [Generated resource classes (PHPFHIR)](#generated-resource-classes-phpfhir)
- [Resource coverage (~30 resources)](#resource-coverage-30-resources)
- [`FhirServiceBase` — the abstract service](#fhirservicebase)
- [The `Fhir*Service` per resource](#the-fhirservice-per-resource)
- [FHIR search parameters per resource](#fhir-search-parameters-per-resource)
- [SMART v2 scope constraints](#smart-v2-scope-constraints)
- [FHIR REST controllers](#fhir-rest-controllers)
- [The generic controller pattern](#the-generic-controller-pattern)
- [FHIR REST endpoints (no auth)](#fhir-rest-endpoints-no-auth)
- [CapabilityStatement (`/fhir/metadata`)](#capabilitystatement-fhirmetadata)
- [OpenAPI / `swagger/openemr-api.yaml`](#openapi--swaggeropenemr-apiyaml)

## FHIR version and profile conformance

- **Base spec**: HL7 FHIR R4 (4.0.1).
- **US Core implementation guide**: 3.1.0 (current default), with
  structures for 7.0.0/8.0.0 migrating in via the `VersionedProfileTrait`.
  Each `Fhir*Service` declares its `USCGI_PROFILE_URI` constant.
- **SMART on FHIR**: v2.2 — capability flags, scope syntax, and launch
  context are all v2.2. See `doc/api/oauth2-and-smart.md` and
  `doc/interop/smart-on-fhir.md` for the OAuth2 side.
- **Bulk Data Access**: SMART v2.2 §`$export` and `$bulkdata-status`. See
  `doc/api/bulk-export.md`.

The server's base URL is computed by `ServerConfig::getFhirUrl()`:

```php
// src/FHIR/Config/ServerConfig.php:50
return $this->getBaseApiUrl() . "/fhir";
```

## Generated resource classes (PHPFHIR)

OpenEMR's FHIR types are produced by [PHPFHIR](https://github.com/dcarbone/php-fhir).
The generated code lives under `src/FHIR/R4/`:

- `src/FHIR/R4/FHIRDomainResource/` — 143 domain-resource classes
  (`FHIRPatient`, `FHIREncounter`, `FHIRCondition`, `FHIRObservation`,
  `FHIRAllergyIntolerance`, `FHIRMedicationRequest`, etc.). The domain
  resources are the *types* the API can return — only a subset are wired
  up to controllers and services, but all the type definitions are
  available for building arbitrary FHIR payloads programmatically.
- `src/FHIR/R4/FHIRResource/` — supporting resources and complex types
  (`FHIRBundle`, `FHIRPatient/FHIRPatientCommunication`,
  `FHIREncounter/FHIREncounterHospitalization`, etc.).
- `src/FHIR/R4/FHIRElement/` — primitive and reusable element types
  (`FHIRCode`, `FHIRCodeableConcept`, `FHIRCoding`, `FHIRHumanName`,
  `FHIRIdentifier`, `FHIRPeriod`, `FHIRQuantity`, `FHIRMeta`, etc.).

The classes are immutable-ish POJOs with `getX()` / `setX()` accessors and
an internal `SerializationContext` to control JSON / XML output. They are
auto-loaded by Composer from the standard PSR-4 path.

The bulk export code also lives in `src/FHIR/Export/` (see
`doc/api/bulk-export.md`).

## Resource coverage (~30 resources)

`apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php` registers search
and read endpoints for the following resources. US Core profile URIs come
from the `USCGI_PROFILE_URI` constant on each service.

| FHIR resource | FHIR service | US Core profile URI | Routes |
|---------------|--------------|---------------------|--------|
| Patient | `FhirPatientService` | `http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient` | `/fhir/Patient`, `/fhir/Patient/:uuid` |
| Encounter | `FhirEncounterService` | `…/us-core-encounter` | `/fhir/Encounter`, `/fhir/Encounter/:uuid` |
| Condition | `FhirConditionService` (composite of `FhirConditionEncounterDiagnosisService`, `FhirConditionProblemListItemService`, `FhirConditionHealthConcernService`) | `…/us-core-condition` | `/fhir/Condition`, `/fhir/Condition/:uuid` |
| AllergyIntolerance | `FhirAllergyIntoleranceService` | `…/us-core-allergyintolerance` | `/fhir/AllergyIntolerance`, `/fhir/AllergyIntolerance/:uuid` |
| Observation (vital signs, lab, SDOH, social history, survey) | `FhirObservationService` | `…/us-core-observation-lab`, `…/us-core-vital-signs` | `/fhir/Observation`, `/fhir/Observation/:uuid` |
| Medication | `FhirMedicationService` | (base FHIR) | `/fhir/Medication`, `/fhir/Medication/:uuid` |
| MedicationRequest | `FhirMedicationRequestService` | `…/us-core-medicationrequest` | `/fhir/MedicationRequest`, `/fhir/MedicationRequest/:uuid` |
| MedicationDispense | `FhirMedicationDispenseService` | (base FHIR) | `/fhir/MedicationDispense`, `/fhir/MedicationDispense/:uuid` |
| Immunization | `FhirImmunizationService` | `…/us-core-immunization` | `/fhir/Immunization`, `/fhir/Immunization/:uuid` |
| Procedure | `FhirProcedureService` | `…/us-core-procedure` | `/fhir/Procedure`, `/fhir/Procedure/:uuid` |
| CarePlan | `FhirCarePlanService` | `…/us-core-careplan` | `/fhir/CarePlan`, `/fhir/CarePlan/:uuid` |
| CareTeam | `FhirCareTeamService` | `…/us-core-careteam` | `/fhir/CareTeam`, `/fhir/CareTeam/:uuid` |
| Goal | `FhirGoalService` | `…/us-core-goal` | `/fhir/Goal`, `/fhir/Goal/:uuid` |
| DiagnosticReport (lab, notes) | `FhirDiagnosticReportService` | `…/us-core-diagnosticreport-lab` / `…/us-core-diagnosticreport-note` | `/fhir/DiagnosticReport`, `/fhir/DiagnosticReport/:uuid` |
| DocumentReference | `FhirDocumentReferenceService` | `…/us-core-documentreference` | `/fhir/DocumentReference`, `/fhir/DocumentReference/:uuid`, `/fhir/DocumentReference/$docref` |
| Questionnaire | `FhirQuestionnaireService` | (base) | `/fhir/Questionnaire`, `/fhir/Questionnaire/:uuid` |
| QuestionnaireResponse | `FhirQuestionnaireResponseService` | (base) | `/fhir/QuestionnaireResponse`, `/fhir/QuestionnaireResponse/:uuid` |
| Practitioner | `FhirPractitionerService` | `…/us-core-practitioner` | `/fhir/Practitioner`, `/fhir/Practitioner/:uuid` |
| PractitionerRole | `FhirPractitionerRoleService` | `…/us-core-practitionerrole` | `/fhir/PractitionerRole`, `/fhir/PractitionerRole/:uuid` |
| Organization | `FhirOrganizationService` | `…/us-core-organization` | `/fhir/Organization`, `/fhir/Organization/:uuid` |
| Location | `FhirLocationService` | `…/us-core-location` | `/fhir/Location`, `/fhir/Location/:uuid` |
| Coverage | `FhirCoverageService` | `…/us-core-coverage` | `/fhir/Coverage`, `/fhir/Coverage/:uuid` |
| Device | `FhirDeviceService` | `…/us-core-device` | `/fhir/Device`, `/fhir/Device/:uuid` |
| Specimen | `FhirSpecimenService` | (base) | `/fhir/Specimen`, `/fhir/Specimen/:uuid` |
| Person | `FhirPersonService` | (base) | `/fhir/Person`, `/fhir/Person/:uuid` |
| RelatedPerson | `FhirRelatedPersonService` | (base) | `/fhir/RelatedPerson`, `/fhir/RelatedPerson/:uuid` |
| Provenance | `FhirProvenanceService` | (base) | `/fhir/Provenance`, `/fhir/Provenance/:uuid` |
| ServiceRequest | `FhirServiceRequestService` | `…/us-core-servicerequest` | `/fhir/ServiceRequest`, `/fhir/ServiceRequest/:uuid` |
| Media | `FhirMediaService` | (base) | `/fhir/Media`, `/fhir/Media/:uuid` |
| Appointment | `FhirAppointmentRestController` | (base) | `/fhir/Appointment`, `/fhir/Appointment/:uuid` |
| Group | `FhirGroupService` | (base) | `/fhir/Group`, `/fhir/Group/:uuid` (used for `$export` group scoping) |
| ValueSet | `FhirValueSetService` | (base) | `/fhir/ValueSet`, `/fhir/ValueSet/:uuid` |

(Operation-only endpoints — `Metadata`, `$export`, `$bulkdata-status`,
`$docref` — are listed at the bottom of this document.)

The full list of `Fhir*Service` files is in `src/Services/FHIR/`; each one
extends `FhirServiceBase` and (usually) implements
`IResourceSearchableService`, `IResourceReadableService`,
`IFhirExportableResourceService`, and `IResourceUSCIGProfileService`. The
presence of these interfaces is what causes `FhirResourcesService` to
include the resource in the bulk-export iteration and the
CapabilityStatement listing.

## `FhirServiceBase`

`src/Services/FHIR/FhirServiceBase.php` is the abstract base every FHIR
service extends. The contract each implementation fulfills:

- `loadSearchParameters()` — returns an array of
  `FhirSearchParameterDefinition` mapping FHIR search param names to
  OpenEMR column/scope mappings.
- `parseOpenEMRRecord($row, $encode)` — turns one OpenEMR row into a
  `FHIRDomainResource` subclass.
- `parseFhirResource(FHIRDomainResource $fhir)` — inverse direction, for
  create / update.
- `getOne(...)`, `getAll(...)`, `insert(...)`, `update(...)` — concrete
  methods on the base that loop through `searchForOpenEMRRecords` and
  the parsed records, then wrap results in `ProcessingResult`.
- `insertOpenEMRRecord($row)` and `updateOpenEMRRecord($id, $row)` — must
  be implemented by each service.

`FhirServiceBase` also implements:

- `SessionAwareInterface` — `setSession()` / `getSession()` so the service
  can pull the current `authUserID`, `pid`, etc.
- `IGlobalsAware` — `setGlobalsBag()` / `getGlobalsBag()` for reading
  OpenEMR globals (e.g. `rest_fhir_api`, `rest_system_scopes_api`).

The `ResourceServiceSearchTrait` adds the search DSL: the search
parameter definitions, the `SearchFieldFactory`, and the iteration
over matched records. The `FhirServiceBaseEmptyTrait` provides no-op
overrides for services that don't support insert/update.

## The `Fhir*Service` per resource

Each service has a small, predictable shape:

```php
class FhirEncounterService extends FhirServiceBase implements
    IFhirExportableResourceService,
    IPatientCompartmentResourceService,
    IResourceUSCIGProfileService
{
    use PatientSearchTrait;
    use FhirServiceBaseEmptyTrait;
    use BulkExportSupportAllOperationsTrait;
    use FhirBulkExportDomainResourceTrait;
    use VersionedProfileTrait;

    const USCGI_PROFILE_URI = '…/us-core-encounter';

    protected function loadSearchParameters(): array
    {
        return [
            '_id' => new FhirSearchParameterDefinition('_id', SearchFieldType::TOKEN, [new ServiceField('euuid', ServiceField::TYPE_UUID)]),
            'patient' => $this->getPatientContextSearchField(),
            'date'    => new FhirSearchParameterDefinition('date', SearchFieldType::DATETIME, ['date']),
            // …
        ];
    }
}
```

`PatientSearchTrait` provides `getPatientContextSearchField()` and binds
`patient=<uuid>` searches to the right OpenEMR column.
`BulkExportSupportAllOperationsTrait` and `FhirBulkExportDomainResourceTrait`
make the service participate in `$export` and `$bulkdata-status`.

`FhirPatientService` is the most complex. Beyond search, it also:

- Adds the `us-core-patient` extensions (race, ethnicity, birth sex, etc.)
  in `parseOpenEMRRecord()` using the `VersionedProfileTrait`.
- Resolves communication language preferences via `ListService`.
- Sets `USCGI_PROFILE_URI` to `http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient`.

`FhirConditionService` is the one notable composite: it delegates to
three inner services (`FhirConditionEncounterDiagnosisService`,
`FhirConditionProblemListItemService`, `FhirConditionHealthConcernService`)
selected by the FHIR `category` token. This matches the US Core
requirement that a Condition carry one of the three category codes.

## FHIR search parameters per resource

Below is the complete search-parameter map extracted from each service's
`loadSearchParameters()`. `TOKEN` parameters accept
`<system>|<value>` or just `<value>`. `STRING` parameters accept a
case-insensitive substring match. `DATE` and `DATETIME` accept
FHIR date/date-time prefixes (`eq`, `ne`, `gt`, `ge`, `lt`, `le`).

| Resource | Search params | Notes |
|----------|---------------|-------|
| Patient | `_id`, `identifier`, `name`, `birthdate`, `gender`, `address`, `address-city`, `address-postalcode`, `address-state`, `email`, `family`, `given`, `phone`, `telecom`, `_lastUpdated`, `generalPractitioner` | US Core MUST-supports: `_id`, `identifier`, `name`, `name+birthdate`, `gender+name` |
| Encounter | `_id`, `patient`, `date`, `status` | `status` and `date` added by OpenEMR |
| Condition | `_id`, `patient`, `_lastUpdated`, `category` | `category` selects encounter-diagnosis / problem-list-item / health-concern |
| AllergyIntolerance | `patient`, `clinical-status` | Standard US Core |
| Observation | `patient`, `category`, `code`, `date`, `status` | `category` chooses lab, vital-signs, SDOH, social-history, survey, clinical-test |
| MedicationRequest | `patient`, `status`, `intent`, `encounter` | Standard US Core |
| MedicationDispense | `patient`, `status` | |
| Immunization | `patient`, `status`, `date` | |
| Procedure | `patient`, `status`, `date` | |
| CarePlan | `patient`, `status`, `category` | |
| CareTeam | `patient`, `status` | |
| Goal | `patient`, `lifecycle-status` | |
| DiagnosticReport | `patient`, `status`, `category`, `code`, `date` | `category` chooses lab vs note |
| DocumentReference | `patient`, `status`, `category`, `type`, `date` | `category` chooses clinical-note |
| Practitioner | `_id`, `identifier`, `name`, `family`, `given` | |
| PractitionerRole | `_id`, `practitioner`, `organization`, `role` | |
| Organization | `_id`, `identifier`, `name`, `address` | |
| Location | `_id`, `identifier`, `name`, `address`, `address-city`, `address-state`, `address-postalcode` | |
| Coverage | `patient`, `status`, `type`, `payor` | |
| Device | `patient`, `status`, `type` | |
| Specimen | `patient`, `status`, `type` | |
| Provenance | `target` | |
| Person | `_id`, `identifier`, `name` | |
| RelatedPerson | `patient` | |
| ServiceRequest | `patient`, `status`, `intent`, `category` | |
| Media | `patient`, `status` | |
| Appointment | `patient`, `status`, `date` | |
| Group | `_id`, `identifier`, `member` | Used to scope group exports |
| Questionnaire / QuestionnaireResponse | `patient`, `status`, `questionnaire` | |
| ValueSet | `url`, `name`, `version` | Used for $expand |

FHIR R4 modifiers (`:missing`, `:exact`, `:contains`, etc.) are honored by
the `FhirSearchParameterDefinition` + `SearchFieldFactory` pipeline.

## SMART v2 scope constraints

SMART v2 introduced granular scopes like:

- `patient/Observation.rs?category=vital-signs`
- `user/Patient.read`
- `system/Patient.*`
- `patient/Condition.rs?category=http://terminology.hl7.org/CodeSystem/condition-category|encounter-diagnosis`

`FhirObservationService` and `FhirConditionService` are the two that
must understand the `?category=...` constraint. Both implement
`getSupportedSearchParams()`-style filtering (inherited from
`FhirServiceBase`) and reject unsupported constraints with a
`SearchFieldException`.

The full constraint grammar is parsed by `ScopeEntity::createFromString`
in `src/Common/Auth/OpenIDConnect/Entities/ScopeEntity.php`. The
permission flags are:

- `c` create
- `r` read
- `u` update
- `d` delete
- `s` search
- `cruds` full CRUDS

See `ScopePermissionParser` (`src/RestControllers/SMART/ScopePermissionParser.php`)
for the human-readable labels used in the SMART authorization consent
screen.

## FHIR REST controllers

`src/RestControllers/FHIR/` is the controller layer. Most controllers are
thin:

- `FhirPatientRestController`, `FhirEncounterRestController`, etc. —
  dedicated controllers that delegate to the corresponding `Fhir*Service`.
- `FhirAppointmentRestController`, `FhirQuestionnaireRestController`,
  `FhirQuestionnaireResponseRestController` — also thin wrappers around
  the matching services.
- `FhirGroupRestController` — used to scope `$export` to a Group.
- `FhirMediaRestController` — exposes the OpenEMR documents table as
  `Media` resources.
- `FhirMetaDataRestController` — emits the CapabilityStatement at
  `/fhir/metadata`.
- `FhirValueSetRestController` — emits `$expand` results.
- `FhirGenericRestController` — the reusable base; see below.

## The generic controller pattern

`FhirGenericRestController` (`src/RestControllers/FHIR/FhirGenericRestController.php`)
is the pattern newer resources follow to avoid per-resource controller
boilerplate. It accepts a `FhirServiceBase` and an `HttpRestRequest`,
performs:

1. ACL check via `RestConfig::request_authorization_check(...)` using the
   `aclChecks[]` collection set by the route closure.
2. Patient bind — if `$request->isPatientRequest()` is true, forces the
   `patient` search param to the access-token's patient UUID.
3. Calls `FhirServiceBase::getAll($searchParams, $puuidBind)` and wraps the
   `ProcessingResult` in a FHIR `Bundle`.
4. `getOne($fhirId)` is implemented as `getAll(_id=$fhirId)` so a
   single-resource call shares the same search/ACL pipeline.

The `RoutesExtensionListener` does the resource/operation extraction from
the route definition and the request, and the `FhirResourcesService` is
responsible for assembling the FHIR `Bundle` response.

## FHIR REST endpoints (no auth)

A handful of FHIR endpoints are unauthenticated (added to the
`SkipAuthorizationStrategy` skip list):

| Endpoint | Handler | Purpose |
|----------|---------|---------|
| `GET /fhir/metadata` | `FhirMetaDataRestController` | Returns the `CapabilityStatement` |
| `GET /fhir/.well-known/smart-configuration` | `SMARTConfigurationController` | Returns the SMART v2 `capabilities` and OAuth2 endpoint URLs |
| `GET /fhir/OperationDefinition` | `FhirOperationDefinitionRestController` | Lists the `$export`, `$docref`, etc. operation definitions |
| `GET /fhir/ValueSet`, `GET /fhir/ValueSet/:id` | `FhirValueSetRestController` | Static value sets exposed by OpenEMR |

## CapabilityStatement (`/fhir/metadata`)

`FhirMetaDataRestController` builds a `FHIRCapabilityStatement` from the
union of all `Fhir*Service` classes discovered by `FhirResourcesService`.
It uses `RestControllerHelper::buildCapabilityStatementFromServices()`
which:

- Discovers services via the `FHIR_SERVICES_NAMESPACE` prefix
  (`OpenEMR\Services\FHIR\Fhir`).
- For each one, calls `getProfileURIs()` (from
  `IResourceUSCIGProfileService`) and adds a `CapabilityStatementResource`
  with the supported interactions (`read`, `search-type`, optionally
  `create`, `update`, `delete`).
- Declares `fhirVersion = "4.0.1"`, `format = ["json", "xml"]`,
  `rest.mode = "server"`, and the SMART v2 OAuth2 security service with
  SMART v2 extension URLs.

## OpenAPI / `swagger/openemr-api.yaml`

The FHIR routes are also captured in `swagger/openemr-api.yaml`. Most
FHIR controllers use `OpenApi\Attributes` to attach descriptions, search
parameters, and response examples, so the spec can be regenerated from
annotations. The FHIR-specific tags are `fhir` (provider) and
`fhir-patient` (patient role).

## See also

- `doc/api/oauth2-and-smart.md` — SMART scope and grant internals
- `doc/api/bulk-export.md` — `$export` and `$bulkdata-status`
- `doc/api/rest-api.md` — Standard `/api/` and Portal `/portal/` surfaces
- `doc/interop/fhir-r4.md` — Resource → table mapping deep-dive
- `doc/interop/smart-on-fhir.md` — Launch flow details
- `doc/interop/ccda.md` — How `$docref` connects to CCDA generation
