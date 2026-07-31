# Multi-Site (Multi-Tenant) Model

> **Source paths:** `index.php`, `interface/globals.php`, `library/sqlconf.php`,
> `sites/default/sqlconf.php`, `src/BC/DatabaseConnectionOptions.php`,
> `src/BC/DatabaseConnectionFactory.php`, `src/Common/Auth/OAuth2KeyConfig.php`,
> `version.php`
> **Documented version:** OpenEMR 8.0.1-dev

OpenEMR supports **multiple isolated sites (tenants)** inside a single
codebase deployment. Each site has:

- its own **HTTP host name** (or `?site=` override)
- its own **MySQL/MariaDB database** (a different `$dbase`)
- its own **filesystem document store** (`sites/<id>/documents/`)
- its own **OAuth2 keys, MFA scratch area, certificates**
- its own **theme overrides and custom menus**

This is **filesystem-based isolation**, not row-level multi-tenancy. There
is no `tenant_id` column in the schema. Two installations on the same server
have no shared tables.

---

## 1. Site resolution — `index.php`

The single front controller at the project root (`index.php`):

```php
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

### 1.1 Resolution rules (in priority order)

1. **Query string** `?site=<id>` — explicit override. Highest priority.
2. **HTTP Host header** — `$_SERVER['HTTP_HOST']`. Used when a
   `sites/<host>/sqlconf.php` exists. Lets Apache/Nginx virtual hosts each
   point at a different site.
3. **Fallback `default`** — when no `?site=` is supplied and no matching
   `sites/<host>/` directory exists.

### 1.2 Site ID validation

A site ID is restricted to:
```
[A-Za-z0-9\-.]+
```
Anything else is rejected with `die()` and a sanitized error message. This
prevents path traversal (`../`) and SQL injection in the subsequent
`require_once`.

### 1.3 Output of `index.php`

- If `$config == 1` → redirect to login (`interface/login/login.php?site=…`)
- Else → redirect to install wizard (`setup.php?site=…`)

The actual per-site database is **not** opened by `index.php`. The
`require_once "sites/$site_id/sqlconf.php"` runs the site's config and
exposes `$config` (1 = configured, 0 = not yet configured).

---

## 2. Per-site directory layout

```
sites/
├── default/                            ← fallback site (host = "default" or ?site=default)
│   ├── sqlconf.php                     ★ DB credentials
│   ├── documents/                      ★ Per-site filesystem
│   │   ├── certificates/                  OAuth2 keys, MySQL SSL certs
│   │   │   ├── oaprivate.key
│   │   │   ├── oapublic.key
│   │   │   ├── mysql-ca
│   │   │   ├── mysql-cert
│   │   │   └── mysql-key
│   │   ├── <pid>/                      Patient-scoped uploads
│   │   ├── logs_and_misc/methods/      CryptoGen drive keys
│   │   └── …
│   └── …  (other per-site assets)
├── hospital-a.example.com/
│   ├── sqlconf.php
│   └── documents/
├── clinic-b.example.com/
│   ├── sqlconf.php
│   └── documents/
└── …
```

Only `sqlconf.php` is required to make a site functional. The
`documents/` directory is created on first need by `documents.php`.

---

## 3. `sites/<id>/sqlconf.php`

> Source: `sites/default/sqlconf.php` (template)

```php
<?php
//  Set the variables below to your OpenEMR database connection.

$host   = 'localhost';
$port   = '3306';
$login  = 'openemr';
$pass   = '<password>';
$dbase  = 'openemr';

//  Optional, for SSL database connections:
//  $ssl_ca   = '/path/to/ca.pem';
//  $ssl_cert = '/path/to/client-cert.pem';
//  $ssl_key  = '/path/to/client-key.pem';

//  $config = 1 once database is initialized.
$config = 1;
```

The file defines a plain associative array of credentials. It is loaded
**very early** in the request — before any database calls. The
`DatabaseConnectionOptions::forSite($siteDir)` factory reads it.

### 3.1 SSL / mTLS

`DatabaseConnectionOptions::inferSslPaths($siteDir)` auto-detects:

| File | Purpose |
|---|---|
| `sites/<id>/documents/certificates/mysql-ca` | CA bundle for `PDO::MYSQL_ATTR_SSL_CA` |
| `sites/<id>/documents/certificates/mysql-cert` | Client certificate |
| `sites/<id>/documents/certificates/mysql-key` | Client private key |

If `mysql-ca` exists, the connection is opened with `MYSQLI_CLIENT_SSL`
(`DatabaseConnectionFactory.php` `createAdodb()` and `createMysqli()`). If
`mysql-cert` or `mysql-key` is missing but the other is present, a
`LogicException` is thrown ("MySQL cert or key file missing. You need both
or neither.").

### 3.2 Sockets

`DatabaseConnectionOptions` also supports `socket` instead of host/port.
Either/or — passing both is rejected with an `InvalidArgumentException`.

---

## 4. Site config resolution — `library/sqlconf.php`

`library/sqlconf.php` is a **redirector** — the real per-site file is loaded
via:

```php
<?php
use OpenEMR\Common\System\MissingSiteException;
use OpenEMR\Core\OEGlobalsBag;

$siteDir = OEGlobalsBag::getInstance()->get('OE_SITE_DIR') ?? '';
if (empty($siteDir)) {
    if (!defined('OPENEMR_STATIC_ANALYSIS') || !OPENEMR_STATIC_ANALYSIS) {
        throw new MissingSiteException();
    }
    // GLOBALS may not be defined consistently during static analysis.
    $siteDir = __DIR__ . '/../sites/default';
}

require_once $siteDir . "/sqlconf.php";
```

### 4.1 Why a redirector?

The legacy `library/sqlconf.php` is required by ~hundreds of legacy
files. The redirector pattern lets **every** legacy call resolve the
**current site's** credentials through a single indirection — and lets
tests / static analysis fall back to `sites/default`.

### 4.2 `OE_SITE_DIR` global

`interface/globals.php` (which is the very first thing every UI page
includes) sets:

```php
$GLOBALS['OE_SITE_DIR'] = "$OE_SITES_BASE/" . $site_id;
```

This is the canonical "where am I" global.

### 4.3 Setting `OE_SITE_DIR` from the URL

The site id is determined from the URL host (or `?site=`) **before**
`interface/globals.php` runs. In modern pages this is wired in by the
entry-point file (`interface/globals.php` itself reads
`$_REQUEST['site']` and the host). In legacy pages, the site's
`sqlconf.php` is loaded at the redirector level; the per-host selection
happens at the very top of the request.

---

## 5. `interface/globals.php` — the modern boot

> Source: `interface/globals.php` (854 lines)

`interface/globals.php` is the most-included file in OpenEMR — every
modern UI page does `require_once '../globals.php'`. It does (in order):

1. `require_once dirname(__DIR__) . '/vendor/autoload.php';` — composer autoload
2. PHP version check (`OpenEMR\Common\Compatibility\Checker::checkPhpVersion()`)
3. Loads `.env` (via `Dotenv`)
4. Builds `$webserver_root` and `$web_root`
5. Sets `$GLOBALS['OE_SITES_BASE']`, `$GLOBALS['OE_SITE_DIR']`,
   `$GLOBALS['webroot']`, etc.
6. `require library/globals.inc.php` — populates `$GLOBALS` from the
   `globals` table
7. `require library/sql.inc.php` — opens the ADODB connection
8. `require library/auth.inc.php` — runs `AuthUtils::authCheckSession()` or
   initiates login
9. Initializes CSRF, audit, etc.

The `interface/globals.php` file is **the** site-aware bootstrap. Once it
returns, every `$GLOBALS['OE_SITE_DIR']` is known and the ADODB connection
is bound to that site.

---

## 6. Per-site overrides

Each `sites/<id>/` can override:

| Asset | Default | Override at |
|---|---|---|
| DB credentials | n/a | `sqlconf.php` |
| OAuth2 RSA key pair | (regenerated per-site) | `documents/certificates/oaprivate.key` + `oapublic.key` |
| OAuth2 passphrase / encryption key | (regenerated per-site, stored in `keys` table) | `keys.oauth2key`, `keys.oauth2passphrase` |
| MySQL SSL certs | n/a | `documents/certificates/mysql-{ca,cert,key}` |
| Crypto drive keys | default | `documents/logs_and_misc/methods/` |
| Theme / custom CSS | site global | `interface/themes/<custom>.scss` (compiled into `public/themes/`) |
| Custom menu | standard.json | A module or a per-site JSON override (loaded by `OpenEMR\Menu\Menu` after the global is built) |
| Site address override | HTTP_HOST | `globals.site_addr_oath` (proxy / sidecar nginx) |
| Documents (file uploads) | n/a | `documents/<pid>/...` |
| `oauth2/client-registration` keys | n/a | `documents/certificates/` |
| MFA scratch (U2F challenge) | DB | `users_secure.login_work_area` per user (DB, not per-site) |

The `OAuth2KeyConfig` class (`src/Common/Auth/OAuth2KeyConfig.php`)
verifies and creates the OAuth2 key pair **per site directory**:

```php
$this->privateKey = $siteDir . '/documents/certificates/oaprivate.key';
$this->publicKey  = $siteDir . '/documents/certificates/oapublic.key';
```

The keys are auto-generated on first boot if missing.

---

## 7. The 8.0 removal of `multiple_db`

Pre-8.0 OpenEMR had a `multiple_db` feature that allowed a single site to
straddle multiple physical databases (via a `multiple_db` table that
mapped table-name prefixes to separate connection settings). It was
removed in 8.0.

The modern model assumes **one database per site** and the site is
isolated from other sites by being a different database. Cross-site
queries are not supported; cross-site authentication is impossible because
sessions are bound to a single cookie domain.

---

## 8. Security boundary

- **Filesystem isolation:** the web server user must have read access to
  `sites/<id>/documents/` for the sites it serves, and **no** access to
  other sites' `documents/`. In practice, this is achieved by giving all
  sites the same owning user (the web server user) and trusting the PHP
  code never to read across `OE_SITE_DIR`.
- **Database isolation:** each `sqlconf.php` is its own user/db. A SQL
  user with access to one site cannot read another site because they
  authenticate with different credentials.
- **Session isolation:** session cookies are bound to the host. A session
  cookie for `hospital-a.example.com` is not sent to
  `clinic-b.example.com`.

### 8.1 `checkModuleScriptPathForEnabledModule`

`ModulesApplication::checkModuleScriptPathForEnabledModule()` ensures that
the PHP script being executed lives under a `modules/<folder>/` that is
**enabled in the current site's `modules` table**. This prevents a request
that abuses `?site=evil&mod=…` from running a disabled module's PHP files
under the current site's auth.

---

## 9. Common deployment patterns

| Pattern | Configuration |
|---|---|
| Single site, single domain | Apache vhost → `…/openemr/`. `sites/default/` is used. |
| Multi-tenant SaaS, one codebase | N vhosts (one per tenant) → same `…/openemr/`. Each vhost's `ServerName` matches a `sites/<vhost>/sqlconf.php`. |
| Per-customer dev environments | `?site=customer-x&…` query override. Allows a single Apache vhost to serve many customers. |
| Local + production | `localhost` and `myhost.com` both point at the same codebase; create `sites/localhost/` for dev DB. |

The `?site=` override is the primary dev convenience. It is **not** a
recommended production control because it is visible in the URL.

---

## 10. See also

- [`bootstrap-flow.md`](./bootstrap-flow.md) — full request lifecycle
- [`../database/connection-layer.md`](../database/connection-layer.md) — how
  the site's `sqlconf.php` flows into ADODB / DBAL connections
- [`../auth/oauth2-server.md`](../auth/oauth2-server.md) — per-site OAuth2
  keys
- `index.php` — site resolution
- `library/sqlconf.php` — site redirector
- `sites/default/sqlconf.php` — template
- `src/BC/DatabaseConnectionOptions.php` — typed credential value object
