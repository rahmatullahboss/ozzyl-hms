# Database Migrations

> **Source paths:** `sql/database.sql`, `sql/X_Y_Z-to-A_B_C_upgrade.sql`,
> `src/Services/Utils/SQLUpgradeService.php`, `library/classes/Installer.class.php`,
> `sql_upgrade.php`, `sql_patch.php`, `version.php`
> **Documented version:** OpenEMR 8.0.1-dev (`v_database = 535`)

OpenEMR does **not** use Doctrine Migrations, Flyway, Liquibase, or any
other off-the-shelf migration tool. Schema evolution is handled by:

1. A custom **`#If*` meta-language** in `sql/X_Y_Z-to-A_B_C_upgrade.sql`
   upgrade scripts, parsed by
   `OpenEMR\Services\Utils\SQLUpgradeService`.
2. **`sql_upgrade.php`** (between releases) and **`sql_patch.php`**
   (between releases, full-screen GUI) to apply them.
3. **`Installer.class.php`** for fresh installs (uses raw `mysqli` to
   import `sql/database.sql`).
4. **Hand-curated updates** to `sql/database.sql` — the canonical schema
   — for every change.

> The Composer `require` for `doctrine/migrations` is **declared but not
> actually used**. The comment in `CLAUDE.md` saying "New schema changes
> use Doctrine Migrations" is aspirational — current practice is the
> meta-language.

---

## 1. Version model (`version.php`)

| Constant | Current | Used for |
|---|---|---|
| `$v_database` | **535** | DB upgrade detection. **Must** match the `v_database` comment in `sql/database.sql`; CI fails otherwise. |
| `$v_acl` | **12** | ACL upgrade detection. |
| `$v_realpatch` | `0` | Real patch (incremented when releasing a patch for a production version). |
| `$v_major` / `$v_minor` / `$v_patch` | `8` / `0` / `1` | Display only. |
| `$v_tag` | `-dev` | Display. |
| `$v_js_includes` | `82` (prod) / `md5(microtime())` (dev) | Cache-bust query strings. |

```php
// version.php
$v_major    = '8';
$v_minor    = '0';
$v_patch    = '1';
$v_tag      = '-dev';
$v_realpatch= '0';
$v_database = 535;
$v_acl      = 12;
$v_js_includes = 82;
```

The `version` table (one row) mirrors `$v_database` so the upgrade
scripts can detect "current DB version" vs "target DB version".

---

## 2. Upgrade scripts

32 scripts, named `<from>-to-<to>_upgrade.sql`, applied in order:

| From | To | File |
|---|---|---|
| 2.6.0 | 2.6.1 | `sql/2_6_0-to-2_6_1_upgrade.sql` |
| 2.6.1 | 2.6.5 | `sql/2_6_1-to-2_6_5_upgrade.sql` |
| 2.6.5 | 2.7.0 | `sql/2_6_5-to-2_7_0_upgrade.sql` |
| 2.7.0 | 2.7.2 | `sql/2_7_0-to-2_7_2_upgrade.sql` |
| 2.7.2 | 2.7.3 | `sql/2_7_2-to-2_7_3_upgrade.sql` |
| 2.7.3 | 2.8.0 | `sql/2_7_3-to-2_8_0_upgrade.sql` |
| 2.8.0 | 2.8.1 | `sql/2_8_0-to-2_8_1_upgrade.sql` |
| 2.8.1 | 2.8.2 | `sql/2_8_1-to-2_8_2_upgrade.sql` |
| 2.8.2 | 2.8.3 | `sql/2_8_2-to-2_8_3_upgrade.sql` |
| 2.8.3 | 2.9.0 | `sql/2_8_3-to-2_9_0_upgrade.sql` |
| 2.9.0 | 3.0.0 | `sql/2_9_0-to-3_0_0_upgrade.sql` |
| 3.0.0 | 3.0.1 | `sql/3_0_0-to-3_0_1_upgrade.sql` |
| 3.0.1 | 3.1.0 | `sql/3_0_1-to-3_1_0_upgrade.sql` |
| 3.1.0 | 3.2.0 | `sql/3_1_0-to-3_2_0_upgrade.sql` |
| 3.2.0 | 4.0.0 | `sql/3_2_0-to-4_0_0_upgrade.sql` |
| 4.0.0 | 4.1.0 | `sql/4_0_0-to-4_1_0_upgrade.sql` |
| 4.1.0 | 4.1.1 | `sql/4_1_0-to-4_1_1_upgrade.sql` |
| 4.1.1 | 4.1.2 | `sql/4_1_1-to-4_1_2_upgrade.sql` |
| 4.1.2 | 4.2.0 | `sql/4_1_2-to-4_2_0_upgrade.sql` |
| 4.2.0 | 4.2.1 | `sql/4_2_0-to-4_2_1_upgrade.sql` |
| 4.2.1 | 4.2.2 | `sql/4_2_1-to-4_2_2_upgrade.sql` |
| 4.2.2 | 5.0.0 | `sql/4_2_2-to-5_0_0_upgrade.sql` |
| 5.0.0 | 5.0.1 | `sql/5_0_0-to-5_0_1_upgrade.sql` |
| 5.0.1 | 5.0.2 | `sql/5_0_1-to-5_0_2_upgrade.sql` |
| 5.0.2 | 6.0.0 | `sql/5_0_2-to-6_0_0_upgrade.sql` |
| 6.0.0 | 6.1.0 | `sql/6_0_0-to-6_1_0_upgrade.sql` |
| 6.1.0 | 7.0.0 | `sql/6_1_0-to-7_0_0_upgrade.sql` |
| 7.0.0 | 7.0.1 | `sql/7_0_0-to-7_0_1_upgrade.sql` |
| 7.0.1 | 7.0.2 | `sql/7_0_1-to-7_0_2_upgrade.sql` |
| 7.0.2 | 7.0.3 | `sql/7_0_2-to-7_0_3_upgrade.sql` |
| 7.0.3 | 7.0.4 | `sql/7_0_3-to-7_0_4_upgrade.sql` |
| 7.0.4 | 8.0.0 | `sql/7_0_4-to-8_0_0_upgrade.sql` |
| 8.0.0 | 8.0.1 | `sql/8_0_0-to-8_0_1_upgrade.sql` |

### 2.1 Example — `2_6_0-to-2_6_1_upgrade.sql` (excerpt)

```sql
ALTER TABLE `prescriptions` CHANGE `dosage` `dosage` VARCHAR( 10 ) DEFAULT NULL;
ALTER TABLE `prescriptions` ADD `route` INT AFTER `unit` ;

ALTER TABLE `facility` ADD `domain_identifier` VARCHAR( 60 ) ;

ALTER TABLE `history_data` ADD `name_1` VARCHAR( 255 ) ,
ADD `value_1` VARCHAR( 255 ) ,
ADD `name_2` VARCHAR( 255 ) ,
ADD `value_2` VARCHAR( 255 ) ,
ADD `additional_history` TEXT;

CREATE TABLE `openemr_postcalendar_topics` ( … );
CREATE TABLE `categories` ( … );
CREATE TABLE `categories_seq` ( … );
INSERT INTO `categories_seq` VALUES (0);
CREATE TABLE `config` ( … );
CREATE TABLE `config_seq` ( … );
INSERT INTO `config_seq` VALUES (0);
CREATE TABLE `documents` ( … );
CREATE TABLE `notes` ( … );
CREATE TABLE `categories_to_documents` ( … );
CREATE TABLE `x12_partners` ( … );
…
```

Notice the mix of:
- Raw `ALTER TABLE` (legacy MyISAM tables)
- `CREATE TABLE` (new tables)
- `INSERT INTO _seq VALUES (0)` (initialize nested-set sequence)

This script is **idempotent in spirit** but **not in implementation** —
running it twice will fail (you cannot `ADD COLUMN` twice). The
`#If*` meta-language (see below) lets you wrap blocks in guards.

---

## 3. The `#If*` meta-language

The upgrade scripts support directives (lines starting with `#`) that
let a block of SQL run **only if a condition holds**:

```
#IfNotTable
  argument: table_name
  behavior: if the table_name does not exist, the block will be executed

#IfTable
  argument: table_name
  behavior: if the table_name does exist, the block will be executed

#IfColumn
  arguments: table_name colname
  behavior:  if the table and column exist, the block will be executed

#IfMissingColumn
  arguments: table_name colname
  behavior:  if the table exists but the column does not, the block will be executed

#IfNotColumnType
  arguments: table_name colname value
  behavior:  If the table table_name does not have a column colname with
             a data type equal to value, then the block will be executed

#IfNotColumnTypeDefault
  arguments: table_name colname value value2
  behavior:  If the table table_name does not have a column colname with
             a data type equal to value and a default equal to value2,
             then the block will be executed

#IfNotRow
  arguments: table_name colname value
  behavior:  If the table table_name does not have a row where colname = value,
             the block will be executed.

#IfNotRow2D
  arguments: table_name colname value colname2 value2
  behavior:  If the table table_name does not have a row where colname = value
             AND colname2 = value2, the block will be executed.

#IfNotRow3D
  arguments: table_name colname value colname2 value2 colname3 value3
  behavior:  If the table table_name does not have a row where
             colname = value AND colname2 = value2 AND colname3 = value3,
             the block will be executed.

#IfNotRow4D
  arguments: table_name colname value colname2 value2 colname3 value3 colname4 value4
  behavior:  If the table table_name does not have a row where
             colname = value AND colname2 = value2 AND colname3 = value3
             AND colname4 = value4, the block will be executed.

#IfNotRow2Dx2
  desc:      Specialized: avoid adding items to list_options with redundant
             option_id + title in each element.
  arguments: table_name colname value colname2 value2 colname3 value3
  behavior:  The block is executed if both:
             1) No row where colname = value AND colname2 = value2.
             2) No row where colname = value AND colname3 = value3.

#IfRow / #IfRow2D / #IfRow3D
  Positive variants of #IfNotRow*.

#IfIndex
  arguments: table_name colname
  behavior:  If the table and index exist the relevant statements are executed.
             Most often used for dropping indexes/keys.

#IfNotIndex
  arguments: table_name colname
  behavior:  If the index does not exist, it will be created.

#IfNotMigrateClickOptions
  Custom function for importing Clickoptions settings.

#IfNotListOccupation
  Custom function for creating the Occupation list.

#IfNotListReaction
  Custom function for creating the Reaction list.

#IfNotWenoRx
  Custom function for importing new drug data.

#IfTextNullFixNeeded
  Convert all text fields without default null to default null.

#IfTableEngine
  arguments: table_name engine
  behavior:  Execute SQL if the table has been created with the given engine.
             Use when engine conversion requires more than one ALTER TABLE.

#IfInnoDBMigrationNeeded
  Find all MyISAM tables and convert them to InnoDB.
  arguments: none
  behavior:  can take a long time.
```

### 3.1 Example

```sql
#IfMissingColumn prescriptions route
ALTER TABLE `prescriptions` ADD `route` INT AFTER `unit`;
#EndIf

#IfNotTable new_table
CREATE TABLE `new_table` ( … );
#EndIf

#IfNotRow2D list_options option_id title yes_no YES
INSERT INTO `list_options` (list_id, option_id, title) VALUES ('yesno', 'YES', 'Yes');
#EndIf
```

`#EndIf` is implicit at the next directive or at the end of the file.
Some directives don't need `#EndIf` because they are single-statement
guards (e.g. `#IfMissingColumn prescriptions route` followed by a single
`ALTER`).

### 3.2 Why a custom meta-language?

The schema has been evolving since 2002. Many users skip versions
(jump from 2.6.0 to 5.0.0). The `#If*` guards make the upgrade
scripts **idempotent** so a script can be safely re-run if a previous
upgrade was interrupted, and they let one script work across
historical states (e.g. a 4.x DB has the column but a 3.x DB does not).

---

## 4. `SQLUpgradeService` (the parser)

> Source: `src/Services/Utils/SQLUpgradeService.php` (1,653 lines)

`OpenEMR\Services\Utils\SQLUpgradeService` is the parser/executor for
the meta-language. It:

1. Reads the upgrade script line by line.
2. Strips comments (`--` and `#`-directives at the start of a line).
3. Tracks `BEGIN … END` blocks tagged with a directive.
4. For each block, evaluates the condition by querying the live
   `information_schema`.
5. Substitutes `bind` placeholders (none — these scripts are static).
6. Executes the SQL via `QueryUtils::sqlStatementThrowException` (or
   via `$this->executeViaInstallConnection` for new installs).
7. Returns a `RenderOutputBuffer` with success/failure messages.
8. Dispatches a `SQLUpgradeEvent` (which the `modules` table can react
   to).

The service can be configured:
- `setRenderOutputToScreen(true|false)` — echo progress vs. buffer it.
- `setThrowExceptionOnError(true|false)` — re-throw vs. swallow errors.

### 4.1 The `MODULES_LOADED` event

Modules listen to the `modules.loaded` event (fired by
`ModulesApplication`) and may register their own upgrade hooks via
`module_acl_settings` or by simply observing the `SQLUpgradeEvent`.

---

## 5. `sql_upgrade.php` and `sql_patch.php`

> Source: `sql_upgrade.php` (root)

`sql_upgrade.php` is the **between-release** upgrader. It:
1. Reads `$v_database` from `version.php` and `version` table.
2. Reads the current `OE_SITE_DIR` site.
3. Determines the **starting upgrade script** (the first one whose
   "from" version matches the DB's current `v_database`).
4. Iterates through all subsequent scripts, calling
   `SQLUpgradeService` on each.
5. Updates the `version` table and `version.php` (`$v_database`).

```bash
php sql_upgrade.php
```

`sql_patch.php` is a **patch-only** variant for the rare patch releases
(8.0.0 → 8.0.1, etc.). It only runs the patch script.

---

## 6. `Installer.class.php` (fresh install)

> Source: `library/classes/Installer.class.php` (2,315 lines)

Fresh installs are handled by the Installer class (called from
`setup.php`). It uses **raw `mysqli`** (not ADODB) because the goal is
to bootstrap a brand-new database before ADODB / `QueryUtils` are
available.

```php
class Installer
{
    public array $custom_globals;
    public array $dumpfiles;
    public mysqli|false $dbh;
    public string $additional_users;
    // … ~30 more fields set from the setup wizard

    public function __construct(array $cgi_variables, private readonly LoggerInterface $logger)
    {
        $this->iuser      = $cgi_variables['iuser']      ?? '';
        $this->iuserpass  = $cgi_variables['iuserpass']  ?? '';
        $this->server     = $cgi_variables['server']     ?? '';
        // …

        $this->main_sql           = __DIR__ . '/../../sql/database.sql';
        $this->translation_sql    = __DIR__ . '/../../contrib/util/language_translations/currentLanguage_utf8.sql';
        $this->ippf_sql           = __DIR__ . '/../../sql/ippf_layout.sql';
        $this->cvx                = __DIR__ . '/../../sql/cvx_codes.sql';
        $this->additional_users   = __DIR__ . '/../../sql/official_additional_users.sql';

        $this->initialize_dumpfile_list();
        // …
    }

    public function login_is_valid(): bool { … }
    public function char_is_valid(?string $input_text): bool { … }
    public function databaseNameIsValid(?string $name): bool { … }
    // … many validation helpers
}
```

### 6.1 Dump files

`$dumpfiles` is a list of `sql/*.sql` files to import in order. The
typical fresh-install order:

1. `sql/database.sql` (the master schema, 15,382 lines)
2. `sql/ins_lang_def_nl.sql` (Dutch seed translations — actually applied to all installs)
3. `contrib/util/language_translations/currentLanguage_utf8.sql` (current UI language)
4. `sql/official_additional_users.sql` (extra seed users)
5. `sql/cvx_codes.sql` (CVX vaccine codes)
6. `sql/ippf_layout.sql` (only if `ippf_specific = true`)

### 6.2 Fresh-install flow

```
setup.php
  ↓
Installer::__construct(cgi_variables)
  ↓
add_initial_user
  ↓
connect_to_database (raw mysqli)
  ↓
load_dumpfile(sql/database.sql)
  ↓
load_dumpfile(sql/official_additional_users.sql)
  ↓
load_dumpfile(sql/cvx_codes.sql)
  ↓
load_dumpfile(translation_sql)
  ↓
create_initial_globals
  ↓
create_oauth2_keys
  ↓
$config = 1 in sites/<id>/sqlconf.php
```

The `load_dumpfile()` function reads the `.sql` file line by line and
executes each statement, splitting on `;` at end of line. It does not
understand the `#If*` meta-language — fresh installs are assumed to be
on a clean DB.

---

## 7. CI guard — the v_database comment

`sql/database.sql` has a `v_database` comment near the top:

```sql
-- v_database: 535
```

A CI check (referenced in `version.php`) ensures that this comment
**matches `$v_database` in `version.php`**. If you bump `$v_database`
in `version.php` without updating `database.sql`, CI fails. If you
update `database.sql` without bumping `version.php`, CI fails.

The same convention applies to `$v_acl = 12` ↔ the ACL scripts.

---

## 8. How to add a new schema change

> Source: `CLAUDE.md` and current practice.

The standard recipe:

1. **Edit** `sql/database.sql` to add the column / table / index. This
   is the canonical schema. Update the `v_database` comment at the
   top.
2. **Bump** `$v_database` in `version.php` to match.
3. **Create** a new upgrade script in `sql/`. The filename follows
   `<oldVersion>-to-<newVersion>_upgrade.sql`. For a patch, use
   `<X.Y.Z>-to-<X.Y.Z+1>_upgrade.sql`. For a major, use
   `<X.Y.Z>-to-<X+1.0.0>_upgrade.sql`.
4. **Wrap the change in `#If*` guards** so the script is idempotent.
5. **Test** by running `php sql_upgrade.php` against a DB at the prior
   version.
6. **Commit** with a Conventional Commits message:
   ```
   feat(database): add foo.bar column for X
   ```

### 8.1 What goes in the upgrade script

```sql
#IfMissingColumn patient_data foo_bar
ALTER TABLE `patient_data` ADD `foo_bar` VARCHAR(255) NOT NULL DEFAULT '';
#EndIf

#IfNotTable new_feature_table
CREATE TABLE `new_feature_table` (
  `id` BIGINT(20) NOT NULL AUTO_INCREMENT,
  `uuid` BINARY(16) DEFAULT NULL,
  `pid` BIGINT(20) NOT NULL DEFAULT '0',
  `date_created` DATETIME DEFAULT NULL,
  `created_by` INT(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uuid` (`uuid`),
  KEY `pid` (`pid`)
) ENGINE=InnoDB;
#EndIf

#IfNotRow2D list_options list_id option_id lists yesno
INSERT INTO `list_options` (list_id, option_id, title) VALUES ('lists', 'yesno', 'Yes/No');
#EndIf
```

### 8.2 What goes in `database.sql` (for fresh installs)

The same changes must be applied to `sql/database.sql` so a **new
install** gets the change. A new install reads `database.sql` directly
— it does not run any upgrade script.

---

## 9. Why not Doctrine Migrations / Flyway?

| Reason | Explanation |
|---|---|
| **20 years of history** | Pre-dates Doctrine Migrations. The current meta-language works across 32 historical upgrade steps. |
| **Idempotency via guards** | The `#If*` directives allow the same script to be safely re-applied. |
| **Pre-innoDB quirks** | Many historical scripts need conditional logic that maps poorly to up()/down(). |
| **Bundled with the schema** | A single `database.sql` file is the "source of truth" that anyone can read. |
| **Tested in production** | Used by thousands of deployments over 20+ years. |

The `doctrine/migrations` package is **still required** (`composer.json`),
presumably for future use by the BC (new boundary) layer.

---

## 10. Module migrations

Custom modules ship their own `install.sql` and may register an event
listener to `SQLUpgradeEvent` for upgrades. The Installer's
`initialize_dumpfile_list()` includes the module's `install.sql` if
its folder is present at install time.

A module's `openemr.bootstrap.php` typically runs an idempotent
"self-upgrade" on every load:

```php
global $eventDispatcher;
$eventDispatcher->addListener(SQLUpgradeEvent::EVENT_NAME, function (SQLUpgradeEvent $event) {
    $event->addStatements([
        "#IfNotTable my_module_table\nCREATE TABLE…\n#EndIf"
    ]);
});
```

This pattern is used by `oe-module-faxsms`, `oe-module-weno`, etc.

---

## 11. See also

- [`schema-overview.md`](./schema-overview.md) — the 280 tables
- [`connection-layer.md`](./connection-layer.md) — how the schema is queried
- [`key-tables.md`](./key-tables.md) — per-table deep dive
- `sql/database.sql` — the canonical schema
- `sql/X_Y_Z-to-A_B_C_upgrade.sql` — upgrade scripts
- `src/Services/Utils/SQLUpgradeService.php` — the parser
- `library/classes/Installer.class.php` — the installer
