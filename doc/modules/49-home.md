# Home Module

The Home module is the post-authentication shell of DanpheEMR. It owns the landing experience that wraps the Angular SPA, the server-side route hydration for the sidebar menu, the version banner, the user manual download, the app-init pipeline that boots every other module, and the change-password surface. It is a thin MVC layer over the Angular client: `HomeController` returns a view that contains `<my-app>`, the Angular `AppComponent` then drives the entire application by calling `Security` and `Core` APIs.

Source files studied:

| Layer | File | Lines |
|-------|------|-------|
| Controller | `Code/Websites/DanpheEMR/Controllers/HomeController.cs` | 81 |
| Razor view (Index) | `Code/Websites/DanpheEMR/Views/Home/Index.cshtml` | 122 |
| Razor view (AppMain) | `Code/Websites/DanpheEMR/Views/Home/AppMain.cshtml` | 295 |
| App configuration | `Code/Websites/DanpheEMR/Utilities/MyConfiguration.cs` | 40 |
| App component (TS) | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/app.component.ts` | 648 |
| App template | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/view/home-view/AppMain.html` | 366 |
| Home dashboard TS | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/dashboards/home/dashboard-home.component.ts` | 99 |
| Home dashboard HTML | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/dashboards/home/dashboard-home.html` | 125 |
| Core service | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/core/shared/core.service.ts` | 1700+ |
| Core BL service | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/core/shared/core.bl.service.ts` | 30+ |
| Core DL service | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/core/shared/core.dl.service.ts` | 80+ |
| Security controller | `Code/Websites/DanpheEMR/Controllers/Security/SecurityController.cs` | 992 |
| Security BL service | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/security/shared/security.bl.service.ts` | 70+ |
| Security DL service | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/security/shared/security.dl.service.ts` | 60+ |
| Security service | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/security/shared/security.service.ts` | 210+ |
| Auth guard | `Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/security/shared/auth-guard.service.ts` | 20+ |
| Common controller | `Code/Websites/DanpheEMR/Utilities/CommonController.cs` | 257 |
| RBAC engine | `Code/Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs` | 525 |
| RBAC models | `Code/Components/DanpheEMR.Security/RBAC/RbacUser.cs` | 42 |

---

## 1. Module Overview

### 1.1 Responsibilities

| Capability | Where it lives | Notes |
|------------|----------------|-------|
| Landing page render | `HomeController.Index` `HomeController.cs:28` | MVC view `Index.cshtml`, hosts the `<my-app>` Angular bootstrap |
| App shell render | `HomeController.AppMain` `HomeController.cs:43` | Server-side hydrates the sidebar route tree from RBAC into `ViewData["validroutes"]` |
| Change-password view | `HomeController.ChangePassword` `HomeController.cs:60` | Renders `Views/Home/ChangePassword.cshtml` (note: actual password change API lives on `AccountController.ChangePassword`) |
| User manual download | `HomeController.GetUserManual` `HomeController.cs:73` | Streams `wwwroot\\fileuploads\\DanpheEMR_UserManual.pdf` as `application/pdf` |
| App boot pipeline | `app.component.ts` constructor `app.component.ts:51-170` | Loads parameters, masters, lookups, valid routes, user permissions, app settings, active counters, hospital info, lab types, calendars, printer settings, memberships, payment configs, and the JWT in one place |
| JWT handoff to SPA | `app.component.ts:SetLoginTokenToLocalStorage` `app.component.ts:180` | Reads `loginToken` attribute from the `<my-app>` element (set by `Index.cshtml` from `TempData["loginJwtToken"]`) and stores it in `localStorage` under `ENUM_LocalStorageKeys.LoginTokenName` |
| App version banner | `AppMain.html:147` and `coreService.appVersionNum` | Displays the build version in a yellow header pill and inside the help dropdown |
| Landing page redirect | `AppComponent:GetLoggedInUserId` `app.component.ts:215-275` | Reads the user's `LandingPageRouteId` (set in `RbacUser.LandingPageRouteId`) and routes there on first login (using `sessionStorage["isLandingVisited"]` to make sure refreshes stay in the current page) |
| Home dashboard | `dashboard-home.component.ts` | Renders total patients, doctor count, today's appointments, and a department-wise appointment pie chart for the landing page |
| Sidebar / top nav state | `shared/navigation-service.ts` | `showTopNav` and `showSideNav` flags used to toggle header/sidebar visibility across modules |
| Cross-tab logout | `app.component.ts:135-139` | Listens to `storage` event for `logout-event` key and redirects to `/Account/Logout` on every tab |
| App-settings endpoint | `CoreController.AppSettings` `CoreController.cs:48` | Returns the safe subset of `MyConfiguration` to the SPA (version, lab highlight flag, cache expiry) |
| Date preference (AD/BS) | `AppComponent.SaveEmpPref` `app.component.ts:506` and `CoreController.EmployeeDatePreference` `CoreController.cs:58-145` | Reads/sets the user's per-user calendar preference (Nepali BS vs English AD) |
| Lookups endpoint | `CoreController.Lookups` `CoreController.cs:40` | Returns `LookupsModel` rows, optionally filtered by `inputValue` (module name) |
| Initial app routes endpoint | `SecurityController.ValidRoutes` `SecurityController.cs:53` | Returns the hierarchical menu of all routes the user can access, with `ChildRoutesDefaultShowCount` per parent |
| Logged-in user endpoint | `SecurityController.LoggedInUserInformation` `SecurityController.cs:33` | Returns the user, profile image location, default landing page, `LandingPageRouteId`, and `IsSysAdmin` flag |
| Active counters / inventory / hospital | `SecurityController` GET endpoints `SecurityController.cs:73-135` | Reads session-side active selections for billing counter, lab, pharmacy counter, dispensary, inventory store, and accounting hospital |
| Counter activation | `SecurityController` PUT endpoints `SecurityController.cs:406-500` | Sets/clears the same active selections in `HttpContext.Session` |

### 1.2 Post-Login Boot Flow

```
[AccountController.Login POST] --validates creds-->
[GenerateJwtToken] --TempData["loginJwtToken"]-->
[Redirect /Home/Index]
        |
        v
[Index.cshtml reads TempData, renders <my-app loginToken="...">]
        |
        v  (Angular AppComponent constructor)
[SetLoginTokenToLocalStorage] --localStorage[LoginTokenName] = token
        |
        v
[GetAllValidRouteList via /api/Security/ValidRoutes]
        |
        v
[SetValidNavigationRoute via /api/Security/NavigationRoutes] --sets securityService.UserNavigations-->
[GetLoggedInUserId via /api/Security/LoggedInUserInformation]
        |
        v
[Resolve LandingPageRouteId -> route.UrlFullPath]
        |  (first visit only: sessionStorage["isLandingVisited"] = true)
        v
[Router navigates to "/" or landing path]
        |
        +---> [coreService.InitializeParameters via master endpoints]
        +---> [coreService.GetMasterEntities]
        +---> [coreService.GetAllLookups via /api/Core/Lookups]
        +---> [SetValidUserPermissions via /api/Security/UserPermissions]
        +---> [coreService.InitializeAppSettings via /api/Core/AppSettings]  --sets coreService.appVersionNum
        +---> [GetActiveCounter via /api/Security/ActiveBillingCounter]
        +---> [GetActivePharmacyCounter via /api/Security/ActivePharmacyCounter]
        +---> [LoadAccountingHospitalInfo via /api/Security/ActiveAccountingHospitalInformation + /api/Security/InventeryHospitalInformation]
        +---> [GetLabTypes + GetActiveLab via /api/Security/ActiveLab]
        +---> [GetMunicipalities, GetGovLabItems, GetPrinterSettings, LoadAllMembershipTypes, GetPaymentModeSettings, GetPaymentModes, GetPaymentPages, GetMembershipTypeVsPriceCategoryMapping, GetSchemeList]
        |
        v
[AppMain.html renders sidebar from validRoutes, dashboard widgets call /Reporting/HomeDashboardStats + /Reporting/PatientZoneMap + /Reporting/DepartmentAppointmentsTotal]
```

### 1.3 Why `HomeController` Is Thin

`HomeController.cs:42` carries the historical comment:

```csharp
//move it out of patientcontroller to Maincontroller or something..
```

Today the controller is intentionally minimal: it only returns views. All dynamic data and actions live on `AccountController` (login/logout/JWT), `SecurityController` (logged-in user, routes, permissions, active selections), and `CoreController` (parameters, lookups, app settings, date preference). This keeps the home shell replaceable and the heavy data calls in dedicated, `CommonController`-derived API controllers.

---

## 2. Backend Files

### 2.1 `HomeController.cs` — Method Table

Source: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/HomeController.cs`

| # | Method | Line | Signature | Verb | Auth | Purpose |
|---|--------|------|-----------|------|------|---------|
| 1 | `Index` | 28 | `IActionResult Index()` | GET `/` and `/Home/Index` | implicit (session) | Returns `Views/Home/Index.cshtml`; redirects to `Account/Login` on exception (no session) |
| 2 | `AppMain` | 43 | `IActionResult AppMain()` | GET `/Home/AppMain` | implicit (session) | Loads `RbacUser` from session, sets `ViewData["currentuser"]`, calls `RBAC.GetRoutesForUser(userId, getHiearrchy: true)` into `ViewData["validroutes"]`; returns `Views/Home/AppMain.cshtml` |
| 3 | `ChangePassword` | 60 | `IActionResult ChangePassword()` | implicit GET (no `[HttpGet]`) | implicit | Renders `Views/Home/ChangePassword.cshtml`; note this is the page view, not the JSON API (the API is `AccountController.ChangePassword`) |
| 4 | `GetUserManual` | 73 | `FileStreamResult GetUserManual()` | implicit GET (no `[HttpGet]`) | implicit | Opens `wwwroot\\fileuploads\\DanpheEMR_UserManual.pdf` and streams it as `application/pdf`; the Angular `DownloadUserManual()` calls `/Home/GetUserManual` and saves the blob as `DanpheEMR-UserManual.pdf` |

The constructor (lines 22-26) injects `IOptions<MyConfiguration>` and assigns `Connectionstring` to a local `connString` field. None of the four actions use the field directly; it is kept for parity with the rest of the codebase and for any future DB-touching logic.

### 2.2 Razor Views

#### `Index.cshtml` — `Views/Home/Index.cshtml`

| Block | Lines | Purpose |
|-------|-------|---------|
| `<head>` stylesheets | 4-37 | Loads Danphe theme CSS, bootstrap, font-awesome, simple-line-icons, jqvmap, darkblue layout, dashboard styles, lightbox, grid, dropdown, fonts, ui, billing, dispensary styles |
| Loading splash | 80-104 | Renders a heart-rate SVG animation and `Connecting to Danphe app....` text inside `<my-app>` while Angular bootstraps |
| `<my-app loginToken="@token">` | 75 | Custom Angular element selector. `token` comes from `TempData["loginJwtToken"]` (set in `AccountController.Login` POST) |
| Production bundle scripts | 110-114 | Five script tags for `runtime.js`, `polyfills.js`, `styles.js`, `vendor.js`, `main.js` from the `/DanpheApp/dist/DanpheApp/` build output |

#### `AppMain.cshtml` — `Views/Home/AppMain.cshtml`

| Block | Lines | Purpose |
|-------|-------|---------|
| Page-header style | 13-86 | Sidebar menu custom styles (`.nav-schedule`, `.help-about`, `.ad-sign` plus/minus icons) |
| Top nav | 91-197 | Renders logo (`hospital-logo-landingpage.png`), patient info strip (name, hospital no, age/sex), notification icon (`<notification-icon>`), user dropdown (My Profile, Logout), help/about dropdown (Download user manual), and version tooltip |
| Sidebar | 206-273 | Iterates `validRoutes` (the RBAC route hierarchy filtered for `DefaultShow != false && IsActive == true`), renders each with an icon image, link, and child route sub-menu if `ChildRoutes` exists |
| Page content | 276-290 | `<danphe-loading>`, `<danphe-msgbox>`, `<router-outlet (activate)="onActivate($event)">` for Angular to mount the active route |

### 2.3 Configuration

`Utilities/MyConfiguration.cs`:

| Property | Type | Purpose |
|----------|------|---------|
| `Connectionstring` | string | Main EMR database |
| `ConnectionStringAdmin` | string | Admin DB (used for `CookieAuthInfoModel`, `LoginInformationModel`, `RbacDbContext` for user table) |
| `ConnectionStringPACSServer` | string | PACS server (DICOM viewer) |
| `CacheExpirationMinutes` | int | RBAC cache TTL (used in `DanpheRBAC`) |
| `FileStorageRelativeLocation` | string | Where uploaded files live (profile images, reports, etc.) |
| `highlightAbnormalLabResult` | bool | Flag for UI |
| `RealTimeRemoteSyncEnabled` | bool | Toggle for real-time sync |
| `ApplicationVersionNum` | string | The string displayed in the yellow version banner (read by `CoreController.AppSettings`) |
| `IsAuditEnable` | bool | Toggles `ChangedByUserId`/`ChangedByUserName` injection in `CommonController.AddAuditField` |
| `LISDataBaseUrl` | string | Laboratory Information System URL |
| `GoogleDriveFileUpload` | object | Service-account key, logger path, base path, URL |
| `JwtTokenConfig` | object | `JwtKey`, `JwtIssuer`, `JwtAudience`, `JwtValidMinutes` |
| `RealTimeSSFClaimBooking` | bool | SSF module toggle |

Only three fields are returned to the SPA from `CoreController.AppSettings()` (`CoreController.cs:96-101`): `ApplicationVersionNum`, `highlightAbnormalLabResult`, and `CacheExpirationMinutes`. The rest stay server-side.

---

## 3. Data Models

### 3.1 Session Payload

The Home module relies entirely on `HttpContext.Session` keys set by `AccountController.SetSessionVariable` and consumed by the SPA on bootstrap:

| Session key | Type | Set by | Read by |
|-------------|------|--------|---------|
| `currentuser` | `RbacUser` | `AccountController.SetSessionVariable` `AccountController.cs:387` | Every controller via `HttpContext.Session.Get<RbacUser>("currentuser")` |
| `validpermissionlist` | `List<RbacPermission>` | `AccountController.SetSessionVariable` `AccountController.cs:395` | Server-side permission checks |
| `user-roles` | `List<RbacRole>` | `AccountController.SetSessionVariable` `AccountController.cs:401` | Server-side role checks |
| `validRouteList` | `List<DanpheRoute>` | `SecurityController.NavigationRouteList` `SecurityController.cs:718` | Server-side route validation |
| `validallrouteList` | `List<DanpheRoute>` (filtered) | `SecurityController.AllValidRoutes` `SecurityController.cs:748` | Server-side route validation |
| `userAllPermissions` | `List<RbacPermission>` | `SecurityController.UserPermissions` `SecurityController.cs:767` | Server-side permission checks |
| `activeBillingCounter` | string (counter id) | `SecurityController.ActivateBillingCounter` `SecurityController.cs:874` | `ActiveBillingCounter` getter |
| `activePharmacyCounter` | string | `SecurityController.ActivatePharmacyCounter` `SecurityController.cs:880` | `ActivePharmacyCounter` getter |
| `activePharmacyCounterName` | string | `SecurityController.ActivatePharmacyCounter` `SecurityController.cs:881` | `ActivePharmacyCounter` getter |
| `activeLabId` | string | `SecurityController.ActivateLab` `SecurityController.cs:905` | `ActiveLab` getter |
| `activeLabName` | string | `SecurityController.ActivateLab` `SecurityController.cs:906` | `ActiveLab` getter |
| `activeInventoryId` | string | `SecurityController.ActivateInventory` `SecurityController.cs:920` | `ActiveInventory` getter |
| `activeDispensary` | string | `SecurityController.ActivateDispensary` `SecurityController.cs:889` | `ActiveDispencery` getter |
| `activeDispensaryName` | string | `SecurityController.ActivateDispensary` `SecurityController.cs:890` | `ActiveDispencery` getter |
| `AccSelectedHospitalInfo` | `AccHospitalInfoVM` | `SecurityController.ActivateAccountingHospital` `SecurityController.cs:985` | `ActiveAccountingHospitalInformation` getter |
| `AccSelectedHospitalId` | int | `SecurityController.ActivateAccountingHospital` `SecurityController.cs:986` | (internal) |
| `INVHospitalInfo` | `AccHospitalInfoVM` | `SecurityController.InventeryHospitalInformation` `SecurityController.cs:855` | `InventeryHospitalInformation` getter |

### 3.2 `RbacUser` (the session identity)

`Code/Components/DanpheEMR.Security/RBAC/RbacUser.cs`:

```csharp
public partial class RbacUser : ICloneable
{
    [Key]        public int           UserId               { get; set; }
    public        int                EmployeeId           { get; set; }
    public        string             UserName             { get; set; }
    public        string             Password             { get; set; }   // Triple-DES, never returned
    public        string             Email                { get; set; }
    public        int                CreatedBy            { get; set; }
    public        DateTime           CreatedOn            { get; set; }
    public        int?               ModifiedBy           { get; set; }
    public        DateTime?          ModifiedOn           { get; set; }
    public        List<RbacRole>     Roles                { get; set; }
    public        bool?              IsActive             { get; set; }
    public        bool?              NeedsPasswordUpdate  { get; set; }
    public        EmployeeModel      Employee             { get; set; }
    public        int?               LandingPageRouteId   { get; set; }   // Ajay 07Aug19 — home redirect
    public        object             Clone()              => this.MemberwiseClone();
}
```

The `LandingPageRouteId` field is the only Home-specific piece: when set, `AppComponent` finds the matching route in `UserNavigations` and navigates to its `UrlFullPath` on the first landing visit. `sessionStorage["isLandingVisited"]` and `localStorage["isLandingVisitedNewTab"]` track whether to redirect (refreshes and new tabs after the first visit stay in the current page).

### 3.3 `MyConfiguration` (the app config payload)

`Utilities/MyConfiguration.cs` — see section 2.3 table. The SPA only sees `ApplicationVersionNum`, `highlightAbnormalLabResult`, and `CacheExpirationMinutes` via `CoreController.AppSettings` (`CoreController.cs:96-101`).

### 3.4 Sidebar / Route Payload

Built lazily by `DanpheRBAC.GetRoutesForUser(userId, getHiearrchy: true)` (`DanpheRBAC.cs:124`). The full route list is cached in `RBAC-Routes-All`; the user-specific list joins on the user's permissions and only includes routes where `route.IsActive == true`. For hierarchy view, parent routes with `ParentRouteId == null && DefaultShow == true` are returned with a `ChildRoutes` list (recursively built by `GetChildRouteHierarchy`).

The SPA then calls `securityService.GetAllValidRoutes()` to apply an additional client-side filter (`DefaultShow != false && IsActive == true`) and computes `ChildRoutesDefaultShowCount` for the sidebar collapse UX.

---

## 4. Database Tables

The Home module itself does not own any schema. The tables it depends on are owned by the Account/Security (RBAC), Master (Employee), and Core (Parameters) modules:

| Table | Module that owns it | Used by Home for |
|-------|---------------------|------------------|
| `Danphe_Users` (RBAC) | Account/Security | `RbacUser` lookup, login, route filtering, `LandingPageRouteId` |
| `Danphe_Roles` (RBAC) | Account/Security | Role assignment, default route resolution (`defRole.DefaultRouteId`) |
| `Danphe_Permissions` (RBAC) | Account/Security | `RBAC.GetUserAllPermissions` |
| `Danphe_Routes` (RBAC) | Account/Security | Sidebar menu items, `UrlFullPath`, `Css` icon, `DisplayName`, `ParentRouteId`, `DefaultShow`, `IsActive` |
| `Danphe_UserRoleMaps` (RBAC) | Account/Security | User-to-role assignment |
| `Danphe_RolePermissionMaps` (RBAC) | Account/Security | Role-to-permission assignment |
| `Danphe_Applications` (RBAC) | Account/Security | Application scoping for permissions |
| `Danphe_Employees` (Master) | Employee | Profile image, employee details displayed in the user dropdown |
| `Danphe_EmployeePreferences` (Admission) | Core | User's `DatePreference` (AD/BS) — read by `CoreController.EmployeeDatePreference` GET, upserted by POST |
| `Danphe_CFG_Parameters` (Core) | Core | Loaded by `coreService.InitializeParameters`; `EnableEnglishCalendarOnly` (Common) drives default date preference; `showLoadingScreen` (Common) toggles loader behavior |
| `Danphe_CFG_LookUps` (Core) | Core | Loaded by `coreService.GetAllLookups`; filtered by `ModuleName` on demand |
| `Danphe_CookieAuthInfo` (SysAdmin) | Account | Remember-me selector + hashed validator (consumed on subsequent visits) |
| `Danphe_LogInInformation` (SysAdmin) | Account | `LoginInformationModel` for `login`, `invalid-login-attempt`, `logout` audit trail |
| `Danphe_PHRM_Store` (Pharmacy) | Pharmacy | Active pharmacy counter / dispensary |
| `PHRM_MST_Counter` (Pharmacy) | Pharmacy | Active pharmacy counter |
| `LAB_LabTypes` (Lab) | Lab | `coreService.GetLabTypes`; auto-selects the user's only lab type if they have one |
| `TB_Lab_LabCategory` / `TB_Inv_Category` (Lab/Inventory) | Lab/Inventory | Government test items (`coreService.GetAllGovLabComponents`) |
| `MST_Municipality` (Master) | Master | `coreService.GetAllMunicipalities` |
| `ACC_MST_Hospital` (Accounting) | Accounting | `ActiveAccountingHospitalInformation`, hospital long/short names |
| `ACC_MST_FiscalYear` (Accounting) | Accounting | Active hospital fiscal years list |
| `ACC_MST_Section` (Accounting) | Accounting | Sections for active hospital |
| `BIL_MST_Counter` (Billing) | Billing | `MasterType.BillingCounter` cache warm |
| `BIL_CFG_MembershipType` (Billing) | Billing | `coreService.AllMembershipTypes` |

---

## 5. Key Workflows

### 5.1 App Boot Workflow

Triggered by visiting `/` (or `/Home/Index`) after a successful login. The Index view bootstraps the Angular SPA, which then calls a fan-out of APIs to populate the app shell.

1. **JWT handoff** — `Index.cshtml:69-75` reads `TempData["loginJwtToken"]` and emits it as the `loginToken` attribute on `<my-app>`. The SPA reads it with `elementRef.nativeElement.getAttribute('loginToken')` and writes it to `localStorage[ENUM_LocalStorageKeys.LoginTokenName]` (`app.component.ts:180-183`). The DOM attribute is then cleared to prevent token leakage in the page source.
2. **Master cache warmup** — `DanpheCache.GetData(MasterType.Country, null)`, `SubDivision`, `BillingCounter`, `PhrmCounter`, `Employee` are called immediately in the constructor (`app.component.ts:67-72`) to populate in-memory caches.
3. **Valid routes** — `GetAllValidRouteList` calls `/api/Security/ValidRoutes` (`app.component.ts:317-331`). Result is stored in `securityService.validRouteList` and the hierarchical version is built by `securityService.GetAllValidRoutes()` and assigned to `this.validRoutes`.
4. **Navigation routes (flat list)** — `SetValidNavigationRoute` calls `/api/Security/NavigationRoutes` (`app.component.ts:347-361`). Result is stored in `securityService.UserNavigations`; the next call to `GetLoggedInUserId` uses this list to resolve the `LandingPageRouteId`.
5. **User info + landing redirect** — `GetLoggedInUserId` calls `/api/Security/LoggedInUserInformation` (`app.component.ts:215-275`). It populates `currentUsr`, sets `employeeService.ProfilePicSrcPath`, and (if `NeedsPasswordUpdate`) routes to `/Employee/ProfileMain/ChangePassword`. If `LandingPageRouteId` is set and not already visited in this session, it routes to the corresponding `UrlFullPath`; otherwise it stays at `/`.
6. **Permissions** — `SetValidUserPermissions` calls `/api/Security/UserPermissions` (`app.component.ts:369-388`). Result goes into `securityService.UserPermissions`. On failure, it redirects to `/Account/Logout`.
7. **Parameters** — `coreService.InitializeParameters` (`app.component.ts:78-80`) loads all `Danphe_CFG_Parameters` rows. `CallBackLoadParameters` (`app.component.ts:391-418`) calls `SetTaxLabel`, `SetCurrencyUnit`, `SetCalendarADBSButton`, `SetLocalNameFormControl`, `SetCountryMapOnLandingPage`, `setLoadingScreenVal`, and `CheckForEnglishCalendarParameterAndSetDefaultPreference`.
8. **Masters** — `coreService.GetMasterEntities` populates `ServiceDepartments`, `PriceCategories`, `Taxes`, `Departments`, `UniqueDataList`, `ICD10List` (`app.component.ts:83-85`).
9. **Lookups** — `coreService.GetAllLookups` populates `coreService.LookUps` (`app.component.ts:88-90`).
10. **App settings + version** — `coreService.InitializeAppSettings` calls `/api/Core/AppSettings`; `coreService.SetAppVersionNum` sets `appVersionNum` (`app.component.ts:100-105`, `core.service.ts:1483-1498`). The version is shown in the yellow banner and in the help/about tooltip.
11. **Active counters** — `GetActiveCounter`, `GetActivePharmacyCounter`, `LoadAccountingHospitalInfo` (`app.component.ts:108-114, 526-544`) hydrate session-side active selections.
12. **Lab types + active lab** — `coreService.GetLabTypes` loads the lab list; `GetActiveLab` checks if one is already active in the session, otherwise auto-selects the only one the user has permission for (`app.component.ts:122-128, 550-605`).
13. **Misc cache loads** — municipalities, government lab items, QZ tray config, printer settings, memberships, payment modes, payment pages, scheme lists, etc. (`app.component.ts:131-170`).
14. **Date preference** — `coreService.getCalenderDatePreference` reads `/api/Core/EmployeeDatePreference`; if `EnableEnglishCalendarOnly` is on, it forces English AD and saves the preference (`app.component.ts:142-152, 420-436`).
15. **Dashboard data** — once the route resolves to `DashboardHomeComponent`, three calls fire: `/Reporting/HomeDashboardStats` for KPI cards, `/Reporting/PatientZoneMap` for the country map, `/Reporting/DepartmentAppointmentsTotal` for the pie chart (`dashboard-home.component.ts:32-97`).

### 5.2 Landing Page Redirect (per user)

1. Each `RbacUser` has an optional `LandingPageRouteId` (set via the Employee profile or RBAC admin).
2. After `SetValidNavigationRoute` returns the flat route list, `GetLoggedInUserId` resolves the route:
   ```typescript
   if (res.Results.LandingPageRouteId != null) {
     var path = this.securityService.UserNavigations.find(a => a.RouteId == res.Results.LandingPageRouteId);
     var check = sessionStorage.getItem("isLandingVisited");
     var isLandingVisitedNewTab = localStorage.getItem("isLandingVisitedNewTab");

     if (check != "true" && isLandingVisitedNewTab != "true") {
       if (path) {
         sessionStorage.setItem("isLandingVisited", "true");
         localStorage.setItem('isLandingVisitedNewTab', "true");
         this.router.navigate(['/' + path.UrlFullPath]);
       } else {
         this.router.navigate(['/']);
       }
     }
   }
   ```
   (`app.component.ts:252-267`)
3. On logout, both flags are cleared so the next login redirects again (`app.component.ts:461-462`).

### 5.3 Sidebar Hydration Workflow

1. `HomeController.AppMain` (`HomeController.cs:43-59`) reads `RbacUser` from session.
2. `RBAC.GetRoutesForUser(currentUser.UserId, getHiearrchy: true)` is called (`HomeController.cs:50`).
3. `DanpheRBAC.GetRoutesForUser` (`DanpheRBAC.cs:124-151`):
   - Pulls `RbacPermission` list for the user (cached or joined from user→role→rolepermission→permission).
   - Joins to all routes, filters `IsActive == true`, distinct, ordered by `DisplaySeq`.
   - For hierarchy, returns only routes with `ParentRouteId == null && DefaultShow == true`, recursively attaching `ChildRoutes` via `GetChildRouteHierarchy`.
4. `AppMain.cshtml:10` applies the final `DefaultShow != false && IsActive == true` filter before rendering.
5. The Razor view iterates parent routes, renders icon, link, and child sub-menu with the plus/minus `ad-sign` toggle.

### 5.4 User Manual Download Workflow

1. User clicks "Download user manual" in the help dropdown (`AppMain.html:214-219`).
2. `AppComponent.DownloadUserManual` (`app.component.ts:438-452`) calls `dlService.ReadExcel("/Home/GetUserManual")` (which uses the `ReadExcel` HttpClient method to fetch as a blob).
3. `HomeController.GetUserManual` (`HomeController.cs:73-77`) opens `wwwroot\\fileuploads\\DanpheEMR_UserManual.pdf` as a `FileStream` and returns it as `FileStreamResult` with content type `application/pdf`.
4. The client creates an `<a>` element, sets `href` to a blob URL, sets `download="DanpheEMR-UserManual.pdf"`, clicks it, and the browser saves the file.

### 5.5 Cross-Tab Logout Workflow

1. User clicks "Log Out" in the user dropdown.
2. `AppComponent.LogoutFromAplication` (`app.component.ts:454-469`):
   - Removes `localStorage[LoginTokenName]`.
   - Clears `sessionStorage["isLandingVisited"]`, `localStorage["isLandingVisitedNewTab"]`, `localStorage["selectedLabCategory"]`.
   - Sets `localStorage["logout-event"]` to a random value (the random value is the trick that makes the `storage` event fire — same key with same value does not).
   - Redirects to `/Account/Logout`.
3. `AppComponent` constructor registered a `window.addEventListener('storage', ...)` (`app.component.ts:135-139`) so every other tab picks up the event and also redirects to `/Account/Logout`.

### 5.6 Date Preference Workflow

1. App boots, `coreService.getCalenderDatePreference()` (`app.component.ts:142`) calls `/api/Core/EmployeeDatePreference` (GET) to read the user's `DatePreference` row from `Danphe_EmployeePreferences`.
2. If `EnableEnglishCalendarOnly` (Common parameter) is true (`app.component.ts:420-436`), the user is forced to English AD and the preference is persisted via `SaveEmpPref` (`POST /api/Core/EmployeeDatePreference`).
3. From the user dropdown, "Date: ... (edit)" opens the popup (`app.component.ts:472-489`) which lets the user switch between AD/BS checkboxes. The change is applied immediately; clicking Save persists it.

### 5.7 Active Counter / Lab / Hospital Workflow

Each follows the same pattern (example: billing counter):

1. User activates a counter in the Billing module UI, which calls `PUT /api/Security/ActivateBillingCounter?counterId=...`.
2. `SecurityController.ActivateBillingCounter` writes the value to `HttpContext.Session["activeBillingCounter"]` (`SecurityController.cs:872-876`).
3. On every subsequent page load, `GET /api/Security/ActiveBillingCounter` returns the value from session so the client knows which counter the user is on.
4. The same pattern applies to `ActivatePharmacyCounter`, `ActivateDispensary`, `ActivateLab`, `ActivateInventory`, `ActivateAccountingHospital`. The corresponding `Deactivate*` PUT endpoints remove the session keys.

### 5.8 License-Gated Boot (Account side, observed on Home)

Although the check is in `AccountController.Login` (`AccountController.cs:88-125`), the Home module is the beneficiary:

1. On `GET /Account/Login`, the license parameter `TenantMgnt/SoftwareLicense` is read, decrypted, and parsed for `StartDate`, `EndDate`, `ExpiryNoticeDays`.
2. If `EndDate < now`, redirect to `/Account/LicenseExpired`.
3. If `remainingDays < expiryNoticeDays`, the login page shows "Notice ! Your Software License is expiring in N days." via `ViewData["ExpiryNotice"]`.
4. The Home app does not re-check the license — it assumes the user is already past the gate.

### 5.9 Change Password (Home side, Account does the work)

1. `HomeController.ChangePassword` (`HomeController.cs:60-70`) returns the Razor view.
2. The Angular `Employee/ProfileMain/ChangePassword` page posts to the JSON body endpoint on `AccountController.ChangePassword` (`AccountController.cs:335-371`).
3. `RBAC.UpdateDefaultPasswordOfUser` validates the old password, encrypts the new one, sets `NeedsPasswordUpdate = false`, and writes back to `RbacDbContext`.
4. The session's `RbacUser.NeedsPasswordUpdate` is also updated so the bootstrap check (`app.component.ts:235-237`) does not loop back into the change-password page.

---

## 6. API Endpoints

The Home module itself exposes 4 endpoints on `HomeController`, but the post-login app shell relies on a wider surface area across `HomeController`, `SecurityController`, and `CoreController`. All are documented below.

### 6.1 HomeController endpoints

| # | Method | Path | Auth | Body / Query | Returns | Notes |
|---|--------|------|------|--------------|---------|-------|
| 1 | GET | `/` and `/Home/Index` | session | — | Razor view `Index.cshtml` | Hosts `<my-app loginToken="...">`. On exception redirects to `/Account/Login` |
| 2 | GET | `/Home/AppMain` | session | — | Razor view `AppMain.cshtml` with `ViewData["validroutes"]` and `ViewData["currentuser"]` | Server-side renders sidebar from RBAC |
| 3 | GET | `/Home/ChangePassword` | session | — | Razor view `ChangePassword.cshtml` | Page only; JSON API is on AccountController |
| 4 | GET | `/Home/GetUserManual` | session | — | `FileStreamResult` `application/pdf` | Streams `wwwroot\\fileuploads\\DanpheEMR_UserManual.pdf` |

### 6.2 SecurityController endpoints (Home depends on these)

`Code/Websites/DanpheEMR/Controllers/Security/SecurityController.cs`

| # | Method | Path | Line | Auth | Returns | Notes |
|---|--------|------|------|------|---------|-------|
| 5 | GET | `/api/Security/LoggedInUserInformation` | 33 | session | `UserId`, `UserName`, `EmployeeId`, `Profile.ImageLocation`, `NeedsPasswordUpdate`, `DefaultPagePath`, `Employee`, `LandingPageRouteId`, `IsSysAdmin` | Drives `AppComponent.GetLoggedInUserId` |
| 6 | GET | `/api/Security/NavigationRoutes` | 43 | session | Flat `List<DanpheRoute>` (no hierarchy, includes `DefaultShow = false`) | Stored in `securityService.UserNavigations`; used to resolve `LandingPageRouteId` |
| 7 | GET | `/api/Security/ValidRoutes` | 53 | session | Hierarchical `List<DanpheRoute>` filtered to `DefaultShow != false && IsActive == true`, with `ChildRoutesDefaultShowCount` per parent | Drives the sidebar |
| 8 | GET | `/api/Security/UserPermissions` | 63 | session | `List<RbacPermission>` for the current user | Drives client-side permission gates; on failure redirects to logout |
| 9 | GET | `/api/Security/ActiveBillingCounter` | 73 | session | int (counter id) | Read from `Session["activeBillingCounter"]` |
| 10 | GET | `/api/Security/ActiveLab` | 81 | session | `{ LabTypeId, LabTypeName }` | Read from session |
| 11 | GET | `/api/Security/ActiveInventory` | 90 | session | `{ StoreId }` | Read from session |
| 12 | GET | `/api/Security/ActivePharmacyCounter` | 99 | session | `{ CounterId, CounterName }` | Read from session |
| 13 | GET | `/api/Security/ActiveAccountingHospitalInformation` | 107 | session | `AccHospitalInfoVM` | Read from `Session["AccSelectedHospitalInfo"]` |
| 14 | GET | `/api/Security/InventeryHospitalInformation` | 119 | session | `AccHospitalInfoVM` with `TodaysDate`, `FiscalYearList`, `CurrFiscalYear` | Lazily built from `InventoryDbContext.InventoryFiscalYears` and cached in `Session["INVHospitalInfo"]` |
| 15 | GET | `/api/Security/ActiveDispensary` | 129 | session | `{ StoreId, Name }` | Read from session |
| 16 | PUT | `/api/Security/ActivateBillingCounter?counterId=...` | 407 | session | counter id | Writes `Session["activeBillingCounter"]` |
| 17 | PUT | `/api/Security/ActivatePharmacyCounter?counterId=...&counterName=...` | 416 | session | `{ CounterId, CounterName }` | Writes session |
| 18 | PUT | `/api/Security/ActivateDispensary?dispensaryId=...&dispensaryName=...` | 426 | session | `{ StoreId, Name }` | Writes session |
| 19 | PUT | `/api/Security/DeactivateDispensary` | 434 | session | 200 OK | Clears session |
| 20 | PUT | `/api/Security/ActivateLab?labId=...&labName=...` | 442 | session | `{ LabTypeId, LabTypeName }` | Writes session |
| 21 | PUT | `/api/Security/DeactivateBillingCounter` | 450 | session | 200 OK | Clears session |
| 22 | PUT | `/api/Security/ActivateInventory?InventoryId=...` | 459 | session | `{ StoreId }` | Writes session |
| 23 | PUT | `/api/Security/DeactivateInventory` | 469 | session | 200 OK | Clears session |
| 24 | PUT | `/api/Security/DeactivatePharmacyCounter` | 478 | session | 200 OK | Clears session |
| 25 | PUT | `/api/Security/DeactivateLab` | 486 | session | 200 OK | Clears session |
| 26 | PUT | `/api/Security/ActivateAccountingHospital?hospitalId=...` | 494 | session | `AccHospitalInfoVM` with sections, fiscal year list, current fiscal year, hospital long/short names | Writes `Session["AccSelectedHospitalInfo"]` and `Session["AccSelectedHospitalId"]` |

### 6.3 CoreController endpoints (Home depends on these)

`Code/Websites/DanpheEMR/Controllers/Core/CoreController.cs`

| # | Method | Path | Line | Auth | Returns | Notes |
|---|--------|------|------|------|---------|-------|
| 27 | GET | `/api/Core/Lookups?inputValue=moduleName` | 40 | session | `List<LookupsModel>` filtered by `ModuleName` (case-insensitive) | Empty `inputValue` returns all lookups |
| 28 | GET | `/api/Core/AppSettings` | 48 | session | Safe `MyConfiguration` subset: `ApplicationVersionNum`, `highlightAbnormalLabResult`, `CacheExpirationMinutes` | Connection strings and other secrets are NOT returned |
| 29 | GET | `/api/Core/EmployeeDatePreference` | 58 | session | `EmployeePreferences` row (or null) where `PreferenceName = "DatePreference"` for the current user | Drives AD/BS default |
| 30 | POST | `/api/Core/EmployeeDatePreference` | 67 | session | Updated `EmployeePreferences` row | Body is the new `PreferenceValue` string; inserts if not exists, updates if exists |
| 31 | GET | `/DanpheApp/dist/DanpheApp/main.js` (and `runtime.js`, `polyfills.js`, `styles.js`, `vendor.js`) | anonymous | — | Angular bundle | Referenced in `Index.cshtml:110-114` |

### 6.4 Reporting endpoints used by the home dashboard

`dashboard-home.component.ts` calls three reporting endpoints. They live on the Reporting controller, not Home, but they are the source of the dashboard KPIs.

| # | Method | Path | Used for |
|---|--------|------|----------|
| 32 | GET | `/Reporting/HomeDashboardStats` | KPIs: `TotalPatient`, `TodayPatient`, `YestardayPatient`, `TotalDoctorsCount`, `ConsultantsCount`, `MedicalOfficersCount`, `AnaesthetistsCount`, `NewAppts`, `FollowUpAppts`, `ReferralAppts`, `TotalAppts`, `CancelAppts`, `ReturnAppts` |
| 33 | GET | `/Reporting/PatientZoneMap` | Patient distribution by zone (Nepal province codes) rendered as a country choropleth |
| 34 | GET | `/Reporting/DepartmentAppointmentsTotal` | Department-wise appointment count for the current date, rendered as a pie chart |

### 6.5 Angular client-side service surface (used by the home boot)

| Service / file | Method | Calls (server endpoint) | Purpose |
|----------------|--------|-------------------------|---------|
| `CoreService.InitializeParameters` | `core.service.ts:117` | `coreBlService.GetParametersList()` → `/api/Core/...?reqType=get-parameters` (or `/api/Core/Lookups` historically) | Loads all `Danphe_CFG_Parameters` rows |
| `CoreService.GetAllLookups` | `core.service.ts:141` | `coreBlService.GetLookups()` → `/api/Core/Lookups` | Populates `coreService.LookUps` |
| `CoreService.GetMasterEntities` | `core.service.ts:125` | `coreBlService.GetMasterEntities()` → `/api/Master/Common` (or equivalent) | Populates `ServiceDepartments`, `PriceCategories`, `Taxes`, `Departments`, etc. |
| `CoreService.InitializeAppSettings` | `core.service.ts:1479` | `coreBlService.GetAppSettings()` → `/api/Core/AppSettings` | Sets `appVersionNum` and friends |
| `CoreService.getCalenderDatePreference` | `core.dl.service.ts:71` | `/api/Core/EmployeeDatePreference` | Reads user AD/BS preference |
| `SecurityBLService.GetLoggedInUserInformation` | `security.bl.service.ts:13` | `/api/Security/LoggedInUserInformation` | Loads `currentUsr`, redirects to landing |
| `SecurityBLService.GetValidNavigationRouteList` | `security.bl.service.ts:20` | `/api/Security/NavigationRoutes` | Populates `securityService.UserNavigations` |
| `SecurityBLService.GetValidUserPermissionList` | `security.bl.service.ts:27` | `/api/Security/UserPermissions` | Populates `securityService.UserPermissions` |
| `SecurityBLService.GetActiveBillingCounter` | `security.bl.service.ts:30` | `/api/Security/ActiveBillingCounter` | Restores session counter |
| `SecurityBLService.GetActiveLab` | `security.bl.service.ts:36` | `/api/Security/ActiveLab` | Restores session lab |
| `SecurityBLService.GetActivePharmacyCounter` | `security.bl.service.ts:39` | `/api/Security/ActivePharmacyCounter` | Restores session pharmacy counter |
| `SecurityBLService.GetAllValidRouteList` | `security.bl.service.ts:43` | `/api/Security/ValidRoutes` | Hierarchical sidebar menu |
| `SecurityDLService.GetAccountingHopitalInfo` | `security.dl.service.ts:46` | `/api/Security/ActiveAccountingHospitalInformation` | Active accounting hospital |
| `SecurityDLService.GetInventeryHospitalInfo` | `security.dl.service.ts:50` | `/api/Security/InventeryHospitalInformation` | Inventory fiscal year + today |
| `SecurityDLService.ActivateLab` | `security.dl.service.ts:54` | `PUT /api/Security/ActivateLab?labId=...&labName=...` | Persist active lab selection |
| `DLService.ReadExcel` | `dl.service.ts` | `GET /Home/GetUserManual` | Downloads `DanpheEMR-UserManual.pdf` |
| `DLService.Add` | `dl.service.ts` | `POST /api/Core/EmployeeDatePreference` | Persist AD/BS choice |

---

## 7. Cross-Module Integration

The Home module is the only module every other module touches, because it owns the landing shell and the sidebar. Concretely it integrates with:

| Module | How Home depends on it |
|--------|------------------------|
| Account (01) | `AccountController.Login` POST issues the JWT that `Index.cshtml` hands to `<my-app>`. `AccountController.SetSessionVariable` populates `currentuser`, `validpermissionlist`, `user-roles` in session. `AccountController.Logout` is the redirect target of `LogoutFromAplication`. `AccountController.ChangePassword` is the actual JSON endpoint for the page rendered by `HomeController.ChangePassword`. |
| Security (39) | Sidebar hydration (`SecurityController.GetRoutesForUser`), logged-in user info (`LoggedInUserInformation`), per-user permissions (`UserPermissions`), per-tab active selections for billing counter, pharmacy counter, dispensary, lab, inventory, accounting hospital. |
| Core (07) | `AppSettings` (version banner), `Lookups` (master data), `EmployeeDatePreference` (AD/BS), `InitializeParameters` (`CFG_Parameters` like `EnableEnglishCalendarOnly`, `showLoadingScreen`, `TaxInfo`, `Currency`). |
| Master (24) | `Danphe_Employees` for profile image and `employeeService.ProfilePicSrcPath`. `MST_Municipality` for the patient registration sub-division control. `BIL_MST_Counter` and `PHRM_MST_Counter` for the active counter selectors. |
| Employee (16) | `Employee/ProfileMain/ChangePassword` is the SPA route the bootstrap redirects to when `NeedsPasswordUpdate = true`. `EmployeeService.ProfilePicSrcPath` is set from the user info response. |
| Reporting (43) | Three endpoints feed the home dashboard KPIs and the country/pie charts. |
| Pharmacy (34) | Active pharmacy counter / dispensary; `Danphe_PHRM_Store` and `PHRM_MST_Counter` are session-keyed. |
| Lab (22) | `coreService.GetLabTypes`, `GetAllGovLabComponents`, active lab session key, and `LAB_LabTypes` lookups. |
| Accounting (02) | `ActiveAccountingHospitalInformation` returns the currently selected accounting hospital with sections, fiscal years, hospital long/short names. `ActivateAccountingHospital` is called from the Accounting module on hospital switch. |
| Inventory (21) | `InventeryHospitalInformation` returns inventory fiscal year info used by the inventory module. `ActiveInventory` / `ActivateInventory` / `DeactivateInventory` manage the active inventory store. |
| Billing (05) | `MasterType.BillingCounter` cache warm, `BIL_MST_Counter` for the active billing counter, and `LoadAllMembershipTypes` for membership-driven billing. |
| Notification (28) | `<notification-icon>` Angular component in the top nav (`AppMain.cshtml:136-139`). |
| Settings (40) | `Danphe_CFG_Parameters` (Common, Printers, Lab, Radiology, ADT, Billing, Accounting groups) and `Danphe_CFG_LookUps` are loaded on app boot. |
| Patient (32) | `PatientService.globalPatient` is shown in the patient info strip in the top nav (`AppMain.html:91-135`). |
| System Admin (37) | `Danphe_CookieAuthInfo` and `Danphe_LogInInformation` tables live here; license parameter `TenantMgnt/SoftwareLicense` is read in `AccountController.Login`. |
| Process Confirmation (50) | `ProcessConfirmationController.ConfirmProcess` (`POST /api/ProcessConfirmation/ConfirmProcess`) is called by sensitive flows (e.g. high-value billing) to require credential re-entry. It is registered globally so any module can ask for re-auth. |
| Utilities (44) | `CommonController` base class with `InvokeHttpGetFunction` / `InvokeHttpPutFunction` / `AddAuditField` / `CreateEmpi` is inherited by every API controller. `MyConfiguration` is the configuration record. |
| Action Filter (51) | `[DanpheDataFilter()]` and `[RequestFormSizeLimit]` attributes from this module are applied to the base `CommonController`, so every `CommonController`-derived controller (including `SecurityController` and `CoreController`) is automatically wrapped. |

---

## 8. Business Rules

| # | Rule | Where it lives | Effect |
|---|------|----------------|--------|
| 1 | All `CommonController`-derived API controllers require a session `RbacUser` (implicit authentication); unauthenticated requests fail | `CommonController.cs:17-20` | SPA redirects to `/Account/Login` on 401 |
| 2 | `AppSettings` only returns a safe subset of `MyConfiguration` (no connection strings, no JWT key) | `CoreController.cs:96-101` | Secret-leakage prevention |
| 3 | `LandingPageRouteId` is honored only on the first visit per session AND per new tab; refreshes stay where the user is | `app.component.ts:252-267, 461-462` | Predictable UX: landing once, then free navigation |
| 4 | Cross-tab logout uses a random value for `localStorage["logout-event"]` so the `storage` event fires | `app.component.ts:463-465` | The browser only emits `storage` when the value actually changes |
| 5 | The user's `DatePreference` is forced to English AD when `Common/EnableEnglishCalendarOnly` is true | `app.component.ts:420-436` | Hospital-wide policy overrides individual preference |
| 6 | The `RbacUser` session payload is cloned before being returned from `RBAC.GetUser(...)` so callers cannot mutate the cache | `DanpheRBAC.cs:180-203` | Prevents accidental state mutation through shared references |
| 7 | RBAC permission, role, route, user, and application lists are cached in `DanpheCache` for `CacheExpirationMinutes` | `DanpheRBAC.cs:33-121` | Reduces DB load on every controller instantiation |
| 8 | `GetRoutesForUser(..., getHiearrchy: true)` returns parent routes with `ParentRouteId == null && DefaultShow == true` only; child routes are recursively attached but their own `DefaultShow` filter is applied later in the Razor view and again in the SPA | `DanpheRBAC.cs:138-145`; `AppMain.cshtml:10`; `securityService.GetAllValidRoutes` | Three-stage filter keeps menus tidy |
| 9 | The `activeBillingCounter`, `activePharmacyCounter`, `activeDispensary`, `activeLabId`, `activeInventoryId`, `AccSelectedHospitalInfo` session keys are per-tab (HTTP session is per-browser) and not per-user | `SecurityController.cs:872-987` | A user can use different counters in different browser tabs |
| 10 | `UserManual` PDF is loaded from the `wwwroot\\fileuploads\\` directory of the deployed app; the file is read-only at runtime | `HomeController.cs:73-77` | Replace the PDF to update the manual; no DB write |
| 11 | `AppComponent` re-fetches the version on every page load, but only displays it after `coreService.appVersionNum` is set | `app.component.ts:100-105, 438-452`; `core.service.ts:1483-1498` | Version banner appears after the AppSettings call resolves |
| 12 | The app's loading spinner is controlled by `Common/showLoadingScreen` parameter | `app.component.ts:186-197` | Hospitals can disable the global HTTP loading screen |
| 13 | On every route change, `ngAfterViewChecked` calls `changeDetector.detectChanges()` to keep the version pill and other bindings in sync | `app.component.ts:176-178` | Avoids ExpressionChangedAfterItHasBeenCheckedError |
| 14 | The Angular `<router-outlet (activate)="onActivate($event)">` is bound to scroll-to-top on activation | `app.component.ts:277-287` | New routes start at the top of the page |
| 15 | Session keys are cleared with `HttpContext.Session.Clear()` on logout, which removes every key the app might have set | `AccountController.cs:465-476` | No leftover state between logins |
| 16 | `CookieAuthInfo` is shared between `uRef` (selector) and `uData` (validator), both stored for 2 years; the validator is rotated on every auto-login | `AccountController.cs:413-522` | Limits the validity window of a stolen cookie |
| 17 | `RbacUser` exposes `ICloneable.Clone()` returning a shallow `MemberwiseClone()`; navigation properties like `Employee` are shared between clones | `RbacUser.cs:32-35` | Acceptable because the cloned user is stored in session and not mutated by reference elsewhere |
| 18 | `LandingPageRouteId` is the `RouteId` of an entry in `Danphe_Routes`; resolution falls back to `/` if the route is not present in `UserNavigations` | `app.component.ts:258-266` | Defensive default: missing route id never crashes the app |
| 19 | `TempData["loginJwtToken"]` is read once in `Index.cshtml:69` and re-kept via `TempData.Keep("loginJwtToken")` so the SPA can also read it after the first render | `Index.cshtml:68-71` | Lets the SPA do its own JWT bootstrap without depending on the SPA's localStorage alone |
| 20 | `AppComponent` constructor also listens for `logout-event` so a logout from one tab propagates instantly to all other tabs of the same browser | `app.component.ts:135-139` | No stale-session UIs across tabs |

---

## 9. Angular Component Surface (AppComponent public methods)

`app.component.ts` exposes the following methods that the template (`AppMain.html`) and child components rely on:

| # | Method | Line | Used by template / other components |
|---|--------|------|-------------------------------------|
| 1 | `constructor` | 51 | AppComponent instantiation; runs the entire app-boot pipeline |
| 2 | `ngAfterViewChecked` | 176 | Change detection sync for version pill |
| 3 | `SetLoginTokenToLocalStorage` | 180 | Once at construction; reads `<my-app loginToken="...">` |
| 4 | `setLoadingScreenVal` | 186 | Toggle HTTP loading screen by parameter |
| 5 | `navigationInterceptor` | 199 | Router events; shows/hides the loading spinner |
| 6 | `GetLoggedInUserId` | 215 | Called from `SetValidNavigationRoute` success path |
| 7 | `onActivate` | 277 | Bound to `<router-outlet (activate)>`; scrolls to top |
| 8 | `GetActiveCounter` | 290 | Restores billing counter |
| 9 | `GetAllValidRouteList` | 317 | Hydrates sidebar |
| 10 | `GetActivePharmacyCounter` | 332 | Restores pharmacy counter |
| 11 | `SetValidNavigationRoute` | 347 | Hydrates flat route list + landing redirect |
| 12 | `SetValidUserPermissions` | 369 | Hydrates user permissions |
| 13 | `CallBackLoadParameters` | 391 | Triggered by `coreService.InitializeParameters` |
| 14 | `CheckForEnglishCalendarParameterAndSetDefaultPreference` | 420 | Triggered inside `CallBackLoadParameters` |
| 15 | `DownloadUserManual` | 438 | Bound to "Download user manual" menu item |
| 16 | `LogoutFromAplication` | 454 | Bound to "Log Out" menu item |
| 17 | `openShowDatePreference` / `Close` | 472-476 | Date preference popup |
| 18 | `ChangeDatePreference` | 478 | Checkbox click in date popup |
| 19 | `DatePreferenceData` | 489 | Apply AD/BS to the running app |
| 20 | `SaveEmpPref` | 506 | Persist the AD/BS choice via `POST /api/Core/EmployeeDatePreference` |
| 21 | `LoadAccountingHospitalInfo` | 526 | Called at construction |
| 22 | `CheckLabPermissions` | 550 | Auto-selects the user's only lab type |
| 23 | `GetActiveLab` | 570 | Restores active lab from session |
| 24 | `ActivateLab` | 596 | Persists a new active lab |
| 25 | `GetMunicipalities` | 607 | Calls `coreService.GetAllMunicipalities` |
| 26 | `GetGovLabItems` | 611 | Calls `coreService.GetAllGovLabComponents` |
| 27 | `LoadAllMembershipTypes` | 616 | Called at construction |
| 28 | `GetPrintExportConfiguration` | 625 | Called at construction |
| 29 | `GetPaymentModeSettings` | 629 | Called at construction |
| 30 | `GetPaymentModes` | 633 | Called at construction |
| 31 | `GetPaymentPages` | 637 | Called at construction |
| 32 | `GetMembershipTypeVsPriceCategoryMapping` | 641 | Called at construction |
| 33 | `GetSchemeList` | 645 | Called at construction |

`dashboard-home.component.ts` is a separate component for the `/Dashboard` route. It exposes `LoadDsbStatistics`, `LoadPatientMap`, and `LoadDepartmentAppts` (`dashboard-home.component.ts:32, 53, 78`) which are called in `ngOnInit`.

---

## 10. Migration / Parity Notes (for our HMS rebuild)

If/when the Cloudflare Hono/D1/Angular rebuild needs an equivalent of the Home module:

1. The Home **view** is no longer needed in Hono: the SPA's `index.html` is the only entry point. The `Index.cshtml` responsibilities collapse into a static HTML page that reads the JWT from a query string or localStorage and bootstraps the Angular bundle.
2. `HomeController.AppMain` collapses into an Angular `AppComponent` template. The sidebar route hydration can move from server-side to client-side; the existing `SecurityController.ValidRoutes` endpoint already returns the data the SPA needs.
3. `HomeController.GetUserManual` is a single `GET /home/user-manual` that returns the PDF; in R2 it can be served as a `Range`-aware response.
4. `AppComponent`'s boot pipeline (parameters, masters, lookups, valid routes, user permissions, app settings, active counters, hospital info, lab types) maps cleanly to a `/api/home/init` endpoint that returns all of those in a single response, dramatically reducing boot latency and avoiding the 20+ sequential requests. This is the modern pattern.
5. `LandingPageRouteId` stays; just store it in D1 and return it from `GET /api/users/me`.
6. The `isLandingVisited` flags stay in the client (sessionStorage / localStorage).
7. JWT can live in an HttpOnly cookie set by the Hono `/api/auth/login` response, which avoids the TempData / DOM attribute handoff that the legacy .NET stack needs.
8. The `MyConfiguration.ApplicationVersionNum` becomes a Cloudflare Worker environment variable, returned by `GET /api/system/app-settings`.
9. The `ChangePassword` page is fully client-side; the JSON endpoint is `POST /api/auth/change-password`.
10. The dashboard KPI endpoints (`/api/reports/home-stats`, `/api/reports/patient-zone-map`, `/api/reports/department-appointments-total`) are kept as separate endpoints so the SPA can refresh them on a schedule.

