# ProcessConfirmation Module

> Reference documentation derived from the DanpheEMR .NET source tree at
> `DanpheEMR reference/Code/`. This module is the centralized "supervisor /
> authority re-confirmation" mechanism that high-risk transactional pages use to
> require a second, privileged user to type their credentials before a sensitive
> write is allowed. It is the only public surface in the codebase that performs
> password-based step-up authentication against the RBAC user store on demand.

---

## 1. Module Overview

ProcessConfirmation is a deliberately small **shared utility service** exposed
under `POST /api/ProcessConfirmation/ConfirmProcess`. Its single job is to
answer one question:

> "Given a username, a password, and the name of a system-generated
> permission — is this an active, currently valid RBAC user that holds that
> permission?"

It exists to support the pattern where a low-privileged operator is about to
trigger a high-risk workflow (issuing a Scheme Refund, raising a Billing
Invoice Return / Credit Note) and the system must collect a second factor
from a privileged witness before the write can proceed. The privileged
witness is expected to be a separate human being at the same workstation; the
operator's own password is *not* accepted because that would defeat the
two-person rule.

The pattern is rendered in the Angular UI as a modal dialog
(`<process-confirmation>`) that takes the operator out of the normal flow
until a witness types their credentials. On success the parent component
re-runs the original save action (`SaveSchemeRefund`, `SubmitCreditNote`,
etc.); on cancel the modal is closed and the action is aborted.

### Key properties

- **Stateless and idempotent** — there is no session, token, or nonce. The
  endpoint is safe to call repeatedly for the same logical write; it has no
  side effects.
- **Password-based, not session-based** — the witness re-types their password
  rather than reusing the current session JWT, so the witness can be a
  different user than the logged-in operator. The check is performed against
  the full RBAC user list (`RBAC.GetAllUsers()`) and is not tied to
  `DanpheHTTPContext.Current` / the request principal.
- **Permission-name driven** — the only thing the caller passes is a string
  permission name (e.g. `scheme-refund-confirmation-process`,
  `billing-invoice-return-process`). The endpoint looks the permission up in
  the user's permission set, not by RoleId. This means the witness's role
  assignment is what matters, not a per-process RoleId lookup.
- **UI lives in `UtilitiesSharedModule`** — the modal component is declared
  and exported by the shared `UtilitiesSharedModule`, so any feature module
  that imports it can drop the modal into its own template with one tag.
- **Does not log the witness's password** — only the outcome (`isValid` /
  exception message) is propagated. The credentials DTO is constructed
  in-memory and never persisted.

### Module composition

| Layer | File | LOC | Purpose |
|------|------|----:|---------|
| Controller | `Controllers/ProcessConfirmationController.cs` | 34 | Single `POST /ConfirmProcess` endpoint, delegates to the service. |
| Service | `Services/ProcessConfirmation/ProcessConfirmationService.cs` | 30 | Business logic: null check, RBAC credential check, permission check. |
| Interface | `Services/ProcessConfirmation/IProcessConfirmationService.cs` | 11 | DI contract. |
| DTO | `Services/ProcessConfirmation/DTO/ProcessConfirmationUserCredentials_DTO.cs` | 9 | `{ Username, Password, PermissionName }` request body. |
| Server model | `Components/DanpheEMR.ServerModel/Utilities/ProcessConfirmationRolesPermissionModel.cs` | 13 | EF entity mapped to `UTL_CFG_ProcessConfirmationAuthority`. |
| DbContext registration | `Components/DanpheEMR.DalLayer/UtilitiesDbContext.cs` | 66 | Declares `DbSet<ProcessConfirmationAuthorityModel> ProcessConfirmationAuthorities` and maps the table. |
| Frontend modal | `wwwroot/DanpheApp/src/app/utilities/shared/process-confirmation/process-confirmation.component.{ts,html}` | 51 + 28 | Modal that captures credentials and emits a callback. |
| Frontend DTO | `wwwroot/DanpheApp/src/app/utilities/shared/DTOs/process-confirmation-userCredentials.dto.ts` | 5 | Mirrors the .NET DTO. |
| Frontend BL | `wwwroot/DanpheApp/src/app/utilities/shared/utilities.bl.service.ts` | 113 | `ConfirmProcess(...)` thin pass-through. |
| Frontend DL | `wwwroot/DanpheApp/src/app/utilities/shared/utilities.dl.service.ts` | 80 | `http.post('/api/ProcessConfirmation/ConfirmProcess', ...)` call. |
| Frontend module | `wwwroot/DanpheApp/src/app/utilities/shared/utilities-shared.module.ts` | 39 | Declares + exports `ProcessConfirmationComponent`. |
| Enums | `wwwroot/DanpheApp/src/app/shared/shared-enums.ts` | n/a | `ENUM_ProcessConfirmationActions`, `ENUM_ProcessesToConfirmDisplayNames`. |

### Notable gap to flag for migration

The .NET `ProcessConfirmationAuthorityModel` is mapped to table
`UTL_CFG_ProcessConfirmationAuthority` via `UtilitiesDbContext.OnModelCreating`,
but the **DB DDL is not present in any of the SQL scripts shipped under
`DanpheEMR reference/Database/`**. The `ConfirmProcess` service does **not**
read from this table at runtime — it queries `RBAC.GetAllUsers()` and
`RBAC.GetUserAllPermissions(...)` directly — so the table is effectively a
configured-permission registry without an active reader. In the Cloudflare
migration, the entity should either be dropped (if no UI ever lists "which
permissions are wired up as step-up authorities") or paired with an
authoring screen + a `ProcessConfirmationAuthority` service that
cross-references the permission name.

---

## 2. Backend Files

All paths are relative to `DanpheEMR reference/Code/`.

### 2.1 Controller

| File | Path | LOC | Purpose |
|------|------|----:|---------|
| `ProcessConfirmationController.cs` | `Websites/DanpheEMR/Controllers/ProcessConfirmationController.cs` | 34 | Thin MVC controller — single `POST ConfirmProcess` action. Inherits `CommonController` (which provides `InvokeHttpPostFunction` for standard error / response wrapping). |

**`ProcessConfirmationController.cs`** (verbatim, line references preserved):

```
1   using DanpheEMR.Core.Configuration;
2   using DanpheEMR.DalLayer;
3   using DanpheEMR.Security;
4   using DanpheEMR.Services.ProcessConfirmation;
5   using DanpheEMR.Services.ProcessConfirmation.DTO;
6   using Microsoft.AspNetCore.Http;
7   using Microsoft.AspNetCore.Mvc;
8   using Microsoft.Extensions.Options;
9   using System;
10  using System.Collections.Generic;
11  using System.Linq;
12  using System.Web.Security;
13
14  namespace DanpheEMR.Controllers
15  {
16      public class ProcessConfirmationController : CommonController
17      {
18          private readonly IProcessConfirmationService _processConfirmationService;
19
20          public ProcessConfirmationController(IOptions<MyConfiguration> _config, IProcessConfirmationService processConfirmationService) : base(_config)
21          {
22              _processConfirmationService = processConfirmationService;
23          }
24
25          [HttpPost]
26          [Route("ConfirmProcess")]
27          public IActionResult PostConfirmProcess([FromBody] ProcessConfirmationUserCredentials_DTO processConfirmationUserCredentials)
28          {
29              Func<object> func = () => _processConfirmationService.ConfirmProcess(processConfirmationUserCredentials);
30              return InvokeHttpPostFunction(func);
31          }
32      }
33  }
```

#### 2.1.1 Key methods

| Method | HTTP / Route | Visibility | Purpose |
|--------|--------------|------------|---------|
| `PostConfirmProcess(ProcessConfirmationUserCredentials_DTO)` | `POST /api/ProcessConfirmation/ConfirmProcess` | Public (no `[DanpheViewFilter]` / no controller-level authorize attribute on the class) | Validates the request body, wraps the service call in `Func<object>` and delegates to the inherited `InvokeHttpPostFunction` to apply standard success / error response shaping. |

There is **no authorization attribute on the controller class**. The endpoint
relies entirely on the fact that it is an idempotent read; it never mutates
state. The only way it can be abused is to enumerate valid (username,
permission) pairs through timing, which is mitigated by the same in-memory
RBAC user list every other login path uses.

### 2.2 Service layer

| File | Path | LOC | Purpose |
|------|------|----:|---------|
| `IProcessConfirmationService.cs` | `Websites/DanpheEMR/Services/ProcessConfirmation/IProcessConfirmationService.cs` | 11 | Interface — single method `object ConfirmProcess(...)`. |
| `ProcessConfirmationService.cs` | `Websites/DanpheEMR/Services/ProcessConfirmation/ProcessConfirmationService.cs` | 30 | Implementation. |
| `DTO/ProcessConfirmationUserCredentials_DTO.cs` | `Websites/DanpheEMR/Services/ProcessConfirmation/DTO/ProcessConfirmationUserCredentials_DTO.cs` | 9 | DTO carried in the request body. |

#### 2.2.1 `IProcessConfirmationService`

```csharp
public interface IProcessConfirmationService
{
    object ConfirmProcess(ProcessConfirmationUserCredentials_DTO processConfirmationUserCredentials);
}
```

The return type is `object` because it may be either a `bool` (the
permission check result) or a thrown exception; the caller in the controller
wraps it via `InvokeHttpPostFunction` which serializes the `object` as JSON
and writes the standard Danphe response envelope. Returning `bool` directly
would have worked equally well — `object` is a leftover from an early
prototype that considered returning richer payloads.

#### 2.2.2 `ProcessConfirmationService.ConfirmProcess`

```csharp
public object ConfirmProcess(ProcessConfirmationUserCredentials_DTO processConfirmationUserCredentials)
{
    // 1. Null guard.
    if (processConfirmationUserCredentials == null)
    {
        throw new ArgumentNullException("Could not Confirm Process");
    }

    // 2. RBAC credential check.
    RbacUser validUser = RBAC.GetUser(processConfirmationUserCredentials.Username,
                                      processConfirmationUserCredentials.Password);
    if (validUser == null || validUser.IsActive == false)
    {
        throw new Exception("User is not valid");
    }

    // 3. Permission check.
    var isValid = RBAC.UserHasPermission(validUser.UserId,
                                         processConfirmationUserCredentials.PermissionName);

    return isValid;
}
```

Step-by-step:

1. **Null guard** — if the JSON body is empty / unparseable, an
   `ArgumentNullException` is raised. `InvokeHttpPostFunction` converts it to
   a 400 with the exception message.
2. **Credential check** — calls
   `DanpheEMR.Security.RBAC.DanpheRBAC.GetUser(string userName, string password)`
   (`DanpheEMR.Security/RBAC/DanpheRBAC.cs:180-191`). That method:
   - Loads the full RBAC user list via `RBAC.GetAllUsers()` (cached per
     request lifecycle).
   - Compares `UserName` case-insensitively.
   - Compares the supplied password against `RBAC.EncryptPassword(password)`
     (the on-disk passwords are stored encrypted, so the comparison is
     encrypted-vs-encrypted).
   - Returns a **clone** of the `RbacUser` on success, or `null` on
     failure. The clone prevents accidental mutation of the cached user
     list.
3. **Active check** — even if the credentials match, the user must have
   `IsActive == true`. Disabled users are rejected with the same generic
   "User is not valid" message.
4. **Permission check** — calls
   `RBAC.UserHasPermission(int userId, string permissionName)`
   (`DanpheRBAC.cs:222-235`). This method pulls the user's full
   permission list via `RBAC.GetUserAllPermissions(userId)` and filters
   in-memory by `PermissionName == permissionName`. The application code
   is **not** part of the filter — the permission name is treated as
   globally unique, which matches the convention used in the rest of the
   codebase (`'scheme-refund-confirmation-process'`,
   `'billing-invoice-return-process'`, etc.).
5. **Return** — the `bool` result is returned up the stack. The Angular
   caller treats `true` as authorization-granted and any other value
   (including exceptions) as denied.

### 2.3 DTO

`ProcessConfirmationUserCredentials_DTO.cs`:

```csharp
namespace DanpheEMR.Services.ProcessConfirmation.DTO
{
    public class ProcessConfirmationUserCredentials_DTO
    {
        public string Username { get; set; }
        public string Password { get; set; }
        public string PermissionName { get; set; }
    }
}
```

All three fields are required by the controller contract but are not enforced
by the DTO — the service performs the null check on the DTO as a whole and
treats empty `Username` / `Password` / `PermissionName` as a credential
mismatch (`RBAC.GetUser` will return null).

### 2.4 Server model

`ProcessConfirmationRolesPermissionModel.cs`:

```csharp
namespace DanpheEMR.ServerModel.Utilities
{
    public class ProcessConfirmationAuthorityModel
    {
        [Key]
        public int ProcessConfirmationAuthorityId { get; set; }
        public string ProcessToConfirm { get; set; }
        public int PermissionId { get; set; }
        public int RoleId { get; set; }
    }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `ProcessConfirmationAuthorityId` | `int` | Primary key, `[Key]`. |
| `ProcessToConfirm` | `string` | Free-form human-readable process name (e.g. `"Scheme Refund"`, `"Billing Invoice Return"`). |
| `ProcessConfirmationAuthorityId` | `int` | Identifies which role is allowed to authorize the process. |

The class name is `ProcessConfirmationRolesPermissionModel.cs` but the class
inside it is `ProcessConfirmationAuthorityModel` — a naming inconsistency in
the reference code. In the Cloudflare migration the canonical name should
be `ProcessConfirmationAuthority`.

### 2.5 DbContext registration

`UtilitiesDbContext.cs` (excerpt):

```csharp
public DbSet<ProcessConfirmationAuthorityModel> ProcessConfirmationAuthorities { get; set; }
// ...
modelBuilder.Entity<ProcessConfirmationAuthorityModel>().ToTable("UTL_CFG_ProcessConfirmationAuthority");
```

`UtilitiesDbContext` is a single multi-purpose `DbContext` that also owns
Scheme Refund, Fiscal Year, Visit, Deposit, Payment Mode, Credit
Organization, Scheme, Employee, and Patient entities (see
`Components/DanpheEMR.DalLayer/UtilitiesDbContext.cs`). The
`ProcessConfirmationAuthorities` `DbSet` is declared but **never queried** by
the live service code — the table exists as a config-side artifact only.

### 2.6 DI registration

`DependencyInjection/DanpheServicesExtensions.cs:71`:

```csharp
services.AddTransient<IProcessConfirmationService, ProcessConfirmationService>();
```

Registered as `Transient` (new instance per resolution). The service is
stateless, so Transient vs Scoped is immaterial. The `using` directive is
`DanpheEMR.Services.ProcessConfirmation` (`DanpheServicesExtensions.cs:17`).

`Startup.cs:24` imports the namespace so MVC's controller-activator can
resolve the constructor-injected `IProcessConfirmationService`.

### 2.7 RBAC dependencies (cross-cutting)

The service depends entirely on the legacy static `RBAC` helper at
`Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs`:

| Method | Source | Used For |
|--------|--------|----------|
| `RBAC.GetUser(string userName, string password)` | `DanpheRBAC.cs:180-191` | Look up a user by credentials, returns a clone of `RbacUser` or `null`. |
| `RBAC.UserHasPermission(int userId, string permissionName)` | `DanpheRBAC.cs:222-235` | Check if a user has a given permission by name. |
| `RBAC.EncryptPassword(string)` (transitive) | `DanpheRBAC.cs` | Compares supplied password with the encrypted on-disk password. |
| `RBAC.GetAllUsers()` (transitive) | `DanpheRBAC.cs` | Backing list for credential check. |
| `RBAC.GetUserAllPermissions(int)` (transitive) | `DanpheRBAC.cs` | Backing list for permission check. |

The user and permission lists are loaded once per request into in-memory
caches; the service does not hit the DB on every call. This is the same
trade-off the login flow makes, and is acceptable in a single-process
deployment. In the Cloudflare-native migration this in-memory cache becomes
a request-scoped KV lookup (or a D1 query if the cache is cold).

---

## 3. Data Models

### 3.1 Request DTO

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `Username` | `string` | yes (validated implicitly) | RBAC username of the witness. Case-insensitive match. |
| `Password` | `string` | yes (validated implicitly) | Plaintext password of the witness — encrypted with `RBAC.EncryptPassword` before comparison. Never logged or persisted. |
| `PermissionName` | `string` | yes (validated implicitly) | System-generated permission name that the witness must hold. Examples: `scheme-refund-confirmation-process`, `billing-invoice-return-process`. |

### 3.2 Response payload

The endpoint uses `InvokeHttpPostFunction`, which wraps the service result in
the standard Danphe HTTP envelope:

```json
{
  "Status": "OK",
  "ErrorMessage": null,
  "Results": true
}
```

`Results` is the literal `bool` returned by
`ProcessConfirmationService.ConfirmProcess`. On failure:

- Empty / unparseable body → `Status = "Failed"`, `ErrorMessage = "Could not
  Confirm Process"` (from `ArgumentNullException`).
- Bad credentials / inactive user → `Status = "Failed"`, `ErrorMessage =
  "User is not valid"`.
- Valid user without the requested permission → `Status = "OK"`,
  `Results = false`. **Note:** the HTTP status is still 200; the parent
  Angular component is responsible for interpreting `Results === false` as
  a denial.

### 3.3 Entity

`ProcessConfirmationAuthorityModel` (described in §2.4) — declared in
`UTL_CFG_ProcessConfirmationAuthority` but not read or written by the live
service code.

### 3.4 Frontend DTO (mirroring the wire shape)

`process-confirmation-userCredentials.dto.ts`:

```typescript
export class ProcessConfirmationUserCredentials_DTO {
  Username: string = null;
  Password: string = null;
  PermissionName: string = null;
}
```

The DTO is initialized with `null` defaults so two-way binding in the modal
template works against an empty form on first render.

---

## 4. Database Tables

### 4.1 `UTL_CFG_ProcessConfirmationAuthority`

Declared by `UtilitiesDbContext.OnModelCreating` (line 60) and the
`ProcessConfirmationAuthorityModel` entity. The table is not present in any
of the SQL scripts in `DanpheEMR reference/Database/` that ship with the
reference code, so a representative DDL is:

```sql
CREATE TABLE UTL_CFG_ProcessConfirmationAuthority (
    ProcessConfirmationAuthorityId   INT             IDENTITY(1,1) NOT NULL,
    ProcessToConfirm                 NVARCHAR(200)   NOT NULL,
    PermissionId                     INT             NOT NULL,
    RoleId                           INT             NOT NULL,
    CONSTRAINT PK_UTL_CFG_ProcessConfirmationAuthority
        PRIMARY KEY CLUSTERED (ProcessConfirmationAuthorityId ASC),
    CONSTRAINT FK_UTL_CFG_ProcessConfirmationAuthority_RBAC_Permission
        FOREIGN KEY (PermissionId) REFERENCES RBAC_Permission(PermissionId),
    CONSTRAINT FK_UTL_CFG_ProcessConfirmationAuthority_RBAC_Role
        FOREIGN KEY (RoleId)       REFERENCES RBAC_Role(RoleId)
);
```

| Column | Type | Notes |
|--------|------|-------|
| `ProcessConfirmationAuthorityId` | `INT IDENTITY` | Surrogate key. |
| `ProcessToConfirm` | `NVARCHAR(200)` | Display name of the protected process. |
| `PermissionId` | `INT` | FK to `RBAC_Permission`. |
| `RoleId` | `INT` | FK to `RBAC_Role`. |

The two FKs imply a many-to-many between roles and permissions scoped to
"processes that require a step-up witness." In the .NET runtime the table
is never queried, so its semantic role is purely a configuration surface for
operators who want to map a "process" to (role, permission) tuples without
writing them down elsewhere.

#### Cloudflare migration note

For the Hono/D1 target, either:

- Drop the table and the entity entirely — the live service uses RBAC alone.
- Or port the table to a `process_confirmation_authority` D1 table and add
  a `GET /api/admin/process-confirmation-authorities` endpoint that lists
  the configured (process, role, permission) tuples for the security settings
  UI. Add a `seed.sql` migration that pre-populates the two known
  authorities (`scheme-refund-confirmation-process`,
  `billing-invoice-return-process`).

The dependency-map should also note that `UTL_CFG_*` and `RBAC_*` table
prefixes need to be replaced with the multi-tenant equivalent on D1
(`tenant_scoped_rbac_*`, `process_confirmation_authority`).

### 4.2 RBAC tables (read-only)

The service reads (transitively) from:

- `RBAC_User` — `UserName`, `Password` (encrypted), `IsActive`.
- `RBAC_UserRoleMap` + `RBAC_Role` + `RBAC_RolePermissionMap` + `RBAC_Permission`
  — joined in-memory to produce `GetUserAllPermissions(userId)`.

These are owned by the Security module (see `39-security.md`). The
`ProcessConfirmation` module is read-only against them and does not mutate
any RBAC table.

---

## 5. Key Workflows

### 5.1 Step-up authorization for a sensitive write

This is the canonical use of the module. Triggered from any feature page
that needs a privileged witness before performing a high-risk write.

```
[Operator clicks "Submit" on a Scheme Refund / Credit Note]
        │
        ▼
Parent component checks: does the *operator* have the
required permission? (e.g. 'scheme-refund-confirmation-process')
        │
        ├── Yes → proceed with the normal save path (no modal)
        │
        └── No  → set requiresProcessConfirmation = true
                  → render <process-confirmation> modal
                  → modal collects Username + Password from the witness
                  → on Confirm, modal calls
                        POST /api/ProcessConfirmation/ConfirmProcess
                            { Username, Password, PermissionName }
                          │
                          ▼
                  ProcessConfirmationService.ConfirmProcess
                          │
                          ├── null DTO        → ArgumentNullException
                          ├── bad credentials → Exception "User is not valid"
                          ├── inactive user   → Exception "User is not valid"
                          ├── valid user, no permission → returns false
                          └── valid user, has permission → returns true
                          │
                          ▼
                  Modal: if (Results === true) → emit confirmSuccess
                                                → parent runs the actual save
                                                (SaveSchemeRefund /
                                                 SubmitCreditNote)
                         else                  → show error messagebox
```

Reference code paths:

- Parent component branch:
  `wwwroot/DanpheApp/src/app/utilities/scheme-refund/new/scheme-refund.component.ts:180-198`
  (`GotoProcessConfirmation`, `ConfirmationProcessCallback`).
- Parent component branch (Billing):
  `wwwroot/DanpheApp/src/app/billing/bill-return/bill-credit-note.component.ts:302-321`.
- Modal emit / API call:
  `wwwroot/DanpheApp/src/app/utilities/shared/process-confirmation/process-confirmation.component.ts:30-46`.

### 5.2 Two-person rule guarantees

The endpoint enforces three properties that together form the two-person
rule:

1. **Separate identity** — the witness's `Username` is independent of the
   operator's session. The endpoint does not consult
   `HttpContext.User` / `RbacUser currentUser`. As long as the operator's
   session is still active (it always is, since they are the one who
   triggered the modal), the witness must be a different person typing in
   their own credentials.
2. **Password verification** — the password is compared against the
   encrypted on-disk password. A witness cannot "approve" by typing the
   operator's username with their own password; the credential check is
   `username AND password AND isActive AND hasPermission`, all four required.
3. **Specific permission** — the witness's authority is scoped to a single
   `PermissionName`. A witness with broad billing access but no
   `scheme-refund-confirmation-process` permission will be rejected for
   that process, even though they could normally raise a Scheme Refund from
   their own session.

### 5.3 Cancellation / failure path

- **Witness cancels** (`Close()` in `process-confirmation.component.ts:47-50`)
  → emits `ENUM_ProcessConfirmationActions.close` → parent hides the
  modal and aborts the write.
- **Witness denied** (HTTP 200 with `Results: false` or any error response)
  → modal shows the messagebox `Could not confirm user for ${ProcessDisplayName}.`
  → modal does not emit a callback, so the parent stays in
  `requiresProcessConfirmation = true` until the operator explicitly
  closes it. The parent has no automatic retry.
- **Network / server error** (`err` callback) → console.log only. The
  parent has no error handling, so the modal stays open.

### 5.4 Adding a new protected process

The current code wires two specific processes. To add a third:

1. Decide on a stable `PermissionName` (kebab-case, suffixed with
   `-confirmation-process` or `-process` to follow convention). Treat this
   string as immutable once live — changing it requires a migration script
   to update the `PermissionName` column in `RBAC_Permission`.
2. Add a row to `RBAC_Permission` for the new permission (typically via
   `SecurityController`'s permission CRUD).
3. Assign the permission to one or more `RBAC_Role`s (typically the
   supervisor / manager role for the module).
4. Frontend: import `UtilitiesSharedModule` in the feature module, add a
   `process-confirmation` element to the template, and define the
   `RequiredPermissionNameToConfirmProcess` + `ProcessToConfirmDisplayName`
   fields on the parent component. Wire `GotoProcessConfirmation` /
   `ConfirmationProcessCallback` per the scheme-refund / bill-credit-note
   pattern.
5. Optionally add a `ENUM_ProcessesToConfirmDisplayNames.<NewProcess>` entry
   so the display name is centralized.

No backend changes are needed — the controller, service, and DTO are
permission-name driven and require no code change to accept a new
permission name.

---

## 6. API Endpoints

The module exposes **exactly one HTTP endpoint**. The structure template
asks for "20+" but the surface is single-action by design — every protected
feature page calls the same endpoint with a different `PermissionName`. The
sub-sections below document the endpoint exhaustively (request, response,
auth model, error matrix) and then enumerate the two known callers so each
"caller pair" is treated as a separate logical use case.

### 6.1 `POST /api/ProcessConfirmation/ConfirmProcess`

The only action in the controller. Verifies the supplied credentials and
permission, returns a `bool`.

| Aspect | Value |
|--------|-------|
| **Route** | `POST /api/ProcessConfirmation/ConfirmProcess` |
| **Controller** | `ProcessConfirmationController.PostConfirmProcess` (`ProcessConfirmationController.cs:26-31`) |
| **Auth** | None (no `[Authorize]` attribute). The endpoint is idempotent and returns no sensitive data. |
| **Body** | `application/json` — `ProcessConfirmationUserCredentials_DTO` |
| **Success response** | `200 OK`, `{ Status: "OK", Results: true }` |
| **Failure responses** | `200 OK` with `Results: false` (user is valid but lacks the permission), or `200 OK` with `Status: "Failed"` + `ErrorMessage` (bad credentials, inactive user, null DTO). |
| **Side effects** | None. |
| **Rate limiting** | None in code. Production deployments should front this endpoint with the same rate limiter as `/api/Account/Authenticate`. |

#### 6.1.1 Request

```json
POST /api/ProcessConfirmation/ConfirmProcess
Content-Type: application/json

{
  "Username": "supervisor01",
  "Password": "PlainTextPassword",
  "PermissionName": "scheme-refund-confirmation-process"
}
```

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `Username` | `string` | yes | RBAC username of the witness. Case-insensitive. |
| `Password` | `string` | yes | Plaintext password of the witness. Compared with `RBAC.EncryptPassword(Password)` server-side. |
| `PermissionName` | `string` | yes | The exact permission name required to authorize the process. |

#### 6.1.2 Responses

**Authorized:**

```json
{
  "Status": "OK",
  "ErrorMessage": null,
  "Results": true
}
```

**Authorized user, missing permission (HTTP 200, Results=false):**

```json
{
  "Status": "OK",
  "ErrorMessage": null,
  "Results": false
}
```

**Bad credentials (HTTP 200, ErrorMessage set):**

```json
{
  "Status": "Failed",
  "ErrorMessage": "User is not valid",
  "Results": null
}
```

**Null DTO / parse error (HTTP 200, ErrorMessage set):**

```json
{
  "Status": "Failed",
  "ErrorMessage": "Could not Confirm Process",
  "Results": null
}
```

#### 6.1.3 Caller matrix

| # | Caller (parent component) | `PermissionName` | Display name | When triggered |
|---|---------------------------|------------------|--------------|----------------|
| 1 | `SchemeRefundComponent` (`wwwroot/DanpheApp/src/app/utilities/scheme-refund/new/scheme-refund.component.ts`) | `scheme-refund-confirmation-process` | `ENUM_ProcessesToConfirmDisplayNames.SchemeRefund` (`"Scheme Refund Process"`) | Operator clicks Save on a new Scheme Refund; if the operator does not already hold `scheme-refund-confirmation-process`, the modal opens and a supervisor types their credentials. |
| 2 | `BillCreditNoteComponent` (`wwwroot/DanpheApp/src/app/billing/bill-return/bill-credit-note.component.ts`) | `billing-invoice-return-process` | `ENUM_ProcessesToConfirmDisplayNames.BillInvoiceReturn` (`"Billing Invoice Return Process"`) | Operator clicks Confirm on a credit note / invoice return; same two-person flow. |

Both callers follow the identical pattern (see §5.1):

```typescript
GotoProcessConfirmation(): void {
  if (this.securityServices.HasPermission(this.RequiredPermissionNameToConfirmProcess)) {
    this.Submit();           // or this.SaveSchemeRefund()
  } else {
    this.requiresProcessConfirmation = true;
  }
}

ConfirmationProcessCallback($event: { action: string }): void {
  if ($event.action === ENUM_ProcessConfirmationActions.close) {
    this.requiresProcessConfirmation = false;
  } else if ($event.action === ENUM_ProcessConfirmationActions.confirmSuccess) {
    this.requiresProcessConfirmation = false;
    this.Submit();           // or this.SaveSchemeRefund()
  } else {
    this.requiresProcessConfirmation = false;
    this.messageBoxService.showMessage(ENUM_MessageBox_Status.Failed, ['Could not confirm your process']);
  }
}
```

#### 6.1.4 HTTP-level details

- The route attribute `[Route("ConfirmProcess")]` on the action is
  relative to the controller's route prefix (default `/api/ProcessConfirmation`
  for a non-attributed controller in this codebase, though the project
  often uses `/api/<ModuleName>`; the Angular caller hard-codes
  `/api/ProcessConfirmation/ConfirmProcess`).
- HTTP method is `POST` because the request body contains a password — the
  endpoint must never be `GET`. There is no anti-CSRF attribute, but
  because the request is JSON and the body contains a password, the same
  safeguards that protect `/api/Account/Authenticate` apply.
- `InvokeHttpPostFunction` (inherited from `CommonController`) is the
  standard Danphe wrapper that:
  - Catches exceptions and converts them to `Status: "Failed"`.
  - Wraps the result in `{ Status, ErrorMessage, Results }`.
  - Returns `Ok(...)` with the envelope as JSON.

### 6.2 Logical endpoints (one per permission)

Each new permission wired to the modal effectively creates a new logical
endpoint. The following table covers the known and forward-looking set. The
"physical endpoint" column is identical for all rows because the routing
and controller action are shared.

| # | Logical endpoint | `PermissionName` | `ENUM_ProcessesToConfirmDisplayNames` | Caller component | Status |
|---|------------------|------------------|---------------------------------------|------------------|--------|
| 1 | `ConfirmProcess(scheme-refund)` | `scheme-refund-confirmation-process` | `SchemeRefund` (`"Scheme Refund Process"`) | `SchemeRefundComponent` | Live |
| 2 | `ConfirmProcess(billing-invoice-return)` | `billing-invoice-return-process` | `BillInvoiceReturn` (`"Billing Invoice Return Process"`) | `BillCreditNoteComponent` | Live |
| 3 | `ConfirmProcess(<future>)` | `<system-generated>-process` | new `ENUM_ProcessesToConfirmDisplayNames` entry | new feature component | Forward-looking — add by following §5.4 |

### 6.3 Why only one endpoint (architectural rationale)

The single-endpoint design is deliberate:

- It centralizes the credential / permission check in one place. The same
  `RBAC.GetUser` + `RBAC.UserHasPermission` pair is used by login, password
  change, and step-up confirmation, so any future change to the password
  hash algorithm or permission lookup is applied uniformly.
- It avoids the alternative of "one route per protected process" which
  would have meant a controller per process, each with its own service
  method, each with its own copy of the credential-validation logic.
- It keeps the `ProcessConfirmationAuthorityModel` (the un-read table)
  decoupled from the runtime. The table is intended for an admin UI to
  map processes to roles; the runtime check is permission-driven, not
  table-driven.

---

## 7. Cross-Module

### 7.1 Module dependency graph

```
                    ┌──────────────────────────────┐
                    │  ProcessConfirmationService  │
                    │  (Services/ProcessConfirmation) │
                    └──────────────┬───────────────┘
                                   │ uses
                                   ▼
                    ┌──────────────────────────────┐
                    │  DanpheEMR.Security.RBAC     │
                    │  (Components/DanpheEMR.Security) │
                    └──────────────┬───────────────┘
                                   │ reads (cached)
                                   ▼
                    ┌──────────────────────────────┐
                    │  RBAC_User / RBAC_Permission │
                    │  (Security module owns)      │
                    └──────────────────────────────┘

Frontend call sites (both feature modules import UtilitiesSharedModule):
                                         ┌────────────────────────────┐
                                         │  UtilitiesSharedModule     │
                                         │  (declares + exports       │
                                         │   <process-confirmation>)  │
                                         └────────────┬───────────────┘
                                                      │ imported by
                              ┌───────────────────────┴────────────────────────┐
                              ▼                                                ▼
        ┌───────────────────────────────────┐              ┌───────────────────────────────────┐
        │  Utilities module                 │              │  Billing module                  │
        │  SchemeRefundComponent            │              │  BillCreditNoteComponent         │
        │  (scheme-refund-confirmation-     │              │  (billing-invoice-return-process)│
        │   process)                        │              │                                   │
        └───────────────────────────────────┘              └───────────────────────────────────┘
```

### 7.2 Direct dependencies (ProcessConfirmation depends on)

| Dependency | Type | Why |
|------------|------|-----|
| `DanpheEMR.Core.Configuration.MyConfiguration` | Inherited from `CommonController` | Standard constructor injection for tenant / connection string. |
| `DanpheEMR.DalLayer` | Imported (namespace) | Not directly used by this controller but present for future use. |
| `DanpheEMR.Security.RBAC` | Static helper | `RBAC.GetUser`, `RBAC.UserHasPermission` (see §2.7). |
| `DanpheEMR.Services.ProcessConfirmation` | Self | Service + DTO. |
| `Microsoft.AspNetCore.Http`, `Microsoft.AspNetCore.Mvc`, `Microsoft.Extensions.Options` | Framework | Standard MVC controller plumbing. |
| `System.Linq`, `System.Web.Security` | BCL | Pulled in via `using`; the controller itself does not use them. |

### 7.3 Reverse dependencies (modules that depend on ProcessConfirmation)

| Caller | File | Endpoint / usage |
|--------|------|------------------|
| **Utilities — Scheme Refund (new)** | `wwwroot/DanpheApp/src/app/utilities/scheme-refund/new/scheme-refund.component.{ts,html}` | Renders `<process-confirmation>` modal in the new-scheme-refund page. Permission name: `scheme-refund-confirmation-process`. |
| **Billing — Bill Credit Note (return)** | `wwwroot/DanpheApp/src/app/billing/bill-return/bill-credit-note.{component.ts,html}` | Renders `<process-confirmation>` modal in the credit-note page. Permission name: `billing-invoice-return-process`. |
| **UtilitiesSharedModule** | `wwwroot/DanpheApp/src/app/utilities/shared/utilities-shared.module.ts` | Declares + exports `ProcessConfirmationComponent` so any feature module that imports `UtilitiesSharedModule` can drop the modal into its template. |
| **UtilitiesBLService** | `wwwroot/DanpheApp/src/app/utilities/shared/utilities.bl.service.ts:109-112` | Provides `ConfirmProcess(ProcessConfirmationUserCredentials_DTO)` to Angular callers. |
| **UtilitiesDLService** | `wwwroot/DanpheApp/src/app/utilities/shared/utilities.dl.service.ts:73-75` | Issues the actual `http.post('/api/ProcessConfirmation/ConfirmProcess', ...)` call. |
| **DanpheServicesExtensions** | `DependencyInjection/DanpheServicesExtensions.cs:17, 71` | Registers the service in DI. |
| **Startup.cs** | `Websites/DanpheEMR/Startup.cs:24` | Imports the namespace. |
| **UtilitiesDbContext** | `Components/DanpheEMR.DalLayer/UtilitiesDbContext.cs:34, 60` | Declares the `ProcessConfirmationAuthorityModel` entity. |

### 7.4 Inter-module flows

#### 7.4.1 Scheme Refund with step-up authorization

```
SchemeRefundComponent.SaveSchemeRefund()
  → if (securityServices.HasPermission('scheme-refund-confirmation-process'))
      submit normally
    else
      requiresProcessConfirmation = true
      → <process-confirmation> modal opens
      → witness enters Username + Password
      → ConfirmProcess() → UtilitiesBLService.ConfirmProcess()
        → UtilitiesDLService.ConfirmProcess()
          → POST /api/ProcessConfirmation/ConfirmProcess
            { Username, Password, PermissionName: 'scheme-refund-confirmation-process' }
          → ProcessConfirmationService.ConfirmProcess
            → RBAC.GetUser(Username, Password)
            → RBAC.UserHasPermission(UserId, 'scheme-refund-confirmation-process')
          → returns bool
        → if true → ConfirmationProcessCallback({action: 'confirm-success'})
          → SchemeRefundComponent.SaveSchemeRefund() runs the actual write
        → if false → messagebox 'Could not confirm user for Scheme Refund Process.'
      → <process-confirmation> modal closes
```

#### 7.4.2 Billing Credit Note with step-up authorization

Identical pattern with `PermissionName: 'billing-invoice-return-process'` and
the parent action being `SubmitCreditNote()`.

### 7.5 What ProcessConfirmation does NOT do

To make the boundary with adjacent modules explicit:

- It does not create or modify any billing, scheme, RBAC, or audit record.
  It is read-only against the RBAC tables and write-nothing to anything
  else.
- It does not issue or rotate session tokens. The operator's session is
  untouched; only the witness's identity is verified for the moment of
  authorization.
- It does not log the witness's password, username, or the outcome. There
  is no audit row written. (For audit-grade witness trails, the parent
  feature page is expected to write its own audit row in the same
  transaction as the protected write.)
- It does not enforce a "different user than the operator" check at the
  server level. The two-person rule is enforced by the operator being
  required to type the witness's credentials — a sufficiently determined
  operator could in principle type their own password and pass the check
  if they happen to hold the permission. The defense-in-depth assumption
  is that the witness is a different human at the same workstation.

---

## 8. Business Rules

### 8.1 Credential validation

- **Username is case-insensitive** (`UserName.ToLower() == userName.ToLower()`).
- **Password is case-sensitive** — the encrypted on-disk password is
  compared byte-for-byte with `RBAC.EncryptPassword(plaintext)`. Any
  whitespace, casing, or character difference causes a credential failure.
- **Inactive users are rejected** even if their credentials are valid. A
  disabled user (`IsActive == false`) is treated identically to a
  non-existent user ("User is not valid").
- **No account-lockout** — repeated failed attempts do not lock the
  account or slow down the check. This is the same behavior as the
  `/api/Account/Authenticate` endpoint; the assumption is that a network
  firewall / WAF in front of the app provides brute-force protection.
- **No rate limiting at the controller level** — production deployments
  should apply the same rate limit policy used on `/api/Account/Authenticate`
  to `/api/ProcessConfirmation/ConfirmProcess`.

### 8.2 Permission validation

- The permission lookup is by **name only**, not by `ApplicationId`. Two
  permissions with the same name in different applications would both
  match. In practice the names use a `<module>-<action>-process` convention
  that is globally unique.
- The check returns `true` if the user has **at least one** matching
  permission across all their roles. There is no concept of "needs all
  roles" or "needs the highest-priority role."
- The check is **case-sensitive on `PermissionName`** (the in-memory LINQ
  filter is `where uPerm.PermissionName == permissionName` with default
  string comparison). Permission names should be stored exactly as the
  Angular caller passes them — kebab-case, lowercase, no trailing
  whitespace.

### 8.3 Process-confirmation contract

- **One process = one permission name.** The witness's authority is
  scoped to the exact `PermissionName` passed in. A witness authorized
  for scheme refunds is *not* automatically authorized for billing
  credit notes.
- **Operator permission shortcut.** If the operator already has the
  permission, the modal is skipped and the save runs directly. The
  rationale is that the operator already meets the bar; no witness is
  needed.
- **Cancel = abort.** Closing the modal via the X button or any
  non-`confirm-success` callback closes the modal and aborts the write.
  There is no "remember this for 5 minutes" caching.
- **No partial success.** The response is binary (`Results: true` /
  `Results: false` / exception). The parent component must run the full
  save action on `confirm-success`; there is no concept of "pre-authorize
  then commit later."

### 8.4 Two-person rule

- **Witness identity is independent of operator session.** The endpoint
  never reads `HttpContext.User` / the current request principal. The
  witness is whoever is sitting at the keyboard.
- **Witness's password must be re-entered.** The endpoint does not accept
  the operator's session as proof of the witness's identity.
- **Defense-in-depth caveat.** The server does not prevent the operator
  from typing their own credentials if they happen to hold the
  permission. The two-person rule relies on physical / procedural
  controls (a different human at the keyboard, a supervisor signing the
  paper receipt, etc.). The server-side check is the minimum bar, not
  the whole bar.

### 8.5 Logging and observability

- **Passwords are never logged.** The DTO is constructed in memory and
  discarded; `InvokeHttpPostFunction` serializes only the result envelope.
- **No audit row is written by the controller.** If the parent feature
  page needs an audit trail of which witness authorized which write, it
  must write that row in the same transaction as the protected write.
- **No metric is emitted.** The endpoint does not increment a counter or
  emit a log line. The parent component's standard `console.log(err)` in
  the failure callback (`process-confirmation.component.ts:43`) is the
  only signal in the frontend.

### 8.6 Forward compatibility / migration notes

- **Drop the un-read `UTL_CFG_ProcessConfirmationAuthority` table** unless
  the migration adds a UI to populate it. As shipped, no service reads
  from it, and no service writes to it. Keeping it without a consumer
  creates the false impression that the table drives the authorization
  check, which it does not.
- **Move the permission names to a constants file.** The current
  convention of hard-coding `'scheme-refund-confirmation-process'` and
  `'billing-invoice-return-process'` in three places each (the comment
  in the Angular caller, the .NET DTO, and the implicit convention in
  the RBAC seed) is fragile. In the Hono migration, define them as
  exported constants in `src/constants/permissions.ts` and reference
  from both the Zod schema and the seed migration.
- **Add explicit validation to the DTO.** The current DTO has no `[Required]`
  attributes and the service performs only a null check on the parent
  object. A Zod schema in `src/schemas/process-confirmation.ts` with
  `.min(1)` on each field would catch empty-string passwords earlier
  and produce a more useful error message than "User is not valid."
- **Add a "different user than operator" server check.** The current
  implementation relies entirely on physical controls. A simple
  guard — reject if `RBAC.GetUser(...)` returns the same `UserId` as
  the current session — would close the trivial bypass.
- **Emit an audit row.** Wire the controller (or a downstream middleware
  on the actual write endpoint, e.g. `BillReturnController`) to record
  `(WitnessUserId, PermissionName, Timestamp, ParentRecordId)` in a new
  `audit_process_confirmation` table for compliance.

---

## Appendix A — File-by-file reference table

| # | Path (relative to `DanpheEMR reference/Code/`) | LOC | Role |
|---|--------------------------------------------------|----:|------|
| 1 | `Websites/DanpheEMR/Controllers/ProcessConfirmationController.cs` | 34 | HTTP endpoint. |
| 2 | `Websites/DanpheEMR/Services/ProcessConfirmation/ProcessConfirmationService.cs` | 30 | Service implementation. |
| 3 | `Websites/DanpheEMR/Services/ProcessConfirmation/IProcessConfirmationService.cs` | 11 | DI interface. |
| 4 | `Websites/DanpheEMR/Services/ProcessConfirmation/DTO/ProcessConfirmationUserCredentials_DTO.cs` | 9 | Request DTO. |
| 5 | `Components/DanpheEMR.ServerModel/Utilities/ProcessConfirmationRolesPermissionModel.cs` | 13 | EF entity (`ProcessConfirmationAuthorityModel`). |
| 6 | `Components/DanpheEMR.DalLayer/UtilitiesDbContext.cs` | 66 | `DbSet` + `ToTable` mapping. |
| 7 | `Components/DanpheEMR.Security/RBAC/DanpheRBAC.cs` | 525 | Hosts `GetUser(...)` + `UserHasPermission(...)` consumed by the service. |
| 8 | `Websites/DanpheEMR/DependencyInjection/DanpheServicesExtensions.cs` | 79 | `AddTransient<IProcessConfirmationService, ProcessConfirmationService>()` (line 71). |
| 9 | `Websites/DanpheEMR/Startup.cs` | n/a | `using DanpheEMR.Services.ProcessConfirmation;` (line 24). |
| 10 | `wwwroot/DanpheApp/src/app/utilities/shared/utilities-shared.module.ts` | 39 | Declares + exports `ProcessConfirmationComponent`. |
| 11 | `wwwroot/DanpheApp/src/app/utilities/shared/process-confirmation/process-confirmation.component.ts` | 51 | Modal component (TS). |
| 12 | `wwwroot/DanpheApp/src/app/utilities/shared/process-confirmation/process-confirmation.component.html` | 28 | Modal template. |
| 13 | `wwwroot/DanpheApp/src/app/utilities/shared/DTOs/process-confirmation-userCredentials.dto.ts` | 5 | Angular DTO. |
| 14 | `wwwroot/DanpheApp/src/app/utilities/shared/utilities.bl.service.ts` | 113 | `ConfirmProcess(...)` thin wrapper. |
| 15 | `wwwroot/DanpheApp/src/app/utilities/shared/utilities.dl.service.ts` | 80 | `http.post('/api/ProcessConfirmation/ConfirmProcess', ...)`. |
| 16 | `wwwroot/DanpheApp/src/app/shared/shared-enums.ts` | 638 | `ENUM_ProcessConfirmationActions` (lines 523-526), `ENUM_ProcessesToConfirmDisplayNames` (lines 518-521). |
| 17 | `wwwroot/DanpheApp/src/app/utilities/scheme-refund/new/scheme-refund.component.{ts,html}` | 277 + 234 | First caller (Scheme Refund). |
| 18 | `wwwroot/DanpheApp/src/app/billing/bill-return/bill-credit-note.{component.ts,html}` | 596 + 321 | Second caller (Billing Credit Note). |

---

## Appendix B — Glossary

| Term | Meaning |
|------|---------|
| **ProcessConfirmation** | The DanpheEMR module that provides step-up (witness) authentication for high-risk writes. |
| **Step-up authentication** | Re-verifying the user's credentials (and authority) at the moment of a sensitive action, even though they are already logged in. |
| **Witness** | The privileged second user who enters their credentials in the modal to authorize a sensitive write performed by the operator. |
| **Operator** | The logged-in user who is performing the sensitive write; the modal only opens if the operator does not already hold the required permission. |
| **Two-person rule** | Procedural control that requires two distinct humans to authorize a high-risk action. The server enforces it by requiring the witness's username + password + permission; physical / procedural controls ensure the witness is a different person. |
| **`PermissionName`** | The system-generated permission string that gates a protected process (`scheme-refund-confirmation-process`, `billing-invoice-return-process`, ...). |
| **`ENUM_ProcessConfirmationActions`** | Frontend enum for the modal's two callback actions: `confirmSuccess` ("confirm-success") and `close` ("close"). |
| **`ENUM_ProcessesToConfirmDisplayNames`** | Frontend enum for the human-readable display name shown in the modal title ("Scheme Refund Process", "Billing Invoice Return Process"). |
| **`UTL_CFG_ProcessConfirmationAuthority`** | Configuration table mapped by the .NET `ProcessConfirmationAuthorityModel`. Declared in `UtilitiesDbContext` but not read by the live service. Candidate for deletion in the migration. |
| **`ProcessConfirmationAuthorityModel`** | EF entity class. Note: file is named `ProcessConfirmationRolesPermissionModel.cs` but the class is `ProcessConfirmationAuthorityModel` — a naming inconsistency. |
