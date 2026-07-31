# OpenEMR Reference — Documentation

> **Purpose:** This folder contains a complete, self-contained technical reference for the
> [OpenEMR](https://www.open-emr.org/) project under
> `/Users/rahmatullahzisan/Desktop/Dev/hms/openemr-reference/`.
> Read the file relevant to a part of OpenEMR instead of grepping through thousands of
> PHP / SQL / JS files.
>
> **Source repo state studied:** `v_database = 535` (OpenEMR 8.0.1-dev), ~280 tables,
> ~600 service classes, ~60 REST controllers, ~50 FHIR resources, ~1000 UI pages.
>
> **How to use this doc folder:** Each file maps to one logical area of OpenEMR
> (e.g. patient management, billing, FHIR). Read the file → get a complete mental
> model of that subsystem. No need to read the actual code.

---

## Folder map

| Folder | What lives here | When to read |
|---|---|---|
| [`architecture/`](./architecture/) | High-level project structure, tech stack, bootstrap, coding rules, multi-site | First time, or when you need to know "where does X live" |
| [`database/`](./database/) | Schema overview, connection layer, migrations, key tables | Working on data model or persistence |
| [`modules/`](./modules/) | Per-domain clinical + admin modules (patient, encounter, billing, Rx, …) | Implementing a feature in a specific domain |
| [`api/`](./api/) | REST API + OAuth2 + FHIR + SMART | Building or integrating with the API |
| [`frontend/`](./frontend/) | UI shell, login, main frameset, patient chart, clinical forms | Touching the web UI |
| [`auth/`](./auth/) | Authentication, ACL, MFA, OAuth2 server, session management | Working on login, permissions, or API tokens |
| [`interop/`](./interop/) | FHIR R4, CCDA, CCR, bulk data export, SMART on FHIR | Health-information-exchange features |

---

## Quick orientation

| Concept | One-line summary | File |
|---|---|---|
| **PSR-4 namespace** | All modern code is `OpenEMR\…` under `/src/` | [`architecture/overview.md`](./architecture/overview.md) |
| **Legacy code axis** | `library/` = procedural helpers, `interface/` = web UI, `src/` = modern | [`architecture/overview.md`](./architecture/overview.md) |
| **Database access** | New code uses `QueryUtils`; legacy uses `sqlStatement` from `library/sql.inc.php` | [`database/connection-layer.md`](./database/connection-layer.md) |
| **Service pattern** | `OpenEMR\Services\BaseService` is the abstract base for every domain service | [`architecture/service-layer.md`](./architecture/service-layer.md) |
| **ACL** | `AclMain::aclCheckCore('patients','demo')` — checks phpGACL via the `gacl_*` tables | [`auth/acl-system.md`](./auth/acl-system.md) |
| **Login flow** | `library/auth.inc.php` → `AuthUtils::confirmPassword()` → session → MFA → `main_screen.php` | [`auth/authentication.md`](./auth/authentication.md) |
| **REST API entry** | `apis/dispatch.php` → `ApiApplication` → `HttpRestRouteHandler` → closure | [`api/rest-api.md`](./api/rest-api.md) |
| **FHIR entry** | `apis/<site>/fhir/...` → `FhirServiceBase` subclasses (one per resource) | [`interop/fhir-r4.md`](./interop/fhir-r4.md) |
| **Patient portal** | `/portal/` (server-rendered) + `/portal/patient/` (Phreeze MVC) | [`interop/patient-portal-api.md`](./interop/patient-portal-api.md) |
| **Forms pattern** | `interface/forms/<name>/{new,view,save,report}.php` + `C_FormXxx.class.php` | [`frontend/clinical-forms.md`](./frontend/clinical-forms.md) |
| **Main app shell** | `interface/main/tabs/main.php` + Knockout view-models | [`frontend/main-app-shell.md`](./frontend/main-app-shell.md) |
| **Multi-site** | `sites/<host>/` directory per tenant (filesystem-based, not column-based) | [`architecture/multi-site.md`](./architecture/multi-site.md) |
| **Migrations** | `sql/X_Y_Z-to-A_B_C_upgrade.sql` files parsed by a custom `#If*` meta-language | [`database/migrations.md`](./database/migrations.md) |
| **Events** | Symfony EventDispatcher — primary extension point for modules | [`architecture/module-system.md`](./architecture/module-system.md) |
| **Custom modules** | Drop folder in `interface/modules/custom_modules/<name>/` with `openemr.bootstrap.php` | [`architecture/module-system.md`](./architecture/module-system.md) |

---

## End-to-end workflows (cross-cutting)

| Workflow | Files to read |
|---|---|
| **New patient registration** | [`modules/patient-management.md`](./modules/patient-management.md) + [`frontend/patient-chart.md`](./frontend/patient-chart.md) |
| **Encounter creation → SOAP note** | [`modules/encounters-and-forms.md`](./modules/encounters-and-forms.md) |
| **Appointment → Encounter conversion** | [`modules/appointments-scheduling.md`](./modules/appointments-scheduling.md) |
| **Generate X12 837P claim** | [`modules/billing-and-claims.md`](./modules/billing-and-claims.md) |
| **Post 835 ERA / EOB** | [`modules/billing-and-claims.md`](./modules/billing-and-claims.md) |
| **Write a prescription (with e-prescribe)** | [`modules/prescriptions-and-pharmacy.md`](./modules/prescriptions-and-pharmacy.md) |
| **Run a CQM / AMC report** | [`modules/reports.md`](./modules/reports.md) |
| **FHIR $export (bulk data)** | [`interop/fhir-r4.md`](./interop/fhir-r4.md) |
| **SMART on FHIR app launch** | [`interop/smart-on-fhir.md`](./interop/smart-on-fhir.md) |
| **Generate CCDA on demand (`$docref`)** | [`interop/ccda.md`](./interop/ccda.md) |
| **User login with TOTP MFA** | [`auth/authentication.md`](./auth/authentication.md) + [`auth/mfa.md`](./auth/mfa.md) |
| **Issue OAuth2 token for a SMART app** | [`auth/oauth2-server.md`](./auth/oauth2-server.md) |
| **Write a custom module** | [`architecture/module-system.md`](./architecture/module-system.md) |

---

## Tech stack (single-glance)

| Layer | Technology |
|---|---|
| Language | PHP 8.2+ (4-space indent, LF, `declare(strict_types=1)` for new code) |
| Frameworks | Laminas MVC (legacy) + Symfony components (EventDispatcher, HttpFoundation, ParameterBag) |
| Templates | **Twig 3.x** (modern) + **Smarty 4.5** (legacy) + raw PHP |
| Frontend JS | **Knockout 3.5** (main app), **jQuery 3.7** + **jQuery UI 1.12** (widgets), **Bootstrap 4.6**, **AngularJS 1.8** (portal messages), Chart.js, dygraphs, flot, CKEditor, Summernote, select2, datatables, dropzone, Konva |
| Build | Gulp 4 + SASS, napa (non-npm packages) |
| Database | MySQL/MariaDB (utf8mb4, InnoDB) via **Doctrine DBAL 4.x** (new) + **ADODB 5.x** (legacy surface, custom `ADODB_mysqli_log` driver) |
| Auth (UI) | Session cookie (`OpenEMR`) |
| Auth (API) | OAuth2 Bearer JWT (RS256) via `league/oauth2-server` |
| MFA | TOTP (RFC 6238) + U2F |
| Standardization | FHIR R4 (4.0.1) + US Core 8.0 + SMART on FHIR v2.2 + Bulk Data Access |
| Interop | CCDA (via custom CCDA service) + CCR + QRDA |
| Testing | PHPUnit 11, Jest 29, PHPStan level 10 + custom rules, Rector, phpcs |
| Licensing | GNU GPL v3 |

---

## Repository size (at the time of writing)

- **~600 PHP files** in `src/`
- **~1000 PHP files** in `interface/`
- **~94 directories** in `library/`
- **~280 tables** in `sql/database.sql`
- **~32 upgrade scripts** (2.6.0 → 8.0.1)
- **~50 FHIR R4 resources** in `src/FHIR/R4/FHIRDomainResource/`
- **~35 clinical forms** in `interface/forms/`
- **~50 reports** in `interface/reports/`

---

## Where things live (TL;DR)

```
openemr-reference/
├── src/                       PSR-4 (OpenEMR\)
│   ├── Services/              Domain services (Patient, Encounter, …)
│   ├── RestControllers/       REST API controllers
│   ├── FHIR/                  FHIR R4 domain models + bulk export
│   ├── Common/                Cross-cutting utilities (Acl, Auth, Database, Http, Session, …)
│   ├── BC/                    DatabaseConnectionFactory (new)
│   ├── Billing/               Claim, EDI 837P/I, HCFA, ParseERA, SFTP
│   ├── ClinicalDecisionRules/ Modern CDR rule library
│   ├── Events/                Symfony event classes
│   └── Core/                  Kernel, ModulesApplication, Header
│
├── interface/                 Web UI (legacy PHP)
│   ├── globals.php            ★ Every UI page includes this
│   ├── main/tabs/main.php     ★ The main frameset app
│   ├── login/login.php        Modern login (Twig)
│   ├── patient_file/          Patient chart
│   ├── forms/                 ~35 clinical forms
│   ├── billing/               Billing Manager, payment posting, EDI
│   ├── reports/               ~50 reports
│   ├── orders/                Lab/imaging orders
│   ├── super/                 Globals editor
│   ├── usergroup/             User + ACL + MFA admin
│   └── modules/               Custom + Laminas modules
│
├── library/                   Procedural helpers (legacy)
│   ├── sql.inc.php            sqlStatement / sqlQuery / sqlInsert (delegates to QueryUtils)
│   ├── auth.inc.php           Login boot script
│   ├── globals.inc.php        Builds $GLOBALS (4,582 lines)
│   ├── classes/               C_Document, Prescription, Pharmacy, … (ORDataObject subclasses)
│   ├── ADODB_mysqli_log.php   Custom ADODB driver (audit logs every query)
│   ├── clinical_rules.php     CDR engine
│   └── payment.inc.php        DistributionInsert (payment posting)
│
├── templates/                 Twig + Smarty templates
│
├── sql/
│   ├── database.sql           Master schema (15,382 lines, 280 tables)
│   └── X_Y_Z-to-A_B_C_upgrade.sql   Versioned upgrades
│
├── tests/                     PHPUnit + Jest
│
├── public/                    Static assets (output of `npm run build`)
│
├── sites/default/             Per-site config + documents
│
├── apis/                      API entry points + route map
│   ├── dispatch.php           /api/* and /fhir/*
│   └── routes/                _rest_routes_*.inc.php
│
├── oauth2/                    OAuth2 server entry point
│   └── authorize.php
│
├── portal/                    Patient portal (server-rendered)
│
├── ccdaservice/               CCDA generation
├── ccr/                       CCR generation
├── gacl/                      phpGACL fork
├── custom/                    Custom code (legacy integrator extension)
└── modules/sms_email_reminder/  Bundled reminder module
```

---

## How OpenEMR is built (commands)

```bash
composer install --no-dev        # PHP dependencies
npm install                       # JS dependencies
npm run build                     # Production build (calls `gulp -b`)
composer dump-autoload -o         # Optimize autoloader
```

Run Docker dev stack:
```bash
cd docker/development-easy
docker compose up --detach --wait
# App:   http://localhost:8300/   or   https://localhost:9300/
# Login: admin / pass
# phpMyAdmin: http://localhost:8310/
```

---

## Further reading (in this folder)

- [Architecture overview](./architecture/overview.md) — start here
- [Tech stack details](./architecture/tech-stack.md)
- [Bootstrap flow](./architecture/bootstrap-flow.md)
- [Service layer pattern](./architecture/service-layer.md)
- [Module system + events](./architecture/module-system.md)
- [Coding standards](./architecture/coding-standards.md)
- [Multi-site model](./architecture/multi-site.md)
