# Architecture Overview

> **Source path:** `/Users/rahmatullahzisan/Desktop/Dev/hms/openemr-reference/`
> **Documented version:** OpenEMR 8.0.1-dev (`v_database = 535`, `v_acl = 12`)

OpenEMR is a **PHP-based electronic health records + practice management application**.
The codebase is a 20-year-old, two-tier application in active modernization: legacy
procedural code in `library/` and `interface/`, modern PSR-4 namespaced code in
`src/`. Both tiers are wired through one Symfony HttpKernel + Laminas MVC backbone
and a single event bus (Symfony EventDispatcher).

This file gives the mental model. Detail on each subsystem is in the linked files.

---

## 1. The two-tier model

| Tier | Where | Style | When to use |
|---|---|---|---|
| **Legacy** | `library/`, `interface/`, `controllers/` (root), `portal/`, `ccdaservice/`, `ccr/`, `gacl/`, `custom/`, `modules/sms_email_reminder/` | Procedural PHP + Smarty + raw HTML | Touching an existing page; integrating via `require_once` |
| **Modern** | `src/` (namespace `OpenEMR\…`), `templates/` (Twig 3) | PSR-4, Twig 3, jQuery, Symfony components | Writing new features, services, REST/FHIR endpoints, events |

**The two tiers share one database and one event bus.** New code can call into
legacy (`sqlStatement`, `acl_check`) and vice versa (`OEGlobalsBag`, `AuthUtils`,
`QueryUtils`). The shared kernel is `src/Core/Kernel.php` (Symfony
`DependencyInjection` + `EventDispatcher`).

---

## 2. Top-level directory

```
openemr-reference/
├── src/                        ★ Modern PSR-4 (OpenEMR\)
│   ├── Services/               Domain services (Patient, Encounter, …)
│   ├── RestControllers/        REST API controllers
│   ├── FHIR/                   FHIR R4 domain models + bulk export + SMART
│   ├── Common/                 Cross-cutting: Acl, Auth, Database, Http, Session, Logging, …
│   ├── BC/                     DatabaseConnectionFactory (new Doctrine DBAL 4 layer)
│   ├── Billing/                Claim, EDI 837P/I, HCFA, ParseERA, SFTP
│   ├── ClinicalDecisionRules/  Modern CDR rule library + UI
│   ├── Cqm/                    Clinical Quality Measure engine (modern)
│   ├── Reports/                Modern report classes (RealWorldTesting, AMC trackers)
│   ├── Events/                 Symfony event classes (~80 event classes)
│   ├── Core/                   Kernel, Header, ModulesApplication, OEGlobalsBag
│   ├── Controllers/            Modern HTTP controllers (small)
│   ├── OeUI/                   OemrUI page chrome helper
│   ├── Patient/Cards/          Dashboard view cards
│   ├── Tabs/                   TabsWrapper (encounter sub-tabs)
│   └── Menu/                   Menu JSON loader
│
├── interface/                  Web UI (legacy PHP)
│   ├── globals.php             ★ Every UI page includes this (854 lines)
│   ├── main/tabs/main.php      ★ Main frameset app (549 lines)
│   ├── login/login.php         Modern login (Twig)
│   ├── patient_file/           Patient chart
│   │   ├── summary/demographics.php    Dashboard (2,072 lines)
│   │   ├── encounter/        Encounter tabs
│   │   └── history/          Past visits
│   ├── forms/                  ~35 clinical forms
│   │   ├── vitals/             Vitals form
│   │   ├── soap/               SOAP form
│   │   ├── newpatient/         "Create visit" form
│   │   ├── fee_sheet/          CPT/HCPCS charge entry
│   │   ├── procedure_order/    Lab/imaging orders
│   │   └── …
│   ├── forms_admin/forms_admin.php
│   ├── billing/                Billing Manager, payment posting, EDI
│   ├── reports/                ~50 reports
│   ├── orders/                 Lab/imaging results
│   ├── new/                    New patient registration
│   ├── main/calendar/          Scheduler (PostNuke PostCalendar)
│   ├── super/                  Globals editor
│   ├── usergroup/              User + ACL + MFA admin
│   ├── practice/               Practice settings
│   ├── messages/               Secure messaging
│   ├── themes/                 SASS source
│   └── modules/                Custom + Laminas modules
│
├── library/                    Procedural helpers (legacy)
│   ├── sql.inc.php             sqlStatement / sqlQuery (delegates to QueryUtils)
│   ├── auth.inc.php            Login boot
│   ├── globals.inc.php         $GLOBALS builder (4,582 lines)
│   ├── classes/                C_Document, Prescription, Pharmacy, Document, …
│   ├── ADODB_mysqli_log.php    Custom ADODB driver
│   ├── clinical_rules.php      CDR engine
│   ├── payment.inc.php         DistributionInsert
│   ├── ajax/                   ~42 AJAX endpoints
│   ├── js/                     ~22 shared JS files
│   ├── smarty/, smarty_legacy/ Cache dirs for Smarty
│   └── …
│
├── controllers/                ★ C_ pattern (Smarty-based, legacy)
│   ├── C_Document.class.php    Document CRUD (1,499 lines)
│   ├── C_Prescription.class.php
│   ├── C_Pharmacy.class.php
│   ├── C_PatientFinder.class.php
│   ├── C_InsuranceCompany.class.php
│   ├── C_InsuranceNumbers.class.php
│   ├── C_PracticeSettings.class.php
│   ├── C_X12Partner.class.php
│   ├── C_Hl7.class.php
│   └── C_DocumentCategory.class.php
│
├── templates/                  ★ Twig + Smarty templates
│   ├── core/base.html.twig
│   ├── login/                  Login layouts
│   ├── interface/main/tabs/    Main app tab templates
│   ├── encounter/, patient/, patient_finder/, prescription/
│   ├── documents/, payments/, portal/, practice_settings/
│   └── …
│
├── public/                     ★ Static assets (output of `npm run build`)
│   ├── assets/                 Compiled JS/CSS
│   ├── themes/                 Compiled CSS
│   ├── images/                 Static images
│   └── smart-styles/           SMART-on-FHIR launcher styles
│
├── sql/                        Database
│   ├── database.sql            Master schema (~15,382 lines, 280 tables)
│   ├── X_Y_Z-to-A_B_C_upgrade.sql  Versioned upgrades
│   ├── patch.sql               Between-release patches
│   ├── ins_lang_def_nl.sql     Dutch seed translations
│   ├── ippf_layout.sql         IPPF-specific
│   └── cvx_codes.sql           Vaccine codes
│
├── tests/                      PHPUnit + Jest
├── docker/                     Docker dev/prod configs
├── modules/sms_email_reminder/ Bundled "classic" module
├── custom/                     Custom code (legacy integrator extension)
├── sites/default/              Per-site config + documents
│
├── apis/                       API entry points
│   ├── dispatch.php            /api/* and /fhir/* dispatcher
│   ├── .htaccess               URL rewrite
│   └── routes/                 _rest_routes_*.inc.php (one per API surface)
│
├── oauth2/                     OAuth2 server entry point
│   └── authorize.php
│
├── portal/                     Patient portal
│   ├── index.php               Login
│   ├── home.php                Dashboard
│   ├── account/                Registration + credential mgmt
│   ├── messaging/              Secure mail + chat
│   ├── sign/                   E-signature
│   ├── report/                 Reports + payments
│   ├── get_*.php               Dashboard widget fetchers
│   ├── lib/                    Portal library
│   └── patient/                Phreeze MVC REST app
│
├── ccdaservice/                CCDA document generation
├── ccr/                        CCR (Continuity of Care Record)
├── gacl/                       phpGACL fork
│
├── swagger/                    OpenAPI 3.0 spec
│   ├── openemr-api.yaml        Hand-curated + auto-extracted
│   ├── index.html              Swagger UI
│   └── oauth2-redirect.html
│
├── bin/                        CLI scripts
├── contrib/                    Third-party code
├── oauth2/                     OAuth2 server
└── meta/                       License metadata
```

---

## 3. The three runtime surfaces

OpenEMR has three independent HTTP front-ends that share one database:

### 3.1 Core UI (staff / clinician)

- **Entry:** `index.php` → `interface/login/login.php` (Twig) → `interface/main/tabs/main.php` (the frameset app)
- **Session cookie:** `OpenEMR` (`cookie_httponly=false`, `samesite=Strict`)
- **Auth:** `AuthUtils::confirmPassword()` → session → optional MFA → `main_screen.php`
- **HTTP kernel:** Plain PHP + `Header::setupHeader($assets)` + Twig/Smarty/raw HTML

### 3.2 REST API + FHIR + SMART

- **Entry:** `apis/dispatch.php` (also `apis/<site>/…` rewrite), `oauth2/authorize.php`
- **Session cookie:** `apiOpenEMR` (`/apis/`) + `authserverOpenEMR` (`/oauth2/`)
- **Auth:** OAuth2 Bearer JWT (RS256) validated by `league/oauth2-server` `ResourceServer`
- **HTTP kernel:** Symfony `HttpKernel` (`OEHttpKernel`) with 10 event subscribers in `ApiApplication`

### 3.3 Patient Portal

- **Entry:** `portal/index.php` → `portal/home.php` (or `portal/patient/index.php` Phreeze MVC)
- **Session cookie:** `PortalOpenEMR` (`cookie_httponly=true`, `samesite=Strict`)
- **Auth:** `patient_access_onsite.portal_pwd` + one-time email tokens + Symfony session

All three are mounted in front of the same `OEGlobalsBag` + `QueryUtils` + ACL
(`gacl_*`) infrastructure.

---

## 4. The "thin request handler" pattern

Every page in OpenEMR follows the same shape:

```php
<?php
// 1. Boot
$sessionAllowWrite = true;
require_once(__DIR__ . '/../../globals.php');

// 2. ACL check
if (!AclMain::aclCheckCore('patients', 'demo')) {
    AccessDeniedHelper::denyWithTemplate('Access denied', 'Patients');
}

// 3. Call a service
$patient = (new PatientService())->getOne($puuidString);

// 4. Render
$header = Header::setupHeader(['knockout', 'tabs-theme'], false);
echo $twig->render('patient/dashboard.html.twig', ['patient' => $patient, 'header' => $header]);
```

Heavy work belongs in `OpenEMR\Services\…`. The request handler just glues
inputs → service → output. The kernel runs it through Symfony events for auth,
audit, and CSRF automatically.

---

## 5. The Modern Service Layer

Every domain concept has a service in `src/Services/` that extends
`OpenEMR\Services\BaseService` (see [`service-layer.md`](./service-layer.md)):

```php
namespace OpenEMR\Services;

class ExampleService extends BaseService
{
    public const TABLE_NAME = 'example_table';
    public function __construct() { parent::__construct(self::TABLE_NAME); }
}
```

The pattern is mandated by the project's own `CLAUDE.md` and enforced by PHPStan.

Key responsibilities of `BaseService`:

- **Auto-increment detection** — `SHOW COLUMNS` on construct, auto-skips auto-increment
  columns from INSERT/UPDATE.
- **Event injection** — `OEGlobalsBag::getInstance()->getKernel()->getEventDispatcher()`
  is wired in constructor.
- **Search** — `search($search, $isAndCondition)` builds the WHERE clause via
  `FhirSearchWhereClauseBuilder` and runs `SELECT … FROM table`.
- **Result hydration** — converts `BINARY(16)` UUID columns to strings via
  `UuidRegistry::uuidToString()`.
- **Date parsing** — implements FHIR date prefixes (`eq`, `ne`, `gt`, `lt`, `ge`, `le`, `sa`, `eb`, `ap`).
- **Logging** — PSR-3 `LoggerInterface` injected.

For a complete list of services, see [`service-layer.md`](./service-layer.md).

---

## 6. Cross-cutting concerns (`src/Common/`)

| Submodule | Purpose | Read more |
|---|---|---|
| `Acl/` | `AclMain::aclCheckCore()` facade over `gacl_*` | [`auth/acl-system.md`](../auth/acl-system.md) |
| `Auth/` | `AuthUtils`, `AuthHash`, `MfaUtils`, `OneTimeAuth`, OAuth2/OIDC | [`auth/authentication.md`](../auth/authentication.md) |
| `Database/` | `QueryUtils`, `ConnectionManager`, `QueryPagination` | [`database/connection-layer.md`](../database/connection-layer.md) |
| `Session/` | `SessionUtil` (4 separate session IDs), `SessionWrapperFactory` | [`auth/authentication.md`](../auth/authentication.md) |
| `Http/` | `HttpRestRequest`, `HttpRestRouteHandler`, `oeHttp` (Guzzle) | [`api/rest-api.md`](../api/rest-api.md) |
| `Logging/` | `EventAuditLogger` (Symfony-style events + ATNA + DB) | [`database/connection-layer.md`](../database/connection-layer.md) |
| `Crypto/` | `CryptoGen` (two-key encryption) | inline below |
| `Csrf/` | `CsrfUtils` (HMAC-SHA256 truncated to 40 chars) | inline below |
| `Uuid/` | `UuidRegistry` (COMB UUIDs, table registry) | inline below |
| `ORDataObject/` | Active-record base for `library/classes/*` | inline below |
| `Twig/` | `TwigContainer`, `TwigExtension` (xlt, attr, attr_url, setupHeader) | [`frontend/overview.md`](../frontend/overview.md) |
| `Forms/` | `BaseForm`, `FormLocator`, `FormVitals`, `FormReportRenderer` | [`frontend/clinical-forms.md`](../frontend/clinical-forms.md) |
| `Command/` | `SymfonyCommandRunner` (CLI command registry) | inline below |
| `Session/Predis/` | Predis Sentinel session storage (optional) | inline below |
| `System/` | `System`, `MissingSiteException` | inline below |
| `Translation/` | `TranslationCache` | inline below |
| `Utils/` | `CacheUtils`, `FileUtils`, `FormatMoney`, `MeasurementUtils`, `NetworkUtils`, `RandomGenUtils` | inline below |
| `ValueObjects/` | `PhoneNumber`, `TypedPhoneNumber` | inline below |

### 6.1 Crypto

- `CryptoGen` (704 lines) — two-key encryption strategy
  - DB keys in `keys` table, drive keys in `documents/logs_and_misc/methods/`
  - `KeySource` enum (Drive/Database), `KeyVersion` (versioned algorithm prefix)
  - `CryptoInterface`, `PasswordBasedCrypto`, `CryptoGenException`

### 6.2 CSRF

- `CsrfUtils` — HMAC-SHA256 truncated to 40 chars
  - Subjects: `default` and `api`
  - `CsrfInvalidException`

### 6.3 UUID

- `UuidRegistry` (533 lines) — COMB UUIDs, table registry
  - `createUuid()`, `uuidToBytes()`, `uuidToString()`
  - `createMissingUuidsForTables()` — back-fills missing `BINARY(16)` UUID columns
- `UuidMapping` (per-table), `UniqueInstallationUuid`

### 6.4 Active record

- `ORDataObject` base + subclasses `Person`, `Address`, `Contact`, `ContactAddress`,
  `ContactRelation`, `ContactTelecom` (used by FHIR-mapped generic contact model)

### 6.5 CLI

- `IOpenEMRCommand` interface
- `SymfonyCommandRunner` (preferred; auto-discovers `*.php` in the directory,
  dispatches `CommandRunnerFilterEvent` so modules can register their own commands)
- Bundled commands: `CreateAPIDocumentationCommand`, `CreateClientCredentialsAssertionCommand`,
  `GenerateAccessTokenCommand`, `GeneratePhpstanTypesCommand`,
  `CreateReleaseChangelogCommand`, `RegisterApiTestClientCommand`

---

## 7. Events

OpenEMR uses **Symfony EventDispatcher** as its primary extension point. ~80 event
classes under `src/Events/`. Modules subscribe and modify behavior. See
[`module-system.md`](./module-system.md) for the full event catalog.

Three flavors of events:

1. **Domain events** (e.g. `patient.created`, `service.save.pre`) — fired from
   services; modules react.
2. **Render events** (e.g. `main.body.render.nav`, `patientDemographics.render.section.after`) —
   fired from pages; modules inject HTML.
3. **Filter events** (e.g. `AppointmentsFilterEvent`, `PatientFinderFilterEvent`) —
   extend a query (`AbstractBoundFilterEvent` + `BoundFilter`).

---

## 8. The `C_*` pattern (legacy controllers)

In `controllers/` (root) and `library/classes/`, there is a "C_" class pattern that
extends `library/classes/Controller.class.php` (which itself extends Smarty):

```php
class C_Prescription extends Controller
{
    public function default_action($a='', $b='', $c='') { … }
    public function edit_action($id='', $patient_id='') { … }     // GET render
    public function edit_action_process($id='', $patient_id='') { … }   // POST process
}
```

When `controller.php?prescription&edit&id=123` is hit:

1. `Controller::act()` ACL-checks `practice_settings` and `prescription` namespaces
2. Maps the URL parts to a `C_<Name>` class and action verb
3. If `$_POST['process'] === 'true'`, first calls `<verb>_action_process(...)` then `<verb>_action(...)`
4. Echoes the returned HTML

The base `Controller` exposes:
- `assign()`, `fetch()` (from Smarty)
- `populate_object(&$obj)` — iterates `$_POST` and calls `set_<field>($val, $_POST)` setters
- `_link()` — URL builder
- `act($qarray)` — dispatcher

Files in `controllers/`:
- `C_Document.class.php` (1,499 lines) — document upload/list/categorize
- `C_Prescription.class.php` (1,263 lines) — Rx CRUD + printing + e-prescribing
- `C_Pharmacy.class.php` — pharmacy directory
- `C_PracticeSettings.class.php` — practice settings shell
- `C_InsuranceCompany.class.php`, `C_InsuranceNumbers.class.php`
- `C_PatientFinder.class.php` (148 lines) — patient search widget
- `C_DocumentCategory.class.php`, `C_Hl7.class.php`, `C_X12Partner.class.php`

---

## 9. Coding standards (from `CLAUDE.md`)

- **Indentation:** 4 spaces
- **Line endings:** LF (Unix)
- **strict_types:** New files should use `declare(strict_types=1)` — adoption is growing
- **Namespaces:** PSR-4 with `OpenEMR\` prefix for `/src/`
- New code goes in `/src/`, legacy helpers in `/library/`
- **Database:** Use `QueryUtils` for queries. New schema changes use Doctrine
  Migrations. Do not instantiate database connections directly — use the
  centralized `DatabaseConnectionFactory`.
- **Global settings:** Use `OEGlobalsBag` (extends Symfony `ParameterBag`) instead
  of `$GLOBALS`. Prefer typed getters:
  - `getString($key)` instead of `(string) get($key)`
  - `getInt($key)` instead of `(int) get($key)`
  - `getBoolean($key)` instead of `(bool) get($key)`
  - `getKernel()` for the Kernel instance
  - `getAlpha()`, `getAlnum()`, `getDigits()`, `getEnum()`

### File headers

```php
/**
 * Brief description
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Your Name <your@email.com>
 * @copyright Copyright (c) YEAR Your Name or Organization
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */
```

Preserve existing authors/copyrights when editing files.

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

---

## 10. Static analysis

- **PHPStan level 10** + custom rules in `tests/PHPStan/Rules/`
  - Forbidden globals
  - Forbidden direct instantiations
  - Namespace rules
  - Etc.
- **Rector** for code modernization
- **phpcs** for code style
- **codespell** for spelling

---

## 11. The bootstrap chain (read once, internalize forever)

```
Browser
   │
   ▼
index.php (resolve site from URL, redirect to login or setup)
   │
   ▼
interface/login/login.php  (Twig renders login form)
   │  POST authUser + clearPass + new_login_session_management=1
   ▼
interface/main/main_screen.php?auth=login&site=…
   │  ← interface/globals.php boots:
   │      1. autoload (vendor/)
   │      2. require library/globals.inc.php (build $GLOBALS)
   │      3. SessionUtil::coreSessionStart($web_root, $read_only)
   │      4. Resolve site_id, set OE_SITE_DIR
   │      5. require library/auth.inc.php
   │  ← auth.inc.php:
   │      1. confirmPassword(alice, …, mode='login')
   │      2. setUserSessionVariables
   │      3. skip timeout this turn
   │  ← main_screen.php:
   │      1. SELECT login_mfa_registrations → has TOTP?
   │      2. If yes + form_response not set → render TOTP form
   │      3. After TOTP success → SessionTracker::setupSessionDatabaseTracker()
   ▼
interface/main/tabs/main.php  (the main frameset app)
   │  ← Header::setupHeader(['knockout', 'tabs-theme', 'i18next', 'hotkeys'])
   │  ← i18n, knockout, restoreSession JS injected
   ▼
[Each tab opens an iframe to a feature page, e.g. interface/patient_file/summary/demographics.php]
   │
   ▼  ← Every page again boots globals.php → authCheckSession() → renders
```

The same globals.php is included at the top of every page; it does all the
boilerplate (autoload, locale, site, session, CSRF, audit log).

---

## 12. Where to put new code

| If you are adding… | Put it in | Pattern |
|---|---|---|
| A new clinical resource (e.g. "CarePlan") | `src/Services/CarePlanService.php` + `src/RestControllers/CarePlanRestController.php` + register in `apis/routes/_rest_routes_standard.inc.php` | `BaseService` + `RestController` |
| A new FHIR resource | `src/FHIR/R4/FHIRDomainResource/...` (use PHPFHIR) + `src/Services/FHIR/Fhir<Resource>Service.php` + register in `apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php` | `FhirServiceBase` + `FhirGenericRestController` |
| A new clinical form | `interface/forms/<formname>/` with `new.php`, `view.php`, `save.php`, `report.php`, `C_FormXxx.class.php`, `FormXxx.class.php`, `table.sql`, `info.txt` | The form contract |
| A new menu item | Edit `interface/main/tabs/menu/menus/standard.json` (or add a per-site custom menu) | JSON |
| A new event | `src/Events/.../MyEvent.php` extending `Symfony\Contracts\EventDispatcher\Event`, dispatch it from a service or controller, listen from a module | Symfony pattern |
| A new ACL section/value | (a) Add to `src/Common/Acl/AclMain.php` docblock + handler, (b) admin via `interface/usergroup/adminacl.php` | `AclMain::aclCheckCore($section, $value)` |
| A new database table | Add to `migrations/NNNN_*.sql` + (a) `sql/database.sql` (b) `tenant-schema.sql` if multi-tenant. Use `QueryUtils` everywhere. | Schema + service |
| A new module | `interface/modules/custom_modules/<name>/` with `openemr.bootstrap.php` | Module pattern |
| A new report | `interface/reports/<report>.php` (and maybe `src/Reports/<Report>.php` for new style) | Existing reports are the reference |
| A new background service | INSERT into `background_services` table; the worker picks it up | Background services |
| A new global setting | Add to `library/globals.inc.php` (legacy) and read via `OEGlobalsBag::getXxx($key)` | Typed bag |

---

## 13. License

GNU GPL v3. See `LICENSE` (35,147 bytes). Header: `Copyright (c) 2024 Brady Miller, OpenEMR, etc.`

---

## 14. Further reading

- [Tech stack](./tech-stack.md)
- [Service layer pattern](./service-layer.md)
- [Module system + events](./module-system.md)
- [Coding standards](./coding-standards.md)
- [Multi-site model](./multi-site.md)
- [Bootstrap flow](./bootstrap-flow.md)
