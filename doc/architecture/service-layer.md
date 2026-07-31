# Service Layer Pattern

> **Source paths:** `src/Services/BaseService.php`,
> `src/Services/BaseServiceInterface.php`, `src/Services/PatientService.php`,
> `src/Services/EncounterService.php`, `src/Services/AppointmentService.php`
> **Documented version:** OpenEMR 8.0.1-dev

The Service Layer is OpenEMR's primary abstraction over the database for
domain code. Every domain concept (Patient, Encounter, Allergy, Appointment,
Prescription, …) has a service class in `src/Services/` that extends
`OpenEMR\Services\BaseService`. This is mandated by the project's
`CLAUDE.md` and enforced by convention + PHPStan.

---

## 1. `BaseService` (abstract)

> Source: `src/Services/BaseService.php` (620 lines)

```php
namespace OpenEMR\Services;

class BaseService implements BaseServiceInterface
{
    private $fields;
    private $autoIncrements;
    private LoggerInterface $logger;
    private const PREFIXES = [
        'eq' => "=", 'ne' => "!=", 'gt' => ">", 'lt' => "<",
        'ge' => ">=", 'le' => "<=", 'sa' => "", 'eb' => "", 'ap' => ""
    ];
    private EventDispatcherInterface $eventDispatcher;
    private ?SessionInterface $session = null;

    public function __construct(
        private $table,
        ?LoggerInterface $logger = null,
    ) {
        $this->fields = QueryUtils::listTableFields($table);
        $this->autoIncrements = self::getAutoIncrements($this->table);
        $this->logger = $logger ?? ServiceContainer::getLogger();
        $this->eventDispatcher = OEGlobalsBag::getInstance()->getKernel()->getEventDispatcher();
    }
    // …
}
```

### 1.1 Constructor

The base constructor takes the **table name** and an optional
`LoggerInterface`. It eagerly:
- Calls `QueryUtils::listTableFields($table)` to load the column list.
- Calls `getAutoIncrements($table)` (via `SHOW COLUMNS WHERE extra LIKE '%auto_increment%'`)
  so the auto-increment columns can be skipped when building INSERT/UPDATE.
- Resolves the PSR-3 logger from `ServiceContainer::getLogger()`.
- Resolves the Symfony `EventDispatcherInterface` from the kernel.

The dispatcher is stored once and exposed via `getEventDispatcher()` /
`setEventDispatcher()`. Services can dispatch `Symfony\Contracts\EventDispatcher\Event`
subclasses to notify modules.

### 1.2 Interface

> Source: `src/Services/BaseServiceInterface.php`

```php
interface BaseServiceInterface
{
    public function getEventDispatcher(): EventDispatcherInterface;
    public function setEventDispatcher(EventDispatcherInterface $dispatcher);
    public function setSession(SessionInterface $session): void;
    public function getSession(): ?SessionInterface;
    public function getTable();
    public function getFields(): array;
    public function getSelectFields(string $tableAlias = '', string $columnPrefix = ""): array;
    public function getUuidFields(): array;
    public function getSelectJoinTables(): array;
    public function queryFields($map = null, $data = null);
    public function setLogger(LoggerInterface $logger);
    public function getLogger(): LoggerInterface;
    public function selectHelper($sqlUpToFromStatement, $map);
    public function search($search, $isAndCondition = true);
    public function getFreshId($idField, $table);
    public function filterData($data, $whitelistedFields = null);
    public static function throwException($message, $type = "Error");
    public static function isValidDate($dateString);
    public static function sqlCondition($condition);
    public static function getIdByUuid($uuid, $table, $field);
    public static function getUuidById($id, $table, $field);
    public static function processDateTime($date);
}
```

### 1.3 Methods provided by `BaseService`

| Method | Purpose |
|---|---|
| `getTable()` | The bound table name. |
| `getFields(): string[]` | Cached column list from `SHOW COLUMNS`. |
| `getSelectFields($alias='', $prefix=''): string[]` | Backtick-quoted, optionally aliased select fragments. |
| `getUuidFields(): string[]` | Subclass override: names of `BINARY(16)` UUID columns. |
| `getSelectJoinTables(): array` | Subclass override: list of join definitions. |
| `getSelectJoinClauses(): string` | Renders the join SQL. |
| `queryFields($map, $data)` | Build a basic `SELECT … FROM $this->table` with the map's where/joins. |
| `buildInsertColumns($data, $options)` | Returns `['set' => 'a = ?, b = ?', 'bind' => [1, 2]]` — skips auto-increments, normalizes NULL. |
| `buildUpdateColumns($data, $options)` | Same as buildInsertColumns but for UPDATE — additionally skips `uuid` and `pid` columns. |
| `selectHelper($sqlUpToFrom, $map)` | Shared `QueryUtils::selectHelper` wrapper. |
| `throwException($msg, $type)` | `throw new InvalidValueException($msg, $type)`. |
| `isValidDate($s)` | `bool (strtotime($s) !== false)`. |
| `sqlCondition($bool)` | Returns `' AND '` or `' OR '` for a boolean. |
| `getIdByUuid($uuid, $table, $field)` | `SELECT $field FROM $table WHERE uuid = ?` → ID. |
| `getUuidById($id, $table, $field)` | Reverse. |
| `processDateTime($date)` | Parse FHIR-style date prefixes (`eq2020-01-01` → `eq` + `2020-01-01`). |
| `getFreshId($idField, $table)` | `SELECT MAX(idField)+1` (legacy way to allocate IDs; avoid for new code). |
| `filterData($data, $whitelist = null)` | Array filter that keeps only whitelisted keys (defaults to `$this->getFields()`). |
| `search($search, $isAndCondition)` | FHIR-compatible search: builds a `WHERE` clause from `ISearchField[]` via `FhirSearchWhereClauseBuilder`. |
| `createResultRecordFromDatabaseResult($row)` | Hook for hydration — converts `BINARY(16)` UUID columns to strings via `UuidRegistry::uuidToString()`. |
| `addCoding($diagnosis)` | Splits a `;`-separated code string and looks up descriptions via `CodeTypesService`. |
| `splitAndProcessMultipleFields($fields, $table, $pk)` | Splits `|`-separated IDs and returns UUIDs. |
| `setLogger()` / `getLogger()` | PSR-3 logger injection. |
| `setEventDispatcher()` / `getEventDispatcher()` | Symfony dispatcher injection. |
| `setSession()` / `getSession()` | Optional session for context-aware services. |

### 1.4 The `search()` method — FHIR-compatible

The most important modern method is `search()`. It accepts a hashmap of
`ISearchField` objects and returns a `ProcessingResult`:

```php
public function search($search, $isAndCondition = true)
{
    $processingResult = new ProcessingResult();
    try {
        $selectFields = $this->getSelectFields();
        $selectFields = array_combine($selectFields, $selectFields);
        $from = [$this->getTable()];
        $sql = "SELECT " . implode(",", array_keys($selectFields))
             . " FROM " . implode(",", $from);
        $join = $this->getSelectJoinClauses();
        $whereFragment = FhirSearchWhereClauseBuilder::build($search, $isAndCondition);

        $selectHelperMap = [
            'join' => $join,
            'where' => $whereFragment->getFragment(),
            'data' => $whereFragment->getBoundValues(),
        ];
        $records = $this->selectHelper($sql, $selectHelperMap);

        if (!empty($records)) {
            foreach ($records as $row) {
                $resultRecord = $this->createResultRecordFromDatabaseResult($row);
                $processingResult->addData($resultRecord);
            }
        }
    } catch (SearchFieldException $exception) {
        $processingResult->setValidationMessages([$exception->getField() => $exception->getMessage()]);
    }

    return $processingResult;
}
```

`FhirSearchWhereClauseBuilder::build($search, $isAndCondition)` converts
an `ISearchField[]` hashmap to a parameterized SQL fragment. This is the
backbone of every FHIR / REST search endpoint.

### 1.5 Result hydration — UUID conversion

`createResultRecordFromDatabaseResult` is the hydration hook:

```php
protected function createResultRecordFromDatabaseResult($row)
{
    $uuidFields = $this->getUuidFields();
    if (empty($uuidFields)) {
        return $row;
    }
    foreach ($uuidFields as $fieldName) {
        if (isset($row[$fieldName])) {
            $row[$fieldName] = UuidRegistry::uuidToString($row[$fieldName]);
        }
    }
    return $row;
}
```

Subclasses override `getUuidFields()` to declare which columns hold
`BINARY(16)` UUIDs. UUIDs are stored as raw bytes in the database but
returned to clients as 36-char strings.

### 1.6 FHIR date prefix parsing

`processDateTime($date)` implements FHIR date prefixes:

```php
private const PREFIXES = [
    'eq' => "=", 'ne' => "!=", 'gt' => ">", 'lt' => "<",
    'ge' => ">=", 'le' => "<=", 'sa' => "", 'eb' => "", 'ap' => ""
];

public static function processDateTime($date)
{
    $result = substr($date, 0, 2);
    $processedDate['prefix'] = self::PREFIXES['eq'];  // default "="
    $processedDate['value'] = $date;

    foreach (self::PREFIXES as $prefix => $value) {
        if ($prefix == $result) {
            $date = substr($date, 2);
            $processedDate['prefix'] = $value;
            $processedDate['value'] = $date;
            return $processedDate;
        }
    }
    return $processedDate;
}
```

`eq2020-01-01` → prefix `=`, value `2020-01-01`.
`gt2020-01-01` → prefix `>`, value `2020-01-01`.
`sa` (starts after), `eb` (ends before), `ap` (approximate) have empty
operators — they're date-range tokens that the caller must interpret.

---

## 2. How to create a new service

> The standard recipe (from `CLAUDE.md`):

```php
<?php

declare(strict_types=1);

namespace OpenEMR\Services;

/**
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Your Name <your@email.com>
 * @copyright Copyright (c) YEAR Your Name
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */
class ExampleService extends BaseService
{
    public const TABLE_NAME = "example_table";

    public function __construct()
    {
        parent::__construct(self::TABLE_NAME);
    }

    /**
     * Declare which columns are BINARY(16) UUIDs so search() can hydrate them.
     */
    public function getUuidFields(): array
    {
        return ['uuid'];
    }

    public function getOne($puuidString)
    {
        $search = new TokenSearchField('uuid', $puuidString);
        $result = $this->search([$search], true);
        $rows = $result->getData();
        return $rows[0] ?? null;
    }

    public function getAll()
    {
        return $this->search([])->getData();
    }

    public function insert($data)
    {
        $clean = $this->filterData($data);
        $built = $this->buildInsertColumns($clean);
        $sql = "INSERT INTO " . $this->getTable() . " SET " . $built['set'];
        return QueryUtils::sqlInsert($sql, $built['bind']);
    }

    public function update($id, $data)
    {
        $clean = $this->filterData($data);
        $built = $this->buildUpdateColumns($clean);
        $sql = "UPDATE " . $this->getTable() . " SET " . $built['set'] . " WHERE id = ?";
        $built['bind'][] = $id;
        return QueryUtils::sqlStatementThrowException($sql, $built['bind']);
    }
}
```

### 2.1 Wiring with controllers

```php
// In a REST controller:
$service = new ExampleService();
$result = $service->getOne($uuid);
// result is an array; for rich responses, wrap in a ProcessingResult
```

### 2.2 Wiring with Twig pages

```php
$service = new ExampleService();
$items = $service->getAll();
echo $twig->render('example/list.html.twig', ['items' => $items]);
```

---

## 3. Patient service example

> Source: `src/Services/PatientService.php` (996 lines)

`PatientService` is the canonical "large" service. Highlights:

```php
class PatientService extends BaseService
{
    public const TABLE_NAME = 'patient_data';
    private const PATIENT_HISTORY_TABLE = "patient_history";

    /** Whitelist for ?_sort query param — prevents SQL injection. */
    private const ALLOWED_SORT_COLUMNS = [
        'id','pid','pubpid','title','fname','lname','mname','DOB',
        'sex','street','city','state','postal_code','country_code',
        'phone_home','phone_cell','phone_biz','email','status',
        'date','regdate','last_updated',
    ];

    public function __construct($base_table = null)
    {
        parent::__construct($base_table ?? self::TABLE_NAME);
    }

    /** @phpstan-import-type PatientDataRow from TableTypes */
    public function getOne($puuidString): array|false { … }
    public function getAll($search = []): ProcessingResult { … }
    public function insert($data): string { … }   // dispatches PatientCreatedEvent
    public function update($pid, $data): string { … }  // dispatches PatientUpdatedEvent
    public function getPatientPictureDocumentId($pid): int { … }
    public function getPatientSensitivities($pid): array { … }
    // … plus ~30 more methods
}
```

`PatientService` dispatches **four Symfony events** at the right points:

| Event | Fired when |
|---|---|
| `OpenEMR\Events\Patient\BeforePatientCreatedEvent` | Before `INSERT` (cancellable) |
| `OpenEMR\Events\Patient\PatientCreatedEvent` | After successful `INSERT` |
| `OpenEMR\Events\Patient\BeforePatientUpdatedEvent` | Before `UPDATE` (cancellable) |
| `OpenEMR\Events\Patient\PatientUpdatedEvent` | After successful `UPDATE` |

Modules can listen to these to e.g. push the patient to an external
registry, update a remote system, log to a custom audit, etc.

---

## 4. All services in `src/Services/`

> 95+ service classes at the time of writing. One-line responsibility for each.

| Service | Responsibility |
|---|---|
| `AddressService` | Address CRUD (sub-table of `addresses`, generic for patient / clinic / employer). |
| `AllergyIntoleranceService` | Allergy / intolerance FHIR-mapped resource. |
| `AppointmentService` | Appointments (read/write `openemr_postcalendar_events`). |
| `BaseService` | Abstract base class. |
| `BaseServiceInterface` | The contract. |
| `CareExperiencePreferenceService` | Patient care experience preferences (USCDI). |
| `CarePlanService` | Care plans (FHIR). |
| `CareTeamService` | Care team composition (FHIR). |
| `CDADocumentService` | C-CDA document generation orchestration. |
| `ClinicalNotesService` | Clinical notes (FHIR DocumentReference). |
| `CodeTypesService` | Code-type catalogue (ICD9/10, SNOMED, CPT, HCPCS, …). |
| `ConditionService` | Problem list (FHIR Condition). |
| `ContactAddressService` | Contact addresses (FHIR / ONC generic contact model). |
| `ContactRelationService` | Contact-person relations. |
| `ContactService` | Contacts (people). |
| `ContactTelecomService` | Contact phone / email (FHIR ContactPoint). |
| `DecisionSupportInterventionService` | DSI (CDS Hooks) service. |
| `DemographicsRelatedPersonsService` | Patient related persons (FHIR RelatedPerson). |
| `DeviceService` | Medical devices (FHIR Device). |
| `DocumentService` | Documents / file uploads. |
| `DrugSalesService` | Pharmacy drug sales (inventory). |
| `DrugService` | Drug catalogue (drugs / drug_templates). |
| `EmployerService` | Patient employer. |
| `EncounterService` | Encounters / visits (`form_encounter`). |
| `FacilityService` | Facilities (clinics, labs). |
| `FormService` | Generic clinical form loader/saver. |
| `Globals\…` | (sub-namespace) Global settings service + enums (Appearance, Calendar, CDR, Connectors, Features, Security, …). |
| `GroupService` | Therapy groups. |
| `IGlobalsAware` | Interface: services that read globals. |
| `ImageUtilities\` | (sub-namespace) Image thumbnails, etc. |
| `ImmunizationService` | Immunizations. |
| `InsuranceCompanyService` | Insurance companies. |
| `InsuranceService` | Patient insurance numbers/coverages. |
| `JWTClientAuthenticationService` | RFC 7523 JWT client assertion for SMART. |
| `ListService` | `lists` table (issues, problems, allergies, etc). |
| `LocationService` | Locations (physical rooms). |
| `LogoService` | Site logo upload / display. |
| `MedicationPatientIssueService` | Patient medication issues. |
| `MessageService` | Pnotes (internal messages). |
| `ONoteService` | Onotes (provider notes). |
| `ObservationLabService` | Lab observations (FHIR). |
| `ObservationService` | Generic observations (FHIR). |
| `PatientAccessOnsiteService` | Patient portal access (onsite). |
| `PatientAdvanceDirectiveService` | Advance directives. |
| `PatientIssuesService` | Patient issue list (allergy + problem + med). |
| `PatientNameHistoryService` | Patient name history. |
| `PatientPortalService` | Patient portal API. |
| `PatientService` | Patient demographics (the canonical big service). |
| `PatientTrackerService` | Patient tracker (encounter flow board). |
| `PatientTransactionService` | Wrapper for old `library/patient.inc.php` helpers. |
| `PersonPatientLinkService` | FHIR Person ↔ Patient link. |
| `PersonService` | Generic Person. |
| `PhoneNumberService` | Phone number normalization. |
| `PractitionerRoleService` | FHIR PractitionerRole. |
| `PractitionerService` | FHIR Practitioner (User ↔ Practitioner). |
| `PrescriptionService` | Prescriptions (`prescriptions` table). |
| `ProcedureOrderRelationshipService` | Procedure order ↔ encounter relations. |
| `ProcedureProviderService` | Procedure providers. |
| `ProcedureService` | Procedure order / report / result (lab/imaging). |
| `ProductRegistrationService` | Product registration. |
| `Qdm\` | (sub-namespace) QDM (Quality Data Model) for CQM. |
| `Qrda\` | (sub-namespace) QRDA generation. |
| `QuestionnaireResponseService` | QuestionnaireResponse (FHIR). |
| `QuestionnaireService` | Questionnaire (FHIR). |
| `QuestionnaireTraits` | Shared traits for questionnaire services. |
| `Reports\` | (sub-namespace) Report runners (RealWorldTesting, AMC). |
| `SDOH\` | (sub-namespace) Social Determinants of Health. |
| `Search\` | (sub-namespace) FHIR search infrastructure (`ISearchField`, `TokenSearchField`, `StringSearchField`, `CompositeSearchField`, `FhirSearchWhereClauseBuilder`, `SearchQueryConfig`, `SearchConfigClauseBuilder`, `SearchModifier`). |
| `SessionAwareInterface` | Interface for services that need a session. |
| `SocialHistoryService` | Social history (FHIR Observation). |
| `SpreadSheetService` | CSV/XLSX import-export helpers (PHPSpreadsheet wrapper). |
| `SurgeryService` | Surgery history. |
| `Trait\…` | (sub-namespace) Shared traits. |
| `Traits\…` | (sub-namespace) More shared traits. |
| `TreatmentInterventionPreferenceService` | Patient treatment intervention preferences (USCDI). |
| `TrustedUserService` | OAuth2 trusted-user CRUD (revoke tokens on logout). |
| `UserService` | User CRUD. |
| `Utils\…` | (sub-namespace) SQLUpgradeService, TableDescription, etc. |
| `VersionService` | Software version reader (`version.php`). |
| `VersionServiceInterface` | Version reader contract. |
| `VitalsCalculatedService` | Calculated vitals (BMI, BSA, MAP). |
| `VitalsService` | Vitals (`form_vitals`). |

Plus ~12 sub-namespaces under `Address/`, `Cda/`, `DocumentTemplates/`,
`FHIR/`, `Forms/`, `Globals/`, `ImageUtilities/`, `Qdm/`, `Qrda/`, `Reports/`,
`SDOH/`, `Search/`, `Trait/`, `Traits/`, `Utils/` — each containing
domain-specific helpers and DTOs.

---

## 5. Sub-namespaces worth knowing

### 5.1 `OpenEMR\Services\Search\`

The FHIR search infrastructure that `BaseService::search()` builds on:

| Class | Role |
|---|---|
| `ISearchField` | Interface — every search field is an `ISearchField`. |
| `TokenSearchField` | FHIR `token` search (e.g. `Patient.identifier`). |
| `StringSearchField` | FHIR `string` search (case-insensitive `contains`). |
| `DateSearchField` | FHIR `date` search (with `eq`/`ne`/`gt`/`lt`/`ge`/`le`/`sa`/`eb`/`ap` prefixes). |
| `QuantitySearchField` | FHIR `quantity` search (numeric ranges). |
| `ReferenceSearchField` | FHIR `reference` search (e.g. `Patient:123`). |
| `CompositeSearchField` | Composite (OR-of-AND) — e.g. `name=John,Smith`. |
| `FhirSearchWhereClauseBuilder` | Builds a parameterized SQL fragment from `ISearchField[]`. |
| `SearchQueryConfig` | Holder for the search config (table, columns, joins). |
| `SearchConfigClauseBuilder` | Builds additional SELECT clauses (e.g. `_include`, `_revinclude`). |
| `SearchModifier` | Search modifiers (`:missing`, `:exact`, etc.). |
| `SearchFieldException` | Validation exception. |

### 5.2 `OpenEMR\Services\Globals\`

The modern "global settings" service + enums:
- `GlobalAppearanceEnum`, `GlobalCalendarEnum`, `GlobalCDREnum`,
  `GlobalConnectorsEnum`, `GlobalFeaturesEnum`, `GlobalLocaleEnum`,
  `GlobalNotificationsEnum`, `GlobalSecurityEnum`, `GlobalBillingEnum`,
  `GlobalEncounterEnum`, `GlobalPatientPortalEnum`, `GlobalPracticeEnum`,
  `GlobalRxEnum`, `GlobalMiscEnum`, `GlobalRoleEnum`, …
- `GlobalsService` — reads and validates global settings from the
  `globals` table.

### 5.3 `OpenEMR\Services\FHIR\…`

FHIR serialization:
- `FhirServiceBase` — abstract base for every FHIR service.
- `FhirPatientService`, `FhirEncounterService`, `FhirObservationService`, …
  (one per resource).
- `BulkExportJobService`, `KickoffBulkExportService`,
  `BulkExportStatusService` — `$export` job orchestration.
- `Export\…` — streaming bulk export writers (NDJSON, CSV, FHIR JSON).

---

## 6. Anti-patterns to avoid

| Anti-pattern | What to do instead |
|---|---|
| `new ADODB_mysqli_log(...)` in a service | Use `QueryUtils::getADODB()` |
| `new \PDO(...)` in a service | Use `DatabaseConnectionFactory::createDbal()` |
| `sqlStatement('SELECT * FROM big_table')` | Use `$service->search([])` or a paginated `selectHelper` |
| Reading `$GLOBALS` directly | Use `OEGlobalsBag::getInstance()->getString('foo')` |
| Building SQL by string concat | Use `ISearchField` + `FhirSearchWhereClauseBuilder` |
| Returning raw `ADORecordSet` from a service | Wrap in `ProcessingResult` |
| Inserting a row without dispatching the event | Always dispatch `*CreatedEvent` / `*UpdatedEvent` after success |
| Hardcoding `id BIGINT` PK | Use `getFreshId()` for legacy tables, or `LAST_INSERT_ID()` |

---

## 7. See also

- [`overview.md`](./overview.md) — overall layout
- [`coding-standards.md`](./coding-standards.md) — strict types, file headers
- [`module-system.md`](./module-system.md) — modules listen to service events
- [`../database/connection-layer.md`](../database/connection-layer.md) — `QueryUtils`
