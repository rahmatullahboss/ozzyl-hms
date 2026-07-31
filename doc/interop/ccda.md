# OpenEMR CCDA (C-CDA) Generation

OpenEMR generates Consolidated Clinical Document Architecture (C-CDA)
documents for USCDI v1 / v2 export and for patient portal downloads.
The generation service is a separate Node.js process invoked from
PHP, and it has tight integration with the FHIR `$docref` operation.

- Source root: `openemr-reference/ccdaservice/`
- Source root: `openemr-reference/src/Services/CDADocumentService.php`
- Source root: `openemr-reference/src/RestControllers/FHIR/Operations/FhirOperationDocRefRestController.php`
- Source root: `openemr-reference/src/Services/FHIR/FhirDocRefService.php`
- Spec: HL7 C-CDA R2.1, USCDI v1/v2, ONC §170.315(b)(1)/(b)(2)/(g)(6).

## Table of contents

- [`ccdaservice/` module layout](#ccdaservice-module-layout)
- [PHP → Node boundary: `ccda_gateway.php`](#php--node-boundary-ccda_gatewayphp)
- [Generation entry points](#generation-entry-points)
- [How CCDA gets generated for a patient](#how-ccda-gets-generated-for-a-patient)
- [The `$docref` FHIR operation](#the-docref-fhir-operation)
- [LOINC 34133-9 (Summary of Episode Note)](#loinc-34133-9-summary-of-episode-note)
- [CCDA sections mapped to OpenEMR data](#ccda-sections-mapped-to-openemr-data)
- [Encoding and signing](#encoding-and-signing)
- [Audit and access control](#audit-and-access-control)

## `ccdaservice/` module layout

`ccdaservice/` is a self-contained Node.js service that runs on
demand (not as a long-lived daemon). It is composed of three
first-party submodules plus a couple of utility packages:

| Subdirectory | Purpose |
|--------------|---------|
| `ccda_gateway.php` | The PHP endpoint the rest of OpenEMR hits. Validates auth, then shells out to the Node service over HTTP. |
| `serveccda.js` | The Node entry point. Spins up a small Express server, validates the CSRF token, and dispatches generation requests. |
| `oe-blue-button-generate/` | The actual C-CDA template engine. Walks the patient data and produces XML. |
| `oe-blue-button-meta/` | C-CDA section metadata (LOINC codes, OIDs, value-set URLs). |
| `oe-blue-button-util/` | XML escaping, date formatting, and other small helpers. |
| `data-stack/` | Database query layer for the patient data. Wraps SQL calls used during generation. |
| `utils/` | Misc utility functions used by the generator. |
| `packages/` | Local npm packages shared between the submodules. |
| `package.json` / `package-lock.json` | npm dependency management. |
| `README.md` | Install / configure instructions. |

The PHP ↔ Node boundary uses HTTP (Express server bound to
`127.0.0.1` on a high port — typically `6661`) so the Node process
can be spawned and torn down per request. PHP makes the call via
`CDADocumentService` (in `src/Services/CDADocumentService.php`) which
in turn talks to `ccda_gateway.php` over the local socket.

## PHP → Node boundary: `ccda_gateway.php`

`ccda_gateway.php` is the PHP endpoint the Node service expects.
It accepts a CSRF token (`csrf_token_form`) and an `action` query
parameter:

| `action` value | Effect |
|---------------|--------|
| `dl` / `report_ccd_download` | Returns a ZIP containing the C-CDA XML and a human-readable HTML version |
| `view` / `report_ccd_view` | Returns the human-readable HTML |
| `report_ccd_download_raw` | Returns the raw XML only |
| `report_ccd_validate` | Validates the generated XML against a schematron and returns the validation report |

The first thing the gateway does is figure out the caller's identity:

- If the request comes from the patient portal (the
  `patient_portal_onsite_two` session flag is set), the patient pid is
  read from the session.
- Otherwise the provider's `authUserID` is used.

The gateway then builds a request to the Node service with the pid
and the action. The Node service produces the document and returns
it. The PHP gateway either:

- Streams the file back to the browser (`Content-Type: application/zip`
  for downloads, `text/html` for views), or
- Saves the file to a documents category for the patient (`category =
  'CCDA'`) and returns a path.

## Generation entry points

OpenEMR exposes the C-CDA generator through three call sites:

1. **Patient portal** — `portal/home.php` shows a "Clinical Documents"
   card. Clicking it makes an AJAX call to the gateway with `action=view`,
   which renders the human-readable HTML inline.
2. **Carecoordination module** — the Carecoordination Module (a separate
   OpenEMR module under `interface/modules/zend_modules/module/Carecoordination`)
   downloads a ZIP of the CCDA + HTML using `action=dl`. This is the
   path used by third-party CQM / QRDA submission tooling.
3. **FHIR `$docref` operation** — a SMART app or a provider-side
   integration can call `POST /fhir/DocumentReference/$docref` to get a
   FHIR `DocumentReference` resource pointing at a freshly generated
   C-CDA document (see below).

The `CDADocumentService` (`src/Services/CDADocumentService.php`) is the
single PHP class that wraps the gateway. Its methods:

- `generateCCD($pid)` — returns the raw XML string.
- `generateCCDHtml($pid)` — returns the human-readable HTML string.
- `generateCCDZip($pid)` — returns a `ZipArchive` containing
  `ccd.xml`, `ccd.html`, and a metadata `manifest.json`.

## How CCDA gets generated for a patient

End-to-end flow when a user clicks "Download CCD" from the portal:

1. Portal JS posts to `ccda_gateway.php?action=dl&csrf_token_form=...`.
2. Gateway validates CSRF, resolves the pid from the session, sets
   `IS_PORTAL` to the pid.
3. Gateway requires `interface/globals.php` (which sets up DB globals).
4. `CDADocumentService::generateCCDZip($pid)` is called.
5. The service makes an HTTP POST to `http://127.0.0.1:6661/generate-ccd`
   with a JSON body `{ "pid": <pid>, "format": "zip" }`.
6. The Node `serveccda.js` handler invokes
   `oe-blue-button-generate` with the patient data pulled from
   `data-stack`.
7. The generated XML is written to a temp file. The HTML rendering
   (Blue Button's auto-generated `<text>` narrative) is produced
   alongside it.
8. The Node service returns the path; the PHP gateway reads the file
   and either returns it as a download or stores it in the documents
   table.

The Node process is started on demand by the PHP gateway when needed
and torn down after the request. (See `README.md` in `ccdaservice/`
for the full lifecycle and the npm install steps.)

## The `$docref` FHIR operation

`POST /fhir/DocumentReference/$docref` is the SMART / US Core way to
ask the server to produce a clinical document on the fly. The OpenEMR
implementation lives in
`FhirOperationDocRefRestController::getAll($searchParams, $puuidBind)`.

`searchParams` (from the URL query string) supports:

| Param | Type | Meaning |
|-------|------|---------|
| `patient` | UUID | The patient the document is for. Required. |
| `start` | FHIR dateTime | Lower bound of care date range. |
| `end` | FHIR dateTime | Upper bound of care date range. |
| `type` | LOINC code | Document type. Currently only `34133-9` (Summary of Episode Note) is supported. |

The controller calls `FhirDocRefService::getAll($searchParams, $puuidBind)`.
The service:

1. Resolves the `puuid` to a `pid` via `UuidRegistry`.
2. Invokes `CDADocumentService` to generate the CCDA XML and HTML
   (using the same Node path as the portal).
3. Saves the resulting document under the patient with
   `category = 'CCDA'` and `doc_type = 34133-9` (LOINC).
4. Builds a `FHIRDocumentReference` resource with the URL pointing at
   the saved document (`<apiBase>/fhir/Binary/<doc-id>`).
5. Returns a FHIR `Bundle` of `DocumentReference` resources.

The controller wraps the result in a `Bundle` and returns 200 OK.
The `DocumentReference.content.attachment.url` is the URL the client
hits to download the actual CCDA bytes.

## LOINC 34133-9 (Summary of Episode Note)

LOINC code **34133-9** ("Continuity of Care Document") is the
USCDI v1 / v2 default for a Summary of Episode Note. The C-CDA
document OpenEMR generates is a level-3 C-CDA conforming to that
LOINC code.

The CCDA template includes the following required sections (per
ONC §170.315(b)(1)):

| Section | LOINC code | OpenEMR source |
|---------|-----------|---------------|
| Allergies and Adverse Reactions | 48765-2 | `lists` where `type='allergy'` |
| Medications | 10160-0 | `prescriptions` (active) |
| Problems | 11450-4 | `lists` where `type='medical_problem'` |
| Results (Lab) | 30954-2 | `procedure_result` + observations |
| Vital Signs | 8716-3 | `vital_signs` |
| Immunizations | 11369-6 | `immunizations` |
| Procedures | 47519-4 | `procedure_order` |
| Encounters | 46240-8 | `form_encounter` |
| Social History | 29762-2 | `history_data` |
| Plan of Care | 18776-5 | `rule_action_category` |
| Functional Status | 47420-5 | (extension observation) |
| Goals | 61146-7 | `goal` LBF |
| Health Concerns | 11383-7 | `lists` where `type='health_concern'` |
| Assessment and Plan | 51847-2 | LBF data |
| Reason for Referral | 42349-1 | (referral source on encounter) |
| Discharge Medications | 10183-2 | (last medications on closed encounter) |

The C-CDA `<entryRelationship>` for each section is a FHIR-style
reference to the underlying FHIR resource, so the C-CDA and the
FHIR API stay in sync.

## CCDA sections mapped to OpenEMR data

The C-CDA `oe-blue-button-generate` package builds each section from
OpenEMR rows:

| Section | Source query (high level) |
|---------|---------------------------|
| Allergies | `SELECT * FROM lists WHERE pid=? AND type='allergy'` |
| Medications | `SELECT * FROM prescriptions WHERE patient_id=? AND active=1` |
| Problems | `SELECT * FROM lists WHERE pid=? AND type='medical_problem'` |
| Results | `SELECT * FROM procedure_result WHERE patient_id=? AND date_observed BETWEEN ? AND ?` |
| Vitals | `SELECT * FROM form_vital WHERE pid=? AND date BETWEEN ? AND ?` |
| Immunizations | `SELECT * FROM immunizations WHERE patient_id=?` |
| Procedures | `SELECT * FROM procedure_order po JOIN procedure_report pr ON po.procedure_order_id=pr.procedure_order_id WHERE po.patient_id=?` |
| Encounters | `SELECT * FROM form_encounter WHERE pid=? AND date BETWEEN ? AND ?` |
| Social History | `SELECT * FROM history_data WHERE pid=?` |
| Plan of Care | `SELECT * FROM rule_action_category WHERE pid=? AND category='plan_of_care'` |
| Goals | `SELECT * FROM goal WHERE pid=? AND status='active'` |
| Health Concerns | `SELECT * FROM lists WHERE pid=? AND type='health_concern'` |
| Assessment and Plan | Encounter LBF rows |
| Discharge Medications | `prescriptions` whose encounter was the last closed one |

The generators are written as ES6 classes with `render(patientData)`
methods; each section has its own class. The master `Template` class
composes the section classes in the order required by the C-CDA
schema.

## Encoding and signing

- The default C-CDA encoding is **UTF-8 XML**.
- The `oe-schematron-service` (running on port 6662, mentioned in
  the `ccdaservice/README.md`) is invoked by `report_ccd_validate` to
  validate the generated XML against a published schematron rule set.
- Digital signatures (XDS-SD) are *not* generated by the default
  pipeline. To attach a digital signature, configure the
  `oe-cqm-service` or use an external HISP.
- The output ZIP file includes both the XML and a human-readable
  HTML version (the Blue Button `<text>` narrative), plus a
  `manifest.json` with the document metadata.

## Audit and access control

- The CCDA gateway logs every generation to the OpenEMR `log_validator`
  and `onsite_portal_activity` tables (when the call comes from the
  patient portal).
- Provider access to the gateway requires the `encounters` / `notes`
  ACL. The gateway does *not* bypass ACL.
- Patient access (portal) requires the patient to be logged in to
  the portal session; the pid is forced from the session, never from
  the URL.
- The CCDA service can be disabled site-wide via
  Admin → Config → Connectors → Enable C-CDA Service.
- The `$docref` operation uses the standard FHIR auth pipeline
  (Bearer token + SMART scope). It returns 401/403 the same way any
  other FHIR endpoint does.
- Generated documents stored under `category='CCDA'` are excluded
  from the standard patient document search results by default; they
  only appear in the CCDA-specific "Clinical Documents" portal card.

## See also

- `doc/api/fhir-api.md` — How the `$docref` operation is wired into
  the FHIR dispatcher
- `doc/api/bulk-export.md` — `$export` is the bulk-data sibling of
  `$docref`
- `doc/interop/smart-on-fhir.md` — How the SMART launch flow
  sometimes uses `$docref` to attach a CCD to a clinical-decision
  support app
- `doc/interop/portal-vs-api.md` — Why portal and FHIR are separate
  auth pipelines
