# Order Module (DanpheEMR Reference)

Complete reference for the DanpheEMR Order module. Covers the unified clinical order entry screen that lets a doctor or nurse order **lab tests, imaging studies, medications, and miscellaneous service items** from one place, route them to the appropriate departments, and create the corresponding requisition + provisional-billing rows in a single transaction. This document is the authoritative technical reference for the Order subsystem as it exists in the .NET/SQL Server implementation; the Cloudflare/Hono migration must preserve every workflow documented here.

---

## 1. Module Overview

The Order module in DanpheEMR is **not a top-level domain module with its own tables** — it is a *coordinator* sitting on top of the existing Lab, Radiology, Pharmacy and Billing modules. It exists because a doctor at the patient-overview screen needs a single autocomplete to type "CBC", "Chest X-Ray" or "Paracetamol 500mg" without context-switching between four different sub-screens.

Core capabilities:

- **Unified item catalogue** — One autocomplete aggregates Lab tests, Imaging items, Pharmacy medications (by brand or generic), and "other" service items into a single ranked list, all tagged with a `PreferenceType` discriminator.
- **Per-employee favourites ("My Preferences")** — Each doctor can star items they commonly order; these are persisted as XML fragments in `EMP_EmployeePreferences`. There are five preference buckets: `Labtestpreferences`, `Imagingpreferences`, `Medicationpreferences`, `Patientpreferences`, `Followuppreferences`.
- **Price-category-aware pricing** — Items are filtered and priced by the patient's `PriceCategoryId` (resolved from the current visit context, e.g. Normal / EHS / SAARC / Foreigner / Insurance).
- **Active-orders summary** — The same screen shows the patient's existing lab, imaging and medication orders that match the *current visit* (orders from past visits are filtered out) along with all unresolved problems and the latest three vitals.
- **Provisional-billing-first requisition** — When the doctor clicks "Proceed", the selected items are NOT posted to the lab/radiology requisition tables directly. Instead they are written as a single `BIL_TXN_BillingTransaction` + `BIL_TXN_BillingTransactionItems` row with `BillStatus = 'provisional'` and `OrderStatus = 'active'`. The lab, imaging and "other" requisition rows are created downstream by `BillingTransactionBL` (see `Controllers/Billing/BillingTransactionBL.cs:1242` `AddProvisionalLabRequisitions`). Medications follow a separate path: they are posted to the pharmacy prescription service as a `PHRM_Prescription` header + `PHRM_PrescriptionItems`.
- **Doctor-aware routing** — The current logged-in employee's `EmployeeId` is the `PrescriberId` on every requisition; the visit's `PerformerId`/`PerformerName` (formerly Provider) is also captured for the "performer" linkage.
- **Re-use of billing master** — Lab/Imaging items are read from `BIL_MST_ServiceItem` joined to `BIL_MST_ServiceDepartment` filtered by `IntegrationName in ('lab','radiology')` — i.e. the **billing service-item** is the source of truth, not the lab's `LAB_LabTests` table. This keeps price category and department metadata in one place.
- **Order Status Lifecycle** — `OrderStatus` follows the same string enum used everywhere in the system (`ENUM_OrderStatus`):
  - `active` — created, not yet sample-collected
  - `pending` — sample collected, awaiting result entry
  - `result-added` / `report-generated` — completed
  - `final` — report visible to the doctor
  - `cancel` / `returned` — terminal billing-side statuses
- **Multi-tenant-ready** — All tables used by the module carry `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`. Tenant scope is implicit (one DB per hospital).
- **Print medication slip** — A dedicated `PrintMedications` view allows printing the active medication list using a popup window with the hospital's `CustomerHeader` parameters.

### Why there is no `ORD_*` table

Unlike domains such as Lab, Radiology or Pharmacy which each own their `LAB_*`, `RAD_*`, `PHRM_*` tables, the Order module does NOT own a master `ORD_*` table. Orders are realised by writing into the destination tables directly:

| Destination table | Written by | When |
|------------------|-----------|------|
| `BIL_TXN_BillingTransaction` + `BIL_TXN_BillingTransactionItems` | `BillingTransactionBL.PostProvisionalBillingTransaction` | First click of "Proceed" |
| `LAB_TestRequisition` | `BillingTransactionBL.AddProvisionalLabRequisitions` | Inside the same transaction |
| `RAD_PatientImagingRequisition` | `BillingTransactionBL.AddProvisionalImagingRequisitions` (analogous) | Inside the same transaction |
| `BIL_BillItemRequisition` | `BillingController.PostBillingItemRequisition` | For "other" items |
| `PHRM_Prescription` + `PHRM_PrescriptionItems` | `PharmacyPrescriptionController.NewPrescription` | For medication items |
| `EMP_EmployeePreferences` | `OrdersController.PostEmployeePreference` | When starring an item |

The Order module's job is to **build the request payloads** for these downstream services. Re-implementing it in the Cloudflare stack requires either:
1. Preserving the same "write-through" model (recommended — minimal behavioural change), or
2. Introducing a new `ord_order` master table with `ord_order_items` and adding hooks to write to lab/radiology/pharmacy from there (more invasive; would require touching every reader of those tables).

### Routing summary

```
Doctor's Patient Overview  →  "New Orders" panel
   ├── autocomplete  →  /api/Orders/OrderItems?priceCategoryId=…
   ├── favourites    →  /api/Orders/EmployeePreferences
   └── on Proceed    →  /Doctors/PatientOverviewMain/Orders/OrderRequisition

Order Requisition review page
   ├── adjust dosage / route / frequency for meds
   ├── confirm billing scheme / price category
   └── on Add to Requisition
        ├── if any lab/imaging/other item  →  /api/Billing/ProceedToBillingTransaction (provisional, status=active)
        └── if any medication              →  /api/PharmacyPrescription/NewPrescription
```

---

## 2. Backend Files

### 2.1 Controller Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `Controllers/Order/OrdersController.cs` | 1108 | All order-screen APIs (active orders, item catalogue, employee preferences) |
| `Controllers/Order/OrderView.cs` | 92 | MVC view-routing shim for `OrderRequisitions`, `OrderMain`, `PrintMedications` (legacy `.cshtml`) |
| `Controllers/Doctors/DoctorsController.cs` | 834 | Owns `PatientOverview` and `OtherRequestsOfPatient` endpoints called by `OrdersModule` to load patient state |
| `Controllers/Pharmacy/PharmacyPrescriptionController.cs` | 166 | Owns the `NewPrescription` endpoint called by `OrdersDLService.PostPharmacyPrescription` |
| `Controllers/Billing/BillingTransactionBL.cs` | ~1200+ | Receives the provisional billing transaction from the Order screen and fans out to lab / imaging / other requisition tables inside one transaction (see `AddProvisionalLabRequisitions` at line 1242) |
| `Controllers/Clinical/ClinicalController.cs` | ~8000+ | Mirrors lab-requisition rows for ICD-diagnosis linkage; called indirectly by the Order screen when diagnosis-driven ordering is in play |

### 2.2 DAL Layer

`Components/DanpheEMR.DalLayer/OrdersDbContext.cs` (63 lines) exposes the `DbSet`s used by `OrdersController`:

| DbSet | Underlying Table | Notes |
|-------|-----------------|-------|
| `ImagingItems` | `RAD_MST_ImagingItem` | Joined with `ImagingTypes` for display |
| `LabTests` | `LAB_LabTests` | Used by `GetLabPreferences` only |
| `PharmacyItems` | `PHRM_MST_Item` | Used by medication queries |
| `PharmacyStocks` | `PHRM_TXN_StoreStock` | Stock availability for `AvailableQuantity` |
| `PharmacyGenericItems` | `PHRM_MST_Generic` | Generic name + dosage map |
| `GenericDosageMaps` | `PHRM_MAP_GenericDosaseNFreq` | Default dosage, route, frequency per generic |
| `EmployeePreferences` | `EMP_EmployeePreferences` | XML storage of starred items |
| `BillServiceItems` | `BIL_MST_ServiceItem` | Master source for Lab/Imaging/Others |
| `ServiceDepartment` | `BIL_MST_ServiceDepartment` | Used to discriminate Lab vs Radiology vs Other |
| `Departments` | `MST_Department` | Required by EF model; unused by Order controller directly |
| `BillingTransactionModels` | `BIL_TXN_BillingTransaction` | Inherited EF context |
| `Wards` | `ADT_MST_Ward` | Inherited |
| `Admissions` | `ADT_PatientAdmission` | Inherited |
| `BillPriceCategoryServiceItems` | `BIL_MAP_PriceCategoryServiceItem` | Drives `priceCategoryId` filtering and price lookup |

### 2.3 Key Controller Methods (OrdersController)

| Method | HTTP | Route | Purpose |
|--------|------|-------|---------|
| `ActiveOrders` | GET | `/api/Orders/ActiveOrders` | Returns patient + visits + active (non-returned) lab and imaging requisitions for the current visit, plus latest 3 vitals, unresolved problems, allergies, current medication prescriptions, and "other" active requests |
| `OrderItems` | GET | `/api/Orders/OrderItems` | Aggregated catalogue: lab + imaging + pharmacy + other items, filtered by `priceCategoryId` |
| `GenericMaps` | GET | `/api/Orders/GenericMaps` | Pharmacy generic list (legacy — HAMS uses brand-level, generic kept for back-compat) |
| `BillingItems` | GET | `/api/Orders/BillingItems` | Service items from departments other than Lab and Radiology (hard-codes `PriceCategoryId = 1`; flagged in source as "Hard Coded for Now") |
| `EmployeePreferences` | GET | `/api/Orders/EmployeePreferences` | All starred items for the logged-in employee (lab + imaging + medication), combined into one ranked list |
| `PostEmployeePreference` | POST | `/api/Orders/EmployeePreference` | Star an item — appends `<Row><LabTestId/ImagingItemId/MedicineId/PatientId>X</Row>` to the corresponding XML |
| `PutEmployeePreference` | PUT | `/api/Orders/EmployeePreference` | Unstar an item — removes the matching XML node from the preferences document |
| `GetPhrmItems` (private) | — | — | Pharmacy items with stock info (legacy, unused since 2018) |
| `GetPharmacyItems` (private) | — | — | Pharmacy items grouped by available stock (current path) |
| `GetLabItems` (private) | — | — | `BIL_MST_ServiceItem` joined to price category + service-department for `IntegrationName='lab'` |
| `GetImagingItems` (private) | — | — | Same as Lab but `IntegrationName='radiology'` |
| `GetOtherItems` (private) | — | — | Service items where integration name is *not* lab and *not* radiology |
| `GetMedicationPreferences` (private) | — | — | Reads `EMP_EmployeePreferences.PreferenceValue` (XML), finds all `MedicineId` nodes, joins to `PHRM_MST_Item` |
| `GetImagingPreferences` (private) | — | — | Reads XML `ImagingItemId` nodes, joins to `RAD_MST_ImagingItem.Include("ImagingTypes")` |
| `GetLabPreferences` (private) | — | — | Reads XML `LabTestId` nodes, joins to `LAB_LabTests` |
| `GetActiveOrders` (private) | — | — | Big composite `PatientModel` query — see Section 5.1 |
| `GetOrderItems` (private) | — | — | Concat of all five `Get*Items` helpers |
| `GetBillingItems` (private) | — | — | `BIL_MST_ServiceItem` join with hard-coded `PriceCategoryId = 1` |
| `AddEmployeePreference` (private) | — | — | Creates preference row if absent; otherwise appends new XML row |
| `DeleteItemFromEmployeePreference` (private) | — | — | Removes XML node by `ItemId` match |

### 2.4 View Model — `OrderItemsVM`

Declared at the bottom of `OrdersController.cs:1078` and mirrored on the frontend in `orders/orders-vms.ts:OrderItemsVM`. Fields:

| Field | Type | Notes |
|-------|------|-------|
| `Type` | string | Display bucket: "Lab", "Imaging", "Medication", "Others", or `ServiceDepartmentName` for imaging sub-types |
| `ItemId` | int | Domain-specific ID: `LabTestId`, `ImagingItemId`, `ItemId` (PHRM), or `ServiceItemId` (others) |
| `ItemName` | string | |
| `PreferenceType` | string | Discriminator for the autocomplete grouping: "Lab", "Imaging", "Medication", "Patient", "Followup", "Others" |
| `IsPreference` | bool? | True when the item is in the logged-in employee's favourites |
| `GenericId` | int? | Pharmacy only |
| `GenericName` | string | Pharmacy only |
| `IsGeneric` | bool? | True when the autocomplete is searching by generic name (legacy mode) |
| `Dosage`, `Route`, `Frequency`, `FreqInWords` | string/int? | Pharmacy only |
| `AvailableQuantity` | double? | Pharmacy only (sum of all stores' stock) |
| `ServiceItemId` | int | The billing `BIL_MST_ServiceItem.ServiceItemId` |
| `Price` | decimal | From `BIL_MAP_PriceCategoryServiceItem` for the supplied `PriceCategoryId` |
| `IntegrationItemId` | int? | The lab/imaging domain ID stored on the service item (e.g. `LabTestId` for lab items) |
| `ServiceDepartmentId` | int | |
| `ServiceDepartmentName` | string | |
| `SrvDeptIntegrationName` | string | "lab", "radiology", or other |
| `ItemCode` | string | From `BIL_MAP_PriceCategoryServiceItem.ItemLegalCode` |

---

## 3. Data Models

### 3.1 `EmployeePreferences` (`EMP_EmployeePreferences`)

`Code/Components/DanpheEMR.ServerModel/EmployeeModels/EmployeePreferences.cs`

| Field | Type | Notes |
|-------|------|-------|
| `PreferenceId` | int (PK) | |
| `PreferenceName` | string | One of: `Labtestpreferences`, `Imagingpreferences`, `Medicationpreferences`, `Patientpreferences`, `Followuppreferences` |
| `PreferenceValue` | string (XML) | Fragment of `<root><Row><LabTestId/ImagingItemId/MedicineId/PatientId>X</Row>...</root>` |
| `EmployeeId` | int | The doctor whose favourites these are |
| `CreatedBy` | int | |
| `CreatedOn` | DateTime? | |
| `ModifiedBy` | int? | |
| `ModifiedOn` | DateTime? | |
| `IsActive` | bool | Soft-delete flag |

### 3.2 `LabRequisitionModel` (`LAB_TestRequisition`)

`Code/Components/DanpheEMR.ServerModel/LabModels/LabRequisitionModel.cs`

| Field | Type | Notes |
|-------|------|-------|
| `RequisitionId` | long (PK) | |
| `PatientVisitId` | int? | Nullable since 16-Apr-2023 for non-visit scenarios |
| `PatientId` | int | |
| `PrescriberId` | int? | Renamed from `ProviderId` Jun-2022 |
| `LabTestId` | long | |
| `ProcedureCode` | string | |
| `LOINC` | string | Hard-coded "LONIC Code" by `order-requisition.component.ts:586` until lab master is updated |
| `LabTestName` | string | |
| `LabTestSpecimen` | string | |
| `LabTestSpecimenSource` | string | |
| `PatientName` | string | |
| `Diagnosis` | string | |
| `Urgency` | string | Default "Normal" |
| `OrderDateTime` | DateTime | |
| `PrescriberName` | string | |
| `BillingStatus` | string | unpaid / paid / provisional / cancel / returned |
| `OrderStatus` | string | active / pending / result-added / report-generated / final / verified / cancel |
| `SampleCode` | int? | |
| `RequisitionRemarks` | string | |
| `SampleCreatedOn` | DateTime? | |
| `SampleCollectedOnDateTime` | DateTime? | |
| `SampleCreatedBy` | int? | |
| `Comments` | string | |
| `RunNumberType` | string | normal / histo / cyto |
| `ExternalLabSampleStatus` | string | |
| `IsSmsSend` | bool | |
| `LabTestComponentResults` | List | Navigation only — not written by Order module |
| `LabTest`, `Patient` | navigation | EF lazy-loaded |
| `ReportTemplateId` | int | |
| `DiagnosisId` | int? | |
| `CreatedOn` / `CreatedBy` / `ModifiedOn` / `ModifiedBy` | audit | |
| `IsActive` | bool | Excludes inactive rows from active-orders query |
| `VisitType` | string | outpatient / inpatient |
| `LabReportId` | int? | FK once report generated |
| `BarCodeNumber` | long? | |
| `WardName` | string | Captured at order time |
| `IsVerified` / `VerifiedOn` / `VerifiedBy` | bool? / DateTime? / int? | Two-level verification flag |
| `ResultingVendorId` | int | For outsource labs |
| `HasInsurance` | bool | |
| `ResultAddedBy` / `ResultAddedOn` | int? / DateTime? | |
| `PrintedBy` / `PrintCount` | int? / int? | |
| `SampleCodeFormatted` | string | |
| `BillCancelledBy` / `BillCancelledOn` | int? / DateTime? | |
| `LabTypeName` | string | Multi-lab discriminator (Pathology, Histo, Cyto) |
| `GoogleFileIdForCovid` / `CovidFileName` / `IsFileUploaded` / `UploadedBy` / `UploadedOn` | | COVID-specific |
| `IsFileUploadedToTeleMedicine` / `UploadedByToTeleMedicine` / `UploadedOnToTeleMedicine` | | Tele-medicine |
| `IsUploadedToIMU` / `IMUUploadedOn` / `IMUUploadedBy` | | IMU middleware |
| `BillingTransactionItemId` | int | Links back to `BIL_TXN_BillingTransactionItems` |
| `ServiceItemId` | int | |

### 3.3 `ImagingRequisitionModel` (`RAD_PatientImagingRequisition`)

`Code/Components/DanpheEMR.ServerModel/RadiologyModels/ImagingRequisitionModel.cs`

| Field | Type | Notes |
|-------|------|-------|
| `ImagingRequisitionId` | int (PK) | |
| `PatientVisitId` | int? | |
| `PatientId` | int | |
| `PrescriberName` | string | |
| `ImagingTypeId` | int? | E.g. X-Ray, USG, CT, MRI |
| `ImagingTypeName` | string | |
| `ImagingItemId` | int? | The specific study (e.g. "Chest PA") |
| `ImagingItemName` | string | |
| `ProcedureCode` | string | |
| `ImagingDate` | DateTime? | |
| `RequisitionRemarks` | string | |
| `OrderStatus` | string | Same enum as lab |
| `PrescriberId` | int? | |
| `BillingStatus` | string | |
| `Urgency` | string | Default "Normal" |
| `CreatedBy` / `CreatedOn` / `ModifiedBy` / `ModifiedOn` | audit | |
| `DiagnosisId` | int? | |
| `WardName` | string | |
| `IsActive` | bool | |
| `BillCancelledBy` / `BillCancelledOn` | int? / DateTime? | |
| `IsReportSaved` | bool | |
| `Visit`, `Patient`, `ImagingReport`, `ImagingItem` | navigation | |
| `HasInsurance` | bool? | |
| `IsScanned` / `ScannedBy` / `ScannedOn` / `ScanRemarks` | | Film-scan tracking |
| `FilmTypeId` / `FilmQuantity` | int? / int? | |
| `BillingTransactionItemId` | int | |
| `ServiceItemId` | int | |

### 3.4 `BillItemRequisition` (`BIL_BillItemRequisition`)

`Code/Components/DanpheEMR.ServerModel/BillingModels/POS/BillItemRequisition.cs`

Used for "Others" (non-Lab, non-Radiology) items. Created by the Order screen via `BillingBLService.PostBillingItemRequisition` (which posts to `BillingController`).

| Field | Type | Notes |
|-------|------|-------|
| `BillItemRequisitionId` | long (PK) | |
| `RequisitionId` | long? | FK to lab/imaging requisition when applicable |
| `PatientId` | int | |
| `PatientVisitId` | int | |
| `ServiceDepartmentId` | int | |
| `ItemId` | int | |
| `ProviderId` | int | Renamed to `PerformerId` in v22 — both names used in the codebase |
| `ItemName` | string | |
| `Quantity` | double | |
| `ProcedureCode` | string | |
| `BillStatus` | string | |
| `DepartmentName` | string | |
| `Price` | double? | |
| `ServiceDepartment` | string | NotMapped |
| `CreatedBy` / `CreatedOn` | int? / DateTime? | |
| `Patient` | navigation | |
| `AssignedTo` | int? | Added 20-May-2018 |

### 3.5 Frontend Models (TypeScript)

| Model | File | Purpose |
|-------|------|---------|
| `OrderItemsVM` | `orders/shared/orders-vms.ts:3` | Catalogue row — see VM table above |
| `RequisitionResponse` | `orders/shared/orders-vms.ts:35` | Per-domain result holder (lab / imaging / medication / others) |
| `OrderResponse` | `orders/shared/orders-vms.ts:41` | Composite of 4 `RequisitionResponse` |
| `PatientOrderListModel` | `clinical/shared/order-list.model.ts:5` | Used by `orders-select` popup for clinical notes — wraps `Order: OrderItemsVM` + Dosage/Route/Frequency/Duration/Remarks/BrandName |
| `LabTestRequisition` | `labs/shared/lab-requisition.model.ts:4` | The frontend view of a `LabRequisitionModel` |
| `ImagingItemRequisition` | `radiology/shared/imaging-item-requisition.model.ts:1` | The frontend view of an `ImagingRequisitionModel` |
| `BillItemRequisition` | `billing/shared/bill-item-requisition.model.ts:1` | Frontend view of `BillItemRequisition` |
| `PHRMPrescriptionItem` | `pharmacy/shared/phrm-prescription-item.model.ts:12` | Frontend view of a medication order line |
| `CurrentVisitContextVM` | `appointments/shared/current-visit-context.model.ts:1` | PatientId, PatientVisitId, PerformerId/Name, Current_WardBed, VisitType, SchemeId, PriceCategoryId, ClaimCode, MemberNo |

---

## 4. Database Tables

The Order module reads from many tables but **does not own** an `ORD_*` table. The complete list of tables it touches (read or write):

### 4.1 Read (catalogue / lookup)

| Table | Purpose |
|-------|---------|
| `BIL_MST_ServiceItem` | Master catalogue for lab, imaging, and other service items |
| `BIL_MST_ServiceDepartment` | Department discriminator (`IntegrationName in ('lab','radiology')`) |
| `BIL_MAP_PriceCategoryServiceItem` | Price-by-category + `ItemLegalCode` |
| `LAB_LabTests` | Lab-side display name + specimen + LOINC |
| `RAD_MST_ImagingItem` | Imaging-side item master |
| `RAD_MST_ImagingType` | Imaging type (X-Ray, USG, CT, MRI…) |
| `PHRM_MST_Item` | Pharmacy item master |
| `PHRM_MST_Generic` | Generic drug names |
| `PHRM_TXN_StoreStock` | Available stock for `AvailableQuantity` column |
| `PHRM_MAP_GenericDosaseNFreq` | Default dosage / route / frequency per generic |
| `EMP_Employee` | Current user lookup |
| `EMP_EmployeePreferences` | Favourites (XML storage) |
| `RBAC_User` | Current-user session lookup |
| `BIL_CFG_PriceCategory` | Resolved via EF context |
| `MST_Department` | EF context (unused) |
| `ADT_MST_Ward` | EF context (unused) |
| `ADT_PatientAdmission` | EF context (unused) |

### 4.2 Read (active-orders summary, `GetActiveOrders`)

| Table | Purpose |
|-------|---------|
| `PAT_Patient` | Patient demographics, allergies, addresses |
| `PAT_PatientVisits` | Visit list |
| `PAT_PatientVisits.Vitals` | Last 3 vitals (joined via `Include(a => a.Visits.Select(v => v.Vitals))`) |
| `PAT_PatientProblems` | Active problems (`IsResolved = false`) |
| `PAT_PatientAllergies` | Allergies + AdvReaction + Other — name resolved from `PHRM_MST_Item` |
| `LAB_TestRequisition` | Active lab orders (filtered by `PatientVisitId` and `BillingStatus != 'returned'`) |
| `RAD_PatientImagingRequisition` | Active imaging orders (same filter) |
| `PHRM_PrescriptionItems` | Active medication prescriptions |

### 4.3 Write (provisional billing path — primary write path)

| Table | Operation | Trigger |
|-------|-----------|---------|
| `BIL_TXN_BillingTransaction` | INSERT | Order Requisition → "Add to Requisition" with lab/imaging/other items |
| `BIL_TXN_BillingTransactionItems` | INSERT (one per item) | Same trigger; `OrderStatus='active'`, `BillStatus='provisional'` |
| `LAB_TestRequisition` | INSERT | Written by `BillingTransactionBL.AddProvisionalLabRequisitions` triggered by the same transaction |
| `RAD_PatientImagingRequisition` | INSERT | Analogous imaging path |
| `BIL_BillItemRequisition` | INSERT | Written by `BillingController.PostBillingItemRequisition` for "others" items |

### 4.4 Write (medication path — secondary write path)

| Table | Operation | Trigger |
|-------|-----------|---------|
| `PHRM_Prescription` | INSERT | Order Requisition → "Add to Requisition" with medication items |
| `PHRM_PrescriptionItems` | INSERT (one per medication) | Same trigger |

### 4.5 Write (favourites)

| Table | Operation | Trigger |
|-------|-----------|---------|
| `EMP_EmployeePreferences` | INSERT / UPDATE | Star / unstar an item in the autocomplete |

### 4.6 No required schema migrations

Since the Order module uses existing tables only, no dedicated `ORD_*.sql` migration file is required. Any future migration of favourites to a relational table (vs. the current XML) would only affect `EMP_EmployeePreferences` and require a data-migration step.

---

## 5. Key Workflows

### 5.1 Load Active Orders for a Patient Visit

```
Doctor opens Patient Overview
  → OrderMainComponent.initialLoad()                     [orders-main.component.ts:48]
    → doctorsBlService.GetPatientPreview(patientId, visitId)
        → /api/Doctors/PatientOverview?patientId&patientVisitId
            → DoctorsController.GetatientOverview(...)   [DoctorsController.cs:572-616]
                → SELECT * FROM PAT_Patient
                    .Include(Visits.Vitals)
                    .Include(Problems)
                    .Include(Allergies)
                    .Include(Addresses)
                    .Include(LabRequisitions)  -- filtered
                    .Include(ImagingItemRequisitions)  -- filtered
                    .Include(MedicationPrescriptions)
                → filter LabRequisitions:
                    WHERE PatientVisitId = @visit
                      AND BillingStatus != 'returned'
                      AND BillingStatus != 'cancel'
                → take last 3 vitals, drop resolved problems
    → doctorsBlService.GetPatientOtherRequests(patientId, visitId)
        → /api/Doctors/OtherRequestsOfPatient
            → DoctorsController.OtherRequestsOfPatient   [DoctorsController.cs:57-77]
                → SELECT txnItms FROM BIL_TXN_BillingTransactionItems
                    JOIN BIL_MST_ServiceDepartment
                    WHERE BillStatus = 'provisional'
                      AND PatientId = @patientId
                      AND PatientVisitId = @visitId
                      AND IntegrationName NOT IN ('lab','radiology')
```

The same `GetActiveOrders` logic is duplicated in `OrdersController.cs:238-316` (older path) — both endpoints return compatible payloads.

### 5.2 Load Orderable Items (Autocomplete Source)

```
OrderMainComponent.LoadAllOrderItems()                  [orders-main.component.ts:163]
  → /api/Orders/OrderItems?priceCategoryId={visitCtx.PriceCategoryId}
    → OrdersController.OrderItems(priceCategoryId)      [OrdersController.cs:56]
      → GetOrderItems(priceCategoryId)
          = concat(
              GetPharmacyItems(...),                    // PHRM items, AvailableQuantity > 0
              GetLabItems(priceCategoryId),              // IntegrationName='lab'
              GetImagingItems(priceCategoryId),          // IntegrationName='radiology'
              GetOtherItems(priceCategoryId)             // not lab and not radiology
            )
      → each helper LEFT JOINs BIL_MAP_PriceCategoryServiceItem for price
      → OrderBy(ItemName)
```

Items are flagged `IsSelected=false` on the client so the autocomplete supports multi-select into a "Selected Orders" list on the left pane of the screen.

### 5.3 Add/Remove Favourites (Employee Preferences)

```
Star an item:
  OrderMainComponent.AddToPreference_New(item)           [orders-main.component.ts:361]
    → POST /api/Orders/EmployeePreference?itemId=X&preferenceType=Y
      → OrdersController.PostEmployeePreference(preferenceType, itemId)   [OrdersController.cs:94]
        → AddEmployeePreference(preferenceType, itemId)
            → map preferenceType → (PreferenceName, IdElementName)
                'lab'       → ('Labtestpreferences',       'LabTestId')
                'imaging'   → ('Imagingpreferences',       'ImagingItemId')
                'medication'→ ('Medicationpreferences',    'MedicineId')
                'patient'   → ('Patientpreferences',       'PatientId')
                'followup'  → ('Followuppreferences',      'PatientId')
            → if no row exists for (EmployeeId, PreferenceName):
                → INSERT EMP_EmployeePreferences with XML
                    {"Row":{"<IdElem>":"<X>"}}  →  <root><Row><X/></Row></root>
            → else:
                → parse existing XML, append new <Row><X/></Row>, save

Unstar:
  OrderMainComponent.RemoveFromPreference_New(item)      [orders-main.component.ts:344]
    → PUT /api/Orders/EmployeePreference?itemId=X&preferenceType=Y
      → OrdersController.PutEmployeePreference(preferenceType, itemId)   [OrdersController.cs:104]
        → DeleteItemFromEmployeePreference(...)
            → parse XML, walk all nodes matching //<IdElementName>,
              if InnerXml == X → ParentNode.RemoveChild(node)
            → save updated XML
```

### 5.4 Post Lab / Imaging / Other Order (Provisional Billing Path)

```
OrderMainComponent.ProceedAll()                          [orders-main.component.ts:420]
  → /Doctors/PatientOverviewMain/Orders/OrderRequisition  (navigate)
  → OrderRequisitionsComponent.initialLoad (constructor)   [order-requisition.component.ts:70-93]
    → LoadCounters() → pick first BILLING counter
    → GetCurrentPatientVisitContext() → /api/Labs/GetDataOfInPatient
    → LoadOrder() → split ordServ.allNewOrderItems by PreferenceType
        → GetLabItemsMapped()       → Array<LabTestRequisition>
        → GetImagingItemsMapped()   → Array<ImagingItemRequisition>
        → GetMedicationItemsMapped()→ Array<PHRMPrescriptionItem>
        → GetOtherItemsMapped()     → Array<BillItemRequisition>
        → for each mapped item: also push a BillingTransactionItem into this.billingTransaction

OrderRequisitionsComponent.AddToRequisition()           [order-requisition.component.ts:143-227]
  → if any lab/imaging/other item present:
      → SetBillingTxnAndTxnItemsDetails()
          → fill SchemeId, PatientId, PatientVisitId, CounterId
          → for each txnItem: set VisitType (inpatient/outpatient),
            BillStatus='provisional', OrderStatus='active',
            CounterId, CounterDay, DiscountSchemeId, CoPaymentCash/Credit=0
      → PostProvisionalDepartmentRequisition()
          → cloneDeep billingTransaction + items
          → billingBLService.ProceedToBillingTransaction(...)
              → POST /api/Billing/ProceedToBillingTransaction?...&orderStatus=active&billStatus=provisional
              → BillingTransactionBL adds rows to BIL_TXN_BillingTransaction,
                BIL_TXN_BillingTransactionItems, and inside the same transaction
                calls AddProvisionalLabRequisitions (writes LAB_TestRequisition)
                and AddProvisionalImagingRequisitions (writes RAD_PatientImagingRequisition)
              → returns billingTransactionItemIds
          → on success: OrderResponse.Lab/Imaging/others marked OK
  → if any medication:
      → SetPrescriptionDetails()  → fill PatientId, PrescriberId, PerformerFullName
      → ordersBLService.PostPharmacyPrescription(prescription)
          → POST /api/PharmacyPrescription/NewPrescription
          → PharmacyPrescriptionController.AddNewPrescription
            → INSERT PHRM_Prescription header + PHRM_PrescriptionItems
          → on success: OrderResponse.medication marked OK
  → DisplayRequStatus() → walk 4×4 success/fail matrix, route back to OrderMain
```

### 5.5 Post Medication Order (Pharmacy Path)

See step `5.4` second bullet. The medication-only flow when no lab/imaging/other is involved is identical — `PostPharmacyPrescription` is called directly from `AddToRequisition` if `medicationsToPost.length != 0`. The prescription carries `OrderStatus='active'`; pharmacy dispensary queues on `OrderStatus='active' && BillStatus='paid'`.

### 5.6 Re-order from Favourites (AddToOrderFromPreference)

```
OrderMainComponent.PreferenceChkOnChange(item)          [orders-main.component.ts:307]
  → AddNewItemToOrders(item)                             [orders-main.component.ts:328]
    → push into selOrdItems[] (de-dup by Type+ItemId+IsGeneric)
  → on ProceedAll() → same path as 5.4
```

### 5.7 View Lab Report (Modal)

```
OrderMainComponent.ViewLabReport(requisitionId)          [orders-main.component.ts:429]
  → showLabReport = true; labRequisitionIdList = [requisitionId]
  → <danphe-lab-results [requisitionIdList] [showReport] ...>   [OrderMain.html:361]
      → Reuses the standard lab-results component, which hits
        /api/Lab/LabReports/... for the report rendering
  → on Close → showLabReport = false
```

### 5.8 Print Medication List

```
OrderMainComponent.printMedications()                    [orders-main.component.ts:426]
  → navigate to /Doctors/PatientOverviewMain/Orders/PrintMedication
  → PrintMedicationsComponent (print-order.ts)
    → reads CustomerHeader from CORE_CFG_Parameters
    → on print() → open popup window with the medication list HTML
```

---

## 6. API Endpoints

### 6.1 Order Module (`/api/Orders/...`)

| # | Method | Route | Auth | Returns | Notes |
|---|--------|-------|------|---------|-------|
| 1 | GET | `/api/Orders/ActiveOrders?patientId&patientVisitId` | session | `PatientModel` composite | Used as alternative to `Doctors/PatientOverview` |
| 2 | GET | `/api/Orders/OrderItems?priceCategoryId` | session | `OrderItemsVM[]` | Aggregated catalogue; price is from `BIL_MAP_PriceCategoryServiceItem` |
| 3 | GET | `/api/Orders/GenericMaps` | session | `PHRMGenericModel[]` | Legacy generic lookup |
| 4 | GET | `/api/Orders/BillingItems` | session | `BIL_MST_ServiceItem[]` | Excludes Lab+Radiology; hard-codes `PriceCategoryId = 1` |
| 5 | GET | `/api/Orders/EmployeePreferences` | session | `OrderItemsVM[]` | Lab + Imaging + Med favourites, marked `IsPreference=true` |
| 6 | POST | `/api/Orders/EmployeePreference?preferenceType&ItemId` | session | `EmployeePreferences` | Star an item; `preferenceType ∈ {lab, imaging, medication, patient, followup}` |
| 7 | PUT | `/api/Orders/EmployeePreference?preferenceType&itemId` | session | `string` (the removed itemId) | Unstar an item |

### 6.2 Doctors Module (`/api/Doctors/...`) — used by Order screen

| # | Method | Route | Auth | Returns | Notes |
|---|--------|-------|------|---------|-------|
| 8 | GET | `/api/Doctors/PatientOverview?patientId&patientVisitId` | session | `PatientModel` composite | Primary path for active-orders load |
| 9 | GET | `/api/Doctors/OtherRequestsOfPatient?patientId&patientVisitId` | session | `BillingTransactionItemModel[]` | Provisional "other" items only (not Lab, not Radiology) |
| 10 | GET | `/api/Doctors/TodaysVisits?toDate&status` | session | visit list | |
| 11 | GET | `/api/Doctors/PastVisits?fromDate&toDate` | session | visit list | |
| 12 | GET | `/api/Doctors/DepartmentVisits?fromDate&toDate` | session | visit list | |
| 13 | GET | `/api/Doctors/EmployeeDepartment?employeeId` | session | department | |
| 14 | GET | `/api/Doctors/PatientVisitTypes` | session | visit-type list | |
| 15 | POST | `/api/Doctors/ConcludeVisit` | session | ok | |
| 16 | PUT | `/api/Doctors/ReassignProvider` | session | ok | |
| 17 | PUT | `/api/Doctors/ChangeProvider` | session | ok | |

### 6.3 Pharmacy Module (`/api/PharmacyPrescription/...`) — used by Order screen

| # | Method | Route | Auth | Returns | Notes |
|---|--------|-------|------|---------|-------|
| 18 | POST | `/api/PharmacyPrescription/NewPrescription` | session | prescription result | Body is `PHRMPrescriptionModel` with `PHRMPrescriptionItems[]` |
| 19 | POST | `/api/PharmacyPrescription/NewPrescriptionItem` | session | prescription-item result | Single-item variant |
| 20 | GET | `/api/PharmacyPrescription/PatientsPrescriptions` | session | active prescription list | |

### 6.4 Lab Module (`/api/Lab/...`) — used by OrderService prefetch

| # | Method | Route | Auth | Returns | Notes |
|---|--------|-------|------|---------|-------|
| 21 | GET | `/api/Lab/LabTests` | session | `LabTest[]` | Loaded by `OrderService.LoadAllLabTests` for client-side mapping |
| 22 | GET | `/api/Lab/LabRequisitions?FromDate&ToDate` | session | requisition list | Used for the "Active Orders" display |
| 23 | GET | `/api/Lab/LabRequisitionsByVisitId?patientVisitId&patientId` | session | requisition list | |

### 6.5 Radiology Module (`/api/Radiology/...`) — used by OrderService prefetch

| # | Method | Route | Auth | Returns | Notes |
|---|--------|-------|------|---------|-------|
| 24 | GET | `/api/Radiology/ImagingItems` | session | `ImagingItem[]` | Loaded by `OrderService.LoadAllImagingItems` for client-side mapping |
| 25 | GET | `/api/Radiology/ImagingRequisitions` | session | requisition list | |

### 6.6 Pharmacy Settings Module (`/api/PharmacySettings/...`) — used by OrderService prefetch

| # | Method | Route | Auth | Returns | Notes |
|---|--------|-------|------|---------|-------|
| 26 | GET | `/api/PharmacySettings/Items` | session | `PHRMItemMasterModel[]` | Loaded by `OrderService.LoadAllMedications` |
| 27 | GET | `/api/PharmacySettings/Generics` | session | `PHRMGenericModel[]` | Loaded by `OrderService.LoadAllGenericItems` |

### 6.7 Billing Module (`/api/Billing/...`) — provisional billing transaction

| # | Method | Route | Auth | Returns | Notes |
|---|--------|-------|------|---------|-------|
| 28 | POST | `/api/Billing/ProceedToBillingTransaction?orderStatus=active&billStatus=provisional` | session | txn ids | The single call that creates the BIL_TXN_BillingTransaction + items + lab/imaging requisitions atomically |
| 29 | POST | `/api/Billing/BillItemRequisition` | session | ok | "Other" items only (Lab+Radiology are handled inside `ProceedToBillingTransaction`) |

### 6.8 Misc

| # | Method | Route | Auth | Returns | Notes |
|---|--------|-------|------|---------|-------|
| 30 | GET | `/api/Labs/GetDataOfInPatient?patientId&patientVisitId` | session | `CurrentVisitContextVM` | Resolves the `PriceCategoryId` that drives `OrderItems` filtering |

### 6.9 MVC View Routes (legacy `.cshtml` shim)

| # | Method | Route | View | Auth |
|---|--------|-------|------|------|
| 31 | GET | `/OrderView/OrderRequisitions` | `OrderRequisitions.cshtml` | RBAC |
| 32 | GET | `/OrderView/OrderMain` | `OrderMain.cshtml` | RBAC |
| 33 | GET | `/OrderView/PrintMedications` | `PrintMedications.cshtml` | RBAC |

(Angular routes that supersede these views: `Doctors/PatientOverviewMain/Orders`, `…/OrderRequisition`, `…/PrintMedication` — see `orders-routing.module.ts`.)

---

## 7. Cross-Module Integration

The Order module is the textbook example of a coordinator in the DanpheEMR architecture — it has no master table but touches nearly every other module.

### 7.1 Patient module

| Where | How |
|-------|-----|
| `OrdersController.GetActiveOrders` | Loads `PAT_Patient` with `Include(Visits.Vitals, Problems, Allergies, Addresses, LabRequisitions, ImagingItemRequisitions, MedicationPrescriptions)` |
| `order-requisition.component.ts:81-82` | Reads `patientService.globalPatient` and `visitService.globalVisit` |
| `OrderRequisitionsComponent.GetCurrentPatientVisitContext` | `/api/Labs/GetDataOfInPatient` returns `CurrentVisitContextVM` with `PatientId`, `PatientVisitId`, `PerformerId/Name`, `Current_WardBed`, `VisitType`, `SchemeId`, `PriceCategoryId` |

### 7.2 Lab module

| Where | How |
|-------|-----|
| Catalogue | `OrdersController.GetLabItems` reads `BIL_MST_ServiceItem JOIN BIL_MST_ServiceDepartment` where `IntegrationName='lab'` |
| Requisition write | Indirect — `OrderRequisitionsComponent.PostProvisionalDepartmentRequisition` calls `/api/Billing/ProceedToBillingTransaction` which internally calls `BillingTransactionBL.AddProvisionalLabRequisitions` (`Controllers/Billing/BillingTransactionBL.cs:1242`) to insert `LAB_TestRequisition` rows |
| Active-orders read | `OrdersController.GetActiveOrders` reads `PAT_Patient.LabRequisitions` filtered by `PatientVisitId` and `BillingStatus != 'returned'` |
| Client mapping | `OrderRequisitionsComponent.GetLabItemsMapped` builds `Array<LabTestRequisition>` and pushes a `BillingTransactionItem` per row |

### 7.3 Radiology module

| Where | How |
|-------|-----|
| Catalogue | `OrdersController.GetImagingItems` reads `BIL_MST_ServiceItem JOIN BIL_MST_ServiceDepartment` where `IntegrationName='radiology'` |
| Requisition write | Indirect — same provisional-billing path; `BillingTransactionBL.AddProvisionalImagingRequisitions` (analogous to lab) writes `RAD_PatientImagingRequisition` |
| Active-orders read | Same `GetActiveOrders` path |
| Client mapping | `OrderRequisitionsComponent.GetImagingItemsMapped` builds `Array<ImagingItemRequisition>` |
| View report | `OrderMainComponent.ViewLabReport(requisitionId)` opens the standard `danphe-lab-results` component in a modal — this is a Lab component reused, not Radiology-specific |

### 7.4 Pharmacy module

| Where | How |
|-------|-----|
| Catalogue | `OrdersController.GetPharmacyItems` reads `PHRM_MST_Item JOIN PHRM_MST_Generic LEFT JOIN PHRM_TXN_StoreStock GROUP BY ItemId SUM(AvailableQuantity) > 0` |
| Prescription write | `OrdersDLService.PostPharmacyPrescription` (orders.dl.service.ts:22) calls `POST /api/PharmacyPrescription/NewPrescription` with `PHRMPrescription` + `PHRMPrescriptionItems[]` |
| Active-orders read | `OrdersController.GetActiveOrders` reads `PHRM_PrescriptionItems` joined to `PHRM_MST_Item` and maps to a `MedicationPrescriptionModel` for display |
| Client mapping | `OrderRequisitionsComponent.GetMedicationItemsMapped` builds `Array<PHRMPrescriptionItem>`, sets `Route` to default `"mouth"` if not provided, sets `OrderStatus='active'`, sets `PrescriberId` from `currVisit.PerformerId` |

### 7.5 Billing module

| Where | How |
|-------|-----|
| Catalogue | `OrdersController.GetBillingItems` reads `BIL_MST_ServiceItem` for departments other than Lab and Radiology; `GetLabItems`/`GetImagingItems` likewise filter by `IntegrationName` |
| Price lookup | `BIL_MAP_PriceCategoryServiceItem` joined on `ServiceItemId` and `PriceCategoryId` from the current visit |
| Order write | `OrderRequisitionsComponent.PostProvisionalDepartmentRequisition` calls `BillingBLService.ProceedToBillingTransaction(billingTransaction, billingTransactionItems, "active", "provisional", false, currPatVisitContext)` which calls `POST /api/Billing/ProceedToBillingTransaction?orderStatus=active&billStatus=provisional` |
| "Other" items | `OrderRequisitionsComponent.GetOtherItemsMapped` builds `Array<BillItemRequisition>`; the original plan was to post these via `OrdersBLService.PostItemsToBilling` → `BillingDLService.PostBillingItemRequisition` (`POST /api/Billing/BillItemRequisition`) but the current code path is **commented out** in favour of routing them through `ProceedToBillingTransaction` |

### 7.6 Employee (HR) module

| Where | How |
|-------|-----|
| Current user | `HttpContext.Session.Get<RbacUser>("currentuser")` gives `EmployeeId` used as `PrescriberId` on every requisition and as the owner of `EMP_EmployeePreferences` rows |
| Favourites | `EMP_EmployeePreferences` keyed by `EmployeeId`; five `PreferenceName` buckets (`Labtestpreferences`, `Imagingpreferences`, `Medicationpreferences`, `Patientpreferences`, `Followuppreferences`) |

### 7.7 Settings / Master module

| Where | How |
|-------|-----|
| `BIL_CFG_PriceCategory` | Inherited via EF context; resolved through `CurrentVisitContextVM.PriceCategoryId` |
| `BIL_CFG_Counter` | `OrderRequisitionsComponent.LoadCounters` filters to `CounterType == 'BILLING'` and picks the first as `SelectedCounterId` |
| `CORE_CFG_Parameters` ("Common" / "CustomerHeader") | `PrintMedicationsComponent.Loadheader` reads hospital name/address for the print template |

### 7.8 Other modules (downstream consumers of orders)

| Consumer | Reads |
|---------|-------|
| `LabController` | `LAB_TestRequisition` to drive sample collection, result entry, report generation |
| `RadiologyController` | `RAD_PatientImagingRequisition` to drive scan, film, report |
| `PharmacyDispensaryController` | `PHRM_PrescriptionItems` to dispense |
| `BillingController` | `BIL_TXN_BillingTransactionItems` to settle, cancel, return |
| `DischargeBillingController` | `LAB_TestRequisition` and `RAD_PatientImagingRequisition` keyed by `BillingTransactionItemId` to confirm completion before discharge |
| `MedicalRecordsController` | Aggregates `LAB_TestRequisition` for the patient chart |
| `EmergencyController` | `LAB_TestRequisition` for the ER dashboard |
| `GovInsuranceController` / `GovInsuranceBL` | `LAB_TestRequisition` for insurance claim settlement |
| `AdmissionController` | `LAB_TestRequisition` for the admission summary |
| `BillReturnController` | `LAB_TestRequisition` linked by `BillingTransactionItemId` to mark returned |
| `VisitBL` | `LAB_TestRequisition` linked by `RequisitionId` |

---

## 8. Business Rules

### 8.1 Order Status Lifecycle

`OrderStatus` is a free-text field on `LAB_TestRequisition`, `RAD_PatientImagingRequisition`, `BIL_BillItemRequisition` and `PHRM_PrescriptionItems`. The `ENUM_OrderStatus` values are:

```
active → pending → result-added → report-generated → (verified) → final
                                              ↘ cancel
```

| State | Set by | Required to advance |
|-------|--------|---------------------|
| `active` | Order screen (always) | Sample collected by lab/imaging tech |
| `pending` | Lab sample collection | Result entered |
| `result-added` | Lab/Radiology result entry | Report generated |
| `report-generated` | Report finalization | Doctor view |
| `final` | Doctor view (read-only display) | — |
| `verified` | Optional second-level verification (controlled by `CORE_CFG_Parameters.LabReportVerificationNeededB4Print`) | Print or release |
| `cancel` | `BillingController.BillCancel` | — |

`PHRM_PrescriptionItems` uses only `active` and `final` from the order screen's perspective — pharmacy dispensary queues on `OrderStatus='active' && BillStatus='paid'`.

### 8.2 Billing Status Lifecycle

`BillStatus` on `BIL_TXN_BillingTransactionItems` follows:

```
provisional → unpaid → paid
                    ↘ cancel
                    ↘ returned
```

| State | Meaning |
|-------|---------|
| `provisional` | Just created by the Order screen, not yet at the billing counter |
| `unpaid` | Invoice printed, payment pending |
| `paid` | Settled — pharmacy dispensary picks this up |
| `cancel` | Bill cancelled before payment |
| `returned` | Patient returned after payment — see `BillReturnController` |

The Order screen always writes `BillStatus='provisional'`, `OrderStatus='active'`. The active-orders query in `OrdersController.GetActiveOrders` excludes `BillingStatus='returned'`. The equivalent query in `DoctorsController.GetatientOverview` also excludes `BillingStatus='cancel'`.

### 8.3 Linking Orders to Requisitions

`LAB_TestRequisition.BillingTransactionItemId` and `RAD_PatientImagingRequisition.BillingTransactionItemId` are the join keys to the billing system. The mapping is performed inside the same SQL transaction by `BillingTransactionBL.AddProvisionalLabRequisitions` after the `BIL_TXN_BillingTransactionItems` row is inserted and its `BillingTransactionItemId` is known. The Order screen does **not** need to know these IDs — it just posts a flat `BillingTransactionItems` array and trusts the downstream service to assign the IDs.

### 8.4 Favourite / Preference Semantics

- One row per `(EmployeeId, PreferenceName)` pair. The `PreferenceValue` column stores an XML fragment of all starred item IDs.
- Five buckets, all using the same `EMP_EmployeePreferences` table — there is **no** `PatientPreferences` or `FollowupPreferences` writer in the Order screen. The endpoint contract allows them but only `Lab`, `Imaging` and `Medication` are wired to UI controls (`AddToPreference_New` in `orders-main.component.ts:361`).
- Star / unstar are idempotent: re-starring an already-present item is a no-op (the existing XML already contains the node; appending would duplicate, but the existing code always appends without dedup — a known bug in `AddEmployeePreference`).
- Removing a preference row not found results in an unhandled NRE in `DeleteItemFromEmployeePreference` (line 152) because `prefXmlDocument.LoadXml(employeePreference.PreferenceValue)` is called unconditionally.

### 8.5 Price Category Resolution

The `PriceCategoryId` comes from the patient's current visit (insurance scheme, EHS, foreigner, etc.) and is read via `CurrentVisitContextVM.PriceCategoryId` from `/api/Labs/GetDataOfInPatient`. The `BIL_MST_ServiceItem.Price` and `BIL_MST_ServiceItem.GovtInsurancePrice/EHSPrice/SAARCCitizenPrice/ForeignerPrice/InsForeignerPrice` are looked up via `BIL_MAP_PriceCategoryServiceItem`. The `/api/Orders/BillingItems` endpoint hard-codes `PriceCategoryId = 1` (Normal) — this is acknowledged in a comment as a "Hard Coded for Now" technical debt.

### 8.6 Performer vs Prescriber vs Provider

- `PrescriberId` (renamed from `ProviderId` in June 2022) = the **logged-in employee** placing the order. Always set to `securityService.GetLoggedInUser().EmployeeId`.
- `PerformerId` / `PerformerName` (renamed from `ProviderId/ProviderName` in June 2022) = the **visit's primary doctor**. Read from `VisitService.globalVisit.PerformerId/PerformerName` and copied into `PHRMPrescriptionItem` and `BillingTransactionItem.PrescriberId/PrescriberName` (note: the billing item's "prescriber" field is actually the performer — naming drift between modules).
- For lab requisitions, `PrescriberId = currVisit.PerformerId` (the visit's primary doctor), not the logged-in user — see `order-requisition.component.ts:593`.

### 8.7 Routes

- Doctor's Patient Overview → `/Doctors/PatientOverviewMain/Orders` (default tab "labs")
- Order Requisition review → `/Doctors/PatientOverviewMain/Orders/OrderRequisition`
- Print medication → `/Doctors/PatientOverviewMain/Orders/PrintMedication`
- All routes guarded by `AuthGuardService`; main route also guarded by `ResetOrdersGuard` (currently a no-op stub returning `true`)

### 8.8 HAMS Customisations

- Medication `Route` enum is hard-coded to `["mouth", "intravenous", "intramuscular", "inhalation", "vaginally", "eyes", "intravitreal injection"]` (HAMS-specific) — overrides the older Sudarshan list `["Oral.", "IV.", "IM.", "SQ.", "ID.", "TOPICAL.", "Inhalation", "Per Rectal"]` which is commented out in `order-requisition.component.ts:90-91`.
- `LOINC` code is hard-coded to `"LONIC Code"` (`order-requisition.component.ts:586`) — a known TODO; should be looked up from the lab master.
- The print header is read from `CORE_CFG_Parameters` group `"Common"` parameter `"CustomerHeader"`.

### 8.9 Validation

- Required: `ItemId` on every selected item (enforced by the autocomplete requiring a selection before `OrderItemValueChanged`).
- Prescription items: `ItemId`, `Quantity`, `Notes`, `StartingDate` are required by `PHRMPrescriptionItemsValidator` (FormBuilder) — see `phrm-prescription-item.model.ts:67`.
- Counter must be loaded before posting: `OrderRequisitionsComponent.LoadCounters` picks the first `CounterType == 'BILLING'` counter; if none, `SelectedCounterId` is null and the billing call will fail server-side.
- Duplicate check on the client: `OrderRequisitionsComponent.AddNewItemToOrders` rejects `Type+ItemId+IsGeneric` duplicates before adding to `selOrdItems`. `order-select.component.ts.IsDuplicate` similarly rejects lab/imaging duplicates within a single `PatientOrderListModel` batch.

### 8.10 Audit Fields

Every requisition row carries:

```
CreatedBy  = currentUser.EmployeeId          (logged-in staff)
CreatedOn  = DateTime.Now                    (or moment().format(...) on client)
ModifiedBy / ModifiedOn                     (set on update, not on initial create)
IsActive   = true                            (soft-delete flag; set to false to hide)
```

`EMP_EmployeePreferences` follows the same convention. `BIL_TXN_BillingTransactionItems.CounterDay` is the business date used to group items into the day's bill run.

### 8.11 Known Limitations / Technical Debt

1. **No ORD_* master table** — the order is implicit in the billing items + destination-requisition rows. Making the audit trail explicit (e.g. "who placed this order, when, with what diagnosis, for which visit") requires reading the union of three or four tables.
2. **Hard-coded `PriceCategoryId = 1`** in `OrdersController.GetBillingItems` line 190.
3. **Duplicates in `EmployeePreferences` XML** — `AddEmployeePreference` does not check for existing IDs before appending. Repeated starring accumulates duplicate `<Row>` elements. The dedup must be done client-side via `empAllPreferences.find(...)` in `OrderItemValueChanged` (line 279).
4. **NRE on missing preference** in `DeleteItemFromEmployeePreference` line 152.
5. **LOINC hard-coded** in `order-requisition.component.ts:586`.
6. **`medicationsToPost` posting path is non-atomic** — if the medication post fails after the billing post succeeded, the user sees a partial success message. There is no compensating transaction.
7. **`CounterId` selection** is a single counter with no per-department routing — the same counter is used for all departments. This is acceptable for the Order screen because the order is provisional; the actual settlement counter is chosen at the billing counter.
8. **Commented-out `OrdersBLService.PostItemsToBilling` path** — the original design routed "other" items through a dedicated `PostBillingItemRequisition` API; this was removed in favour of routing everything through `ProceedToBillingTransaction`. The old code is still present as comments at `orders.bl.service.ts:43-161`.
