# HMS (Hospital Management System) - Complete Codebase Analysis

**Project Root:** `/Users/rahmatullahzisan/Desktop/Dev/hms`  
**Analysis Date:** April 20, 2026  
**Total Route Files:** 203  
**Total Frontend Pages:** 177  
**Total Component Files:** 39  
**Total Migrations:** 153  

---

## 1. TOP-LEVEL DIRECTORY STRUCTURE

```
/hms
├── src/                          # Backend API code (Cloudflare Workers)
├── web/                          # Frontend React application
├── migrations/                   # Database migration files (153 total)
├── landing/                      # Landing page (Astro)
├── apps/                         # Multi-app workspace
├── packages/                     # Shared packages
├── tools/                        # Utility tools
├── design-system/                # Design system components
├── docs/                         # Documentation
├── data/                         # Data files
├── test/                         # Test files (154 directories)
├── scripts/                      # Build/utility scripts
├── plugins/                      # Plugin modules
├── load-tests/                   # Performance testing
├── _bmad/                        # BMAD framework output
├── .claude/                      # Claude Code configuration
├── wrangler.toml                 # Cloudflare Workers config
├── drizzle.config.ts             # Database ORM config
├── playwright.config.ts          # E2E test config
└── package.json                  # NPM root configuration
```

---

## 2. BACKEND API ROUTES (203 ROUTE FILES)

### **Top-Level Routes**
Located in `/src/routes/`:

1. **Authentication Routes**
   - `admin/auth.ts` - Admin authentication
   - `admin/index.ts` - Admin routes root
   - `doctor-auth.ts` - Doctor authentication
   - `patient-auth.ts` - Patient authentication
   - `login-direct.ts` - Direct login
   - `register.ts` - User registration
   - `init.ts` - Initialization
   - `seed.ts` - Database seeding

2. **Patient Portal Routes**
   - `patient-phr.ts` - Patient health records
   - `patient-card.ts` - Patient card management
   - `patient-amendments.ts` - Patient record amendments
   - `global-portal.ts` - Global patient portal

3. **Public Routes**
   - `public/` - Public API endpoints
     - `healthRecord.ts` - Public health record access
     - `hospitalSite.ts` - Hospital site info
     - `themes/` - Website themes (11 theme files)
       - `arogyaseva.ts`
       - `base.ts`, `carefirst.ts`, `heritage.ts`
       - `medtrust.ts`, `minimal.ts`, `nature.ts`
       - `oceanic.ts`, `sunrise.ts`, `index.ts`

4. **Hospital Features**
   - `hospital-links.ts` - Hospital linking
   - `public-invite.ts` - Public invitations
   - `onboarding.ts` - Hospital onboarding
   - `marketplace.ts` - Marketplace features
   - `marketplace-admin.ts` - Admin marketplace
   - `marketplace-patient.ts` - Patient marketplace
   - `food.ts` - Food/nutrition system
   - `wellness.ts` - Wellness programs
   - `notifications.ts` - Notification system

### **Tenant Routes** (MAIN BUSINESS LOGIC)
Located in `/src/routes/tenant/`:

**Core Clinical Module**
- `clinical/` - 13 clinical feature routes
  - `assessments.ts` - Clinical assessments
  - `care-plans.ts` - Care planning
  - `diagnosis.ts` - Diagnosis management
  - `diet.ts` - Diet management
  - `eye-exam.ts` - Eye examination
  - `forms.ts` - Custom clinical forms
  - `glucose.ts` - Glucose monitoring
  - `history.ts` - Clinical history
  - `problem-list.ts` - Problem lists
  - `ros.ts` - Review of systems
  - `sdoh.ts` - Social determinants of health
  - `index.ts` - Clinical root

**Patient Management**
- `patients.ts` - Patient CRUD
- `patientDuplicates.ts` - Duplicate detection/merge
- `patientReported.ts` - Patient-reported data
- `patientPortal.ts` - Patient portal
- `mpi.ts` - Master Patient Index
- `healthRecord.ts` - Health record management
- `medicalRecords.ts` - Medical records

**Visit Management**
- `visits.ts` - Visit management
- `appointments.ts` - Appointment scheduling
- `consultations.ts` - Consultation tracking
- `vitals.ts` - Vital signs
- `physicalExam.ts` - Physical examination
- `allergies.ts` - Allergy tracking
- `vaccinations.ts` - Vaccination records

**Billing & Finance** (19 route files)
- `billing.ts` - Main billing
- `billingMaster.ts` - Billing master data
- `billingCancellation.ts` - Billing cancellation
- `billingHandover.ts` - Billing handover
- `billingInsurance.ts` - Insurance billing
- `billingProvisional.ts` - Provisional billing
- `ipBilling.ts` - IPD billing
- `ipdCharges.ts` - IPD charges
- `feeSheet.ts` - Fee sheet management
- `deposits.ts` - Patient deposits
- `payments.ts` - Payment processing
- `accounting.ts` - General accounting
- `journal.ts` - Journal entries
- `income.ts` - Income tracking
- `expenses.ts` - Expense tracking
- `settlements.ts` - Settlement management
- `creditNotes.ts` - Credit notes
- `commissions.ts` - Doctor commissions
- `profit.ts` - Profit reporting

**Pharmacy Module** (2 routes)
- `pharmacy.ts` - Pharmacy management
- `prescriptions.ts` - Prescription management
- `ePrescribing.ts` - Electronic prescribing

**Laboratory Module** (4 routes)
- `lab.ts` - Lab orders and results
- `labSettings.ts` - Lab configuration
- `tests.ts` - Test management
- `requisitions.ts` - Lab requisitions

**Radiology Module** (5 routes)
- `radiology/` - Radiology operations
  - `index.ts` - Radiology root
  - `catalog.ts` - Radiology service catalog
  - `orders.ts` - Radiology orders
  - `reports.ts` - Radiology reports
  - `pacs.ts` - PACS integration

**Nursing Module** (12 routes)
- `nursing/` - Nursing operations
  - `index.ts` - Nursing root
  - `wards.ts` - Ward management
  - `mar.ts` - Medication administration record
  - `medication-orders.ts` - Medication orders
  - `medication-reconciliation.ts` - Med reconciliation
  - `iv-drugs.ts` - IV drug administration
  - `io-charts.ts` - Intake/output charts
  - `handover.ts` - Shift handover
  - `notes.ts` - Nursing notes
  - `care-plan.ts` - Nursing care plans
  - `opd.ts` - OPD nursing
  - `wound-care.ts` - Wound care
  - `monitoring.ts` - Patient monitoring

**HR & Staff Management** (6 routes)
- `hr/` - HR operations
  - `index.ts` - HR root
  - `attendance.ts` - Attendance tracking
  - `biometric.ts` - Biometric integration
  - `leave.ts` - Leave management
  - `payroll.ts` - Payroll processing
  - `roster.ts` - Duty roster
- `staff.ts` - Staff management
- `doctors.ts` - Doctor management
- `doctorSchedule.ts` - Doctor scheduling
- `doctorSchedules.ts` - Bulk doctor schedules
- `groupAttendance.ts` - Group attendance

**Inventory Module** (12 routes)
- `inventory/` - Inventory management
  - `index.ts` - Inventory root
  - `items.ts` - Item catalog
  - `stock.ts` - Stock tracking
  - `stores.ts` - Store management
  - `vendors.ts` - Vendor management
  - `po.ts` - Purchase orders
  - `rfq.ts` - RFQ management
  - `gr.ts` - Goods receipt
  - `req.ts` - Internal requisitions
  - `dispatch.ts` - Dispatch management
  - `return.ts` - Returns processing
  - `writeoff.ts` - Write-off management
  - `assets.ts` - Asset management
  - `settings.ts` - Inventory settings

**Operations & Facilities** (15 routes)
- `ot.ts` - Operation theatre
- `emergency.ts` - Emergency department
- `admissions.ts` - Admission management
- `housekeeping.ts` - Housekeeping
- `laundry.ts` - Laundry management
- `kitchen.ts` - Kitchen/diet management
- `cssd.ts` - Central sterile supply
- `ambulance.ts` - Ambulance service
- `mortuary.ts` - Mortuary management
- `biomedicalWaste.ts` - Biomedical waste
- `bloodBank.ts` - Blood bank
- `mlc.ts` - Medico-legal cases
- `dental.ts` - Dental operations
- `camos.ts` - CAMOS system
- `devices.ts` - Medical devices

**Quality & Compliance**
- `audit.ts` - Audit logs
- `mfa.ts` - Multi-factor authentication
- `priorAuth.ts` - Prior authorization
- `insurance.ts` - Insurance management
- `procedureOrders.ts` - Procedure orders

**Telemedicine & Remote**
- `telemedicine.ts` - Telemedicine
- `whatsapp.ts` - WhatsApp integration
- `push.ts` - Push notifications
- `pushNotifications.ts` - Push notification system

**Data & Reporting**
- `dashboard.ts` - Main dashboard
- `doctorDashboard.ts` - Doctor dashboard
- `reports.ts` - General reports
- `reportAppointment.ts` - Appointment reports
- `reportLab.ts` - Lab reports
- `reportPharmacy.ts` - Pharmacy reports
- `marketingReferral.ts` - Marketing/referral
- `recurring.ts` - Recurring charges
- `reminders.ts` - Appointment reminders
- `trackAnything.ts` - Generic tracking
- `questionnaires.ts` - Questionnaire system
- `visitPass.ts` - Visit passes

**Advanced Features**
- `ai.ts` - AI/ML features
- `ccda.ts` - C-CDA document generation
- `fhir.ts` - FHIR interoperability
- `bulk-fhir.ts` - Bulk FHIR operations
- `clinicalImages.ts` - Clinical image management
- `dictation.ts` - Voice dictation
- `dischargePlanning.ts` - Discharge planning
- `discharge.ts` - Discharge management
- `dischargeSummary.ts` - Discharge summaries
- `lbfForms.ts` - Custom forms
- `customForms.ts` - Form builder
- `printTemplates.ts` - Print templates
- `website.ts` - Website management
- `globalHealth.ts` - Global health data
- `invitations.ts` - User invitations
- `inbox.ts` - Messaging inbox

**Infrastructure**
- `queue.ts` - Job queue
- `branches.ts` - Branch management
- `nurseStation.ts` - Nurse station
- `inputOutput.ts` - I/O tracking
- `sharepoints.ts` - Resource sharing
- `settlements.ts` - Settlement processing
- `shareholders.ts` - Shareholder management
- `settings.ts` - System settings
- `accounts.ts` - User accounts
- `auth.ts` - Tenant auth

---

## 3. FRONTEND PAGES (177 PAGE FILES)

### **Location:** `/web/src/pages/`

**Authentication Pages**
- `Login.tsx`
- `AdminLogin.tsx`
- `DoctorLogin.tsx`
- `PatientLoginPage.tsx`
- `DoctorRegister.tsx`
- `HospitalSignup.tsx`
- `AcceptInvite.tsx`
- `InviteStaff.tsx`

**Dashboard Pages** (9)
- `HospitalAdminDashboard.tsx`
- `DoctorDashboard.tsx`
- `MDDashboard.tsx`
- `NursingDashboard.tsx`
- `LaboratoryDashboard.tsx`
- `PharmacyDashboard.tsx`
- `RadiologyDashboard.tsx`
- `ReceptionDashboard.tsx`
- `DirectorDashboard.tsx`
- `MultiBranchDashboard.tsx`

**Super Admin Pages** (4)
- `SuperAdminDashboard.tsx`
- `SuperAdminSettings.tsx`
- `SuperAdminHospitalList.tsx`
- `SuperAdminHospitalDetail.tsx`
- `SuperAdminHealth.tsx`
- `SuperAdminAuditLog.tsx`
- `SuperAdminOnboardingQueue.tsx`

**Patient Management** (9)
- `PatientList.tsx`
- `PatientDetail.tsx`
- `PatientForm.tsx`
- `PatientPortal.tsx`
- `PatientTimeline.tsx`
- `PatientOnboardingPage.tsx`
- `PatientChartWorkspace.tsx`
- `PatientChartPrint.tsx`
- `PatientDuplicates.tsx`

**Clinical Features** (13)
- `ClinicalAssessments.tsx`
- `ConsultationNotes.tsx`
- `CarePlansDashboard.tsx`
- `PhysicalExamDashboard.tsx`
- `EyeExamDashboard.tsx`
- `AllergiesPage.tsx`
- `VaccinationDashboard.tsx`
- `VitalsPage.tsx`
- `TrackAnythingDashboard.tsx`
- `TriageChatbot.tsx`
- `ImportExternalRecords.tsx`
- `HealthRecordSharing.tsx`

**Visit Management**
- `AppointmentScheduler.tsx`
- `DoctorSchedule.tsx`
- `ReportAppointmentPage.tsx`
- `QueueDisplay.tsx`
- `QueueManagement.tsx`

**Billing & Finance** (12)
- `BillingDashboard.tsx`
- `BillingMasterPage.tsx`
- `BillPrint.tsx`
- `BillCancellationPage.tsx`
- `BillingHandoverPage.tsx`
- `InsuranceBillingPage.tsx`
- `InsuranceClaims.tsx`
- `IPBillingPage.tsx`
- `ProvisionalBillingPage.tsx`
- `FeeSheet.tsx`
- `DepositsPage.tsx`
- `PaymentsPage.tsx`
- `SettlementsPage.tsx`

**Pharmacy Module** (19)
- Located in `/web/src/pages/pharmacy/`:
  - `PharmacyOverview.tsx`
  - `ItemList.tsx`
  - `ItemPriceHistory.tsx`
  - `GenericList.tsx`
  - `CategoryList.tsx`
  - `SupplierList.tsx`
  - `SupplierLedger.tsx`
  - `PurchaseOrderForm.tsx`
  - `PurchaseOrderList.tsx`
  - `GoodsReceiptForm.tsx`
  - `GoodsReceiptList.tsx`
  - `InvoiceForm.tsx`
  - `InvoiceList.tsx`
  - `InvoiceReceipt.tsx`
  - `DispatchList.tsx`
  - `StockList.tsx`
  - `DispensaryStock.tsx`
  - `NarcoticRegister.tsx`
  - `WriteOffList.tsx`
  - `ExpiryReport.tsx`
  - `StockReport.tsx`
  - `SalesReport.tsx`
  - `SettlementList.tsx`
  - `ApprovalQueuePage.tsx`
  - `DosageTemplatesPage.tsx`
  - `TaxConfigPage.tsx`
  - `PatientBillingPage.tsx`

**Laboratory Module**
- `LaboratoryDashboard.tsx`
- `LabTestOrderForm.tsx`
- `LabSettingsPage.tsx`
- `LabReportPrint.tsx`
- `ReportLabPage.tsx`
- `TestCatalog.tsx`

**Radiology Module**
- `RadiologyDashboard.tsx`

**Nursing Module**
- `NurseStation.tsx`

**HR & Staff Management** (6)
- `HRDashboard.tsx`
- `StaffPage.tsx`
- `AttendancePunch.tsx`
- `DutyRoster.tsx`
- `GroupAttendance.tsx`
- `EPrescribingDashboard.tsx`

**Inventory Module** (4)
- Located in `/web/src/pages/inventory/`:
  - [Various inventory pages]

**Operations & Facilities** (14)
- `AdmissionIPD.tsx`
- `BedManagement.tsx`
- `OTDashboard.tsx`
- `EmergencyDashboard.tsx`
- `HousekeepingManagement.tsx`
- `LaundryManagement.tsx`
- `KitchenManagement.tsx`
- `CssdManagement.tsx`
- `AmbulanceManagement.tsx`
- `MortuaryManagement.tsx`
- `BiomedicalWasteManagement.tsx`
- `BloodBankManagement.tsx`
- `MlcManagement.tsx`
- `AssetManagement.tsx`
- `DischargePlanningPage.tsx`
- `DischargeSummary.tsx`
- `IPDCharges.tsx`

**Advanced Features** (9)
- `AIAssistant.tsx`
- `DigitalPrescription.tsx`
- `QuestionnairesPage.tsx`
- `MedicineDispensing.tsx`
- `ProcedureOrdersDashboard.tsx`
- `PriorAuthDashboard.tsx`
- `Camos.tsx`
- `Dental.tsx`
- `Psychiatry.tsx`

**Telemedicine & Communication**
- `TelemedicineDashboard.tsx`
- `TelemedicineRoom.tsx`
- `WhatsAppDashboard.tsx`
- `NotificationsCenter.tsx`
- `InboxPage.tsx`

**Reporting** (2)
- `ReportsDashboard.tsx`
- `ReportPharmacyPage.tsx`

**Marketplace** (4)
- Located in `/web/src/pages/marketplace/`:
  - `DoctorDirectory.tsx`
  - `DoctorProfile.tsx`
  - `HospitalDirectory.tsx`
  - `HospitalProfile.tsx`
- `MarketplaceLanding.tsx`

**Website & Settings** (5)
- `WebsiteSettings.tsx`
- `SettingsPage.tsx`
- `PrintTemplateSettings.tsx`
- `CommissionManagement.tsx`
- `MarketingReferral.tsx`

**Accounting** (9)
- Located in `/web/src/pages/accounting/`:
  - `AccountingDashboard.tsx`
  - `ChartOfAccounts.tsx`
  - `JournalEntries.tsx`
  - `ExpenseList.tsx`
  - `IncomeList.tsx`
  - `RecurringExpenses.tsx`
  - `ProfitLoss.tsx`
  - `Reports.tsx`
  - `ShareholderManagement.tsx`
  - `AuditLogs.tsx`

**Other Pages**
- `HelpCenterPage.tsx`
- `SystemAuditLog.tsx`
- `MedicalRecordsDashboard.tsx`
- `CustomFormBuilder.tsx`

---

## 4. DATABASE MODELS/SCHEMAS (Drizzle ORM)

### **Schema Files Location:** `/src/db/schema/`

1. **schema.ts** - Main schema file containing all tables with fields:
   - Nursing tables (nur_*)
   - Medication administration records (MAR)
   - Care plans, notes, monitoring
   - IV drugs, intake/output charts
   
2. **clinicalMar.ts** - Clinical MAR (Medication Administration Record)
3. **mpi.ts** - Master Patient Index
4. **healthCards.ts** - Health card system
5. **terminology.ts** - Medical terminology/codes
6. **relations.ts** - Table relationships and foreign keys
7. **index.ts** - Barrel exports

### **Key Tables (from schema analysis):**

**Core Tables:**
- `patients` - Patient demographics
- `users` - System users
- `visits` - Patient visits
- `appointments` - Appointment scheduling
- `consultations` - Consultation records
- `admissions` - IPD admissions
- `beds` - Bed management
- `departments` - Hospital departments
- `staff` - Staff members
- `doctors` - Doctor profiles
- `wards` - Ward management

**Clinical Tables:**
- `nur_care_plans` - Nursing care plans
- `nur_notes` - Nursing notes
- `nur_medication_admin` - Medication administration
- `nur_intake_output` - I/O charts
- `nur_patient_monitoring` - Vital sign monitoring
- `nur_iv_drugs` - IV drug administration
- `clinical_assessments` - Clinical assessments
- `clinical_mar` - Clinical MAR
- `problem_list` - Problem lists
- `diagnoses` - ICD-10 diagnoses
- `allergies` - Patient allergies
- `vaccinations` - Vaccination records
- `vitals` - Vital signs
- `physical_exam` - Physical examination
- `patient_reported_data` - Patient-reported data
- `care_plans` - Care planning

**Pharmacy Tables:**
- `prescriptions` - Prescription records
- `prescription_items` - Prescription line items
- `master_drugs` - Drug catalog
- `pharmacy_sales` - Pharmacy sales
- `pharmacy_inventory` - Stock tracking
- `dispensary_stock` - Dispensary inventory

**Laboratory Tables:**
- `lab_orders` - Lab test orders
- `lab_results` - Test results
- `test_catalog` - Test catalog
- `lab_settings` - Lab configuration
- `loinc_codes` - Lab codes

**Radiology Tables:**
- `radiology_orders` - Radiology orders
- `radiology_reports` - Radiology reports
- `radiology_dicom` - DICOM image records
- `radiology_pacs` - PACS integration

**Billing Tables:**
- `billing` - Billing records
- `billing_items` - Bill line items
- `insurance_claims` - Insurance claims
- `payments` - Payment records
- `deposits` - Patient deposits
- `fee_sheet` - Service fees
- `provisional_billing` - Provisional bills

**HR Tables:**
- `attendance` - Attendance tracking
- `biometric_logs` - Biometric records
- `leaves` - Leave requests
- `payroll` - Payroll records
- `duty_roster` - Staff schedules

**Inventory Tables:**
- `inventory_items` - Item catalog
- `inventory_stock` - Stock levels
- `purchase_orders` - POs
- `goods_receipt` - GR records
- `vendors` - Vendor information
- `stores` - Store locations
- `asset_management` - Asset tracking

**Accounting Tables:**
- `chart_of_accounts` - Account hierarchy
- `journal_entries` - Journal posts
- `expenses` - Expense records
- `income` - Income records
- `shareholders` - Shareholder info
- `recurring_expenses` - Fixed expenses

**System Tables:**
- `audit_logs` - Audit trail
- `invitations` - User invitations
- `notifications` - System notifications
- `push_subscriptions` - Push notification subscriptions
- `user_accounts` - User account management
- `mfa` - Multi-factor authentication

**Global/Multi-Tenant Tables:**
- `tenants` - Hospital/organization records
- `mpi` - Master Patient Index (global)
- `health_cards` - Health card issuance
- `global_patient_links` - Patient record linking
- `patient_vault` - Secure patient vault
- `consent_records` - Consent management
- `global_family_links` - Family relationships
- `wellness_profiles` - Patient wellness data
- `food_system` - Nutrition/food tracking
- `wearable_data` - Wearable device integration

---

## 5. FRONTEND COMPONENTS (39 COMPONENT FILES)

### **Location:** `/web/src/components/`

**Component Categories:**

1. **Clinical Components** (`/components/clinical/`)
   - Assessment components
   - Care plan components
   - Diagnosis components
   - Clinical forms

2. **Dashboard Components** (`/components/dashboard/`)
   - Dashboard widgets
   - Charts and analytics
   - Key metrics

3. **Nursing Components** (`/components/nursing/`)
   - Care plan UI
   - Medication administration
   - Patient monitoring

4. **Radiology Components** (`/components/radiology/`)
   - DICOM viewer
   - Radiology UI elements

5. **Marketplace Components** (`/components/marketplace/`)
   - Doctor/hospital listings
   - Booking interfaces

6. **Shareholder Components** (`/components/shareholders/`)
   - Profit distribution UI
   - Financial reporting

---

## 6. MIGRATION FILES (153 MIGRATIONS)

### **Location:** `/migrations/`

**Migration Categories:**

#### **Foundation Migrations (0001-0020)**
- 0001: Fix schema, add missing tables
- 0002: Invitations system
- 0003: ICD-10 to visits
- 0004: Payment gateway
- 0005: Multi-branch support
- 0006: Telemedicine
- 0007: Appointments
- 0008: Prescriptions
- 0009: Prescriptions unique RxNo
- 0010: Lab order clinical fields
- 0011: Prescription dispense status
- 0012: Admissions & beds
- 0013: Notifications
- 0014: Patient vitals
- 0015: Discharge summaries
- 0016: IPD charges
- 0017: Insurance
- 0018: Vitals alerts
- 0019: Prescription sharing
- 0020: AI memory

#### **Pharmacy & Operations (0020-0050)**
- 0020: Pharmacy sales
- 0021: Push subscriptions
- 0022: Lab enhancements
- 0023: Onboarding queue
- 0024: Patient portal
- 0025: Patient portal v2
- 0026: Lab critical thresholds
- 0027: Fix insurance claims FK
- 0028: Subscriptions
- 0029: Hospital website
- 0030: Website analytics
- 0031: Website analytics subdomain
- 0032: Emergency department
- 0033: Operation theatre
- 0034: Clinical enhancements
- 0035: Advanced billing
- 0035b: Billing alter columns
- 0036: Enhance shareholders
- 0037: Inventory (major)
- 0038: Patient missing columns

#### **Specializations & Modules (0040-0100)**
- 0040: Visits missing columns
- 0041: Visits emergency type
- 0042: Billing master data
- 0043: Lab settings
- 0044: Insurance billing depth
- 0045: Fix shareholders constraints
- 0046: Fix shareholder distributions
- 0047: Nursing module
- 0048: e-Prescribing
- 0049: HR module
- 0049: Performance indexes
- 0050: Clinical assessments
- 0050: Clinical MAR
- 0050: Medical records
- 0051: MR cert unique
- 0052: Clinical MAR audit
- 0053: Radiology
- 0054: Radiology fixes
- 0055: Pharmacy v2
- 0055: Radiology DICOM unique
- 0060: Master drugs schema
- 0061: Master drugs data
- 0063: Pharmacy tax config
- 0064: Pharmacy phase3
- 0065: Invitation auth hardening
- 0066: LIS enterprise
- 0067: Patient magic links
- 0068: Bengali intake/emergency
- 0069: Blog/reviews/departments
- 0070: Custom domains
- 0071: SOAP templates/vaccination
- 0072: Portable health records
- 0073: Clinical forms
- 0073: UHID system
- 0074-0077: Tier 1-4 ports (legacy system conversion)
- 0078: Duty roster biometric
- 0079: OPD queue tokens
- 0080: Asset management/AMC
- 0081: Kitchen management
- 0082: Blood bank
- 0083: Medico-legal cases
- 0084: CSSD (sterile supply)
- 0085: MFA/TOTP
- 0086: Laundry
- 0087: Housekeeping
- 0088: Ambulance
- 0089: Mortuary
- 0090: Patient duplicate merge
- 0091: WhatsApp messaging
- 0092: Global patient auth
- 0092: Print templates
- 0093: Discharge planning
- 0093: Patient auth hardening
- 0094: Biomedical waste
- 0095: B2C patient vault
- 0096: Consent model v2
- 0097: Central terminology
- 0098: Terminology seed data
- 0099: MPI hardening

#### **Global Health & Advanced Features (0100-0142)**
- 0100: Unmerge columns
- 0101: Health cards
- 0102: Lab LOINC
- 0103: Merge map
- 0104: Consent clinical areas
- 0105: Global identity claims
- 0106: Global identity nullable
- 0107: Patient claim codes
- 0108: Clinical review status
- 0108: Consent purpose defaults
- 0109: Patient reported experience
- 0110: Patient visit passes
- 0111: Global family links
- 0112: Global family proxy invites
- 0113: Patient vault R2 uploads
- 0114: Wallet export snapshots
- 0115: Clinical provenance sources
- 0116: Global patient vitals
- 0117: Global identity nullable (prod hotfix)
- 0118: Marketplace tenant columns
- 0118: Patient AI plans
- 0119: Marketplace doctor columns
- 0119: Patient AI plan progress
- 0120: Marketplace bookings
- 0121: Provider reviews
- 0122: Doctor auth
- 0123: Marketplace indexes
- 0124: Lifestyle water & medicine
- 0125: Master drugs nocase indexes
- 0126: Patient medicine reminder strength
- 0127: Health tips feedback analytics
- 0128: Global patient reported data bootstrap
- 0129: Wellness profile
- 0130: Wellness logs
- 0131: Food system
- 0132: AI insights
- 0133: Hospital linking
- 0134: User devices
- 0135: Barcode foods
- 0136: Wearable samples
- 0137: Mental health screenings
- 0138: Cycle meditation
- 0139: Walking challenges
- 0140: Onboarding progress
- 0141: Patient amendments
- 0142: Patient devices

#### **Seed Data**
- `seed_demo.sql` - Demo data
- `seed_demo_extended.sql` - Extended demo
- `seed_pharmacy_demo.sql` - Pharmacy demo
- `seed_pharmacy_stock_fill.sql` - Stock initialization

---

## 7. FEATURE AREAS ORGANIZED BY MODULE

### **A. CLINICAL MODULE**
✅ **Status:** Core implementation  
**Features:**
- SOAP notes (Subjective, Objective, Assessment, Plan)
- Problem lists (ICD-10 coded)
- Diagnosis management
- Vital signs tracking
- Physical examination records
- Assessment forms
- Care plans (nurse & doctor)
- Medication records
- Consultation tracking
- Clinical history (past, family, social)
- Review of systems (ROS)
- SDOH (Social Determinants)
- Clinical review status tracking
- Patient-reported data integration
- Consent management for clinical areas

### **B. NURSING MODULE**
✅ **Status:** Comprehensive  
**Features:**
- Care planning (NCP)
- Nursing notes (multiple types)
- Medication administration records (MAR)
- Medication orders
- IV drug administration
- Intake/output charts
- Patient monitoring (vitals tracking)
- Wound care
- Shift handovers
- Medication reconciliation
- Patient notifications
- Ward management

### **C. PHARMACY MODULE**
✅ **Status:** Tier 1 implementation  
**Features:**
- Prescription management
- e-Prescribing with digital signatures
- Drug dispensing
- Pharmacy inventory
- Stock tracking (auto & manual)
- Supplier management
- Purchase orders (PO)
- Goods receipt (GR)
- Invoice management
- Narcotics register
- Expiry management
- Tax configuration
- Discounts & promotions
- Patient billing integration
- Prescription safety checks
- Drug interaction checking
- Master drugs database
- Dosage templates

### **D. LABORATORY MODULE**
✅ **Status:** Tier 1 with LIS  
**Features:**
- Lab test ordering
- Test catalog management
- Lab results entry
- Critical value alerts
- LOINC code integration
- Lab settings/reference ranges
- Lab settings management
- Report generation
- Patient result sharing
- Requisition tracking

### **E. RADIOLOGY MODULE**
✅ **Status:** PACS integrated  
**Features:**
- Radiology order management
- Service catalog
- Report generation
- DICOM image management
- PACS integration
- Image viewing
- Multi-modality support

### **F. BILLING & FINANCE MODULE**
✅ **Status:** Comprehensive  
**Features:**
- Patient billing
- Insurance billing
- IPD charges
- OPD fee sheets
- Provisional billing
- Advance deposits
- Payment processing
- Payment gateway integration (bKash, Nagad)
- Bill cancellation
- Bill handover
- Prior authorization
- Credit notes
- Settlements
- Multi-currency support
- Accounts receivable

### **G. ACCOUNTING MODULE**
✅ **Status:** Full  
**Features:**
- Chart of accounts
- Journal entries
- Income tracking
- Expense management
- Recurring expenses
- Profit & loss reporting
- Doctor commissions
- Shareholder management
- Profit distribution
- Audit logs
- Multi-tenant accounting

### **H. HR & PAYROLL MODULE**
✅ **Status:** Full  
**Features:**
- Staff management
- Attendance tracking
- Biometric integration
- Leave management (multiple types)
- Duty roster scheduling
- Payroll processing
- Group attendance
- Doctor schedule management

### **I. INVENTORY MODULE**
✅ **Status:** Comprehensive  
**Features:**
- Item catalog management
- Stock tracking
- Store management
- Vendor management
- Purchase orders
- RFQ (Request for Quote)
- Goods receipt
- Internal requisitions
- Dispatch management
- Return processing
- Write-off management
- Asset management
- AMC (Annual Maintenance Contract) tracking
- Inventory analytics
- Performance indexes

### **J. OPERATIONS & FACILITIES**
✅ **Status:** Modular  
**Departments:**
- Operation Theatre (OT)
  - Theatre scheduling
  - Procedure orders
  - Instrument tracking
- Emergency Department
  - Triage system
  - Queue management
  - Emergency admission
- Admissions & Beds
  - Admission management
  - Bed allocation
  - Bed availability
  - ICU/HDU tracking
- Ward Management
  - Ward structure
  - Patient transfers
  - Ward reports
- Additional Services:
  - Housekeeping management
  - Laundry management
  - Kitchen/Diet management
  - CSSD (Central Sterile Supply)
  - Ambulance service
  - Mortuary management
  - Biomedical waste management
  - Blood bank

### **K. PATIENT MANAGEMENT**
✅ **Status:** Advanced  
**Features:**
- Patient registration
- Demographics management
- MPI (Master Patient Index)
- Patient portals
- Health record access
- Duplicate detection & merge
- Patient amendments
- Global patient identity
- Family linking
- Proxy access (family representatives)
- Patient-reported data

### **J. MARKETPLACE & B2C**
✅ **Status:** Implemented  
**Features:**
- Doctor directory
- Hospital directory
- Doctor profiles & reviews
- Appointment booking
- Telemedicine scheduling
- Provider reviews & ratings
- Marketplace indexes

### **L. TELEMEDICINE**
✅ **Status:** Active  
**Features:**
- Video consultations
- Telemedicine room/session management
- Remote patient monitoring
- Digital prescriptions
- Prescription sharing

### **M. WELLNESS & LIFESTYLE**
✅ **Status:** Emerging  
**Features:**
- Wellness profiles
- Lifestyle tracking
- Wellness logs
- Food system (nutrition tracking)
- Barcode scanning for foods
- Wearable device integration
- Mental health screenings
- Meditation/mindfulness (cycle meditation)
- Walking challenges
- Health tips & feedback
- AI health insights
- Medicine reminders

### **N. AI & INTELLIGENCE**
✅ **Status:** Integrated  
**Features:**
- AI-powered insights
- Health tips & recommendations
- Patient AI plans
- Plan progress tracking
- Predictive analytics
- Clinical decision support
- AI memory system

### **O. COMMUNICATION**
✅ **Status:** Multi-channel  
**Features:**
- WhatsApp integration
- Push notifications
- SMS notifications (implied)
- Email notifications
- In-app messaging
- Patient portal messaging
- Notification preferences

### **P. QUALITY & COMPLIANCE**
✅ **Status:** Comprehensive  
**Features:**
- FHIR interoperability
- C-CDA document generation
- Bulk FHIR export
- Audit logging (comprehensive)
- Multi-factor authentication (TOTP)
- Consent management (consent model v2)
- Data governance
- Patient privacy controls
- Portable health records
- Health cards (national ID integration)

### **Q. MULTI-TENANT & ENTERPRISE**
✅ **Status:** Full  
**Features:**
- Multi-branch support
- Custom domains per hospital
- Tenant isolation
- Global patient linking
- Cross-hospital patient records
- Hospital website hosting
- Custom branding/themes
- Website analytics

### **R. REPORTING & ANALYTICS**
✅ **Status:** Extensive  
**Features:**
- Dashboard analytics
- Custom reports
- Appointment reports
- Lab reports
- Pharmacy reports
- Financial reports
- Attendance reports
- Audit reports
- Export capabilities

### **S. WEBSITE & PUBLIC PORTAL**
✅ **Status:** Full  
**Features:**
- Hospital website builder
- Custom domains
- Multiple themes (11 themes available)
- Content management
- Online registration
- Appointment booking
- Patient portal
- Website analytics

---

## 8. TECHNOLOGY STACK

**Backend:**
- Cloudflare Workers (edge computing)
- Drizzle ORM (database)
- SQLite (database engine)
- TypeScript

**Frontend:**
- React
- TypeScript
- Capacitor (mobile wrapper)
- Playwright (E2E testing)

**Mobile:**
- iOS (Capacitor)
- Android (Capacitor)

**Infrastructure:**
- Cloudflare (CDN, Workers, R2, D1)
- Multi-tenant architecture
- Wrangler (Cloudflare CLI)

**Database:**
- D1 (Cloudflare's SQLite)
- 153 migrations tracking evolution

**APIs & Integrations:**
- FHIR (HL7 interoperability)
- C-CDA (Clinical Document Architecture)
- Payment gateways (bKash, Nagad)
- WhatsApp Business API
- PACS (Radiology systems)
- Wearable device APIs

---

## 9. SUMMARY STATISTICS

| Metric | Count |
|--------|-------|
| Backend Route Files | 203 |
| Frontend Page Files | 177 |
| Component Files | 39 |
| Database Schema Files | 7 |
| Migration Files | 153 |
| **Total Feature Modules** | **18+** |
| **Total Database Tables** | **100+** |
| **Total Pages/Screens** | **177+** |

---

## 10. KEY OBSERVATIONS

### **Strengths:**
1. **Comprehensive Coverage** - Covers nearly all hospital operations
2. **Modular Architecture** - Well-organized by feature/department
3. **Enterprise Features** - Multi-tenant, multi-branch, global patient records
4. **Compliance-Focused** - FHIR, C-CDA, audit trails, consent management
5. **Modern Stack** - Edge computing, real-time capabilities
6. **Scalability** - Cloudflare's global infrastructure

### **Key Capabilities:**
- ✅ Complete EHR/EMR
- ✅ Full accounting & billing
- ✅ Inventory management
- ✅ HR/Payroll
- ✅ PACS integration (Radiology)
- ✅ LIS integration (Lab)
- ✅ Multi-channel communication
- ✅ Global health records
- ✅ Telemedicine
- ✅ B2B Marketplace
- ✅ B2C Patient portal
- ✅ AI-powered insights
- ✅ Wellness tracking

### **Architecture Highlights:**
- Multi-tenant from core
- Global patient identity system
- Hierarchical consent management
- FHIR-first data model
- Portable health records
- Cross-hospital patient linking

---

## FILE STRUCTURE REFERENCE

```
/src
├── routes/              # Backend API routes (203 files)
│   ├── admin/
│   ├── public/
│   ├── tenant/          # Main business logic
│   └── ...
├── db/
│   ├── schema/          # Database models (7 files)
│   └── ...
├── middleware/          # Auth, validation, etc.
├── utils/               # Helper functions
├── lib/                 # Shared libraries
└── do/                  # Durable Objects

/web/src
├── pages/               # Frontend pages (177 files)
├── components/          # React components (39 files)
├── hooks/               # Custom React hooks
├── lib/                 # Web utilities
├── utils/               # Helper functions
└── data/                # Static data

/migrations             # SQL migrations (153 files)
```

---

**End of Analysis**
