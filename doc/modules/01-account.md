# Account Module

The Account module is the authentication and identity subsystem for DanpheEMR. It owns login, logout, password change, license enforcement, remember-me, JWT issuance, session lifecycle, and integrates with the RBAC subsystem (Application, Role, Permission, User, Route) and the Employee subsystem. Every protected controller in the application derives the current user from the session this module establishes.

Source files studied:

| Layer | File | Lines |
|-------|------|-------|
| Controller | `Code/Websites/DanpheEMR/Controllers/AccountController.cs` | 635 |
| Views | `Code/Websites/DanpheEMR/Views/Account/{Login,ChangePassword,ForgotPassword,LicenseExpired,UnAuthorizeAccess,PageNotFound,ErrorPage}.cshtml` | 7 files |
| Security library | `Code/Components/DanpheEMR.Security/RBAC/{DanpheRBAC,RbacUser,RbacRole,RbacPermission,RbacApplication,Routes,LoginViewModel,ChangePasswordViewModel,RbacOtherModels}.cs` | 9 files |
| DbContext (RBAC) | `Code/Components/DanpheEMR.Security/RbacDbContext.cs` | 74 |
| DbContext (SysAdmin) | `Code/Components/DanpheEMR.DalLayer/SystemAdminDbContext.cs` | 38 |
| Server models | `Code/Components/DanpheEMR.ServerModel/MasterModels/{LoginInformationModel,CookieAuthInfoModel}.cs` | 39 |
| Frontend | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/account/{unauthorized-access.html,unauthorizes-access.component.ts}` | 2 files |

---

## 1. Module Overview

### 1.1 Responsibilities

| Capability | Where it lives | Notes |
|------------|----------------|-------|
| Login (form post) | `AccountController.Login(LoginViewModel)` POST `AccountController.cs:197` | MVC Razor form, anti-forgery token, audit-logged |
| Login (REST for SPA) | `AccountController.LoginToDanpheEMR(LoginDto)` `AccountController.cs:549` | Returns JWT only, used by Swagger/Postman |
| Logout | `AccountController.Logout` `AccountController.cs:285` | Clears session + cookies, writes LoginInformation row |
| Change password | `AccountController.ChangePassword` `AccountController.cs:335` | Reads raw body, calls `RBAC.UpdateDefaultPasswordOfUser` |
| Forgot password | `AccountController.ForgotPassword` `AccountController.cs:330` | Static "contact administrator" page (placeholder) |
| License gate | `AccountController.Login` GET `AccountController.cs:66-125` | Reads `TenantMgnt/SoftwareLicense` parameter, redirects to `LicenseExpired` |
| Remember me | `SetRememberMeCookieVariable` / `UpdateRememberMeCookie` / `RemoveRememberMeCookie` `AccountController.cs:413-522` | Selector + SHA-256 hashed validator, persisted in `Danphe_CookieAuthInfo` |
| Session hydration | `SetSessionVariable` `AccountController.cs:382` | Stores `currentuser`, `validpermissionlist`, `user-roles` in `HttpContext.Session` |
| JWT issuance | `GenerateJwtToken` `AccountController.cs:615` | HS256, embeds serialized `RbacUser` as a single claim |
| RBAC lookups | `DanpheRBAC` static class `DanpheRBAC.cs` | Cached user/role/permission/route lookups |
| Password crypto | `RBAC.EncryptPassword` / `DecryptPassword` `DanpheRBAC.cs:356-396` | Triple-DES + MD5 salt `"Danphesalt"` |
| Unauthorized view | `AccountController.UnAuthorizeAccess` `AccountController.cs:375` and Angular `UnAuthorizedAccessComponent` | Both 401 page and Angular 401 component exist |

### 1.2 Account Lifecycle

```
[User opens /Account/Login GET]
        |
        v
[License check] --expired--> [Redirect LicenseExpired]
        |
        v
[Already signed in?] --yes--> [Redirect Home/Index]
        |
        v
[Remember-me cookie present?] --yes--> [Validate selector+hash] --> [Auto-login]
        |
        v
[Show Login.cshtml form]
        |
        v  (POST with anti-forgery token)
[Authenticate: RBAC.GetUser(username, password)]
        |
        v
[Active flag check] --inactive--> [Show "user-inactive" status]
        |
        v
[Insert DanpheLogInInformation row (ActionName="login" or "invalid-login-attempt")]
        |
        v
[SetSessionVariable + GenerateJwtToken + TempData["loginJwtToken"]]
        |
        v
[If RememberMe: SetRememberMeCookieVariable]
        |
        v
[Audit.Api Login event (password redacted)]
        |
        v
[Redirect Home/Index]
```

Logout, password change, and unauthorized are separate flows covered in section 5.

### 1.3 Why `AccountController` Does Not Inherit `CommonController`

`AccountController.cs:32` carries the explicit comment:

```csharp
//IMPORTANT: AccountController shouldn't inherit from CommonController,
//since in this case, we have to allow anonymous authentication.
public class AccountController : Controller
```

Every other controller in the codebase inherits from `CommonController` (which requires an authenticated `RbacUser` in the session). The login and token endpoints must be reachable by an unauthenticated browser, so this controller is the deliberate exception.

---

## 2. Backend Files

### 2.1 `AccountController.cs` — Method Table

Source: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/AccountController.cs`

| # | Method | Line | Signature | Verb | Auth | Audit | Purpose |
|---|--------|------|-----------|------|------|-------|---------|
| 1 | `LicenseExpired` | 57 | `IActionResult LicenseExpired()` | GET (default route) | anonymous | no | Renders the `LicenseExpired.cshtml` view after a `TempData["LicenseMessage"]` redirect |
| 2 | `Login` | 66 | `IActionResult Login(string returnUrl = null)` | GET `/Account/Login` | `[AllowAnonymous]` | no | License check, session-already-set redirect, remember-me cookie auto-login, render `Login.cshtml` |
| 3 | `Login` | 197 | `IActionResult Login(LoginViewModel model, string returnUrl = null)` | POST `/Account/Login` | `[AllowAnonymous]`, `[ValidateAntiForgeryToken]` | `[AuditApi(EventTypeName="Login")]` (full request/response, then `password` redacted in audit) | Validates model, authenticates user, logs `LoginInformation`, sets session, issues JWT, optional remember-me cookie |
| 4 | `Logout` | 285 | `IActionResult Logout(string returnUrl = null)` | GET (no `[HttpPost]` attribute applied) | implicit authenticated | commented-out (see `AccountController.cs:280-284`) | Removes session + cookies, logs `LoginInformation` action `logout`, returns `Login.cshtml` with `status=logout-success` |
| 5 | `PageNotFound` | 318 | `IActionResult PageNotFound()` | GET | implicit | no | Renders `PageNotFound.cshtml` |
| 6 | `ForgotPassword` | 330 | `IActionResult ForgotPassword()` | GET | implicit | no | Renders the static `ForgotPassword.cshtml` "contact administrator" placeholder |
| 7 | `ChangePassword` | 335 | `IActionResult ChangePassword()` | implicit POST (no `[HttpPost]`) | implicit authenticated | no | Reads `Request.Body` JSON into `ChangePasswordViewModel`, calls `RBAC.UpdateDefaultPasswordOfUser`, returns `Json(DanpheJSONConvert.SerializeObject(...))` |
| 8 | `UnAuthorizeAccess` | 375 | `IActionResult UnAuthorizeAccess(string returnUrl = null)` | GET | `[AllowAnonymous]` | no | Renders `UnAuthorizeAccess.cshtml` (401 page) |
| 9 | `LoginToDanpheEMR` | 549 | `IActionResult LoginToDanpheEMR([FromBody] LoginDto loginDto)` | POST `/api/Account/GetLoginJwtToken` | implicit | (inherits `[AuditApi]` from the controller-level filter, if any) | API twin of the form post — used by Swagger/Postman; returns `{ message, loginJwtToken }` JSON |
| 10 | `SetSessionVariable` | 382 | `void SetSessionVariable(RbacUser currentValidUser)` | private helper | — | — | Sets `currentuser`, `validpermissionlist`, `user-roles` in `HttpContext.Session` |
| 11 | `SetRememberMeCookieVariable` | 413 | `void SetRememberMeCookieVariable(long selector, int userId)` | helper | — | — | Generates a new validator, stores hashed row in `Danphe_CookieAuthInfo`, sets `uRef` and `uData` cookies for 2 years |
| 12 | `RemoveSessionValues` | 465 | `void RemoveSessionValues()` | helper | — | — | `HttpContext.Session.Clear()` |
| 13 | `RemoveRememberMeCookie` | 480 | `void RemoveRememberMeCookie()` | helper | — | — | `Response.Cookies.Delete("uData"/"uRef")` |
| 14 | `UpdateRememberMeCookie` | 488 | `void UpdateRememberMeCookie(long selector)` | helper | — | — | Rotates the validator on every successful auto-login; deletes old `uData`, writes new, updates DB row |
| 15 | `ComputeSha256Hash` | 526 | `static string ComputeSha256Hash(string rawData)` | private static | — | — | Standard SHA-256 hex digest for the remember-me validator |
| 16 | `GenerateJwtToken` | 615 | `JwtSecurityToken GenerateJwtToken(RbacUser currentUser)` | private | — | — | HS256 JWT with `issuer`, `audience`, `expiry` from `MyConfiguration.JwtTokenConfig`; single claim: serialized `RbacUser` JSON under `ENUM_ClaimTypes.currentUser` |

### 2.2 Constructor / DI

`AccountController.cs:46-55`:

```csharp
public AccountController(IOptions<MyConfiguration> _config)
{
    connString        = _config.Value.Connectionstring;
    connStringAdmin   = _config.Value.ConnectionStringAdmin;
    JwtKey            = _config.Value.JwtTokenConfig.JwtKey;
    JwtIssuer         = _config.Value.JwtTokenConfig.JwtIssuer;
    JwtAudience       = _config.Value.JwtTokenConfig.JwtAudience;
    JwtValidMinutes   = _config.Value.JwtTokenConfig.JwtValidMinutes;
}
```

Two connection strings and four JWT settings are pulled from `MyConfiguration`.

### 2.3 Razor Views

| View | Source | Purpose |
|------|--------|---------|
| `Login.cshtml` | `Views/Account/Login.cshtml` | Two-column layout; left marketing panel, right sign-in form with `UserName`, `Password`, `RememberMe`, `Forgot password?` link. Renders status banners: `login-failed`, `logout-success`, `user-inactive`, `expiry-notice`. |
| `ChangePassword.cshtml` | `Views/Account/ChangePassword.cshtml` | Username pre-filled and readonly; Old/New/Confirm password inputs. Shows `changepassword-failed`, `new&confirmpass-not-provided`, `new&confirmpass-different` status banners. (Note: the JSON-body `ChangePassword()` action bypasses this view — the view is for any future MVC form flow.) |
| `ForgotPassword.cshtml` | `Views/Account/ForgotPassword.cshtml` | Static "contact system-administrator" message. |
| `LicenseExpired.cshtml` | `Views/Account/LicenseExpired.cshtml` | Red banner with `TempData["LicenseMessage"]` ("License expired on: yyyy-MMM-dd" or "License Information not found.."). |
| `UnAuthorizeAccess.cshtml` | `Views/Account/UnAuthorizeAccess.cshtml` | Razor 401 page. |
| `PageNotFound.cshtml` | `Views/Account/PageNotFound.cshtml` | Razor 404 page. |
| `ErrorPage.cshtml` | `Views/Account/ErrorPage.cshtml` | Generic error page. |

### 2.4 Frontend (Angular)

`DanpheEMR/wwwroot/DanpheApp/src/app/account/`:

- `unauthorized-access.html` — Static HTML with 401 illustration, "Oops! UNAUTHORIZED ACCESS !" headline.
- `unauthorizes-access.component.ts` — Trivial Angular component (`UnAuthorizedAccessComponent`) that loads the HTML.

The bulk of the Angular client lives in other modules; Account-specific SPA work is intentionally minimal because the login form is server-rendered Razor and the SPA only needs a 401 component.

---

## 3. Data Models

### 3.1 RBAC Models (`DanpheEMR.Security`)

#### `RbacUser` — `RBAC/RbacUser.cs`

```csharp
public partial class RbacUser : ICloneable
{
    [Key] public int     UserId           { get; set; }
    public int           EmployeeId       { get; set; }
    public string        UserName         { get; set; }
    public string        Password         { get; set; }   // Triple-DES encrypted, never returned in plain
    public string        Email            { get; set; }
    public int           CreatedBy        { get; set; }
    public DateTime      CreatedOn        { get; set; }
    public int?          ModifiedBy       { get; set; }
    public DateTime?     ModifiedOn       { get; set; }
    public List<RbacRole> Roles           { get; set; }
    public bool?         IsActive         { get; set; }
    public bool?         NeedsPasswordUpdate { get; set; }
    public EmployeeModel Employee         { get; set; }   // nav
    public int?          LandingPageRouteId { get; set; } // Ajay 07Aug19

    public object Clone() => this.MemberwiseClone();
}
```

Used as the session payload: every controller retrieves it with `HttpContext.Session.Get<RbacUser>("currentuser")`. The `ICloneable` implementation matters because `RBAC.GetUser(...)` clones the cached user before returning so the session cannot be mutated through the cache.

#### `RbacRole` — `RBAC/RbacRole.cs`

```csharp
[Key] public int    RoleId          { get; set; }
public string       RoleName        { get; set; }
public string       RoleDescription { get; set; }
public string       RoleType        { get; set; }   // free-form category text
public int?         ApplicationId   { get; set; }
public bool         IsSysAdmin      { get; set; }   // super-admin flag
public bool         IsActive        { get; set; }
public int?         RolePriority    { get; set; }
[ForeignKey("Route")] public int? DefaultRouteId { get; set; }
public int          CreatedBy       { get; set; }
public DateTime     CreatedOn       { get; set; }
public int?         ModifiedBy      { get; set; }
public DateTime?    ModifiedOn      { get; set; }
public RbacApplication Application  { get; set; }
public List<RbacPermission> Permissions { get; set; }
public List<RbacUser>     Users        { get; set; }
public DanpheRoute         Route        { get; set; }
```

`IsSysAdmin = true` causes `RBAC.GetUserAllPermissions` to return every permission in the system (`DanpheRBAC.cs:253-258`).

#### `RbacPermission` — `RBAC/RbacPermission.cs`

```csharp
[Key] public int   PermissionId   { get; set; }
public string      PermissionName { get; set; }
public string      Description    { get; set; }
public int?        ApplicationId  { get; set; }
public int         CreatedBy      { get; set; }
public DateTime    CreatedOn      { get; set; }
public int?        ModifiedBy     { get; set; }
public DateTime?   ModifiedOn     { get; set; }
public bool        IsActive       { get; set; }
public RbacApplication Application { get; set; }
public List<RbacRole> Roles        { get; set; }
```

#### `RbacApplication` — `RBAC/RbacApplication.cs`

```csharp
[Key] public int   ApplicationId   { get; set; }
public string      ApplicationCode { get; set; }   // e.g. "clinical", "billing"
public string      ApplicationName { get; set; }
public string      Description     { get; set; }
public bool        IsActive        { get; set; }
public int         CreatedBy       { get; set; }
public DateTime    CreatedOn       { get; set; }
public int?        ModifiedBy      { get; set; }
public DateTime?   ModifiedOn      { get; set; }
public List<RbacRole>      Roles       { get; set; }
public List<RbacPermission> Permissions { get; set; }
```

#### Mapping Tables — `RBAC/RbacOtherModels.cs`

```csharp
public class UserRoleMap {
    public int      UserRoleMapId { get; set; }
    public int      UserId        { get; set; }
    public int      RoleId        { get; set; }
    public DateTime? StartDate    { get; set; }
    public DateTime? EndDate      { get; set; }
    public int      CreatedBy     { get; set; }
    public DateTime CreatedOn     { get; set; }
    public int?     ModifiedBy    { get; set; }
    public DateTime? ModifiedOn   { get; set; }
    public bool     IsActive      { get; set; }
    public RbacUser  User         { get; set; }
    public RbacRole  Role         { get; set; }
}

public class RolePermissionMap {
    [Key] public int  RolePermissionMapId { get; set; }
    public int       RoleId               { get; set; }
    public int       PermissionId         { get; set; }
    public int       CreatedBy            { get; set; }
    public DateTime  CreatedOn            { get; set; }
    public int?      ModifiedBy           { get; set; }
    public DateTime? ModifiedOn           { get; set; }
    public bool      IsActive             { get; set; }
    public RbacPermission Permission      { get; set; }
    public RbacRole      Role             { get; set; }
}
```

#### `DanpheRoute` — `RBAC/Routes.cs`

```csharp
public class DanpheRoute {
    [Key] public int   RouteId                  { get; set; }
    public string      UrlFullPath              { get; set; }
    public string      DisplayName              { get; set; }
    public int?        PermissionId             { get; set; }   // gates the route
    public int?        ParentRouteId            { get; set; }   // menu hierarchy
    public bool?       DefaultShow              { get; set; }
    public string      RouterLink               { get; set; }
    public bool?       IsActive                 { get; set; }
    public bool?       IsSecondaryNavInDropdown { get; set; }
    [NotMapped] public List<DanpheRoute> ChildRoutes { get; set; }
    public string      Css                      { get; set; }
    public int?        DisplaySeq               { get; set; }
    [NotMapped] public int? ChildRoutesDefaultShowCount { get; set; }
}
```

#### `LoginViewModel` & `LoginDto` — `RBAC/LoginViewModel.cs`

```csharp
public class LoginViewModel {
    [Required] public string UserName    { get; set; }
    [Required][DataType(DataType.Password)] public string Password { get; set; }
    [Range(typeof(bool),"false","true")]
    [Display(Name="Remember me?")] public bool RememberMe { get; set; }
}

public class LoginDto {
    [Required] public string UserName    { get; set; }
    [Required][DataType(DataType.Password)] public string Password { get; set; }
}
```

`LoginDto` is documented as "We are using this DTO just to take login credentials from Swagger and Postman not from actual application" (`LoginViewModel.cs:23`).

#### `ChangePasswordViewModel` — `RBAC/ChangePasswordViewModel.cs`

```csharp
public class ChangePasswordViewModel {
    [Required] public string UserName    { get; set; }
    [Required][DataType(DataType.Password)] public string Password        { get; set; }
    [Required][DataType(DataType.Password)] public string NewPassword     { get; set; }
    [Required][DataType(DataType.Password)]
    [Compare("NewPassword", ErrorMessage="Confirm password doesn't match, Type again !")]
    public string ConfirmPassword { get; set; }
}
```

### 3.2 Server Models Used by the Module

#### `LoginInformationModel` — `ServerModel/MasterModels/LoginInformationModel.cs`

```csharp
public class LoginInformationModel {
    [Key] public int      InformationId { get; set; }
    public int?           EmployeeId    { get; set; }
    public string         UserName      { get; set; }
    public string         ActionName    { get; set; }   // "login" | "logout" | "invalid-login-attempt"
    public DateTime       CreatedOn     { get; set; }
}
```

Maps to table `DanpheLogInInformation` (`SystemAdminDbContext.cs:31`).

#### `CookieAuthInfoModel` — `ServerModel/MasterModels/CookieAuthInfoModel.cs`

```csharp
public class CookieAuthInfoModel {
    [Key] public int     AuthId       { get; set; }
    public long          Selector     { get; set; }   // random tick stamp
    public string        HashedToken  { get; set; }   // SHA-256 hex of (validator + selector)
    public int           UserId       { get; set; }
    public DateTime      Expires      { get; set; }   // 2 years from creation
}
```

Maps to table `Danphe_CookieAuthInfo` (`SystemAdminDbContext.cs:32`).

#### `EmployeeModel` — `ServerModel/EmployeeModels/Employee.cs`

`RbacUser.EmployeeId` is a foreign key to `EMP_Employee` (`RbacDbContext.cs:41`). The `Employee` nav is loaded for display (`RbacUser.cs:37`) but is not required during login.

#### `CfgParameterModel` & `ParameterModel` — `MasterModels/CfgParameterModel.cs` and `Core/Parameters/ParameterModel.cs`

```csharp
public class CfgParameterModel {
    [Key] public int    ParameterId        { get; set; }
    public string       ParameterGroupName { get; set; }
    public string       ParameterName      { get; set; }
    public string       ParameterValue     { get; set; }
    public string       ValueDataType      { get; set; }
    public string       Description        { get; set; }
    public string       ParameterType      { get; set; }
    public string       ValueLookUpList    { get; set; }
}

public class ParameterModel {
    [Key] public int    ParameterId        { get; set; }
    public string       ParameterGroupName { get; set; }
    public string       ParameterName      { get; set; }
    public string       ParameterValue     { get; set; }
    public string       ValueDataType      { get; set; }
    public string       Description        { get; set; }
}
```

The Account module reads `ParameterModel` from the core DB at `AccountController.cs:86-91` to validate the software license (group `TenantMgnt`, name `SoftwareLicense`).

### 3.3 Session Variables (`Utilities/SharedEnums.cs:372-397`)

```csharp
public static class ENUM_SessionVariables {
    public static readonly string CurrentUser = "currentuser";
    public static readonly string ActiveLabType = "activeLabName";
}

public static class ENUM_ClaimTypes {
    public static readonly string currentUser = "currentUser";   // JWT claim name
}
```

The module sets three session keys:

| Key | Type | Set by | Read by |
|-----|------|--------|---------|
| `currentuser` | `RbacUser` | `SetSessionVariable` `AccountController.cs:387` | Every protected controller via `HttpContext.Session.Get<RbacUser>(ENUM_SessionVariables.CurrentUser)` |
| `validpermissionlist` | `List<RbacPermission>` | `AccountController.cs:395` | Authorization checks |
| `user-roles` | `List<RbacRole>` | `AccountController.cs:401` | Role-aware UI rendering |

### 3.4 Cookies

| Cookie | Value | Lifetime | Set by | Read by |
|--------|-------|----------|--------|---------|
| `uRef` | `selector` (long) | 2 years | `SetRememberMeCookieVariable` `AccountController.cs:442` | `Login` GET `AccountController.cs:141` |
| `uData` | `validator` (string) | 2 years | `SetRememberMeCookieVariable` / `UpdateRememberMeCookie` `AccountController.cs:447,515` | `Login` GET `AccountController.cs:142` |

Both cookies are deleted on logout and on failed auto-login (`RemoveRememberMeCookie` `AccountController.cs:480-484`).

---

## 4. Database Tables

### 4.1 RBAC Schema (mapped in `RbacDbContext.cs`)

| Table | Entity | Purpose |
|-------|--------|---------|
| `RBAC_Application` | `RbacApplication` | Top-level grouping (e.g. clinical, billing). Roles and Permissions both have `ApplicationId`. |
| `RBAC_Permission` | `RbacPermission` | Atomic permission like `view-patient`, `edit-bill`. Soft-deactivatable. |
| `RBAC_Role` | `RbacRole` | Role with `IsSysAdmin` flag, optional `DefaultRouteId` (landing page), `RolePriority`, `ApplicationId`. |
| `RBAC_User` | `RbacUser` | Login record. `UserName` is case-insensitive (see `DanpheRBAC.cs:171-185`); `Password` is Triple-DES-encrypted; `IsActive` enables/disables login; `NeedsPasswordUpdate` forces first-login password reset. |
| `RBAC_MAP_UserRole` | `UserRoleMap` | Many-to-many User↔Role. `IsActive`, optional `StartDate`/`EndDate` for time-bound roles. |
| `RBAC_MAP_RolePermission` | `RolePermissionMap` | Many-to-many Role↔Permission. `IsActive` toggles per-mapping. |
| `RBAC_RouteConfig` | `DanpheRoute` | Frontend route metadata, optionally gated by a `PermissionId`. Hierarchical via `ParentRouteId` for menu building. |
| `EMP_Employee` | `EmployeeModel` | Linked via `RbacUser.EmployeeId`. |
| `PHRM_MST_Store` | `PHRMStoreModel` | Available to RBAC for store-level filtering. |
| `MST_MAP_StoreVerification` | `StoreVerificationMapModel` | Available to RBAC for verification-level filtering. |

### 4.2 SystemAdmin Schema (mapped in `SystemAdminDbContext.cs`)

| Table | Entity | Purpose |
|-------|--------|---------|
| `DanpheLogInInformation` | `LoginInformationModel` | Append-only log of `login` / `logout` / `invalid-login-attempt` actions. |
| `Danphe_CookieAuthInfo` | `CookieAuthInfoModel` | One row per remember-me token. `HashedToken` rotates on every auto-login. |
| `SysAdmin_Parameters` | `AdminParametersModel` | Various admin settings (not used directly by Account). |
| `SysAdmin_DBLog` | `DatabaseLogModel` | Database backup/restore log. |
| `tbl_AuditTableDisplayName` | `AuditTableDisplayName` | Audit display configuration. |

### 4.3 Core Schema (used for license)

| Table | Entity | Used by |
|-------|--------|---------|
| `Core_CFG_Parameters` (via `ParameterModel`) | `ParameterModel` | License check at `AccountController.cs:86-91` |

License JSON shape (decrypted, deserialized as anonymous type at `AccountController.cs:97-102`):

```json
{
  "StartDate":        "<encrypted base64>",
  "EndDate":          "<encrypted base64>",
  "ExpiryNoticeDays": "<encrypted base64>",
  "LicenseType":      "<encrypted base64>"
}
```

Each value is decrypted with `RBAC.DecryptPassword` (the same Triple-DES + MD5 routine used for user passwords) before being parsed.

---

## 5. Key Workflows

### 5.1 Login Flow (Form Post)

`AccountController.cs:197-278`

1. Model validation (`ModelState.IsValid`).
2. `RbacUser validUser = RBAC.GetUser(model.UserName, model.Password)` — case-insensitive username match, password compared against `EncryptPassword(input)` of the stored hash (`DanpheRBAC.cs:180-191`).
3. **User is null (failed login)** — insert `LoginInformationModel` with `ActionName = "invalid-login-attempt"`, return view with `ViewData["status"] = "login-failed"`.
4. **User is inactive** — return view with `ViewData["status"] = "user-inactive"`; no log row written for inactive-blocked attempts.
5. **Valid login** — null out `validUser.Password`, insert `LoginInformationModel` with `ActionName = "login"`, set session via `SetSessionVariable`, generate JWT via `GenerateJwtToken`, push the JWT into `TempData["loginJwtToken"]` for the Angular client to pick up (note: the comment `Krishna, 13thJan'23` documents this hand-off; the SPA reads the cookie or TempData after the redirect).
6. **If `model.RememberMe`** — call `SetRememberMeCookieVariable(ticksElapsed, validUser.UserId)` (`AccountController.cs:237-245`). Cookie lifetime is 2 years.
7. **Audit** — `[AuditApi]` captures the full request/response; immediately afterwards the audit event is sanitized in-place:
   - `model.Password = ""` (`AccountController.cs:250`)
   - `FormVariables = null` (line 252)
   - `RequestBody.Value` URL-encoded body has the literal `password=...` replaced with `password=*****` (lines 254-257)
8. Redirect to `Home/Index`.

### 5.2 Login Flow (GET / Re-entry)

`AccountController.cs:66-190`

1. Generate a tick stamp (selector) and a guid-based validator hashed with SHA-256 — these are **not used in the GET flow**; they are just computed. (They become relevant only when the user actually clicks Sign In with Remember Me on the POST.)
2. License check: read `TenantMgnt/SoftwareLicense` parameter from `CoreDbContext.Parameters`. If `paramValue == null` or `remainingDays < 0` → redirect to `LicenseExpired`. If `expiryNoticeDays > remainingDays` → set `ViewData["ExpiryNotice"]` banner.
3. If `HttpContext.Session.Get<RbacUser>("currentuser")` is non-null with a real `UserId` → redirect to `Home/Index` (skip the form).
4. If `uRef` cookie is present:
   - `selector = Convert.ToInt64(uRef)`
   - `hashedValidator = SHA-256(uData + uRef)`
   - Query `Danphe_CookieAuthInfo` for a unique `UserId` whose `Selector == selector` and `HashedToken == hashedValidator`.
   - **Exactly one match** → `RBAC.GetUser(userId)`, then:
     - If `IsActive == false` → strip cookies + session, return view with `user-inactive` status.
     - Otherwise, clear `validUser.Password`, call `UpdateRememberMeCookie(selector)` to rotate the validator, call `SetSessionVariable(validUser)`, redirect `Home/Index`.
   - **No match or multiple matches** → strip cookies + session, return `Login.cshtml`.

### 5.3 Logout Flow

`AccountController.cs:285-315`

1. Read the current `RbacUser` from session (if still present).
2. Insert `LoginInformationModel` with `ActionName = "logout"` (only when a current user existed).
3. `RemoveRememberMeCookie()` deletes `uData` and `uRef`.
4. `RemoveSessionValues()` clears the entire session.
5. Return `Login.cshtml` with `ViewData["status"] = "logout-success"`.

The POST/GET nature is informal — the original `[HttpPost]` + `[ValidateAntiForgeryToken]` + `[AuditApi]` decorators are commented out (see `AccountController.cs:280-284`), so Logout is effectively a GET that the navbar uses to wipe the session.

### 5.4 Password Change Flow

`AccountController.cs:335-371`

1. The action does not bind the model from MVC; it reads the raw request body:
   ```csharp
   Stream req = Request.Body;
   req.Seek(0, SeekOrigin.Begin);
   string str = new StreamReader(req).ReadToEnd();
   ChangePasswordViewModel chmodel = JsonConvert.DeserializeObject<ChangePasswordViewModel>(str);
   ```
2. Call `RBAC.UpdateDefaultPasswordOfUser(chmodel.UserName, chmodel.Password, chmodel.ConfirmPassword)` (`DanpheRBAC.cs:325-351`):
   - Re-encrypts the supplied `Password` and finds a user with matching `UserName` and `Password == EncryptPassword(password)`.
   - **Wrong old password** → returns `null` → controller returns JSON `Status="Failed", ErrorMessage="Current Password is Wrong"`.
   - **Match** → sets `Password = EncryptPassword(ConfirmPassword)`, `NeedsPasswordUpdate = false`, `ModifiedOn = DateTime.Now`, `ModifiedBy = usr.EmployeeId`, `EntityState.Modified`, save.
3. On success the controller also patches the in-memory session copy:
   ```csharp
   RbacUser currentUser = HttpContext.Session.Get<RbacUser>("currentuser");
   currentUser.NeedsPasswordUpdate = false;
   HttpContext.Session.Set<RbacUser>("currentuser", currentUser);
   ```
4. Returns JSON `Status="OK", Results=null` (the password is deliberately never echoed back, even though `RbacUser.Password` is now blanked only in the cloned response — the controller sets `Results = null` explicitly to prevent leakage during debugging).

### 5.5 Remember-Me Flow

Components: `SetRememberMeCookieVariable` (line 413), `UpdateRememberMeCookie` (line 488), `RemoveRememberMeCookie` (line 480), and the GET-time validation in `Login` (lines 137-183).

Token format:

```
selector  = ticks (DateTime.Now.Ticks - new DateTime(2001,1,1).Ticks)            // long
validator = Base64(Guid.NewGuid()) with "=" and "+" stripped                     // string
salt      = selector.ToString()                                                  // reused as a salt
hashed    = SHA-256(validator + selector)   // stored in Danphe_CookieAuthInfo
cookie uRef = selector.ToString()
cookie uData = validator
```

The validator is **never stored** — only its SHA-256 hash is. On every auto-login, `UpdateRememberMeCookie` regenerates the validator, deletes the old `uData` cookie, writes the new one, and patches the `HashedToken` column. Old cookies therefore become invalid by design.

Database expiry is 2 years from creation (`SetRememberMeCookieVariable` `AccountController.cs:437`). Cookies `uRef` and `uData` are both written with `Expires = authModel.Expires`, so the browser and the server stay in sync.

### 5.6 License Check Flow

`AccountController.cs:86-125`

1. `CoreDbContext coreDbContext = new CoreDbContext(connString);`
2. `ParameterModel licenseParam = coreDbContext.Parameters.Where(p => p.ParameterGroupName == "TenantMgnt" && p.ParameterName == "SoftwareLicense").FirstOrDefault();`
3. If `licenseParam == null` → `TempData["LicenseMessage"] = "License Information not found.."` → redirect `LicenseExpired`.
4. Otherwise deserialize `ParameterValue` as an anonymous type with `StartDate`, `EndDate`, `ExpiryNoticeDays`, `LicenseType`, then call `RBAC.DecryptPassword` on each.
5. Compute `remainingDays = (endDate - DateTime.Now).TotalDays`.
6. `remainingDays < 0` → `TempData["LicenseMessage"] = "License expired on: yyyy-MMM-dd"` → redirect `LicenseExpired`.
7. `expiryNoticeDays > remainingDays` → set `ViewData["ExpiryNotice"]` warning banner on the login page ("Your Software License is expiring in N days.").

The `LicenseExpired` view (section 2.3) is reachable from any failure case and is also linked from the Angular client when the API returns a license error.

### 5.7 Account-Active / Account-Inactive Flow

There is no explicit lockout counter in DanpheEMR (no failed-attempt counter, no `FailedLoginCount` column, no `LockedUntil` field). Inactive enforcement is by the `IsActive` flag on `RbacUser`:

- Login POST (`AccountController.cs:212-217`): `if (validUser.IsActive == false) → ViewData["status"] = "user-inactive"`.
- Login GET auto-login (`AccountController.cs:162-168`): same check, but additionally clears cookies + session before returning the view.
- `RBAC.UpdateDefaultPasswordOfUser` does **not** check `IsActive`, so an inactive user who is still allowed to hit `ChangePassword` (via direct API) could change their password. The deactivation workflow is therefore trusted to remove the user from any role that grants access to `ChangePassword` (i.e. don't rely on `IsActive` for security — flip the role mappings).

### 5.8 JWT Issuance

`AccountController.cs:615-633` (private `GenerateJwtToken`):

```csharp
var key   = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKey));
var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
var userClaims = new[] {
    new Claim(ENUM_ClaimTypes.currentUser, JsonConvert.SerializeObject(currentUser))
};
var token = new JwtSecurityToken(
    issuer:    JwtIssuer,
    audience:  JwtAudience,
    userClaims,
    expires:   DateTime.UtcNow.AddMinutes(Convert.ToDouble(JwtValidMinutes)),
    signingCredentials: creds);
return token;
```

The full `RbacUser` (sans password, which is nulled at line 218) is JSON-serialized into a single claim. The controller hands the resulting string back as `TempData["loginJwtToken"]` for the Angular client to retrieve after the redirect, and as `Ok({ message, loginJwtToken })` for the Swagger/Postman path.

JWT verification settings (`JwtIssuer`, `JwtAudience`, `JwtKey`, `JwtValidMinutes`) live in `MyConfiguration.JwtTokenConfig`.

---

## 6. API Endpoints

The Account module exposes both MVC routes (for the server-rendered Razor flows) and a single REST endpoint (for tooling and the JWT path). Endpoints are listed in the order they appear in the controller.

### 6.1 MVC / Razor Endpoints

| # | HTTP | Path | Action | File:Line | Auth | Body | Returns |
|---|------|------|--------|-----------|------|------|---------|
| 1 | GET | `/Account/LicenseExpired` | `LicenseExpired` | `AccountController.cs:57` | anonymous | — | `LicenseExpired.cshtml` view |
| 2 | GET | `/Account/Login?returnUrl=...` | `Login(string returnUrl)` | `AccountController.cs:66` | `[AllowAnonymous]` | — | `Login.cshtml` (with `status`, `ExpiryNotice`, `ReturnUrl` view data) |
| 3 | POST | `/Account/Login` | `Login(LoginViewModel, string returnUrl)` | `AccountController.cs:197` | `[AllowAnonymous]`, `[ValidateAntiForgeryToken]` | `application/x-www-form-urlencoded` (`Username`, `password`, `RememberMe`) | Redirect `Home/Index` on success; `Login.cshtml` with banner on failure |
| 4 | GET | `/Account/Logout` (no `[HttpPost]`) | `Logout(string returnUrl)` | `AccountController.cs:285` | implicit authenticated | — | `Login.cshtml` with `status=logout-success` |
| 5 | GET | `/Account/PageNotFound` | `PageNotFound` | `AccountController.cs:318` | implicit | — | `PageNotFound.cshtml` view |
| 6 | GET | `/Account/ForgotPassword` | `ForgotPassword` | `AccountController.cs:330` | implicit | — | `ForgotPassword.cshtml` view |
| 7 | POST/GET (action) | `/Account/ChangePassword` | `ChangePassword` | `AccountController.cs:335` | implicit authenticated | Raw JSON `ChangePasswordViewModel` | `Json(DanpheJSONConvert.SerializeObject(...))` with `Status`/`ErrorMessage` |
| 8 | GET | `/Account/UnAuthorizeAccess` | `UnAuthorizeAccess(string returnUrl)` | `AccountController.cs:375` | `[AllowAnonymous]` | — | `UnAuthorizeAccess.cshtml` view |

### 6.2 REST / API Endpoints

| # | HTTP | Path | Action | File:Line | Auth | Body | Returns |
|---|------|------|--------|-----------|------|------|---------|
| 9 | POST | `/api/Account/GetLoginJwtToken` | `LoginToDanpheEMR([FromBody] LoginDto)` | `AccountController.cs:549` | implicit | JSON `{ "userName": "...", "password": "..." }` | 200 `Ok({ message, loginJwtToken })` on success; 401 `Unauthorized()` on bad credentials |

### 6.3 Supporting Calls From Other Modules (used after login)

These are not Account endpoints but they are the post-login surface the Angular SPA depends on; they live in `Controllers/Security/SecurityController.cs` and read the same `currentuser` session this module populates.

| # | HTTP | Path | Action | Line | Purpose |
|---|------|------|--------|------|---------|
| S1 | GET | `/LoggedInUserInformation` | `GetLoggedInUserInformation` | 33 | Returns the current `RbacUser` plus a flattened profile |
| S2 | GET | `/NavigationRoutes` | `GetNavigationRoutelist` | 43 | Hierarchical menu tree for the current user (`RBAC.GetRoutesForUser(userId, true)`) |
| S3 | GET | `/ValidRoutes` | `GetAllValidRoutes` | 53 | Flat list of all routes the user can access |
| S4 | GET | `/UserPermissions` | `GetUserPermissions` | 63 | Full permission list for the current user |
| S5 | GET | `/ActiveBillingCounter` | `GetactiveBillingCounter` | 73 | Counter selection for billing users |
| S6 | GET | `/ActiveLab` | `GetActiveLab` | 81 | Active lab selection |
| S7 | GET | `/ActiveInventory` | `GetActiveInventory` | 91 | Active inventory store |
| S8 | GET | `/ActivePharmacyCounter` | `GetActivePharmacyCounter` | 99 | Pharmacy counter |
| S9 | GET | `/ActiveAccountingHospitalInformation` | `GetActiveAccHospitalInformation` | 107 | Active hospital for accounting |
| S10 | GET | `/InventeryHospitalInformation` | `GetInventeryHospitalInformation` | 119 | Inventory hospital |
| S11 | GET | `/ActiveDispensary` | `GetActiveDispencery` | 129 | Active dispensary |
| S12 | PUT | `/ActivateBillingCounter` | `PutActivateBillingCountery` | 407 | Switch active billing counter |
| S13 | PUT | `/ActivatePharmacyCounter` | `PutActivatePharmacyCounter` | 416 | Switch active pharmacy counter |
| S14 | PUT | `/ActivateDispensary` | `PutActivateDispensary` | 426 | Switch active dispensary |
| S15 | PUT | `/DeactivateDispensary` | `PutDeactivateDispensary` | 434 | Clear active dispensary |
| S16 | PUT | `/ActivateLab` | `PutActivateLab` | 442 | Switch active lab |
| S17 | PUT | `/DeactivateBillingCounter` | `PutDeActivateBillingCounter` | 450 | Clear active billing counter |
| S18 | PUT | `/ActivateInventory` | `PutActivateInventory` | 459 | Switch active inventory |
| S19 | PUT | `/DeactivateInventory` | `PutDeActivateInventory` | 469 | Clear active inventory |
| S20 | PUT | `/DeactivatePharmacyCounter` | `PutDeActivatePharmacyCounter` | 478 | Clear active pharmacy counter |
| S21 | PUT | `/DeactivateLab` | `PutDeactivateLab` | 486 | Clear active lab |
| S22 | PUT | `/ActivateAccountingHospital` | `PutActivateAccountingHospital` | 494 | Switch active accounting hospital |

---

## 7. Cross-Module Integration

### 7.1 With `Security` Module (`Controllers/Security/SecurityController.cs`)

The Security module consumes the session this Account module establishes. Every action calls `HttpContext.Session.Get<RbacUser>("currentuser")` and either:

- returns it back to the SPA (`GetLoggedInUserInformation`),
- computes a navigation tree using `RBAC.GetRoutesForUser(userId, true)` for the menu (`GetNavigationRoutelist`),
- or returns the active counter/store/lab/hospital for the current user so the SPA can scope subsequent calls.

### 7.2 With `Employee` Module (`Controllers/Settings/EmployeeSettingsController.cs` and `ServerModel/EmployeeModels/Employee.cs`)

- `RbacUser.EmployeeId` FK → `EMP_Employee.EmployeeId`.
- An employee record can exist without an `RBAC_User`; a user must reference a valid `EmployeeId`.
- `EmployeeModel` is the only entity that carries the rich profile (DOB, DOJ, signatures, blood group, certifications, etc.). The Account module never edits it — it only stores the FK.
- `EmployeeModel.FullName` is built by the database as `Salutation + FirstName + MiddleName + LastName` and used wherever the user's display name is required (audit logs, prescription headers, report signatory lines).

### 7.3 With Every Protected Module

Pattern: every controller other than `AccountController` inherits `CommonController` and reads the user via:

```csharp
RbacUser currentUser = HttpContext.Session.Get<RbacUser>(ENUM_SessionVariables.CurrentUser);
```

Confirmed in (non-exhaustive, observed in source):

| Module | Controller | Sample line |
|--------|-----------|-------------|
| Ward Supply | `WardSupplyController.cs` | 1226, 1408, 1533, 1651, 1691, 1731, 1755, 1812, 1847, 1881, 2078, 2088, 2184, 2384, 2561 |
| Ward Supply Assets | `WardSupplyAssetsController.cs` | 946 |
| Verification | `VerificationController.cs` | 74, 92, 551, 570, 580, 589, 609, 619 |
| Settings | `SettingsController.cs` | 765, 802, 824, 835, 849, 859, 1169, 1180, 1205, 1255, 1267, 1573, 2163, 2247 |
| Employee Settings | `EmployeeSettingsController.cs` | 373, 404, 585 |
| Billing Settings | `BillSettingsController.cs` | 370, 381, 390, 401, 422, 442, 451, 536, 547, 557, 566, 575, 585, 610, 619, 631, 662, 701, 710, 719, 728, 737, 804, 833, 843, 853, 862, 871, 2275 |
| ADT Settings | `ADTSettingsController.cs` | 449, 460, 496, 507, 518 |
| Radiology Settings | `RadiologySettingsController.cs` | 104 |
| SSF | `SSFController.cs` | 133 |
| Radiology | `RadiologyController.cs` | 215, 225, 236, 247, 261, 271, 302, 324, 567 |
| Pharmacy | `PharmacySettlementController.cs`, `PharmacyStockController.cs` | 138, 157, 239, 255, 277, 290, 301, 309, 398, 411 |
| Utilities | `UtilitiesController.cs` | 56, 65 |

The pattern repeats across at least 30 controllers; the Account module therefore implicitly powers every page in the application once a session exists.

### 7.4 Caching

`DanpheRBAC.cs:33-121` uses `DanpheCache` (a `System.Runtime.Caching.MemoryCache` wrapper, `Components/DanpheEMR.Core/Caching.cs`) with the following keys:

| Key | Source | Lifetime |
|-----|--------|----------|
| `RBAC-Apps-All` | `GetAllApplications` | `cacheExpiryMinutes` |
| `RBAC-Perms-All` | `GetAllPermissions` | `cacheExpiryMinutes` |
| `RBAC-Roles-All` | `GetAllRoles` | `cacheExpiryMinutes` |
| `RBAC-Users-All` | `GetAllUsers` | `cacheExpiryMinutes` |
| `RBAC-UserRoleMaps-All` | `GetAllUserRoleMaps` | `cacheExpiryMinutes` |
| `RBAC-RolePermissionMaps-All` | `GetAllRolePermissionMaps` | `cacheExpiryMinutes` |
| `RBAC-Routes-All` | `GetAllRoutes` | `cacheExpiryMinutes` |
| `RBAC-UserPermissions-UserId{userId}` | `GetUserAllPermissions` | `cacheExpiryMinutes` |

`cacheExpiryMinutes` is configured in `Startup` when `DanpheCache` is registered as a singleton. This is why role/permission changes take up to the configured expiry to propagate to in-flight sessions.

### 7.5 Audit

`[AuditApi(EventTypeName = "Login", IncludeHeaders = true, IncludeResponseHeaders = true, IncludeResponseBody = true, IncludeRequestBody = true, IncludeModelState = true)]` on `AccountController.cs:195-196` enables Audit.NET's WebApi tracking for the form-post login. The same audit pipeline is then patched in-place to scrub the password (`AccountController.cs:246-258`) before the event is persisted. The JWT login (`LoginToDanpheEMR`) repeats the same scrub (`AccountController.cs:579-591`).

The `Logout` action's audit decorator is commented out (`AccountController.cs:283-284`); logout events are still recorded, but only via the `LoginInformationModel` row inserted at `AccountController.cs:291-301`.

---

## 8. Business Rules

### 8.1 Password Complexity

- **Encryption**: Triple-DES (ECB, PKCS7) keyed with `MD5("Danphesalt")` (`DanpheRBAC.cs:24, 356-372`). The salt is hard-coded and shared across the entire installation.
- **Storage**: `RbacUser.Password` holds the base64-encoded cipher; never plain text.
- **Validation on change**: `RBAC.UpdateDefaultPasswordOfUser` re-encrypts the supplied old password and compares it to the stored value (`DanpheRBAC.cs:331-332`); wrong old passwords cause the function to return `null` and the controller to return `Status="Failed", ErrorMessage="Current Password is Wrong"`.
- **Confirmation match**: enforced in two places: the MVC model (`[Compare("NewPassword", ErrorMessage="Confirm password doesn't match, Type again !")]` on `ChangePasswordViewModel.cs:24`) and via the controller passing `ConfirmPassword` as the value actually written to the DB. The MVC view also surfaces `new&confirmpass-different` and `new&confirmpass-not-provided` status messages.
- **No minimum length / character-class rule is enforced in code** — the source does not contain any `[StringLength]`, regex, or character-class checks on `Password` or `NewPassword` (verified by `grep` against `LoginViewModel.cs` and `ChangePasswordViewModel.cs`). The only validation is presence (`[Required]`) and the new-vs-confirm comparison.
- **Forced change on first login**: `RbacUser.NeedsPasswordUpdate` (boolean, nullable). The view surface expects to redirect to the change-password form when this flag is true; `UpdateDefaultPasswordOfUser` flips it to `false` and the in-memory session is also updated (`AccountController.cs:347-352`).

### 8.2 Username Rules

- Case-insensitive on lookup: `a.UserName.ToLower() == userName.ToLower()` (`DanpheRBAC.cs:171-185`).
- No format/email regex is enforced in the model — `UserName` is plain `[Required] string`.
- Duplicate usernames are not prevented at the schema level beyond the implicit uniqueness through the `UserId` PK.

### 8.3 Session Rules

- **Storage**: ASP.NET Core in-memory session (`HttpContext.Session.Set<T>(key, value)`).
- **Session keys** (set in `SetSessionVariable`):
  - `currentuser` → `RbacUser` clone (password stripped).
  - `validpermissionlist` → `List<RbacPermission>` from `RBAC.GetUserAllPermissions(userId)`.
  - `user-roles` → `List<RbacRole>` from `RBAC.GetUserAllRoles(userId)`.
- **Lifetime**: governed by ASP.NET Core session middleware; there is no module-level timeout setting. JWT expiry is configurable via `MyConfiguration.JwtTokenConfig.JwtValidMinutes` (used as `AddMinutes(Convert.ToDouble(JwtValidMinutes))` at `AccountController.cs:630`).
- **Already-signed-in shortcut** (`AccountController.cs:128-134`): if a valid `RbacUser` is in session, GET `/Account/Login` redirects to `Home/Index` directly without re-prompting.
- **Logout shortcut**: GET `/Account/Logout` always runs (does not require the session to be alive), and the `LoginInformationModel` insert is guarded by `if (currentUser != null)` so a stale GET does not throw.

### 8.4 Cookie / Remember-Me Rules

- **Lifetime**: 2 years from creation (`SetRememberMeCookieVariable` `AccountController.cs:437`), matching cookie `Expires` and the `Expires` column on `Danphe_CookieAuthInfo`.
- **Selector uniqueness**: `DateTime.Now.Ticks - new DateTime(2001,1,1).Ticks` is a monotonically increasing long, so collisions are not a concern under normal clock progression.
- **Validator rotation**: the validator is regenerated on every auto-login (`UpdateRememberMeCookie` `AccountController.cs:488-522`). A leaked cookie therefore works at most once.
- **Hashing**: `SHA-256(validator + selector)` is stored in `HashedToken`. The plaintext validator is only in the `uData` cookie, never in the database.
- **Cleanup on failure**: any mismatch in the GET-time check (`userIdList.Count != 1`) deletes both cookies and clears the session.

### 8.5 License Enforcement

- Stored in `Core_CFG_Parameters` under group `TenantMgnt`, name `SoftwareLicense`.
- Value is a JSON string of encrypted fields. Decryption uses `RBAC.DecryptPassword` (the same Triple-DES + MD5 routine as user passwords). Therefore the `Danphesalt` is also the license key.
- Required fields: `StartDate`, `EndDate`, `ExpiryNoticeDays`, `LicenseType`.
- Enforcement: GET `/Account/Login` only. Once authenticated, the user is not re-checked on subsequent requests.
- Failure modes:
  - `paramValue == null` → `TempData["LicenseMessage"] = "License Information not found.."` → redirect `LicenseExpired`.
  - `remainingDays < 0` → `TempData["LicenseMessage"] = "License expired on: yyyy-MMM-dd"` → redirect `LicenseExpired`.
  - `expiryNoticeDays > remainingDays` (still positive) → in-place banner on the login page.
- License expiry does **not** invalidate existing sessions; the user is only blocked at the next login attempt.

### 8.6 Active / Inactive Account

- `RbacUser.IsActive` (nullable boolean) gates both the POST form and the GET remember-me auto-login (`AccountController.cs:162-168, 212-217`).
- No failed-attempt counter or rate limiting. There is no per-IP throttle, no CAPTCHA, no progressive lockout.
- An inactive user is still able to hit `ChangePassword` directly (the action does not check `IsActive`); the system relies on role assignments to prevent this in practice.

### 8.7 JWT

- Algorithm: HS256 (`SecurityAlgorithms.HmacSha256`).
- Signing key: `MyConfiguration.JwtTokenConfig.JwtKey` (UTF-8 bytes of the configured string).
- Issuer / Audience: `MyConfiguration.JwtTokenConfig.JwtIssuer` / `JwtAudience`.
- Expiry: `DateTime.UtcNow.AddMinutes(Convert.ToDouble(JwtValidMinutes))`.
- Claim set: a single claim `ENUM_ClaimTypes.currentUser` whose value is the JSON-serialized `RbacUser` (with `Password` already nulled at `AccountController.cs:218, 563`).
- The JWT is delivered to the SPA via `TempData["loginJwtToken"]` (form path) or `Ok({ message, loginJwtToken })` (API path). The original implementation comment ("Keep the login token in TempData to send it back to Angular Client") is at `AccountController.cs:234`.

### 8.8 Auditing

- Successful and failed logins are written to `DanpheLogInInformation` with `ActionName` ∈ {`"login"`, `"logout"`, `"invalid-login-attempt"`}. Inactive-user logins do not produce a row.
- Audit.NET captures the full login HTTP exchange via `[AuditApi]` and then redacts the password in-place before persistence (sections 5.1, 7.5).

### 8.9 RBAC Privilege Escalation

- A user with any `IsSysAdmin = true` role implicitly receives **all** permissions via `RBAC.GetUserAllPermissions` (`DanpheRBAC.cs:253-258`). This is unconditional; no ApplicationId filter is applied for super-admins.
- Non-admin users get their permission list via a four-way join: `UserRoleMap` (active) → `Role` → `RolePermissionMap` (active) → `Permission` (active) → `Application` (active) (`DanpheRBAC.cs:260-273`).
- Time-bound roles are supported via `UserRoleMap.StartDate` / `UserRoleMap.EndDate` (declared in `RbacOtherModels.cs:29-30`) but **not consulted** in `GetUserAllPermissions` — only the `IsActive` flag is checked. A real expiry enforcement would require a custom filter.

### 8.10 Cache Invalidation

- `RBAC` lookups are cached in `MemoryCache` for `cacheExpiryMinutes` (see 7.4). Editing roles, permissions, or user-role mappings therefore does not immediately take effect; the SPA must wait for the cache TTL, or the application must be recycled, or the relevant cache keys must be cleared manually.
- There is no cache-eviction call anywhere in the Account controller — the `UserRoleMap`, `RolePermissionMap`, and `User` mutations that other modules perform will not bust the cache.
