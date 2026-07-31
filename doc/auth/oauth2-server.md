# OAuth2 / OpenID Connect Server

> **Source paths:** `oauth2/authorize.php`, `src/RestControllers/AuthorizationController.php`,
> `src/Common/Auth/OpenIDConnect/`, `src/Services/JWTClientAuthenticationService.php`,
> `src/Services/TrustedUserService.php`, `src/Common/Auth/OpenIDConnect/Repositories/ScopeRepository.php`,
> `src/Common/Auth/OAuth2KeyConfig.php`
> **Documented version:** OpenEMR 8.0.1-dev

OpenEMR ships a full **OAuth2 Authorization Server** + **OpenID Connect
Identity Provider** + **SMART-on-FHIR** launcher. It is implemented on
top of `league/oauth2-server` 8.4 with the
`steverhoades/oauth2-openid-connect-server` OIDC extension.

The OAuth2 server is the **primary authentication surface for the REST
API and FHIR endpoints** (`/apis/`) and the SMART-on-FHIR launch flow.

---

## 1. Endpoints

All endpoints are mounted under `/oauth2/<site_id>/`:

| Path | Method | Purpose |
|---|---|---|
| `/oauth2/<site>/authorize` | GET, POST | Authorization endpoint (user is redirected here for the `authorization_code` flow). |
| `/oauth2/<site>/token` | POST | Token endpoint (exchange code/refresh/PKCE for access token). |
| `/oauth2/<site>/registration` | POST | Dynamic client registration (RFC 7591). |
| `/oauth2/<site>/jwk` | GET | The public JWK (used by clients to verify JWT signatures). |
| `/oauth2/<site>/introspect` | POST | Token introspection (RFC 7662). |
| `/oauth2/<site>/revoke` | POST | Token revocation (RFC 7009). |
| `/oauth2/<site>/logout` | GET, POST | End-User logout (front-channel). |
| `/oauth2/<site>/device/code` | POST | Device-code flow (per `AuthorizationController::DEVICE_CODE_ENDPOINT`). |
| `/oauth2/<site>/scope-authorize-confirm` | GET, POST | Custom scope authorization confirmation page. |
| `/oauth2/<site>/smart-styles` | GET | SMART-on-FHIR style manifest. |
| `/oauth2/<site>/.well-known/openid-configuration` | GET | OIDC discovery (issued at runtime). |

Plus internal controllers (in `src/RestControllers/`):
- `AuthorizationController` — the main controller
- `SMARTAuthorizationController` — the SMART-on-FHIR controller
- `ApiApplication` — Symfony kernel + listener registration
- `HttpRestRequest`, `HttpRestRouteHandler` — request/response glue

---

## 2. Grant types

`AuthorizationController` defines:

```php
public const GRANT_TYPE_PASSWORD          = 'password';
public const GRANT_TYPE_CLIENT_CREDENTIALS = 'client_credentials';
public const OFFLINE_ACCESS_SCOPE          = 'offline_access';

const DEVICE_CODE_ENDPOINT            = "/device/code";
const GRANT_TYPE_ACCESS_TOKEN_TTL     = 'PT1H';   // 1 hour
const GRANT_TYPE_REFRESH_TOKEN_TTL    = 'P3M';    // 3 months
const GRANT_TYPE_ACCESS_CODE_TTL      = "PT300S"; // 5 minutes
```

### 2.1 Supported grants

| Grant | Use | Notes |
|---|---|---|
| `authorization_code` (with PKCE) | Interactive user flow (SMART apps, web apps) | The **recommended** flow. Code TTL 5 min. |
| `refresh_token` | Get a new access token without re-auth | TTL 3 months. |
| `password` (legacy) | Direct username + password + MFA | **Deprecated** by OAuth2.1; retained for back-compat. Requires MFA `mfa_token`. |
| `client_credentials` | Machine-to-machine (no human) | Used for backend services. |

### 2.2 SMART-on-FHIR v1 / v2 scope syntax

`src/Common/Auth/OpenIDConnect/Repositories/ScopeRepository.php`
implements both:

- **SMART v1** — `patient/Patient.read`, `user/*.read`,
  `launch/patient`, `offline_access`, `openid`, `fhirUser`, `profile`,
  `email`, `address`, `phone`.
- **SMART v2** — granular per-resource-type scopes with `rs` (read),
  `rw` (write), `cr` (create), `de` (delete), plus search/operation
  modifiers: `patient/Patient.rs?category=laboratory`.

`SMARTAuthorizationController` (in `src/RestControllers/SMART/`)
parses the requested scope, presents a consent screen, and persists
the granted scope to the `oauth_trusted_user` record.

---

## 3. Client authentication

> Source: `src/Services/JWTClientAuthenticationService.php`

Three client auth methods are supported per the `token_endpoint_auth_method` registered in the `oauth_clients` table:

| Method | Use | Mechanism |
|---|---|---|
| `client_secret_basic` | Confidential client with a secret | `Authorization: Basic base64(client_id:client_secret)` |
| `client_secret_post` | Confidential client with a secret | Form fields `client_id` + `client_secret` |
| `private_key_jwt` | Asymmetric (SMART Backend Services) | RFC 7523 client assertion: `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` and `client_assertion=<JWT>` |
| `none` | Public client (no secret) | PKCE only |

### 3.1 JWT client assertion (RFC 7523 / SMART Backend Services)

`JWTClientAuthenticationService` handles the asymmetric flow:

```php
class JWTClientAuthenticationService
{
    const OAUTH_JWT_CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
    const MAX_JWT_EXPIRATION_HOURS       = 24;
    const MAX_CLOCK_DRIFT_MINUTES         = 1;

    public function hasJWTClientAssertion(ServerRequestInterface $request): bool;
    public function extractClientIdFromJWT(ServerRequestInterface $request): ?string;
    // (Validates issuer, audience, expiry, signature, then returns the Token.)
}
```

Validation:
1. Parse the JWT.
2. Verify `iss` and `sub` are the `client_id`.
3. Verify `aud` = the token endpoint URL.
4. Verify `exp` is in the future (max 24h).
5. Verify the signature against the client's registered JWK (or fetch
   the `jwks_uri`).
6. Check the JWT ID (`jti`) against `jwt_grant_history` for replay.

### 3.2 Replay prevention (`JWTRepository`)

> Source: `src/Common/Auth/OpenIDConnect/Repositories/JWTRepository.php`

Every accepted JWT client assertion is recorded in the `jwt_grant_history`
table by its `jti`. A second attempt with the same `jti` is rejected
with `invalid_grant`. The table is pruned periodically.

---

## 4. The AuthorizationController

> Source: `src/RestControllers/AuthorizationController.php` (1,883 lines)

```php
class AuthorizationController
{
    use CryptTrait;
    use SystemLoggerAwareTrait;

    public const ENDPOINT_SCOPE_AUTHORIZE_CONFIRM = "/scope-authorize-confirm";
    public const GRANT_TYPE_PASSWORD              = 'password';
    public const GRANT_TYPE_CLIENT_CREDENTIALS    = 'client_credentials';
    public const OFFLINE_ACCESS_SCOPE             = 'offline_access';
    const DEVICE_CODE_ENDPOINT                   = "/device/code";
    const GRANT_TYPE_ACCESS_TOKEN_TTL            = 'PT1H';
    const GRANT_TYPE_REFRESH_TOKEN_TTL           = 'P3M';
    const GRANT_TYPE_ACCESS_CODE_TTL             = "PT300S";

    public string $authBaseUrl;
    public string $authBaseFullUrl;
    public string $siteId;
    private string $privateKey;
    private string $passphrase;
    private string $publicKey;
    private string $oaEncryptionKey;
    private string $grantType;
    private string $authRequestSerial;
    private CryptoInterface $cryptoGen;
    private int|string|null $userId = null;
    private SMARTAuthorizationController $smartAuthController;
    private TrustedUserService $trustedUserService;
    private Environment $twig;
    private DecisionSupportInterventionService $dsiService;
    private ScopeRepository $scopeRepository;
    private ClientRepository $clientRepository;
    private ?callable $uuidUserFactory;
    private OEGlobalsBag $globalsBag;
    private string $webroot;
    private ServerConfig $serverConfig;

    public function __construct(
        private SessionInterface $session,
        private OEHttpKernel $kernel,
        private bool $providerForm = true
    ) {
        $globalsBag = $this->kernel->getGlobalsBag();
        $this->webroot = $globalsBag->get('webroot', '');
        $this->globalsBag = $globalsBag;
        if (empty($this->session->get('site_id'))) {
            throw OAuthServerException::serverError("OpenEMR error - unable to collect site id, so forced exit");
        }
        $this->siteId = $this->session->get('site_id');
        $this->authBaseUrl     = $this->webroot . '/oauth2/' . $this->siteId;
        $this->authBaseFullUrl = self::getAuthBaseFullURL($globalsBag, $this->session);
        $this->authRequestSerial = $this->session->get('authRequestSerial', '');
        $this->cryptoGen = ServiceContainer::getCrypto();
        $this->configKeyPairs($this->session);
        $this->trustedUserService = new TrustedUserService();
    }
    // … many methods
}
```

### 4.1 Key dependencies

| Dependency | Role |
|---|---|
| `SessionInterface` (`authserverOpenEMR` cookie) | The OAuth2 session. |
| `OEHttpKernel` | Symfony HttpKernel. |
| `TrustedUserService` | Manage `oauth_trusted_user` rows. |
| `SMARTAuthorizationController` | SMART-on-FHIR scope parsing. |
| `ScopeRepository` | Validates scopes against the registered catalog. |
| `ClientRepository` | Validates `client_id` / `client_secret` / JWK. |
| `OAuth2KeyConfig` | Manages the OAuth2 RSA key pair + symmetric key. |
| `CryptoGen` | Symmetric encryption (`oauth2key`, `oauth2passphrase`). |

### 4.2 The four custom grant classes

> Source: `src/Common/Auth/OpenIDConnect/Grant/`

| Grant class | File | Use |
|---|---|---|
| `CustomAuthCodeGrant` | `Grant/CustomAuthCodeGrant.php` | The `authorization_code` flow with PKCE. |
| `CustomRefreshTokenGrant` | `Grant/CustomRefreshTokenGrant.php` | The `refresh_token` flow. |
| `CustomPasswordGrant` | `Grant/CustomPasswordGrant.php` | The (legacy) `password` grant. Validates MFA `mfa_token`. |
| `CustomClientCredentialsGrant` | `Grant/CustomClientCredentialsGrant.php` | The `client_credentials` flow. |

Each subclass customizes the corresponding `league/oauth2-server`
abstract grant.

### 4.3 The OIDC Repositories

> Source: `src/Common/Auth/OpenIDConnect/Repositories/`

| Repository | Implements `league\…\…` | Role |
|---|---|---|
| `ClientRepository` | `ClientRepositoryInterface` | Validates `client_id` / `client_secret`, supports JWK / JWT client assertion. |
| `AccessTokenRepository` | `AccessTokenRepositoryInterface` | Persists issued access tokens (in-memory by default; can swap for a DB store). |
| `RefreshTokenRepository` | `RefreshTokenRepositoryInterface` | Persists refresh tokens. |
| `AuthCodeRepository` | `AuthCodeRepositoryInterface` | Persists authorization codes (TTL 5 min). |
| `ScopeRepository` | `ScopeRepositoryInterface` | Validates requested scopes against the catalog. |
| `UserRepository` | `UserRepositoryInterface` | Validates user credentials for the `password` grant. |
| `ClaimRepository` | (OIDC extension) | Builds the OIDC `id_token` claims from a user. |
| `JWTRepository` | (custom) | Replay prevention for JWT client assertions. |

### 4.4 The OIDC Entities

> Source: `src/Common/Auth/OpenIDConnect/Entities/`

| Entity | Role |
|---|---|
| `ClientEntity` | Represents a registered OAuth2 client. |
| `ScopeEntity` | Represents a granted scope. |
| `AccessTokenEntity` | The issued access token. |
| `RefreshTokenEntity` | The issued refresh token. |
| `AuthCodeEntity` | The issued authorization code. |
| `UserEntity` | The authenticated user. |
| `ClaimSetEntity` | A set of OIDC claims. |

### 4.5 The OIDC supporting classes

| Class | Role |
|---|---|
| `IdTokenSMARTResponse` | Builds the SMART-on-FHIR `id_token` response. |
| `SMARTSessionTokenContextBuilder` | Builds the session context for a SMART launch. |
| `JWT\JsonWebKeySet` | Represents a JWKS (RFC 7517). |
| `JWT\RsaSha384Signer` | RS384 signer (for SMART Backend Services). |
| `JWT\Validation\UniqueID` | Validates `jti` for replay prevention. |

---

## 5. OAuth2 keys and certificate management

> Source: `src/Common/Auth/OAuth2KeyConfig.php` (239 lines)

Two layers of keys are needed:

1. **Symmetric key** (`oauth2key` in the `keys` table) — used by
   `CryptoGen` to encrypt/decrypt tokens at rest. The plaintext value
   is held only in memory.
2. **Asymmetric key pair** — RSA keys on disk:
   - Private: `sites/<id>/documents/certificates/oaprivate.key`
     (passphrase-protected, `oauth2passphrase` from the `keys` table).
   - Public: `sites/<id>/documents/certificates/oapublic.key`.

### 5.1 Generation

If either is missing, `OAuth2KeyConfig::createOrRecreateKeys()`:

```php
private function createOrRecreateKeys(): void
{
    // 1. Delete existing keys (from DB and disk)
    // 2. Generate a random 32-byte symmetric key (base64)
    $this->oaEncryptionKey = base64_encode(random_bytes(32));
    // 3. Generate a 60-char passphrase
    $this->passphrase = RandomGenUtils::produceRandomString(60, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
    // 4. Generate the RSA key pair via openssl_pkey_new (sha256, RSA)
    $keysConfig = [
        "default_md" => "sha256",
        "private_key_type" => OPENSSL_KEYTYPE_RSA,
        "private_key_bits" => 2048,
        "encrypt_key" => true,
    ];
    $res = openssl_pkey_new($keysConfig);
    openssl_pkey_export($res, $privkey, $this->passphrase);
    $pubkey = openssl_pkey_get_details($res)['key'];
    // 5. Store on disk + in DB (encrypted via CryptoGen)
    file_put_contents($this->privateKey, $privkey);
    file_put_contents($this->publicKey, $pubkey);
    $this->cryptoGen->encryptStandard($this->oaEncryptionKey, 'oauth2key');
    $this->cryptoGen->encryptStandard($this->passphrase, 'oauth2passphrase');
}
```

### 5.2 Validation on boot

`OAuth2KeyConfig::configKeyPairs()` is called on every Authorization
construction:

1. Read `oauth2key` from the `keys` table.
2. Decrypt via `CryptoGen::decryptStandard()`. If empty → throw
   `OAuth2KeyException`.
3. Read `oauth2passphrase`, decrypt similarly.
4. Verify both files exist on disk. If either is missing → throw
   `OAuth2KeyException`.

Missing keys trigger `createOrRecreateKeys()` automatically.

---

## 6. The trusted-user model (`oauth_trusted_user`)

> Source: `src/Services/TrustedUserService.php` (81 lines)

A "trusted user" record represents an authorized OAuth2 connection.
When a user authorizes a client, a row is inserted:

```sql
CREATE TABLE `oauth_trusted_user` (
  `id` bigint(20) NOT NULL auto_increment,
  `user_id` int(11) NOT NULL default '0',
  `client_id` varchar(80) NOT NULL default '',
  `scope` longtext,
  `persist_login` tinyint(1) NOT NULL default '0',
  `time` datetime NOT NULL,
  `code` varchar(255) default NULL,
  `session_cache` longtext,
  `grant_type` varchar(50) default 'authorization_code',
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `client_id` (`client_id`)
) ENGINE=InnoDB;
```

| Field | Notes |
|---|---|
| `code` | The one-time code used in the refresh flow. |
| `session_cache` | The active session id (revoked on user logout). |
| `persist_login` | If 1, the user stays logged in across browser sessions. |
| `grant_type` | `authorization_code`, `client_credentials`, or `password`. |

### 6.1 Logout revocation

When the user clicks **Logout** in OpenEMR, the `session_cache` is
cleared. The next time the client tries to refresh, the refresh
attempt fails because the `session_cache` does not match. The
`oauth_trusted_user` row remains (for audit) but no new tokens are
issued.

A user can also see and manually revoke trusted clients at
**User → Profile → Trusted Apps**.

---

## 7. The four session cookies (specifically `authserverOpenEMR`)

> Source: `src/Common/Session/SessionUtil.php` line 79

OAuth2 uses a **separate** session cookie from the main UI:
`authserverOpenEMR`. Its settings are:

| Setting | Value |
|---|---|
| `name` | `authserverOpenEMR` |
| `cookie_path` | `/oauth2/` |
| `cookie_httponly` | true |
| `cookie_samesite` | **None** (needed for cross-origin SMART launches) |
| `cookie_secure` | true (required when `samesite=None`) |
| `use_strict_mode` | 1 |
| `use_cookies` | 1 |
| `use_only_cookies` | 1 |

`SessionUtil::OauthSessionStart($web_root, $read_only)` constructs
these settings via `SessionConfigurationBuilder::forOauth()`.

### 7.1 Why `samesite=None`

SMART apps are typically **embedded in iframes** in a third-party
EHR. The browser needs to send the cookie even when the iframe is on
a different origin. `samesite=None` + `secure=true` is the only way
to allow this in modern browsers.

---

## 8. End-to-end authorization_code + PKCE flow

```
1. SMART app → OpenEMR
   GET /oauth2/<site>/authorize?
       response_type=code
       &client_id=app-123
       &redirect_uri=https://app.example.com/cb
       &scope=launch/patient+patient/Patient.read+openid+fhirUser
       &state=abc
       &aud=https://fhir.openemr.local/apis/default/fhir
       &code_challenge=<PKCE>
       &code_challenge_method=S256

2. OpenEMR → user login
   The authorize endpoint sees no `authserverOpenEMR` session → redirects
   to /interface/login/login.php?site=… (or /main_screen.php for MFA).
   After login (and MFA), the user is bounced back to /authorize.

3. OpenEMR → consent screen
   /authorize dispatches to AuthorizationController::handleAuthorizeRequest
   which checks the requested scopes and presents the consent page
   (rendered by `templates/oauth2/authorize.html.twig`).

4. User clicks "Allow"
   POST /oauth2/<site>/authorize with `authorize=1`.
   AuthorizationController persists the request to the session
   (`authRequestSerial`), generates an auth code, and redirects
   to the client's `redirect_uri` with `?code=xyz&state=abc`.

5. App → OpenEMR token exchange
   POST /oauth2/<site>/token
   grant_type=authorization_code
   &code=xyz
   &redirect_uri=https://app.example.com/cb
   &code_verifier=<PKCE-verifier>

6. OpenEMR → token response
   {
     "access_token": "...",
     "token_type": "Bearer",
     "expires_in": 3600,
     "scope": "...",
     "refresh_token": "...",
     "id_token": "...",
     "patient": "..."   (SMART v1 launch context)
   }

7. App → FHIR API
   GET /apis/default/fhir/Patient/123
   Authorization: Bearer ...

8. App → refresh
   POST /oauth2/<site>/token
   grant_type=refresh_token
   &refresh_token=...
```

---

## 9. End-to-end password grant (legacy)

```
1. App → OpenEMR
   POST /oauth2/<site>/token
   grant_type=password
   &username=alice
   &password=...
   &scope=openid+fhirUser
   &mfa_token=123456   ← required if user has MFA

2. OpenEMR
   UserRepository::getUserEntityByUserCredentials:
   - $userService->getUserByUsername($username) → users.id
   - AuthUtils::confirmPassword() (mode=api)
   - if user has TOTP, MfaUtils::checkTOTP($mfa_token)
   - returns UserEntity

3. Token response
   { access_token, token_type, expires_in, refresh_token, scope, id_token }

4. App → FHIR API with the bearer token.
```

The password grant is **deprecated** by OAuth2.1 but retained for
backward compatibility. New clients should use `authorization_code`
+ PKCE.

---

## 10. End-to-end client_credentials (machine-to-machine)

```
1. Service → OpenEMR
   POST /oauth2/<site>/token
   grant_type=client_credentials
   &client_id=service-x
   &client_secret=...   (or client_assertion for private_key_jwt)
   &scope=system/*.read

2. OpenEMR
   ClientRepository::validateClient() checks the secret.
   No user context (user_id is null).

3. Token response
   { access_token, token_type, expires_in, scope }
   No refresh_token, no id_token.
```

This is the SMART-on-FHIR **Backend Services** authorization pattern
— a system-level client polls the FHIR API without a human.

---

## 11. Session ID types — which cookie for which call

| Surface | Cookie | Used for |
|---|---|---|
| OpenEMR main UI | `OpenEMR` | Login, MFA, main app |
| **OAuth2 server** | `authserverOpenEMR` | /oauth2/authorize, /oauth2/token, /oauth2/registration, etc. |
| REST / FHIR API | `apiOpenEMR` | /apis/, FHIR, bulk export |
| Patient portal | `PortalOpenEMR` | /portal/ |

The four are **completely separate** — a token issued under
`apiOpenEMR` is **not** valid under `OpenEMR`. The OAuth2 server
issues tokens that are then presented (as a Bearer) to `/apis/`,
which validates them and creates an `apiOpenEMR` session for the
duration of the request.

---

## 12. Audit events

| Event | When |
|---|---|
| `oauth2` | Generic OAuth2 audit (with `success=0` and a comment for failures). |
| `oauth2-login-success` | User successfully authorized a client. |
| `oauth2-login-failure` | User failed to authorize (e.g. bad client, bad scope, bad MFA). |
| `oauth2-token-issue` | Token issued. |
| `oauth2-key-missing` | OAuth2KeyConfig had to regenerate keys. |

All logged via `EventAuditLogger::newEvent("oauth2", $user, $group, $success, $comment)`.

---

## 13. See also

- [`authentication.md`](./authentication.md) — the password + session layer
- [`mfa.md`](./mfa.md) — how MFA interacts with the password grant
- [`../interop/smart-on-fhir.md`](../interop/smart-on-fhir.md) (if present) — the SMART flow
- `src/RestControllers/AuthorizationController.php` — the main controller
- `src/Common/Auth/OpenIDConnect/` — repositories, entities, grants
- `src/Services/TrustedUserService.php` — the trusted-user store
- `src/Services/JWTClientAuthenticationService.php` — RFC 7523 client assertion
- `src/Common/Auth/OAuth2KeyConfig.php` — key pair management
- `oauth2/authorize.php` — the front controller
