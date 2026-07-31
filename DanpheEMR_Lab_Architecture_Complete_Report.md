# DanpheEMR Laboratory/LIS Architecture - Comprehensive Analysis Report

**Date:** April 2026
**Project:** DanpheEMR Reference Implementation
**Focus:** Laboratory Management & LIS Integration

---

## Executive Summary

DanpheEMR is an enterprise web-based hospital management system with comprehensive laboratory management capabilities. The lab module is architected with:
- **Backend:** C#/.NET Entity Framework with SQL Server
- **Frontend:** Angular with TypeScript
- **LIS Integration:** Machine connectivity via separate LIS Computer Server API
- **Workflow:** Complete test lifecycle management (order → sample → result → report)
- **Vendor Support:** External lab management with outsourcing capabilities

---

## 1. DATABASE SCHEMA & TABLES

### Key Database Context Files
- **LabDbContext.cs** - Primary lab database context
- **LISDbContext.cs** - LIS machine integration database context
- **Database Location:** `/Code/Components/DanpheEMR.DalLayer/`

### Core Lab Tables (from LabDbContext)

#### Master Data Tables
| Table | Model | Purpose |
|-------|-------|---------|
| `LAB_LabTests` | `LabTestModel` | Test master with LOINC codes, procedures, specimens |
| `Lab_MST_Components` | `LabTestJSONComponentModel` | Individual test components/parameters |
| `Lab_MAP_TestComponents` | `LabTestComponentMapModel` | Maps tests to components with grouping |
| `Lab_ReportTemplate` | `LabReportTemplateModel` | Report template configuration |
| `LAB_TestCategory` | `LabTestCategoryModel` | Test categorization (e.g., Hematology, Chemistry) |
| `LAB_MST_TestSpecimen` | `LabTestMasterSpecimen` | Specimen types (Blood, Urine, Serum, etc.) |
| `Lab_MST_LabVendors` | `LabVendorsModel` | External lab vendors for outsourcing |
| `MST_LabTypes` | `LabTypesModel` | Lab type classification |

#### Transaction Tables
| Table | Model | Purpose |
|-------|-------|---------|
| `LAB_TestRequisition` | `LabRequisitionModel` | Lab order/requisition (1.5K+ fields) |
| `LAB_TXN_TestComponentResult` | `LabTestComponentResult` | Individual component results |
| `LAB_TXN_LabReports` | `LabReportModel` | Finalized lab reports |
| `LAB_BarCode` | `LabBarCodeModel` | Barcode tracking for samples |
| `LAB_Sms` | `LabSMSModel` | SMS notification tracking |

#### Run Number & Reference Tables
| Table | Model | Purpose |
|-------|-------|---------|
| `Lab_MST_RunNumberSettings` | `LabRunNumberSettingsModel` | Run number configuration |
| `LAB_LIS_ComponentMap` | `LISComponentMapModel` | Machine component mapping |
| `Lab_Mst_Gov_Report_Items` | `LabGovReportItemModel` | Government reporting items |
| `LAB_Gov_Report_Mapping` | `LabGovReportMappingModel` | Maps tests to gov items |

### LIS Integration Tables (from LISDbContext)
| Table | Model | Purpose |
|-------|-------|---------|
| `LAB_LIS_ComponentMap` | `LISComponentMapModel` | Maps LIS machine components to EMR components |
| `LAB_LIS_SyncedComponent_Detail` | `LISSyncedComponentDetail` | Tracks synced machine results |

---

## 2. SERVER-SIDE MODELS & ENTITIES

### Location: `/Code/Components/DanpheEMR.ServerModel/LabModels/`

#### Core Models (31 files, 1408 LOC)

**Primary Models:**
- **LabTestModel.cs** (86 LOC)
  - Fields: LabTestCode, ProcedureCode, LOINC, LabTestSpecimen, ReportTemplateId
  - Features: RunNumberType, HasNegativeResults, OutsourceVendor, IsLISApplicable
  - Relations: Maps to ReportTemplate, components

- **LabRequisitionModel.cs** (114 LOC)
  - Fields: PatientId, LabTestId, PrescriberId, OrderDateTime, SampleCreatedOn
  - Status: BillingStatus, OrderStatus, VerificationStatus
  - External: GoogleFileIdForCovid, IMUUploadedOn (Integration points)

- **LabTestComponentResult.cs** (46 LOC)
  - Fields: Value, Unit, Range, ComponentName, RangeDescription
  - Anomalies: IsAbnormal, AbnormalType, IsNegativeResult
  - Display: ResultGroup (for grouping in reports)

**Component Hierarchy Models:**
- **LabTestComponentMapModel.cs** (37 LOC)
  - GroupName: Hierarchical grouping support
  - IndentationCount: Tree structure rendering
  - CalculationFormula: Auto-calculation with dependencies
  - ShowInSheet: Display control

- **LabTestJSONComponentModel.cs** (42 LOC) 
  - Range Types: ValueType, Range, MaleRange, FemaleRange, ChildRange
  - ValueLookup: Dropdown/coded values
  - MinValue/MaxValue: Numeric ranges
  - Method: Test methodology

**Report & Output Models:**
- **LabReportTemplateModel.cs** (40 LOC) - Report formatting/layout
- **LabReportModel.cs** (44 LOC) - Report printing & verification
- **FinalLabReportListVM.cs** (50 LOC) - Report list views

**Settings & Configuration Models:**
- **LabRunNumberSettingsModel.cs** (32 LOC) - Run numbering schemes
- **LabTestCategoryModel.cs** - Test categorization
- **LabTypesModel.cs** - Lab type definitions

**Supporting Models:**
- **LabVendorsModel.cs** (28 LOC) - External lab vendors
- **LabBarCodeModel.cs** (33 LOC) - Sample barcoding
- **LabMasterModel.cs** (54 LOC) - Master data aggregation
- **LabSignatoriesViewModel.cs** - Report signatories
- **LabEmailModel.cs**, **LabSMSModel.cs** - Notifications

### LIS Machine Integration Models
Location: `/Code/Components/DanpheEMR.ServerModel/LISModels/`

**LISComponentMasterVM.cs** (Composite Model)
```csharp
- LISComponentMasterId, ComponentName, ComponentDisplayName
- MachineId, MachineName, MachineCode, ModelName (from parent LISMachineMaster)
```

**LISMachineMaster.cs**
```csharp
- MachineId: Unique machine identifier
- MachineName: Display name
- MachineCode: Machine code
- ModelName: Device model
```

**MachineResultsVM.cs**
```csharp
- BarCodeNumber: Sample identification
- LabTestId, RequisitionId: EMR mapping
- Value, Unit, MachineUnit: Result data + conversion
- ConversionFactor: Unit conversion
- IsAbnormal, AbnormalType: Anomaly detection
- Component: Full component details for result
```

**MachineResultsFormatted.cs** - Batch result formatting for display

---

## 3. HIERARCHICAL TEST CATALOG STRUCTURE

### Component Hierarchy Implementation

**3-Level Hierarchy:**
1. **Test Level** (`LAB_LabTests`): Entire test definition
2. **Component Group Level** (`Lab_MAP_TestComponents`): Grouped components
3. **Individual Component Level** (`Lab_MST_Components`): Individual parameters

**Support Fields:**
- `GroupName` (in LabTestComponentMapModel) - Section headers
- `IndentationCount` - Tree depth/indentation
- `DisplaySequence` - Order control
- `ShowInSheet` - Visibility control

### Example Hierarchical Structure:
```
Complete Blood Count (Test)
├─ WBC Group (Component Group)
│  ├─ WBC Count (Component)
│  └─ WBC Differential (Sub-group)
│     ├─ Neutrophils (Component)
│     ├─ Lymphocytes (Component)
│     └─ Monocytes (Component)
├─ RBC Group (Component Group)
│  ├─ RBC Count (Component)
│  ├─ Hemoglobin (Component)
│  └─ Hematocrit (Component)
└─ Platelet Group (Component Group)
   └─ Platelet Count (Component)
```

**Auto-Calculation Support:**
- `IsAutoCalculate`: Enable formula-based results
- `CalculationFormula`: Mathematical expression
- `FormulaDescription`: Documentation

---

## 4. LAB ORDER WORKFLOW

### Workflow Phases

**Phase 1: Order Creation**
```
POST /api/Lab/Requisition
├─ Create LabRequisition (LAB_TestRequisition)
├─ Status: "Pending" / "Ordered"
├─ Assign LabTestId, PatientId, PrescriberId
├─ Set RunNumberType (e.g., "OPD", "IPD", "Emergency")
├─ Link ReportTemplateId
└─ Initial BillingStatus: "Pending"
```

**Phase 2: Sample Collection**
```
GET /api/Lab/Requisition/SamplePending
├─ List pending requisitions for collection
├─ Validate SampleCode (date-based run number)
└─ Update SampleCreatedOn, SampleCreatedBy

POST /api/Lab/Result/AddResults
├─ Create LabTestComponentResults
├─ Fill: Value, Unit, Range, ComponentName
└─ Status: "Pending Result Entry" → "Result Entered"
```

**Phase 3: Result Entry**
```
GET /api/Lab/Result/Pending
├─ Retrieve pending results by:
│  ├─ Sample code
│  ├─ Run number
│  └─ Barcode number
├─ Component-level data entry
├─ Range validation & abnormality flagging
└─ Verification workflow

POST /api/Lab/Result/Verify
├─ Set IsVerified = true
├─ VerifiedBy, VerifiedOn
└─ Status: "Verified" → "Ready for Report"
```

**Phase 4: Report Generation & Finalization**
```
GET /api/Lab/Report/Pending
├─ Get templates for finalization
├─ Fetch template components & layout

POST /api/Lab/Report/Finalize
├─ Create LabReport (LAB_TXN_LabReports)
├─ Link RequisitionId → LabReportId
├─ Status: "Finalized"
├─ Set Signatories
└─ Mark IsPrinted = false (until printed)

GET /api/Lab/LabDataByBarCodeNumber
├─ Retrieve full patient + results by barcode
└─ Format for report printing
```

**Phase 5: Report Dispatch/Distribution**
```
POST /api/Lab/Report/Dispatch
├─ Update PrintedOn, PrintedBy
├─ Increment PrintCount
├─ Log dispatch timestamp
└─ Optional: SMS/Email notification
```

### Status Workflow
```
OrderStatus: Pending → Collected → Processing → Completed → Cancelled
BillingStatus: Pending → Charged → Partially Paid → Paid → Refunded
VerificationStatus: Unverified → Verified → Approved → Finalized
```

### Specimen Management
```sql
LabTestSpecimen: Blood, Serum, Plasma, Urine, Stool, CSF, etc.
SpecimenSource: Vein, Capillary, Arterial, Clean-catch, etc.
Multiple specimens per test supported
```

---

## 5. LIS MACHINE INTEGRATION ARCHITECTURE

### Integration Overview

**Architecture Pattern:** Distributed with separate LIS Computer Server

```
┌─────────────────────┐
│   Danphe EMR        │
│   (Main Application)│
└──────────┬──────────┘
           │ (HTTP API calls)
           ↓
┌──────────────────────────────────────┐
│ LIS Service (LISController)          │
│ - GetAllLISMasterData()              │
│ - GetMachineResultByBarcodeNumber()  │
│ - AddLISDataToDanphe()               │
│ - UpdateMachineResultSyncStatus()    │
└──────────┬───────────────────────────┘
           │ (HTTP calls to external API)
           ↓
┌──────────────────────────────────────┐
│ LIS Computer Server                  │
│ (Separate Application)               │
│ - /api/MachineData/GetAllMasterData  │
│ - Machine + Component Master Data    │
└──────────────────────────────────────┘
           │ (Network/Serial/USB)
           ↓
┌──────────────────────────────────────┐
│ Lab Analyzer Machines                │
│ - Sysmex Hematology                  │
│ - Siemens Chemistry                  │
│ - etc.                               │
└──────────────────────────────────────┘
```

### Database Schema: LIS Integration

**LIS Component Mapping** (`LAB_LIS_ComponentMap`)
```sql
LISComponentMapId (PK)
├─ LISComponentId (from LIS machine master)
├─ ComponentId (from Lab_MST_Components)
├─ MachineId (identifier)
├─ ConversionFactor (unit conversion)
├─ IsActive (mapping active/inactive)
├─ CreatedBy, CreatedOn
├─ ModifiedBy, ModifiedOn
```

**Synced Component Details** (`LAB_LIS_SyncedComponent_Detail`)
```sql
LISComponentResultId (PK)
├─ LISComponentId
├─ BarCodeNumber
├─ Value
├─ Unit (from LIS machine)
├─ MachineId
└─ CreatedOn
```

### LIS API Integration Points

**Service:** `ILISService` / `LISService.cs`

**Key Methods:**

1. **GetAllMasterDataAsync()**
   - Calls: `LISComputerServerURL + "api/MachineData/GetAllMasterData"`
   - Returns: Machine & component master data
   - Frequency: On-demand during setup

2. **GetAllMappedData()**
   - Queries: LISComponentMap + LabTestComponents
   - Returns: Mapped components with EMR links
   - Used: UI for mapping display

3. **GetAllNotMappedDataByMachineId()**
   - Filters: Components not yet mapped to machine
   - Purpose: UI dropdown for new mappings

4. **AddUpdateMapping()**
   - Creates/Updates LISComponentMapModel records
   - Supports: ConversionFactor (e.g., mg/dL to mmol/L)
   - Transaction: Direct database save

5. **AddLISDataToDanphe()**
   - Converts MachineResultsVM → LabTestComponentResult
   - Atomic: All-or-nothing (prevents partial results)
   - Validation: Duplicate check before insert
   - Returns: Boolean success/failure

6. **GetMachineResultByBarcodeNumber()**
   - Queries: All results for sample by barcode
   - Format: MachineResultsFormatted with grouped results
   - Usage: Worklist, result entry display

7. **AddMachineOrder()**
   - Creates machine order from requisition IDs
   - Prepares tests for machine processing
   - Returns: Order details for machine

8. **UpdateMachineResultSyncStatus()**
   - Marks results as "synced"
   - Prevents re-import of same results
   - Audit trail of sync operations

### Unit Conversion

**ConversionFactor Field:**
```
MachineUnit: mg/dL
StandardUnit: mmol/L
ConversionFactor: 0.0555 (to convert mg/dL to mmol/L)
StandardValue = MachineValue × ConversionFactor
```

---

## 6. API CONTROLLERS & ENDPOINTS

### Primary Controllers

**Location:** `/Code/Websites/DanpheEMR/Controllers/Lab/`

#### 1. LabController.cs (278KB - Primary Endpoints)

**Requisition Management:**
```
GET  /api/Lab/Requisition/SamplePending - Pending samples for collection
GET  /api/Lab/WorkList - Lab work list view
GET  /api/Lab/Requisition/PatientSamplePending - Patient-specific pending
GET  /api/Lab/LatestSampleCode - Generate/fetch run number
GET  /api/Lab/IsSampleCodeValid - Validate sample code format
```

**Result Management:**
```
GET  /api/Lab/Result/Pending - Pending results for entry
POST /api/Lab/Result/Add - Add component results
POST /api/Lab/Result/Update - Update existing results
POST /api/Lab/Result/Verify - Mark results as verified
```

**Report Management:**
```
GET  /api/Lab/Report/Pending - Pending reports for finalization
POST /api/Lab/Report/Finalize - Create final report
GET  /api/Lab/LabDataByBarcodeNumber - Retrieve by barcode
GET  /api/Lab/LabDataByRunNumber - Retrieve by formatted sample code
GET  /api/Lab/LabDataByPatientId - Retrieve by patient
GET  /api/Lab/ReportDispatch/LabReportByRequisitionIds - Batch report fetch
```

**External Lab Support:**
```
GET  /api/Lab/ExternalLabRequisitions - Outsourced tests
POST /api/Lab/ExternalLabSampleStatus - Track external samples
```

#### 2. LISController.cs (284 LOC - Machine Integration)

```
GET  /api/LIS/GetAllLISMasterData - Fetch machine + component master
GET  /api/LIS/GetAllMappedData - Mapped components
GET  /api/LIS/GetAllNotMappedDataByMachineId - Unmapped for UI
GET  /api/LIS/GetExistingMappingById - Retrieve mapping details
GET  /api/LIS/GetAllMachineResult - Results by machine & date range
GET  /api/LIS/GetAllMachines - List of connected machines
GET  /api/LIS/GetResultByBarcodeNumber - Results by sample barcode

POST /api/LIS/AddUpdateNewMapping - Create/update component mapping
POST /api/LIS/AddLisDataToResult - Import machine results
POST /api/LIS/MachineOrder - Create order for machine

PUT  /api/LIS/MachineResultSync - Mark results as synced
DELETE /api/LIS/RemoveMapping - Delete component mapping
```

#### 3. LabSettingController.cs (59KB)

**Master Data Configuration:**
```
POST/GET /api/LabSetting/Test - Lab test CRUD
POST/GET /api/LabSetting/Component - Component CRUD
POST/GET /api/LabSetting/ComponentMap - Component mapping
POST/GET /api/LabSetting/ReportTemplate - Report template
POST/GET /api/LabSetting/Category - Test category
POST/GET /api/LabSetting/Specimen - Specimen types
```

#### 4. LabReportExportController.cs (25KB)

```
POST /api/LabReportExport/Excel - Export reports to Excel
POST /api/LabReportExport/PDF - Generate PDF reports
POST /api/LabReportExport/PrintPreview - Print preview data
```

#### 5. IMUController.cs (3.5KB)

```
POST /api/IMU/Upload - Upload results to IMU (integration)
GET  /api/IMU/Status - Check IMU upload status
```

### Stored Procedures Used (30+)

Common patterns:
```
SP_LAB_GetPatientListForReportDispatch
SP_LAB_GetPatAndReportInfoForFinalReport
SP_LAB_GetAllLabRequisitionForExternalLab
SP_LAB_GetSamplesCollectedInfo
SP_LAB_GetAllLabProvisionalFinalReports
SP_LAB_GetLatestBarCodeNumber
SP_LAB_AllRequisitionsBy_VisitAndRunType
SP_LAB_GetPatientExistingRequisition_With_SameRunNumber
SP_LAB_Update_Test_SmsStatus
SP_LAB_AllRequisitionsBy_SampleCode
SP_LAB_GetLabWorkList
SP_LAB_GetAllLabDataFromBarCodeNumber
SP_LAB_GetAllLabDataFromRunNumber
SP_LAB_GetAllLabDataFromPatientName
...and more
```

---

## 7. FRONTEND ARCHITECTURE

### Location: `/Code/Websites/DanpheEMR/wwwroot/DanpheApp/src/app/labs/`

**126 TypeScript files organized in 12 feature modules:**

#### Core Module Structure:

```
labs/
├─ lab-tests/ (9 files)
│  ├─ lab-requisition/
│  ├─ lab-pending-results/
│  ├─ lab-pending-reports/
│  ├─ lab-collect-sample/
│  ├─ lab-add-result/
│  ├─ lab-final-reports/
│  └─ lab-master/
│
├─ lab-settings/ (25+ files)
│  ├─ lab-test/
│  ├─ lab-test-component/
│  ├─ lab-category/
│  ├─ lab-lookups/
│  ├─ lab-report-template/
│  ├─ map-lab-test-components/
│  └─ signatories/
│
├─ lab-lis/ (7 files)
│  ├─ lis-mapping/
│  ├─ lis-machine-result/
│  └─ shared/ (lis.bl.service, lis.dl.service)
│
├─ external-labs/ (8 files)
│  ├─ tests-list/
│  ├─ vendor-assignment/
│  └─ vendors-settings/
│
├─ notification/ (2 files)
│  ├─ sms/
│  └─ imu/
│
├─ shared/ (50+ shared models/services)
│  ├─ labs.bl.service.ts - Business logic
│  ├─ labs.dl.service.ts - Data layer
│  ├─ lab-test.model.ts
│  ├─ lab-component.model.ts
│  ├─ lab-requisition.model.ts
│  ├─ lab-report.ts
│  ├─ lab-component-json.model.ts
│  └─ DTOs/ (machine-result, auto-calculation)
│
└─ billing/ (Ward billing component)
```

### Key Frontend Services:

**labs.bl.service.ts** - Business Logic Layer
- Test retrieval & filtering
- Component validation
- Result calculation logic
- Anomaly detection

**labs.dl.service.ts** - Data Layer
- HTTP calls to LabController
- Data transformation
- Caching logic

**lis.bl.service.ts** - LIS Business Logic
- Machine mapping operations
- Result import workflows
- Conversion factor application

**lis.dl.service.ts** - LIS Data Layer
- HTTP calls to LISController
- Machine master data fetch
- Result synchronization

### Key UI Models:

```typescript
// Test Definition
LabTest {
  LabTestId, LabTestCode, LabTestName, LOINC
  ProcedureCode, ReportTemplateId, RunNumberType
  IsLISApplicable, IsOutsourceTest
  LabTestComponentsJSON[], LabTestComponentMap[]
}

// Test Component
LabComponent {
  ComponentId, ComponentName, Unit, ValueType
  Range, MaleRange, FemaleRange, ChildRange
  MinValue, MaxValue, ValueLookup
  DisplaySequence, GroupName, IndentationCount
}

// Result Entry
TestComponentResult {
  TestComponentResultId, RequisitionId, ComponentId
  Value, Unit, Range, Remarks
  IsAbnormal, AbnormalType, IsNegativeResult
  TemplateId, LabReportId
}

// Machine Result Import
MachineResult {
  LISComponentResultId, BarCodeNumber
  LabTestId, RequisitionId, Value
  MachineUnit, ConversionFactor
  IsAbnormal, Component (full details)
}
```

---

## 8. BILLING INTEGRATION

### Lab-Billing Integration Points

**LabRequisitionModel fields:**
```csharp
BillingStatus: "Pending", "Charged", "Refunded"
BillCancelledBy, BillCancelledOn: Cancellation tracking
BillingTransactionItemId: Link to billing transaction
HasInsurance: Insurance flag for pricing

Related: 
- ServiceDepartmentId: Lab department in billing
- ServiceItemId: Item code for billing
```

**Workflow:**
1. Test ordered → BillingStatus = "Pending"
2. Sample collected & result entered → Auto-charge
3. Report finalized → Mark as "Charged"
4. Optional: Refund on cancellation

**Stored Procedures:**
- `SP_LAB_GetBillingTransactionsByRequisition`
- `SP_LAB_UpdateBillingStatus`
- `SP_LAB_CancelLabBilling`

---

## 9. EXTERNAL LAB MANAGEMENT

### Outsourcing Features

**LabTestModel Fields:**
```csharp
IsOutsourceTest: Boolean flag
DefaultOutsourceVendorId: Default external lab

Related Models:
- LabVendorsModel: Vendor master (name, code, contact)
- ExternalLabDTO: External lab data transfer
```

**Requisition Fields:**
```csharp
ResultingVendorId: Which vendor performed test
ExternalLabSampleStatus: "Sent", "Received", "Processed", "Failed"
```

**Workflow:**
1. Flag test as "Outsource" when ordering
2. Assign to external lab vendor
3. Track sample status externally
4. Import results when received
5. Merge external + internal results in report

---

## 10. NOTIFICATION & INTEGRATION

### SMS Notifications

**LabSMSModel:**
```csharp
- LabTestId, RequisitionId
- IsSmsSend: Boolean flag
- CreatedOn, SentBy
```

**SMS Triggers:**
- Result ready for pickup
- Report finalized & available
- Abnormal result flags

**Configuration:**
- Stored Procedure: `SP_LAB_Update_Test_SmsStatus`
- SMS Service integration (via EmailService)

### IMU Integration (Indian Ministry of Health)

**Fields in LabRequisitionModel:**
```csharp
IsUploadedToIMU: Boolean
IMUUploadedOn: Timestamp
IMUUploadedBy: User
```

**IMUController Endpoints:**
```
POST /api/IMU/Upload - Upload results
GET  /api/IMU/Status - Check upload status
```

### Google Drive Integration (COVID Reports)

**Fields in LabRequisitionModel:**
```csharp
GoogleFileIdForCovid: Drive file reference
CovidFileName: Original filename
IsFileUploaded: Boolean
UploadedBy, UploadedOn: Audit
```

**Service:** `GoogleDriveFileUploadService`
- Configuration: Drive base path & URL common path
- Used for: COVID-19 test result archival

### Telemedicine Integration

**Fields in LabRequisitionModel:**
```csharp
IsFileUploadedToTeleMedicine: Boolean
UploadedByToTeleMedicine: User
UploadedOnToTeleMedicine: Timestamp
```

---

## 11. GOVERNMENT REPORTING

### Lab Government Reports

**Models:**
- `LabGovReportItemModel` - Government reportable items
- `LabGovReportMappingModel` - Maps tests to government items

**Mapping:**
```
LabTest (e.g., "HIV Test")
    ↓
LabGovReportMapping
    ↓
LabGovReportItem (e.g., "HIV_Cases_Confirmed")
```

**Stored Procedures:**
- `SP_LAB_GetGovReportData`
- `SP_LAB_GetGovReportMappings`

---

## 12. BARCODE & RUN NUMBER MANAGEMENT

### Barcode System

**LabBarCodeModel:**
```csharp
BarCodeId (PK)
├─ BarCodeNumber: Unique numeric identifier
├─ RequisitionId: Link to requisition
├─ CreatedOn: Generation timestamp
└─ CreatedBy: User who generated
```

**Generation Logic:**
- Date-based with sequence
- Format configurable per lab type
- Scanned during sample collection
- Used for result tracking & verification

### Run Number System

**LabRunNumberSettingsModel:**
```csharp
RunNumberSettingId (PK)
├─ RunNumberType: e.g., "OPD", "IPD", "Emergency"
├─ Format: Template string (e.g., "DDMMYY-XXXX")
├─ NextNumber: Current sequence
├─ ResetFrequency: Daily/Weekly/Monthly
├─ LabTypeId: Lab-specific setting
```

**LabRequisitionModel.RunNumberType:**
- Determines which run number sequence to use
- Multiple sequences for different visit types
- Automatic increment management

---

## 13. REPORT TEMPLATE SYSTEM

### Report Templates

**LabReportTemplateModel:**
```csharp
ReportTemplateId (PK)
├─ TemplateName: Display name
├─ TemplateShortName: Abbreviation (e.g., "CBC")
├─ TemplateType: e.g., "Standard", "Custom"
├─ IsActive: Boolean
├─ ReportLayout: HTML/template content
```

**Component Organization:**
- Templates contain multiple component groups
- Components within groups have display sequence
- Some components auto-calculated from others
- Formula support for derived values

**Verification Configuration:**
- `LabReportModel.VerificationEnabled` flag
- Required signatories per template
- Signature capture/approval workflow

---

## 14. DATA VALIDATION & QUALITY

### Range & Anomaly Detection

**LabTestJSONComponentModel - Range Fields:**
```csharp
Range: "70-100"                  // General range
MaleRange: "4.5-5.5"             // Gender-specific
FemaleRange: "4.0-5.0"
ChildRange: "4.5-5.5"            // Age-specific
MinValue, MaxValue: Numeric bounds

RangeDescription: "Normal", "High", "Low", etc.
```

**LabTestComponentResult - Anomaly Flags:**
```csharp
IsAbnormal: Boolean              // Out of range
AbnormalType: "High", "Low", "Critical"
IsNegativeResult: Boolean        // Negative test (e.g., HIV-)
NegativeResultText: Display text
ResultGroup: For grouping related results
```

**Validation Logic:**
- Component-level range checks
- Test-level consistency validation
- Auto-flagging of abnormal values
- Configurable alert thresholds

---

## 15. PERFORMANCE OPTIMIZATION

### Caching
- Master data: Lab types, categories, components
- Run number settings: Cached in memory
- Report templates: Pre-loaded

### Stored Procedures
- Batch operations for high-volume data
- Aggregated queries for reporting
- Indexed on: PatientId, BarCodeNumber, RunNumber

### Async Operations
- `async Task` patterns in LISService
- Background result import from machines
- Batch SMS/IMU uploads

---

## 16. SECURITY & AUDIT

### Access Control
- Role-based access per lab module
- Lab type selection per user session
- Result entry: Requires authorization
- Report verification: Restricted to signatories

### Audit Trail
```csharp
CreatedBy, CreatedOn: Entry creation
ModifiedBy, ModifiedOn: Last modification
VerifiedBy, VerifiedOn: Verification timestamp
PrintedBy, PrintCount: Printing audit
ISMUUploadedBy, IMUUploadedOn: External upload
```

### Data Validation
- Component value type validation (numeric/coded)
- Range validation before save
- Duplicate result prevention (LIS sync)
- Requisition status workflow enforcement

---

## 17. KEY PATTERNS & BEST PRACTICES OBSERVED

### 1. **Separation of Concerns**
- DbContext for data access
- Models for database entities
- ViewModels for API responses
- Service layer for business logic

### 2. **Component Composition**
- Test = Components (many-to-many)
- Component Group = Logical sections
- Hierarchical display with indentation

### 3. **Flexible Range Definitions**
- Gender-specific ranges
- Age-specific ranges
- Method-specific ranges

### 4. **Machine Integration Abstraction**
- Separate LIS service layer
- Conversion factor support
- Mapping flexibility for different machines

### 5. **Multi-Vendor Support**
- Internal & external labs
- Outsourcing workflow
- Vendor result import

### 6. **Government Compliance**
- Reportable item mapping
- SMS notifications for key diseases
- Integration with IMU

### 7. **Barcode & Run Number**
- Immutable sample identification
- Configurable numbering schemes
- Date-based sequencing

---

## 18. WORKFLOW DIAGRAMS

### Complete Lab Order-to-Report Workflow

```
┌─────────────────────────────────────────────────────────┐
│ 1. ORDER CREATION (Clinician)                          │
│    - Select Test(s) + Components                        │
│    - Set Urgency, Diagnosis                             │
│    - Auto-link to ReportTemplate                        │
│    → Create LabRequisition (Status: "Pending")          │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│ 2. BILLING (Billing Module)                             │
│    - Check Service Item & Price                         │
│    - BillingStatus: "Pending" → "Charged"               │
│    - Link: BillingTransactionItemId                     │
└─────────────────┬───────────────────────────────────────┘
                  │
┌─────────────────▼───────────────────────────────────────┐
│ 3. SAMPLE COLLECTION (Lab Technician)                   │
│    - Validate SampleCode (run number)                   │
│    - Generate BarCodeNumber                             │
│    - Update SampleCreatedOn, SampleCreatedBy            │
│    → Status: "Collected"                                │
│    → Print barcode label                                │
└─────────────────┬───────────────────────────────────────┘
                  │
         ┌────────┴────────┐
         │                 │
    ┌────▼─────┐      ┌────▼──────────┐
    │ INTERNAL  │      │ EXTERNAL LAB  │
    │ ANALYSIS  │      │ (Outsourced)  │
    └────┬─────┘      └────┬──────────┘
         │                 │
    ┌────▼─────────────────▼───────┐
    │ 4. RESULT ENTRY/IMPORT        │
    │ Lab Staff Manual Entry   OR   │
    │ LIS Machine Auto-Import       │
    │                               │
    │ If Machine:                   │
    │ ├─ Scan Barcode               │
    │ ├─ Read from LIS              │
    │ ├─ Apply ConversionFactor     │
    │ ├─ Flag Abnormal Results      │
    │ └─ Create ComponentResults    │
    │                               │
    │ → Status: "Result Entered"    │
    └────┬───────────────────────────┘
         │
┌────────▼────────────────────────────┐
│ 5. VERIFICATION (Pathologist)        │
│    - Review each result              │
│    - Validate ranges & anomalies     │
│    - Add remarks/comments             │
│    - Digital signature/approval       │
│    → Status: "Verified"               │
│    → IsVerified = true                │
│    → VerifiedBy, VerifiedOn           │
└────────┬────────────────────────────┘
         │
┌────────▼────────────────────────────┐
│ 6. REPORT GENERATION                │
│    - Retrieve ReportTemplate          │
│    - Format components per template   │
│    - Apply signatories                │
│    - Generate PDF/Print layout        │
│    → Create LabReport record          │
│    → Status: "Finalized"              │
│    → Link RequisitionId to ReportId   │
└────────┬────────────────────────────┘
         │
┌────────▼────────────────────────────┐
│ 7. REPORT DISPATCH                  │
│    - Print report                    │
│    - Optional: SMS notification      │
│    - Optional: IMU upload            │
│    - Optional: Google Drive backup   │
│    → Status: "Dispatched"            │
│    → PrintedOn, PrintedBy            │
│    → PrintCount++                    │
└────────┬────────────────────────────┘
         │
┌────────▼────────────────────────────┐
│ 8. COMPLETION                        │
│    - Patient retrieves report        │
│    - Archive in medical records      │
│    - Status: "Completed"             │
└────────────────────────────────────┘
```

### LIS Machine Integration Flow

```
┌─────────────────────────────────────────┐
│ LIS Machine Integration Flow            │
└─────────────────────────────────────────┘

Step 1: CONFIGURATION
├─ Setup: Create Machine Master in LIS Computer Server
├─ Setup: Create Components in LIS system
├─ Setup: Create Components in DanpheEMR (Lab_MST_Components)
└─ Link: Create LISComponentMap (EMR ↔ LIS)

Step 2: ORDER TRANSFER
├─ Clinician creates LabRequisition
├─ Sample collected with BarCode
├─ POST /api/LIS/MachineOrder with RequisitionIds
├─ Order sent to machine via LIS Server
└─ Machine queues test

Step 3: ANALYSIS
├─ Technician loads sample in machine
├─ Machine analyzes (automated)
├─ Machine sends results to LIS Server
└─ Results stored in LIS database

Step 4: RESULT IMPORT
├─ GET /api/LIS/GetAllMachineResult(machineId, dates)
├─ Or GET /api/LIS/GetResultByBarcodeNumber(barcode)
├─ LIS Service receives MachineResultsVM
├─ For each result:
│  ├─ Apply ConversionFactor
│  ├─ Create LabTestComponentResult
│  ├─ Link to RequisitionId
│  └─ Flag abnormalities
└─ POST /api/LIS/AddLisDataToResult

Step 5: VERIFICATION & SYNC
├─ Lab staff review imported results
├─ Verify component values & ranges
├─ PUT /api/LIS/MachineResultSync (mark as synced)
└─ Update sync status to prevent re-import

Step 6: REPORT GENERATION
├─ All results (machine + manual) consolidated
├─ Template formatting applied
├─ Report finalized
└─ Dispatch to patient
```

---

## 19. INTEGRATION POINTS WITH OTHER MODULES

### Patient Module
- PatientId: Core linking field
- Patient demographics in reports
- Visit history in lab context

### Billing Module
- BillingTransactionItemId: Service item linking
- ServiceDepartmentId: Lab department code
- BillingStatus: Charge workflow
- Price calculation: Via ServiceItem master

### Admission/ADT Module
- AdmissionId: For inpatient tests
- VisitType: "OPD", "IPD", "Emergency"
- WardName: Inpatient location
- Run number sequences per visit type

### Pharmacy Module
- Drug-test interactions checking
- Test value interpretation in prescription context

### Radiology Module
- Parallel test & imaging orders
- Integrated clinical context

### Reporting Module
- Lab analytics dashboards
- Department-wise statistics
- Revenue reports
- Compliance reports

---

## 20. DEPLOYMENT CONSIDERATIONS

### Database
- SQL Server required
- Multiple DbContext (Lab, LIS, Billing, etc.)
- Stored procedures for performance
- Indexes on: PatientId, BarCodeNumber, RunNumber

### Configuration
- LIS Server URL: `_config.Value.LISDataBaseUrl`
- Google Drive settings: Upload path & URL base
- SMS service configuration
- Email service for notifications

### External Dependencies
- LIS Computer Server API
- Google Drive API (optional)
- SMS gateway (optional)
- IMU reporting system (India-specific)

### Performance Tuning
- Cache lab masters at startup
- Batch import for machine results
- Stored procedures for complex queries
- Index optimization on transaction tables

---

## CONCLUSION

DanpheEMR's laboratory module is a comprehensive, production-ready LIS system featuring:

✅ **Complete Test Lifecycle Management** - From order to report dispatch
✅ **Flexible Hierarchical Test Catalogs** - Tests → Component Groups → Components
✅ **Machine Integration** - External LIS server for analyzer connectivity
✅ **Multi-Vendor Support** - Internal & outsourced lab tests
✅ **Quality Management** - Verification workflow, abnormality flagging
✅ **Integration** - Billing, Government reporting, IMU, SMS, Drive
✅ **Audit Trail** - Complete transaction logging
✅ **Scalability** - Stored procedures, async operations, caching

The architecture follows enterprise patterns with clear separation of concerns, making it maintainable and extensible for future enhancements.

