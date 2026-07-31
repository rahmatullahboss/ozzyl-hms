# Module 51 — ActionFilter (Cross-Cutting Action Filters, Base Controller, Auth Wrapper)

> Cross-cutting infrastructure layer for DanpheEMR. Owns the three ASP.NET Core action filters that gate every HTTP call (`RequestFormSizeLimitAttribute`, `DanpheViewFilter`, `DanpheDataFilter`), the `CommonController` base class that every business controller inherits from, the standard `DanpheHTTPResponse<T>` envelope, and the `RBAC` static helper that powers the filters. This is the **glue** that connects Authentication → Authorization → Audit → Standardized Response across the other 39 modules.

Source files studied:

| Layer | File | Lines | Purpose |
|-------|------|------:|---------|
| Action filters | `Code/Websites/DanpheEMR/Controllers/DanpheActionFilter.cs` | 230 | 3 filter attributes + body-replay helper |
| Base controller | `Code/Websites/DanpheEMR/Utilities/CommonController.cs` | 257 | `CommonController` + 7 `Invoke*` response wrappers + `AddAuditField`/`CreateEmpi` |
| Configuration | `Code/Websites/DanpheEMR/Utilities/MyConfiguration.cs` | 40 | `MyConfiguration`, `JWTTokenConfiguration`, `GoogleDriveConfiguration` |
| Response envelope | `Code/Websites/DanpheEMR/Utilities/CommonTypes.cs` | 47 | `DanpheHTTPResponse<T>` |
| Enum bag | `Code/Websites/DanpheEMR/Utilities/SharedEnums.cs` | 585 | `ENUM_ClaimTypes.currentUser`, `ENUM_Danphe_HTTP_ResponseStatus`, 40+ other enums |
| RBAC static | `Code/Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs` | 525 | `RBAC` class with cache-backed lookups + TripleDES password crypto |
| Identity models | `Code/Components/DanpheEMR.Security/RBAC/{RbacUser,RbacRole,RbacPermission,RbacApplication,Routes,RbacOtherModels}.cs` | 7 files | EF entities for `RBAC_*` tables |
| DbContext | `Code/Components/DanpheEMR.Security/RbacDbContext.cs` | 74 | `RbacDbContext : AuditDbContext` |

---

## 1. Module Overview

The ActionFilter module is the **cross-cutting infrastructure** that every other module depends on but that owns no business data. It has three responsibilities:

1. **Gate every request** — `DanpheDataFilter` rejects unauthenticated REST calls, `DanpheViewFilter` rejects unauthorized MVC view requests, `RequestFormSizeLimitAttribute` prevents oversized form submissions.
2. **Provide a uniform response envelope** — every controller action returns a `DanpheHTTPResponse<T>` (or one of the `InvokeHttp*Function` wrappers) with `Status`, `Results`, and `ErrorMessage` fields.
3. **Standardize write-path concerns** — every controller inherits `CommonController` which exposes the `connString`, the `IsAuditEnabled` flag, the `AddAuditField` helper, the EMPI generator, and seven response-wrapper methods that handle try/catch/serialize automatically.

### 1.1 Three Filters at a Glance

| Filter | Type | When it runs | What it checks | Failure mode |
|--------|------|--------------|----------------|--------------|
| `RequestFormSizeLimitAttribute` | `IAuthorizationFilter` | Before model binding | Sets `FormOptions` cap on `ValueLengthLimit`, `KeyLengthLimit`, `ValueCountLimit` | Lets request proceed (filter only sets limits, doesn't reject) |
| `DanpheViewFilter` | `ActionFilterAttribute` (`OnActionExecuting`) | Before MVC action method | User has the named `PermissionName` in their session `validpermissionlist` | Redirects to `Account/PageNotFound` |
| `DanpheDataFilter` | `ActionFilterAttribute` (`OnActionExecuting`) | Before API action method | Valid JWT in `Authorization` header with `currentUser` claim; OR valid `currentuser` in session; OR special DICOM path with embedded user | Returns `DanpheHTTPResponse<object>` with `Status="Failed"`, `ErrorMessage="Unauthorized Access"` |

### 1.2 Why Every Business Controller Inherits `CommonController`

`CommonController.cs:17-20` carries the global decoration that is automatically applied to **every** derived controller:

```csharp
[RequestFormSizeLimit(valueCountLimit: 1000000, Order = 1)]
[DanpheDataFilter()]
[Route("api/[controller]")]
public class CommonController : Controller
```

Because every other controller (`PatientController`, `BillingController`, `AccountingController`, etc.) calls `base(_config)`, the `[DanpheDataFilter]` attribute is applied at the **class level** of every business API. This is the single line that authenticates the entire REST surface — remove it and the system is unauthenticated.

### 1.3 The Filter Chain (Request Lifecycle)

```
HTTP request
    |
    v
[RequestFormSizeLimitAttribute.OnAuthorization]   (Order = 1, runs first)
    |   - Sets IFormFeature with bounded FormOptions
    v
[DanpheDataFilter.OnActionExecuting]              (attribute on CommonController)
    |   1. Read Authorization header
    |   2. Parse JWT, extract ENUM_ClaimTypes.currentUser claim
    |   3. Deserialize RbacUser, attach to local var
    |   4. If null -> short-circuit with JsonResult Failed
    |   5. DICOM exception path reads body, validates RBAC.IsValidUser
    v
[ASP.NET model binding]
    v
[Controller action method executes]
    |
    v
[InvokeHttp*Function<T> wrapper]                  (called by ~95% of actions)
    |   try { run delegate }
    |   catch { Status=Failed, ErrorMessage=ex.Message }
    |   -> Ok(DanpheHTTPResponse<T>)
    v
JSON response: { Status, Results, ErrorMessage }
```

For MVC **view** requests the chain is parallel but uses `DanpheViewFilter` and `OnActionExecuting` runs after the model binder:

```
Browser GET /Settings/SettingsMain
    |
    v
[DanpheViewFilter("settings-view").OnActionExecuting]
    |   1. Read currentuser from session
    |   2. Read validpermissionlist from session
    |   3. Find permission with name "settings-view"
    |   4. If not found -> Redirect Account/PageNotFound
    v
[Action method returns View("SettingsMain")]
    |
    v
Razor view rendered -> HTML
```

### 1.4 The `DanpheHTTPResponse<T>` Envelope

`Utilities/CommonTypes.cs:19-46` defines the single response contract:

```csharp
public class DanpheHTTPResponse<T>
{
    public T Results { get; set; }
    public string Status { get; set; }     // ENUM_Danphe_HTTP_ResponseStatus.OK | Failed
    public string ErrorMessage { get; set; }

    public static DanpheHTTPResponse<T> FormatResult(T results);
    public static DanpheHTTPResponse<T> FormatResult(T results, string status);
    public static DanpheHTTPResponse<T> FormatResult(T results, string status, string errorMessage);
}
```

`Status` is a string (not an enum) per the convention noted at `SharedEnums.cs:5-6`: *"enum gave issues while using in LINQ"*. The two valid values are `ENUM_Danphe_HTTP_ResponseStatus.OK` (`"OK"`) and `ENUM_Danphe_HTTP_ResponseStatus.Failed` (`"Failed"`).

### 1.5 Cross-Cutting Concerns

| Concern | How the ActionFilter module handles it |
|---------|----------------------------------------|
| **Authentication (API)** | `DanpheDataFilter` reads JWT, deserializes `RbacUser` from `ENUM_ClaimTypes.currentUser` claim. Falls back to session `currentuser` for legacy callers. |
| **Authentication (View)** | `DanpheViewFilter` reads session `currentuser` + `validpermissionlist`. |
| **Authorization** | `DanpheViewFilter` checks permission name. `DanpheDataFilter` is authentication-only — fine-grained per-API-method authorization is **not** performed. |
| **DICOM ingestion exception** | `DanpheDataFilter` has a special branch for `POST /api/Dicom` — reads the body, deserializes a `RbacUser` from the JSON, calls `RBAC.IsValidUser` directly. |
| **Form size cap** | `RequestFormSizeLimitAttribute` sets `IFormFeature` options. Used with `valueCountLimit: 1000000` on `CommonController` and `valueCountLimit: 100000` on `AccountingController` (smaller cap for accounting due to large voucher payloads). |
| **Standardized response** | `InvokeHttpGetFunction` / `InvokeHttpPostFunction` / `InvokeHttpPutFunction` and their `Async`/`SingleTransactionScope` variants wrap any delegate in a try/catch and emit a `DanpheHTTPResponse<T>`. |
| **Audit enablement** | `CommonController.IsAuditEnabled` (read from `MyConfiguration.IsAuditEnable`) gates `AddAuditField` so EF Audit.NET custom fields are only added when configured. |
| **EMPI generation** | `CommonController.CreateEmpi(PatientModel)` builds the 16-char EMPI: 3-char district + 6-char DOB (`ddMMyy`) + 3-char name initials (F-M-L, "X" for no middle) + 4-digit random. |
| **Password crypto** | `RBAC.EncryptPassword` / `DecryptPassword` (TripleDES, ECB, PKCS7, MD5-salted key with literal `"Danphesalt"`). Same routine is reused for SQL connection string decryption at startup. |
| **RBAC caching** | `RBAC.GetAll*` and `RBAC.GetUserAllPermissions` cache entire lists in-process via `DanpheCache` with TTL from `MyConfiguration.CacheExpirationMinutes`. |

### 1.6 Module Map

```
ActionFilter module (this doc)
  |
  +-- DanpheActionFilter.cs
  |     +-- RequestFormSizeLimitAttribute
  |     +-- DanpheViewFilter          <-- MVC view authorization
  |     +-- DanpheDataFilter          <-- API authentication (JWT)
  |     +-- ReadBodyAsString          <-- private helper for DICOM path
  |
  +-- Utilities/CommonController.cs    <-- base class for all 35+ controllers
  |     +-- [RequestFormSizeLimit, DanpheDataFilter]  <-- class-level decoration
  |     +-- InvokeHttpGetFunction / Async
  |     +-- InvokeHttpPostFunction / Async / SingleTransactionScope
  |     +-- InvokeHttpPutFunction / Async / SingleTransactionScope
  |     +-- ReadQueryStringData, ReadPostData, ReadFiles
  |     +-- ToInt, ToInt64, ToBool
  |     +-- AddAuditField
  |     +-- CreateEmpi(PatientModel)
  |
  +-- Utilities/CommonTypes.cs         <-- DanpheHTTPResponse<T>
  +-- Utilities/MyConfiguration.cs     <-- config object bound by IOptions<>
  +-- Utilities/SharedEnums.cs         <-- ENUM_ClaimTypes, ENUM_Danphe_HTTP_ResponseStatus, etc.
  |
  +-- Components/DanpheEMR.Security/RBAC/
  |     +-- DanpheRBAC.cs              <-- static RBAC class (cache + crypto + queries)
  |     +-- RbacUser, RbacRole, RbacPermission, RbacApplication
  |     +-- Routes (DanpheRoute)
  |     +-- RbacOtherModels (UserRoleMap, RolePermissionMap)
  |     +-- RbacDbContext : AuditDbContext
  |
  +-- Consumed by (35+ controllers in 39 other modules)
```

---

## 2. Backend Files

### 2.1 `DanpheActionFilter.cs` — The Three Filters

`Controllers/DanpheActionFilter.cs:230`

| # | Class | Lines | Base | Implements |
|---|-------|------:|------|------------|
| 1 | `RequestFormSizeLimitAttribute` | `DanpheActionFilter.cs:25-53` | `Attribute` | `IAuthorizationFilter`, `IOrderedFilter` |
| 2 | `DanpheViewFilter` | `DanpheActionFilter.cs:61-107` | `ActionFilterAttribute` | — |
| 3 | `DanpheDataFilter` | `DanpheActionFilter.cs:117-228` | `ActionFilterAttribute` | — |

#### 2.1.1 `RequestFormSizeLimitAttribute` — Form-Size Cap

**File:** `DanpheActionFilter.cs:25-53`

```csharp
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method,
                AllowMultiple = false, Inherited = true)]
public class RequestFormSizeLimitAttribute : Attribute, IAuthorizationFilter, IOrderedFilter
{
    private readonly FormOptions _formOptions;

    public RequestFormSizeLimitAttribute(int valueCountLimit)
    {
        _formOptions = new FormOptions()
        {
            ValueLengthLimit = valueCountLimit,
            KeyLengthLimit   = valueCountLimit,
            ValueCountLimit  = valueCountLimit
        };
    }

    public int Order { get; set; }

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var features = context.HttpContext.Features;
        var formFeature = features.Get<IFormFeature>();
        if (formFeature == null || formFeature.Form == null)
        {
            // Request form has not been read yet, so set the limits
            features.Set<IFormFeature>(
                new FormFeature(context.HttpContext.Request, _formOptions));
        }
    }
}
```

**Behavior:**

- Applied at the **class level** of every controller that inherits `CommonController`. It runs in the authorization filter pipeline with `Order = 1` (numeric — lower runs first), giving it the earliest hook point available before the form is materialized.
- Reads the current `IFormFeature` from `HttpContext.Features`. If the form has not been read yet, it sets a new `FormFeature` with the bounded `FormOptions`.
- All three `FormOptions` limits (`ValueLengthLimit`, `KeyLengthLimit`, `ValueCountLimit`) are set to the same `valueCountLimit` argument. This is a deliberate conservative cap — typically `1000000` on `CommonController` and `100000` on `AccountingController`.
- The filter does **not** reject the request — it only configures the maximums. ASP.NET Core will later throw `InvalidDataException` (caught as a 400 Bad Request) if the body exceeds the limits.

**Usage:**

| Class | Limit | Source |
|-------|------:|--------|
| `CommonController` | `1,000,000` | `CommonController.cs:17` |
| `AccountingController` | `100,000` | `Accounting/AccountingController.cs:42` |
| `Order/OrdersController` | `1,000,000` (inherited) | inherits `CommonController` |
| All other controllers | `1,000,000` (inherited) | inherits `CommonController` |

#### 2.1.2 `DanpheViewFilter` — MVC View Authorization

**File:** `DanpheActionFilter.cs:61-107`

Author: Nagesh BB, 08-Aug-2017.

```csharp
public class DanpheViewFilter : ActionFilterAttribute
{
    private string PermissionName { get; set; }

    public DanpheViewFilter(string permissionName)
    {
        PermissionName = permissionName;
    }

    public override void OnActionExecuting(ActionExecutingContext context)
    {
        try
        {
            base.OnActionExecuting(context);
            RbacUser currentUser =
                context.HttpContext.Session.Get<RbacUser>("currentuser");
            if (currentUser != null)
            {
                List<RbacPermission> validPermissionList =
                    context.HttpContext.Session
                            .Get<List<RbacPermission>>("validpermissionlist");
                if (validPermissionList.Count > 0)
                {
                    RbacPermission currentPermission =
                        validPermissionList.Find(
                            a => a.PermissionName == PermissionName);
                    if (currentPermission == null ||
                        currentPermission.PermissionName == null)
                    {
                        context.Result = new RedirectToRouteResult(
                            new RouteValueDictionary {
                                { "controller", "Account" },
                                { "action",     "PageNotFound" }
                            });
                    }
                }
                else
                {
                    context.Result = new RedirectToRouteResult(
                        new RouteValueDictionary {
                            { "controller", "Account" },
                            { "action",     "PageNotFound" }
                        });
                }
            }
        }
        catch (Exception ex)
        {
            throw ex;
        }
    }
}
```

**Behavior:**

- Decorates MVC **view** actions (not API actions). Authored in 2017 to be the single place where the permission-to-view check happens.
- Reads `currentuser` (RbacUser) and `validpermissionlist` (List<RbacPermission>) from the session — both populated by `AccountController.SetSessionVariable` at login.
- Looks up the supplied `PermissionName` in the list. If not found, short-circuits the request with a 302 redirect to `Account/PageNotFound` (the SPA's "UnAuthorize" page).
- The catch block re-throws the exception (a known anti-pattern; preserved for compatibility).
- 15 view controllers use this filter (see section 7).

**Example usage:**

```csharp
[DanpheViewFilter("settings-view")]
public IActionResult SettingsMain() { ... }

[DanpheViewFilter("billing-transaction-view")]
public IActionResult BillingTransactionMain() { ... }

[DanpheViewFilter("pharmacy-sale-view")]
public IActionResult PharmacyMain() { ... }
```

#### 2.1.3 `DanpheDataFilter` — API Authentication via JWT

**File:** `DanpheActionFilter.cs:117-228`

Author: Nagesh BB, 08-Aug-2017. Updated by Krishna, 13-Jan-2023 (JWT support).

```csharp
public class DanpheDataFilter : ActionFilterAttribute
{
    private string apiPermissionName { get; set; }

    public DanpheDataFilter(string permissionName)
    {
        apiPermissionName = permissionName;
    }
    public DanpheDataFilter() { }     // no-arg ctor (default usage)

    public override void OnActionExecuting(ActionExecutingContext context)
    {
        base.OnActionExecuting(context);
        try
        {
            var req = context.HttpContext.Request;
            try
            {
                // DICOM special path (listener.exe)
                if (req.Method.ToUpper() == "POST" &&
                    req.Path.Value.ToString() == "/api/Dicom")
                {
                    string bodyData = ReadBodyAsString(context.HttpContext.Request);
                    var obj = JObject.Parse(bodyData);
                    RbacUser currUser = DanpheJSONConvert
                        .DeserializeObject<RbacUser>(obj["currentuser"].ToString());
                    var flag = RBAC.IsValidUser(currUser.UserName, currUser.Password);
                    if (flag == false)
                    {
                        context.Result = new JsonResult(
                            new DanpheHTTPResponse<object> {
                                Status = "Failed",
                                ErrorMessage = "Unauthorized Access",
                                Results = ""
                            });
                    }
                }
                else
                {
                    // Normal path: JWT in Authorization header
                    RbacUser currentUser = null;
                    string tokenFromHeader = context.HttpContext.Request.Headers["Authorization"];
                    if (tokenFromHeader != null)
                    {
                        var tokenWithoutBearer = tokenFromHeader.Split(' ')[1];
                        var handler = new JwtSecurityTokenHandler();
                        var jwtSecurityToken = handler.ReadJwtToken(tokenWithoutBearer);
                        var userClaim = jwtSecurityToken.Claims
                            .Where(claim => claim.Type == ENUM_ClaimTypes.currentUser)
                            .FirstOrDefault()?.Value;
                        var loggedInUserDetail =
                            DanpheJSONConvert.DeserializeObject<RbacUser>(userClaim);
                        currentUser = loggedInUserDetail;
                    }

                    if (currentUser == null)
                    {
                        context.Result = new JsonResult(
                            new DanpheHTTPResponse<object> {
                                Status = "Failed",
                                ErrorMessage = "Unauthorized Access",
                                Results = ""
                            });
                    }
                }
            }
            catch (Exception ex)
            {
                // Any failure -> unauthorized
                context.Result = new JsonResult(
                    new DanpheHTTPResponse<object> {
                        Status = "Failed",
                        ErrorMessage = "Unauthorized Access",
                        Results = ""
                    });
            }
        }
        catch (Exception ex)
        {
            throw ex;
        }
    }

    private string ReadBodyAsString(HttpRequest Request) { ... }
}
```

**Behavior:**

- This is the **single authentication gate** for the REST API. The `[DanpheDataFilter()]` attribute is applied at the class level on `CommonController` (`CommonController.cs:18`), so every derived controller inherits authentication enforcement.
- **Two code paths:**
  1. **DICOM path** — `POST /api/Dicom` from the `listener.exe` PACS connector. The filter manually reads the request body, extracts a `currentuser` JSON property, deserializes a `RbacUser`, and calls `RBAC.IsValidUser(username, password)`. This is the only path that supports user-in-body authentication.
  2. **Standard path** — Reads the `Authorization` header, expects `Bearer <token>`, parses the JWT, extracts the claim where `claim.Type == ENUM_ClaimTypes.currentUser` (value `"currentUser"` per `SharedEnums.cs:394-397`), deserializes the `RbacUser`, and accepts the request.
- **Note on the `apiPermissionName` field** — it is set in the parameterized ctor and read in commented-out code (`DanpheActionFilter.cs:182-203`). The default `[DanpheDataFilter()]` (no-arg ctor) is used everywhere, and the filter effectively only checks **authentication**, not fine-grained per-method **authorization**. Fine-grained checks happen client-side via Angular `rbac-permission` directive and `AuthGuardService`.
- **On any failure** — the filter returns `200 OK` with body `{ Status: "Failed", ErrorMessage: "Unauthorized Access", Results: "" }`. This is *not* a 401 — clients must inspect the `Status` field.
- The `ReadBodyAsString` helper (lines 212-227) does an in-place `Stream.Seek(0, Begin)` and `StreamReader.ReadToEnd()`. It silently returns `null` on failure.

### 2.2 `CommonController.cs` — The Base Class

**File:** `Utilities/CommonController.cs:257`

#### 2.2.1 Class Declaration

```csharp
[RequestFormSizeLimit(valueCountLimit: 1000000, Order = 1)]
[DanpheDataFilter()]
[Route("api/[controller]")]
public class CommonController : Controller
{
    protected readonly string connString = null;
    protected readonly string connStringAdmin = null;
    protected readonly string connStringPACSServer = null;
    protected readonly bool IsAuditEnabled = false;

    public CommonController(IOptions<MyConfiguration> _config)
    {
        connString              = _config.Value.Connectionstring;
        connStringAdmin         = _config.Value.ConnectionStringAdmin;
        connStringPACSServer    = _config.Value.ConnectionStringPACSServer;
        IsAuditEnabled          = _config.Value.IsAuditEnable;
    }
    // ...
}
```

| Member | Type | Visibility | Purpose |
|--------|------|------------|---------|
| `connString` | `string` | `protected readonly` | Main EMR DB connection string |
| `connStringAdmin` | `string` | `protected readonly` | Admin DB connection (login info, cookie auth, audit) |
| `connStringPACSServer` | `string` | `protected readonly` | PACS DB connection (DICOM ingestion) |
| `IsAuditEnabled` | `bool` | `protected readonly` | From `MyConfiguration.IsAuditEnable` |

Every controller passes these strings to its module-specific `DbContext` constructor — e.g. `PatientDbContext(connString)`, `BillingDbContext(connString)`, etc.

#### 2.2.2 Read Helpers

| Method | Lines | Returns | Notes |
|--------|------:|---------|-------|
| `ReadQueryStringData(string keyname)` | 35-38 | `string` | Wraps `Request.Query[keyname]` |
| `ReadPostData()` | 39-45 | `string` | Seeks body to 0, reads to end. **Required** for routes where MVC would otherwise consume the stream. |
| `ReadFiles()` | 46-50 | `IFormFileCollection` | Wraps `Request.Form.Files` |
| `ToInt(string value)` | 51-54 | `int` | `Convert.ToInt32` |
| `ToInt64(string value)` | 59-62 | `Int64` | `Convert.ToInt64` |
| `ToBool(string value)` | 55-58 | `bool` | Returns `true` only for `"1"`, `false` otherwise |

#### 2.2.3 Audit Helper

```csharp
internal dynamic AddAuditField(dynamic dbContext)
{
    if (this.IsAuditEnabled)
    {
        RbacUser user = HttpContext.Session.Get<RbacUser>("currentuser");
        dbContext.AddAuditCustomField("ChangedByUserId",   user.EmployeeId);
        dbContext.AddAuditCustomField("ChangedByUserName", user.UserName);
    }
    return dbContext;
}
```

`AddAuditField` (`CommonController.cs:63-72`) is a thin wrapper over the **Audit.NET** `AddAuditCustomField` extension. When `IsAuditEnabled` is `true` (configured in `appsettings.json`), every business call that touches a module `DbContext` should call this to attach `ChangedByUserId` / `ChangedByUserName` to the audit log entry.

#### 2.2.4 EMPI Generator

`CreateEmpi(PatientModel obj)` — `CommonController.cs:74-102`

Builds a 16-character Enterprise Master Patient Index identifier. The algorithm is documented inline:

```
Position 1-3  : District (first 3 chars of CountrySubDivisionName)
Position 4-9  : DOB as ddMMyy
Position 10   : First-name initial
Position 11   : Middle-name initial, or "X" if no middle name
Position 12   : Last-name initial
Position 13-16: Random 4-digit number (1000-9999)
```

Example: `Khadka Prasad Oli`, District `Kailali`, DOB `01-Dec-1990` → `KAI011290KPO8972`. The result is uppercased and assigned to `obj.EMPI`.

#### 2.2.5 Response Wrappers — The `InvokeHttp*Function` Family

These are the **most-used** members of `CommonController`. They wrap a delegate in try/catch and emit a standardized `DanpheHTTPResponse<T>`. There are seven variants:

| Method | Lines | Returns | Notes |
|--------|------:|---------|-------|
| `InvokeHttpGetFunction<T>(Func<T> functionName, string customErrorMsg = null)` | 104-119 | `ActionResult` | Sync GET wrapper. Serializes response through `DeserializeObject(SerializeObject(...))` to avoid reference cycles. |
| `InvokeHttpGetFunctionAsync<T>(Func<Task<T>> function, string customErrorMsg = null)` | 121-137 | `Task<ActionResult>` | Async GET wrapper. Returns the response object directly (no double-serialize). |
| `InvokeHttpPostFunction<T>(Func<T> functionName)` | 139-155 | `ActionResult` | Sync POST wrapper. |
| `InvokeHttpPostFunctionAsync<T>(Func<T> functionName, string customErrorMsg = null)` | 157-177 | `Task<ActionResult>` | Async POST wrapper using `Task.Run`. |
| `InvokeHttpPostFunctionSingleTransactionScope<T>(Func<T> functionName, DbContextTransaction transactionScope)` | 179-197 | `ActionResult` | POST wrapper that commits/rolls back an EF transaction. |
| `InvokeHttpPutFunction<T>(Func<T> functionName)` | 198-213 | `ActionResult` | Sync PUT wrapper. |
| `InvokeHttpPutFunctionAsync<T>(Func<T> functionName, string customErrorMsg = null)` | 216-235 | `Task<ActionResult>` | Async PUT wrapper using `Task.Run`. |
| `InvokeHttpPutFunctionSingleTransactionScope<T>(Func<T> functionName, DbContextTransaction transactionScope)` | 237-254 | `ActionResult` | PUT wrapper that commits/rolls back an EF transaction. |

**Pattern (sync, success path):**

```csharp
protected ActionResult InvokeHttpPostFunction<T>(Func<T> functionName)
{
    DanpheHTTPResponse<T> responseData = new DanpheHTTPResponse<T>();
    try
    {
        T result = functionName.Invoke();
        responseData.Status  = ENUM_Danphe_HTTP_ResponseStatus.OK;
        responseData.Results = result;
    }
    catch (Exception ex)
    {
        responseData.Status       = ENUM_Danphe_HTTP_ResponseStatus.Failed;
        responseData.ErrorMessage = ex.Message;
    }
    // serialize/deserialize round-trip avoids EF proxy reference cycles
    return Ok(DanpheJSONConvert.SerializeObject(responseData, true));
}
```

**Pattern (single-transaction, success path):**

```csharp
protected ActionResult InvokeHttpPostFunctionSingleTransactionScope<T>(
    Func<T> functionName,
    System.Data.Entity.DbContextTransaction transactionScope)
{
    DanpheHTTPResponse<T> responseData = new DanpheHTTPResponse<T>();
    try
    {
        T result = functionName.Invoke();
        responseData.Status  = ENUM_Danphe_HTTP_ResponseStatus.OK;
        responseData.Results = result;
        transactionScope.Commit();
    }
    catch (Exception ex)
    {
        transactionScope.Rollback();
        responseData.Status       = ENUM_Danphe_HTTP_ResponseStatus.Failed;
        responseData.ErrorMessage = ex.Message;
    }
    return Ok(DanpheJSONConvert.SerializeObject(responseData, true));
}
```

The `Ok(...)` returns HTTP 200 with the JSON-serialized response. The HTTP code is **always 200** — the caller must inspect `Status` to know success vs failure.

### 2.3 `CommonTypes.cs` — The Response Envelope

`Utilities/CommonTypes.cs:47`

```csharp
namespace DanpheEMR.CommonTypes
{
    public class DanpheHTTPResponse<T>
    {
        public T      Results      { get; set; }
        public string Status       { get; set; }
        public string ErrorMessage { get; set; }

        public DanpheHTTPResponse()
        {
            this.Status       = string.Empty;
            this.ErrorMessage = string.Empty;
        }

        public static DanpheHTTPResponse<T> FormatResult(T results);
        public static DanpheHTTPResponse<T> FormatResult(T results, string status);
        public static DanpheHTTPResponse<T> FormatResult(T results, string status, string errorMessage);
    }
}
```

The three `FormatResult` factory methods are convenience constructors used by some controllers to build the envelope inline (without going through `InvokeHttp*Function`).

### 2.4 `MyConfiguration.cs` — Bound Config Object

`Utilities/MyConfiguration.cs:40`

```csharp
public class MyConfiguration
{
    public string Connectionstring                { get; set; }
    public string ConnectionStringAdmin           { get; set; }
    public string ConnectionStringPACSServer      { get; set; }
    public int    CacheExpirationMinutes          { get; set; }
    public string FileStorageRelativeLocation     { get; set; }
    public bool   highlightAbnormalLabResult      { get; set; }
    public bool   RealTimeRemoteSyncEnabled       { get; set; }
    public string ApplicationVersionNum           { get; set; }
    public bool   IsAuditEnable                   { get; set; }
    public string LISDataBaseUrl                  { get; set; }
    public GoogleDriveConfiguration GoogleDriveFileUpload { get; set; }
    public JWTTokenConfiguration     JwtTokenConfig        { get; set; }
    public bool   RealTimeSSFClaimBooking         { get; set; }
}

public class JWTTokenConfiguration
{
    public string JwtKey          { get; set; }
    public string JwtIssuer       { get; set; }
    public string JwtAudience     { get; set; }
    public string JwtValidMinutes { get; set; }
}
```

Bound by `Startup.cs` via `services.Configure<MyConfiguration>(Configuration.GetSection("..."))` and injected as `IOptions<MyConfiguration>`. The JWT settings here are the same ones `AccountController.GenerateJwtToken` uses to mint tokens.

### 2.5 `SharedEnums.cs` — The Enum Bag

`Utilities/SharedEnums.cs:585`. This module owns the two enums that matter to the filter chain:

```csharp
public static class ENUM_Danphe_HTTP_ResponseStatus
{
    public static readonly string OK     = "OK";
    public static readonly string Failed = "Failed";
}

public static class ENUM_ClaimTypes
{
    public static readonly string currentUser = "currentUser";
}
```

`ENUM_ClaimTypes.currentUser` is the JWT claim type that `DanpheDataFilter` looks for when extracting the embedded `RbacUser` from the bearer token (`DanpheActionFilter.cs:163`).

---

## 3. Data Models

The ActionFilter module owns no business data, but it relies on five EF entities for its filters to function. All five are in `Components/DanpheEMR.Security/RBAC/`.

### 3.1 `RbacUser` — The Logged-In Identity

`Components/DanpheEMR.Security/RBAC/RbacUser.cs:42`

| Property | Type | Notes |
|----------|------|-------|
| `UserId` | `int` (Key) | DB-generated |
| `EmployeeId` | `int` | Links to `EMP_Employee.EmployeeId` — every user is a real employee |
| `UserName` | `string` | Case-insensitive for login |
| `Password` | `string` | TripleDES encrypted with `MD5("Danphesalt")` key |
| `Email` | `string` | Optional |
| `CreatedBy` / `CreatedOn` | `int` / `DateTime` | Audit |
| `ModifiedBy` / `ModifiedOn` | `int?` / `DateTime?` | Audit |
| `IsActive` | `bool?` | Soft-delete / disable |
| `NeedsPasswordUpdate` | `bool?` | Forces password change on next login |
| `LandingPageRouteId` | `int?` | Added by Ajay 07-Aug-2019 — used to choose default landing page |
| `Employee` | `EmployeeModel` | Navigation |
| `Roles` | `List<RbacRole>` | Navigation (lazy-loaded) |
| **Methods** | | |
| `Clone()` | `object` | `MemberwiseClone` — used by `RBAC.GetUser` so cache is not mutated |

### 3.2 `RbacPermission` — The Fine-Grained Permission Key

`Components/DanpheEMR.Security/RBAC/RbacPermission.cs:29`

| Property | Type | Notes |
|----------|------|-------|
| `PermissionId` | `int` (Key) | DB-generated |
| `PermissionName` | `string` | The string key (e.g. `billing-transaction-view`). This is what `DanpheViewFilter` looks up. |
| `Description` | `string` | Human description |
| `ApplicationId` | `int?` | FK to `RbacApplication` |
| `IsActive` | `bool` | Soft-delete |
| Audit fields | | `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn` |
| `Application` | `RbacApplication` | Navigation |
| `Roles` | `List<RbacRole>` | Navigation |

### 3.3 `RbacRole` — The Role Container

`Components/DanpheEMR.Security/RBAC/RbacRole.cs:40`

| Property | Type | Notes |
|----------|------|-------|
| `RoleId` | `int` (Key) | |
| `RoleName` | `string` | e.g. `"Doctor"`, `"Nurse"`, `"LabTechnician"` |
| `RoleDescription` | `string` | |
| `RoleType` | `string` | Free-text classification |
| `ApplicationId` | `int?` | FK to `RbacApplication` — scope |
| `IsSysAdmin` | `bool` | **Bypass flag** — users with this role get all permissions |
| `IsActive` | `bool` | |
| `RolePriority` | `int?` | Used to choose default landing page |
| `DefaultRouteId` | `int?` | FK to `DanpheRoute` — landing page after login |
| Audit fields | | |
| `Application` | `RbacApplication` | |
| `Permissions` | `List<RbacPermission>` | |
| `Users` | `List<RbacUser>` | |
| `Route` | `DanpheRoute` | |

### 3.4 `UserRoleMap` — User ↔ Role (Many-to-Many)

`Components/DanpheEMR.Security/RBAC/RbacOtherModels.cs:24-39`

| Property | Type | Notes |
|----------|------|-------|
| `UserRoleMapId` | `int` (Key) | DB-generated |
| `UserId` | `int` | FK to `RbacUser` |
| `RoleId` | `int` | FK to `RbacRole` |
| `StartDate` | `DateTime?` | Optional grant window |
| `EndDate` | `DateTime?` | Optional grant window |
| `IsActive` | `bool` | Soft-delete |
| Audit fields | | |
| `User` | `RbacUser` | |
| `Role` | `RbacRole` | |

### 3.5 `RolePermissionMap` — Role ↔ Permission (Many-to-Many)

`Components/DanpheEMR.Security/RBAC/RbacOtherModels.cs:9-22`

| Property | Type | Notes |
|----------|------|-------|
| `RolePermissionMapId` | `int` (Key) | |
| `RoleId` | `int` | FK to `RbacRole` |
| `PermissionId` | `int` | FK to `RbacPermission` |
| `IsActive` | `bool` | Soft-delete |
| Audit fields | | |
| `Permission` | `RbacPermission` | |
| `Role` | `RbacRole` | |

### 3.6 `RbacApplication` — Logical Grouping

`Components/DanpheEMR.Security/RBAC/RbacApplication.cs` (in scope). Group permissions into applications (e.g. "Clinical", "Billing"). Has `ApplicationId`, `ApplicationName`, `ApplicationCode`, `IsActive`.

### 3.7 `DanpheRoute` — Navigation Routes

`Components/DanpheEMR.Security/RBAC/Routes.cs:33`

| Property | Type | Notes |
|----------|------|-------|
| `RouteId` | `int` (Key) | |
| `UrlFullPath` | `string` | Angular front-end URL |
| `DisplayName` | `string` | Side-nav label |
| `PermissionId` | `int?` | FK to `RbacPermission` — gates the route |
| `ParentRouteId` | `int?` | Self-FK for menu hierarchy |
| `DefaultShow` | `bool?` | If false, hidden even if user has permission |
| `RouterLink` | `string` | |
| `IsActive` | `bool?` | |
| `IsSecondaryNavInDropdown` | `bool?` | |
| `ChildRoutes` | `List<DanpheRoute>` (NotMapped) | Hydrated by `RBAC.GetRoutesForUser` |
| `Css` | `string` | CSS class for the menu icon |
| `DisplaySeq` | `int?` | Sort order |
| `ChildRoutesDefaultShowCount` | `int?` (NotMapped) | |

### 3.8 The `RBAC` Static Helper Class

`Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs:525`

| Method | Lines | Returns | Notes |
|--------|------:|---------|-------|
| `RBAC(string connectionString, int cacheExpMinutes)` | 26-30 | constructor | Stores into static fields |
| `GetAllApplications()` | 33-43 | `List<RbacApplication>` | Cached as `RBAC-Apps-All` |
| `GetAllPermissions()` | 47-58 | `List<RbacPermission>` | Cached as `RBAC-Perms-All` |
| `GetAllRoles()` | 60-70 | `List<RbacRole>` | Cached as `RBAC-Roles-All` |
| `GetAllUsers()` | 72-82 | `List<RbacUser>` | Cached as `RBAC-Users-All` |
| `GetAllUserRoleMaps()` | 84-95 | `List<UserRoleMap>` | Cached as `RBAC-UserRoleMaps-All` |
| `GetAllRolePermissionMaps()` | 97-107 | `List<RolePermissionMap>` | Cached as `RBAC-RolePermissionMaps-All` |
| `GetAllRoutes()` | 110-121 | `List<DanpheRoute>` | Cached as `RBAC-Routes-All` |
| `GetRoutesForUser(int userId, bool getHiearrchy)` | 124-151 | `List<DanpheRoute>` | Joins user permissions to routes. Builds hierarchy tree when `getHiearrchy=true`. |
| `GetChildRouteHierarchy(...)` | 153-168 | `List<DanpheRoute>` | Recursive private helper |
| `IsValidUser(string userName, string password)` | 169-179 | `bool` | **Note: this is a known bug** — line 173 compares `a.Password == a.Password` (always true). Used only by the DICOM path in `DanpheDataFilter`. |
| `GetUser(string userName, string password)` | 180-191 | `RbacUser` | Returns clone. Username case-insensitive, password is TripleDES-encrypted. |
| `GetUser(int userId)` | 192-203 | `RbacUser` | Lookup by ID |
| `UserHasPermission(int userId, string applicationCode, string permissionName)` | 204-221 | `bool` | Application-scoped check |
| `UserHasPermission(int userId, string permissionName)` | 222-235 | `bool` | App-agnostic check |
| `UserHasPermissionId(int UserId, int PermissionId)` | 236-247 | `bool` | By id |
| `GetUserAllPermissions(int userId)` | 248-279 | `List<RbacPermission>` | **The key method.** Cached as `RBAC-UserPermissions-UserId{N}`. System-admin short-circuit returns `GetAllPermissions()`. Otherwise joins user→role→roleperm→perm→app (active only). |
| `UserIsSuperAdmin(int userId)` | 281-289 | `bool` | Checks if any user role has `IsSysAdmin=true` |
| `UserHasRoleId(int UserId, int RoleId)` | 291-302 | `bool` | |
| `GetUserAllRoles(int userid)` | 303-319 | `List<RbacRole>` | |
| `GetPermissionNameById(RbacDbContext rbacDb, int CurrentVerifiersPermissionId)` | 321-324 | `string` | |
| `UpdateDefaultPasswordOfUser(string userName, string password, string confirmpassword)` | 325-351 | `RbacUser` | Returns null if current password wrong; updates and returns user on success. |
| `EncryptPassword(string Password)` | 356-372 | `string` | TripleDES-ECB-PKCS7 with `MD5("Danphesalt")` as key. **Same routine is used to encrypt SQL connection strings at startup.** |
| `DecryptPassword(string Password)` | 379-396 | `string` | |
| `CreateRole(RbacRole rbacRole, RbacDbContext rbacDbContext)` | 404-416 | `int` | Returns new RoleId |
| `CreatePermission(RbacPermission rbacPermission, RbacDbContext rbacDbContext)` | 423-435 | `int` | Returns new PermissionId |
| `ActivateDeactivateRolePermissionMap(RolePermissionMap role, bool Status, RbacUser currentUser, RbacDbContext rbacDbContext)` | 436-447 | `void` | |
| `MapRoleWithPermission(int PermissionId, int RoleId, RbacUser currentUser, RbacDbContext rbacDbContext)` | 456-478 | `void` | Creates or reactivates the mapping |
| `ActivateDeactivatePermission(RbacPermission rbacPermission, bool Status, RbacUser currentUser, RbacDbContext rbacDbContext)` | 486-517 | `void` | Also activates/deactivates all role-permission maps for this permission |
| `GetAllRoleIdsByPermissionId(int PermissionId)` | 518-522 | `List<int>` | |

**Salt constant** (`DanpheRBAC.cs:24`): `static string Salt = "Danphesalt";` — hard-coded. Used both for user passwords and for SQL connection string encryption.

---

## 4. Database Tables

The ActionFilter module reads from (and writes to, via the Security controllers) the following tables. The module does not own any new tables.

### 4.1 Main EMR Database

| Table | Mapped by | Read by filter? | Written by filter? | Notes |
|-------|-----------|:---------------:|:------------------:|-------|
| `RBAC_User` | `RbacUser` | yes (via session/JWT) | indirect (via `AccountController`) | Holds all login accounts |
| `RBAC_Permission` | `RbacPermission` | yes (in `validpermissionlist`) | yes (via `SecurityController`) | Permission catalog |
| `RBAC_Role` | `RbacRole` | yes (in user roles) | yes (via `SecurityController`) | Named role groups |
| `RBAC_MAP_UserRole` | `UserRoleMap` | yes (via `GetUserAllPermissions`) | yes (via `SecurityController`) | User→role link |
| `RBAC_MAP_RolePermission` | `RolePermissionMap` | yes (via `GetUserAllPermissions`) | yes (via `SecurityController`) | Role→permission link |
| `RBAC_Application` | `RbacApplication` | yes (in `UserHasPermission(applicationCode, ...)`) | yes (via `SecurityController`) | Application scope |
| `RBAC_RouteConfig` | `DanpheRoute` | yes (via `GetRoutesForUser`) | yes (via `SecurityController`) | Navigation routes |
| `EMP_Employee` | `EmployeeModel` | yes (RbacUser.EmployeeId) | no (HR module) | The employee master |
| `PHRM_MST_Store` | `PHRMStoreModel` | indirect (audit context) | no (Pharmacy module) | Used for store verification |
| `MST_MAP_StoreVerification` | `StoreVerificationMapModel` | indirect | no | |

### 4.2 Admin Database

| Table | Read by filter? | Written by filter? | Notes |
|-------|:---------------:|:------------------:|-------|
| `DanpheLogInInformation` | no | no (AccountController) | Every login / logout / invalid-attempt |
| `Danphe_CookieAuthInfo` | no | no (AccountController) | Remember-me selector + hashed validator |
| `SysAdmin_Parameters` | no | no (SystemAdmin module) | License, hospital code, etc. |
| `DanpheAudit` | no | no (Audit.NET provider) | Audit trail written by `RbacDbContext` (`AuditDbContext`) and any other `AuditDbContext`-derived context |

### 4.3 Schema SQL (EF → SQL Server)

`RbacDbContext.cs:31-43` declares the table mappings:

```csharp
modelBuilder.Entity<RbacApplication>().ToTable("RBAC_Application");
modelBuilder.Entity<RbacPermission>().ToTable("RBAC_Permission");
modelBuilder.Entity<DanpheRoute>().ToTable("RBAC_RouteConfig");
modelBuilder.Entity<RbacRole>().ToTable("RBAC_Role");
modelBuilder.Entity<RolePermissionMap>().ToTable("RBAC_MAP_RolePermission");
modelBuilder.Entity<RbacUser>().ToTable("RBAC_User");
modelBuilder.Entity<UserRoleMap>().ToTable("RBAC_MAP_UserRole");
modelBuilder.Entity<EmployeeModel>().ToTable("EMP_Employee");
modelBuilder.Entity<PHRMStoreModel>().ToTable("PHRM_MST_Store");
modelBuilder.Entity<StoreVerificationMapModel>().ToTable("MST_MAP_StoreVerification");
```

`RbacDbContext` itself extends `AuditDbContext` (from `Audit.EntityFramework`), which means EF changes to any of these entities are automatically captured into the `DanpheAudit` table on the admin DB.

---

## 5. Key Workflows

This section walks through the four primary workflows the ActionFilter module participates in.

### 5.1 Authentication Workflow (API, JWT-based)

```
[Angular SPA] --HTTP GET /api/Patient/Patients-->
    |
    | Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
    v
[ASP.NET pipeline] --> [RequestFormSizeLimitAttribute.OnAuthorization]
    |   - Order = 1, runs first
    |   - Sets IFormFeature with bounded FormOptions
    v
[DanpheDataFilter.OnActionExecuting]
    |   1. req.Path != "/api/Dicom"  -> normal path
    |   2. tokenFromHeader = "Bearer eyJ..."
    |   3. tokenWithoutBearer = "eyJ..."
    |   4. var jwtSecurityToken = handler.ReadJwtToken("eyJ...")
    |   5. userClaim = jwtSecurityToken.Claims
    |            .Where(c => c.Type == ENUM_ClaimTypes.currentUser)
    |            .FirstOrDefault()?.Value
    |      userClaim is the JSON-serialized RbacUser
    |   6. currentUser = DanpheJSONConvert
    |            .DeserializeObject<RbacUser>(userClaim)
    |   7. if (currentUser == null) -> JsonResult(Failed, Unauthorized)
    v
[PatientController.GetPatients(...)]   -- the actual action method
    |
    v
[InvokeHttpGetFunction(() => dbContext.Patients.ToList())]
    |   try {
    |       var result = ...;
    |       responseData.Status  = "OK";
    |       responseData.Results = result;
    |   } catch (ex) {
    |       responseData.Status       = "Failed";
    |       responseData.ErrorMessage = ex.Message;
    |   }
    v
HTTP 200 + JSON { Status: "OK", Results: [...], ErrorMessage: "" }
```

### 5.2 Authentication Workflow (API, Session-based, legacy)

For pre-JWT clients (or specific internal callers), the same `DanpheDataFilter` falls back to session lookup. Note that the current implementation (line 156-166) only reads the JWT — it does **not** also check the session. The fallback exists only for the case where `tokenFromHeader == null` and the SPA still has a valid session cookie:

```
[Legacy client] --HTTP GET /api/Patient/Patients-->
    |   (no Authorization header)
    v
[DanpheDataFilter.OnActionExecuting]
    |   - tokenFromHeader is null -> currentUser stays null
    |   - if (currentUser == null) -> JsonResult(Failed, Unauthorized)
    v
HTTP 200 + JSON { Status: "Failed", ErrorMessage: "Unauthorized Access", Results: "" }
```

> **Note:** The current code branch for the session-only path was removed in the Krishna 13-Jan-2023 JWT migration. The filter now **requires** a JWT for all non-DICOM paths.

### 5.3 Authentication Workflow (DICOM, Body-based)

The PACS `listener.exe` is a separate Win32 process that POSTs DICOM data to `/api/Dicom`. It cannot easily mint JWTs, so the filter has a special-case body-based path:

```
[listener.exe] --HTTP POST /api/Dicom, body={"dicomData":..., "currentuser": {"UserName":"...", "Password":"..."}}-->
    |
    v
[DanpheDataFilter.OnActionExecuting]
    |   req.Method == "POST" && req.Path == "/api/Dicom"  -> DICOM path
    |   1. bodyData = ReadBodyAsString(req)
    |      (Stream.Seek(0, Begin); StreamReader.ReadToEnd())
    |   2. obj = JObject.Parse(bodyData)
    |   3. currUser = DanpheJSONConvert
    |            .DeserializeObject<RbacUser>(obj["currentuser"].ToString())
    |   4. flag = RBAC.IsValidUser(currUser.UserName, currUser.Password)
    |   5. if (flag == false) -> JsonResult(Failed, Unauthorized)
    v
[DicomController.PostDicom(...)]
    |
    v
HTTP 200 + JSON { Status: "OK", Results: "...", ErrorMessage: "" }
```

> **Note:** `RBAC.IsValidUser` at `DanpheRBAC.cs:169-179` has a known bug — line 173 compares `a.Password == a.Password` (always true). This means the DICOM path is effectively **unauthenticated** in the current code. Any caller who can reach `/api/Dicom` and submit a `currentuser` JSON property with any password will pass.

### 5.4 MVC View Authorization Workflow

```
[Browser] --GET /Settings/SettingsMain-->
    |
    v
[Authentication cookie "currentuser" + "validpermissionlist" present in session]
    |
    v
[DanpheViewFilter("settings-view").OnActionExecuting]
    |   1. currentUser = Session.Get<RbacUser>("currentuser")
    |   2. if (currentUser == null) -> [falls through, no redirect, but page load fails downstream]
    |   3. validPermissionList = Session.Get<List<RbacPermission>>("validpermissionlist")
    |   4. if (validPermissionList.Count == 0) -> Redirect Account/PageNotFound
    |   5. currentPermission = validPermissionList
    |            .Find(a => a.PermissionName == "settings-view")
    |   6. if (currentPermission == null) -> Redirect Account/PageNotFound
    v
[SettingsViewController.SettingsMain()]
    |   ViewData["ConnectionString"] = connString;
    |   return View("SettingsMain");
    v
Razor view rendered
```

If the user lacks the permission:
```
HTTP 302 -> Location: /Account/PageNotFound
```

### 5.5 Audit Workflow

When `MyConfiguration.IsAuditEnable = true`, the audit chain works as follows:

```
[Controller action] --e.g. POST /api/Billing/BillTransaction-->
    |
    v
[dbContext = new BillingDbContext(connString)]   -- BillingDbContext : AuditDbContext
    |
    v
[AddAuditField(dbContext)]   -- called explicitly by the action
    |   if (IsAuditEnabled) {
    |       user = Session.Get<RbacUser>("currentuser");
    |       dbContext.AddAuditCustomField("ChangedByUserId",   user.EmployeeId);
    |       dbContext.AddAuditCustomField("ChangedByUserName", user.UserName);
    |   }
    v
[dbContext.SaveChanges()]
    |
    v
[Audit.NET interceptor writes to DanpheAudit table on admin DB]
    |   - OldValues, NewValues (JSON)
    |   - ChangedByUserId, ChangedByUserName
    |   - Timestamp, EntityType, Action (Insert/Update/Delete)
    v
[Business response] -- DanpheHTTPResponse<T> { Status: "OK", Results: ... }
```

---

## 6. API Endpoints (20+)

The ActionFilter module does not expose REST endpoints of its own. It **wraps** the endpoints of every other module. The list below catalogs the cross-cutting helpers (the module's "API surface") and the consumer endpoints where the filters are applied.

### 6.1 Filter Class Surface (3 endpoints)

| # | "Endpoint" | Type | File:Line | Purpose |
|---|------------|------|-----------|---------|
| 1 | `RequestFormSizeLimitAttribute(int valueCountLimit)` | `IAuthorizationFilter` ctor | `DanpheActionFilter.cs:30-38` | Sets form-size cap |
| 2 | `DanpheViewFilter(string permissionName)` | `ActionFilterAttribute` ctor | `DanpheActionFilter.cs:65-68` | View authorization by permission name |
| 3 | `DanpheDataFilter()` / `DanpheDataFilter(string permissionName)` | `ActionFilterAttribute` ctor | `DanpheActionFilter.cs:121-128` | API authentication (JWT) |

### 6.2 `CommonController` Surface (15 endpoints/members)

| # | Member | Returns | File:Line |
|---|--------|---------|-----------|
| 4 | `CommonController(IOptions<MyConfiguration>)` | ctor | `CommonController.cs:27-34` |
| 5 | `ReadQueryStringData(string keyname)` | `string` | `CommonController.cs:35-38` |
| 6 | `ReadPostData()` | `string` | `CommonController.cs:39-45` |
| 7 | `ReadFiles()` | `IFormFileCollection` | `CommonController.cs:46-50` |
| 8 | `ToInt(string value)` | `int` | `CommonController.cs:51-54` |
| 9 | `ToBool(string value)` | `bool` | `CommonController.cs:55-58` |
| 10 | `ToInt64(string value)` | `Int64` | `CommonController.cs:59-62` |
| 11 | `AddAuditField(dynamic dbContext)` | `dynamic` | `CommonController.cs:63-72` |
| 12 | `CreateEmpi(PatientModel obj)` | `string` | `CommonController.cs:74-102` |
| 13 | `InvokeHttpGetFunction<T>(Func<T>, string)` | `ActionResult` | `CommonController.cs:104-119` |
| 14 | `InvokeHttpGetFunctionAsync<T>(Func<Task<T>>, string)` | `Task<ActionResult>` | `CommonController.cs:121-137` |
| 15 | `InvokeHttpPostFunction<T>(Func<T>)` | `ActionResult` | `CommonController.cs:139-155` |
| 16 | `InvokeHttpPostFunctionAsync<T>(Func<T>, string)` | `Task<ActionResult>` | `CommonController.cs:157-177` |
| 17 | `InvokeHttpPostFunctionSingleTransactionScope<T>(Func<T>, DbContextTransaction)` | `ActionResult` | `CommonController.cs:179-197` |
| 18 | `InvokeHttpPutFunction<T>(Func<T>)` | `ActionResult` | `CommonController.cs:198-213` |
| 19 | `InvokeHttpPutFunctionAsync<T>(Func<T>, string)` | `Task<ActionResult>` | `CommonController.cs:216-235` |
| 20 | `InvokeHttpPutFunctionSingleTransactionScope<T>(Func<T>, DbContextTransaction)` | `ActionResult` | `CommonController.cs:237-254` |

### 6.3 `RBAC` Static Surface (26 endpoints/members)

| # | Method | Returns | File:Line |
|---|--------|---------|-----------|
| 21 | `RBAC(string connectionString, int cacheExpMinutes)` | ctor | `DanpheRBAC.cs:26-30` |
| 22 | `GetAllApplications()` | `List<RbacApplication>` | `DanpheRBAC.cs:33-43` |
| 23 | `GetAllPermissions()` | `List<RbacPermission>` | `DanpheRBAC.cs:47-58` |
| 24 | `GetAllRoles()` | `List<RbacRole>` | `DanpheRBAC.cs:60-70` |
| 25 | `GetAllUsers()` | `List<RbacUser>` | `DanpheRBAC.cs:72-82` |
| 26 | `GetAllUserRoleMaps()` | `List<UserRoleMap>` | `DanpheRBAC.cs:84-95` |
| 27 | `GetAllRolePermissionMaps()` | `List<RolePermissionMap>` | `DanpheRBAC.cs:97-107` |
| 28 | `GetAllRoutes()` | `List<DanpheRoute>` | `DanpheRBAC.cs:110-121` |
| 29 | `GetRoutesForUser(int userId, bool getHiearrchy)` | `List<DanpheRoute>` | `DanpheRBAC.cs:124-151` |
| 30 | `GetChildRouteHierarchy(...)` | `List<DanpheRoute>` | `DanpheRBAC.cs:153-168` |
| 31 | `IsValidUser(string userName, string password)` | `bool` | `DanpheRBAC.cs:169-179` |
| 32 | `GetUser(string userName, string password)` | `RbacUser` | `DanpheRBAC.cs:180-191` |
| 33 | `GetUser(int userId)` | `RbacUser` | `DanpheRBAC.cs:192-203` |
| 34 | `UserHasPermission(int userId, string applicationCode, string permissionName)` | `bool` | `DanpheRBAC.cs:204-221` |
| 35 | `UserHasPermission(int userId, string permissionName)` | `bool` | `DanpheRBAC.cs:222-235` |
| 36 | `UserHasPermissionId(int UserId, int PermissionId)` | `bool` | `DanpheRBAC.cs:236-247` |
| 37 | `GetUserAllPermissions(int userId)` | `List<RbacPermission>` | `DanpheRBAC.cs:248-279` |
| 38 | `UserIsSuperAdmin(int userId)` | `bool` | `DanpheRBAC.cs:281-289` |
| 39 | `UserHasRoleId(int UserId, int RoleId)` | `bool` | `DanpheRBAC.cs:291-302` |
| 40 | `GetUserAllRoles(int userid)` | `List<RbacRole>` | `DanpheRBAC.cs:303-319` |
| 41 | `GetPermissionNameById(RbacDbContext, int)` | `string` | `DanpheRBAC.cs:321-324` |
| 42 | `UpdateDefaultPasswordOfUser(string, string, string)` | `RbacUser` | `DanpheRBAC.cs:325-351` |
| 43 | `EncryptPassword(string Password)` | `string` | `DanpheRBAC.cs:356-372` |
| 44 | `DecryptPassword(string Password)` | `string` | `DanpheRBAC.cs:379-396` |
| 45 | `CreateRole(RbacRole, RbacDbContext)` | `int` | `DanpheRBAC.cs:404-416` |
| 46 | `CreatePermission(RbacPermission, RbacDbContext)` | `int` | `DanpheRBAC.cs:423-435` |
| 47 | `ActivateDeactivateRolePermissionMap(...)` | `void` | `DanpheRBAC.cs:436-447` |
| 48 | `MapRoleWithPermission(int, int, RbacUser, RbacDbContext)` | `void` | `DanpheRBAC.cs:456-478` |
| 49 | `ActivateDeactivatePermission(...)` | `void` | `DanpheRBAC.cs:486-517` |
| 50 | `GetAllRoleIdsByPermissionId(int PermissionId)` | `List<int>` | `DanpheRBAC.cs:518-522` |

### 6.4 Consumer Endpoints (samples — these are *gated* by the filters, not *owned* by the ActionFilter module)

| Consumer Module | Controller | Sample gated endpoint |
|-----------------|-----------|----------------------|
| Patient | `PatientController` | `GET /api/Patient/Patients`, `GET /api/Patient/PatientByPatientId` |
| Billing | `BillingTransactionController` | `POST /api/Billing/BillTransaction`, `GET /api/Billing/BillList` |
| Accounting | `AccountingController` | `GET /api/Accounting/Vouchers`, `POST /api/Accounting/Voucher` |
| Lab | `LabController` | `GET /api/Lab/LabTests`, `POST /api/Lab/LabReport` |
| Radiology | `RadiologyController` | `GET /api/Radiology/ImagingReports` |
| Pharmacy | `PharmacyController` | `POST /api/Pharmacy/Sale`, `GET /api/Pharmacy/Stock` |
| Inventory | `InventoryController` | `GET /api/Inventory/Stock`, `POST /api/Inventory/GoodsReceipt` |
| Appointment | `AppointmentController` | `GET /api/Appointment/Appointments` |
| Admission | `AdmissionController` | `POST /api/Admission/AdmitPatient` |
| HR | `EmployeeController` | `GET /api/Employee/Employees` |
| Payroll | `PayrollController` | `POST /api/Payroll/RunPayroll` |
| Insurance | `GovInsuranceController` | `POST /api/Insurance/Claim` |
| Reporting | `ReportingController` | `GET /api/Reporting/...` |
| Security | `SecurityController` | `POST /api/Security/User`, `POST /api/Security/Role` |
| DICOM | `DicomController` | `POST /api/Dicom` (special body-based auth) |
| All View Controllers | (15 of them) | `GET /<Module>/<Page>` — gated by `DanpheViewFilter` |

---

## 7. Cross-Module (every module)

The ActionFilter module is the **single dependency** that every other module has. The breakdown:

### 7.1 Controllers That Use `DanpheDataFilter` (20+)

| Module | Controller | Source line |
|--------|-----------|-------------|
| (base) | `CommonController` | `CommonController.cs:18` (class-level) |
| Accounting | `AccountingController` | `Accounting/AccountingController.cs:43` |
| Accounting | `AccountingSettingsController` | inherits `CommonController` |
| Accounting | `AccountingReportController` | inherits `CommonController` |
| Accounting | `AccLedgerMappingController` | inherits `CommonController` |
| Pharmacy | `PHRMSupplierLedgerController` | inherits `CommonController` |
| Pharmacy | `PharmacyPOController` | inherits `CommonController` |
| Reporting | `ReportingController` | inherits `CommonController` |
| Reporting | `BillingReportsController` | inherits `CommonController` |
| Reporting | `GovernmentReportingController` | inherits `CommonController` |
| Inventory | `InventoryDonationController` | inherits `CommonController` |
| NepaliReceipt | `NepaliReceiptController` | inherits `CommonController` |
| CSSD | (under `Controllers/CSSD/`) | inherits `CommonController` |
| Dispensary | (under `Controllers/Dispensary/`) | inherits `CommonController` |
| Order | `OrdersController` | inherits `CommonController` |
| Core | `CoreController`, `ParametersController` | inherit `CommonController` |
| All other ~25 controllers | — | inherit `CommonController` → automatic auth |

### 7.2 Controllers That Use `DanpheViewFilter` (15 view controllers)

| Module | View Controller | Sample permission |
|--------|----------------|-------------------|
| Account/Settings | `SettingsViewController` | `settings-view` |
| SystemAdmin | `SystemAdminViewController` | `systemadmin-view`, `systemadmin-databasebackup-view` |
| Appointment | `AppointmentViewController` | `appointment-view`, `appointment-createappointment-view`, `appointment-listappointment-view`, `appointment-listvisit-view`, `appointment-patientsearch-view`, `appointment-printsticker-view`, `appointment-visit-view` |
| Admission | `AdmissionViewController` | `adt-view`, `adt-admissionsearchpatient-view`, `adt-admittedlist-view`, `adt-createadmission-view`, `adt-dischargedlist-view` |
| Billing | `BillingViewController` | `billing-view`, `billing-deposit-view`, `billing-duplicatebillprint-view`, `billing-billcancellationrequest-view`, `billing-billorderrequest-view`, `billing-billrequest-view`, `billing-counteractivate-view`, `billing-editdoctor-view`, `billing-receiptprint-view`, `billing-searchpatient-view`, `billing-settlements-bill-settlement-view`, `billing-transaction-view`, `billing-transactionitem-view`, `billing-unpaidbills-view` |
| Clinical | `ClinicalViewController` | `clinical-scan-image-view` |
| Doctors | `DoctorsViewController` | `doctors-notes-view`, `doctors-outpatientdoctor-view`, `doctors-patientoverview-view`, `doctors-patientoverviewmain-view`, `doctors-patientvisithistory-view` |
| Lab | `LabViewController` | `lab-settings-view` |
| Nursing | `NursingViewController` | `nursing-order-list-view`, `nursing-order-view` |
| Patient | `PatientViewController` | `patient-view`, `patient-register-view`, `patient-register-address-view`, `patient-register-guarantor-view`, `patient-register-insurance-view`, `patient-register-kinemergencycontact-view`, `patient-searchpatient-view` |
| Pharmacy | `PharmacyViewController` | `pharmacy-view` + 14 sub-views (`pharmacy-billingmain-view`, `pharmacy-ordermain-view`, `pharmacy-patient-view`, `pharmacy-sale-view`, `pharmacy-settingmain-view`, `pharmacy-stockmain-view`, `pharmacy-suppliermanage-view`, `pharmacy-prescription-view`, `pharmacymain-view`, `pharmacy-prescriptiongmain-view`, `pharmacy-salemain-view`, `pharmacy-prescription-list-view`, `pharmacy-sale-list-view`, `pharmacy-sale-return-view`, `pharmacy-patientlist-view`, `pharmacy-patientmain-view`) |
| Reporting | `ReportingController` / `GovernmentReportingController` | `reports-view` + 22 sub-views (e.g. `reports-billingmain-view`, `reports-labmain-view`, `reports-radiologymain-view`, `reports-appointmentmain-view`, `reports-admissionmain-view`, `reports-doctorsmain-view`) |
| Ward Supply | `WardSupplyViewController` | `wardsupply-consumption-view`, `wardsupply-consumption-List-view`, `wardsupply-requisition-view`, `wardsupply-stock-view` |
| Other | `OPDViewController` (and others) | `opd-summary-view`, `government-view` |

**Count:** 105 individual `DanpheViewFilter` decorations across 15 view controllers, gating 100+ distinct permission names.

### 7.3 Controllers That Use `RequestFormSizeLimitAttribute` (1 explicit, 1 base)

| Module | Controller | Limit | Source line |
|--------|-----------|------:|-------------|
| (base) | `CommonController` | `1,000,000` | `CommonController.cs:17` |
| Accounting | `AccountingController` | `100,000` | `Accounting/AccountingController.cs:42` |

All other controllers inherit the `1,000,000` cap from `CommonController`.

### 7.4 Module Dependency Diagram

```
                  +----------------------+
                  |   ActionFilter       |
                  |  (this module)       |
                  +-----------+----------+
                              |
       +----------------------+----------------------+
       |                      |                      |
       v                      v                      v
+--------------+    +-------------------+   +-----------------+
| DanpheData-  |    |  DanpheView-      |   | RequestForm-    |
| Filter       |    |  Filter           |   | SizeLimit       |
| (JWT auth)   |    |  (perm check)     |   | Attribute       |
+------+-------+    +---------+---------+   +--------+--------+
       |                      |                      |
       v                      v                      v
+--------------------------------------------------------------------+
|  ALL 35+ business controllers (Patient, Billing, Lab, Pharmacy,    |
|  Accounting, Inventory, Appointment, Admission, HR, Payroll,       |
|  Insurance, Reporting, Security, Radiology, etc.)                   |
+--------------------------------------------------------------------+
       |
       v
+--------------------------------------------------------------------+
|  ALL 15 view controllers (Settings, SystemAdmin, Appointment,     |
|  Admission, Billing, Clinical, Doctors, Lab, Nursing, Patient,     |
|  Pharmacy, Reporting, WardSupply, OPD, Government)                 |
+--------------------------------------------------------------------+
```

### 7.5 Session / JWT Variables This Module Defines

| Variable | Type | Set by | Read by |
|----------|------|--------|---------|
| `HttpContext.Session["currentuser"]` | `RbacUser` | `AccountController.SetSessionVariable` | `DanpheViewFilter` (line 76), `CommonController.AddAuditField` (line 67) |
| `HttpContext.Session["validpermissionlist"]` | `List<RbacPermission>` | `AccountController.SetSessionVariable` | `DanpheViewFilter` (line 80) |
| `HttpContext.Session["user-roles"]` | `List<RbacRole>` | `AccountController.SetSessionVariable` | Angular client |
| `HttpContext.Session["validRouteList"]` | `List<DanpheRoute>` | `AccountController.SetSessionVariable` | Angular `AuthGuardService` (commented in `SettingsViewController.cs:26-46`) |
| JWT claim `ENUM_ClaimTypes.currentUser` | JSON-serialized `RbacUser` | `AccountController.GenerateJwtToken` | `DanpheDataFilter` (line 163) |

### 7.6 Filters This Module Does NOT Have (notable absences)

| Concern | How it's handled today | Filter exists? |
|---------|------------------------|:--------------:|
| Global exception handler filter | Per-method try/catch in `InvokeHttp*Function` | No |
| Action-level result filter (response wrapping at pipeline level) | Per-method wrapper call | No |
| Rate limiting | None (relies on network perimeter) | No |
| Request logging / correlation ID | None | No |
| API method-level authorization (per-route, not just auth) | `DanpheDataFilter` accepts `permissionName` ctor arg but the check is **commented out** (lines 182-203). Comment: *"Nagesh- 29 Aug 2017- Commented because we are not checking permission level for api call, only checking is Authenticated user or not"*. | No |
| Anti-forgery token validation on API | Not on REST; only on MVC form post (`Account/Login`) | No |
| CORS | Configured at `Startup.cs` level, not via attribute | No |
| Output caching | None | No |

---

## 8. Business Rules

This section codifies the invariants enforced (or assumed) by the ActionFilter module.

### 8.1 Authentication Rules

| # | Rule | Source |
|---|------|--------|
| 1 | Every REST endpoint under `/api/*` requires a valid JWT in the `Authorization` header. The header must start with `Bearer ` and the token must parse with `JwtSecurityTokenHandler`. | `DanpheActionFilter.cs:157-162` |
| 2 | The JWT must contain a claim with `Type == ENUM_ClaimTypes.currentUser` (value `"currentUser"`). The claim value must be a JSON-serialized `RbacUser` that deserializes without throwing. | `DanpheActionFilter.cs:163-164`, `SharedEnums.cs:394-397` |
| 3 | The DICOM path (`POST /api/Dicom`) is the only exception. It requires a `currentuser` JSON property in the request body with a valid `RbacUser` whose `(UserName, Password)` passes `RBAC.IsValidUser`. | `DanpheActionFilter.cs:141-151` |
| 4 | On any authentication failure, the filter returns HTTP 200 (not 401) with body `{ Status: "Failed", ErrorMessage: "Unauthorized Access", Results: "" }`. Clients must inspect `Status` to detect failure. | `DanpheActionFilter.cs:171-172, 179-180` |
| 5 | The `Authorization` header is read as a single string and split on space (`Split(' ')[1]`). If the header has only one segment, this throws `IndexOutOfRangeException`, which is caught by the outer `try/catch` and converted to "Unauthorized Access". | `DanpheActionFilter.cs:160` |
| 6 | `AccountController` does **not** inherit `CommonController` and is the deliberate exception to the auth gate, so that login endpoints are reachable by anonymous users. | `AccountController.cs:32` |

### 8.2 Authorization Rules

| # | Rule | Source |
|---|------|--------|
| 7 | Every MVC view action decorated with `[DanpheViewFilter("X")]("X")]` requires the logged-in user to have a `RbacPermission` in their session `validpermissionlist` with `PermissionName == "X"`. | `DanpheActionFilter.cs:80-88` |
| 8 | If the permission is not found, the user is redirected (302) to `Account/PageNotFound`. The response body is the standard Angular "UnAuthorize" page. | `DanpheActionFilter.cs:88, 94` |
| 9 | If `validpermissionlist` is empty or null (no user logged in or permissions not hydrated), the user is also redirected to `Account/PageNotFound`. | `DanpheActionFilter.cs:92-94` |
| 10 | A user whose `UserRoleMap` links them to a role with `IsSysAdmin = true` is treated as having **all** permissions in **all** applications. `RBAC.GetUserAllPermissions` short-circuits and returns `GetAllPermissions()`. | `DanpheRBAC.cs:253-258` |
| 11 | `RBAC.GetUserAllPermissions` joins: `UserRoleMap (IsActive=true) → RbacRole → RolePermissionMap (IsActive=true) → RbacPermission → RbacApplication (IsActive=true)`. Any inactive link in the chain causes the permission to be omitted. | `DanpheRBAC.cs:261-273` |
| 12 | API endpoints do **not** enforce per-method permissions. The `apiPermissionName` field on `DanpheDataFilter` exists but the check is commented out. Fine-grained authorization is delegated to the Angular `rbac-permission` directive and `AuthGuardService`. | `DanpheActionFilter.cs:182-203` |

### 8.3 Form / Payload Rules

| # | Rule | Source |
|---|------|--------|
| 13 | Every form-key and form-value in the request body is capped at `valueCountLimit` characters. The default cap is `1,000,000` (inherited from `CommonController`); `AccountingController` overrides to `100,000` to protect against large voucher payloads. | `CommonController.cs:17`, `AccountingController.cs:42` |
| 14 | If the form has already been read by an earlier filter, `RequestFormSizeLimitAttribute` does not re-apply the cap (it only sets it the first time the feature is fetched). | `DanpheActionFilter.cs:47-51` |
| 15 | `RequestFormSizeLimitAttribute` runs with `Order = 1`, giving it the earliest hook before any other authorization logic. | `CommonController.cs:17` |

### 8.4 Caching Rules

| # | Rule | Source |
|---|------|--------|
| 16 | The entire users / roles / permissions / routes / user-role / role-permission lists are cached in-process under fixed keys (`"RBAC-Apps-All"`, `"RBAC-UserPermissions-UserId42"`, etc.). TTL comes from `MyConfiguration.CacheExpirationMinutes` (set in `appsettings.json`). | `DanpheRBAC.cs:33-121, 250-275` |
| 17 | Cache is never invalidated manually — when a role-permission mapping is changed, the change only takes effect after the TTL expires (or app restart). | `DanpheRBAC.cs:436-517` |
| 18 | `RBAC.GetUser` returns a `MemberwiseClone()` of the cached user, so the cached instance cannot be mutated by callers. | `DanpheRBAC.cs:186-202, RbacUser.cs:32-35` |

### 8.5 Response Envelope Rules

| # | Rule | Source |
|---|------|--------|
| 19 | Every controller action must return either an `ActionResult` containing a JSON-serialized `DanpheHTTPResponse<T>`, or a raw string. The standard pattern is to call one of the seven `InvokeHttp*Function` wrappers from `CommonController`. | `CommonController.cs:104-254` |
| 20 | `Status` is always either `"OK"` or `"Failed"`. Any other value indicates a programming error. | `ENUM_Danphe_HTTP_ResponseStatus`, `SharedEnums.cs:280-284` |
| 21 | The HTTP status code is **always 200**. Callers must check `Status` to detect failure. There is no use of HTTP 4xx / 5xx in the ActionFilter layer (only the global error handler in `Startup.cs` may emit 500s). | All `Invoke*` wrappers return `Ok(...)` |
| 22 | `ErrorMessage` contains the raw `ex.Message` from any caught exception. This may leak internal details (table names, SQL fragments, stack info) — a known security smell that the wrapper pattern inherits. | All `Invoke*` wrappers |
| 23 | `InvokeHttpPostFunctionSingleTransactionScope` and `InvokeHttpPutFunctionSingleTransactionScope` commit on success and roll back on any exception. The caller must pass an open `DbContextTransaction`. | `CommonController.cs:179-197, 237-254` |

### 8.6 Audit Rules

| # | Rule | Source |
|---|------|--------|
| 24 | Audit is **opt-in per request**. The action method must explicitly call `AddAuditField(dbContext)` before `SaveChanges()`. Skipping this call results in audit entries with no `ChangedByUserId` / `ChangedByUserName`. | `CommonController.cs:63-72` |
| 25 | When `MyConfiguration.IsAuditEnable = false`, `AddAuditField` is a no-op (returns the dbContext unchanged). The audit interceptor in `RbacDbContext : AuditDbContext` will still record entity changes, but the user-attribution fields will be empty. | `CommonController.cs:65` |
| 26 | Every `DbContext` that extends `AuditDbContext` (including `RbacDbContext`) automatically writes change records to the `DanpheAudit` table on the admin DB on `SaveChanges()`. | `RbacDbContext.cs:10`, `Audit.EntityFramework` package |

### 8.7 EMPI Rules

| # | Rule | Source |
|---|------|--------|
| 27 | The EMPI is a 16-character string: 3-char district + 6-char DOB (`ddMMyy`) + 3-char name initials (F-M-L, "X" if no middle name) + 4-digit random number (1000-9999). | `CommonController.cs:74-102` |
| 28 | The district code is the first 3 characters of `CountrySubDivisionName` (state/province). The lookup is performed in the master DB, not the main EMR DB. | `CommonController.cs:79-86` |
| 29 | The middle-name initial is replaced with `"X"` if the middle name is null or empty. | `CommonController.cs:90` |
| 30 | The random component uses `new Random()` (not a cryptographic RNG) — collisions are possible in theory. | `CommonController.cs:93` |
| 31 | The generated EMPI is uppercased before being assigned to `obj.EMPI`. | `CommonController.cs:100` |

### 8.8 Password Crypto Rules

| # | Rule | Source |
|---|------|--------|
| 32 | Passwords are stored encrypted with TripleDES in ECB mode, PKCS7 padding, using `MD5("Danphesalt")` as the key. The result is Base64-encoded. | `DanpheRBAC.cs:356-372` |
| 33 | The salt `"Danphesalt"` is hard-coded as a static string and is the same for every installation. | `DanpheRBAC.cs:24` |
| 34 | The same `EncryptPassword` / `DecryptPassword` routine is used to encrypt and decrypt SQL connection strings at startup. A change to the routine breaks both user auth and DB connectivity simultaneously. | `DanpheRBAC.cs:356-396` + `Startup.cs` (calls `DecryptPassword` for connection strings) |
| 35 | Passwords are **not** salted per-user — the salt is global. This makes the system vulnerable to rainbow-table attacks. | `DanpheRBAC.cs:24` |

### 8.9 Known Bugs and Inconsistencies

| # | Issue | Source | Impact |
|---|-------|--------|--------|
| 1 | `RBAC.IsValidUser` compares `a.Password == a.Password` (always true). | `DanpheRBAC.cs:173` | The DICOM auth path (`POST /api/Dicom`) is effectively unauthenticated. Any caller can submit any `currentuser` with any password and pass. |
| 2 | `DanpheDataFilter` has a constructor parameter `permissionName` that is never used (the check logic is commented out). | `DanpheActionFilter.cs:182-203` | API endpoints are not authorized at the server. All clients that hold a valid JWT can call any API method, regardless of role/permission. |
| 3 | `DanpheViewFilter` does not handle the case where `validPermissionList` is null (the `Count` access would throw NRE). | `DanpheActionFilter.cs:81` | A user who somehow has `currentuser` in session but no `validpermissionlist` would see an unhandled exception page. |
| 4 | `CommonController.ReadPostData` calls `Request.Body` which is forward-only. If any prior filter has read the body, this returns empty. | `CommonController.cs:39-45` | Two-stage read patterns (filter reads + controller reads) are unreliable. The DICOM path works around this with `Request.Body.Seek(0, Begin)`. |
| 5 | `InvokeHttp*Function` wrappers serialize through `DanpheJSONConvert.SerializeObject(DeserializeObject(SerializeObject(responseData, true)))` — a redundant double-serialize that masks EF proxy reference cycles. | `CommonController.cs:118, 154, 196, 212` | Performance cost on every response; workaround for an underlying EF `DbContext` issue. |
| 6 | `RequestFormSizeLimitAttribute` does not enforce the cap — it only sets the `FormOptions`. If the bound limit is exceeded, ASP.NET Core throws `InvalidDataException`, which propagates as a 500 error. | `DanpheActionFilter.cs:42-52` | No graceful 400 response. |

---

## Appendix A — Permission-Name Inventory (from `DanpheViewFilter`)

The 100+ permission names currently gated by `DanpheViewFilter` across the 15 view controllers, grouped by module. The list below is the canonical set; a new permission must be added here AND mapped to a role in `RBAC_MAP_RolePermission` before any user can see the page.

| Module | Permission names |
|--------|------------------|
| ADT (Admission) | `adt-view`, `adt-admissionsearchpatient-view`, `adt-admittedlist-view`, `adt-createadmission-view`, `adt-dischargedlist-view` |
| Appointment | `appointment-view`, `appointment-visit-view`, `appointment-createappointment-view`, `appointment-listappointment-view`, `appointment-listvisit-view`, `appointment-patientsearch-view`, `appointment-printsticker-view` |
| Billing | `billing-view`, `billing-deposit-view`, `billing-duplicatebillprint-view`, `billing-billcancellationrequest-view`, `billing-billorderrequest-view`, `billing-billrequest-view`, `billing-counteractivate-view`, `billing-editdoctor-view`, `billing-receiptprint-view`, `billing-searchpatient-view`, `billing-settlements-bill-settlement-view`, `billing-transaction-view`, `billing-transactionitem-view`, `billing-unpaidbills-view` |
| Clinical | `clinical-scan-image-view` |
| Doctors | `doctors-notes-view`, `doctors-outpatientdoctor-view`, `doctors-patientoverview-view`, `doctors-patientoverviewmain-view`, `doctors-patientvisithistory-view` |
| Government | `government-view` |
| Lab | `lab-settings-view` |
| Nursing | `nursing-order-list-view`, `nursing-order-view` |
| OPD | `opd-summary-view` |
| Patient | `patient-view`, `patient-register-view`, `patient-register-address-view`, `patient-register-guarantor-view`, `patient-register-insurance-view`, `patient-register-kinemergencycontact-view`, `patient-searchpatient-view` |
| Pharmacy | `pharmacymain-view`, `pharmacy-view`, `pharmacy-billingmain-view`, `pharmacy-ordermain-view`, `pharmacy-patient-view`, `pharmacy-patientlist-view`, `pharmacy-patientmain-view`, `pharmacy-prescription-list-view`, `pharmacy-prescription-view`, `pharmacy-prescriptiongmain-view`, `pharmacy-sale-list-view`, `pharmacy-sale-return-view`, `pharmacy-sale-view`, `pharmacy-salemain-view`, `pharmacy-settingmain-view`, `pharmacy-stockmain-view`, `pharmacy-suppliermanage-view` |
| Reports | `reports-view`, `reports-admissionmain-view`, `reports-admissionmain-diagnosiswisepatientreport-view`, `reports-admissionmain-transferredpatient-view`, `reports-appointmentmain-view`, `reports-appointmentmain-dailyappointmentreport-view`, `reports-appointmentmain-departmentwiseappointmentreport-view`, `reports-appointmentmain-districtwiseappointmentreport-view`, `reports-appointmentmain-doctorwiseoutpatient-view`, `reports-appointmentmain-phonebookappointmentreport-view`, `reports-billingmain-view`, `reports-billingmain-departmentsummaryreport-view`, `reports-billingmain-dischargedpatient-view`, `reports-billingmain-patientbillhistory-view`, `reports-billingmain-patientcensusreport-view`, `reports-billingmain-patientcreditsummary-view`, `reports-billingmain-totaladmittedpatient-view`, `reports-doctorsmain-view`, `reports-doctorsmain-doctorwiseencounterpatientreport-view`, `reports-lab-itemwiselabreport-view`, `reports-labmain-categorywiselabreport-view`, `reports-labmain-totalrevenuefromlab-view`, `reports-labmain-view`, `reports-laboratoryservices-view`, `reports-radiologymain-categorywiseimagingreport-view`, `reports-radiologymain-revenuegenerated-view`, `reports-radiologymain-view` |
| Settings | `settings-view`, `settings-adtmanage-view`, `settings-clinicalmanage-view`, `settings-departmentsmanage-view`, `settings-employeemanage-view`, `settings-geolocationmanage-view`, `settings-radiologymanage-view`, `ssettings-securitymanage-view` |
| SystemAdmin | `systemadmin-view`, `systemadmin-databasebackup-view` |
| WardSupply | `wardsupply-consumption-view`, `wardsupply-consumption-List-view`, `wardsupply-requisition-view`, `wardsupply-stock-view` |

## Appendix B — CommonController Inheritance Map

Every business controller inherits `CommonController` and therefore inherits:

- `[RequestFormSizeLimit(valueCountLimit: 1000000, Order = 1)]`
- `[DanpheDataFilter()]`
- `[Route("api/[controller]")]`
- `protected readonly string connString`
- `protected readonly string connStringAdmin`
- `protected readonly string connStringPACSServer`
- `protected readonly bool IsAuditEnabled`
- All 7 `InvokeHttp*Function` wrappers
- All 6 read/convert helpers
- `AddAuditField` and `CreateEmpi`

The 35+ derived controllers (representative sample) include:

- `Patient/PatientController` (2394 lines)
- `Billing/BillingTransactionController`, `Billing/DischargeBillingController`, `Billing/InsuranceBillingController`, `Billing/BillSettlementsController`
- `Accounting/AccountingController` (6146 lines), `Accounting/AccountingSettingsController`, `Accounting/AccountingReportController`, `Accounting/AccLedgerMappingController`
- `Pharmacy/PharmacyController`, `Pharmacy/PharmacyPOController`, `Pharmacy/PHRMSupplierLedgerController`, `Pharmacy/PharmacySaleController`
- `Lab/LabController`, `Radiology/RadiologyController`
- `Inventory/InventoryController`, `Inventory/InventoryDonationController`
- `Appointment/AppointmentController`, `Appointment/VisitController`
- `Admission/AdmissionController`, `Emergency/EmergencyController`
- `Employee/EmployeeController`, `Payroll/PayrollController`
- `Insurance/GovInsuranceController`
- `Reporting/ReportingController`, `Reporting/BillingReportsController`, `Reporting/GovernmentReportingController`
- `CSSD/CSSDController`
- `NepaliReceipt/NepaliReceiptController`
- `Maternity/MaternityController`
- `Dispensary/DispensaryController`
- `Order/OrdersController`
- `Incentive/IncentiveController`
- `Core/CoreController`, `Core/ParametersController`
- `Security/SecurityController`, `Security/SecuritySettingsController`
- `Master/MasterController`
- `Account/AccountController` (**does NOT inherit CommonController** — the deliberate exception for unauthenticated login)
