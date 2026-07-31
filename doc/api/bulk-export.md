# OpenEMR Bulk Data Export

OpenEMR implements the SMART Bulk Data Access v2.2 specification
(`hl7.org/fhir/uv/bulkdata/`). Two operations are exposed:

- `$export` — kick off an export job. Returns 202 + `Content-Location`.
- `$bulkdata-status` — poll the status of a running or completed job
  and retrieve the manifest or kick off a delete.

- Source root: `openemr-reference/src/FHIR/Export/`
- Source root: `openemr-reference/src/Services/FHIR/FhirExportJobService.php`
- Source root: `openemr-reference/src/Services/FHIR/FhirExportServiceLocator.php`
- Source root: `openemr-reference/src/RestControllers/FHIR/Operations/FhirOperationExportRestController.php`
- Spec: <https://hl7.org/fhir/uv/bulkdata/2.0.0/>

## Table of contents

- [Supported export scopes](#supported-export-scopes)
- [Endpoint inventory](#endpoint-inventory)
- [`$export` lifecycle](#export-lifecycle)
- [`ExportJob` model](#exportjob-model)
- [Status, output, and timing](#status-output-and-timing)
- [`ExportStreamWriter` (NDJSON to file)](#exportstreamwriter-ndjson-to-file)
- [Asynchronous execution + 202 response](#asynchronous-execution--202-response)
- [Output format negotiation (`Accept` / `_outputFormat`)](#output-format-negotiation)
- [Service locators](#service-locators)
- [Manifest file format](#manifest-file-format)
- [Deletion via `DELETE` on status](#deletion-via-delete-on-status)
- [Audit and security](#audit-and-security)

## Supported export scopes

`ExportJob` declares three `EXPORT_OPERATION_*` types:

- `EXPORT_OPERATION_SYSTEM` (`System`) — full-fleet export, no patient
  filter.
- `EXPORT_OPERATION_GROUP` (`Group`) — export only the patients in a
  FHIR `Group` resource.
- `EXPORT_OPERATION_PATIENT` (`Patient`) — export a single patient
  (`/fhir/Patient/{id}/$export`).

The route file binds all three:

```php
// apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php
"GET /fhir/$export"                  => $exportController->processExport(...),
"GET /fhir/Patient/$export"          => $exportController->processExport(...),
"GET /fhir/Group/{id}/$export"       => $exportController->processExport(...),
```

## Endpoint inventory

| Method + path | Purpose | Handler |
|---------------|---------|---------|
| `GET /fhir/$export` | System-level export | `FhirOperationExportRestController::processExport` |
| `GET /fhir/Patient/$export` | Bulk export all patients (or filtered by `patient` query) | same |
| `GET /fhir/Group/{id}/$export` | Export members of a Group | same |
| `GET /fhir/$bulkdata-status` | Poll status / download manifest | `FhirOperationExportRestController::processStatus` |
| `DELETE /fhir/$bulkdata-status` | Delete an export job | same |

`FhirOperationExportRestController` is the single controller for all
five endpoints; the operation and export-type are pulled from the
route by the `RoutesExtensionListener` and stored on
`HttpRestRequest::setOperation()`.

## `$export` lifecycle

```
       client                                  server
         |                                       |
         |  GET /fhir/$export?type=Patient       |
         |  Prefer: respond-async               |
         |-------------------------------------->|
         |                                       |  1. validateHeaders
         |                                       |  2. createExportJob
         |                                       |  3. enqueue async work
         |  202 Accepted                         |
         |  Content-Location: /fhir/$bulkdata-status?job=<id>
         |<--------------------------------------|
         |                                       |
         |  GET /fhir/$bulkdata-status?job=<id>  |
         |-------------------------------------->|
         |                                       |  load job, check status
         |  200 OK                               |
         |  { "transactionTime": "...",          |
         |    "request": "...",                  |
         |    "requiresAccessToken": true,       |
         |    "output": [                        |
         |      { "type": "Patient.ndjson",     |
         |        "url": "https://.../file.ndjson" }, ...
         |    ],                                 |
         |    "error": [] }                      |
         |<--------------------------------------|
         |                                       |
         |  GET <file url>  (or DELETE for cleanup)
```

## `ExportJob` model

`src/FHIR/Export/ExportJob.php` is the persisted job record (the
underlying table is `ExportJob`; schema in `sql/database.sql`). Fields
worth highlighting:

| Field | Type | Meaning |
|-------|------|---------|
| `id` | int | Primary key |
| `uuid` | binary | Job UUID (binary); `.getUuidString()` returns the 36-char form |
| `startTime` | DateTime | When the job was created |
| `resourceIncludeTime` | DateTime | `_since` cursor — only resources with `meta.lastUpdated > includeTime` are exported |
| `outputFormat` | string | One of `OUTPUT_FORMAT_FHIR_NDJSON`, `OUTPUT_FORMAT_APPLICATION_NDJSON`, `OUTPUT_FORMAT_NDJSON`, `OUTPUT_FORMAT_NDJSON_SHORT` |
| `resources` | string[] | FHIR resource types to include (e.g. `['Patient', 'Observation']`) |
| `clientId` | string | OAuth2 client id that started the job |
| `userId` | string | OpenEMR user UUID that started the job |
| `requestURI` | string | Original `$export` URL (reproduced in the status response `request` field) |
| `output` | string | JSON-encoded list of output file descriptors |
| `errors` | string | JSON-encoded list of resource-level export errors |
| `status` | string | `STATUS_PROCESSING` or `STATUS_COMPLETED` |
| `accessTokenId` | string | Access token id of the original request (used to verify the polling request is the same client) |
| `apiBaseUrl` | string | Base API URL captured at job creation |
| `groupId` | string | Group UUID for group-scope exports |
| `exportType` | string | One of `System`, `Group`, `Patient` |
| `patientUuidsToExport` | string[] | Restricts the export to specific patient UUIDs |

`ExportJob::STATUS_REPORT_PREFIX = '/fhir/$bulkdata-status?job='` is
the prefix used in `Content-Location` headers.

## Status, output, and timing

The controller in `FhirOperationExportRestController` is bounded by
two constants:

```php
const MAX_EXPORT_TIME_INTERVAL = "PT30S";   // 30 seconds per pass
const MAX_DOCUMENT_ACCESS_TIME = "PT1H";    // output files are kept for 1 hour
```

`MAX_EXPORT_TIME_INTERVAL` is the per-pass shutdown timer. The
export job is written to the database and the actual resource
serialization happens in the background, but the synchronous
`processExport` method only runs until the first
`ExportWillShutdownException` is thrown. The poller picks up where
the previous pass left off using the `lastProcessedId` field stored on
the `ExportStreamWriter`.

`MAX_DOCUMENT_ACCESS_TIME` is the retention window — output NDJSON
files older than 1 hour are eligible for cleanup (the actual cleanup
is run by a scheduled task in the admin cron job).

## `ExportStreamWriter` (NDJSON to file)

`src/FHIR/Export/ExportStreamWriter.php` wraps a PHP `fopen` stream
and writes FHIR resources as NDJSON:

- `append(FHIRResource $resource)` — encodes the resource, writes a
  single line, increments `recordsWritten`, records `lastProcessedId`.
- After every append it checks `willShutdown()` (now >
  `shutdownTime`); if so it throws `ExportWillShutdownException` so
  the outer loop can persist the cursor and return.
- Errors during JSON encoding are wrapped in
  `ExportCannotEncodeException`. Generic errors in
  `ExportException`.

`ExportMemoryStreamWriter` is the in-memory equivalent used for tests.

The writer is wrapped by `FhirExportJobService` and `FhirResourcesService`
to walk each `Fhir*Service` that implements `IFhirExportableResourceService`,
fetch records using the service's `getAll()` with the `_since` filter
and any `patient`/`group` constraints, and serialize each row through
the service's `parseOpenEMRRecord()` before handing the FHIR resource
to the writer.

## Asynchronous execution + 202 response

The `$export` request is *immediately* answered with 202 Accepted and a
`Content-Location` header pointing at the status URL:

```php
// FhirOperationExportRestController::processExport
$response = $this->createResponseForCode(StatusCode::ACCEPTED);
$response = $response->withHeader(
    'Content-Location',
    $this->buildContentLocationHeader($job->getUuidString())
);
```

The actual export runs in the same PHP request after the response is
queued — the controller schedules the writer loop, then returns. The
client polls `$bulkdata-status` until the status is `completed`. The
`X-Progress` header on the status response is also updated as the job
runs.

`Prefer: respond-async` is required — the controller's
`validateHeaders()` throws a 400 if it's missing or set to anything
else.

`Accept` must be `application/fhir+json` (the
`ACCEPT_HEADER_OPERATION_OUTCOME` constant) so that error responses
are valid FHIR `OperationOutcome` resources.

## Output format negotiation

| Client request | Result |
|----------------|--------|
| `_outputFormat=application/fhir+ndjson` | NDJSON with FHIR resources |
| `_outputFormat=application/ndjson` | NDJSON, same wire format (compat alias) |
| `_outputFormat=ndjson` | Same |
| `_outputFormat` missing | Default to `application/fhir+ndjson` |
| `_since=<FHIR instant>` | Skip resources whose `meta.lastUpdated` is ≤ since |

The default `OUTPUT_FORMAT_FHIR_NDJSON` is the only fully-tested format
at the moment. The other two are accepted for interop with clients
that hardcode the older `application/ndjson` media type.

## Service locators

`FhirExportServiceLocator` (`src/Services/FHIR/FhirExportServiceLocator.php`)
is constructed per-request and stashed on the request as
`attributes[_serviceLocator]`. It owns:

- A map of resource-type → `FhirServiceBase` (one per exportable
  resource).
- The set of resources eligible for the current job (filtered by
  `_type` and the export scope).

The export controller reads it via:

```php
$serviceLocator = $this->request->attributes->get('_serviceLocator');
if (!$serviceLocator instanceof FhirServiceLocator) {
    throw new \InvalidArgumentException(
        'FhirServiceLocator must be set in the request attributes'
    );
}
```

The factory that produces the locator lives in
`src/Services/FHIR/Utils/FhirServiceLocator.php` and is wired up in
the `RoutesExtensionListener` before the route callback is invoked.

## Manifest file format

The `output` array on a completed job follows the Bulk Data v2
manifest shape:

```json
{
  "transactionTime": "2026-06-11T10:15:00Z",
  "request": "https://hms.example/fhir/$export?type=Patient,Observation",
  "requiresAccessToken": true,
  "output": [
    {
      "type": "Patient.ndjson",
      "url":   "https://hms.example/fhir/documents/<job-uuid>/Patient.ndjson"
    },
    {
      "type": "Observation.ndjson",
      "url":   "https://hms.example/fhir/documents/<job-uuid>/Observation.ndjson"
    }
  ],
  "error": []
}
```

`error` is a list of `OperationOutcome` issues when some resources
failed to export. Individual resource failures do not fail the whole
job.

## Deletion via `DELETE` on status

`DELETE /fhir/$bulkdata-status?job=<id>` deletes the export job
row, removes the per-resource NDJSON files, and returns 204 No
Content. The behavior is implemented in
`FhirOperationExportRestController::deleteJob`. The job is only
deletable by the OAuth2 client that created it — the
`accessTokenId` is checked.

## Audit and security

- Every `$export` request requires a system-role bearer token. The
  `rest_system_scopes_api` global must be enabled
  (`FhirOperationExportRestController` constructor sets
  `$this->isExportDisabled = $globalsBag->getInt('rest_system_scopes_api', 0) === 0`
  and refuses if disabled).
- `event` table is populated via `EventAuditLogger` for job creation
  and deletion.
- The output files are stored under
  `documents/<FHIR_DOCUMENT_FOLDER>/<job-uuid>/<resource>.ndjson`
  (the `FHIR_DOCUMENT_FOLDER` constant in the controller). ACL on
  the document category is `FHIR_DOCUMENT_CATEGORY = 'FHIR Export Document'`
  to keep the files out of the standard patient-document view.
- The `Prefer: respond-async` and `Accept: application/fhir+json`
  headers are required; an invalid pair returns an `OperationOutcome`
  with severity `error` and code `not-supported`.

## See also

- `doc/api/fhir-api.md` — FHIR R4 / US Core 8.0 surface
- `doc/api/oauth2-and-smart.md` — Backend Services grant that issues
  the system-role tokens required for `$export`
- `doc/interop/fhir-r4.md` — Per-resource coverage
- `doc/interop/ccda.md` — `$docref` is the per-patient cousin of `$export`
