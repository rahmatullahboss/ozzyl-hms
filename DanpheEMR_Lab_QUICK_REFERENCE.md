# DanpheEMR Lab Architecture - QUICK REFERENCE GUIDE

## File Locations Summary

### Core Server Models (31 files, 1408 LOC)
```
/Code/Components/DanpheEMR.ServerModel/LabModels/
├─ LabTestModel.cs (86 LOC) - Test definitions
├─ LabRequisitionModel.cs (114 LOC) - Orders
├─ LabTestComponentResult.cs (46 LOC) - Results
├─ LabTestComponentMapModel.cs (37 LOC) - Component hierarchy
├─ LabTestJSONComponentModel.cs (42 LOC) - Individual parameters
├─ LabReportModel.cs (44 LOC) - Reports
└─ [27 more model files...]
```

### LIS Integration Models
```
/Code/Components/DanpheEMR.ServerModel/LISModels/
├─ LISComponentMasterVM.cs - Machine + component master
├─ LISComponentMapModel.cs - EMR ↔ LIS mapping
└─ MachineResultsVM.cs - Result import model
```

### Database Contexts
```
/Code/Components/DanpheEMR.DalLayer/
├─ LabDbContext.cs - 14 DbSets for lab tables
└─ LISDbContext.cs - 9 DbSets for LIS integration
```

### API Controllers
```
/Code/Websites/DanpheEMR/Controllers/Lab/
├─ LabController.cs (278KB) - Primary endpoints
├─ LISController.cs (284 LOC) - Machine integration
├─ LabSettingController.cs (59KB) - Master data CRUD
├─ LabReportExportController.cs (25KB) - Export functions
└─ IMUController.cs (3.5KB) - Government reporting
```

### Services
```
/Code/Websites/DanpheEMR/Services/LIS/
├─ ILISService.cs - Interface (9 methods)
├─ LISService.cs - Implementation (29KB)
└─ DTOs/ - Machine result DTOs
```

### Frontend (126 TypeScript files)
```
/wwwroot/DanpheApp/src/app/labs/
├─ lab-tests/ - Order, collect, result, report UI
├─ lab-settings/ - Master data configuration
├─ lab-lis/ - Machine mapping & result import
├─ external-labs/ - Vendor management
├─ notification/ - SMS & IMU upload
└─ shared/ - 50+ models, services, DTOs
```

---

## Database Tables at a Glance

### Master Data (Read-mostly)
| Table | Key Fields | Purpose |
|-------|-----------|---------|
| LAB_LabTests | LabTestId, LabTestCode, LOINC, ProcedureCode | Test definitions |
| Lab_MST_Components | ComponentId, ComponentName, Range, Unit | Test parameters |
| Lab_MAP_TestComponents | ComponentMapId, LabTestId, ComponentId | Test ↔ Component mapping |
| Lab_ReportTemplate | ReportTemplateId, TemplateName | Report layout |
| LAB_TestCategory | TestCategoryId, TestCategoryName | Categorization |
| Lab_MST_RunNumberSettings | SettingId, RunNumberType, Format, NextNumber | Run numbering |
| Lab_MST_LabVendors | VendorId, VendorName | External labs |

### Transaction Data (High-volume)
| Table | Key Fields | Purpose |
|-------|-----------|---------|
| LAB_TestRequisition | RequisitionId, PatientId, LabTestId, OrderDateTime | Lab orders |
| LAB_TXN_TestComponentResult | ResultId, RequisitionId, ComponentId, Value | Test results |
| LAB_TXN_LabReports | ReportId, PatientId, TemplateId, CreatedOn | Final reports |
| LAB_BarCode | BarCodeId, BarCodeNumber, RequisitionId | Sample tracking |

### LIS Integration
| Table | Key Fields | Purpose |
|-------|-----------|---------|
| LAB_LIS_ComponentMap | MapId, LISComponentId, ComponentId, ConversionFactor | Machine mapping |
| LAB_LIS_SyncedComponent_Detail | DetailId, BarCodeNumber, Value, MachineId | Imported results |

---

## Key API Endpoints

### Lab Orders
```
GET  /api/Lab/Requisition/SamplePending - Collect sample
GET  /api/Lab/WorkList - Lab worklist
POST /api/Lab/Requisition/Add - Create order
GET  /api/Lab/LatestSampleCode - Generate run number
```

### Lab Results
```
GET  /api/Lab/Result/Pending - Pending results
POST /api/Lab/Result/Add - Enter results
POST /api/Lab/Result/Verify - Verify results
GET  /api/Lab/LabDataByBarcodeNumber - Get by barcode
```

### Lab Reports
```
GET  /api/Lab/Report/Pending - Pending reports
POST /api/Lab/Report/Finalize - Create final report
POST /api/Lab/Report/Dispatch - Dispatch report
GET  /api/Lab/ReportDispatch/LabReportByRequisitionIds - Batch fetch
```

### LIS Machine Integration
```
GET  /api/LIS/GetAllLISMasterData - Fetch machine master
GET  /api/LIS/GetAllMappedData - Get mapped components
POST /api/LIS/AddUpdateNewMapping - Map component
POST /api/LIS/AddLisDataToResult - Import results
GET  /api/LIS/GetMachineResultByBarcodeNumber - Get by barcode
POST /api/LIS/MachineOrder - Send order to machine
PUT  /api/LIS/MachineResultSync - Mark as synced
```

### Settings & Configuration
```
POST/GET /api/LabSetting/Test - Test CRUD
POST/GET /api/LabSetting/Component - Component CRUD
POST/GET /api/LabSetting/ReportTemplate - Template CRUD
POST/GET /api/LabSetting/Category - Category CRUD
```

---

## Workflow Summary

### 1. Order Creation → Billing
```
Clinician selects tests
    ↓ (LabRequisitionModel created)
Auto-link ReportTemplate
    ↓ (BillingStatus = "Pending")
Billing system charges
    ↓ (BillingStatus = "Charged")
Ready for sample collection
```

### 2. Sample Collection
```
LabRequisition found in "Pending" list
    ↓
Validate SampleCode (run number format)
    ↓
Generate BarCodeNumber
    ↓
Print label & collect specimen
    ↓
Status: "Collected"
```

### 3. Result Entry (Manual or LIS Auto-Import)

#### Manual Entry
```
Lab staff access "Pending Results"
    ↓
Enter component values one by one
    ↓
Validation: Check ranges, flag abnormal
    ↓
Save LabTestComponentResult records
    ↓
Status: "Result Entered"
```

#### LIS Machine Auto-Import
```
Machine runs analysis
    ↓
Results sent to LIS Computer Server
    ↓
GET /api/LIS/GetMachineResultByBarcodeNumber
    ↓
Map LIS ComponentId → EMR ComponentId via LISComponentMap
    ↓
Apply ConversionFactor if needed
    ↓
Flag abnormalities
    ↓
POST /api/LIS/AddLisDataToResult
    ↓
Atomic insert: all results or none
    ↓
Status: "Result Entered"
```

### 4. Verification
```
Pathologist reviews results
    ↓
Validates ranges, notes, interpretation
    ↓
Digital signature/approval
    ↓
POST verify endpoint
    ↓
IsVerified = true, VerifiedBy, VerifiedOn
    ↓
Status: "Verified"
```

### 5. Report Generation
```
Retrieve ReportTemplate
    ↓
Format components per template structure
    ↓
Apply component hierarchy (groups, indentation)
    ↓
Add signatories
    ↓
Generate PDF/print layout
    ↓
Create LabReport record
    ↓
Status: "Finalized"
```

### 6. Dispatch
```
Print report
    ↓
Optional: Send SMS notification
    ↓
Optional: Upload to IMU (gov reporting)
    ↓
Optional: Backup to Google Drive
    ↓
PrintedOn, PrintedBy, PrintCount++
    ↓
Status: "Dispatched" → "Completed"
```

---

## Component Hierarchy Example

### Structured Test Definition
```
Complete Blood Count (LabTest)
│
├─ Component Group 1: WBC Profile
│  ├─ WBC Count (ComponentId: 101, Unit: K/μL)
│  └─ WBC Differential (Sub-group)
│     ├─ Neutrophils (ComponentId: 102, %)
│     ├─ Lymphocytes (ComponentId: 103, %)
│     └─ Monocytes (ComponentId: 104, %)
│
├─ Component Group 2: RBC Profile
│  ├─ RBC Count (ComponentId: 105, M/μL)
│  ├─ Hemoglobin (ComponentId: 106, g/dL)
│  │  Ranges: Male: 13.5-17.5, Female: 12-15.5, Child: 11-14
│  └─ Hematocrit (ComponentId: 107, %)
│     Formula: (Hemoglobin × 3) - 0.5  ← Auto-calculated!
│
└─ Component Group 3: Platelets
   └─ Platelet Count (ComponentId: 108, K/μL)
      Range: 150-400
      AbnormalType: if <50 = "Critical Low"
```

### Database Mapping
```
LAB_LabTests
  └─ LabTestId = 1, LabTestName = "Complete Blood Count"

Lab_MAP_TestComponents (Test ↔ Component mapping)
  ├─ MapId=1: LabTestId=1, ComponentId=101, GroupName="WBC Profile"
  ├─ MapId=2: LabTestId=1, ComponentId=102, GroupName="WBC Profile", IndentationCount=1
  ├─ MapId=3: LabTestId=1, ComponentId=105, GroupName="RBC Profile"
  ├─ MapId=4: LabTestId=1, ComponentId=106, GroupName="RBC Profile", IndentationCount=0
  │   IsAutoCalculate=true, CalculationFormula="(ComponentId_107 × 3) - 0.5"
  └─ ...

Lab_MST_Components
  ├─ ComponentId=101: ComponentName="WBC Count", Unit="K/μL", Range="4.5-11"
  ├─ ComponentId=106: ComponentName="Hemoglobin", Unit="g/dL",
  │   MaleRange="13.5-17.5", FemaleRange="12-15.5", ChildRange="11-14"
  └─ ...

LAB_TestRequisition
  └─ RequisitionId=100: LabTestId=1, PatientId=5, OrderDateTime=...

LAB_TXN_TestComponentResult (Results)
  ├─ ResultId=1: RequisitionId=100, ComponentId=101, Value="7.5"
  ├─ ResultId=2: RequisitionId=100, ComponentId=106, Value="14.5", IsAbnormal=false
  └─ ResultId=3: RequisitionId=100, ComponentId=107, Value="42" (auto-calculated)
```

---

## LIS Machine Integration Example

### Configuration: Map Machine Component to EMR Component

```
LIS Computer Server has machines:
  └─ MachineId: 1, MachineName: "Sysmex XN-550", MachineCode: "SYS001"
     └─ Machine Component: LISComponentId=201, ComponentName="WBC_COUNT_SYS"

EMR has:
  └─ ComponentId: 101, ComponentName="WBC Count"

Create Mapping:
  └─ LISComponentMapModel
     ├─ LISComponentMapId: 1
     ├─ LISComponentId: 201 (from LIS)
     ├─ ComponentId: 101 (in EMR)
     ├─ MachineId: 1
     ├─ ConversionFactor: 1.0 (if units match)
     └─ IsActive: true
```

### Workflow: Import Machine Results

```
1. Machine analyzes sample with barcode 123456
2. Results sent to LIS Computer Server

3. DanpheEMR polls:
   GET /api/LIS/GetResultByBarcodeNumber(123456)
   
4. Response: MachineResultsVM
   {
     BarCodeNumber: 123456,
     LISComponentId: 201,           ← From machine
     LISComponentName: "WBC_COUNT_SYS",
     Value: "7.5",
     Unit: "K/μL",
     MachineUnit: "K/μL",
     ConversionFactor: 1.0,
     LabTestId: 1,
     RequisitionId: 100,
     PatientId: 5
   }

5. Service maps LISComponentId → ComponentId via LISComponentMapModel
   LISComponentId 201 → ComponentId 101

6. Create LabTestComponentResult
   {
     TestComponentResultId: 1,
     RequisitionId: 100,
     ComponentId: 101,          ← Mapped!
     Value: "7.5",
     Unit: "K/μL",
     Range: "4.5-11",
     IsAbnormal: false
   }

7. Mark as synced: UpdateMachineResultSyncStatus([ResultId=1])
   ↓ Prevents re-import of same result
```

---

## Key Features at a Glance

✅ **Multi-Component Tests** - Tests can contain unlimited components organized hierarchically
✅ **Gender/Age-Specific Ranges** - Different reference ranges per demographic
✅ **Auto-Calculation** - Components calculated from other components (e.g., Hematocrit)
✅ **LIS Machine Integration** - Seamless import from analyzer machines with unit conversion
✅ **External Lab Support** - Outsource tests to external vendors
✅ **Multiple Lab Types** - Different lab settings per institution
✅ **Run Number Management** - Configurable numbering per visit type (OPD/IPD)
✅ **Barcode Tracking** - Sample identification & traceability
✅ **Abnormality Flagging** - Auto-detect & flag critical/abnormal results
✅ **Government Reporting** - Compliance with Indian health ministry requirements
✅ **SMS/Email Notifications** - Result notifications for patients
✅ **Verification Workflow** - Multi-level approval (Tech → Pathologist → Signatory)
✅ **Report Templates** - Customizable report layouts per test type
✅ **Billing Integration** - Automatic charge posting
✅ **Audit Trail** - Complete creation/modification/verification tracking

---

## Performance Optimization Strategies

1. **Cached Master Data**
   - Lab types, categories, components in memory
   - Run number settings pre-loaded
   - Report templates cached at startup

2. **Stored Procedures**
   - 30+ SPs for bulk operations
   - Aggregated queries for reporting
   - Indexed on: PatientId, BarCodeNumber, RunNumber

3. **Async Operations**
   - Batch result import from machines
   - Background SMS/IMU uploads
   - Async/await patterns in services

4. **Database Optimization**
   - Separate DbContexts for isolation
   - Query optimization via stored procedures
   - Index strategy on transaction tables

---

## Important Fields to Know

### LabTestModel
- `IsLISApplicable` - Can this test accept machine results?
- `IsOutsourceTest` - Is this test outsourced to external lab?
- `LOINC` - Logical Observation Identifier Names and Codes (standard)
- `ProcedureCode` - Billing/procedure code mapping

### LabRequisitionModel
- `RunNumberType` - Determines which run number sequence (OPD/IPD/etc.)
- `BillingStatus` - Charge workflow: Pending → Charged → Paid
- `OrderStatus` - Test workflow: Pending → Collected → Completed
- `ExternalLabSampleStatus` - For outsourced tests: Sent → Received → Processed

### LabTestComponentMapModel
- `GroupName` - Visual grouping in report
- `IndentationCount` - Tree depth for hierarchical display
- `IsAutoCalculate` - Enable formula-based results
- `CalculationFormula` - Mathematical expression (e.g., "ComponentId_1 * 2")

### LabTestComponentResult
- `IsAbnormal` - Result is outside reference range?
- `AbnormalType` - "High", "Low", "Critical"
- `RangeDescription` - Human-readable range interpretation
- `IsNegativeResult` - Negative test result (e.g., HIV-)

### LISComponentMapModel
- `ConversionFactor` - Unit conversion multiplier
- `IsActive` - Mapping currently active?

---

## Troubleshooting Guide

### Machine Results Not Importing
1. Check `LISComponentMap` - is ComponentId mapped?
2. Verify `IsActive = true` in mapping
3. Check barcode format matches sample
4. Verify LIS Server URL in config

### Component Not Showing in Report
1. Check `Lab_MAP_TestComponents.IsActive`
2. Verify `DisplaySequence` for ordering
3. Check `ShowInSheet = true` for visibility
4. Verify test linked to correct template

### Abnormality Not Flagging
1. Check `Lab_MST_Components.Range` is set
2. Verify gender-specific ranges if applicable
3. Check `IsAbnormal` flag being set in result
4. Verify `AbnormalType` classification logic

### Run Number Generation Issues
1. Check `Lab_MST_RunNumberSettings.NextNumber`
2. Verify `Format` template is valid
3. Check `ResetFrequency` (daily/weekly/monthly)
4. Confirm `RunNumberType` matches requisition

---

## Integration Touch Points

- **Patient Module**: PatientId, demographics in reports
- **Billing Module**: BillingTransactionItemId, ServiceDepartmentId, charge posting
- **Admission/ADT**: VisitType (OPD/IPD), AdmissionId, WardName
- **Government Reporting**: IMU upload, SMS notifications
- **External Systems**: Google Drive backup, Telemedicine portal

---

For detailed information, refer to:
- `/Users/rahmatullahzisan/Desktop/Dev/hms/DanpheEMR_Lab_Architecture_Complete_Report.md` (36KB comprehensive report)
- Source code: `/Code/Components/DanpheEMR.ServerModel/LabModels/`
- Controllers: `/Code/Websites/DanpheEMR/Controllers/Lab/`
- Services: `/Code/Websites/DanpheEMR/Services/LIS/`

