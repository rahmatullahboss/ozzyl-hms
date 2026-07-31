# HMS Frontend Pages - Complete Reference

## Page File Organization

### Total: 177 Page Files in `/web/src/pages/`

---

## PAGES BY CATEGORY

### 1. AUTHENTICATION PAGES (8)
```
├── Login.tsx                        → Patient login
├── AdminLogin.tsx                   → Admin login
├── DoctorLogin.tsx                  → Doctor login
├── PatientLoginPage.tsx             → Patient portal login
├── DoctorRegister.tsx               → Doctor self-registration
├── HospitalSignup.tsx               → Hospital registration
├── AcceptInvite.tsx                 → Accept user invitation
└── InviteStaff.tsx                  → Staff invitation system
```

### 2. DASHBOARD PAGES (11)
```
Core Dashboards:
├── HospitalAdminDashboard.tsx       → Admin main dashboard
├── DoctorDashboard.tsx              → Doctor dashboard
├── MDDashboard.tsx                  → Medical director dashboard
├── NursingDashboard.tsx             → Nursing station dashboard
├── LaboratoryDashboard.tsx          → Lab manager dashboard
├── PharmacyDashboard.tsx            → Pharmacy manager dashboard
├── RadiologyDashboard.tsx           → Radiology manager dashboard
├── ReceptionDashboard.tsx           → Front desk dashboard
├── DirectorDashboard.tsx            → Hospital director dashboard
├── MultiBranchDashboard.tsx         → Multi-branch overview
└── TelemedicineDashboard.tsx        → Telemedicine hub
```

### 3. SUPER ADMIN PAGES (7)
```
├── SuperAdminDashboard.tsx          → Super admin home
├── SuperAdminSettings.tsx           → System configuration
├── SuperAdminHospitalList.tsx       → Hospital list management
├── SuperAdminHospitalDetail.tsx     → Hospital detail view
├── SuperAdminHealth.tsx             → System health monitoring
├── SuperAdminAuditLog.tsx           → Audit trail viewer
└── SuperAdminOnboardingQueue.tsx    → Onboarding workflow
```

### 4. PATIENT MANAGEMENT (9)
```
├── PatientList.tsx                  → Patient directory/search
├── PatientDetail.tsx                → Single patient profile
├── PatientForm.tsx                  → Patient registration form
├── PatientPortal.tsx                → Patient self-service portal
├── PatientTimeline.tsx              → Patient health timeline
├── PatientOnboardingPage.tsx        → Patient onboarding
├── PatientChartWorkspace.tsx        → Patient chart editor
├── PatientChartPrint.tsx            → Print patient chart
└── PatientDuplicates.tsx            → Duplicate detection UI
```

### 5. CLINICAL FEATURES (13)
```
Core Clinical:
├── ClinicalAssessments.tsx          → Assessment documentation
├── ConsultationNotes.tsx            → Consultation recording
├── CarePlansDashboard.tsx           → Care plan management
├── PhysicalExamDashboard.tsx        → Physical exam entry
├── EyeExamDashboard.tsx             → Ophthalmology exams
├── AllergiesPage.tsx                → Allergy documentation
├── VaccinationDashboard.tsx         → Vaccination records
├── VitalsPage.tsx                   → Vital signs tracking
├── TrackAnythingDashboard.tsx       → Generic data tracking
├── TriageChatbot.tsx                → AI triage interface
├── ImportExternalRecords.tsx        → External record import
└── HealthRecordSharing.tsx          → Patient health sharing
```

### 6. VISIT & APPOINTMENT MANAGEMENT (5)
```
├── AppointmentScheduler.tsx         → Appointment booking
├── DoctorSchedule.tsx               → Doctor schedule view
├── ReportAppointmentPage.tsx        → Appointment reports
├── QueueDisplay.tsx                 → Queue management display
└── QueueManagement.tsx              → Queue admin interface
```

### 7. BILLING & FINANCE (13)
```
├── BillingDashboard.tsx             → Billing overview
├── BillingMasterPage.tsx            → Billing configuration
├── BillPrint.tsx                    → Bill printing interface
├── BillCancellationPage.tsx         → Cancel bill UI
├── BillingHandoverPage.tsx          → Handover management
├── InsuranceBillingPage.tsx         → Insurance billing
├── InsuranceClaims.tsx              → Insurance claim tracking
├── IPBillingPage.tsx                → Inpatient billing
├── ProvisionalBillingPage.tsx       → Provisional bill entry
├── FeeSheet.tsx                     → Service fee management
├── DepositsPage.tsx                 → Deposit tracking
├── PaymentsPage.tsx                 → Payment processing
└── SettlementsPage.tsx              → Payment settlements
```

### 8. PHARMACY MODULE (27 pages in `/pages/pharmacy/`)
```
Overview & Dashboard:
├── PharmacyOverview.tsx             → Pharmacy operations view

Catalog Management:
├── ItemList.tsx                     → Drug/item catalog
├── ItemPriceHistory.tsx             → Price tracking
├── GenericList.tsx                  → Generic drug list
├── CategoryList.tsx                 → Item categories
├── SupplierList.tsx                 → Supplier directory
├── SupplierLedger.tsx               → Supplier transactions

Purchase & Receiving:
├── PurchaseOrderForm.tsx            → PO creation
├── PurchaseOrderList.tsx            → PO tracking
├── GoodsReceiptForm.tsx             → GR data entry
├── GoodsReceiptList.tsx             → GR history
├── DispatchList.tsx                 → Dispatch tracking

Billing & Sales:
├── InvoiceForm.tsx                  → Invoice creation
├── InvoiceList.tsx                  → Invoice history
├── InvoiceReceipt.tsx               → Receipt printing
├── PatientBillingPage.tsx           → Patient dispensing
├── NarcoticRegister.tsx             → Controlled substance log
├── SettlementList.tsx               → Payment settlements

Inventory & Reports:
├── StockList.tsx                    → Current stock view
├── DispensaryStock.tsx              → Dispensary inventory
├── WriteOffList.tsx                 → Write-off tracking
├── ExpiryReport.tsx                 → Expiry management
├── StockReport.tsx                  → Stock analytics
├── SalesReport.tsx                  → Sales reporting
├── ApprovalQueuePage.tsx            → Approval workflow
├── DosageTemplatesPage.tsx          → Dosage presets
└── TaxConfigPage.tsx                → Tax configuration
```

### 9. LABORATORY MODULE (6)
```
├── LaboratoryDashboard.tsx          → Lab operations
├── LabTestOrderForm.tsx             → Test ordering
├── LabSettingsPage.tsx              → Lab configuration
├── LabReportPrint.tsx               → Report printing
├── ReportLabPage.tsx                → Lab analytics
└── TestCatalog.tsx                  → Test catalog management
```

### 10. RADIOLOGY MODULE (1)
```
└── RadiologyDashboard.tsx           → Radiology operations
```

### 11. NURSING MODULE (1)
```
└── NurseStation.tsx                 → Nursing station interface
```

### 12. HR & STAFF MANAGEMENT (6)
```
├── HRDashboard.tsx                  → HR overview
├── StaffPage.tsx                    → Staff directory
├── AttendancePunch.tsx              → Biometric punch
├── DutyRoster.tsx                   → Roster creation
├── GroupAttendance.tsx              → Bulk attendance
└── EPrescribingDashboard.tsx        → e-Prescription system
```

### 13. INVENTORY MODULE (Various in `/pages/inventory/`)
```
[Inventory pages organized separately]
```

### 14. OPERATIONS & FACILITIES (17)
```
Admission & Beds:
├── AdmissionIPD.tsx                 → IPD admission
├── BedManagement.tsx                → Bed allocation
├── OTDashboard.tsx                  → Operation Theatre

Emergency & Departments:
├── EmergencyDashboard.tsx           → Emergency operations
├── HousekeepingManagement.tsx       → Housekeeping tasks
├── LaundryManagement.tsx            → Laundry tracking
├── KitchenManagement.tsx            → Kitchen/diet orders
├── CssdManagement.tsx               → Sterile supply
├── AmbulanceManagement.tsx          → Ambulance dispatch
├── MortuaryManagement.tsx           → Mortuary operations
├── BiomedicalWasteManagement.tsx    → Waste tracking
├── BloodBankManagement.tsx          → Blood bank operations
├── MlcManagement.tsx                → Medico-legal cases
├── AssetManagement.tsx              → Asset tracking
├── Dental.tsx                       → Dental operations
├── Psychiatry.tsx                   → Psychiatry services

Discharge:
├── DischargePlanningPage.tsx        → Discharge planning
├── DischargeSummary.tsx             → Discharge summaries
└── IPDCharges.tsx                   → IPD charge calculation
```

### 15. ADVANCED FEATURES (9)
```
AI & Automation:
├── AIAssistant.tsx                  → AI health assistant

Clinical Features:
├── DigitalPrescription.tsx          → Digital prescriptions
├── QuestionnairesPage.tsx           → Questionnaire system
├── MedicineDispensing.tsx           → Medicine dispensing UI
├── ProcedureOrdersDashboard.tsx     → Procedure management
├── PriorAuthDashboard.tsx           → Prior authorization
├── Camos.tsx                        → CAMOS integration
├── CustomFormBuilder.tsx            → Form builder tool
└── PrintTemplateSettings.tsx        → Print template config
```

### 16. TELEMEDICINE & COMMUNICATION (4)
```
├── TelemedicineRoom.tsx             → Video consultation room
├── WhatsAppDashboard.tsx            → WhatsApp messaging
├── NotificationsCenter.tsx          → Notification hub
└── InboxPage.tsx                    → Message inbox
```

### 17. REPORTING (2)
```
├── ReportsDashboard.tsx             → Reporting hub
└── ReportPharmacyPage.tsx           → Pharmacy analytics
```

### 18. MARKETPLACE (4 in `/pages/marketplace/`)
```
├── DoctorDirectory.tsx              → Doctor listing
├── DoctorProfile.tsx                → Doctor detail
├── HospitalDirectory.tsx            → Hospital listing
└── HospitalProfile.tsx              → Hospital detail
└── MarketplaceLanding.tsx           → Marketplace home
```

### 19. ACCOUNTING (9 in `/pages/accounting/`)
```
├── AccountingDashboard.tsx          → Accounting overview
├── ChartOfAccounts.tsx              → COA management
├── JournalEntries.tsx               → Journal entry posting
├── ExpenseList.tsx                  → Expense tracking
├── IncomeList.tsx                   → Income tracking
├── RecurringExpenses.tsx            → Fixed expenses
├── ProfitLoss.tsx                   → P&L statement
├── Reports.tsx                      → Accounting reports
├── ShareholderManagement.tsx        → Shareholder info
└── AuditLogs.tsx                    → Audit trail
```

### 20. SETTINGS & ADMIN (3)
```
├── WebsiteSettings.tsx              → Hospital website config
├── SettingsPage.tsx                 → System settings
└── CommissionManagement.tsx         → Doctor commission setup
```

### 21. OTHER PAGES (5)
```
├── HelpCenterPage.tsx               → Help documentation
├── SystemAuditLog.tsx               → System audit viewer
├── MedicalRecordsDashboard.tsx      → Records archive
├── MarketingReferral.tsx            → Referral tracking
└── PatientLoginPage.tsx             → Patient login alt
```

---

## PAGE FILE STATISTICS

| Category | Count |
|----------|-------|
| Authentication | 8 |
| Dashboards | 11 |
| Super Admin | 7 |
| Patient Management | 9 |
| Clinical | 13 |
| Appointments | 5 |
| Billing & Finance | 13 |
| Pharmacy | 27 |
| Laboratory | 6 |
| Radiology | 1 |
| Nursing | 1 |
| HR & Staff | 6 |
| Operations | 17 |
| Advanced Features | 9 |
| Telemedicine | 4 |
| Reporting | 2 |
| Marketplace | 5 |
| Accounting | 9 |
| Settings | 3 |
| Other | 5 |
| **TOTAL** | **177** |

---

## COMPONENT FILES (39 components in `/web/src/components/`)

### Component Organization
```
components/
├── clinical/                        → Clinical feature components
├── dashboard/                       → Dashboard widgets/charts
├── nursing/                         → Nursing interface components
├── radiology/                       → Radiology viewers/tools
├── marketplace/                     → Marketplace UI components
└── shareholders/                    → Financials components
```

---

## FRONTEND ARCHITECTURE PATTERNS

### Page Structure
- All pages are React components (TSX)
- Pages handle routing and main layout
- Components are reusable UI elements
- Custom hooks for state management

### Common Page Features
- Authentication guards (private routes)
- Role-based access control (RBAC)
- Responsive design
- Data fetching hooks
- Error boundaries
- Loading states
- Form validation

### Data Flow
- API calls via fetch/axios
- State management hooks
- Global context (if used)
- Form state management

---

## FEATURE COVERAGE BY INTERFACE

| Feature Area | Pages | Status |
|--------------|-------|--------|
| Patient Management | 9 | ✅ Complete |
| Clinical Documentation | 13 | ✅ Complete |
| Pharmacy Operations | 27 | ✅ Comprehensive |
| Billing & Finance | 13 | ✅ Complete |
| Lab Operations | 6 | ✅ Complete |
| HR Management | 6 | ✅ Complete |
| Operations | 17 | ✅ Complete |
| Reporting | 2 | ⏳ Basic |
| Telemedicine | 4 | ✅ Complete |
| Accounting | 9 | ✅ Complete |
| **TOTAL** | **177** | ✅ Ready |

---

## USER ROLE PAGES

### Hospital Admin
- HospitalAdminDashboard
- Staff management
- Settings
- Reports
- All operational dashboards

### Doctor
- DoctorDashboard
- Patient List
- Consultations
- Prescriptions
- Clinical documentation

### Nursing
- NurseDashboard
- Patient assignments
- Care plans
- Medication admin
- Vital tracking

### Pharmacy
- PharmacyDashboard
- All pharmacy pages (27)
- Stock management
- Invoice handling

### Laboratory
- LaboratoryDashboard
- Test ordering
- Results entry
- Reports

### Finance/Billing
- BillingDashboard
- All billing pages (13)
- Accounting (9)
- Reports

### Super Admin
- SuperAdminDashboard
- Hospital management
- System settings
- Audit logs

