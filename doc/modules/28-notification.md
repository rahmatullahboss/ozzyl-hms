# Notification Module

## 1. Module Overview

The DanpheEMR Notification module is a thin, cross-cutting subsystem that covers three distinct notification channels:

1. **In-app notifications** — A persistent bell-icon dropdown in the global header that surfaces per-user and per-role alerts raised by other modules (Pharmacy, Inventory, ADT, Lab, etc.). Backed by a single `CORE_Notification` table, a dedicated `NotificationController`, and a `core/notifications` Angular component that polls the server every 5 minutes, plays an audio chime on new arrivals, and routes the user to the originating record when an item is clicked.
2. **SMS** — Programmatic short-message dispatch to patients and clinicians. Two storage tables are involved: `TXN_Sms` (Admission) and `LAB_Sms` (Lab/Covid reports). Two provider families are supported: a hard-coded Sparrow SMS gateway used by Admission, and a pluggable provider (LumbiniTech / Sparrow) configured via `CORE_CFG_Parameters` for Lab Covid reports.
3. **Email** — Transactional email through SendGrid (`DanpheEMR.Services.EmailService`). Used for Lab PDF report dispatch, Radiology report dispatch, Covid PDF delivery, and a generic `InventoryEmailController` for ad-hoc messages. Every successful send is audit-logged into `MSTEmailSendDetail`.

The module is intentionally minimal on its own controllers (`NotificationController` and `InventoryEmailController`); most of the work happens as side-effects inside Pharmacy, Inventory, Admission, Lab, and Radiology controllers that call into a shared `NotiFicationDbContext` or instantiate `EmailService` / `LabSMSModel` directly. The frontend is similarly small — a single dropdown component that hooks into `core.module` and is rendered in the top navigation bar.

On the .NET / SQL Server reference, three tables and three DbContexts participate: `CORE_Notification` (own context `NotiFicationDbContext`), `MSTEmailSendDetail` (shared `MasterDbContext`), and `TXN_Sms` / `LAB_Sms` (lives in `AdmissionDbContext` and `LabDbContext` respectively). On the Cloudflare-native migration target, the in-app notification table becomes `core_notifications` (Hono route `/api/notification/*` with Zod validation), the email audit becomes `mst_email_send_detail` under `tenant_id`, and SMS dispatch is implemented as an async queue job using Cloudflare Queues (provider-agnostic, configurable in `core_cfg_parameters`).

### Core Domain Concepts

| Concept | Description |
|---------|-------------|
| **Notification (In-app)** | A row in `CORE_Notification` addressed to a specific user (`RecipientType='user'`) or to an RBAC role (`RecipientType='rbac-role'`). Carries module/sub-module classification, title, details, and a foreign-key pointer to the originating record. |
| **Recipient Type** | One of `user` (EmployeeId in `RecipientId`) or `rbac-role` (RoleId in `RecipientId`). The bell UI merges both lists for the currently logged-in user. |
| **Module / Sub-Module Classification** | `Notification_ModuleName` + `Sub_ModuleName` form a routing tuple. The frontend `NotificationOnClick` handler maps this pair to a deep-link (e.g. `Visits_Module/Appointment` → `/Doctors/PatientOverviewMain/PatientOverview`, `Labs_Module/Lab-AddResult` → `/Lab/ListPatientReport`). |
| **Read State** | Two booleans: `IsRead` (has the user opened the notification) and `IsArchived` (has the user dismissed it from the dropdown). Archiving is the soft-delete. |
| **Read-By** | `ReadBy` (int, EmployeeId) is stamped when the notification is first marked as read; identifies who read it for audit. |
| **Active Window** | The bell UI only shows notifications where `IsArchived = false` AND `CreatedOn >= NOW - 7 days`. Older rows stay in the table for audit but are hidden. |
| **SMS Provider** | SMS gateway abstraction. The Lab module reads `LabSmsProviderName` and `SmsParameter` from `CORE_CFG_Parameters` to choose between `LumbiniTech` (URL-token template) and `Sparrow` (form-post). Admission hard-codes Sparrow with a legacy token. |
| **Email Provider** | Always SendGrid. The API key is read from `CORE_CFG_Parameters.ParameterGroupName='common', ParameterName='APIKeyOfEmailSendGrid'`. Sender email and sender title are caller-supplied. |
| **Email Audit Row** | Every successful `SendEmail` writes one `EmailSendDetailModel` per recipient into `MSTEmailSendDetail` (SendId, SendBy EmployeeId, SendToEmail, EmailSubject, SendOn). |
| **PDF Attachment** | Both `LabEmailModel` and `RadEmailModel` accept a `PdfBase64` and `AttachmentFileName`. The email service wraps the base64 into a SendGrid `Attachment` with MIME `application/pdf`. |
| **Image Attachments** | `LabEmailModel.ImageAttachments` and `RadEmailModel.ImageAttachments` (lists of `AttachmentModel` / `ImageAttachmentModel`) — inline image attachments rendered as `image/jpeg`. |
| **Parent Reference** | `ParentTableName` + `NotificationParentId` is a logical foreign key to the originating row (e.g. `PAT_PatientVisits` / `PatientVisitId`, `INV_TXN_PurchaseRequest` / `PurchaseRequestId`, `INV_TXN_GoodsReceipt` / `GoodsReceiptId`, `PHRM_MST_Item` / ItemId). |

---

## 2. Backend Files

### In-App Notification

| File | Role |
|------|------|
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Notification/NotificationController.cs` | Owns the four in-app notification HTTP routes (UserNotifications, VisitNotificaionDetail, MarkAsRead, Archive). Inherits from `CommonController` and constructs its own `NotiFicationDbContext` from the base connection string. |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/NotificationModels/NotificationViewModel.cs` | The 13-property in-app notification entity (`NotificationId`, `Notification_ModuleName`, `Notification_Title`, `Notification_Details`, `RecipientId` (nullable), `ParentTableName`, `NotificationParentId`, `IsRead`, `ReadBy` (nullable), `CreatedOn`, `IsArchived` (nullable), `RecipientType`, `Sub_ModuleName`). |
| `DanpheEMR reference/Code/Components/DanpheEMR.DalLayer/NotiFicationDbContext.cs` | Tiny DbContext with two DbSets — `Notifications` (mapped to `CORE_Notification`) and `PatientVisits` (mapped to `PAT_PatientVisits`, included only to support the visit-detail join). |

### Email

| File | Role |
|------|------|
| `DanpheEMR reference/Code/Websites/DanpheEMR/Services/EmailService.cs` | SendGrid wrapper. Three `SendEmail` overloads: plain text only, PDF + image attachments, PDF only with `AttachmentModel` images. Returns `"OK"` on `HttpStatusCode.Accepted`, else `"Error"`. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Services/IEmailService.cs` | Three-method interface mirroring the overloads. |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/MasterModels/EmailSendDetailModel.cs` | Audit row: `SendId`, `SendBy` (EmployeeId), `SendToEmail`, `EmailSubject`, `SendOn`. Maps to `MSTEmailSendDetail` via `MasterDbContext`. |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/LabModels/LabEmailModel.cs` | Lab report email DTO: `EmailAddress`, `Subject`, `PlainContent`, `HtmlContent`, `PdfBase64`, `AttachmentFileName`, `List<AttachmentModel> ImageAttachments`, `SenderEmailAddress`, `SenderTitle`, `SendPdf` (bool), `SendHtml` (bool), `EmailList`. |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/RadiologyModels/RadEmailModel.cs` | Radiology email DTO — identical to `LabEmailModel` but with `List<ImageAttachmentModel> ImageAttachments`. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/ViewModel/EmailViewModel.cs` | Lightweight ad-hoc email DTO used by `InventoryEmailController`: `EmailAddress` (semicolon-delimited), `Subject`, `Content`, `EmailAddressList` (split-out list). |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Inventory/InventoryEmailController.cs` | Tiny ad-hoc email endpoint at `POST /api/InventoryEmail`. Hard-codes sender `"info@hamshospital.org"` and a SendGrid API key. |

### SMS

| File | Role |
|------|------|
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/AdmissionModels/SmsModel.cs` | Admission SMS record: `SmsId`, `SmsCounter`, `PatientId`, `DoctorId?`, `SmsInformation` (message body), `CreatedOn?`, `CreatedBy?`. Maps to `TXN_Sms` via `AdmissionDbContext.SmsService`. |
| `DanpheEMR reference/Code/Components/DanpheEMR.ServerModel/LabModels/LabSMSModel.cs` | Lab/Covid SMS record: `SmsId`, `RequisitionId`, `Message`, `CreatedBy`, `CreatedOn`, plus a `[NotMapped] PhoneNumber` (transient, used during the dispatch call). Maps to `LAB_Sms` via `LabDbContext.LabSms`. |

### Cross-Module Callers (Notification creation)

| File | Role |
|------|------|
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Pharmacy/PharmacySettingsController.cs` (`AddItem`) | New medicine → "Pharmacy_Module" / "Store Stock" notification to the `Pharmacy` RBAC role. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Pharmacy/PharmacyController.cs` (legacy `reqType == "addItem"`) | Duplicate of the above for backward compatibility with the old `?reqType=addItem` API. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Inventory/InventoryBL.cs` (`CreateNotificationForPRVerifiers`) | Static helper. New purchase request → "Inventory_Module" / "PR_Verification" notification to a given RoleId. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Services/Inventory/InventoryGoodReceiptService.cs` (`SendNotificationToVerifiers`) | New goods arrival → one "Inventory_Module" / "GR_QualtityInspection" notification per verifier (user or role). |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Inventory/InventoryController.cs` (PurchaseRequest post) | Wires the verification settings to call `CreateNotificationForPRVerifiers` for each role id returned by `RBAC.GetAllRoleIdsByPermissionId`. |

### Cross-Module Callers (SMS / Email)

| File | Role |
|------|------|
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Admission/AdmissionController.cs` (`CreateAdmission` + `PostSMS`) | Builds a `SmsModel` describing the admission and fires `Task.Run(() => PostSMS(...))` against `http://api.sparrowsms.com/v2/sms/`. Persists to `TXN_Sms`. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LabController.cs` (`PostSMS`) | Reads `LabSmsProviderName` + `SmsParameter` from `CORE_CFG_Parameters`. For LumbiniTech, builds a token-replaced URL and GETs it; on 200, persists `LabSMSModel` and runs stored proc `SP_LAB_Update_Test_SmsStatus`. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LabController.cs` (`SendLabReportEmailToPatient`) | Builds `LabEmailModel`, calls `EmailService.SendEmail` with PDF + image attachments, writes one `EmailSendDetailModel` per recipient to `MSTEmailSendDetail`. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LabController.cs` (`UploadCovidReportToGoogleDrive`) | Saves the rendered Covid PDF to a local folder. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Radiology/RadiologyController.cs` (`SendEmail`, two callers) | Same pattern as Lab: builds `RadEmailModel`, calls `EmailService`, audit-logs. |
| `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/Lab/LabController.cs` (`GetCovidResults` + `GetCovidSmsText`) | SP-driven and code-driven read paths that feed the Covid SMS page. |

---

## 3. Data Models

### NotificationViewModel

```csharp
public class NotificationViewModel
{
    [Key]
    public int NotificationId { get; set; }                 // PK, identity
    public string Notification_ModuleName { get; set; }     // e.g. "Pharmacy_Module", "Inventory_Module", "Visits_Module"
    public string Notification_Title { get; set; }          // short headline
    public string Notification_Details { get; set; }        // body / call to action
    public int? RecipientId { get; set; }                   // EmployeeId if user, RoleId if rbac-role
    public string ParentTableName { get; set; }             // e.g. "PAT_PatientVisits", "INV_TXN_PurchaseRequest"
    public int NotificationParentId { get; set; }           // FK to source row in ParentTableName
    public bool IsRead { get; set; }                        // true after MarkAsRead
    public int? ReadBy { get; set; }                        // EmployeeId who marked as read
    public DateTime CreatedOn { get; set; }                 // UTC timestamp
    public bool? IsArchived { get; set; }                   // true after Archive
    public string RecipientType { get; set; }               // "user" | "rbac-role"
    public string Sub_ModuleName { get; set; }              // e.g. "Appointment", "PR_Verification", "GR_QualtityInspection"
}
```

### SmsModel (Admission / TXN_Sms)

```csharp
public class SmsModel
{
    [Key]
    public int SmsId { get; set; }
    public int SmsCounter { get; set; }      // reserved for provider-returned credit count
    public int PatientId { get; set; }
    public int? DoctorId { get; set; }
    public string SmsInformation { get; set; }   // full message body
    public DateTime? CreatedOn { get; set; }
    public int? CreatedBy { get; set; }
}
```

### LabSMSModel (Lab / LAB_Sms)

```csharp
public class LabSMSModel
{
    [Key]
    public int SmsId { get; set; }
    public long RequisitionId { get; set; }   // FK to LAB_TestRequisition
    public string Message { get; set; }
    public int CreatedBy { get; set; }       // EmployeeId
    public DateTime CreatedOn { get; set; }
    [NotMapped] public string PhoneNumber { get; set; }   // transient, used during dispatch
}
```

### EmailSendDetailModel (Master / MSTEmailSendDetail)

```csharp
public class EmailSendDetailModel
{
    [Key]
    public int SendId { get; set; }
    public int SendBy { get; set; }          // EmployeeId
    public string SendToEmail { get; set; }
    public string EmailSubject { get; set; }
    public DateTime SendOn { get; set; }
}
```

### LabEmailModel / RadEmailModel (DTOs)

```csharp
public class LabEmailModel   // identical to RadEmailModel except ImageAttachments list type
{
    public string EmailAddress { get; set; }            // primary recipient
    public string Subject { get; set; }
    public string PlainContent { get; set; }            // sent when SendHtml == false
    public string HtmlContent { get; set; }             // sent when SendHtml == true
    public string PdfBase64 { get; set; }               // sent when SendPdf == true
    public string AttachmentFileName { get; set; }      // e.g. "LabReport_123"
    public List<AttachmentModel> ImageAttachments { get; set; }   // Lab variant
    public string SenderEmailAddress { get; set; }      // From address
    public string SenderTitle { get; set; }             // From display name
    public bool SendPdf { get; set; }
    public bool SendHtml { get; set; }
    public List<string> EmailList { get; set; }         // final recipient list (per-recipient loop)
}
```

### EmailViewModel (ad-hoc, Inventory)

```csharp
public class EmailViewModel
{
    public string EmailAddress { get; set; }            // semicolon-delimited input
    public string Subject { get; set; }
    public string Content { get; set; }
    public List<string> EmailAddressList { get; set; }   // server-side split
}
```

### AttachmentModel / ImageAttachmentModel

Used inside Lab/Rad email DTOs. `ImageAttachmentModel` has the same shape with `ImageBase64` / `ImageName` instead of `FileBase64` / `FileName`. These are not in the reference source tree as standalone files — they are defined in `DanpheEMR.ServerModel.LabModels` and `DanpheEMR.ServerModel.RadiologyModels` respectively.

---

## 4. Database Tables

> The hospital-database SQL is not part of the `DanpheEMR reference/` tree (only the `DanpheAdmin_CompleteDB.sql` is included, which doesn't include notification tables). The DDL below is reconstructed from the `modelBuilder.Entity<>().ToTable(...)` declarations and the model property types.

### CORE_Notification

```sql
CREATE TABLE [dbo].[CORE_Notification] (
    [NotificationId]          INT             IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [Notification_ModuleName] VARCHAR(100)   NULL,
    [Notification_Title]      VARCHAR(200)   NULL,
    [Notification_Details]    VARCHAR(1000)  NULL,
    [RecipientId]             INT            NULL,
    [ParentTableName]         VARCHAR(100)   NULL,
    [NotificationParentId]    INT            NOT NULL,
    [IsRead]                  BIT            NOT NULL DEFAULT 0,
    [ReadBy]                  INT            NULL,
    [CreatedOn]               DATETIME       NOT NULL,
    [IsArchived]              BIT            NULL DEFAULT 0,
    [RecipientType]           VARCHAR(20)    NULL,   -- 'user' or 'rbac-role'
    [Sub_ModuleName]          VARCHAR(100)   NULL
);
```

Indexes recommended (not in source): `(RecipientType, RecipientId, IsArchived, CreatedOn DESC)` to support the UserNotifications query, and `(IsRead)` to support the unread counter.

### TXN_Sms

```sql
CREATE TABLE [dbo].[TXN_Sms] (
    [SmsId]           INT            IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [SmsCounter]      INT            NULL,
    [PatientId]       INT            NOT NULL,
    [DoctorId]        INT            NULL,
    [SmsInformation]  VARCHAR(2000)  NULL,
    [CreatedOn]       DATETIME       NULL,
    [CreatedBy]       INT            NULL
);
```

### LAB_Sms

```sql
CREATE TABLE [dbo].[LAB_Sms] (
    [SmsId]          INT             IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [RequisitionId]  BIGINT          NOT NULL,   -- FK to LAB_TestRequisition
    [Message]        VARCHAR(2000)   NULL,
    [CreatedBy]      INT             NOT NULL,
    [CreatedOn]      DATETIME        NOT NULL
);
```

### MSTEmailSendDetail

```sql
CREATE TABLE [dbo].[MSTEmailSendDetail] (
    [SendId]        INT             IDENTITY(1,1) NOT NULL PRIMARY KEY,
    [SendBy]        INT             NOT NULL,    -- EmployeeId
    [SendToEmail]   VARCHAR(200)    NOT NULL,
    [EmailSubject]  VARCHAR(500)    NULL,
    [SendOn]        DATETIME        NOT NULL
);
```

### Other related / referenced tables (FK targets)

| Table | Used by |
|-------|---------|
| `PAT_PatientVisits` | NotificationController.VisitNotificaionDetail join; also referenced by `NotiFicationDbContext`. |
| `INV_TXN_PurchaseRequest` | InventoryBL.CreateNotificationForPRVerifiers `ParentTableName`. |
| `INV_TXN_GoodsReceipt` | InventoryGoodReceiptService.SendNotificationToVerifiers `ParentTableName`. |
| `PHRM_MST_Item` | PharmacySettingsController / PharmacyController `ParentTableName` for new-medicine notifications. |
| `CORE_CFG_Parameters` | Houses `LabSmsProviderName`, `SmsParameter` (lab SMS), and `APIKeyOfEmailSendGrid` (group `common`). |
| `RBAC_Role` | Source of `RoleId` for `RecipientType='rbac-role'` notifications. |
| `EMP_Employee` | Source of `EmployeeId` for `RecipientType='user'` notifications. |

---

## 5. Key Workflows

### 5.1 Create In-App Notification (cross-module side effect)

Any module that needs to alert a user/role follows this pattern:

```csharp
// 1. Construct the shared NotiFicationDbContext
var notifDb = new NotiFicationDbContext(connString);

// 2. Look up the target role (or use the actor's EmployeeId for "user" type)
int pharmacyRoleId = rbacDbContext.Roles
    .Where(a => a.RoleName == "Pharmacy")
    .Select(a => a.RoleId).FirstOrDefault();

// 3. Build the notification
var notification = new NotificationViewModel
{
    Notification_ModuleName = "Pharmacy_Module",
    Notification_Title      = "New Medicine",
    Notification_Details    = $"{currentUser.UserName} has added new item {itemName}",
    RecipientId             = pharmacyRoleId,
    RecipientType           = "rbac-role",
    ParentTableName         = "PHRM_MST_Item",
    NotificationParentId    = 0,                  // 0 = no specific row to navigate to
    IsRead                  = false,
    IsArchived              = false,
    ReadBy                  = 0,
    CreatedOn               = DateTime.Now,
    Sub_ModuleName          = "Store Stock"
};

// 4. Save
notifDb.Notifications.Add(notification);
notifDb.SaveChanges();
```

The same shape is used by `InventoryBL.CreateNotificationForPRVerifiers` (static helper called from InventoryController) and `InventoryGoodReceiptService.SendNotificationToVerifiers` (instance method called from the good-receipt flow).

### 5.2 Retrieve Active Notifications (bell dropdown)

`GET /api/Notification/UserNotifications` calls `GettingUserNotifications(EmployeeId)` which:

1. Filters `Notifications` to `RecipientId != null && IsArchived == false && CreatedOn >= NOW - 7 days`.
2. Splits into two in-memory lists:
   - `userNotifications`: where `RecipientType == "user"` AND `RecipientId == currentEmployeeId`.
   - `userRoleNotifcns`: where `RecipientType == "rbac-role"` AND `RecipientId IN (currentUser.Roles.RoleId)` (LINQ join on session-cached `user-roles` list).
3. Concats, orders by `CreatedOn DESC`, distincts, returns the merged list.

The frontend then re-orders by `NotificationId DESC` for the dropdown and counts `IsRead == false` to render the badge.

### 5.3 Mark As Read / Archive

`PUT /api/Notification/MarkAsRead` accepts a JSON array of `NotificationViewModel` and, for each row, attaches it to the context and marks only `IsRead` and `ReadBy` as modified, then `SaveChanges()`. `ReadBy` is set to the current EmployeeId.

`PUT /api/Notification/Archive` does the same but updates only `IsArchived = true`. The frontend optimistically removes archived rows from the bell dropdown and decrements `totalMsgCount`.

### 5.4 SMS Dispatch — Admission

`AdmissionController.CreateAdmission` builds a `SmsModel` (patient + doctor + admission message), then `Task.Run(() => PostSMS(smsmdl, doctorContactNumber, admissionDbContext))`. `PostSMS` uses `WebClient.UploadValues` to POST a form (`from`, `token`, `to`, `text`) to `http://api.sparrowsms.com/v2/sms/`, then persists the original `SmsModel` to `TXN_Sms` regardless of the provider response.

> The token and `from` are hard-coded in source (`"Demo"`, `"1eZClpxXFuZXd7PJ0xmv"`). This is a legacy implementation and is flagged for the migration target.

### 5.5 SMS Dispatch — Lab / Covid

`LabController.PostSMS` is invoked from `POST /api/Lab/Notification/Sms` (body is a comma-delimited requisition id string):

1. Resolve `patientData` via `GetSmsMessageAndNumberOfPatientByReqId` (returns a `LabSMSModel` with `PhoneNumber`, `Message`).
2. URL-encode the message.
3. Read two `AdminParameters` rows from `CORE_CFG_Parameters` where `ParameterGroupName='lab'`: `LabSmsProviderName` (default `"Sparrow"`) and `SmsParameter` (a JSON array of provider configs, default `"[]"`).
4. Select the matching provider config and dispatch:
   - **LumbiniTech**: build a URL by replacing tokens `SMSKEY`, `SMSPHONENUMBER`, `SMSMESSAGE` in the configured template, then `WebRequest.GetResponse()`. On 200, persist `LabSMSModel` and run `SP_LAB_Update_Test_SmsStatus` against the requisition ids.
   - **Sparrow**: not implemented in the reference (placeholder branch with a `//sparrow implementation` comment).
5. On any non-200, throw `"Unable to send SMS."`.

### 5.6 SMS-Applicable Tests Query

`GET /api/Lab/Notification/CovidResults?FromDate=&ToDate=` calls `LabDbContext.GetCovidTestResults(FromDate, ToDate)` which runs the stored proc `SP_LAB_GetAllSmsApplicableTests` and returns a `DataTable`. The frontend renders it as a check-list, lets the user filter by `IsSmsSend` (Sent / NotSent / All) and by result value (Positive / Negative / All), and supports "Select All".

### 5.7 Email Dispatch — Lab Report

`POST /api/Lab/EmailLabReport` calls `SendLabReportEmailToPatient`:

1. Deserialise the body into `LabEmailModel`.
2. Read `APIKeyOfEmailSendGrid` from `CORE_CFG_Parameters` where `ParameterGroupName='common'`.
3. Null out `PdfBase64` / `AttachmentFileName` if `SendPdf == false`; null out `PlainContent` if `SendHtml == false`.
4. Call `EmailService.SendEmail(...)` (PDF + image-attachment overload) and wait synchronously.
5. On `"OK"`, insert one `EmailSendDetailModel` per `EmailList` entry into `MSTEmailSendDetail` (loop, not bulk).

### 5.8 Email Dispatch — Radiology Report

`RadiologyController.SendEmail` is the radiology equivalent of the lab path, using `RadEmailModel` (which differs only in `List<ImageAttachmentModel> ImageAttachments` vs `List<AttachmentModel>`). Same SendGrid call, same `MSTEmailSendDetail` audit pattern. There are two callers in the controller (the `SendEmail` route and an internal `EmailModel` handler around line 2400).

### 5.9 Covid PDF → Google Drive (Lab)

`POST /api/Lab/Notification/UploadCovidReportToGoogleDrive?requisitionId=` accepts a base64 PDF, decodes it, and writes it to the configured local folder (`CovidReportFileUploadPath`). Despite the route name, the reference does not actually push to Google Drive — it persists locally and the frontend's `sendSingleSMS` flow chains `SendPdf` → `GetMessageToSend` to perform the SMS+PDF handoff in one click.

### 5.10 Frontend Auto-Refresh Loop

`NotificationComponent.ngOnInit` → `GetNotificationSettings` creates `Observable.timer(0, 300_000)` (5 min) and subscribes a handler that calls `tickerFunc(tick)` → `NotificationBLService.GetNotification()` → `NotificationDLService.GetNotification()` → `GET /api/Notification/UserNotifications`. On a strictly-increasing message count, the component plays `/themes/text_notification.mp3` and toggles `dropdownOpened` to retrigger the blink animation. Errors are silently logged to `console`; no toast is raised for transient failures.

---

## 6. API Endpoints

### In-App Notification (4)

| # | Method | Route | Auth | Purpose |
|---|--------|-------|------|---------|
| 1 | `GET`  | `/api/Notification/UserNotifications` | Session (RbacUser) | Return merged user+role active notifications for the last 7 days. |
| 2 | `GET`  | `/api/Notification/VisitNotificaionDetail?notificationId={id}` | Session | Resolve `notificationId` → `{PatientId, PatientVisitId, PerformerId}` via join on `PAT_PatientVisits`. |
| 3 | `PUT`  | `/api/Notification/MarkAsRead` | Session | Body: `NotificationViewModel[]`. Sets `IsRead=true`, `ReadBy=currentUser.EmployeeId` for each. |
| 4 | `PUT`  | `/api/Notification/Archive` | Session | Body: `NotificationViewModel[]`. Sets `IsArchived=true` for each. |

### Lab Notification / SMS / Email (5)

| # | Method | Route | Auth | Purpose |
|---|--------|-------|------|---------|
| 5 | `GET`  | `/api/Lab/Notification/CovidResults?FromDate={}&ToDate={}` | Session | Returns `DataTable` of SMS-applicable Covid tests via `SP_LAB_GetAllSmsApplicableTests`. |
| 6 | `GET`  | `/api/Lab/Notification/CovidSmsText?requisitionId={id}` | Session | Returns the rendered SMS message body + phone number for a single requisition. |
| 7 | `POST` | `/api/Lab/Notification/Sms` | Session | Body: comma-delimited requisition ids. Dispatches via configured provider, persists to `LAB_Sms`, calls `SP_LAB_Update_Test_SmsStatus`. |
| 8 | `POST` | `/api/Lab/Notification/UploadCovidReportToGoogleDrive?requisitionId={id}` | Session | Body: base64 PDF. Saves to local folder. |
| 9 | `POST` | `/api/Lab/EmailLabReport` | Session | Body: `LabEmailModel`. Sends SendGrid email with optional PDF + image attachments, writes `MSTEmailSendDetail`. |

### Radiology (2)

| # | Method | Route | Auth | Purpose |
|---|--------|-------|------|---------|
| 10 | `POST` | `/api/Radiology/SendEmail` | Session | Body: `RadEmailModel`. Sends SendGrid email, writes `MSTEmailSendDetail`. |
| 11 | `PUT`  | `/api/Radiology/SendEmail` | Session | (Duplicated handler in same controller — kept for legacy client compatibility.) |

### Inventory Email (1)

| # | Method | Route | Auth | Purpose |
|---|--------|-------|------|---------|
| 12 | `POST` | `/api/InventoryEmail` | Session | Body: `EmailViewModel` (semicolon-delimited `EmailAddress`). Sends SendGrid email, no audit row. |

### Internal (non-HTTP) Dispatchers

| # | Caller | Purpose |
|---|--------|---------|
| 13 | `AdmissionController.CreateAdmission` → `PostSMS` | Builds `SmsModel` and POSTs to `sparrowsms.com`. Persists to `TXN_Sms`. |
| 14 | `InventoryBL.CreateNotificationForPRVerifiers(PurchaseRequestId, RoleId, NotiFicationDbContext)` | Static helper. Inserts a `CORE_Notification` row for a single role. |
| 15 | `InventoryGoodReceiptService.SendNotificationToVerifiers(GoodsReceiptId, Verifiers, IsVerificationEnabled)` | Iterates `Verifiers` (each `{Id, Type='user'|'role'}`), resolves the `RecipientId`, inserts a `CORE_Notification` per verifier. |
| 16 | `PharmacySettingsController.AddItem` (and the legacy `PharmacyController` `?reqType=addItem` branch) | Inserts a `Pharmacy_Module / Store Stock` notification to the `Pharmacy` role. |
| 17 | `InventoryController` PurchaseRequest post | Reads `VerificationBL.GetPurchaseRequestVerificationSetting`, expands `PermissionIds` via `RBAC.GetAllRoleIdsByPermissionId`, then calls `CreateNotificationForPRVerifiers` per role. |

### Frontend Service Endpoints (Angular, count as integration points)

| # | Service Method | HTTP |
|---|---------------|------|
| 18 | `NotificationDLService.GetNotification()` | `GET /api/Notification/UserNotifications` |
| 19 | `NotificationDLService.GetNotificationVisitDetail(id)` | `GET /api/Notification/VisitNotificaionDetail?notificationId=…` |
| 20 | `NotificationDLService.PutNotificationIsRead(jsonString)` | `PUT /api/Notification/MarkAsRead` |
| 21 | `NotificationDLService.PutNotificationIsArchived(jsonString)` | `PUT /api/Notification/Archive` |
| 22 | `LabsDLService.GetSMSApplicableTest(fromDate, toDate)` | `GET /api/Lab/Notification/CovidResults?…` |
| 23 | `LabsDLService.PostSMS(reqId)` | `POST /api/Lab/Notification/Sms` |
| 24 | `LabsDLService.GetSMSToBeSendMsg(reqId)` | `GET /api/Lab/Notification/CovidSmsText?requisitionId=…` |
| 25 | `LabsDLService.SendPdf(base64, reqId)` | `POST /api/Lab/Notification/UploadCovidReportToGoogleDrive?requisitionId=…` |
| 26 | `LabsDLService.SendEmail(labEmailModel)` | `POST /api/Lab/EmailLabReport` |

---

## 7. Cross-Module Integration

### Patient / Visits

- **Notification routing**: `Visits_Module / Appointment` notifications resolved via `VisitNotificaionDetail` → `/Doctors/PatientOverviewMain/PatientOverview` deep-link. The controller joins `CORE_Notification` to `PAT_PatientVisits` on `NotificationParentId == PatientVisitId` and returns `{PatientId, PatientVisitId, PerformerId}` which the frontend writes into `patientService.getGlobal()` and `visitService.getGlobal()` before navigating.
- **Module classification value**: `Visits_Module` (used in `Sub_ModuleName="Appointment"` and any future visit-related alerts).

### Appointment

- Appointment creation (not in this controller scope) raises `Visits_Module / Appointment` notifications. The frontend branches in `NotificationOnClick` to call `GetNotificationVisitDetail` only for this combination.

### Lab

- **Notification routing**: `Labs_Module / Lab-SampleCollection` → `/Lab/Requisition`. `Labs_Module / Lab-AddResult` → `/Lab/ListPatientReport`.
- **SMS dispatch**: Lab Covid flow uses `/api/Lab/Notification/Sms` with provider configured in `CORE_CFG_Parameters`.
- **Email dispatch**: `/api/Lab/EmailLabReport` accepts `LabEmailModel` with PDF + image attachments. Frontend is `send-sms.component.ts` which combines PDF export + SMS in a single click (`sendPsfAndSmsOnSingleClick`).
- **SP dependency**: `SP_LAB_GetAllSmsApplicableTests` and `SP_LAB_Update_Test_SmsStatus` must exist in the hospital DB.

### Radiology

- **Email dispatch**: `/api/Radiology/SendEmail` accepts `RadEmailModel` with PDF + image attachments. Audit-logged to `MSTEmailSendDetail`. Two callers in `RadiologyController` (line ~242 and line ~2400) — the second is an inline report-send path.
- **No in-app notification** is created by Radiology in the reference; the in-app channel is SMS/email only.

### Pharmacy

- **Notification creation**: `PharmacySettingsController.AddItem` (and the legacy `PharmacyController` `addItem` branch) raise a `Pharmacy_Module / Store Stock` notification to the `Pharmacy` role on every new medicine.
- **No SMS / email** is sent by Pharmacy in the reference.

### Inventory

- **Notification creation — Purchase Request**: `InventoryController` post handler reads `VerificationBL.GetPurchaseRequestVerificationSetting`. If `EnableVerification == true && VerificationLevel > 0`, it builds the list of role ids via `RBAC.GetAllRoleIdsByPermissionId(PermissionIds)` and calls `InventoryBL.CreateNotificationForPRVerifiers(reqId, roleId, notifDb)` per role. Module/sub: `Inventory_Module / PR_Verification`. Frontend routes this to `/Verification/PurchaseRequest` on click.
- **Notification creation — Goods Receipt**: `InventoryGoodReceiptService.SendNotificationToVerifiers(GoodsReceiptId, Verifiers, IsVerificationEnabled)` runs after a good-receipt is committed. Each verifier (user or role) gets a `Inventory_Module / GR_QualtityInspection` notification.
- **Email — ad-hoc**: `/api/InventoryEmail` (no audit row). Sends any free-form message via SendGrid from a hard-coded sender. API key is also hard-coded in the controller — flagged for the migration target.

### Admission

- **SMS dispatch**: `AdmissionController.CreateAdmission` builds a `SmsModel` for the admitting doctor and fires `Task.Run(() => PostSMS(...))` against `http://api.sparrowsms.com/v2/sms/`. Hard-coded `from="Demo"`, `token="1eZClpxXFuZXd7PJ0xmv"`. Persists to `TXN_Sms` unconditionally after the WebClient call (the response itself is not strongly-typed to a `SmsModel` — `SmsCounter` is never populated).
- **No in-app notification** is created by Admission in the reference.

### Emergency

- **Notification routing**: `Emergency / Emergency` is recognized in the frontend `NotificationOnClick` handler but has no redirect (intentionally a no-op, presumably placeholder for future ER deep-links). No backend code creates this notification in the reference.

### Master / Settings (indirect)

- **Email API key** is read from `CORE_CFG_Parameters` where `ParameterGroupName='common' AND ParameterName='APIKeyOfEmailSendGrid'`. Same row is read by Lab, Radiology, and (would be) any future email caller.
- **SMS provider config** is read from `CORE_CFG_Parameters` where `ParameterGroupName='lab' AND ParameterName IN ('LabSmsProviderName', 'SmsParameter')`.

---

## 8. Business Rules

### In-App Notification

1. **Active window = 7 days.** `GettingUserNotifications` filters on `CreatedOn >= NOW.Date.AddDays(-7)`. Older rows are kept in the table for audit/history but are never surfaced in the bell dropdown.
2. **Recipient resolution at read time.** The query joins against the session-cached `user-roles` list (not the DB) to expand role-scoped notifications. A role change therefore takes effect on the next login (when the session is rebuilt).
3. **Two recipient types.** `RecipientType` is `user` (EmployeeId) or `rbac-role` (RoleId). The same row is never both; a given notification targets exactly one recipient.
4. **`ParentTableName` + `NotificationParentId` is a logical FK.** No DB-level FK exists. The frontend `NotificationOnClick` switch only knows how to navigate for a small set of (Module, SubModule) pairs; unknown combinations render the title/details but do not navigate.
5. **Mark-as-read is auto-triggered.** Clicking a notification calls `MarkAsRead([currtNotification])` before the deep-link navigation. The same payload is then immediately re-fetched on the next 5-minute tick to update the badge.
6. **Archive is a soft-delete.** Archived rows are filtered out of the bell dropdown but remain in the DB. The reference has no "show archived" UI and no archive purge job; old archived rows can be cleared via the `delete from CORE_Notification; DBCC CHECKIDENT('CORE_Notification', RESEED, 0)` script in `Database/CleanUpScript.sql`.
7. **Auto-refresh every 5 minutes.** `notificationReloadFrequencyInMs = 300_000`. A configurable `NotificationSettings` core parameter exists in code (`{IsNotificationDisplayEnabled, TimeToReloadInSeconds, Push_VisitMessages}`) but is currently disabled — the `GetNotificationSettings` method falls through to the hard-coded 5-minute timer.
8. **Audio alert only on growth.** `PlayAlertAudio` fires only when the new total count is greater than the previous one, and the bell has been seen at least once. The audio asset is `/themes/text_notification.mp3`.
9. **Bell badge = unread only.** `unReadNotfCount` filters on `IsRead == false`. Archived rows are not counted regardless of read state.
10. **NotificationId is the natural ordering key** for the bell UI (the controller returns `OrderByDescending(n => n.CreatedOn)`, but the frontend re-orders by `NotificationId DESC` before rendering).

### SMS

11. **Two provider families in Lab, one in Admission.** Lab honours `LabSmsProviderName`; Admission is hard-coded to Sparrow.
12. **LumbiniTech URL token template.** `Url.Replace("SMSKEY", key).Replace("SMSPHONENUMBER", phone).Replace("SMSMESSAGE", urlEncodedMsg)`. The HTTP method is `GET`. Status `200` is the only success path; anything else throws.
13. **Sparrow in Lab is a stub.** The `providerName == "Sparrow"` branch in `PostSMS` is a comment-only placeholder. Lab's Sparrow integration was never completed; only LumbiniTech is wired up.
14. **Sparrow in Admission uses form POST.** `WebClient.UploadValues(url, "Post", NameValueCollection)` with `from`, `token`, `to`, `text`. The response is JSON-deserialised into a `SmsModel` but the resulting `SmsCounter` is never read or stored.
15. **SMS persists regardless of provider response.** The local `SmsModel` is `Add`'d to `dbContext.SmsService` and `SaveChanges`'d unconditionally after the WebClient call (Lab only persists on 200, Admission persists on every call).
16. **SmsCounter field is reserved.** The model has the field but the reference does not populate it from any provider response. It is intended for credit-balance tracking.
17. **Lab SMS does not enforce unique-recipient-per-send.** The same requisition can be sent twice; idempotency is owned by the SMS-status SP (`SP_LAB_Update_Test_SmsStatus`) which the controller runs after a successful send.

### Email

18. **SendGrid is the only provider.** `EmailService` constructs `new SendGridClient(apiKey)` directly — no pluggable interface on the wire.
19. **API key is read from a core parameter.** `CORE_CFG_Parameters` row with `ParameterGroupName='common' AND ParameterName='APIKeyOfEmailSendGrid'`. The hard-coded key in `InventoryEmailController` is a legacy exception and is flagged for the migration.
20. **PDF attachment is base64.** The client renders the report to PDF (`html2canvas` + `jsPDF` in the Angular code) and sends the base64 string. The server wraps it into a SendGrid `Attachment` with `Type=application/pdf` and `Disposition=attachment`.
21. **Image attachments are inline.** `List<AttachmentModel>` / `List<ImageAttachmentModel>` become SendGrid `Attachment`s with `Type=image/jpeg` and `Disposition=attachment`. ContentId = image name (without extension).
22. **One audit row per recipient.** `MSTEmailSendDetail` is written in a `foreach` over `EmailList` — not as a single row with a delimited column. The schema does not capture the per-recipient status; failures are surfaced only as a `throw new Exception("Failed")` at the SendGrid call boundary.
23. **Sync wait on async send.** All email callers do `response.Wait()` on the returned `Task<string>`. This blocks the request thread; for the migration target, dispatch should be enqueued via Cloudflare Queues and the audit row written by a consumer.
24. **`SendPdf=false` ⇒ null-out the PDF fields.** Controllers null `PdfBase64` and `AttachmentFileName` before dispatch to prevent stale content from leaking when the user un-checks the PDF checkbox.
25. **`SendHtml=false` ⇒ null-out the plain-text field.** Same defensive pattern as PDF.
26. **Subject and sender are caller-supplied.** `EmailModel.Subject` and `EmailModel.SenderEmailAddress` come from the client. There is no server-side allowlist or default.

### Multi-tenancy (Migration Target)

27. **Notification, SMS, and email tables are tenant-scoped.** On Cloudflare/D1 the `core_notifications`, `txn_sms`, `lab_sms`, and `mst_email_send_detail` tables all gain a `tenant_id` column. The `NotiFicationDbContext` is replaced by a per-tenant helper and the JWT carries `tenant_id` per `AGENTS.md`.
28. **SMS providers move to a per-tenant config.** `core_cfg_parameters` rows are tenant-scoped; the API key for SendGrid and the LumbiniTech URL template become tenant-overrideable rather than global.
29. **The 5-minute poll becomes a server-sent event / Web Push** so multi-tab browsers receive the same update without each tab polling independently.
30. **Hard-coded values in `AdmissionController.PostSMS` and `InventoryEmailController` are replaced by tenant configuration** loaded from the per-tenant `core_cfg_parameters` row.
