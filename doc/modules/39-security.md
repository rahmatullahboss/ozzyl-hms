# Module 39 — Security (Authentication, RBAC, Authorization)

> Reference documentation for the DanpheEMR Security module. Covers the RBAC core (`DanpheEMR.Security`), ASP.NET Core authentication, JWT token generation, the `DanpheActionFilter` action filters, the `AccountController` and `SecurityController` HTTP surface, the admin `SecuritySettingsController` user/role/permission CRUD, and the Angular `SecurityService` + `AuthGuardService` + `rbac-permission` directive. The single source of truth for understanding authentication and authorization in DanpheEMR without re-reading the .NET source.

---

## 1. Module Overview

The Security module is the **identity and access-management core** of DanpheEMR. It defines *who* the user is, *what* they can do, and *which* application pages and APIs they can call. Every other module in the system is dependent on Security — without an authenticated user, no business controller will accept a request.

The module is organized around the following sub-domains:

| Sub-domain | Purpose |
|---|---|
| **Identity store** | `RBAC_User` table holds every login account. Each account is linked to an `Employee` from the HR module via `EmployeeId`, so every user is also a real person with a department, salary, leave record, and audit history. |
| **Application registry** | `RBAC_Application` is a logical grouping of permissions. A typical deployment has one application per major functional area (e.g. "Clinical", "Billing", "Pharmacy", "Inventory", "Lab", "Radiology", "Admin"). |
| **Permission catalog** | `RBAC_Permission` is a fine-grained permission key (e.g. `billing-transaction-view`, `pharmacy-returns-view`, `settings-securitymanage-view`, `patient-register-view`). Every page, button, and API call is bound to a permission name. |
| **Roles** | `RBAC_Role` is a named collection of permissions, scoped to an application. Roles have a `RolePriority` (used to choose the default landing page) and an optional `DefaultRouteId` (the page the user lands on after login). |
| **User–Role assignment** | `RBAC_MAP_UserRole` is a many-to-many link from user to role, with `IsActive`/`StartDate`/`EndDate` to support temporary grants. |
| **Role–Permission assignment** | `RBAC_MAP_RolePermission` is a many-to-many link from role to permission, with `IsActive` for soft-deletes. |
| **Navigation routes** | `RBAC_RouteConfig` maps an Angular front-end URL to a `PermissionId`, with a parent/child hierarchy that drives the side-navigation menu and the auth-guard checks. |
| **Login information** | `DanpheLogInInformation` (admin DB) records every login/logout/invalid-login-attempt with timestamp, user name, and employee id — used for the audit trail. |
| **Remember-me cookie** | `Danphe_CookieAuthInfo` (admin DB) stores the selector + hashed validator that backs the optional "Remember Me" cookie on the login form. |
| **JWT issuance** | After a successful credential check, `AccountController` mints a signed `JwtSecurityToken` whose single claim (`ENUM_ClaimTypes.currentUser`) carries the serialized `RbacUser`. The Angular HTTP interceptor attaches that token to every outbound API call. |
| **Route-level authorization** | Two ASP.NET Core action filters gate access: `DanpheViewFilter` for MVC view endpoints (checks the user's permissions in the session); `DanpheDataFilter` for REST API endpoints (validates the JWT, extracts the `currentUser` claim). |

### Key design characteristics

- **Two-server trust model** — the system uses *two* database servers: a **main EMR database** (holds `RBAC_*` tables plus all clinical data) and an **admin database** (holds `DanpheLogInInformation`, `Danphe_CookieAuthInfo`, `SysAdmin_Parameters`, and the `DanpheAudit` table). Connection strings come from `MyConfiguration` and are decrypted at startup using the same `RBAC.DecryptPassword` TripleDES routine.
- **In-memory caching with TTL** — the static `RBAC` class caches the *full* users / roles / permissions / routes / user-role / role-permission lists in-process keyed by literal strings (`"RBAC-Users-All"`, `"RBAC-UserPermissions-UserId42"`, etc.). The TTL comes from `CacheExpirationMinutes` in `appsettings.json`. Cached lists are never invalidated manually; rotation is TTL-based.
- **System-admin role bypass** — any user whose `UserRoleMap` links them to a role with `IsSysAdmin = true` is treated as having **all** permissions in every application. `RBAC.GetUserAllPermissions` short-circuits and returns `GetAllPermissions()` for these users.
- **Permission as a string key** — every check is a string compare against `PermissionName`. There is no compile-time enum, so misspelling silently fails (the directive / filter just denies the user).
- **Route-based access** — the Angular `AuthGuardService` runs on every router navigation. It calls `SecurityService.checkIsAuthorizedURL` which looks up the requested URL in the user's `UserNavigations` array. If the URL is not in the list, the user is redirected to `/UnAuthorized`.
- **Component-level access** — the `rbac-permission` directive hides or disables individual UI elements based on a permission key. Three actions are supported: `hidden` (display:none), `disabled`, `remove`.
- **Stateless API, stateful UI** — server-side controllers do **not** validate roles/permissions on every API call; they only validate that a valid JWT is present (via `DanpheDataFilter`). All fine-grained authorization is *client-side* via the directive + guard. This is a known design choice and is acceptable for an internal hospital app, but it means the API trusts the bearer token alone.
- **Two passwords per account** — `RBAC.EncryptPassword` (TripleDES with `MD5(Salt="Danphesalt")` as the key, ECB mode, PKCS7 padding) is used to store credentials. The same routine decrypts SQL connection strings at startup.
- **Audit trail everywhere** — every login, logout, and invalid-attempt is recorded in `DanpheLogInInformation`. The `[AuditApi]` attribute on `AccountController.Login` captures full request/response bodies (with the password replaced with `*****` in the audit log).

### Cross-cutting hooks

The Security module touches (or is touched by) every other module:

- **Every controller** that inherits `CommonController` is automatically wrapped by `[DanpheDataFilter]` (line 18 of `Utilities/CommonController.cs:18`), so authentication is enforced by inheritance.
- **Every view controller** in `Controllers/*/...ViewController.cs` decorates actions with `[DanpheViewFilter("...")]` to enforce a permission name on the rendered page.
- **`RbacUser` is added to HTTP session** at login, so any controller can do `HttpContext.Session.Get<RbacUser>("currentuser")` to identify the caller.
- **`RbacUser` is added to the JWT claim** so any controller that does not have access to the session (e.g. a custom WebSocket) can still identify the caller.

---

## 2. Backend File Layout

### 2.1 Security core (`DanpheEMR.Security`)

`DanpheEMR reference/Code/Components/DanpheEMR.Security/`

| File | Lines | Purpose |
|---|---|---|
| `RBAC/DanpheRBAC.cs` | 525 | The **only** RBAC service in the system. Static methods, in-memory cache, password encryption, all read queries (`GetAll*`, `GetUserAllPermissions`, `GetRoutesForUser`, `GetUser`, `UserHasPermission`, `UserIsSuperAdmin`), all write helpers (`CreateRole`, `CreatePermission`, `MapRoleWithPermission`, `ActivateDeactivatePermission`, `ActivateDeactivateRolePermissionMap`, `GetAllRoleIdsByPermissionId`, `UpdateDefaultPasswordOfUser`). |
| `RBAC/RbacUser.cs` | 42 | EF entity for `RBAC_User` table. Implements `ICloneable` so the in-memory user copy can be handed out without leaking the cached instance. |
| `RBAC/RbacRole.cs` | 40 | EF entity for `RBAC_Role`. Holds `IsSysAdmin`, `RolePriority`, `DefaultRouteId`. |
| `RBAC/RbacPermission.cs` | 29 | EF entity for `RBAC_Permission`. |
| `RBAC/RbacApplication.cs` | 24 | EF entity for `RBAC_Application`. |
| `RBAC/Routes.cs` | 33 | EF entity for `RBAC_RouteConfig` (`DanpheRoute`). |
| `RBAC/RbacOtherModels.cs` | 41 | Two mapping entities: `RolePermissionMap` and `UserRoleMap`. |
| `RBAC/LoginViewModel.cs` | 34 | Two DTOs: `LoginViewModel` (MVC form) and `LoginDto` (JSON body for the Swagger-only `/api/Account/GetLoginJwtToken` endpoint). |
| `RBAC/ChangePasswordViewModel.cs` | 30 | DTO for `AccountController.ChangePassword`. Validates `ConfirmPassword` matches `NewPassword` via `[Compare]`. |
| `RbacDbContext.cs` | 74 | Entity Framework `DbContext` (`AuditDbContext`) that exposes the seven RBAC tables plus `EmployeeModel` and `PHRMStoreModel`. The other DAL contexts (`BillingDbContext`, `PharmacyDbContext`, etc.) re-use the same `RBAC_User` / `RBAC_Permission` tables — they are *shared* across the main EMR database, not duplicated. |

### 2.2 Controllers

| File | Lines | Route prefix | Purpose |
|---|---|---|---|
| `Controllers/AccountController.cs` | 635 | `/Account/*` and `/api/Account/*` | **Authentication surface.** Login (MVC form + Swagger JSON), Logout, PageNotFound, ForgotPassword, ChangePassword, `GetLoginJwtToken` (test endpoint), `SetRememberMeCookieVariable`, `UpdateRememberMeCookie`, `RemoveRememberMeCookie`, `SetSessionVariable`, `RemoveSessionValues`, `GenerateJwtToken`. Does **not** inherit from `CommonController` so anonymous auth is allowed. |
| `Controllers/SecurityController.cs` | 992 | `/api/Security/*` | **Active-session surface.** `LoggedInUserInformation`, `NavigationRoutes`, `ValidRoutes`, `UserPermissions`, `ActiveBillingCounter`, `ActiveLab`, `ActiveInventory`, `ActivePharmacyCounter`, `ActiveAccountingHospitalInformation`, `InventeryHospitalInformation`, `ActiveDispensary`, plus the `PUT` activate/deactivate variants for each counter. Inherits from `CommonController`, so the JWT filter is automatically applied. |
| `Controllers/Settings/SecuritySettingsController.cs` | 883 | `/api/SecuritySettings/*` | **Admin CRUD for RBAC entities.** Applications, Routes, Permissions, Roles, Users, RolePermissions, UserRoles — each with full GET/POST/PUT verbs. Inherits from `CommonController`. |
| `Controllers/DanpheActionFilter.cs` | 230 | (filter, not a route) | **Two `ActionFilterAttribute`s** + one `IAuthorizationFilter` for form size limits. `DanpheViewFilter(permissionName)` for MVC view endpoints, `DanpheDataFilter()` for REST API endpoints. |

### 2.3 Configuration & plumbing

| File | Purpose |
|---|---|
| `Utilities/MyConfiguration.cs` | Defines the `MyConfiguration` POCO with `Connectionstring`, `ConnectionStringAdmin`, `CacheExpirationMinutes`, `JwtTokenConfig` (`JwtKey`, `JwtIssuer`, `JwtAudience`, `JwtValidMinutes`). |
| `Utilities/SharedEnums.cs` (line 394) | `ENUM_ClaimTypes.currentUser` — the single string claim name used inside the JWT. |
| `ConfigureServices.cs` | `AddSwaggerAndJwtServices` extension method. Registers `JwtBearer` with `IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKey))`, `ValidateIssuer/Audience = true`, `SaveToken = true`, `RequireHttpsMetadata = false`. |
| `Startup.cs` | Configures `services.AddSession` (2-hour idle timeout, `HttpOnly` cookie), `services.Configure<MyConfiguration>(Configuration)`, registers the static `RBAC` class as a singleton (`new RBAC(connString, cacheExpMins)`), decrypts the `Connectionstring` and `ConnectionStringAdmin` at startup using `RBAC.DecryptPassword`. |
| `Utilities/CommonController.cs` | Base controller for every API except `AccountController`. Class-level `[DanpheDataFilter()]` and `[RequestFormSizeLimit(valueCountLimit: 1000000, Order = 1)]` attributes. `AddAuditField` reads the `currentuser` from session and injects `ChangedByUserId` / `ChangedByUserName` into the EF audit pipeline. |

### 2.4 Frontend

`DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/`

| Path | Purpose |
|---|---|
| `security/security.module.ts` | Declares `SecurityService`, `SecurityBLService`, `SecurityDLService`, `AuthGuardService`, `authInterceptorProviders`. Pulls in `ReactiveFormsModule`, `FormsModule`, `CommonModule`, `HttpClientModule`. |
| `security/shared/security.service.ts` | **The heart of front-end authorization.** Holds in-memory `loggedInUser: User`, `UserNavigations: DanpheRoute[]`, `validRouteList: DanpheRoute[]`, `UserPermissions: Permission[]`. Exposes `HasPermission(name)`, `checkIsAuthorizedURL(url)`, `GetChildRoutes(parentPath)`, plus session-state helpers for the active billing counter / lab / pharmacy counter / dispensary / accounting hospital. Also has `GetAccHospitalInfo()` / `GetINVHospitalInfo()` plus Nepali-fiscal-year calculations. |
| `security/shared/auth-guard.service.ts` | Angular `CanActivate` guard. If `loggedInUser.UserName == null` returns nothing (router treats as un-authorized). Otherwise calls `securityServ.checkIsAuthorizedURL(url)`. On `false`, redirects to `/UnAuthorized`. |
| `security/shared/security.bl.service.ts` | Business-logic layer that wraps the data layer. `GetLoggedInUserInformation`, `GetValidNavigationRouteList`, `GetValidUserPermissionList`, `GetActiveBillingCounter`, `GetActiveLab`, `GetActivePharmacyCounter`, `GetAllValidRouteList`, `GetAccountingHopitalInfo`, `GetINVHospitalInfo`, `ActivateLab`. |
| `security/shared/security.dl.service.ts` | HTTP layer. Hits `/api/Security/LoggedInUserInformation`, `/api/Security/NavigationRoutes`, `/api/Security/UserPermissions`, `/api/Security/ActiveBillingCounter`, `/api/Security/ActiveLab`, `/api/Security/ActivePharmacyCounter`, `/api/Security/ValidRoutes`, `/api/Security/ActiveAccountingHospitalInformation`, `/api/Security/InventeryHospitalInformation`. |
| `security/shared/rbac-permission.directive.ts` | Attribute directive `[rbac-permission]="{ name: 'permission-name', actionOnInvalid: 'hidden' \| 'disabled' \| 'remove' }"`. `ngOnInit` calls `securityService.HasPermission(name)`. If denied, performs the action (`hidden` sets `el.nativeElement.hidden = true` and `display:none`; `disabled` calls `renderer.setAttribute(el, 'disabled', 'true')`; `remove` calls `el.nativeElement.remove()`). |
| `security/shared/user.model.ts` | `User` class with `UserId`, `EmployeeId`, `UserName`, `Password`, `Email`, `IsActive`, `IsSystemAdmin`, `NeedsPasswordUpdate`, `LandingPageRouteId`. Includes a `UserProfileValidator` reactive form with `MatchPassword` cross-field validator and a `ConfirmPassword` field. |
| `security/shared/role.model.ts` | `Role` class with `RoleId`, `RoleName`, `RoleDescription`, `RoleType` (`'custom'` or `'system'`), `ApplicationId`, `IsSysAdmin`, `IsActive`, `RolePriority`, `DefaultRouteId`, `IsSelected`. Reactive-form validator for `RoleName`. |
| `security/shared/permission.model.ts` | `Permission` class with `PermissionId`, `PermissionName`, `ApplicationId`, `IsActive`, `IsSelected`. Reactive-form validator. |
| `security/shared/route.model.ts` | Lightweight `Route` class for in-memory navigation use. |
| `security/shared/danphe-route.model.ts` | Full `DanpheRoute` with `ChildRoutes`, `DisplaySeq`, `Css`, `IsSecondaryNavInDropdown`, `ChildRoutesDefaultShowCount`. |
| `security/shared/user-role-map.model.ts` | `UserRoleMap` with `UserRoleMapId`, `UserId`, `RoleId`, `StartDate`, `EndDate`, `IsActive`, plus UI-only `RoleName`, `IsSelected`. |
| `security/shared/role-permission-map.model.ts` | `RolePermissionMap` with `RolePermissionMapId`, `RoleId`, `PermissionId`, `IsActive`, plus UI-only `PermissionName`, `ApplicationId`. |
| `security/shared/application.model.ts` | `Application` with `ApplicationId`, `ApplicationCode`, `ApplicationName`, `Description`, `IsActive`, `IsApplicationNameSelected`, plus `Permissions: Permission[]`. |
| `shared/token-interceptor/token-interceptor.service.ts` | `AuthTokenInterceptor` HTTP interceptor. Reads `localStorage.getItem(ENUM_LocalStorageKeys.LoginTokenName)` and sets the `Authorization: Bearer <token>` header on every outbound request. |
| `shared/shared-enums.ts` (line 412) | `enum ENUM_LocalStorageKeys { LoginTokenName = "loginJwtToken" }`. |
| `settings-new/security/` | Admin UI: `security-setting.main.component.ts`, `security-settings.module.ts`, `users/`, `roles/`, `user-role-map/`, `role-perm-map/`, `reset-password/`. All routes guarded by `AuthGuardService`. |
| `settings-new/shared/settings.dl.service.ts` | The `SettingsDLService` HTTP client that consumes the `SecuritySettingsController` endpoints. Methods: `GetApplicationList`, `GetPermissionList`, `GetRoleList`, `GetUserList`, `GetRolePermissionList(roleId)`, `GetUserRoleList(userId)`, `GetRouteList`, `PostUser`, `PostRole`, `PostRolePermissions`, `PostUserRoles`, `PutUser`, `PutRole`, `PutRolePermissions`, `PutUserRoles`, `PutUserPassword`, `PutUserIsActive`. |

---

## 3. Data Models (Server-Side)

All models live in `DanpheEMR reference/Code/Components/DanpheEMR.Security/RBAC/`. They map directly to tables in the **main EMR database** (not the admin database). `[Key]` indicates the primary key; `[NotMapped]` indicates a client-only convenience property.

### 3.1 `RbacUser` — `RBAC_User`

| Property | Type | Notes |
|---|---|---|
| `UserId` | int | PK, identity |
| `EmployeeId` | int | FK to `EMP_Employee.EmployeeId` |
| `UserName` | string | Login id (case-insensitive on lookup) |
| `Password` | string | TripleDES-encrypted blob (see `RBAC.EncryptPassword`) |
| `Email` | string | Optional, used for self-service password recovery |
| `IsActive` | bool? | Soft delete / disable |
| `NeedsPasswordUpdate` | bool? | Forces the user through the change-password flow on first login |
| `LandingPageRouteId` | int? | The Angular URL to navigate to after login (overrides role-default) |
| `Roles` | `List<RbacRole>` | Eager-loaded, nav property |
| `Employee` | `EmployeeModel` | Eager-loaded, nav property |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | Standard audit fields |

`RbacUser.Clone()` returns a `MemberwiseClone` so the in-memory cache copy can be safely handed out.

### 3.2 `RbacRole` — `RBAC_Role`

| Property | Type | Notes |
|---|---|---|
| `RoleId` | int | PK, identity |
| `RoleName` | string | Unique display name (`"Doctor"`, `"Nurse"`, `"Lab Technician"`, `"SysAdmin"`) |
| `RoleDescription` | string | |
| `RoleType` | string | `'custom'` or `'system'` |
| `ApplicationId` | int? | FK to `RBAC_Application` |
| `IsSysAdmin` | bool | **The master switch.** When `true`, the user is granted every permission in every application, and `RBAC.GetUserAllPermissions` short-circuits. |
| `IsActive` | bool | |
| `RolePriority` | int? | Lower number = higher priority. Used to pick the default landing page when a user has multiple roles. |
| `DefaultRouteId` | int? | FK to `RBAC_RouteConfig.RouteId` — the page the user lands on after login. |
| `Application` | `RbacApplication` | Nav property |
| `Permissions` | `List<RbacPermission>` | Nav property |
| `Users` | `List<RbacUser>` | Nav property |
| `Route` | `DanpheRoute` | Nav property for the default route |

### 3.3 `RbacPermission` — `RBAC_Permission`

| Property | Type | Notes |
|---|---|---|
| `PermissionId` | int | PK, identity |
| `PermissionName` | string | The string key the filter / directive compares against (e.g. `"billing-transaction-view"`, `"pharmacy-returns-view"`). Convention: `<module>-<entity>-<verb>`. |
| `Description` | string | |
| `ApplicationId` | int? | FK to `RBAC_Application` |
| `IsActive` | bool | |
| `Application` | `RbacApplication` | Nav property |
| `Roles` | `List<RbacRole>` | Nav property |

### 3.4 `RbacApplication` — `RBAC_Application`

| Property | Type | Notes |
|---|---|---|
| `ApplicationId` | int | PK, identity |
| `ApplicationCode` | string | Short code (e.g. `"CLN"`, `"BIL"`, `"PHR"`, `"INV"`, `"LAB"`, `"RAD"`, `"ADM"`) used by `RBAC.UserHasPermission(userId, applicationCode, permissionName)` |
| `ApplicationName` | string | Display name |
| `Description` | string | |
| `IsActive` | bool | |
| `Roles` | `List<RbacRole>` | Nav property |
| `Permissions` | `List<RbacPermission>` | Nav property |

### 3.5 `DanpheRoute` — `RBAC_RouteConfig`

| Property | Type | Notes |
|---|---|---|
| `RouteId` | int | PK, identity |
| `UrlFullPath` | string | The Angular URL the route maps to (e.g. `"Billing/Transaction"`, `"Settings/SecurityManage/ManageUser"`) |
| `DisplayName` | string | The text shown in the side-nav menu |
| `RouterLink` | string | Optional Angular router-link alternative |
| `PermissionId` | int? | FK to `RBAC_Permission` — required to navigate to this URL |
| `ParentRouteId` | int? | Self-FK for menu hierarchy (e.g. `"Billing"` is parent of `"Billing/Transaction"`) |
| `DefaultShow` | bool? | If `true`, the route is shown in the side-nav by default. If `false`, it's hidden (e.g. only shown if a child has a permission the parent doesn't). |
| `IsActive` | bool? | Soft delete |
| `IsSecondaryNavInDropdown` | bool? | If `true`, the route appears in a secondary dropdown menu |
| `Css` | string | CSS class for the side-nav icon |
| `DisplaySeq` | int? | Order within the side-nav |
| `ChildRoutes` | `List<DanpheRoute>` | **NotMapped** — populated by `RBAC.GetChildRouteHierarchy` at read time. |
| `ChildRoutesDefaultShowCount` | int? | **NotMapped** — count of visible children (for the UI). |

### 3.6 `RolePermissionMap` — `RBAC_MAP_RolePermission`

| Property | Type | Notes |
|---|---|---|
| `RolePermissionMapId` | int | PK, identity |
| `RoleId` | int | FK |
| `PermissionId` | int | FK |
| `IsActive` | bool | Soft delete |
| `Permission` | `RbacPermission` | Nav property |
| `Role` | `RbacRole` | Nav property |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | Standard |

### 3.7 `UserRoleMap` — `RBAC_MAP_UserRole`

| Property | Type | Notes |
|---|---|---|
| `UserRoleMapId` | int | PK, identity |
| `UserId` | int | FK |
| `RoleId` | int | FK |
| `IsActive` | bool | Soft delete / temporary grant disable |
| `StartDate` | DateTime? | Optional effective-from date |
| `EndDate` | DateTime? | Optional expiry date |
| `User` | `RbacUser` | Nav property |
| `Role` | `RbacRole` | Nav property |
| `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` | audit | Standard |

### 3.8 View models

| Class | Purpose |
|---|---|
| `LoginViewModel` | MVC form: `UserName`, `Password`, `RememberMe`. Validated with `[Required]`, `[DataType(DataType.Password)]`, `[Range(typeof(bool), "false", "true")]`. |
| `LoginDto` | JSON body: `UserName`, `Password`. Used by the Swagger-only `/api/Account/GetLoginJwtToken` endpoint. |
| `ChangePasswordViewModel` | `UserName`, `Password` (current), `NewPassword`, `ConfirmPassword` (with `[Compare("NewPassword")]`). |
| `LoginInformationModel` | Maps to `DanpheLogInInformation` table. Fields: `InformationId` (PK), `EmployeeId?`, `UserName`, `ActionName` (`"login"`, `"logout"`, `"invalid-login-attempt"`), `CreatedOn`. |
| `CookieAuthInfoModel` | Maps to `Danphe_CookieAuthInfo` table. Fields: `AuthId` (PK), `Selector` (bigint, the lookup key), `HashedToken` (SHA-256 hex, the validator), `UserId`, `Expires` (default 2 years). |
| `AccHospitalInfoVM` | Returned by `/api/Security/ActiveAccountingHospitalInformation` and `/api/Security/InventeryHospitalInformation`. Contains `ActiveHospitalId`, `TodaysDate`, `FiscalYearList`, `CurrFiscalYear`, `SectionList`, `HospitalLongName`, `HospitalShortName`. |
| `LabSelectionVM` | Returned by `/api/Security/ActiveLab` and `/api/Security/ActiveDispencery`. Contains `LabTypeId`, `LabTypeName`. |
| `PHRMCounter`, `PHRMStoreModel` | Returned by the pharmacy-counter / dispensary endpoints. |

---

## 4. Database Tables (Admin + Main DBs)

The system uses two databases. `RBAC_*` lives in the **main EMR DB**; the audit/cookie tables live in the **admin DB**.

### 4.1 Main EMR DB

| Table | EF entity | Purpose | Key columns |
|---|---|---|---|
| `RBAC_Application` | `RbacApplication` | Logical app grouping | `ApplicationId` (PK), `ApplicationCode` (unique), `ApplicationName`, `IsActive` |
| `RBAC_Permission` | `RbacPermission` | Permission catalog | `PermissionId` (PK), `PermissionName` (unique), `ApplicationId` (FK), `IsActive` |
| `RBAC_Role` | `RbacRole` | Role master | `RoleId` (PK), `RoleName` (unique), `ApplicationId` (FK), `IsSysAdmin`, `IsActive`, `RolePriority`, `DefaultRouteId` (FK) |
| `RBAC_User` | `RbacUser` | User / login account | `UserId` (PK), `EmployeeId` (FK), `UserName` (unique, case-insensitive), `Password` (TripleDES-encrypted), `Email`, `IsActive`, `NeedsPasswordUpdate`, `LandingPageRouteId` (FK) |
| `RBAC_MAP_UserRole` | `UserRoleMap` | User ↔ Role | `UserRoleMapId` (PK), `UserId` (FK), `RoleId` (FK), `IsActive`, `StartDate`, `EndDate` |
| `RBAC_MAP_RolePermission` | `RolePermissionMap` | Role ↔ Permission | `RolePermissionMapId` (PK), `RoleId` (FK), `PermissionId` (FK), `IsActive` |
| `RBAC_RouteConfig` | `DanpheRoute` | Side-nav route tree | `RouteId` (PK), `UrlFullPath` (unique), `DisplayName`, `PermissionId` (FK), `ParentRouteId` (self FK), `DefaultShow`, `IsActive`, `DisplaySeq` |

These tables are also mapped by `BillingDbContext`, `PharmacyDbContext`, `InventoryDbContext`, `VaccinationDbContext`, `AccountingDbContext` — every module that needs to look up a user, role, or permission hits the *same* physical tables in the main DB.

### 4.2 Admin DB

| Table | EF entity | Purpose | Key columns |
|---|---|---|---|
| `DanpheLogInInformation` | `LoginInformationModel` | Login audit trail | `InformationId` (PK, identity), `EmployeeId` (nullable), `UserName`, `ActionName` (`login`/`logout`/`invalid-login-attempt`), `CreatedOn` |
| `Danphe_CookieAuthInfo` | `CookieAuthInfoModel` | Remember-me cookie validator | `AuthId` (PK, identity), `Selector` (bigint, the public lookup key), `HashedToken` (varchar 512, SHA-256 hex), `UserId`, `Expires` (default 2 years out) |
| `SysAdmin_Parameters` | `AdminParametersModel` | Admin parameters | `ParameterId` (PK), `ParameterGroupName`, `ParameterName`, `ParameterValue` (varchar 1000), `ValueDataType`, `Description`, `CreatedOn`. Holds the software-license JSON, the `LiveDBName`, the DB-backup paths, and the `Security/CommonURLFullPath` JSON used by `SecurityService.checkIsAuthorizedURL` to whitelist URLs. |
| `SysAdmin_DBLog` | `DatabaseLogModel` | SQL execution log | (admin-only, see module 22 if it exists) |
| `DanpheAudit` | (raw) | Entity-Framework audit trail written by `Audit.EntityFramework` whenever `IsAuditEnable = true` in `appsettings.json`. Stores the full JSON of every entity change with `InsertedDate` / `LastUpdatedDate` / `Data` (nvarchar max). |

### 4.3 ER summary

```
RBAC_Application (1) ─< (N) RBAC_Permission (1) ─< (N) RBAC_MAP_RolePermission >── (N) RBAC_Role (N) >── (N) RBAC_MAP_UserRole >── (N) RBAC_User
                                                      │                                                  │                                       │
                                                      └── (1) RBAC_Application (via ApplicationId)        └────────── IsSysAdmin flag ──────────┘
RBAC_RouteConfig (self 1:N on ParentRouteId),  (N:1) RBAC_Permission (via PermissionId)
RBAC_Role (N:1) RBAC_RouteConfig via DefaultRouteId
RBAC_User (N:1) EMP_Employee via EmployeeId
DanpheLogInInformation (independent, written on each login/logout)
Danphe_CookieAuthInfo (independent, written on Remember-Me)
```

---

## 5. Key Workflows

### 5.1 Login (MVC form)

Trigger: User posts `LoginViewModel { UserName, Password, RememberMe }` to `/Account/Login`.

1. `AccountController.Login(model, returnUrl)` (`Controllers/AccountController.cs:197`) checks `ModelState.IsValid`.
2. `RBAC.GetUser(model.UserName, model.Password)` (`RBAC/DanpheRBAC.cs:180`) looks up the user in the in-memory `RBAC-Users-All` cache (loaded from `RBAC_User` via `RbacDbContext` if cache miss), matches by case-insensitive user name + TripleDES-encrypted password.
3. If user is `null`, write a `LoginInformationModel { ActionName = "invalid-login-attempt" }` row to `DanpheLogInInformation` and re-render the login view with `ViewData["status"] = "login-failed"`.
4. If `validUser.IsActive == false`, write the same audit row, re-render with `ViewData["status"] = "user-inactive"`.
5. Otherwise:
   - Null out `validUser.Password` (never put a real password in the session/JWT).
   - Write `LoginInformationModel { ActionName = "login", EmployeeId, UserName, CreatedOn }` to `DanpheLogInInformation`.
   - `SetSessionVariable(validUser)` (`AccountController.cs:382`) writes:
     - `HttpContext.Session.Set<RbacUser>("currentuser", validUser)`
     - `HttpContext.Session.Set<List<RbacPermission>>("validpermissionlist", RBAC.GetUserAllPermissions(userId))`
     - `HttpContext.Session.Set<List<RbacRole>>("user-roles", RBAC.GetUserAllRoles(userId))`
   - `GenerateJwtToken(validUser)` (`AccountController.cs:615`) mints a `JwtSecurityToken` signed with `HmacSha256`, `issuer=JwtIssuer`, `audience=JwtAudience`, `expires=UtcNow.AddMinutes(JwtValidMinutes)`, and a single claim of type `ENUM_ClaimTypes.currentUser` ("currentUser") whose value is the JSON-serialized `RbacUser` (no password).
   - The token is written to `TempData["loginJwtToken"]` (MVC) or returned in the JSON body (Swagger endpoint).
   - If `model.RememberMe` is true, `SetRememberMeCookieVariable(ticks, userId)` generates a `Selector = currentDate.Ticks - new DateTime(2001,1,1).Ticks`, a random GUID-based `Validator`, computes `HashedToken = SHA256(validator + selector)`, inserts a `CookieAuthInfoModel` row with `Expires = UtcNow.AddYears(2)`, and writes the `uRef` and `uData` cookies back to the browser.
   - The `[AuditApi(EventTypeName = "Login", IncludeHeaders = true, IncludeResponseHeaders = true, IncludeResponseBody = true, IncludeRequestBody = true, IncludeModelState = true)]` attribute captures the full HTTP exchange to `DanpheAudit`. A regex replaces the password with `*****` in the audit record.
6. Returns `RedirectToAction("Index", "Home")` (MVC) or `Ok({ message, loginJwtToken })` (Swagger).
7. On the Angular side, `app.component.ts:181` reads `loginToken` from a `data-loginToken` attribute on the index page and stores it in `localStorage` as `ENUM_LocalStorageKeys.LoginTokenName` ("loginJwtToken").

### 5.2 Login (Swagger JSON)

Trigger: Client POSTs `LoginDto { UserName, Password }` to `/api/Account/GetLoginJwtToken`.

Identical to the MVC flow except:
- The `[HttpPost] [Route("api/Account/GetLoginJwtToken")]` action returns `Ok({ message, loginJwtToken })`.
- No `RememberMe`, no `TempData`, no MVC view.
- Anonymous auth is allowed because the action is on `AccountController` which does not inherit `CommonController`'s `[DanpheDataFilter]`.

### 5.3 Token validation (every API request)

Trigger: Angular `AuthTokenInterceptor.intercept(req, next)` (`shared/token-interceptor/token-interceptor.service.ts:14`) runs on every outbound `HttpClient` call.

1. Read `localStorage.getItem(ENUM_LocalStorageKeys.LoginTokenName)`. If non-null, clone the request with `Authorization: Bearer <token>`.
2. The browser sends the header. ASP.NET Core's `JwtBearerHandler` (configured in `ConfigureServices.cs:63`) reads it, validates the signature with `IssuerSigningKey = SymmetricSecurityKey(UTF8.GetBytes(JwtKey))`, validates issuer and audience, and parses claims.
3. The `DanpheDataFilter` (`Controllers/DanpheActionFilter.cs:117`) runs as an `ActionFilterAttribute` on every controller that inherits `CommonController` (which is all of them except `AccountController`). Its `OnActionExecuting`:
   - Special-cases `POST /api/Dicom` by reading the JSON body, extracting `currentuser`, and calling `RBAC.IsValidUser` to validate the embedded credential.
   - For every other request, reads `Authorization` header, splits on space, takes index `[1]`, parses via `JwtSecurityTokenHandler.ReadJwtToken`, looks up the claim `ENUM_ClaimTypes.currentUser`, deserializes the JSON back to `RbacUser`, and stores it in `currentUser` (local var).
   - If `currentUser == null`, sets `context.Result = new JsonResult(new DanpheHTTPResponse<object> { Status = "Failed", ErrorMessage = "Unauthorized Access" })`, short-circuiting the action.
4. The action then runs as if the user were authenticated. The actual permission check happens at the UI layer (Angular `rbac-permission` directive / `AuthGuardService`).

### 5.4 Side-nav resolution

Trigger: App boots, `app.component.ts` calls `securityBLService.GetValidNavigationRouteList()` → `/api/Security/NavigationRoutes` → `SecurityController.NavigationRouteList(currentUser)` → `RBAC.GetRoutesForUser(userId, getHiearrchy: false)` → `Set<>("validRouteList", list)` in session → Angular service stores in `securityService.validRouteList`.

The side-nav also calls `securityBLService.GetAllValidRouteList()` → `/api/Security/ValidRoutes` → `SecurityController.AllValidRoutes(currentUser)` → `RBAC.GetRoutesForUser(userId, getHiearrchy: true)`. This returns a hierarchical list — only parent routes where `DefaultShow == true`, each with `ChildRoutes` recursively populated by `RBAC.GetChildRouteHierarchy`. For each parent, the controller also computes `ChildRoutesDefaultShowCount` (the count of children where `DefaultShow == true`), so the UI can show a "12" badge next to the parent if it has 12 visible sub-items.

### 5.5 Permission check (server-side, in code)

Trigger: A business controller wants to enforce a server-side check (e.g. `VerificationBL.cs:66` lets only certain roles be verifiers).

Pattern: get the user from session/JWT, then call one of the static methods on `RBAC`:

```csharp
RbacUser user = HttpContext.Session.Get<RbacUser>("currentuser");
if (RBAC.UserIsSuperAdmin(user.UserId)) { /* full access */ }
if (RBAC.UserHasPermission(user.UserId, "billing-transaction-view")) { /* allow */ }
if (RBAC.UserHasRoleId(user.UserId, roleId)) { /* role-only check */ }
if (RBAC.UserHasPermissionId(user.UserId, permissionId)) { /* by int id */ }
```

These methods all hit the in-memory cache. `UserHasPermission` is overloaded — either by `permissionName` only, or by `(applicationCode, permissionName)`. The latter is the safer variant because it scopes the check to a single application.

### 5.6 Permission check (client-side, on a page)

Trigger: Angular router navigates to a new URL.

1. `AuthGuardService.canActivate(route, state)` (`security/shared/auth-guard.service.ts:12`):
   - If `loggedInUser.UserName == null`, returns `undefined` (router blocks navigation).
   - Otherwise, `securityServ.checkIsAuthorizedURL(state.url)`.
2. `SecurityService.checkIsAuthorizedURL(urlFullPath)` (`security/shared/security.service.ts:230`):
   - Strip leading `/` from the URL.
   - Check `coreService.Parameters` for a `Security/CommonURLFullPath` whitelist. If the URL is whitelisted, return `true` immediately (e.g. user profile pages are accessible to everyone).
   - Split the URL by `/`, build `currParent = "Billing/Transaction"` style parent. Find sibling routes that share the parent (so a missing sub-route redirects to the first available sibling).
   - Find `this.UserNavigations` for a match on the full URL. If found, return `true`. If not, navigate to the first sibling (if any) or return `false`.
3. If `false`, `AuthGuardService` navigates to `/UnAuthorized` and returns `false`.

### 5.7 Permission check (client-side, on a UI element)

Trigger: Template uses `<button rbac-permission="{ name: 'pharmacy-sale-view', actionOnInvalid: 'hidden' }">`.

1. `RbacPermissionDirective.ngOnInit()` (`security/shared/rbac-permission.directive.ts:18`).
2. Parses the input (can be a JSON string or an object). Extracts `rbacPermission.name` and `rbacPermission.actionOnInvalid`.
3. Calls `securityService.HasPermission(name)`, which scans `this.UserPermissions` for a permission where `PermissionName == name && IsActive == true`.
4. If permission is missing, applies the action: `hidden` → `el.nativeElement.hidden = true` AND `el.nativeElement.style.display = 'none'`; `disabled` → `renderer.setAttribute(el, 'disabled', 'true')`; `remove` → `el.nativeElement.remove()`.
5. If permission is present, no action is taken.

### 5.8 Role assignment (admin UI)

Trigger: SysAdmin opens `Settings/SecurityManage/ManageUser`, picks a user, opens `user-role-map.component.ts`, ticks a role checkbox, clicks Save.

1. Frontend posts `List<UserRoleMap>` to `/api/SecuritySettings/UserRoles` (POST).
2. `SecuritySettingsController.SaveUserRoles(ipDataStr)` (`SecuritySettingsController.cs:310`):
   - `DanpheJSONConvert.DeserializeObject<List<UserRoleMap>>(ipDataStr)`.
   - For each map, `_rbacDbContext.UserRoleMaps.Add(userRole)`.
   - `_rbacDbContext.SaveChanges()`.
3. The new mapping is now in the database. It will only take effect for the user on their *next* login (the `RBAC-UserPermissions-UserId<id>` cache entry is keyed by the user id and is refreshed on next `GetUserAllPermissions` call after TTL expiry, or on the next login when `SetSessionVariable` calls `GetUserAllPermissions` again).
4. `PutUserRoles` updates existing rows (marks `IsActive` true/false or changes `EndDate`).

### 5.9 Permission assignment (admin UI)

Trigger: SysAdmin opens `Settings/SecurityManage/ManageRole`, picks a role, opens `role-permission-manage.component.ts`, ticks permissions, clicks Save.

1. Frontend posts `List<RolePermissionMap>` to `/api/SecuritySettings/RolePermissions?roleId=N` (POST).
2. `SecuritySettingsController.SaveRolePermissions(roleId, ipDataStr)` (`SecuritySettingsController.cs:267`):
   - **Step 1 — remove all existing mappings of this role.** `existingMapping = _rbacDbContext.RolePermissionMaps.Where(r => r.RoleId == roleId).ToList()`. For each, `_rbacDbContext.RolePermissionMaps.Remove(map)`. `_rbacDbContext.SaveChanges()`.
   - **Step 2 — add new mappings.** Deserialize the body, for each `roleP`, add to context. `SaveChanges()`.
3. The new permissions are now bound to the role. Every user holding this role will see the new permissions on their next login / cache refresh.

### 5.10 Activate a billing / lab / pharmacy counter

Trigger: User opens the billing counter activation page, picks a counter, clicks Activate.

1. Frontend PUTs `/api/Security/ActivateBillingCounter?counterId=12` to `SecurityController`.
2. `SecurityController.PutActivateBillingCountery(counterId)` (`SecurityController.cs:408`) calls `InvokeHttpPutFunction(func)` with `func = () => ActivateBillingCounter(counterId)`.
3. `ActivateBillingCounter` (line 872): `HttpContext.Session.Set<string>("activeBillingCounter", counterId.ToString())`. Returns `counterId`.
4. Subsequent calls to `/api/Security/ActiveBillingCounter` will return the active counter id from the same session.

The same pattern applies to `ActivatePharmacyCounter` (also stores `activePharmacyCounterName`), `ActivateDispensary` (also `activeDispensaryName`), `ActivateLab` (also `activeLabName`), `ActivateInventory`, and `ActivateAccountingHospital` (which also loads fiscal years, sections, and hospital names into the `AccSelectedHospitalInfo` session var).

### 5.11 Remember-Me auto-login

Trigger: User previously logged in with `RememberMe = true`. Browser sends back `uRef` and `uData` cookies.

1. `AccountController.Login` (GET) at line 137 checks `Request.Cookies["uRef"]`. If present, reads `selector = Int64(cookie["uRef"])`, reads `validator = cookie["uData"]`, computes `hashedValidator = SHA256(validator + selector)`.
2. Queries `adminDbContext.CookieInformation` for a row where `Selector == selector && HashedToken == hashedValidator`. Expects exactly one match.
3. If exactly one match, calls `RBAC.GetUser(userId)` to get the `RbacUser`, sets session variables (same as a fresh login), calls `UpdateRememberMeCookie(selector)` to rotate the validator (defense against token theft).
4. If zero or multiple matches (attack or corruption), removes the cookies and re-renders the login view.

### 5.12 Logout

Trigger: User clicks the Logout link or the session expires (2-hour idle timeout from `services.AddSession`).

1. `AccountController.Logout` (`AccountController.cs:285`):
   - Writes `LoginInformationModel { ActionName = "logout" }` to `DanpheLogInInformation`.
   - `RemoveRememberMeCookie()` deletes the `uRef` and `uData` cookies.
   - `RemoveSessionValues()` calls `HttpContext.Session.Clear()`.
   - Returns the Login view with `ViewData["status"] = "logout-success"`.
2. On the Angular side, `app.component.ts:457` calls `localStorage.removeItem(ENUM_LocalStorageKeys.LoginTokenName)` to drop the JWT.

### 5.13 Change password

Trigger: User submits `ChangePasswordViewModel { UserName, Password, NewPassword, ConfirmPassword }` to `/Account/ChangePassword`.

1. `AccountController.ChangePassword` (`AccountController.cs:335`) reads the body (note: this action does *not* inherit from `CommonController` and does not pass through the JWT filter, so it's a public endpoint):
   - Deserialize the body manually from `Request.Body` (the action is called by an Angular service that POSTs raw JSON).
   - `RBAC.UpdateDefaultPasswordOfUser(model.UserName, model.Password, model.ConfirmPassword)` (`RBAC/DanpheRBAC.cs:325`).
2. `UpdateDefaultPasswordOfUser` looks up the user by `(UserName case-insensitive, Password == EncryptPassword(currentPassword))`. If null, returns null (current password is wrong). Otherwise, sets `usr.Password = EncryptPassword(confirmPassword)`, `usr.NeedsPasswordUpdate = false`, `usr.ModifiedOn = UtcNow`, `usr.ModifiedBy = usr.EmployeeId`, `SaveChanges()`. Returns the updated user.
3. Updates the in-session `currentuser.NeedsPasswordUpdate = false` so the next page render does not re-prompt.
4. Returns `Ok` or `Failed` (with "Current Password is Wrong" message).

### 5.14 Software-license check on every login

Trigger: User navigates to `/Account/Login` (GET).

1. `AccountController.Login` (GET) at line 66:
   - Generates a one-time selector/validator for the cookie path (even if the user does not use Remember Me).
   - Reads `coreDbContext.Parameters` for `ParameterGroupName = "TenantMgnt" && ParameterName = "SoftwareLicense"`. Deserializes the JSON (`StartDate`, `EndDate`, `ExpiryNoticeDays`, `LicenseType`).
   - Decrypts each field with `RBAC.DecryptPassword`.
   - If `endDate < UtcNow`, redirects to `LicenseExpired` view.
   - If `expiryNoticeDays > remainingDays`, sets `ViewData["ExpiryNotice"]` to a banner message.

---

## 6. API Endpoints

All routes are version-less. The "Auth" column shows whether `[AllowAnonymous]` is set (login endpoints) or whether the request is implicitly filtered by `DanpheDataFilter` (everything else).

### 6.1 `AccountController` — Authentication (`/Account/*` and `/api/Account/*`)

| Verb | Route | Auth | Purpose |
|---|---|---|---|
| GET | `/Account/Login` | Anonymous | Renders the login form. Also handles the "Remember Me" auto-login path (reads `uRef`/`uData` cookies, validates against `Danphe_CookieAuthInfo`, auto-logs-in the user). Runs the software-license check. |
| POST | `/Account/Login` | Anonymous | Accepts `LoginViewModel { UserName, Password, RememberMe }`. Validates credentials, writes `DanpheLogInInformation` audit row, sets session variables, mints JWT, sets Remember-Me cookies if requested. `[AuditApi]` attribute captures the full exchange to `DanpheAudit`. |
| GET | `/Account/Logout` | Anonymous | Writes `logout` row to `DanpheLogInInformation`, removes Remember-Me cookies, clears session, returns the login view. |
| GET | `/Account/PageNotFound` | Anonymous | Renders the "404 / not authorized" view. |
| GET | `/Account/ForgotPassword` | Anonymous | Placeholder. Renders the forgot-password view. |
| POST | `/Account/ChangePassword` | Anonymous | Accepts `ChangePasswordViewModel { UserName, Password, NewPassword, ConfirmPassword }` from raw body. Calls `RBAC.UpdateDefaultPasswordOfUser`. |
| GET | `/Account/UnAuthorizeAccess` | Anonymous | Renders the "you do not have access" view. |
| GET | `/Account/LicenseExpired` | Anonymous | Renders the license-expired view. |
| POST | `/api/Account/GetLoginJwtToken` | Anonymous | Swagger / Postman / test endpoint. Accepts `LoginDto { UserName, Password }`, returns `{ message, loginJwtToken }`. |

### 6.2 `SecurityController` — Active session (`/api/Security/*`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/api/Security/LoggedInUserInformation` | Returns the current `RbacUser` plus `Employee`, `ImageLocation`, `NeedsPasswordUpdate`, `DefaultPagePath` (resolved from highest-priority role), `LandingPageRouteId`, `IsSysAdmin`. |
| GET | `/api/Security/NavigationRoutes` | Returns a flat list of all `DanpheRoute`s the current user can access. Stored in session as `validRouteList`. |
| GET | `/api/Security/ValidRoutes` | Returns a hierarchical list of routes (parents with `DefaultShow=true`, each with its `ChildRoutes` populated by `RBAC.GetChildRouteHierarchy`). Each parent has a `ChildRoutesDefaultShowCount`. Stored in session as `validallrouteList`. |
| GET | `/api/Security/UserPermissions` | Returns the flat list of all `RbacPermission`s the current user has (via `RBAC.GetUserAllPermissions`). Stored in session as `userAllPermissions`. |
| GET | `/api/Security/ActiveBillingCounter` | Returns the active billing counter id from session. |
| GET | `/api/Security/ActiveLab` | Returns `{ LabTypeId, LabTypeName }` of the active lab. |
| GET | `/api/Security/ActiveInventory` | Returns the active inventory store id (`PHRMStoreModel.StoreId`). |
| GET | `/api/Security/ActivePharmacyCounter` | Returns `{ CounterId, CounterName }` of the active pharmacy counter. |
| GET | `/api/Security/ActiveAccountingHospitalInformation` | Returns the full `AccHospitalInfoVM` (hospital id, fiscal year list, current fiscal year, sections, hospital long/short name). |
| GET | `/api/Security/InventeryHospitalInformation` | Returns the inventory-fiscal-year `AccHospitalInfoVM` (lazily computed from `InventoryDbContext.InventoryFiscalYears` on first call, then cached in session). |
| GET | `/api/Security/ActiveDispensary` | Returns the active dispensary (`PHRMStoreModel.StoreId + Name`). |
| PUT | `/api/Security/ActivateBillingCounter?counterId=N` | Sets `activeBillingCounter` in session. |
| PUT | `/api/Security/ActivatePharmacyCounter?counterId=N&counterName=...` | Sets `activePharmacyCounter` + `activePharmacyCounterName`. |
| PUT | `/api/Security/ActivateDispensary?dispensaryId=N&dispensaryName=...` | Sets `activeDispensary` + `activeDispensaryName`. |
| PUT | `/api/Security/DeactivateDispensary` | Removes both dispensary session vars. |
| PUT | `/api/Security/ActivateLab?labId=N&labName=...` | Sets `activeLabId` + `activeLabName`. |
| PUT | `/api/Security/DeactivateBillingCounter` | Removes `activeBillingCounter`. |
| PUT | `/api/Security/ActivateInventory?InventoryId=N` | Sets `activeInventoryId`. |
| PUT | `/api/Security/DeactivateInventory` | Removes `activeInventoryId`. |
| PUT | `/api/Security/DeactivatePharmacyCounter` | Removes both pharmacy counter session vars. |
| PUT | `/api/Security/DeactivateLab` | Removes both lab session vars. |
| PUT | `/api/Security/ActivateAccountingHospital?hospitalId=N` | Loads fiscal years / sections / hospital names into `AccSelectedHospitalInfo` and stores `AccSelectedHospitalId` in session. |

### 6.3 `SecuritySettingsController` — Admin RBAC CRUD (`/api/SecuritySettings/*`)

| Verb | Route | Purpose |
|---|---|---|
| GET | `/api/SecuritySettings/Applications` | Lists all `RbacApplication` rows, eager-loading `Permissions` and `Roles`. Ordered by `ApplicationName`. |
| GET | `/api/SecuritySettings/Routes` | Lists all `DanpheRoute` rows from `RBAC_RouteConfig`. |
| GET | `/api/SecuritySettings/Permissions` | Lists all `RbacPermission` rows joined to `RbacApplication`. Ordered by `ApplicationId`. |
| GET | `/api/SecuritySettings/Roles` | Lists all `RbacRole` rows where `IsSysAdmin = false`, joined to default `Route` and `Application`. Ordered by `RoleName`. |
| GET | `/api/SecuritySettings/Users` | Lists all `RbacUser` rows joined to `Employee` and `Department`. Returns `UserId, EmployeeId, UserName, Email, EmployeeName, FirstName, LastName, CreatedOn, CreatedBy, IsActive, NeedsPasswordUpdate, DepartmentName`. Ordered by `FirstName, LastName`. |
| GET | `/api/SecuritySettings/RolePermissions?roleId=N` | Lists all `RolePermissionMap` rows for the given role, joined to `Role`, `Permission`, and `Application`. |
| GET | `/api/SecuritySettings/UserRoles?userId=N` | Lists all `UserRoleMap` rows for the given user, joined to `User` and `Role`. |
| POST | `/api/SecuritySettings/User` | Creates a new `RbacUser`. Encrypts the password with `RBAC.EncryptPassword` before insert. Returns the user with `EmployeeName` resolved. |
| POST | `/api/SecuritySettings/Role` | Creates a new `RbacRole`. |
| POST | `/api/SecuritySettings/RolePermissions?roleId=N` | **Replaces** all permission mappings for the role. Step 1: remove all existing rows. Step 2: add the body rows. Body: `List<RolePermissionMap>`. |
| POST | `/api/SecuritySettings/UserRoles` | Appends a list of new `UserRoleMap` rows. |
| PUT | `/api/SecuritySettings/User` | Updates a `RbacUser` row (preserves `CreatedOn`, `CreatedBy`). |
| PUT | `/api/SecuritySettings/Role` | Updates a `RbacRole` row (preserves `CreatedOn`, `CreatedBy`). |
| PUT | `/api/SecuritySettings/RolePermissions` | Updates an existing list of `RolePermissionMap` rows (preserves `CreatedOn`, `CreatedBy`). |
| PUT | `/api/SecuritySettings/UserRoles` | Updates an existing list of `UserRoleMap` rows (preserves `CreatedOn`, `CreatedBy`). |
| PUT | `/api/SecuritySettings/ResetPassword` | Updates `Password`, `ModifiedBy`, `ModifiedOn`, `NeedsPasswordUpdate` on a user. Password is re-encrypted with `RBAC.EncryptPassword` before save. |
| PUT | `/api/SecuritySettings/UserIsActive` | Toggles `IsActive` on a user (admin activate/deactivate). |

### 6.4 Action filters (no routes)

| Filter | Where applied | Behavior |
|---|---|---|
| `[DanpheDataFilter()]` | `CommonController` (class-level) | In `OnActionExecuting`: reads `Authorization` header → `JwtSecurityTokenHandler` → extracts `ENUM_ClaimTypes.currentUser` claim → deserializes to `RbacUser`. If null, returns `JsonResult(DanpheHTTPResponse { Status = "Failed", ErrorMessage = "Unauthorized Access" })`. Special case for `POST /api/Dicom`: reads body JSON, calls `RBAC.IsValidUser`. |
| `[DanpheViewFilter("permission-name")]` | Per-action on `*ViewController.cs` (e.g. `BillingViewController.cs:25` `[DanpheViewFilter("billing-transaction-view")]`). Also seen on `SettingsViewController.cs:47` `[DanpheViewFilter("settings-view")]`. | In `OnActionExecuting`: reads `currentuser` from session, reads `validpermissionlist` from session, finds the permission by name. If not present, redirects to `Account/PageNotFound`. |
| `[RequestFormSizeLimit(valueCountLimit: 1000000, Order = 1)]` | `CommonController` (class-level) | `IAuthorizationFilter` that sets `FormOptions` (ValueLengthLimit, KeyLengthLimit, ValueCountLimit all = 1,000,000) on the request to allow large form payloads (e.g. inventory bulk uploads). |

### 6.5 JWT configuration (no routes)

| Setting | Source | Value |
|---|---|---|
| `JwtKey` | `appsettings.json` → `JwtTokenConfig:JwtKey` | Symmetric key (UTF-8 bytes) used for HMAC-SHA256 signing. **SymmetricSecurityKey(UTF8.GetBytes(JwtKey))** in both the issuer (`AccountController.GenerateJwtToken`) and the validator (`ConfigureServices.cs:78`). |
| `JwtIssuer` | `JwtTokenConfig:JwtIssuer` | `iss` claim. Validated in `ConfigureServices.cs:82`. |
| `JwtAudience` | `JwtTokenConfig:JwtAudience` | `aud` claim. Validated in `ConfigureServices.cs:81`. |
| `JwtValidMinutes` | `JwtTokenConfig:JwtValidMinutes` | Token lifetime in minutes. Default 60 minutes if unset. `expires: DateTime.UtcNow.AddMinutes(Convert.ToDouble(JwtValidMinutes))`. |
| `SaveToken` | `ConfigureServices.cs:75` | `true` — the token is stored in `HttpContext` after validation, so app code can read it back if needed. |
| `RequireHttpsMetadata` | `ConfigureServices.cs:73` | `false` — JWT can be sent over HTTP (dev convenience). |

---

## 7. Cross-Module Interactions

The Security module is the dependency root of the entire system. Every other module is downstream of it.

### 7.1 Direct consumers of `RbacUser` / session

Almost every controller reads the current user from session in order to attribute created/modified records:

- **Patient (32)** — `PatientController` writes `CreatedBy` / `ModifiedBy` from `currentuser.EmployeeId`.
- **Billing (05)** — `BillingController`, `BillingSettlement`, `BillReturn`, `BillingReports` all gate by `currentUser != null` and write `CreatedBy` / `ModifiedBy` / `CreatedOn`.
- **Pharmacy (34)** — `PharmacyController`, `PharmacyPOController`, `PHRMSupplierLedgerController` (each decorated with `[DanpheDataFilter]` on the class), plus `PharmacySettingsController.cs:579` and `PharmacyController.cs:3922` send notifications *to a specific role* (queries `rbacDbContext.Roles.Where(a => a.RoleName == "Pharmacy").Select(a => a.RoleId)`).
- **Inventory (21)** — `InventoryDonationController`, `WardSupply` substore, `WardSupplyBL.cs:243` and `SubstoreBL.cs:423` use `RBAC.MapRoleWithPermission` to dynamically create new "store verifier" roles and grant them store-specific permissions on the fly.
- **Lab (22)** — `LabViewController.cs:170` decorated with `[DanpheViewFilter("lab-settings-view")]`.
- **Radiology (36)** — `RadiologyViewController` decorated with multiple `[DanpheViewFilter(...)]` calls.
- **Appointment (04)** — `AppointmentController` writes `CreatedBy` from `currentuser`.
- **Admission (03)** — `AdmissionController` similarly.
- **HR (Employee)** — `EmployeeSettingsController`, `SecuritySettingsController` (admin) — see below.
- **Verification** — `VerificationBL.cs:66` uses `RBAC.UserIsSuperAdmin` and `RBAC.UserHasRoleId` to enforce "only a verifier of this role (or a sysadmin) can verify this transaction."
- **Reporting** — `ReportingController`, `GovernmentReportingController`, `BillingReportsController` — each `[DanpheViewFilter("...")]` action.
- **Clinical / Nursing / Doctors / Pharmacy / Dispensary** — all MVC view controllers use `[DanpheViewFilter(...)]` to gate pages by permission.
- **All `*ViewController` actions** — every view-page action is decorated with `[DanpheViewFilter("permission-name")]`. Examples (100+ across the codebase):
  - `SettingsViewController.cs:47` `[DanpheViewFilter("settings-view")]`
  - `SettingsViewController.cs:100` `[DanpheViewFilter("settings-departmentsmanage-view")]`
  - `SettingsViewController.cs:149` `[DanpheViewFilter("ssettings-securitymanage-view")]` *(note typo: "ssettings")*
  - `BillingViewController.cs:25` `[DanpheViewFilter("billing-transaction-view")]`
  - `BillingViewController.cs:38` `[DanpheViewFilter("billing-counteractivate-view")]`
  - `PharmacyViewController.cs:36` `[DanpheViewFilter("pharmacy-billingmain-view")]`
  - `PharmacyViewController.cs:140` `[DanpheViewFilter("pharmacy-salemain-view")]`
  - `PatientViewController.cs:25` `[DanpheViewFilter("patient-register-address-view")]`
  - `PatientViewController.cs:91` `[DanpheViewFilter("patient-register-view")]`
  - `DoctorsViewController.cs:37` `[DanpheViewFilter("doctors-outpatientdoctor-view")]`
  - `ReportingController.cs:35` `[DanpheViewFilter("reports-view")]` and ~20 more per-report

### 7.2 Indirect consumers via the Angular guard

Every feature module's routing module uses `AuthGuardService` to gate every route. The guard delegates to `SecurityService.checkIsAuthorizedURL` which checks `UserNavigations`. 437 occurrences of `canActivate: [AuthGuardService]` in the codebase — every `*-routing.module.ts` in every feature module.

Examples:
- `wardsupply/wardsupply-routing.module.ts:49` — `WardSupplyMainComponent, canActivate: [AuthGuardService]`
- `verification/verification-routing.module.ts:21` — `VerificationMainComponent, canActivate: [AuthGuardService]`
- `vaccination/vaccination-routing.module.ts:21` — `VaccinationPatientListComponent, canActivate: [AuthGuardService]`
- `system-admin/system-admin-routing.module.ts:20` — `SystemAdminMainComponent, canActivate: [AuthGuardService]`
- `settings-new/security/security-settings.module.ts:27-28` — `UserListComponent / RoleListComponent, canActivate: [AuthGuardService]`
- `scheduling/scheduling-routing.module.ts:18,21,24,26,36` — all 5 routes guarded
- `reporting/reporting-routing.module.ts:96,110,115,120,126,132,137` — every report guarded
- `radiology/radiology-routing.module.ts` (multiple)
- `patient/patient-routing.module.ts` (multiple)
- And so on for ~30 feature modules

### 7.3 Indirect consumers via the `rbac-permission` directive

The directive is sprinkled across the Angular templates. It is registered in `SharedModule` and available to every feature component. Common pattern:

```html
<button *ngIf="..." rbac-permission="{ name: 'pharmacy-sale-view', actionOnInvalid: 'hidden' }">
  New Sale
</button>
```

### 7.4 Indirect consumers via the token interceptor

Every `HttpClient` call carries the JWT because `AuthTokenInterceptor` is registered as `HTTP_INTERCEPTORS` with `multi: true` in both `SharedModule` and `SecurityModule`. So every API call (200+ endpoints) implicitly requires a valid token.

### 7.5 The `EMP_Employee` ↔ `RBAC_User` link

`RBAC_User.EmployeeId` references `EMP_Employee.EmployeeId` (HR module). This means:
- An employee must exist in HR before they can be given a login.
- `SecuritySettingsController.GetUsers()` joins `RBAC_User → Employee → Department` to show "DepartmentName" in the user list.
- The `SecurityController.GetLoggedInUserInformation()` endpoint returns the full `Employee` object so the Angular client can render the user's name, profile image, etc.

---

## 8. Key Business Rules

### 8.1 Permission resolution

The order in which permissions are resolved (most → least privileged):

1. **System-admin role bypass** — if the user has *any* role with `IsSysAdmin = true`, `RBAC.GetUserAllPermissions(userId)` returns `RBAC.GetAllPermissions()` (the entire catalog). This short-circuit happens at line 256 of `DanpheRBAC.cs`.
2. **Direct role permissions** — otherwise, the user's permissions are computed as a join of: `UserRoleMap (where IsActive=true) → Role → RolePermissionMap (where IsActive=true) → Permission → Application (where IsActive=true)`.
3. **Inherited / implicit permissions** — there are *no* implicit permissions. Every permission must be explicitly granted via a `RolePermissionMap`. The convention `<module>-<entity>-<verb>` is just a string, not a hierarchy.
4. **Temporal permissions** — `UserRoleMap.StartDate` and `EndDate` exist on the model but the current `GetUserAllPermissions` LINQ does **not** filter by them. A role grant with `EndDate = '2020-01-01'` will still apply after that date unless an admin flips `IsActive = false`.
5. **Soft-deleted rows are filtered** — `IsActive = true` is required on the user-role map, role-permission map, permission, and application. Roles and users are filtered per-read by the `Where` clauses in the controller (`SecuritySettingsController.GetRoles()` explicitly filters `r.IsSysAdmin == false`).

### 8.2 Role hierarchy

There is **no built-in role hierarchy** (no "Senior Doctor" inherits from "Doctor"). Each role is a flat bag of permissions. The only role-related special-cases are:

- **`IsSysAdmin` flag** — a single bit on `RbacRole` that grants the holder the entire permission catalog. This is the closest thing to a "superuser" role.
- **`RolePriority`** — used only at login time to pick the `DefaultRouteId`. `LoggedInUserInformation` orders the user's roles by `RolePriority` ascending and takes the first one's `DefaultRouteId` as `defaultRoutePath`. So a user with roles (Priority=1) and (Priority=5) lands on the Priority=1 page.
- **`LandingPageRouteId`** on the user — overrides the role default. Read directly in `LoggedInUserInformation`.

### 8.3 Hospital / tenant isolation

The system is single-tenant at the application level — there is no `tenant_id` discriminator. But the **accounting module** is multi-hospital within a tenant: a single user can switch between hospitals (the active hospital is stored in session as `AccSelectedHospitalInfo` and `AccSelectedHospitalId`). The relevant Security touch-points:

- `SecurityController.GetActiveAccHospitalInformation` returns the currently-active accounting hospital.
- `SecurityController.PutActivateAccountingHospital(hospitalId)` loads the fiscal years, sections, and hospital names for the chosen hospital into session.
- `SecurityController.GetInventeryHospitalInformation` lazily computes the inventory-hospital info on first request, then caches it in session as `INVHospitalInfo`.
- `SecurityService` exposes `getActiveHospitalInAccounting()` (commented out but designed for the future) and `ActiveInsuranceProvider` to model a similar pattern for insurance providers.

### 8.4 Default landing page algorithm

`SecurityController.LoggedInUserInformation` (`SecurityController.cs:657`):

```
1. Read all of the user's roles from RBAC.GetUserAllRoles(userId).
2. If any, order by RolePriority ascending, take the first.
3. Read defRouteId = role.DefaultRouteId.
4. Look up the DanpheRoute where RouteId == defRouteId.
5. Return defaultRoutePath = route.UrlFullPath.
6. ALSO read user.LandingPageRouteId (set per-user).
7. Front-end is expected to use user.LandingPageRouteId first, fall back to defaultRoutePath.
```

### 8.5 Counter / store activation

A user must "activate" a billing counter, lab, pharmacy counter, or inventory store before they can do work in that area. The activation stores the active id in session; the controllers in that module read the session var and refuse to operate if it's not set. Examples:

- `ActivateBillingCounterGuardService` (an Angular guard on routes like `Billing/Transaction`).
- `ActivateInventoryGuardService` (similar for inventory).
- The `Pharmacy Counter` activation is read on the server side in `PharmacyController` to scope prescriptions/dispenses to the active counter.

The activation is a single user setting — there is no per-counter row-level lock. Two users can activate the same counter simultaneously.

### 8.6 Password rules

- **Storage** — passwords are encrypted with `RBAC.EncryptPassword` (TripleDES, MD5("Danphesalt")-derived key, ECB mode, PKCS7 padding). The encrypted blob is base64-encoded and stored in `RBAC_User.Password`. There is no separate "salt per user" — every user shares the same `Danphesalt` constant.
- **Decryption** — `RBAC.DecryptPassword` reverses the operation, used by `AccountController.Login` to read back the stored password.
- **Lookup** — `RBAC.GetUser(userName, password)` matches by `UserName.ToLower() == userName.ToLower() && Password == EncryptPassword(password)`. The case-insensitive username + case-sensitive password check.
- **Validation** — the form validators in `user.model.ts` require `Password` length 6-20, and require `Email` to match a regex.
- **Change password** — `ChangePassword` requires the current password (re-encrypted) plus a new password plus a `ConfirmPassword` that matches `NewPassword` (DataAnnotations `[Compare("NewPassword")]`).
- **First-login flow** — `NeedsPasswordUpdate = true` is set when an admin resets a password. The Angular side reads `loggedInUser.NeedsPasswordUpdate` and forces the user through the change-password page before letting them navigate.
- **No password rotation policy** — there is no policy that forces a password change every N days.

### 8.7 Caching & staleness

- `CacheExpirationMinutes` in `appsettings.json` controls the TTL of every `RBAC.Get*` cache. Typical default is 30 minutes.
- **Implication** — when an admin grants a new role to a user via `SecuritySettingsController.PostUserRoles`, the change is **not** immediately visible to the user. The user must:
  1. Log out and log back in (which forces a fresh `GetUserAllPermissions` call), OR
  2. Wait `CacheExpirationMinutes` for the in-process cache to expire.
- There is **no cache-invalidation API**. The `RBAC` static class does not expose a `ClearCache()` method.

### 8.8 The "Common URL" whitelist

`SysAdmin_Parameters` can hold a JSON array under `ParameterGroupName = "Security" && ParameterName = "CommonURLFullPath"`. `SecurityService.checkIsAuthorizedURL` reads this and whitelists those URLs (e.g. user profile pages) so every authenticated user can access them, regardless of role. Default content (if unset) is empty.

### 8.9 The "License" gate

The login page reads `SysAdmin_Parameters` for `ParameterGroupName = "TenantMgnt" && ParameterName = "SoftwareLicense"`. The parameter value is a JSON `{ StartDate, EndDate, ExpiryNoticeDays, LicenseType }` whose fields are each encrypted with `RBAC.DecryptPassword`. If the license is expired, the user is redirected to `LicenseExpired` (no further access).

### 8.10 Audit-trail rules

- **Every login attempt** — successful or not — writes a `DanpheLogInInformation` row. `ActionName` is one of `"login"`, `"logout"`, `"invalid-login-attempt"`. `EmployeeId` is null for failed attempts.
- **Every API login** (Swagger endpoint) — same audit row, plus the `[AuditApi]` attribute writes the full request/response to `DanpheAudit` (admin DB), with the password replaced with `*****` via regex.
- **Every entity change** — if `IsAuditEnable = true` in `appsettings.json`, `Audit.EntityFramework` writes the change to `DanpheAudit`. The `CommonController.AddAuditField` helper injects `ChangedByUserId = currentuser.EmployeeId` and `ChangedByUserName = currentuser.UserName` into the audit scope so every change is attributed.

### 8.11 Known limitations / sharp edges

- **Trust-the-bearer API** — `DanpheDataFilter` only checks for *a* valid JWT. It does not check that the JWT's user has the specific permission for the action. A bearer token grants access to every API endpoint.
- **Cache-based staleness** — see 8.7. Admin changes are not real-time.
- **`StartDate` / `EndDate` on `UserRoleMap` are not enforced** — see 8.1.4.
- **Same salt for all users** — see 8.6. A breach of the source code (or the `Danphesalt` constant) compromises every password at once.
- **No CSRF protection on JSON APIs** — the `DanpheDataFilter` only checks the JWT, not an anti-forgery token. The `Login` MVC POST does have `[ValidateAntiForgeryToken]`, but the JSON `LoginToDanpheEMR` does not.
- **JWT in `localStorage`** — the Angular client stores the JWT in `localStorage` (not an `HttpOnly` cookie), so a XSS vulnerability would leak the token. A `HttpOnly` cookie-based approach would be safer.
- **No refresh-token flow** — when the JWT expires (after `JwtValidMinutes` minutes, typically 60), the user is silently logged out on the next API call. There is no automatic refresh.
- **`SetSessionVariable` writes to the session but does not refresh the JWT** — the JWT is generated once at login with a fixed expiry. The session may live 2 hours (from `AddSession` idle timeout) but the JWT only lives `JwtValidMinutes` minutes (typically 60). The two timeouts are not coordinated.
- **Concurrent role grants** — `SaveRolePermissions` uses a delete-then-insert pattern inside the controller. There is no transaction wrapping the two steps, so a partial failure can leave a role with no permissions until the admin retries.
- **No "audit who-read"** — reading user records is not audited. Only writes are captured by the EF audit pipeline.
- **`SecurityService.HasPermission` looks for *any* matching permission** — it does not check `IsActive == true` in the current code (`security.service.ts:222` is the only line that does the `IsActive` check). This is a behavior worth noting because the server-side `RbacPermission` always has `IsActive` set, but if the cache ever served a stale `IsActive=false` row, the client would still grant access.

---

## 9. File Reference (path-anchored cheat-sheet)

| Concern | Path |
|---|---|
| RBAC service (single source) | `DanpheEMR reference/Code/Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs:15` |
| Password encrypt | `DanpheEMR reference/Code/Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs:356` |
| Password decrypt | `DanpheEMR reference/Code/Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs:379` |
| Get user permissions | `DanpheEMR reference/Code/Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs:248` |
| Get routes for user | `DanpheEMR reference/Code/Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs:124` |
| User is super admin | `DanpheEMR reference/Code/Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs:281` |
| AccountController login | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/AccountController.cs:197` |
| AccountController logout | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/AccountController.cs:285` |
| AccountController change password | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/AccountController.cs:335` |
| AccountController get JWT | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/AccountController.cs:549` |
| AccountController generate JWT | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/AccountController.cs:615` |
| AccountController set session | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/AccountController.cs:382` |
| AccountController set remember-me | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/AccountController.cs:413` |
| DanpheDataFilter | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/DanpheActionFilter.cs:117` |
| DanpheViewFilter | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/DanpheActionFilter.cs:61` |
| SecurityController logged-in user | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Security/SecurityController.cs:657` |
| SecurityController nav routes | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Security/SecurityController.cs:709` |
| SecurityController valid routes | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Security/SecurityController.cs:726` |
| SecurityController user perms | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Security/SecurityController.cs:758` |
| SecuritySettingsController user CRUD | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Settings/SecuritySettingsController.cs:122` |
| SecuritySettingsController role CRUD | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Settings/SecuritySettingsController.cs:98` |
| SecuritySettingsController perm CRUD | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Settings/SecuritySettingsController.cs:78` |
| SecuritySettingsController role-perm save | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Settings/SecuritySettingsController.cs:267` |
| SecuritySettingsController user-role save | `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Settings/SecuritySettingsController.cs:310` |
| CommonController (auth base) | `DanpheEMR reference/Code/Websites/DanpheEMR/Utilities/CommonController.cs:20` |
| JWT config | `DanpheEMR reference/Code/Websites/DanpheEMR/Utilities/MyConfiguration.cs:33` |
| JWT register | `DanpheEMR reference/Code/Websites/DanpheEMR/ConfigureServices.cs:63` |
| Session config | `DanpheEMR reference/Code/Websites/DanpheEMR/Startup.cs:102` |
| RBAC singleton registration | `DanpheEMR reference/Code/Websites/DanpheEMR/Startup.cs:199` |
| Angular SecurityService | `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/security/shared/security.service.ts:19` |
| Angular AuthGuardService | `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/security/shared/auth-guard.service.ts:7` |
| Angular rbac-permission directive | `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/security/shared/rbac-permission.directive.ts:8` |
| Angular token interceptor | `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/shared/token-interceptor/token-interceptor.service.ts:12` |
| Angular settings DL (security endpoints) | `DanpheEMR reference/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/settings-new/shared/settings.dl.service.ts:339-403` |

---

## 10. Quick Reference — Common Tasks

### 10.1 "Add a new permission"
1. Insert a row into `RBAC_Permission` with `PermissionName = "my-new-perm"`, `ApplicationId = <relevant app>`, `IsActive = true`.
2. Bind a `RBAC_RouteConfig` row to it: set `PermissionId` on the route.
3. Grant the permission to one or more roles: insert rows into `RBAC_MAP_RolePermission`.
4. Use the permission in MVC: `[DanpheViewFilter("my-new-perm")]` on the action.
5. Use the permission in Angular: `<button rbac-permission="{ name: 'my-new-perm', actionOnInvalid: 'hidden' }">`.
6. Optionally use it in server code: `if (RBAC.UserHasPermission(userId, "my-new-perm")) { ... }`.
7. Wait for the cache TTL to expire (or have the user log out / log in) before the change takes effect.

### 10.2 "Add a new role"
1. Insert a row into `RBAC_Role` with `RoleName`, `ApplicationId`, `IsActive = true`, `IsSysAdmin = false`, `RolePriority` (lower = higher priority), `DefaultRouteId` (optional).
2. Grant permissions: `RBAC_MAP_RolePermission` rows.
3. Assign the role to users: `RBAC_MAP_UserRole` rows.

### 10.3 "Make a user a system admin"
1. Either set `IsSysAdmin = true` on an existing role and assign that role to the user via `RBAC_MAP_UserRole`, OR
2. Create a new "SysAdmin" role with `IsSysAdmin = true` and assign it.

### 10.4 "Disable a user"
1. Either set `IsActive = false` on the `RBAC_User` row (via `PUT /api/SecuritySettings/UserIsActive`), OR
2. Set `IsActive = false` on all of their `RBAC_MAP_UserRole` rows.

The first blocks login; the second blocks the user's permissions without disabling the account.

### 10.5 "Force password change on next login"
1. `PUT /api/SecuritySettings/ResetPassword` with the new password. The controller sets `NeedsPasswordUpdate = true` along with the new password.
2. On next login, the Angular app sees `loggedInUser.NeedsPasswordUpdate == true` and forces the user through `ChangePassword`.

### 10.6 "Add a new login route (Angular)"
1. Add a row to `RBAC_RouteConfig` with `UrlFullPath = "Module/Entity"`, `DisplayName`, `ParentRouteId` (for the parent menu item), `PermissionId` (FK to a permission), `DefaultShow = true`, `IsActive = true`, `DisplaySeq`.
2. Add the route to your `module-routing.module.ts` with `canActivate: [AuthGuardService]`.
3. Add the menu item in your side-nav template, gated by `[rbac-permission]` if needed.
4. The next time the user logs in, the side-nav will include the new item (assuming they have the permission).
