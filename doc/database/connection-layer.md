# Database Connection Layer

> **Source paths:** `library/sql.inc.php`, `src/Common/Database/QueryUtils.php`,
> `src/BC/DatabaseConnectionFactory.php`, `src/BC/DatabaseConnectionOptions.php`,
> `library/ADODB_mysqli_log.php`, `src/Common/Database/ConnectionManager.php`,
> `src/Common/Database/ConnectionType.php`
> **Documented version:** OpenEMR 8.0.1-dev

OpenEMR's connection layer is a **two-tier** stack: legacy code uses
ADODB 5 (custom subclass with audit logging) and modern code can use
either ADODB (via `QueryUtils`) or **Doctrine DBAL 4** (via
`DatabaseConnectionFactory` + `ConnectionManager`). Both tiers share
the same underlying `sqlconf.php` credentials and the same
`mysqli`/`pdo_mysql` driver.

---

## 1. The two tiers

| Tier | Library | When used |
|---|---|---|
| **Legacy** | ADODB 5.22 + custom `ADODB_mysqli_log` driver | ~hundreds of legacy files (`library/`, `interface/`, `controllers/`). Exposed via global functions `sqlStatement`, `sqlQuery`, `sqlInsert`. |
| **Modern** | Doctrine DBAL 4.4 (new) | New code in `src/`. Optional; `QueryUtils` is the preferred static facade for both tiers. |

Both tiers:
- Read credentials from `sites/<id>/sqlconf.php`
- Default to `utf8mb4` charset
- Run `SET NAMES utf8mb4` and `SET sql_mode = ''` on connect
- Support SSL/mTLS via `documents/certificates/mysql-{ca,cert,key}`
- Support persistent connections via `enable_database_connection_pooling`
  or `p:<host>` host prefix

---

## 2. Site config resolution

```
       browser
          │
          ▼
       index.php
          │  GET ?site=<id>  OR  $_SERVER['HTTP_HOST']
          │  require "sites/$site_id/sqlconf.php"
          ▼
   sites/<id>/sqlconf.php       defines $host, $port, $login, $pass, $dbase
          │
          ▼
   library/sqlconf.php          require_once $OE_SITE_DIR . "/sqlconf.php"
          │
          ▼
   library/sql.inc.php          DatabaseConnectionFactory::createAdodb()
                                $GLOBALS['adodb']['db'] = $conn
                                $GLOBALS['dbh']         = $conn->_connectionID
```

### 2.1 `library/sql.inc.php` (the boot)

```php
require_once(__DIR__ . "/sqlconf.php");   // ← reads sites/<id>/sqlconf.php

if (!defined('ADODB_FETCH_ASSOC')) define('ADODB_FETCH_ASSOC', 2);
$ADODB_LASTDB = 'mysqli_log';              // skips ADODB's auto-driver-loader

if (!defined('OPENEMR_STATIC_ANALYSIS') || !OPENEMR_STATIC_ANALYSIS) {
    $config = DatabaseConnectionOptions::forSite($GLOBALS['OE_SITE_DIR']);
    $persistent = DatabaseConnectionFactory::detectConnectionPersistenceFromGlobalState();
    $database = DatabaseConnectionFactory::createAdodb($config, $persistent);
    $GLOBALS['adodb']['db'] = $database;
    $GLOBALS['dbh'] = $database->_connectionID;

    if (!$GLOBALS['dbh']) {
        if ($host === "localhost") echo "Check that mysqld is running.<p>";
        else echo "Check that you can ping the server " . text($host) . ".<p>";
        HelpfulDie("Could not connect to server!", QueryUtils::getLastError());
    }

    $GLOBALS['adodb']['db']->SetFetchMode(ADODB_FETCH_ASSOC);
}
```

`OPENEMR_STATIC_ANALYSIS` is defined by PHPStan's bootstrap so static
analysis can parse files that would otherwise require a live DB.

### 2.2 `DatabaseConnectionOptions` (value object)

> Source: `src/BC/DatabaseConnectionOptions.php` (254 lines)

A readonly value object that wraps the site's `sqlconf.php` array:

```php
final readonly class DatabaseConnectionOptions
{
    public string $charset;     // always 'utf8mb4'

    public function __construct(
        public string $dbname,
        public string $user,
        #[SensitiveParameter] public string $password,
        public ?string $host = null,
        public ?int $port = null,
        public ?string $unixSocket = null,
        public ?string $sslCaPath = null,
        public ?array $sslClientCert = null,
    ) { … }

    public static function forSite(string $siteDir): self { … }
    public static function fromSqlconf(array $sqlconf, array $ssl = []): self { … }
    public static function inferSslPaths(string $siteDir): array { … }
    public function toDbalParams(): array { … }
    public function __debugInfo(): array { … }  // redacts password
}
```

Highlights:
- **`#[SensitiveParameter]`** on `$password` prevents it from leaking
  into stack traces / `var_dump` / `error_log`.
- **Validation** in the constructor: either `(host + port)` or
  `unixSocket` must be set; both is rejected.
- **Auto-detect SSL** via `inferSslPaths($siteDir)`: looks for
  `mysql-ca`, `mysql-cert`, `mysql-key` in `documents/certificates/`.
- **`toDbalParams()`** produces the array expected by
  `Doctrine\DBAL\DriverManager::getConnection()`.
- **`__debugInfo()`** redacts the password to `[REDACTED]`.

### 2.3 `DatabaseConnectionFactory` (driver factory)

> Source: `src/BC/DatabaseConnectionFactory.php` (181 lines)

```php
class DatabaseConnectionFactory
{
    public static function createAdodb(
        DatabaseConnectionOptions $config,
        bool $persistent = false,
    ): ADODB_mysqli_log;

    public static function createDbal(
        DatabaseConnectionOptions $config,
        bool $persistent,
    ): Connection;

    public static function createMysqli(
        DatabaseConnectionOptions $config,
        bool $persistent,
    ): mysqli;

    public static function detectConnectionPersistence(
        ParameterBag $globals,
        SessionWrapperInterface $session,
    ): bool;

    public static function detectConnectionPersistenceFromGlobalState(): bool;
}
```

### 2.4 Persistence detection

A connection is persistent (`PConnect`/`p:<host>`) if any of:
- `$GLOBALS['connection_pooling_off']` is set → `false`
- `$GLOBALS['enable_database_connection_pooling']` is true → `true`
- `$_SESSION['enable_database_connection_pooling']` is set → `true`
- Default → `false`

### 2.5 Three connection types

| Method | Driver | Use |
|---|---|---|
| `createAdodb()` | ADODB 5.22 + `ADODB_mysqli_log` | Legacy (most of the codebase). The audit-logging wrapper. |
| `createDbal()` | Doctrine DBAL 4.4 (`pdo_mysql`) | Modern, type-safe code. |
| `createMysqli()` | `mysqli` | Used by the installer and a few scripts. |

All three set `utf8mb4` and `SET sql_mode = ''`.

---

## 3. `QueryUtils` — the static facade

> Source: `src/Common/Database/QueryUtils.php` (475 lines)

Every new (and most legacy) code calls `QueryUtils` rather than the
underlying ADODB / DBAL. It's the only place that knows about ADODB.

```php
namespace OpenEMR\Common\Database;

class QueryUtils
{
    public static function listTableFields($table): string[];
    public static function escapeTableName(string $table): string;
    public static function escapeColumnName($columnName, $tables = []): string;
    public static function fetchRecordsNoLog($sql, $binds = []): array;
    public static function fetchTableColumn($sql, $column, $binds = []): array;
    public static function fetchSingleValue($sql, $column, $binds = []);
    public static function fetchRecords($sql, $binds = [], $noLog = false): array;
    public static function fetchTableColumnAssoc($sql, $column, $binds = []): array;
    public static function fetchArrayFromResultSet($resultSet): array|false;
    public static function sqlStatementThrowException($sql, $binds = [], $noLog = false);
    public static function getLastError(): string;
    public static function getLastInsertId(): int;
    public static function getLogger(): LoggerInterface;
    public static function getADODB(): ADODB_mysqli_log;
    public static function startTransaction(): void;
    public static function commitTransaction(): void;
    public static function rollbackTransaction(): void;
    public static function sqlInsert($sql, $binds): int;
    public static function selectHelper($sqlUpToFromStatement, $map): array|null;
    public static function getPagination($sql, $binds, $page, $pageSize): QueryPagination;
}
```

### 3.1 Usage

```php
use OpenEMR\Common\Database\QueryUtils;

// SELECT
$rows = QueryUtils::fetchRecords(
    'SELECT pid, fname, lname FROM patient_data WHERE pid = ?',
    [$pid]
);

// INSERT
$id = QueryUtils::sqlInsert(
    'INSERT INTO foo (a, b) VALUES (?, ?)',
    [$a, $b]
);

// Transaction
QueryUtils::startTransaction();
try {
    QueryUtils::sqlStatementThrowException('UPDATE …', $binds);
    QueryUtils::commitTransaction();
} catch (\Throwable $e) {
    QueryUtils::rollbackTransaction();
    throw $e;
}

// Pagination
$page = QueryUtils::getPagination($sql, $binds, $_GET['page'] ?? 0, 25);
```

### 3.2 Audit toggle

`fetchRecords(..., $noLog = false)` calls
`sqlStatementThrowException(..., $noLog = false)`, which calls
`ADODB_mysqli_log::Execute` (audit) when `noLog=false` or
`ADODB_mysqli_log::ExecuteNoLog` when `noLog=true`.

---

## 4. `ADODB_mysqli_log` — the audit-logging driver

> Source: `library/ADODB_mysqli_log.php` (68 lines)

A custom ADODB driver that **wraps every query in audit logging**:

```php
class ADODB_mysqli_log extends ADODB_mysqli
{
    function Execute($sql, $inputarr = false, $insertNeedReturn = false)
    {
        $retval = parent::Execute($sql, $inputarr);
        if ($retval === false) {
            $outcome = false;
            OEGlobalsBag::getInstance()->set('last_mysql_error', $this->ErrorMsg());
            OEGlobalsBag::getInstance()->set('last_mysql_error_no', $this->ErrorNo());
        } else {
            $outcome = true;
        }
        if ($insertNeedReturn) {
            OEGlobalsBag::getInstance()->set('lastidado', $this->Insert_ID());
        }
        global $skipAuditLog;
        if (empty($skipAuditLog)) {
            EventAuditLogger::getInstance()->auditSQLEvent($sql, $outcome, $inputarr);
        }
        return $retval;
    }

    function ExecuteNoLog($sql, $inputarr = false)
    {
        return parent::Execute($sql, $inputarr);
    }
}
```

### 4.1 What this means

- **Every** query that goes through `ADODB_mysqli_log::Execute` is
  audited (`log` and `log_comment_encrypt` tables, ATNA syslog, and
  filesystem).
- To skip audit for a specific call, use `ExecuteNoLog` (or
  `sqlStatementNoLog` in legacy code, `QueryUtils::fetchRecordsNoLog` in
  new code).
- The `$skipAuditLog` global lets an entire request skip audit (e.g.
  health checks).

### 4.2 Why a custom driver?

It is the **only point** through which every SQL statement in the
codebase flows (because every legacy call goes through
`sqlStatement()` → `QueryUtils::sqlStatementThrowException` →
`ADODB_mysqli_log::Execute`). A small wrapper at the driver level
catches everything without polluting the call sites.

---

## 5. `ConnectionManager` + `ConnectionType` (multi-connection future)

> Source: `src/Common/Database/ConnectionManager.php` (60 lines)
> Source: `src/Common/Database/ConnectionType.php` (30 lines)

```php
enum ConnectionType
{
    case Main;   // The main read/write connection
    case Audit;  // Used during audit operations (separate from Main)
}

class ConnectionManager
{
    private array $factories = [];
    private array $connections = [];

    public function register(ConnectionType $type, Closure $factory): void;
    public function get(ConnectionType $type): Connection;
}
```

### 5.1 The two-connection rationale

`ConnectionType::Audit` exists to support:
- **Offsite audit** — the audit connection can point at a different
  database / server, so audit logs survive even if the main DB is wiped.
- **Autoincrement preservation** — the main DB's `LAST_INSERT_ID()` is
  not disturbed by the audit insert (which would otherwise consume a
  new auto-increment value on the audit-master table).
- **Circular dependency break** — auditing middleware can use the audit
  connection without re-entering the main middleware.

> This is a **forward-looking** abstraction. In 8.0.1 most code still
> uses a single connection. The Manager + Enum are designed to support
> a future where audit and main are physically separated.

### 5.2 Registration

```php
$manager = new ConnectionManager();
$manager->register(ConnectionType::Main, function () use ($config) {
    return DatabaseConnectionFactory::createDbal($config, false);
});
$manager->register(ConnectionType::Audit, function () use ($auditConfig) {
    return DatabaseConnectionFactory::createDbal($auditConfig, false);
});

$main = $manager->get(ConnectionType::Main);
$audit = $manager->get(ConnectionType::Audit);
```

Connections are created lazily on first `get()`.

---

## 6. Global helpers (legacy)

`library/sql.inc.php` defines these as plain functions:

| Function | Behavior |
|---|---|
| `sqlStatement($sql, $binds = false)` | Throws `SqlQueryException` internally; calls `HelpfulDie` on error. |
| `sqlStatementThrowException($sql, $binds)` | Re-throws `SqlQueryException`. |
| `sqlStatementNoLog($sql, $binds, $throw)` | Skips audit. Optional `throw` instead of `HelpfulDie`. |
| `sqlStatementCdrEngine($sql, $binds)` | Audit or no-audit based on `$GLOBALS['audit_events_cdr']`. |
| `sqlFetchArray($r)` | Fetches next row from a recordset. |
| `sqlQuery($sql, $binds)` | Returns first row as an array. |
| `sqlGetLastInsertId()` | Returns last `AUTO_INCREMENT` id. |
| `sqlInsert($sql, $binds)` | Runs INSERT, returns new id. |
| `privStatement` / `privQuery` | "Privileged" — used for queries that must run **before** session creation (e.g. MFA registrations). |

All delegate to `QueryUtils` under the hood.

### 6.1 Why "priv" variants?

`privStatement` / `privQuery` exist because certain queries
(e.g. looking up `users_secure.password` to decrypt a TOTP secret
during MFA) must run **before** the user is fully authenticated. They
use a separate connection that does not require a logged-in user. The
implementation lives in `library/classes/Installer.class.php` and a few
helpers in `library/sql.inc.php`.

---

## 7. Migration from `$GLOBALS['adodb']['db']` to `OEGlobalsBag`

Legacy code reads the ADODB connection via:

```php
$conn = $GLOBALS['adodb']['db'];
$row = $GLOBALS['adodb']['db']->GetRow($sql, $binds);
```

New code should use the `OEGlobalsBag` typed wrapper:

```php
$conn = OEGlobalsBag::getInstance()->get('adodb')['db'];
$row = QueryUtils::fetchRecords($sql, $binds);
```

`OEGlobalsBag` extends `Symfony\Component\HttpFoundation\ParameterBag`
and bridges writes to `$GLOBALS[$key]` automatically
(`OEGlobalsBag::set()` and `get()` both consult both stores). See
[`../architecture/coding-standards.md`](../architecture/coding-standards.md)
for the typed-getter pattern.

### 7.1 The recommended path forward

```
1. Replace sqlStatement($sql, $binds)         → QueryUtils::fetchRecords($sql, $binds)
2. Replace sqlQuery($sql, $binds)             → QueryUtils::fetchSingleValue($sql, 'col', $binds)
3. Replace sqlInsert($sql, $binds)            → QueryUtils::sqlInsert($sql, $binds)
4. Replace sqlGetLastInsertId()               → QueryUtils::getLastInsertId()
5. Replace $GLOBALS['adodb']['db']->…         → QueryUtils::getADODB()->…
6. Wrap in a service                          → see architecture/service-layer.md
```

Rector rules in `tests/Rector/Rules/` automate some of this.

---

## 8. Static-analysis guards

`library/sql.inc.php` guards the connection with:

```php
if (!defined('OPENEMR_STATIC_ANALYSIS') || !OPENEMR_STATIC_ANALYSIS) {
    // … actually connect
}
```

`library/sqlconf.php` falls back to `sites/default` if `OE_SITE_DIR` is
missing during static analysis.

`OPENEMR_STATIC_ANALYSIS = true` is set in `.phpstan/phpstan_include_paths.php`
and in `rector-bootstrap.php` so PHPStan and Rector can parse the
codebase without a live database.

---

## 9. See also

- [`schema-overview.md`](./schema-overview.md) — the 280 tables
- [`migrations.md`](./migrations.md) — schema evolution
- [`../architecture/coding-standards.md`](../architecture/coding-standards.md)
  — `QueryUtils` is the standard
- [`../architecture/bootstrap-flow.md`](../architecture/bootstrap-flow.md)
  — when the connection opens
