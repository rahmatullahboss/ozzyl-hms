# Multi-Factor Authentication (MFA)

> **Source paths:** `src/Common/Auth/MfaUtils.php`,
> `interface/main/main_screen.php`, `interface/usergroup/mfa_totp.php`,
> `interface/usergroup/mfa_u2f.php`, `interface/usergroup/mfa_registrations.php`,
> `library/classes/Totp.class.php`, `library/js/u2f-api.js`,
> `sql/database.sql` (the `login_mfa_registrations` table)
> **Documented version:** OpenEMR 8.0.1-dev

OpenEMR supports two MFA methods:

1. **TOTP** (RFC 6238) — Google Authenticator, Authy, 1Password, etc.
2. **U2F** (FIDO Universal 2nd Factor) — physical security keys like
   YubiKey.

A user may register **one or more** of each kind. On login, if any
MFA is registered, the user must complete the challenge before the
session is fully set up.

The patient portal **does not** use MFA; instead it uses one-time
email tokens via `OneTimeAuth` (see `authentication.md`).

---

## 1. The `login_mfa_registrations` table

```sql
CREATE TABLE `login_mfa_registrations` (
  `id` bigint(20) NOT NULL auto_increment,
  `user_id` bigint(20) NOT NULL default '0',
  `name` varchar(255) NOT NULL default '',
  `method` enum('TOTP','U2F') NOT NULL default 'TOTP',
  `var1` longtext,
  `var2` varchar(255) default NULL,
  `date_created` datetime default NULL,
  `date_modified` datetime default NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `user_id` | FK `users.id` |
| `name` | Human label (e.g. `iPhone 15`, `YubiKey 5C`). |
| `method` | `TOTP` or `U2F`. |
| `var1` | For TOTP: the **encrypted** TOTP secret. For U2F: JSON of `{version, keyHandle, publicKey, attestation, counter}`. |
| `date_modified` | For U2F: updated on each successful use (the counter). |

A user can have **multiple** rows (e.g. `iPhone` + `YubiKey`). The
MFA challenge is satisfied if **any** of the registered factors
succeeds.

---

## 2. `MfaUtils` — the workhorse

> Source: `src/Common/Auth/MfaUtils.php` (237 lines)

```php
namespace OpenEMR\Common\Auth;

class MfaUtils
{
    const TOTP_TOKEN_LENGTH = 6;
    const TOTP = 'TOTP';
    const U2F = 'U2F';

    private $types = [];     // ['TOTP', 'U2F'] in registration order
    private $regs;           // U2F keyHandle → name map
    private $registrations; // U2F registration objects
    private $var1U2F;
    private $var1TOTP;
    private $errorMsg = '';
    private $appId;

    public function __construct(private $uid) { … }
    public function tokenFromRequest($type) { … }
    public function isMfaRequired(): bool { … }
    public function getType(): array { … }
    public function check($token, $type): bool { … }
    public function errorMessage(): string { … }
    public function getAppId(): string { … }
    public function getU2fRequests(): false|string { … }
    private function checkTOTP($token): bool { … }
    private function checkU2F($token): bool { … }
    private function validateToken($token, $type): bool { … }
}
```

### 2.1 Constructor — load registrations

```php
public function __construct(private $uid)
{
    $res = sqlStatementNoLog(
        "SELECT a.name, a.method, a.var1 FROM login_mfa_registrations AS a "
      . "WHERE a.user_id = ? AND (a.method = 'TOTP' OR a.method = 'U2F') ORDER BY a.name",
        [$this->uid]
    );
    while ($row = sqlFetchArray($res)) {
        if ($row['method'] == 'U2F') {
            $this->types[] = 'U2F';
            $this->var1U2F = $row['var1'];
            $regobj = json_decode((string) $row['var1']);
            $this->regs[json_encode($regobj->keyHandle)] = $row['name'];
            $this->registrations[] = $regobj;
        } elseif ($row['method'] == 'TOTP') {
            $this->types[] = 'TOTP';
            $this->var1TOTP = $row['var1'];
        }
    }
    $scheme = "https://";   // (forced for FIDO U2F; HTTP would fail)
    $this->appId = $scheme . $_SERVER['HTTP_HOST'];
}
```

The `$appId` is the FIDO U2F `AppID` — typically `https://<host>`. It
must be HTTPS; over HTTP, U2F will not work.

### 2.2 `tokenFromRequest($type)`

```php
public function tokenFromRequest($type)
{
    $token = $_POST['mfa_token'] ?? null;
    if (is_null($token)) return null;
    return $this->validateToken($token, $type) ? $token : false;
}
```

Returns:
- `null` if no token was POSTed (challenge has not been completed yet).
- `false` if the token has the wrong shape (e.g. non-numeric for TOTP).
- The token string if it has the right shape (the caller will then
  call `check()` to actually validate the cryptographic value).

### 2.3 `check($token, $type)`

```php
public function check($token, $type)
{
    return match ($type) {
        'TOTP' => $this->checkTOTP($token),
        'U2F'  => $this->checkU2F($token),
        default => throw new \Exception('MFA type not supported'),
    };
}
```

`checkTOTP`:
1. Decrypt `var1TOTP` via `ServiceContainer::getCrypto()->decryptStandard()`.
2. If empty (the user's TOTP secret was encrypted with a different
   key in a previous install), try the password-based decryption
   fallback.
3. On success, re-encrypt with the standard key (one-time migration).
4. Validate the 6-digit code against the secret using `\Totp($secret)->validateCode($token)`.

`checkU2F`:
1. Read the previously-stored `users_secure.login_work_area` (the
   FIDO challenge JSON from `getU2fRequests()`).
2. Call `u2flib_server\U2F::doAuthenticate($requests, $registrations, $token)`.
3. On success, update the registration's `counter` in
   `login_mfa_registrations.var1` (U2F requires this for replay
   protection).

---

## 3. TOTP registration

> Source: `interface/usergroup/mfa_totp.php`

### 3.1 Flow

1. Admin (or self-service) navigates to **Admin → Users → MFA → Register TOTP**.
2. The server generates a random 16-byte base32 secret.
3. The secret is encrypted via `CryptoGen::encryptStandard()` and
   would also be displayable as a QR code (via
   `bacon/bacon-qr-code`).
4. The user scans the QR code into their authenticator app, enters
   the first 6-digit code to confirm.
5. The encrypted secret is stored in
   `login_mfa_registrations (user_id, method='TOTP', var1=encrypted_secret)`.

### 3.2 The `Totp` class

> Source: `library/classes/Totp.class.php`

A small wrapper over `RobThree\Auth\TwoFactorAuth` (from
`robthree/twofactorauth`):

```php
$googleAuth = new \Totp($secret);
$response = $googleAuth->validateCode($token);
```

`validateCode()` checks the current 30-second window, plus or minus
one window (to allow for clock drift).

### 3.3 Encryption at rest

The TOTP secret is encrypted with `CryptoGen::encryptStandard()`
before storage. The encryption key is the site-level
`CryptoGen` standard key (derived from `documents/logs_and_misc/methods/`).

For backward compatibility, `MfaUtils::checkTOTP` also supports
**password-based encryption** (where the TOTP secret was encrypted
with the user's `users_secure.password`). If a TOTP secret is
successfully decrypted with the password key, it is **re-encrypted
with the standard key** and the row is updated — a one-time
migration.

---

## 4. U2F registration

> Source: `interface/usergroup/mfa_u2f.php`, `library/js/u2f-api.js`

### 4.1 Flow

1. Admin (or self) navigates to **Admin → Users → MFA → Register U2F Key**.
2. The browser asks the user to tap their U2F key.
3. The key generates a key handle + public key + attestation.
4. The server stores the JSON of `{version, keyHandle, publicKey, attestation, counter}` in `login_mfa_registrations.var1`.
5. The user names the key (e.g. `YubiKey 5C`).

### 4.2 Challenge / response

On login, the server-side `MfaUtils::getU2fRequests()`:

```php
public function getU2fRequests()
{
    $u2f = new \u2flib_server\U2F($this->appId);
    $requests = json_encode($u2f->getAuthenticateData($this->registrations));
    sqlStatement(
        "UPDATE users_secure SET login_work_area = ? WHERE id = ?",
        [$requests, $this->uid]
    );
    return $requests;
}
```

The challenge is stored in `users_secure.login_work_area` (a
**scratch column** that the FIDO U2F flow uses to round-trip the
challenge from server to browser to key to server). After the user
taps the key, the browser POSTs the signed response; the server
reads `login_work_area` to validate.

After a successful U2F auth, the registration's `counter` is
incremented in the database to prevent replay.

---

## 5. The login flow with MFA

> Source: `interface/main/main_screen.php`

After a successful password login (`$_SESSION['authUserID']` is set),
`main_screen.php` checks for MFA:

```php
if (isset($_POST['new_login_session_management'])) {
    $registrationAttempt = false;
    $isU2F = false;
    $isTOTP = false;
    $res1 = sqlStatement(
        "SELECT a.name, a.method, a.var1 FROM login_mfa_registrations AS a "
      . "WHERE a.user_id = ? AND (a.method = 'TOTP' OR a.method = 'U2F') ORDER BY a.name",
        [$_SESSION['authUserID']]
    );
    while ($row1 = sqlFetchArray($res1)) {
        $registrationAttempt = true;
        if ($row1['method'] == 'U2F') {
            $isU2F = true;
            // … collect registration objects
        } else {
            $isTOTP = true;
        }
    }

    if ($registrationAttempt) {
        // Either render the challenge form OR validate the submitted response
        $form_response = empty($_POST['form_response']) ? '' : $_POST['form_response'];

        if ($form_response) {
            // TOTP
            if (isset($_POST['totp']) && trim($_POST['totp']) != "" && $isTOTP) {
                // … validate TOTP code
            }
            // U2F
            if ($isU2F && $form_response) {
                // … validate U2F response
            }
        } else {
            // Render the challenge form
            $appId = "https://" . $_SERVER['HTTP_HOST'];
            if ($isU2F) {
                $u2f = new u2flib_server\U2F($appId);
                $requests = $u2f->getAuthenticateData($registrations);
                // … stash in users_secure.login_work_area
                // … render <script>u2f.sign(…)</script>
            }
            if ($isTOTP) {
                // … render <input name="totp" id="totp" />
            }
            // … include posted_to_hidden('new_login_session_management') etc.
            echo $twig->render('main/mfa_challenge.html.twig', …);
            exit;
        }
    }

    // After MFA success (or no MFA registered)
    SessionTracker::setupSessionDatabaseTracker();
    // … render main app
}
```

The flow is:

```
main_screen.php
  │
  │  password OK, $_SESSION['authUserID'] set
  │  has MFA registrations?
  │    no  → SessionTracker::setupSessionDatabaseTracker() → render main app
  │    yes
  │      │
  │      │  has form_response (i.e. user submitted challenge)?
  │      │    no  → render challenge form (TOTP input + U2F JS), exit
  │      │    yes
  │      │      → validate TOTP and/or U2F
  │      │      → on success: SessionTracker + main app
  │      │      → on failure: back to challenge form with error
```

### 5.1 The 6 forms of state

`main_screen.php` can be in one of six states:

| State | Auth | MFA registered | form_response |
|---|---|---|---|
| 1 | pending | n/a | n/a (not on this page) |
| 2 | ok | no | n/a |
| 3 | ok | yes | absent (show challenge) |
| 4 | ok | yes | present + TOTP (validate TOTP) |
| 5 | ok | yes | present + U2F (validate U2F) |
| 6 | ok | yes | present + both (validate both) |

States 4–6 are the **only** way to escape to the main app.

---

## 6. OAuth2 with MFA

> Source: `src/RestControllers/AuthorizationController.php`, `src/Common/Auth/MfaUtils.php`

A user can also authenticate to the OAuth2 server (`oauth2/authorize.php`)
with MFA. The flow is:

1. User logs in via `main_screen.php` (with MFA).
2. User starts the OAuth2 authorization code flow.
3. At the consent screen, the user is redirected to the OAuth2
   `/authorize` endpoint.
4. The OAuth2 endpoint re-checks the session.
5. If the session is valid and has MFA, no further MFA prompt.
6. If the session is missing MFA, the OAuth2 flow fails with
   `access_denied`.

For **machine-to-machine** OAuth2 flows (e.g. `client_credentials` or
`private_key_jwt`), MFA is **not** required because no human is
involved.

For the **password grant** (legacy, deprecated), the user is required
to pass MFA as part of the password grant:

```
POST /oauth2/<site>/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&username=alice&password=…&mfa_token=123456
```

`AuthorizationController` validates `mfa_token` against the user's
TOTP secret using `MfaUtils::checkTOTP()`.

---

## 7. MFA in the patient portal

The patient portal does **not** support MFA. Instead, it uses
**one-time email tokens** via `OpenEMR\Common\Auth\OneTimeAuth`:

- For **registration** — the patient signs up, gets an email with a
  6-digit PIN + token URL, enters the PIN to verify ownership of the
  email.
- For **password reset** — the patient requests a reset, gets an
  email with a one-time token, uses the token to set a new password.
- For **two-step actions** (e.g. download medical records) — the
  patient gets an email with a one-time token, uses it to confirm.

The `onetime_auth` table holds the encrypted tokens. See
`authentication.md §11` for details.

---

## 8. Registration management UI

> Source: `interface/usergroup/mfa_registrations.php`

An admin can manage MFA registrations at **Admin → Users → MFA**:

| Action | Effect |
|---|---|
| View all registrations | List per user with method + name + last-used |
| Register TOTP for user | Generate secret, show QR, store |
| Register U2F for user | Browser-side U2F register, store registration |
| Delete a registration | Remove from `login_mfa_registrations` |
| Reset all MFA for user | Remove all rows for that user (e.g. lost device) |

A user can also self-service register via **User → Profile → MFA**,
which uses the same UI flow but limits the operations to the current
user.

---

## 9. Why the FIDO U2F approach is being deprecated

OpenEMR has historically used FIDO U2F (the original 2014 spec). The
modern spec is **FIDO2 / WebAuthn** (2018+), which subsumes U2F.
U2F requires HTTPS and a browser that can run the U2F JS shim
(`library/js/u2f-api.js`). FIDO2 is built into all modern browsers.

A future OpenEMR version will likely add WebAuthn support and
deprecate U2F. For now (8.0.1), U2F still works.

---

## 10. See also

- [`authentication.md`](./authentication.md) — the password flow
- [`oauth2-server.md`](./oauth2-server.md) — how MFA interacts with OAuth2
- `src/Common/Auth/MfaUtils.php` — the workhorse
- `interface/main/main_screen.php` — the MFA gate
- `interface/usergroup/mfa_totp.php` / `mfa_u2f.php` — registration UIs
