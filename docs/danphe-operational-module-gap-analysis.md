# Danphe Operational Module Gap Analysis

Date: 2026-04-30

Scope: code-level comparison between the local HMS modules and `DanpheEMR reference` for:
OT / Surgery, Accounts / Finance, HR & Payroll, Asset Management, and MRD.

## Reference Files Reviewed

- OT: `DanpheEMR reference/Code/Websites/DanpheEMR/Controllers/OperationTheatre/OperationTheatreController.cs`
- OT models: `OtBookingListModel.cs`, `OTTeamsModel.cs`, `OtCheckListInfoModel.cs`, `OTSummaryModel.cs`
- Accounting: `AccountingController.cs`, `AccountingReportController.cs`
- Accounting models: `LedgerModel.cs`, `AccountingPaymentModel.cs`, `SubLedgerTransactionModel.cs`, `InventoryVendorLedger_DTO.cs`
- HR / Payroll: `PayrollController.cs`, `AttendanceDailyTimeRecordModel.cs`, `EmployeeLeaveModel.cs`, `LeaveCategory.cs`, `LeaveRuleModel.cs`
- Fixed Asset: `AssetManagementController.cs`, `AssetMaintenanceController.cs`
- Fixed Asset models: `FixedAssetStockModel.cs`, `FixedAssetContractModel.cs`, `FixedAssetServiceModel.cs`, `FixedAssetDepreciationModel.cs`, `FixedAssetInsuranceModel.cs`
- MRD: `MedicalRecordsController.cs`, `MedicalRecordModel.cs`, `OperationTypeModel.cs`, `DischargeSummaryModel.cs`

## Current HMS Coverage

| Module | Existing HMS implementation | Main remaining Danphe-level gaps |
|---|---|---|
| OT / Surgery | `src/routes/tenant/ot.ts`, `migrations/0033_operation_theatre.sql` support bookings, teams, checklist, and OT summary. | Surgery notes are folded into summary text; anesthesia records are not structured; no operation status event trail. |
| Accounts / Finance | Accounting dashboard, chart of accounts, expenses, income, journal, P&L, profit distribution exist. | Vendor payment workflow is missing; vendor/GR linkage to approved expenses is missing; payroll approval is not posted into finance. |
| HR & Payroll | Leave category/request/balance, attendance, shifts, roster, biometric, salary heads, structures, payroll runs/payslips exist. | Danphe-style leave rules with pay percent are missing; payroll generation does not include attendance/leave summary; approval does not create salary expense. |
| Asset Management | Registration, QR, AMC, maintenance, allocation, depreciation, disposal, movement/audit logs exist. | Danphe insurance records and contract-document metadata are missing; contract binary storage must remain out of D1. |
| MRD | Medical records, ICD coding, birth/death, diagnosis, document records, referrals, MLC module exists separately. | Chart completion tracking, discharge summary archival, and MRD-linked medico-legal file tracking are missing. |

## Gap Closure Plan

1. Add migration `0187_danphe_operational_gap_closure.sql` with narrowly scoped tables/columns.
2. Extend OT with structured surgery notes, anesthesia records, and operation status events.
3. Extend finance with vendor payment posting and expense source linkage.
4. Extend HR with leave rules, payroll attendance/leave summary, and salary expense posting on payroll approval.
5. Extend asset management with insurance policies and contract document metadata using R2 keys only.
6. Extend MRD with chart completion, discharge archive metadata, and medico-legal file tracking linked to patient/record/MLC case.
7. Add integration tests for the new API surface and run targeted verification.

## Security And Architecture Notes

- New sensitive workflows stay server-side; browser-facing APIs only submit metadata and IDs.
- Files are represented by R2 object keys, names, sizes, and MIME types. Binaries are not stored in D1.
- New handlers remain thin and use D1 for relational state. No new synchronous heavy processing is added.
- Tenant ID is bound on every query. New endpoints validate parent records by tenant before writes.
