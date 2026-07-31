# Coding Standards

> **Source paths:** `openemr-reference/CLAUDE.md`, `phpcs.xml.dist`,
> `phpstan.neon.dist`, `rector.php`, `composer.json` `extra`,
> `tests/PHPStan/Rules/`, `tests/Rector/Rules/`
> **Documented version:** OpenEMR 8.0.1-dev

OpenEMR's coding standards combine **PHP_CodeSniffer** (PSR-12 with
permissive options), **PHPStan level 10** with custom rules, and **Rector**
for automated modernization. All three are wired into the `composer
code-quality` script and run in **pre-commit hooks** (via `prek` or
`pre-commit`).

---

## 1. Indentation, line endings, file encoding

| Rule | Value | Source |
|---|---|---|
| Indent | **4 spaces, no tabs** | `phpcs.xml.dist` → `Generic.WhiteSpace.DisallowTabIndent` |
| Line endings | **LF (Unix)** | `.gitattributes` (not shown) — all files LF |
| Trailing whitespace | Forbidden | `Squiz.WhiteSpace.SuperfluousWhitespace` (excludes end-of-file + empty lines) |
| File header | PHPDoc block required | `PSR12.Files.FileHeader` |
| Tag style | Open `<?php` is the first content | `Generic.PHP.CharacterBeforePHPOpeningTag` |
| Max line length | **120 columns** (report width) | `phpcs.xml.dist` `arg name="report-width"` |

---

## 2. `declare(strict_types=1)`

> Adopted for new files, growing coverage. Legacy files in `library/`,
> `interface/`, `controllers/`, and `portal/` do **not** yet use it.

```php
<?php

declare(strict_types=1);

namespace OpenEMR\Services;

class ExampleService extends BaseService
{
    …
}
```

Examples that **do** declare strict types:
`src/BC/DatabaseConnectionFactory.php`, `src/BC/DatabaseConnectionOptions.php`,
`src/Common/Database/ConnectionManager.php`, `src/Common/Database/ConnectionType.php`.

---

## 3. Namespaces

### 3.1 PSR-4

- **Prefix:** `OpenEMR\`
- **Root:** `src/`
- **Composer mapping:** `"psr-4": { "OpenEMR\\": "src" }` (`composer.json`)

`library/classes/` is a **classmap** (not PSR-4) and uses no namespace.

### 3.2 Sub-namespace conventions

| Sub-namespace | What lives there |
|---|---|
| `OpenEMR\Services\*` | Domain services (one per table/concept). |
| `OpenEMR\RestControllers\*` | REST API controllers. |
| `OpenEMR\FHIR\*` | FHIR R4 resources + serialization. |
| `OpenEMR\Events\*` | Symfony event classes (~80 events). |
| `OpenEMR\Common\*` | Cross-cutting utilities: `Acl`, `Auth`, `Database`, `Http`, `Session`, `Logging`, `Crypto`, `Csrf`, `Uuid`, `ORDataObject`, `Twig`, `Forms`, `Command`, `Session\Predis`, `System`, `Translation`, `Utils`, `ValueObjects`, `Enum`, `Http`, `Layouts`, `Crypto`, `Forms`, `Logging`, `Orders`, `System`, `Translation`, `Twig`, `Utils`, `Uuid`, `ValueObjects`, `DirectMessaging`, `Compatibility`. |
| `OpenEMR\Core\*` | `Kernel`, `OEGlobalsBag`, `ModulesApplication`, `Header`, `Traits`, `OEHttpKernel`, `ModulesClassLoader`, `AbstractModuleActionListener`, `AbstractModuleActionTrait`. |
| `OpenEMR\BC\*` | "Boundary" layer — modern connection factory, value objects. |
| `OpenEMR\Billing\*` | X12 EDI 837P/I, HCFA, ParseERA, SFTP, clearinghouse integration. |
| `OpenEMR\ClinicalDecisionRules\*` | Modern CDR engine. |
| `OpenEMR\Cqm\*` | CQM rule engine (modern). |
| `OpenEMR\Reports\*` | Modern report classes. |
| `OpenEMR\Gacl\*` | `Gacl`, `GaclApi` — fork of phpGACL. |
| `OpenEMR\OeUI\*` | Page chrome helper. |
| `OpenEMR\Patient\Cards\*` | Dashboard view cards. |
| `OpenEMR\Tabs\*` | `TabsWrapper` (encounter sub-tabs). |
| `OpenEMR\Menu\*` | Menu JSON loader. |
| `OpenEMR\Pharmacy\*` | ePrescribing + Pharmacy. |
| `OpenEMR\PaymentProcessing\*` | Payment gateway integration. |
| `OpenEMR\Reminder\*` | Patient reminders engine. |
| `OpenEMR\Pdf\*` | PDF generation helpers. |
| `OpenEMR\Rx\*` | Prescription utilities. |
| `OpenEMR\Telemetry\*` | Telemetry reporting service. |
| `OpenEMR\Tools\*` | Internal CLI tools. |
| `OpenEMR\USPS\*` | USPS address validation. |
| `OpenEMR\Validators\*` | `ProcessingResult` + request validators. |
| `OpenEMR\Easipro\*`, `OpenEMR\Health\*`, `OpenEMR\MedicalDevice\*`, `OpenEMR\S sphere\*` | Specialty modules. |

### 3.3 Use-statement rules (`phpcs.xml.dist`)

- **Alphabetical sorting** — `SlevomatCodingStandard.Namespaces.AlphabeticallySortedUses`
- **No useless aliases** — `SlevomatCodingStandard.Namespaces.UselessAlias`
- **No unused uses** (with annotation search) — `SlevomatCodingStandard.Namespaces.UnusedUses`

Disabled for now (TODO):
- `Namespaces.MultipleUsesPerLine`
- `Namespaces.UseDoesNotStartWithBackslash`
- `Namespaces.UseFromSameNamespace`

---

## 4. File headers (PHPDoc)

All PHP files start with the OpenEMR docblock. `PSR12.Files.FileHeader`
enforces it. Template (preserve existing authors when editing):

```php
<?php

/**
 * Brief description of what this file does.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @author    Author Name <author@email.com>
 * @copyright Copyright (c) YEAR Author Name or Organization
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */
```

---

## 5. Service pattern

All new domain services **must** extend `OpenEMR\Services\BaseService`
(`src/Services/BaseService.php`). Enforced by convention and PHPStan
(`tests/PHPStan/Rules/`).

```php
<?php

declare(strict_types=1);

namespace OpenEMR\Services;

class ExampleService extends BaseService
{
    public const TABLE_NAME = 'example_table';

    public function __construct()
    {
        parent::__construct(self::TABLE_NAME);
    }
}
```

`BaseService` provides:
- Field discovery via `SHOW COLUMNS`
- Auto-increment detection (auto-skipped in INSERT/UPDATE)
- Event injection (`OEGlobalsBag::getInstance()->getKernel()->getEventDispatcher()`)
- `search($search, $isAndCondition)` → `FhirSearchWhereClauseBuilder`
- UUID column hydration via `UuidRegistry::uuidToString()`
- FHIR date prefix parsing (`eq`/`ne`/`gt`/`lt`/`ge`/`le`/`sa`/`eb`/`ap`)
- PSR-3 logger
- `selectHelper`, `getFreshId`, `filterData`, `getIdByUuid`, `getUuidById`

See [`service-layer.md`](./service-layer.md) for the full pattern.

---

## 6. `OEGlobalsBag` instead of `$GLOBALS`

> New code must use `OEGlobalsBag` (a typed wrapper over `Symfony\Component\HttpFoundation\ParameterBag`).

### 6.1 Class

`src/Core/OEGlobalsBag.php`:
- Extends `Symfony\Component\HttpFoundation\ParameterBag`
- Implements the **SingletonTrait** — `OEGlobalsBag::getInstance()`
- `set($key, $value)` writes through to `$GLOBALS[$key] = $value` for backward
  compatibility with legacy code.
- `get($key, $default)` consults both the bag **and** `$GLOBALS` (since
  legacy code may have written to `$GLOBALS` directly).
- `hasKernel()`, `getKernel()` — fetch the OpenEMR `Kernel` instance.

### 6.2 Typed getters (Symfony's `ParameterBag`)

| Use | Instead of | Method |
|---|---|---|
| `$bag->getString('foo')` | `(string) $bag->get('foo')` | `getString` |
| `$bag->getInt('count')` | `(int) $bag->get('count')` | `getInt` |
| `$bag->getBoolean('flag')` | `(bool) $bag->get('flag')` | `getBoolean` |
| `$bag->getDigits('pid')` | `preg_replace('/[^0-9]/', '', $bag->get('pid'))` | `getDigits` |
| `$bag->getAlpha('name')` | `preg_replace('/[^A-Za-z]/', '', $bag->get('name'))` | `getAlpha` |
| `$bag->getAlnum('code')` | `preg_replace('/[^A-Za-z0-9]/', '', $bag->get('code'))` | `getAlnum` |
| `$bag->getEnum('status', StatusEnum::class)` | `StatusEnum::tryFrom($bag->get('status'))` | `getEnum` |
| `$bag->getKernel()` | `OEGlobalsBag::getInstance()->get('kernel')` | `getKernel` (typed Kernel) |

PHPStan custom rules forbid direct reads of `$GLOBALS` from new code.

### 6.3 Migration path

Legacy code still writes to `$GLOBALS['adodb']['db']`, `$GLOBALS['OE_SITE_DIR']`,
`$GLOBALS['webroot']`, etc. The bag's `set()` and `get()` both bridge to
`$GLOBALS` so that both styles see the same value during the transition.

---

## 7. Database access

> See `database/connection-layer.md` for full detail.

**Use `QueryUtils` for queries. Use the centralized `DatabaseConnectionFactory`
if you must instantiate a new connection.** Do not instantiate connections
directly.

```php
use OpenEMR\Common\Database\QueryUtils;

// SELECT
$rows = QueryUtils::fetchRecords('SELECT * FROM patient_data WHERE pid = ?', [$pid]);

// INSERT
$id = QueryUtils::sqlInsert('INSERT INTO foo (a, b) VALUES (?, ?)', [$a, $b]);

// Transactional
QueryUtils::startTransaction();
try {
    QueryUtils::sqlStatementThrowException('UPDATE …', $binds);
    QueryUtils::commitTransaction();
} catch (\Throwable $e) {
    QueryUtils::rollbackTransaction();
    throw $e;
}
```

---

## 8. Static analysis — PHPStan level 10

> Source: `phpstan.neon.dist`

```yaml
level: 10
paths:
  - src
  - interface
  - library
  - …
```

Level 10 is the strictest level — every type, nullability, generics, and
PHPDoc is checked. Custom rules in `tests/PHPStan/Rules/` (PSR-4:
`OpenEMR\PHPStan\Rules\`) add:
- Forbidden globals (e.g. `$GLOBALS['adodb']` access patterns)
- Forbidden direct instantiations
- Namespace rules
- Migration of `sqlStatement` to `QueryUtils`

Baseline is split per-identifier via `shipmonk/phpstan-baseline-per-identifier`:
regenerate with `composer phpstan-baseline`.

### 8.1 PHPStan stubs / scan files

`phpstan.neon.dist` registers:
- `.phpstan/phpstan_panther_alias.php`
- `.phpstan/phpstan_include_paths.php`
- `library/sql.inc.php`
- `interface/modules/custom_modules/oe-module-faxsms/.phpstan/SignalWireStubs.php`

### 8.2 Tip for static analysis guards

`library/sql.inc.php` guards the DB connection with
`if (!defined('OPENEMR_STATIC_ANALYSIS') || !OPENEMR_STATIC_ANALYSIS) { … }`
so PHPStan can parse files that would otherwise require a live DB.

`library/sqlconf.php` falls back to `sites/default` if `OE_SITE_DIR` is
missing during static analysis.

---

## 9. Rector

> Source: `rector.php`, `rector-globals.php`, `rector-bootstrap.php`

Rector is used for automated code modernization (e.g. migrating
`$GLOBALS['foo']` → `OEGlobalsBag::getInstance()->get('foo')`, replacing
`sqlStatement` with `QueryUtils`, adding `declare(strict_types=1)`).

```bash
composer rector-check     # dry-run
composer rector-fix       # apply
```

Custom Rector rules live in `tests/Rector/Rules/` (PSR-4:
`OpenEMR\Rector\Rules\`).

---

## 10. Pre-commit hooks

> Source: `openemr-reference/CLAUDE.md`

Install with:
```bash
prek install                 # preferred (Rust pre-commit runner)
# OR
pre-commit install
```

Then before every commit:
```bash
prek run --all-files
```

Hooks run (in order):
- codespell
- conventional-commits
- php-syntax-check (`php -l` on all files)
- phpcbf / phpcs
- phpstan
- rector-check
- require-checker
- eslint
- stylelint
- ramsey/conventional-commits (commit message)
- ... and others

Commit messages are validated against **Conventional Commits** in CI.

---

## 11. Commit messages — Conventional Commits

> Source: `composer.json` `extra.ramsey/conventional-commits.config`

```
<type>(<scope>): <description>

[optional body — wrapped at 72 chars]

[optional footer(s)]
```

| Aspect | Rule |
|---|---|
| Types | `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test` (all lowercase) |
| Scope | kebab-case, optional |
| Description case | free-form (no enforced case) |
| Body | optional, wrap at 72 cols |
| Required footers | none |

Examples:
```
feat(api): add PATCH support for patient resource
fix(calendar): correct date parsing for recurring events
chore(deps): bump monolog/monolog to 3.10.0
refactor(services): migrate BaseService to typed property hooks
```

---

## 12. JS / SCSS conventions

| Tool | Rule | Source |
|---|---|---|
| ESLint | `eslint '**/*.js' --quiet` | `package.json` |
| Stylelint | `npx stylelint '**/*.{css,scss}'` (with `stylelint-config-sass-guidelines` and `stylelint-config-standard`) | `package.json` |
| Stylelint order | `stylelint-order` 6.0.4 enforces property order | `package.json` |

---

## 13. Commit hygiene rules (enforced)

1. **No new `$GLOBALS` reads** in `src/`. Use `OEGlobalsBag`.
2. **No `sqlStatement` calls in new `src/` code**. Use `QueryUtils`.
3. **No `new \PDO(...)` / `new mysqli(...)` outside of `src/BC/`**. Use
   `DatabaseConnectionFactory`.
4. **No direct ADODB instantiation** in new code. Use
   `QueryUtils::getADODB()` or `ConnectionManager`.
5. **All new services extend `BaseService`**.
6. **Strict types on all new `src/` files**.
7. **File header PHPDoc required** for every PHP file.
8. **No mixing template engines** in a single file. Twig or Smarty or PHP —
   pick one.

---

## 14. See also

- [`overview.md`](./overview.md) — high-level project structure
- [`service-layer.md`](./service-layer.md) — BaseService pattern
- [`module-system.md`](./module-system.md) — how to add a custom module
- [`../database/connection-layer.md`](../database/connection-layer.md) — DBAL + ADODB
- [`tech-stack.md`](./tech-stack.md) — exact versions of every dependency
