# Bootstrap Flow — Request Lifecycle

> **Source paths:** `index.php`, `interface/globals.php`,
> `library/sql.inc.php`, `library/auth.inc.php`, `library/globals.inc.php`,
> `src/Core/ModulesApplication.php`, `src/Common/Session/SessionUtil.php`,
> `src/Core/OEGlobalsBag.php`
> **Documented version:** OpenEMR 8.0.1-dev

OpenEMR's request lifecycle is one of the trickier parts of the codebase
to internalize because **three different entry-point patterns** exist
(legacy UI, modern UI, REST API) and they all share the same `globals.php`
chassis. This file traces a single request from URL bar to rendered page.

---

## 1. End-to-end flow (legacy UI)

```
Browser
  │
  │  GET https://hms.example.com/?site=main
  ▼
index.php                                  (project root)
  │  Resolves site_id from $_GET['site'] or $_SERVER['HTTP_HOST']
  │  require_once "sites/$site_id/sqlconf.php"   ← sets $host, $login, $dbase, $config
  │
  │  if $config == 1:  Location: interface/login/login.php?site=$site_id
  │  else:             Location: setup.php?site=$site_id
  ▼
interface/login/login.php                   (Twig login form)
  │  Renders the login page.
  │  POST → interface/main/main_screen.php?auth=login&site=…
  ▼
interface/main/main_screen.php?auth=login
  │  require_once '../globals.php'           ← THE BIG BOOT
  │  globals.php:
  │     1. require vendor/autoload.php
  │     2. PHP version + openssl + aes-256-cbc check
  │     3. .env via Dotenv
  │     4. Build $webserver_root, $web_root, $GLOBALS['webroot']
  │     5. Set $GLOBALS['OE_SITES_BASE'], $GLOBALS['OE_SITE_DIR']
  │     6. require library/globals.inc.php   ← load 4,582-line $GLOBALS builder
  │     7. require library/sql.inc.php        ← ADODB connect (delegates to QueryUtils)
  │     8. require library/auth.inc.php       ← auth, session, MFA gate
  │     9. require library/classes/…         ← classmap autoloaded
  │
  │  auth.inc.php (in this login path):
  │     1. $session = SessionWrapperFactory::getInstance()->getWrapper()
  │     2. Branch: $_GET['auth'] == 'login' ?
  │        - new AuthUtils('login')->confirmPassword($_POST['authUser'], $_POST['clearPass'])
  │        - on success: $_SESSION['authUser'] = …, $_SESSION['authUserID'] = …
  │        - on failure: authLoginScreen()
  │     3. elseif $_GET['auth'] == 'logout' → authCloseSession() + authLoginScreen()
  │     4. else → AuthUtils::authCheckSession()
  │     5. SessionTracker::isSessionExpired() → logout if true
  │     6. SessionTracker::updateSessionExpiration() (unless $_REQUEST['skip_timeout_reset'])
  │
  │  main_screen.php (after globals.php + auth.inc.php return):
  │     1. SELECT login_mfa_registrations WHERE user_id = $_SESSION['authUserID']
  │     2. If user has TOTP / U2F registered and no form_response yet:
  │        - render MFA challenge form
  │        - exit; user re-submits with the OTP
  │     3. After MFA success (or if no MFA registered):
  │        - SessionTracker::setupSessionDatabaseTracker()
  │        - dispatch Symfony 'main.body.render.nav' and 'main.body.render'
  │        - render the main frameset (Knockout + tabs)
  ▼
interface/main/tabs/main.php                 (the main frameset)
  │  Header::setupHeader(['knockout', 'tabs-theme', 'i18next', 'hotkeys'])
  │  injects i18n, knockout, restoreSession JS
  │  renders top nav, left nav, and the active tab iframe
  ▼
[Each tab loads its own iframe. The iframe URL hits, e.g.,
 interface/patient_file/summary/demographics.php which again does
 require '../globals.php' → same full bootstrap, but auth is now
 a session re-check (no login prompt).]
```

---

## 2. `index.php` (the front controller)

```php
<?php
$site_id = '';
if (!empty($_GET['site'])) {
    $site_id = $_GET['site'];
} elseif (is_dir("sites/" . ($_SERVER['HTTP_HOST'] ?? 'default'))) {
    $site_id = ($_SERVER['HTTP_HOST'] ?? 'default');
} else {
    $site_id = 'default';
}

if (empty($site_id) || preg_match('/[^A-Za-z0-9\\-.]/', $site_id)) {
    die("Site ID '" . htmlspecialchars($site_id, ENT_NOQUOTES) . "' contains invalid characters.");
}

require_once "sites/$site_id/sqlconf.php";

if ($config == 1) {
    header("Location: interface/login/login.php?site=$site_id");
} else {
    header("Location: setup.php?site=$site_id");
}
```

Responsibilities:
- Pick a **site** from URL/host
- Validate the site id (`[A-Za-z0-9\-.]+`)
- Load that site's `sqlconf.php` to learn `$config` (1 = configured)
- Redirect to either the login page or the install wizard

Note: **`index.php` does not open a database connection** — it only
consults the per-site `sqlconf.php` file to know whether the site is
configured. The actual DB connection is opened later by
`interface/globals.php` → `library/sql.inc.php`.

---

## 3. `interface/globals.php` (the "every page" file)

> Source: `interface/globals.php` (854 lines)

This file is the heart of the legacy UI bootstrap. It is the first thing
`require_once`'d by virtually every PHP file in `interface/`, `controllers/`,
`portal/`, etc.

### 3.1 Step-by-step

1. **Autoload** — `require_once dirname(__DIR__) . '/vendor/autoload.php';`
2. **PHP version check** — `OpenEMR\Common\Compatibility\Checker::checkPhpVersion()`; die on fail with 500.
3. **OpenSSL check** — must have `openssl` extension AND `aes-256-cbc` cipher.
4. **Logger** — `$logger = ServiceContainer::getLogger();`
5. **`.env` load** — `Dotenv::createImmutable(...)->load()`
6. **HTTP verify-SSL settings** — set `$GLOBALS['http_verify_ssl']` and
   `$GLOBALS['http_ca_cert']` from `OPENEMR_SETTING_http_verify_ssl` and
   `OPENEMR_SETTING_http_ca_cert`. Loopback addresses always skip verification.
7. **Build paths** — `$webserver_root`, `$web_root`,
   `$server_document_root`. `$web_root` is computed by xor of the two
   paths (handles Apache Alias to a subpath).
8. **Site resolution** — `OE_SITES_BASE`, `OE_SITE_DIR` (read from
   `$_REQUEST['site']` or the HTTP host).
9. **Resolve server host** — closure `$ResolveServerHost` reads
   `HTTP_X_FORWARDED_HOST`, `HTTP_HOST`, `SERVER_NAME`, `SERVER_ADDR` in
   that order. Used for canonical links / OAuth issuer.
10. **Theme / language / locale globals** — read from `$_REQUEST` and
    `$_SESSION`.
11. **CSRF setup** — emit a token, set in session.
12. **require `library/globals.inc.php`** — populates `$GLOBALS` from the
    `globals` table (4,582 lines, ~1,200 globals, drives almost every
    setting in OpenEMR).
13. **require `library/sql.inc.php`** — opens the ADODB connection.
14. **require `library/auth.inc.php`** — checks the session / runs login.
15. **Set up `OEGlobalsBag`** — wraps `$GLOBALS` for typed access
    (`OEGlobalsBag::getInstance()`).
16. **Audit log** — `EventAuditLogger::getInstance()->newEvent('security-access', …)` if needed.
17. **Modules load** — `ModulesApplication` is instantiated; custom
    module `openemr.bootstrap.php` files are `include`d.

### 3.2 `library/globals.inc.php` in detail

A 4,582-line `require` that:
- Defines `$GLOBALS_METADATA` — a giant metadata table for every global
  setting (label, default, help, type, options, ACL, scope).
- Reads `$_SESSION['authUser']`/`['authProvider']` and merges user-specific
  tabs/globals.
- Dispatches `GlobalsInitializedEvent` via Symfony EventDispatcher.
- Loads list_options, layout options, language definitions.
- Defines `xl()`, `xlt()`, `xlj()` translation helpers via the
  `library/translation.inc.php` composer `files` autoload.
- Sets defaults for everything from theme to timezone to encounter date
  format to fee sheet defaults.

This is **the** reason `$GLOBALS` is still in use — the
`library/globals.inc.php` is a single 4,582-line `require_once` that
populates ~1,200 global variables, and the entire legacy codebase
references them by name.

### 3.3 `library/sql.inc.php` in detail

`library/sql.inc.php` is the **second-most-required legacy file**. It
defines the global `sqlStatement`, `sqlQuery`, `sqlInsert`, etc. functions
and opens the ADODB connection.

```php
require_once(__DIR__ . "/sqlconf.php");   // ← loads sites/$site/sqlconf.php
// … uses DatabaseConnectionFactory::createAdodb() and assigns
//     $GLOBALS['adodb']['db'] = …
```

The connection wraps the **`ADODB_mysqli_log`** driver — a custom
subclass of ADODB's `mysqli` driver that pipes every query through
`EventAuditLogger::auditSQLEvent()` (line-by-line SQL audit logging).

After connection, the file defines the global helper functions:

| Function | Purpose |
|---|---|
| `sqlStatement($sql, $binds)` | Run a query. Returns `ADORecordSet`. Calls `HelpfulDie` on error. |
| `sqlStatementThrowException` | Same but throws `SqlQueryException` instead of dying. |
| `sqlStatementNoLog` | Skips audit logging. Use sparingly. |
| `sqlStatementCdrEngine` | Audit-or-noaudit based on `$GLOBALS['audit_events_cdr']`. |
| `sqlQuery($sql, $binds)` | Returns first row as an array. |
| `sqlFetchArray($r)` | Fetches next row from a recordset. |
| `sqlGetLastInsertId()` | Returns last `AUTO_INCREMENT` id. |
| `sqlInsert($sql, $binds)` | Run an INSERT and return the new id. |

The actual implementation lives in
`src/Common/Database/QueryUtils.php` — `library/sql.inc.php` is a thin
forwarder.

### 3.4 `library/auth.inc.php` in detail

Decides what to do based on `$_GET['auth']`:

| `$_GET['auth']` | Behavior |
|---|---|
| `"login"` | `new AuthUtils('login')->confirmPassword($user, $pass)` then set session vars |
| `"logout"` | `EventAuditLogger->newEvent("logout", …)` then `authCloseSession()` then `authLoginScreen(true)` |
| *(neither)* | `AuthUtils::authCheckSession()` — returns false if session no longer valid |

In all paths:
- `SessionTracker::isSessionExpired()` — checks `session_tracker` table
- `SessionTracker::updateSessionExpiration()` — bumps expiry unless
  `skip_timeout_reset` is set (e.g. for background polling)

### 3.5 `SessionUtil` — the four session IDs

`src/Common/Session/SessionUtil.php` defines four logical session IDs,
each a separate cookie:

| Constant | Cookie | `httponly` | `samesite` | Path |
|---|---|---|---|---|
| `CORE_SESSION_ID = "OpenEMR"` | OpenEMR | **false** (JS needs it for `restore_session()`) | Strict | `$web_root` |
| `OAUTH_SESSION_ID = "authserverOpenEMR"` | authserverOpenEMR | true | **None** | `/oauth2/` |
| `API_SESSION_ID = "apiOpenEMR"` | apiOpenEMR | true | (configurable) | `/apis/` |
| `PORTAL_SESSION_ID = "PortalOpenEMR"` | PortalOpenEMR | true | Strict | `/portal/` |

Each ID has its own settings builder (`SessionConfigurationBuilder::forCore`,
`::forApi`, `::forOauth`, `::forPortal`).

Why the JS-readable core cookie? OpenEMR supports multiple parallel
logins for the same user (one per patient in some workflows). The
`restore_session()` JS function reads the cookie and lets the user switch
active sessions without re-authenticating. Tradeoff: opens a small XSS
exposure if a page can write to `document.cookie`.

`sid_bits_per_character = 6` (PHP ≤ 8.3) and `sid_length = 48` are set
for entropy. `gc_maxlifetime = 14400` (4 hours) overrides PHP's default.

---

## 4. Audit logging

The audit subsystem is in `src/Common/Logging/EventAuditLogger.php`.
There are three sinks:

1. **Database** — `log` and `log_comment_encrypt` tables.
2. **Filesystem** — encrypted log files in
   `sites/<id>/documents/logs_and_misc/`.
3. **ATNA syslog** — `audit_atna` global enables syslog TLS audit
   forwarding (audit message format).

Every ADODB query is logged via `ADODB_mysqli_log::Execute` →
`EventAuditLogger::auditSQLEvent($sql, $outcome, $inputarr)`. To skip
audit for a specific query, use `sqlStatementNoLog` (or
`QueryUtils::fetchRecordsNoLog`).

---

## 5. Modules load (`ModulesApplication`)

> Source: `src/Core/ModulesApplication.php` (260 lines)

After the autoloader and the database are up, `ModulesApplication` is
constructed. It:

1. **Laminas MVC** — reads
   `interface/modules/zend_modules/config/application.config.php`,
   builds a Laminas `ServiceManager`, calls `ModuleManager::loadModules()`.
2. **Custom modules** — for every row in `modules` with `mod_active=1`
   and `type != 1`, includes
   `interface/modules/custom_modules/<dir>/openemr.bootstrap.php`.
3. **Security check** — `checkModuleScriptPathForEnabledModule` ensures the
   currently-executing script lives under a folder that is **enabled** in
   this site's `modules` table. Disabled modules cannot serve PHP.
4. **Failure handling** — if a module's `openemr.bootstrap.php` is missing
   after 3 retries, the module is force-disabled in the DB and logged.
5. **Event** — `ModuleLoadEvents::MODULES_LOADED` is dispatched with the
   list of loaded + failed modules.

See [`module-system.md`](./module-system.md) for the full module system.

---

## 6. CSRF

`src/Common/Csrf\CsrfUtils` provides HMAC-SHA256 tokens truncated to 40
hex chars. Two subjects:
- `default` — used by the legacy UI (`globals.php` calls
  `CsrfUtils::setupCsrf()` automatically).
- `api` — used by REST API endpoints (must be passed in `X-CSRF-Token`).

`CsrfInvalidException` is thrown on mismatch. Pages use it transparently
via the `FormActionBar` widget.

---

## 7. The "thin request handler" pattern

Modern pages follow this shape:

```php
<?php
// 1. Boot
$ignoreAuth = false;          // (sometimes)
$sessionAllowWrite = true;    // (only during auth)
require_once(__DIR__ . '/../../globals.php');

use OpenEMR\Common\Acl\AclMain;
use OpenEMR\Common\Acl\AccessDeniedHelper;
use OpenEMR\Core\Header;
use OpenEMR\Services\PatientService;

// 2. ACL
if (!AclMain::aclCheckCore('patients', 'demo')) {
    AccessDeniedHelper::denyWithTemplate('Access denied', 'Patients');
}

// 3. Service call
$patient = (new PatientService())->getOne($puuidString);

// 4. Render (Twig)
$header = Header::setupHeader(['knockout', 'tabs-theme'], false);
echo $twig->render('patient/dashboard.html.twig', [
    'patient' => $patient,
    'header' => $header,
]);
```

Heavy work belongs in `OpenEMR\Services\…` (or `OpenEMR\RestControllers\…`
for HTTP). The request handler is just glue: input → service → template.

The kernel runs every request through a series of Symfony event
subscribers (auth, CSRF, audit, ACL) so handlers do not need to
re-implement them.

---

## 8. The three boot paths

| Surface | Entry | Boot | Session | Kernel |
|---|---|---|---|---|
| **Legacy UI** | `index.php` → `interface/login/login.php` → `interface/main/main_screen.php` | `interface/globals.php` (full) | `OpenEMR` cookie | None (procedural + `OEGlobalsBag`) |
| **Modern UI page** | `interface/patient_file/summary/demographics.php` | `interface/globals.php` (full) | `OpenEMR` cookie | None (procedural) |
| **REST API** | `apis/dispatch.php` | `apis/dispatch.php` → `ApiApplication` → `OEHttpKernel` (Symfony) | `apiOpenEMR` | `OEHttpKernel` + 10 event subscribers |
| **OAuth2 server** | `oauth2/authorize.php` | `oauth2/authorize.php` → `AuthorizationController` | `authserverOpenEMR` | `OEHttpKernel` |
| **FHIR** | `apis/<site>/fhir/...` | `apis/dispatch.php` + `FhirServiceBase` | `apiOpenEMR` | `OEHttpKernel` |
| **Patient portal** | `portal/index.php` | `portal/lib/…` (own) | `PortalOpenEMR` | None (procedural) |
| **CLI** | `bin/…` | `cli/…` → direct service calls | None | `SymfonyCommandRunner` |

`apis/dispatch.php` is the only entry point that uses the **Symfony
HttpKernel** (`OEHttpKernel` wraps Symfony's `HttpKernel` with a
`Request` → `Response` pipeline + 10+ event subscribers in
`ApiApplication::registerEventListeners`).

---

## 9. Page render — `Header::setupHeader()`

> Source: `src/Core/Header.php`

`Header::setupHeader($assets = ['knockout', 'bootstrap', …], $die = true)`
is called by every page. It:
1. Emits `<head>` with all CSS / JS asset tags (URLs are appended with
   `?v=$v_js_includes`).
2. Sets up i18next (calls `i18next.init`).
3. Inlines the `restoreSession` JS.
4. Loads Knockout binding providers.
5. Includes global jQuery, Bootstrap, Knockout, Chart.js, etc.
6. `die()` unless `$die = false` (caller will emit its own body).

---

## 10. See also

- [`overview.md`](./overview.md) — overall layout
- [`multi-site.md`](./multi-site.md) — site resolution
- [`service-layer.md`](./service-layer.md) — service pattern
- [`module-system.md`](./module-system.md) — module loading
- [`../auth/authentication.md`](../auth/authentication.md) — auth details
- [`../database/connection-layer.md`](../database/connection-layer.md) — DB connection
