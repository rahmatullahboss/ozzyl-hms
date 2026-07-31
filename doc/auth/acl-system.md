# ACL System

> **Source paths:** `src/Common/Acl/AclMain.php`, `src/Common/Acl/AclExtended.php`,
> `src/Common/Acl/AccessDeniedException.php`, `src/Common/Acl/AccessDeniedHelper.php`,
> `src/Gacl/Gacl.php`, `src/Gacl/GaclApi.php`, `interface/usergroup/adminacl.php`,
> `sql/database.sql` (the `gacl_*` tables)
> **Documented version:** OpenEMR 8.0.1-dev (`v_acl = 12`)

OpenEMR's authorization layer is a **fork of phpGACL 3.x** that
ships as ~30 `gacl_*` tables and a pair of PHP classes (`Gacl` and
`GaclApi`). All access checks go through the modern facade
`OpenEMR\Common\Acl\AclMain::aclCheckCore()`.

The model is **Access Control Objects (ACOs)** × **Access Request
Objects (AROs)** × **Access eXtension Objects (AXOs)** with
**allow/deny** rules and a **return_value** (used for fine-grained
permissions like `write`, `addonly`, `wsome`).

---

## 1. The phpGACL model

> A rule is `ARO × ACO × AXO → allow|deny + return_value`.

| Concept | What | In OpenEMR |
|---|---|---|
| **ACO** (Access Control Object) | A *thing being protected* | `patients.demo`, `encounters.notes`, `admin.super`, … |
| **ARO** (Access Request Object) | The *requester* | A user (`users.alice`) or a group (`Doctors`) |
| **AXO** (Access eXtension Object) | A *sectioned object* (rarely used) | Sometimes used for "squad" or "sensitivity" |
| **Section** | A grouping of ACOs or AROs | `patients`, `encounters`, `admin`, `users`, … |
| **Group** | A named ARO set | `Doctors`, `Front Desk`, `Administrators` |
| **Rule** | A tuple of (ARO, ACO, AXO) with `allow` and `return_value` | One row in `gacl_acl` |

### 1.1 The `gacl_*` tables (30 in total)

| Table | Purpose |
|---|---|
| `gacl_aco` | The Access Control Objects (the "what" being protected). |
| `gacl_aco_sections` | The section each ACO belongs to (`patients`, `encounters`, `admin`, …). |
| `gacl_aco_map` | Many-to-many between ACOs and sections. |
| `gacl_aco_seq` / `gacl_aco_sections_seq` | Sequence tables for nested-set IDs. |
| `gacl_aro` | The Access Request Objects (the "who" requesting). |
| `gacl_aro_groups` | Named ARO groups (`Doctors`, etc.). |
| `gacl_aro_groups_id_seq` | ARO group id sequence. |
| `gacl_aro_groups_map` | M:N between AROs and ARO groups. |
| `gacl_aro_map` | Maps AROs to their section (`users` is the main ARO section). |
| `gacl_aro_sections` | ARO sections (`users`, `groups`). |
| `gacl_aro_sections_seq` | Sequence for the above. |
| `gacl_aro_seq` | ARO id sequence. |
| `gacl_axo` | Access eXtension Objects (rarely used). |
| `gacl_axo_groups` | AXO groups. |
| `gacl_axo_groups_map` / `gacl_axo_map` | M:N between AXOs and groups. |
| `gacl_axo_sections` | AXO sections. |
| `gacl_groups_aro_map` | Membership in ARO groups. |
| `gacl_groups_axo_map` | Membership in AXO groups. |
| `gacl_acl` | The actual rules. `aro_id × aco_id × axo_id → allow|deny + return_value`. |
| `gacl_acl_sections` | ACL section grouping (rarely used). |
| `gacl_acl_seq` | ACL id sequence. |
| `gacl_phpgacl` | Single-row config (version, schema). |

Plus the OpenEMR-specific module ACL tables:

| Table | Purpose |
|---|---|
| `module_acl_sections` | Module-level ACL sections. |
| `module_acl_user_settings` | Per-user module ACL (allowed/denied per section). |
| `module_acl_group_settings` | Per-group module ACL. |
| `module_configuration` | Module config storage (which users can configure a module). |

### 1.2 The `gacl_acl` row (the actual rule)

```sql
CREATE TABLE `gacl_acl` (
  `id` int(11) NOT NULL auto_increment,
  `section_value` varchar(80) NOT NULL default 'system',
  `allow` int(11) NOT NULL default '0',
  `enabled` int(11) NOT NULL default '0',
  `return_value` longtext,
  `note` longtext,
  `updated_date` int(11) NOT NULL default '0',
  `group_id` int(11) NOT NULL default '0',
  PRIMARY KEY (`id`)
) ENGINE=MyISAM;
```

…and `gacl_aco_map` + `gacl_aro_map` link each ACL to one ACO and one
ARO (with optional AXO links via `gacl_axo_map`).

---

## 2. The ACO catalog

The list of "things to be protected" is hard-coded in
`src/Common/Acl/AclMain.php` (docblock) and seeded in
`acl_upgrade.php`. The full catalog:

### 2.1 Section `admin` (Administration)

| ACO | Purpose |
|---|---|
| `super` | **Superuser** — bypasses all other checks. |
| `calendar` | Calendar settings. |
| `database` | Database reporting. |
| `forms` | Forms administration. |
| `practice` | Practice settings. |
| `superbill` | Superbill codes administration. |
| `users` | Users/Groups/Logs administration. |
| `batchcom` | Batch communication tool. |
| `language` | Language interface tool. |
| `drugs` | Pharmacy dispensary. |
| `acl` | ACL administration. |
| `menu` | Menu administration. |
| `manage_modules` | Module manager. |

### 2.2 Section `acct` (Accounting)

| ACO | Purpose |
|---|---|
| `bill` | Billing (write optional). |
| `disc` | Discount prices (Fee Sheet / Checkout). |
| `eob` | EOB data entry. |
| `rep` | Financial reporting — my encounters. |
| `rep_a` | Financial reporting — anything. |

### 2.3 Section `patients` (Patient Information)

| ACO | Return values | Purpose |
|---|---|---|
| `appt` | `view`/`write`/`wsome` | Appointments. |
| `demo` | `view`/`write`/`addonly` | Demographics. |
| `med` | `view`/`write`/`addonly` | Medical Records and History. |
| `trans` | `view`/`write` | Transactions (referrals). |
| `docs` | `view`/`write`/`addonly` | Documents. |
| `docs_rm` | — | Documents **delete**. |
| `pat_rep` | — | Patient Report. |
| `notes` | `view`/`write`/`addonly` | Patient Notes. |
| `sign` | `view`/`write`/`addonly` | Sign Lab Results. |
| `reminder` | `view`/`write`/`addonly` | Patient Reminders. |
| `alert` | `view`/`write`/`addonly` | Clinical Reminders/Alerts. |
| `disclosure` | `view`/`write`/`addonly` | Disclosures. |
| `rx` | `view`/`write`/`addonly` | Prescriptions. |
| `amendment` | `view`/`write`/`addonly` | Amendments. |
| `lab` | `view`/`write`/`addonly` | Lab Results. |

### 2.4 Section `encounters` (Encounter Information)

| ACO | Return values | Purpose |
|---|---|---|
| `auth` | `view` | Authorize — my encounters. |
| `auth_a` | `view` | Authorize — any encounters. |
| `coding` | `view`/`write`/`wsome` | Coding — my encounters. |
| `coding_a` | `view`/`write`/`wsome` | Coding — any encounters. |
| `notes` | `view`/`write`/`addonly` | Notes — my encounters. |
| `notes_a` | `view`/`write`/`addonly` | Notes — any encounters. |
| `date_a` | — | Fix encounter dates — any. |
| `relaxed` | `view`/`write`/`addonly` | Less-private (e.g. Sports Fitness form). |

### 2.5 Section `sensitivities` (Sensitivities)

| ACO | Purpose |
|---|---|
| `normal` | Normal sensitivity. |
| `high` | High sensitivity. |

### 2.6 Section `lists` (Lists)

| ACO | Return values | Purpose |
|---|---|---|
| `default` | `view`/`write`/`addonly` | Default List. |
| `state` | `view`/`write`/`addonly` | State List. |
| `country` | `view`/`write`/`addonly` | Country List. |
| `language` | `view`/`write`/`addonly` | Language List. |
| `ethrace` | `view`/`write`/`addonly` | Ethnicity-Race List. |

### 2.7 Section `placeholder`

| ACO | Purpose |
|---|---|
| `filler` | Placeholder (maintains empty ACLs). |

### 2.8 Section `nationnotes`

| ACO | Purpose |
|---|---|
| `nn_configure` | Nation Notes. |

### 2.9 Section `patientportal`

| ACO | Purpose |
|---|---|
| `portal` | Patient Portal. |

### 2.10 Section `menus`

| ACO | Purpose |
|---|---|
| `module` | Module menu access. |

### 2.11 Section `groups` (Therapy Groups)

| ACO | Purpose |
|---|---|
| `gadd` | View/Add/Update groups. |
| `gcalendar` | View/Create/Update group appointments. |
| `glog` | Group encounter log. |
| `gdlog` | Group detailed log. |
| `gm` | Group messaging. |

### 2.12 Section `inventory`

| ACO | Purpose |
|---|---|
| `lots` | Lots. |
| `sales` | Sales. |
| `purchases` | Purchases. |
| `transfers` | Transfers. |
| `adjustments` | Adjustments. |
| `consumption` | Consumption. |
| `destruction` | Destruction. |
| `reporting` | Reporting. |

> `admin/drugs` permission is required to create products;
> that permission substitutes for all inventory permissions.

---

## 3. `AclMain::aclCheckCore()` — the modern API

> Source: `src/Common/Acl/AclMain.php`

```php
public static function aclCheckCore(
    string $section,
    string $value,
    string $user = '',
    string|array $return_value = ''
): bool
```

| Param | Type | Purpose |
|---|---|---|
| `$section` | string | ACO section (e.g. `patients`, `encounters`, `admin`). |
| `$value` | string | ACO value within the section (e.g. `demo`, `notes`). |
| `$user` | string | Username; defaults to `$_SESSION['authUser']`. |
| `$return_value` | string\|array | The permission level(s) being checked: `view`, `write`, `addonly`, `wsome`. Empty = "any" level. |

### 3.1 The superuser shortcut

```php
public static function aclCheckCore($section, $value, $user = '', $return_value = ''): bool
{
    $session = SessionWrapperFactory::getInstance()->getWrapper();
    if (! $user) $user = $session->get('authUser') ?? '';

    // Superuser always gets access to everything.
    if (($section != 'admin' || $value != 'super') && self::aclCheckCore('admin', 'super', $user)) {
        return true;
    }

    // … actual ACL check below
}
```

If the user has `admin/super`, **all other checks short-circuit to true**.
The exception is `admin/super` itself — querying it would be
recursive, so it's checked without recursion.

### 3.2 The deny-takes-precedence semantics

`Gacl::acl_query()` returns all matching ACL rows. `AclMain` iterates
them and applies **deny-takes-precedence**:

```php
$access = false;  // any allow found so far
$deny = false;    // any deny found so far

foreach ($acl_results as $acl_result) {
    if (is_array($return_value)) {
        foreach ($return_value as $single_return_value) {
            if (empty($single_return_value)) {
                if ($acl_result['allow']) $access = true; else $deny = true;
            } else {
                if ($acl_result['return_value'] == $single_return_value) {
                    if ($acl_result['allow']) $access = true; else $deny = true;
                }
            }
        }
    } else {
        if (empty($return_value)) {
            if ($acl_result['allow']) $access = true; else $deny = true;
        } else {
            if ($acl_result['return_value'] == $return_value) {
                if ($acl_result['allow']) $access = true; else $deny = true;
            }
        }
    }
}

// Now decide — note: a denial takes precedence
if (!$deny && $access) {
    return true;
}
return false;
```

So if any matching ACL says `deny`, the answer is `deny`, regardless
of how many `allow` rules match. This is the standard phpGACL
semantics.

### 3.3 Usage

```php
use OpenEMR\Common\Acl\AclMain;

// Can this user view patient demographics?
if (!AclMain::aclCheckCore('patients', 'demo')) {
    AccessDeniedHelper::denyWithTemplate('Access denied', 'Patients');
}

// Can this user write prescriptions?
if (AclMain::aclCheckCore('patients', 'rx', '', 'write')) {
    // OK to write
}

// Multiple levels at once
$can = AclMain::aclCheckCore('patients', 'rx', '', ['write', 'addonly']);
```

---

## 4. The superuser

`admin/super` is the "god mode" ACO. When granted to a user (or one of
their groups), it short-circuits all other ACL checks. The superuser
can:

- Delete patients, encounters, issues
- Edit any user's record
- Bypass all `write`/`addonly` restrictions
- Access any menu item
- Access any module

By default, the `admin` user created at install has `admin/super`.

---

## 5. ARO groups

> Source: `src/Common/Acl/AclExtended.php`

AROs are grouped into named **ARO groups** (`gacl_aro_groups`).
Membership is stored in `gacl_groups_aro_map`. A user typically
belongs to one ARO group (e.g. `Doctors`), and the ARO group is
granted ACOs.

### 5.1 Built-in ARO groups

The Installer seeds a few standard groups:

| Group | Typical ACO grants |
|---|---|
| `Administrators` | All `admin/*`, all `patients/*` (full) |
| `Physicians` | `patients/*` (write), `encounters/*` (my) |
| `Clinicians` | `patients/*` (view+addonly), `encounters/*` (my) |
| `Front Desk` | `patients/demo` (write), `patients/appt` (write) |
| `Accounting` | `acct/*` (rep), `patients/demo` (view) |

### 5.2 Group management

`AclExtended::aclGetGroupTitles($user_name)` returns the list of ARO
group titles a user belongs to.

`AclExtended::addUserAros($username, $group)` adds a user to one or
more ARO groups (creates the ARO row if needed).

`AclExtended::removeUserAros($username, $group)` removes membership.

`AclExtended::setUserAro($group, $username, $fname, $mname, $lname)`
is the underlying call.

### 5.3 Group hierarchy

ARO groups can have **parents** (`gacl_aro_groups.parent_id`). A user
in a child group inherits all parent group grants. This lets admins
say "Doctors inherit all Clinician grants".

### 5.4 User → ARO map

The ARO row for a user is `gacl_aro` where:
- `section_value = 'users'`
- `value = 'alice'` (the username)
- `name = 'Alice Anderson'`

The map from users to AROs is in `gacl_groups_aro_map` (linking
`gacl_aro.id` ↔ `gacl_aro_groups.id`).

---

## 6. `AccessDeniedException` (modern) vs `AccessDeniedHelper::deny()` (legacy)

### 6.1 `AccessDeniedException`

> Source: `src/Common/Acl/AccessDeniedException.php`

A simple exception with the required section and sub-category for
downstream rendering:

```php
namespace OpenEMR\Common\Acl;

class AccessDeniedException extends \Exception
{
    public function __construct(
        private readonly string $requiredSection,
        private $subCategory = '',
        $message = "",
        $code = 0,
        ?Throwable $previous = null
    ) {
        if (empty($message)) $message = xlt('ACL check failed');
        parent::__construct($message, $code, $previous);
    }

    public function getRequiredSection(): string;
    public function getSubCategory(): string;
}
```

Modern controllers `throw` this; the framework's exception handler
catches it and renders the `unauthorized.html.twig` page.

### 6.2 `AccessDeniedHelper` (legacy)

> Source: `src/Common/Acl/AccessDeniedHelper.php`

Legacy scripts (under `interface/`, `library/`, `portal/`) have no
framework exception handler. `AccessDeniedHelper` is the legacy
companion:

```php
class AccessDeniedHelper
{
    public static function deny(
        string $comment,
        string $auditEvent = 'security-access-denied',
        int $httpStatus = Response::HTTP_FORBIDDEN,
        AccessDeniedResponseFormat $format = AccessDeniedResponseFormat::Text,
        ?callable $beforeExit = null,
    ): never;

    public static function denyWithTemplate(
        string $comment,
        string $pageTitle,
        string $auditEvent = 'security-access-denied',
    ): never;

    public static function createDeniedResponse(
        string $comment,
        string $pageTitle,
        string $auditEvent = 'security-access-denied',
        int $httpStatus = Response::HTTP_FORBIDDEN,
    ): Response;
}
```

`deny()`:
1. Logs a warning via `ServiceContainer::getLogger()`.
2. Audit-logs a `security-access-denied` event.
3. Sets the HTTP status code.
4. Emits the response body (text, JSON, or nothing).
5. Optionally runs a `$beforeExit` callback (e.g. render a template).
6. Calls `exit`.

`denyWithTemplate()` is a convenience that renders the
`core/unauthorized.html.twig` template before exit.

`createDeniedResponse()` returns a Symfony `Response` instead of
calling exit — for controller patterns that need to return a
`Response` object.

### 6.3 When to use which

| Pattern | Use |
|---|---|
| Modern controller (PSR-7 / Symfony) | `throw new AccessDeniedException(...)` |
| Legacy script (no framework) | `AccessDeniedHelper::denyWithTemplate(...)` |
| Controller catch block (need Response) | `AccessDeniedHelper::createDeniedResponse(...)` |

---

## 7. Admin UI — `interface/usergroup/adminacl.php`

> Source: `interface/usergroup/adminacl.php`

The ACL administration UI is at `Admin → Users → ACLs`. It lets an
admin:

- Create / edit / delete ACOs, AROs, ARO groups
- View all rules in a grid
- Add / remove rules
- Move users between ARO groups
- Copy / paste rule sets between groups

A user must have `admin/acl` to access this page. The UI is itself
ACL-checked at the top:

```php
if (!AclMain::aclCheckCore('admin', 'acl')) {
    AccessDeniedHelper::deny('Not authorized for ACL admin');
}
```

---

## 8. The full ACL evaluation flow

```
AclMain::aclCheckCore('patients', 'demo', '', 'write')
  │
  │ 1. Resolve $user = $_SESSION['authUser']
  │
  │ 2. Short-circuit: does user have admin/super? (recursive call)
  │    If yes → return true
  │
  │ 3. Gacl::acl_query(
  │       'patients', 'demo',      // ACO section + value
  │       'users', $user,          // ARO section + value
  │       null, null, null, null,  // AXO (none)
  │       true                     // return all matching rows
  │    )
  │    → array of {acl_id, allow, return_value}
  │
  │ 4. Iterate results, tracking $access and $deny
  │    (deny-takes-precedence)
  │
  │ 5. Return !$deny && $access
```

### 8.1 Static caching

`AclMain` caches a single `Gacl` object statically:

```php
class AclMain
{
    private static $gaclObject;
    private static function collectGaclObject()
    {
        if (!is_object(self::$gaclObject)) {
            self::$gaclObject = new Gacl();
        }
        return self::$gaclObject;
    }
}
```

This avoids the cost of a fresh `Gacl` (and its DB connection) per
check. `AclMain::clearGaclCache()` resets the cache — used in unit
tests.

---

## 9. Module-level ACL

> Source: `acl_upgrade.php`, `src/Common/Acl/AclMain.php` `zhAclCheck()`

A separate set of tables (`module_acl_*`) lets the Laminas module
admin grant per-user / per-group module-level permissions. The
checks live in `AclMain::zhAclCheck($user_id, $section_identifier)`
which queries `module_acl_user_settings` (or the user's groups in
`module_acl_group_settings`).

This is the ACL surface used by the Laminas `zend_modules/`
(e.g. the legacy Dashboard, the legacy reporting).

---

## 10. See also

- [`authentication.md`](./authentication.md) — the auth that precedes ACL
- [`mfa.md`](./mfa.md) — MFA gate before the main app
- [`../database/key-tables.md`](../database/key-tables.md) — the `gacl_*` tables
- `src/Common/Acl/AclMain.php` — the facade
- `src/Common/Acl/AclExtended.php` — group / squad utilities
- `src/Gacl/Gacl.php`, `src/Gacl/GaclApi.php` — the phpGACL fork
- `interface/usergroup/adminacl.php` — the admin UI
