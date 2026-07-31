# Authentication

> **Source paths:** `library/auth.inc.php`, `src/Common/Auth/AuthUtils.php`,
> `src/Common/Auth/AuthHash.php`, `src/Common/Auth/OneTimeAuth.php`,
> `src/Common/Session/SessionUtil.php`, `src/Common/Session/SessionWrapperFactory.php`,
> `src/Common/Session/SessionConfigurationBuilder.php`,
> `interface/login/login.php`, `interface/main/main_screen.php`
> **Documented version:** OpenEMR 8.0.1-dev

OpenEMR's authentication has four modes, four session cookie IDs, a
multi-algorithm password hasher, and an MFA gate. This file walks
through the full flow.

---

## 1. The four authentication modes

`OpenEMR\Common\Auth\AuthUtils` operates in one of four modes (set in
the constructor):

| Mode | Constructor argument | Use |
|---|---|---|
| `login` | `new AuthUtils('login')` | Standard user login. |
| `api` | `new AuthUtils('api')` | API token request (OAuth2 password grant). |
| `portal-api` | `new AuthUtils('portal-api')` | Patient portal API (uses `patient_access_onsite`). |
| `other` | `new AuthUtils()` (default) | Operations that require a logged-in user (e.g. e-sign, MFA change). |

```php
namespace OpenEMR\Common\Auth;
class AuthUtils
{
    private $loginAuth = false;
    private $apiAuth = false;
    private $portalApiAuth = false;
    private $otherAuth = false;
    private $authHashAuth;       // AuthHash instance
    private $errorMessage;
    private $userId;
    private $userGroup;
    private $patientId;
    private $dummyHash;          // timing-attack prevention

    public function __construct($mode = '') { … }
    public function confirmPassword($username, &$password, $email = ''): bool { … }
    // … many more methods
}
```

---

## 2. The standard login flow

### 2.1 Entry point

```
browser
  │  GET /interface/login/login.php?site=…
  ▼
interface/login/login.php          (Twig)
  │  Renders the login form (TOTP/U2F disabled here)
  │  POST → /interface/main/main_screen.php?auth=login&site=…
  ▼
interface/main/main_screen.php
  │  require '../globals.php'
  │  require '../interface/globals.php' boots:
  │     - autoload
  │     - library/globals.inc.php (build $GLOBALS)
  │     - library/sql.inc.php (ADODB connect)
  │     - library/auth.inc.php   ← THIS handles ?auth=login
  │  auth.inc.php:
  │     - new AuthUtils('login')->confirmPassword($_POST['authUser'], $_POST['clearPass'])
  │     - on success: set session vars, dispatch login event
  │     - on failure: authLoginScreen()
  │
  │  main_screen.php continues:
  │     - SELECT login_mfa_registrations WHERE user_id = $_SESSION['authUserID']
  │     - If has TOTP/U2F: render MFA challenge form (POST again to validate)
  │     - Else: SessionTracker::setupSessionDatabaseTracker() + render main app
  ▼
interface/main/tabs/main.php       (the frameset)
```

### 2.2 `library/auth.inc.php` — the dispatch

```php
use OpenEMR\Common\Auth\AuthUtils;
use OpenEMR\Common\Logging\EventAuditLogger;
use OpenEMR\Common\Session\SessionTracker;
use OpenEMR\Common\Session\SessionUtil;
use OpenEMR\Common\Session\SessionWrapperFactory;
use OpenEMR\Core\OEGlobalsBag;

$session = SessionWrapperFactory::getInstance()->getWrapper();

if (
    isset($_GET['auth']) && ($_GET['auth'] == "login")
    && isset($_POST['new_login_session_management'])
    && (
        (isset($_POST['authUser']) && isset($_POST['clearPass']))
        || (OEGlobalsBag::getInstance()->getBoolean('google_signin_enabled') && !empty(OEGlobalsBag::getInstance()->get('google_signin_client_id')) && !empty($_POST['used_google_signin']) && !empty($_POST['google_signin_token']))
    )
) {
    // Attempt login
    $session->set('language_choice', (!empty($_POST['languageChoice']) ? $_POST['languageChoice'] : 1));
    $session->set('language_direction', getLanguageDir($session->get('language_choice')));

    $passTemp = $_POST['clearPass'];   // kept for MFA to re-validate

    $login_success = false;
    if (/* Google sign-in */) {
        $login_success = AuthUtils::verifyGoogleSignIn($_POST['google_signin_token']);
    } else {
        $login_success = (new AuthUtils('login'))->confirmPassword($_POST['authUser'], $passTemp);
    }

    if ($login_success !== true) {
        $session->set('loginfailure', 1);
        if (function_exists('sodium_memzero')) sodium_memzero($_POST["clearPass"]);
        else $_POST["clearPass"] = '';
        authLoginScreen();
    }

    $session->remove('loginfailure');
    $skipSessionExpirationCheck = true;
} elseif ((isset($_GET['auth'])) && ($_GET['auth'] == "logout")) {
    // Logout
    $authUser = $session->get('authUser');
    $authProvider = $session->get('authProvider');
    if (!empty($authUser) && !empty($authProvider)) {
        if ((isset($_GET['timeout'])) && ($_GET['timeout'] == "1")) {
            EventAuditLogger::getInstance()->newEvent("logout", $authUser, $authProvider, 0, "timeout, so force logout");
        } else {
            EventAuditLogger::getInstance()->newEvent("logout", $authUser, $authProvider, 1, "success");
        }
    }
    authCloseSession();
    authLoginScreen(true);
} else {
    // Check existing session
    if (!AuthUtils::authCheckSession()) {
        EventAuditLogger::getInstance()->newEvent("logout", $session->get('authUser') ?? '', $session->get('authProvider') ?? '', 0, "authCheckSession() check failed, so force logout");
        authCloseSession();
        authLoginScreen(true);
    }
}

// Idle-timeout enforcement
if (empty($skipSessionExpirationCheck)) {
    if (SessionTracker::isSessionExpired()) {
        EventAuditLogger::getInstance()->newEvent("logout", $session->get('authUser'), $session->get('authProvider'), 0, "timeout, so force logout");
        authCloseSession();
        authLoginScreen(true);
    } elseif (empty($_REQUEST['skip_timeout_reset'])) {
        SessionTracker::updateSessionExpiration();
    }
}
```

### 2.3 `AuthUtils::confirmPassword()`

> Source: `src/Common/Auth/AuthUtils.php`

The full logic of `confirmPassword()` for `mode='login'`:

1. **Brute-force check** — IP block (`$_SERVER['REMOTE_ADDR']`).
2. **Account block check** — `users_secure.current_login_lock_until`.
3. **LDAP / Active Directory fallback** — if the user is configured for
   LDAP (`gbl_ldap` global), attempt LDAP bind first. LDAP users
   bypass local password lockout and expiration.
4. **Local password verify** — `password_verify($_POST['clearPass'], $users_secure.password)`.
5. **Timing-attack prevention** — `preventTimingAttack()` always
   performs a `password_verify` against a stored dummy hash, so a
   "user not found" path takes the same time as a "user found but
   wrong password" path.
6. **Rehash** — if the stored hash uses an old algorithm, rehash with
   the current `AuthHash` and update the row.
7. **Password expiration** — if `password_expiration_days` is set and
   the password is past its expiration, reject.
8. **On success** — set:
   - `$_SESSION['authUser']`     = the username
   - `$_SESSION['authUserID']`   = `users.id`
   - `$_SESSION['authProvider']` = the user's `authorized` flag (defaults to `Default`)
   - `$_SESSION['authUserGroup']` (for audit)
9. **On failure** — increment failure counters in `users_secure` and
   possibly lock the account. Audit-log the failure.

### 2.4 `AuthUtils::authCheckSession()`

Called at the top of every page. Verifies the session has not been
tampered with (e.g. user's password changed in another session):

```php
public static function authCheckSession(): bool
{
    // Re-validate the username against users_secure.password (re-hash)
    // If a password change happened elsewhere, the new hash won't match
    // the session-stored credentials → invalid → force logout.
}
```

### 2.5 `authCloseSession()`

```php
function authCloseSession(): void
{
    global $incoming_site_id;
    $session = SessionWrapperFactory::getInstance()->getWrapper();
    $incoming_site_id = $session->get('site_id') ?? '';
    SessionUtil::coreSessionDestroy();
}
```

The `site_id` is preserved in the URL so the next login defaults to
the same site.

### 2.6 `authLoginScreen($timed_out = false)`

Outputs a JS redirect to `interface/login_screen.php?error=1&site=…` (or
`timed_out=1` if `$timed_out=true`). The script also unwinds any
opener windows (so background iframes don't keep the session alive).

---

## 3. Session variables

After a successful login, these session variables are set:

| Variable | Set by | Purpose |
|---|---|---|
| `authUser` | `confirmPassword()` | The username (string). |
| `authUserID` | `confirmPassword()` | `users.id` (bigint). |
| `authProvider` | `confirmPassword()` | The user's `authorized` flag (defaults to `Default`). |
| `authUserGroup` | `confirmPassword()` | The group for audit (`users.groupname` or similar). |
| `authProviderDefault` | legacy | Boolean default. |
| `authProviderAll` | legacy | List of providers the user can act on behalf of. |
| `site_id` | `interface/globals.php` | The site id (used by OAuth2). |
| `language_choice` | `auth.inc.php` | The chosen UI language (id from `lang_languages`). |
| `language_direction` | `auth.inc.php` | `ltr` or `rtl`. |
| `loginfailure` | `auth.inc.php` (transient) | Set if the last login attempt failed. |
| `pid` | When a patient is selected | The active patient (per-tab). |
| `encounter` | When an encounter is open | The active encounter. |
| `authScratchToken1/2` | legacy | Multi-step auth scratch. |

---

## 4. The four session IDs

> Source: `src/Common/Session/SessionUtil.php`

OpenEMR uses **four separate cookies** (and therefore four session
names) for the four runtime surfaces:

| Constant | Cookie | Path | `httponly` | `samesite` | Use |
|---|---|---|---|---|---|
| `CORE_SESSION_ID = "OpenEMR"` | `OpenEMR` | `$web_root` | **false** (JS-readable for `restore_session()`) | `Strict` | Main UI |
| `OAUTH_SESSION_ID = "authserverOpenEMR"` | `authserverOpenEMR` | `/oauth2/` | true | **None** (for cross-origin SMART launches) | OAuth2 server |
| `API_SESSION_ID = "apiOpenEMR"` | `apiOpenEMR` | `/apis/` | true | (configurable) | REST + FHIR |
| `PORTAL_SESSION_ID = "PortalOpenEMR"` | `PortalOpenEMR` | `/portal/` | true | `Strict` | Patient portal |

### 4.1 Why the core cookie is JS-readable

OpenEMR supports **parallel logins** for the same user (e.g. to
manage two patients at once in two tabs). The `restore_session()` JS
function reads the current session ID from the cookie and lets the
user toggle between active sessions without re-authenticating. The
tradeoff is a small XSS exposure if a page can write to
`document.cookie`. Mitigation: `cookie_httponly=false` only on the
core cookie, and the cookie is `samesite=Strict`.

### 4.2 The session cookie params (in `SessionUtil`)

```php
public static function coreSessionStart($web_root, $read_only = true)
{
    $settings = SessionConfigurationBuilder::forCore($web_root, $read_only);
    self::sessionStartWrapper($settings);
}
```

`SessionConfigurationBuilder` produces the per-surface PHP session
config:

| Setting | core | api | oauth | portal |
|---|---|---|---|---|
| `name` | `OpenEMR` | `apiOpenEMR` | `authserverOpenEMR` | `PortalOpenEMR` |
| `cookie_path` | `$web_root` | `/apis/` | `/oauth2/` | `/portal/` |
| `cookie_httponly` | false | true | true | true |
| `cookie_samesite` | `Strict` | (config) | `None` | `Strict` |
| `cookie_secure` | (config) | true | true | (config) |
| `use_strict_mode` | 1 | 1 | 1 | 1 |
| `use_cookies` | 1 | 1 | 1 | 1 |
| `use_only_cookies` | 1 | 1 | 1 | 1 |
| `sid_bits_per_character` | 6 (PHP ≤ 8.3) | same | same | same |
| `sid_length` | 48 (PHP ≤ 8.3) | same | same | same |
| `gc_maxlifetime` | 14400 (4 hours) | same | same | same |

`sid_bits_per_character` and `sid_length` are deprecated in PHP 8.4
and are ignored there.

### 4.3 Session locking

To avoid the performance hit of PHP's session locking, OpenEMR
defines:

- `SessionUtil::setSession($keyOrArray, $value = null)` — opens a
  writable session, writes, closes. Re-opens the session if it was
  read-only.
- `SessionUtil::unsetSession($keyOrArray)` — symmetric.
- `SessionUtil::setUnsetSession($setArray, $unsetArray)` — atomic
  set + unset.

By default, the session is opened **read-only** for the request; only
the auth/MFA scripts open it writable.

### 4.4 Optional Redis session storage (Predis Sentinel)

If `OE_SITE_DIR/redis_sentinel.json` exists, OpenEMR will use a Predis
Sentinel-backed `SessionHandlerInterface` for session storage. This is
for multi-instance deployments where sticky sessions on the load
balancer are not reliable. The handler is registered in
`SessionUtil::sessionStartWrapper()`.

---

## 5. Idle-timeout enforcement (`SessionTracker`)

> Source: `src/Common/Session/SessionTracker.php`

A row in `session_tracker` is created on each successful login. Every
authenticated request bumps `last_updated`. A periodic background
service (or manual sweep) deletes rows whose `last_updated` is older
than the global `timeout` and triggers a logout event for those users.

```php
SessionTracker::isSessionExpired()         // checks if last_updated is too old
SessionTracker::updateSessionExpiration()  // bump last_updated = NOW()
SessionTracker::setupSessionDatabaseTracker()  // initial INSERT
```

Polling requests (e.g. background notifications) can opt out of the
expiration bump with `?skip_timeout_reset=1`.

---

## 6. Password hashing (`AuthHash`)

> Source: `src/Common/Auth/AuthHash.php`

`AuthHash` wraps `password_hash()` / `password_verify()` with
algorithm selection driven by globals:

| Algorithm | `gbl_auth_hash_algo` | Algorithm constant | Options |
|---|---|---|---|
| BCRYPT | `BCRYPT` | `PASSWORD_BCRYPT` | `cost` from `gbl_auth_bcrypt_hash_cost` |
| Argon2i | `ARGON2I` | `PASSWORD_ARGON2I` | `memory_cost`, `time_cost`, `threads` from globals |
| Argon2id | `ARGON2ID` | `PASSWORD_ARGON2ID` | same as Argon2i |
| SHA-512 crypt | `SHA512HASH` | (custom, `crypt()` with `$6$rounds=…`) | `rounds` from `gbl_auth_sha512_rounds` (default 100,000) |
| DEFAULT | `DEFAULT` | (resolve to current PHP default) | none |

The `passwordHash()` and `passwordVerify()` methods:

```php
class AuthHash
{
    public function passwordHash(&$password)  // returns the hashed string
    public function passwordNeedsRehash($hash): bool   // for upgrade-on-login
    public static function passwordVerify(&$password, $hash): bool
}
```

`passwordVerify` is **static** (no instance state) and adds an
optional "debug hash verification time" mode (when
`gbl_debug_hash_verify_execution_time` is true) for tuning the
algorithm cost.

### 6.1 Rehash on login

`AuthUtils::confirmPassword()` rehashes the stored password if the
algorithm is changed:

```php
if ($this->authHashAuth->passwordNeedsRehash($users_secure['password'])) {
    $newHash = $this->authHashAuth->passwordHash($_POST['clearPass']);
    privStatement("UPDATE users_secure SET password = ? WHERE id = ?", [$newHash, $uid]);
}
```

### 6.2 Password history

`users_secure` has `pwd_history1`, `pwd_history2`, `pwd_history3`
columns. New passwords are checked against the history and rejected
if they match (a basic re-use prevention).

### 6.3 Password expiration

If `password_expiration_days` is set, the password expires that many
days after `password_change_time`. The user is forced to change their
password on next login.

---

## 7. Brute-force protection

Two layers:

### 7.1 Per-IP (`ip_tracking` table)

> Source: `src/Common/Auth/AuthUtils.php` (look for `ip` field)

The `ip_tracking` table counts failures per IP. After N failures in
M minutes from the same IP, login attempts from that IP are blocked
for a back-off period.

### 7.2 Per-account (`users_secure` counters)

`users_secure` has:
- `current_lev_login_failures`
- `previous_lev_login_failures`
- `current_login_lock_until` (datetime until which the account is
  locked)
- `previous_login_lock_until` (for the previous window)

After N failures, the account is locked and the user sees a "too
many failed attempts, try again later" message.

### 7.3 HIPAA breach response

`current_hipaa_login_failures` and `previous_hipaa_login_failures` are
separate counters that trigger an "HIPAA breach" warning to the
admin at a higher threshold.

---

## 8. Timing-attack prevention

The `preventTimingAttack()` method ensures that "user not found" and
"user found, wrong password" take the same time:

```php
private function preventTimingAttack()
{
    if (empty($this->dummyHash)) {
        // Bootstrap (in constructor): a bcrypt/argon2 hash of "dummy"
        // is stored in the `globals` table under `hidden_auth_dummy_hash`.
    }
    password_verify('dummy', $this->dummyHash);
}
```

The dummy hash is stored once in `globals.gl_name = 'hidden_auth_dummy_hash'`
and re-hashed on every algorithm change.

---

## 9. LDAP fallback

> Source: `src/Common/Auth/AuthUtils.php` `confirmUserPassword()`

If the user is configured to use LDAP (`gbl_ldap_enabled` global +
per-user LDAP setting), the password is first checked against LDAP.
LDAP users bypass the local password lockout and expiration, but the
user record is still in `users` / `users_secure` (the password field
in `users_secure` is irrelevant for LDAP users).

A handful of users can be marked as "excluded from LDAP" so the
local check applies.

---

## 10. Google Sign-In

> Source: `src/Common/Auth/AuthUtils.php` `verifyGoogleSignIn()`

If `google_signin_enabled` is true and the login form includes a
`used_google_signin` and `google_signin_token`, the flow becomes:

1. `AuthUtils::verifyGoogleSignIn($_POST['google_signin_token'])` —
   calls `Google_Client::verifyIdToken()`.
2. The token's `email` claim is matched against `users.username`.
3. On success, the user is logged in (bypasses the password check).
4. Login failure counter and lockout still apply to the IP.

Google Sign-In users bypass LDAP, password history, and password
expiration.

---

## 11. `OneTimeAuth` (patient portal tokens)

> Source: `src/Common/Auth/OneTimeAuth.php`

For the patient portal, OpenEMR uses one-time email tokens (not MFA).
The flow:

1. Patient requests an action (e.g. "reset password", "register").
2. `OneTimeAuth::createPortalOneTime()` generates a random 16-byte
   token, encrypts it with `CryptoGen`, and emails it (or, for
   registration, requires both token + 6-digit PIN).
3. The token + optional actions are stored in the `onetime_auth` table.
4. Patient clicks the link → `OneTimeAuth::decodePortalOneTime()`
   validates the token and expires it.
5. The patient is granted a portal session.

The `actions` array can include:
- `enforce_onetime_use` (true by default — token can be used only once)
- `extend_portal_visit` (skip the logout redirect)
- `enforce_auth_pin` (require the 6-digit PIN)
- `max_access_count` (0 = unlimited)

---

## 12. Password change (`AuthUtils::updatePassword()`)

```php
public function updatePassword($user, $newpass, $oldpass = null): bool
{
    // 1. If oldpass given, verify against current hash
    // 2. Check new password against pwd_history1..3
    // 3. Enforce password strength (gbl_min_password_length, complexity)
    // 4. Rehash with current algorithm
    // 5. UPDATE users_secure SET password = ?, pwd_history1 = old_pwd, pwd_history2 = pwd_history1, ...
    // 6. Bump password_change_time
    // 7. Reset login failure counters
    // 8. Audit-log the change
}
```

See `library/user.inc.php` for legacy user management code that
calls this.

---

## 13. Audit events

Authentication emits these `log` events via `EventAuditLogger`:

| Event | When |
|---|---|
| `login` | Successful login (`success=1`). |
| `login` (failed) | Failed login (`success=0`). |
| `logout` | Successful logout (`success=1`). |
| `logout` (timeout) | Forced logout due to idle timeout (`success=0`, comment "timeout"). |
| `security-access-denied` | ACL denial (handled separately; see `auth/acl-system.md`). |
| `password-reset` | Password reset by admin or self-service. |

---

## 14. See also

- [`mfa.md`](./mfa.md) — TOTP / U2F flow
- [`oauth2-server.md`](./oauth2-server.md) — API authentication via OAuth2
- [`acl-system.md`](./acl-system.md) — post-auth authorization
- [`../architecture/bootstrap-flow.md`](../architecture/bootstrap-flow.md)
  — when the auth boot runs
- `library/auth.inc.php` — the dispatch
- `src/Common/Auth/AuthUtils.php` — the workhorse
