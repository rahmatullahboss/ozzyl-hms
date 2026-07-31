# OpenEMR FHIR R4 — Resource ↔ Table Mapping

This is a companion to `doc/api/fhir-api.md` that focuses on the
*implementation* side: which OpenEMR table backs each FHIR resource,
which `Fhir*Service` parses it, and which search parameters land on
which columns.

- Source root: `openemr-reference/src/FHIR/`
- Source root: `openemr-reference/src/Services/FHIR/`
- Profile documents: HL7 FHIR R4 4.0.1, US Core 3.1.0 (with
  7.0.0/8.0.0 elements), SMART v2.2.

## Table of contents

- [Base data sources](#base-data-sources)
- [Resource → table mapping](#resource--table-mapping)
- [Search parameter column mapping](#search-parameter-column-mapping)
- [Example: `FhirPatientService::parseOpenEMRRecord`](#example-fhirpatientserviceparseopenemrrecord)
- [Example: `FhirEncounterService::parseOpenEMRRecord`](#example-fhirencounterserviceparseopenemrrecord)
- [Example: `FhirConditionService` — three sub-services](#example-fhirconditionservice--three-sub-services)
- [US Core 8.0 element coverage notes](#us-core-80-element-coverage-notes)

## Base data sources

OpenEMR's clinical data lives in a small set of tables. The
`Fhir*Service` classes know how to read these tables through their
associated `*Service` companions (e.g. `PatientService`):

| Table | Purpose | Service |
|-------|---------|---------|
| `patient_data` | Patient demographics + clinical | `PatientService` |
| `form_encounter` | Encounter/visit | `EncounterService` |
| `lists` | Generic clinical list — allergies, problems, medications, surgery, dental | `ListService` |
| `prescriptions` | Prescriptions | `PrescriptionService` |
| `drugs` | Drug catalog | `DrugService` |
| `procedure_order`, `procedure_report`, `procedure_order_code` | Procedures | `ProcedureService` |
| `immunizations` | Immunizations | `ImmunizationService` |
| `documents` | Patient documents (CCDA, lab reports) | `DocumentService` |
| `pnotes` | Messages / clinical notes | `MessageService` |
| `transactions` | Charges / payments | `TransactionService` |
| `users` | Provider / staff master | `UserService` |
| `facility` | Facilities | `FacilityService` |
| `insurance_data` | Patient insurance | `InsuranceService` |
| `employer_data` | Patient employer | `EmployerService` |
| `rule_action_category` / `rule_target` | Reminders / care plans | `ReminderService` |
| `extension_observation` | Generic observation storage (vitals, lab, SDOH) | `ObservationService` |
| `category` + `list_options` | Code systems | `ListService` |
| `forms` (LBF) | Layout-based forms, encounter-scoped structured data | `EncounterService` |

The `uuid_registry` table holds a `uuid` (binary 16) for every row of
every table that participates in the FHIR layer; `UuidRegistry` is the
helper that maps `<table>.<column> = '<uuid>'` to OpenEMR's primary
keys.

## Resource → table mapping

| FHIR resource | OpenEMR table(s) | Service | Notes |
|---------------|------------------|---------|-------|
| Patient | `patient_data` | `FhirPatientService` / `PatientService` | UUID via `uuid_registry` |
| Encounter | `form_encounter` | `FhirEncounterService` / `EncounterService` | UUID via `form_encounter.uuid` |
| Condition (encounter-diagnosis) | `form_encounter` + LBF | `FhirConditionEncounterDiagnosisService` | Drawn from encounter billing codes |
| Condition (problem-list-item) | `lists` (type='medical_problem') | `FhirConditionProblemListItemService` | |
| Condition (health-concern) | `lists` (type='health_concern') | `FhirConditionHealthConcernService` | |
| AllergyIntolerance | `lists` (type='allergy') | `FhirAllergyIntoleranceService` / `ListService` | Reaction in `rule_action_category` |
| Observation (vital signs) | `vital_signs` (or `form_vital`) + `extension_observation` | `FhirObservationService` | Category token = `vital-signs` |
| Observation (lab) | `procedure_result` + `extension_observation` | `FhirObservationService` | Category token = `laboratory` |
| Observation (SDOH) | `extension_observation` (custom-coded) | `FhirObservationService` | Category token = `sdoh` |
| Observation (social history) | `history_data` + `extension_observation` | `FhirObservationService` | Category token = `social-history` |
| Observation (survey / PRO) | `extension_observation` (PRO survey answers) | `FhirObservationService` | Category token = `survey` |
| Observation (clinical-test) | `procedure_result` | `FhirObservationService` | Category token = `clinical-test` |
| Medication | `drugs` | `FhirMedicationService` / `DrugService` | |
| MedicationRequest | `prescriptions` | `FhirMedicationRequestService` / `PrescriptionService` | |
| MedicationDispense | `prescriptions` (filled) | `FhirMedicationDispenseService` | |
| Immunization | `immunizations` | `FhirImmunizationService` / `ImmunizationService` | |
| Procedure | `procedure_order` + `procedure_report` + `procedure_order_code` | `FhirProcedureService` / `ProcedureService` | |
| CarePlan | `rule_action_category` + `rule_target` + `care_plan` | `FhirCarePlanService` | |
| CareTeam | `care_team` (LBF) + `users` | `FhirCareTeamService` | |
| Goal | `goal` (LBF) | `FhirGoalService` | |
| DiagnosticReport (lab) | `procedure_result` + `documents` | `FhirDiagnosticReportService` | Category token = `LAB` |
| DiagnosticReport (note) | `documents` | `FhirDiagnosticReportService` | Category token = `clinical-note` |
| DocumentReference | `documents` + `categories` | `FhirDocumentReferenceService` | The `/fhir/DocumentReference/$docref` op generates a CCDA reference on the fly |
| Questionnaire | `questionnaire_repository` | `FhirQuestionnaireService` | |
| QuestionnaireResponse | `questionnaire_response` | `FhirQuestionnaireResponseService` | |
| Practitioner | `users` (where `is_practitioner = 1`) | `FhirPractitionerService` / `PractitionerService` | |
| PractitionerRole | `users` × `facility` × role | `FhirPractitionerRoleService` | |
| Organization | `facility` | `FhirOrganizationService` / `FacilityService` | |
| Location | `facility` (location rows) | `FhirLocationService` | |
| Coverage | `insurance_data` | `FhirCoverageService` / `InsuranceService` | |
| Device | `device_data` (UDI via `extension_observation`) | `FhirDeviceService` | |
| Specimen | `procedure_specimen` | `FhirSpecimenService` | |
| Provenance | (cross-cutting) | `FhirProvenanceService` | Audit trail on writes |
| Person | `users` (non-practitioner) | `FhirPersonService` | |
| RelatedPerson | `patient_data.related_person_*` | `FhirRelatedPersonService` | |
| ServiceRequest | `procedure_order` (when not yet completed) | `FhirServiceRequestService` | |
| Media | `documents` (image MIME types) | `FhirMediaService` | |
| Appointment | `openemr_postcalendar_events` | `FhirAppointmentRestController` | Uses `AppointmentService` |
| Group | `patient_data` aggregates by care team / roster | `FhirGroupService` | Used for `$export` group scoping |
| ValueSet | `list_options`, `code_types` | `FhirValueSetService` | Static $expand results |

The mapping is one-way: every FHIR read/search consults these tables.
Writes (POST/PUT) parse the FHIR payload back into the same
table layout in `parseFhirResource()` and call `insertOpenEMRRecord()`
/`updateOpenEMRRecord()`.

## Search parameter column mapping

Search parameters defined in each `loadSearchParameters()` map FHIR
parameter names to one or more OpenEMR columns (or `ServiceField`
objects for UUID columns). The `SearchFieldFactory` does the actual
SQL construction.

| Resource | FHIR param | OpenEMR column(s) | Type |
|----------|-----------|------------------|------|
| Patient | `_id` | `patient_data.uuid` (via `getPatientContextSearchField`) | TOKEN |
| Patient | `identifier` | `patient_data.ss`, `patient_data.pubpid` | TOKEN |
| Patient | `name` | `patient_data.fname`, `mname`, `lname`, `title` | STRING |
| Patient | `family` | `lname` | STRING |
| Patient | `given` | `fname`, `mname` | STRING |
| Patient | `birthdate` | `DOB` | DATE |
| Patient | `gender` | `sex` | TOKEN |
| Patient | `address` | `street`, `street_line_2`, `postal_code`, `city`, `state`, `contact_address_*` | STRING |
| Patient | `address-city` | `city`, `contact_address_city` | STRING |
| Patient | `address-postalcode` | `postal_code`, `contact_address_postal_code` | STRING |
| Patient | `address-state` | `state`, `contact_address_state` | STRING |
| Patient | `email` | `email`, `email_direct` | TOKEN |
| Patient | `phone` | `phone_home`, `phone_biz`, `phone_cell` | TOKEN |
| Patient | `telecom` | `email`, `email_direct`, `phone_home`, `phone_biz`, `phone_cell` | TOKEN |
| Patient | `_lastUpdated` | `last_updated` | DATETIME |
| Patient | `generalPractitioner` | `provider_uuid` (REFERENCE) | REFERENCE |
| Encounter | `_id` | `form_encounter.uuid` | TOKEN |
| Encounter | `patient` | `form_encounter.pid` (via `getPatientContextSearchField`) | REFERENCE |
| Encounter | `date` | `form_encounter.date` | DATETIME |
| Encounter | `status` | `form_encounter.encounter_status_code` (mapped to FHIR `finished` etc.) | TOKEN |
| Condition | `_id` | `lists.uuid` (via `condition_uuid` ServiceField) | TOKEN |
| Condition | `patient` | `lists.pid` | REFERENCE |
| Condition | `category` | Dispatched across the three sub-services | TOKEN |
| AllergyIntolerance | `patient` | `lists.pid` | REFERENCE |
| AllergyIntolerance | `clinical-status` | `lists.clinical_status` | TOKEN |
| Observation | `patient` | `extension_observation.pid` | REFERENCE |
| Observation | `category` | `extension_observation.category_code` | TOKEN |
| Observation | `code` | `extension_observation.code` | TOKEN |
| Observation | `date` | `extension_observation.effectivetime` | DATETIME |
| MedicationRequest | `patient` | `prescriptions.patient_id` | REFERENCE |
| MedicationRequest | `status` | `prescriptions.active` (mapped to `active`/`completed`/`stopped`) | TOKEN |
| MedicationRequest | `intent` | `prescriptions.intent_code` (default `order`) | TOKEN |
| Procedure | `patient` | `procedure_order.patient_id` | REFERENCE |
| Procedure | `date` | `procedure_order.date_ordered` | DATETIME |
| Procedure | `status` | `procedure_order.procedure_order_status` | TOKEN |
| Immunization | `patient` | `immunizations.patient_id` | REFERENCE |
| Immunization | `date` | `immunizations.administered_date` | DATE |
| CarePlan | `patient` | `rule_action_category.pid` | REFERENCE |
| CarePlan | `status` | `rule_action_category.activity` (mapped) | TOKEN |
| Goal | `patient` | `goal.pid` | REFERENCE |
| Goal | `lifecycle-status` | `goal.status` | TOKEN |
| DiagnosticReport | `patient` | `procedure_result.patient_id` (lab) or `documents.pid` (note) | REFERENCE |
| DiagnosticReport | `category` | Dispatches to lab vs note sub-service | TOKEN |
| DiagnosticReport | `date` | `procedure_result.date_observed` / `documents.create_date` | DATETIME |
| DocumentReference | `patient` | `documents.pid` | REFERENCE |
| DocumentReference | `category` | `documents.category` (LOINC code) | TOKEN |
| DocumentReference | `type` | `documents.doc_type` (LOINC) | TOKEN |
| DocumentReference | `date` | `documents.create_date` | DATE |
| Practitioner | `_id` | `users.uuid` (via practitioner filter) | TOKEN |
| Practitioner | `identifier` | `users.username`, `users.npi`, `users.federaltaxid` | TOKEN |
| Practitioner | `name` | `users.fname`, `users.lname` | STRING |
| PractitionerRole | `practitioner` | `users.uuid` | REFERENCE |
| PractitionerRole | `organization` | `facility.id` | REFERENCE |
| Organization | `_id` | `facility.uuid` | TOKEN |
| Organization | `name` | `facility.name` | STRING |
| Location | `_id` | `facility.uuid` (location rows only) | TOKEN |
| Location | `name` | `facility.name` | STRING |
| Coverage | `patient` | `insurance_data.pid` | REFERENCE |
| Coverage | `payor` | `insurance_data.provider` (joined to `insurance_companies`) | REFERENCE |
| Coverage | `type` | `insurance_data.plan_name` | TOKEN |
| Appointment | `patient` | `openemr_postcalendar_events.pc_pid` | REFERENCE |
| Appointment | `date` | `openemr_postcalendar_events.pc_eventDate` | DATE |
| Group | `_id` | Computed UUID for the Group resource | TOKEN |
| Group | `member` | `patient_data.pid` (only patients matching the group filter) | REFERENCE |
| Questionnaire | `patient` | `questionnaire_response.pid` | REFERENCE |
| QuestionnaireResponse | `questionnaire` | `questionnaire_response.questionnaire_id` | REFERENCE |

`getPatientContextSearchField()` is the cross-cutting helper that
binds the FHIR `patient` search param to the access token's patient
UUID. It is set up in `PatientSearchTrait` and inherited by every
service that implements `IPatientCompartmentResourceService`.

## Example: `FhirPatientService::parseOpenEMRRecord`

`src/Services/FHIR/FhirPatientService.php:195` is the canonical
"build a FHIR resource from a row" example:

```php
public function parseOpenEMRRecord($dataRecord = [], $encode = false)
{
    $patientResource = new FHIRPatient();

    // 1. resource identity / metadata
    $meta = new FHIRMeta();
    $meta->setVersionId('1');
    $meta->setLastUpdated($this->formatLastUpdatedTime($dataRecord['last_updated']));
    $meta->addProfile(self::USCGI_PROFILE_URI);
    $patientResource->setMeta($meta);

    // 2. narrative (text div for human readers)
    $text = ... ; $patientResource->setText($text);

    // 3. identifiers (MRN + SSN)
    $id = new FHIRId();
    $id->setValue($dataRecord['uuid']);
    $patientResource->setId($id);

    $identifier = new FHIRIdentifier();
    $identifier->setSystem('urn:oid:2.16.840.1.113883.4.1');
    $identifier->setValue($dataRecord['ss']);
    $patientResource->addIdentifier($identifier);

    // 4. name (HumanName — use official + given + family)
    $name = new FHIRHumanName();
    $name->setUse(FHIRIdentifierUse::OFFICIAL);
    $name->addGiven($dataRecord['fname']);
    $name->addGiven($dataRecord['mname']);
    $name->setFamily($dataRecord['lname']);
    $patientResource->addName($name);

    // 5. gender
    $genderCode = new FHIRCode($this->mapAdministrativeGender($dataRecord['sex']));
    $adminGender = new FHIRAdministrativeGender();
    $adminGender->setValue($genderCode);
    $patientResource->setGender($adminGender);

    // 6. birth date
    $birthDate = new FHIRDateTime();
    $birthDate->setValue($dataRecord['DOB']);
    $patientResource->setBirthDate($birthDate);

    // 7. address(es)
    $address = ... ; $patientResource->addAddress($address);

    // 8. telecom
    foreach (['phone_home', 'phone_biz', 'phone_cell', 'email'] as $field) {
        if (!empty($dataRecord[$field])) { ... add telecom ... }
    }

    // 9. US Core extensions
    $race = $this->buildRaceExtension($dataRecord);
    if ($race) $patientResource->addExtension($race);

    $ethnicity = $this->buildEthnicityExtension($dataRecord);
    if ($ethnicity) $patientResource->addExtension($ethnicity);

    $birthSex = $this->buildBirthSexExtension($dataRecord);
    if ($birthSex) $patientResource->addExtension($birthSex);

    // 10. communication language
    $communication = $this->buildCommunication($dataRecord);
    if ($communication) $patientResource->addCommunication($communication);

    return $patientResource;
}
```

The reverse direction, `parseFhirResource()`, is symmetric — it walks
the same fields in reverse, applying US Core constraints (e.g. must
have a name, gender, identifier).

## Example: `FhirEncounterService::parseOpenEMRRecord`

`src/Services/FHIR/FhirEncounterService.php` is the encounter
parser. Highlights:

- `Encounter.status` is derived from `form_encounter.encounter_status_code`
  (or the `last_level_closed` flag for finished visits).
- `Encounter.class` is a `Coding` with system
  `http://terminology.hl7.org/CodeSystem/v3-ActCode` and code
  `AMB` (ambulatory) for outpatient visits.
- `Encounter.type` uses the OpenEMR `pc_catid` joined to the
  `openemr_postcalendar_categories` table to produce a SNOMED-CT or
  custom code.
- `Encounter.subject` is a `Reference` to the patient.
- `Encounter.participant` is built from `users` joined by
  `form_encounter.provider_id`, using
  `FHIREncounterParticipant::PARTICIPANT_TYPE_PRIMARY_PERFORMER` (PPRF).
- `Encounter.period.start` / `period.end` are the visit's
  `date` and `last_level_closed` respectively.
- `Encounter.location` is a `Reference` to the `Facility` resource
  keyed by `form_encounter.facility_id`.

US Core extensions like `Encounter.location.location.reference` and the
`Encounter.hospitalization` sub-element (for inpatient encounters) are
populated when the relevant fields are present.

## Example: `FhirConditionService` — three sub-services

`FhirConditionService` is a *composite* of three inner services:

| Category code | Service | Source data |
|---------------|---------|-------------|
| `encounter-diagnosis` | `FhirConditionEncounterDiagnosisService` | `form_encounter` billing codes |
| `problem-list-item` | `FhirConditionProblemListItemService` | `lists` where `type='medical_problem'` |
| `health-concern` | `FhirConditionHealthConcernService` | `lists` where `type='health_concern'` |

When a search request includes `category=<code>`, only the matching
sub-service is invoked. When `category` is missing, all three are
queried and their results are merged in `FhirConditionService::getAll()`
via `MappedServiceCodeTrait` + `getServiceListForCategory()`.

Each sub-service implements `parseOpenEMRRecord()` against its own
table layout. The composite is a US Core requirement: every
`Condition` must carry a `category` code from the prescribed
CodeSystem, and OpenEMR stores the three categories in three
different tables.

## US Core 8.0 element coverage notes

US Core 8.0 (released in 2024, with 8.0.0 ballot) adds:

- A native `Coverage` profile with `Coverage.class` and
  `Coverage.identifier` MUST-supports.
- A new `QuestionnaireResponse` profile with `item.answer.value[x]`
  type slicing.
- A new `Specimen` profile that requires a `type`.
- Refinements to `MedicationRequest.dosageInstruction.timing` and the
  `MedicationRequest.dispenseRequest` MUST-supports.
- New `Observation` profile for SDOH (`us-core-observation-sdoh`).

OpenEMR's services implement these via the `VersionedProfileTrait`,
which adds version-specific element shaping. The `parseOpenEMRRecord`
methods branch on the `VersionedProfileTrait::getProfileVersion()`
to either include or skip the version-8 element. The version is
negotiated at request time via the `Accept` profile parameter (e.g.
`application/fhir+json; profile=http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient|8.0.0`).

For an exhaustive per-element checklist, the source of truth is
`VersionedProfileTrait::getVersionedProfileElements()` in
`src/Services/FHIR/Traits/VersionedProfileTrait.php`.

## See also

- `doc/api/fhir-api.md` — API surface and controllers
- `doc/api/bulk-export.md` — How `Fhir*Service::getAll()` powers
  `$export`
- `doc/interop/smart-on-fhir.md` — Launch context that flows into
  the patient compartment binding
- `doc/interop/ccda.md` — `$docref` and CCDA generation
