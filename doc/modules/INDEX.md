# DanpheEMR Module Documentation — Index

> **All 51 modules in the DanpheEMR .NET solution, documented from source code.**

## How to Use This Index

Each module's MD file is **self-contained** — read it without ever opening the source code. Every doc follows the same 8-section structure:

1. **Module Overview** — what the module does, hospital workflow
2. **Backend Files** — controllers, BL classes, services, key methods
3. **Data Models** — main entities with field-level detail
4. **Database Tables** — table names, primary keys
5. **Key Workflows** — step-by-step hospital workflow
6. **API Endpoints** — HTTP routes with verb + purpose
7. **Cross-Module Interactions** — how this module talks to others
8. **Key Business Rules** — invariants, validations, edge cases

## Foundation Modules (read first)

| # | Module | Doc | LOC | Purpose |
|---|--------|-----|-----|---------|
| 1 | Account | [→](./01-account.md) | ~3K | Login, logout, password, user lifecycle |
| 7 | Core | [→](./07-core.md) | ~5K | Cross-cutting foundations: parameters, lookups, dynamic templates |
| 32 | Patient | [→](./32-patient.md) | ~2.4K | Master patient record, EMPI |
| 39 | Security | [→](./39-security.md) | ~3K | RBAC, auth, permissions |
| 40 | Settings | [→](./40-settings.md) | ~6K | Per-module + global settings |
| 43 | System Admin | [→](./43-system-admin.md) | ~1.1K | Audit logs, DB backup/restore, IRD reports |
| 44 | Utilities | [→](./44-utilities.md) | ~6K | Shared helpers, conversions, ServerSidePrinter |
| 49 | Home | [→](./49-home.md) | ~500 | Landing page, app boot, sidebar |
| 50 | Process Confirmation | [→](./50-process-confirmation.md) | ~150 | Step-up (witness) auth for high-risk writes |
| 51 | Action Filter | [→](./51-action-filter.md) | ~2K | Cross-cutting filters: auth, audit, view |

## Clinical Modules

| # | Module | Doc | LOC | Purpose |
|---|--------|-----|-----|---------|
| 3 | Admission (ADT) | [→](./03-admission.md) | ~6K | Admission, discharge, transfer, bed mgmt |
| 4 | Appointment | [→](./04-appointment.md) | ~2K | OPD booking, visit creation |
| 6 | Clinical | [→](./06-clinical.md) | ~2.5K | Clinical notes, vitals, history, SOAP |
| 13 | Doctors | [→](./13-doctors.md) | ~1.5K | Doctor profile, schedule, signatory |
| 14 | Emergency | [→](./14-emergency.md) | ~2.9K | ER registration, triage, finalize |
| 22 | Lab | [→](./22-lab.md) | ~5K | Lab order, sample, result, report, LIS |
| 25 | Maternity | [→](./25-maternity.md) | ~2K | ANC, delivery, PNC, neonatal |
| 26 | Medical Records | [→](./26-medical-records.md) | ~2K | File upload, document mgmt, gov reports |
| 29 | Nursing | [→](./29-nursing.md) | ~2K | Vitals, I/O, notes, handover |
| 30 | Operation Theatre | [→](./30-operation-theatre.md) | ~1.5K | OT booking, surgical case |
| 31 | Order | [→](./31-order.md) | ~1.1K | Cross-dept order entry (lab/rad/consults) |
| 36 | Radiology | [→](./36-radiology.md) | ~3K | Imaging order, scan, report, DICOM |
| 45 | Vaccination | [→](./45-vaccination.md) | ~1K | Pediatric dose tracking |

## Diagnostic / Imaging

| # | Module | Doc | LOC | Purpose |
|---|--------|-----|-----|---------|
| 11 | DICOM Viewer | [→](./11-dicom-viewer.md) | ~1.5K | DICOM image viewing |

## Pharmacy / Inventory

| # | Module | Doc | LOC | Purpose |
|---|--------|-----|-----|---------|
| 12 | Dispensary | [→](./12-dispensary.md) | ~1.5K | Sub-store dispense, ward stock |
| 21 | Inventory | [→](./21-inventory.md) | ~4K | Procurement, GR, stock, sub-stores |
| 34 | Pharmacy | [→](./34-pharmacy.md) | ~5K | Prescription, sale, purchase, stock |
| 47 | Ward Supply | [→](./47-ward-supply.md) | ~3K | Ward stock, consumption, requisition |

## Finance

| # | Module | Doc | LOC | Purpose |
|---|--------|-----|-----|---------|
| 2 | Accounting | [→](./02-accounting.md) | ~14K | Chart of accounts, vouchers, ledger, fiscal |
| 5 | Billing | [→](./05-billing.md) | ~7K | OPD/IPD billing, deposit, settlement, IRD |
| 9 | Claim Management | [→](./09-claim-management.md) | ~2K | Insurance claim submission |
| 16 | Fixed Asset | [→](./16-fixed-asset.md) | ~3K | Asset register, depreciation, maintenance |
| 17 | Fraction | [→](./17-fraction.md) | ~1.5K | Revenue sharing % per service/doctor |
| 19 | Incentive | [→](./19-incentive.md) | ~1.5K | Doctor/employee incentive calculation |
| 20 | Insurance | [→](./20-insurance.md) | ~2.5K | Insurance setup, package pricing, claim |
| 27 | Nepali Receipt | [→](./27-nepali-receipt.md) | ~500 | Nepal-mandated print forms |
| 48 | SSF | [→](./48-ssf.md) | ~1.5K | Nepal Social Security Fund integration |

## HR

| # | Module | Doc | LOC | Purpose |
|---|--------|-----|-----|---------|
| 15 | Employee (HR) | [→](./15-employee-hr.md) | ~2K | Employee CRUD, roles, types, image |
| 33 | Payroll | [→](./33-payroll.md) | ~2.5K | Attendance, leave, payroll run, payslip |
| 38 | Scheduling | [→](./38-scheduling.md) | ~1.5K | Shift master, roster, day-wise schedule |

## Admin / Operational

| # | Module | Doc | LOC | Purpose |
|---|--------|-----|-----|---------|
| 8 | CSSD | [→](./08-cssd.md) | ~1.5K | Central Sterile Supply Dept tracking |
| 10 | Dashboard | [→](./10-dashboard.md) | ~2K | Analytics dashboards by role |
| 18 | Helpdesk | [→](./18-helpdesk.md) | ~1.5K | Patient-facing info, queue display |
| 23 | Marketing Referral | [→](./23-marketing-referral.md) | ~1.5K | Referral tracking, campaign |
| 24 | Master | [→](./24-master.md) | ~1.5K | Master data: ICD, country, dept, payment |
| 28 | Notification | [→](./28-notification.md) | ~1.5K | SMS, email, in-app bell |
| 35 | Queue Management | [→](./35-queue-management.md) | ~1K | Token-based queueing |
| 37 | Reporting | [→](./37-reporting.md) | ~6K | Cross-module reports, dynamic SQL, Excel |
| 41 | Social Service Unit | [→](./41-social-service-unit.md) | ~2K | Charity/SSU/SSF |
| 42 | Stickers | [→](./42-stickers.md) | ~1K | Barcode/label printing |
| 46 | Verification | [→](./46-verification.md) | ~1.5K | Multi-level approval workflow |

## By Reading Order (for new HMS implementers)

**Start here** → **Trust the source**

1. [Architecture](./../architecture/INDEX.md) — high-level DanpheEMR architecture
2. [Database](./../database/DATABASE.md) — two-DB model + table prefix conventions
3. **Account** → **Security** → **Patient** → **Appointment** → **Billing** → **Lab** → **Pharmacy** → **Radiology** → **Inventory** → **Accounting** → **HR modules**
4. Specialty modules as needed

## File Map

```
doc/
├── README.md                                  # Top-level entry point
├── architecture/
│   └── INDEX.md                               # DanpheEMR architecture reference
├── database/
│   └── DATABASE.md                            # Two-DB model, naming, mappings
└── modules/
    ├── INDEX.md (this file)
    ├── 01-account.md
    ├── 02-accounting.md
    ├── 03-admission.md
    ├── 04-appointment.md
    ├── 05-billing.md
    ├── 06-clinical.md
    ├── 07-core.md
    ├── 08-cssd.md
    ├── 09-claim-management.md
    ├── 10-dashboard.md
    ├── 11-dicom-viewer.md
    ├── 12-dispensary.md
    ├── 13-doctors.md
    ├── 14-emergency.md
    ├── 15-employee-hr.md
    ├── 16-fixed-asset.md
    ├── 17-fraction.md
    ├── 18-helpdesk.md
    ├── 19-incentive.md
    ├── 20-insurance.md
    ├── 21-inventory.md
    ├── 22-lab.md
    ├── 23-marketing-referral.md
    ├── 24-master.md
    ├── 25-maternity.md
    ├── 26-medical-records.md
    ├── 27-nepali-receipt.md
    ├── 28-notification.md
    ├── 29-nursing.md
    ├── 30-operation-theatre.md
    ├── 31-order.md
    ├── 32-patient.md
    ├── 33-payroll.md
    ├── 34-pharmacy.md
    ├── 35-queue-management.md
    ├── 36-radiology.md
    ├── 37-reporting.md
    ├── 38-scheduling.md
    ├── 39-security.md
    ├── 40-settings.md
    ├── 41-social-service-unit.md
    ├── 42-stickers.md
    ├── 43-system-admin.md
    ├── 44-utilities.md
    ├── 45-vaccination.md
    ├── 46-verification.md
    ├── 47-ward-supply.md
    ├── 48-ssf.md
    ├── 49-home.md
    ├── 50-process-confirmation.md
    └── 51-action-filter.md
```

**Total**: 51 module docs + 2 foundation docs + 1 README = **54 documentation files** covering the full DanpheEMR .NET project.
