# HMS Backend Routes - Complete Reference

## Route File Organization

### Total: 203 Route Files

---

## ROUTES BY CATEGORY

### 1. AUTHENTICATION & ONBOARDING (9 routes)
```
/src/routes/
├── admin/auth.ts                    → Admin authentication
├── admin/index.ts                   → Admin endpoints root
├── doctor-auth.ts                   → Doctor authentication & registration
├── patient-auth.ts                  → Patient authentication
├── login-direct.ts                  → Direct login (bypass invite)
├── register.ts                      → Hospital/user registration
├── init.ts                          → System initialization
├── seed.ts                          → Database seeding
└── onboarding.ts                    → Hospital onboarding workflow
```

### 2. PUBLIC & PORTAL ROUTES (8 routes)
```
/src/routes/
├── public/
│   ├── healthRecord.ts              → Public health record access
│   ├── hospitalSite.ts              → Hospital information
│   └── themes/ (11 theme files)     → Website themes
│       ├── index.ts
│       ├── base.ts
│       ├── minimal.ts
│       ├── nature.ts
│       ├── oceanic.ts
│       ├── sunrise.ts
│       ├── heritage.ts
│       ├── arogyaseva.ts
│       ├── carefirst.ts
│       ├── medtrust.ts
│       └── [more themes]
├── patient-phr.ts                   → Patient health records portal
├── patient-card.ts                  → Patient card system
├── patient-amendments.ts            → Patient record amendments
├── global-portal.ts                 → Global patient portal
├── public-invite.ts                 → Public invitations
└── marketplace.ts                   → Marketplace platform
```

### 3. MARKETPLACE ROUTES (3 routes)
```
/src/routes/
├── marketplace.ts                   → Main marketplace
├── marketplace-admin.ts             → Admin marketplace functions
└── marketplace-patient.ts           → Patient marketplace interface
```

### 4. MISC FEATURES (5 routes)
```
/src/routes/
├── hospital-links.ts                → Hospital linking system
├── food.ts                          → Food/nutrition system
├── wellness.ts                      → Wellness programs
├── notifications.ts                 → Notification management (global)
└── invitations.ts                   → Invitation system
```

---

## TENANT ROUTES (169 routes in /src/routes/tenant/)

### CLINICAL MODULE (13 routes)
```
clinical/
├── index.ts                         → Clinical root/dispatcher
├── assessments.ts                   → Clinical assessments
├── care-plans.ts                    → Care plan management
├── diagnosis.ts                     → Diagnosis management (ICD-10)
├── diet.ts                          → Diet/nutrition management
├── eye-exam.ts                      → Ophthalmology/eye exams
├── forms.ts                         → Custom clinical forms
├── glucose.ts                       → Glucose monitoring
├── history.ts                       → Clinical history (H&P, family, social)
├── problem-list.ts                  → Problem list management
├── ros.ts                           → Review of systems
└── sdoh.ts                          → Social determinants of health
```

### PATIENT MANAGEMENT (7 routes)
```
├── patients.ts                      → Patient CRUD operations
├── patientDuplicates.ts             → Duplicate detection & merge
├── patientReported.ts               → Patient-reported data
├── patientPortal.ts                 → Patient portal interface
├── mpi.ts                           → Master Patient Index (global)
├── healthRecord.ts                  → Health record management
└── medicalRecords.ts                → Medical records archival
```

### VISIT & CONSULTATION MANAGEMENT (7 routes)
```
├── visits.ts                        → Visit management (all types)
├── appointments.ts                  → Appointment scheduling
├── consultations.ts                 → Consultation records
├── vitals.ts                        → Vital signs tracking
├── physicalExam.ts                  → Physical examination records
├── allergies.ts                     → Allergy management
└── vaccinations.ts                  → Vaccination records
```

### BILLING & FINANCE (19 routes)
```
├── billing.ts                       → Main billing engine
├── billingMaster.ts                 → Billing master data configuration
├── billingCancellation.ts           → Bill cancellation process
├── billingHandover.ts               → Billing handover between users
├── billingInsurance.ts              → Insurance billing workflow
├── billingProvisional.ts            → Provisional/advance billing
├── ipBilling.ts                     → Inpatient billing
├── ipdCharges.ts                    → IPD room/bed charges
├── feeSheet.ts                      → Service fee sheet
├── deposits.ts                      → Patient deposit management
├── payments.ts                      → Payment processing & receipts
├── accounting.ts                    → General accounting
├── journal.ts                       → Journal entries posting
├── income.ts                        → Income tracking
├── expenses.ts                      → Expense management
├── settlements.ts                   → Settlement processing
├── creditNotes.ts                   → Credit note issuance
├── commissions.ts                   → Doctor commission calculation
└── profit.ts                        → Profit reporting & analysis
```

### PHARMACY MODULE (3 routes)
```
├── pharmacy.ts                      → Pharmacy operations
├── prescriptions.ts                 → Prescription management
└── ePrescribing.ts                  → Electronic prescribing system
```

### LABORATORY MODULE (4 routes)
```
├── lab.ts                           → Lab test orders & results
├── labSettings.ts                   → Lab configuration & parameters
├── tests.ts                         → Test catalog management
└── requisitions.ts                  → Lab requisition tracking
```

### RADIOLOGY MODULE (5 routes)
```
radiology/
├── index.ts                         → Radiology dispatcher
├── catalog.ts                       → Radiology service catalog
├── orders.ts                        → Radiology order management
├── reports.ts                       → Radiology report generation
└── pacs.ts                          → PACS integration & imaging
```

### NURSING MODULE (12 routes)
```
nursing/
├── index.ts                         → Nursing dispatcher
├── wards.ts                         → Ward management & assignments
├── mar.ts                           → Medication Administration Record
├── medication-orders.ts             → Medication order management
├── medication-reconciliation.ts     → Medication reconciliation workflow
├── iv-drugs.ts                      → IV drug administration tracking
├── io-charts.ts                     → Intake/Output charting
├── handover.ts                      → Shift handover communication
├── notes.ts                         → Nursing notes (various types)
├── care-plan.ts                     → Nursing care plans
├── opd.ts                           → OPD nursing operations
├── wound-care.ts                    → Wound care management
└── monitoring.ts                    → Patient vital monitoring
```

### HR & STAFF MANAGEMENT (6 routes)
```
hr/
├── index.ts                         → HR dispatcher
├── attendance.ts                    → Attendance tracking & punch
├── biometric.ts                     → Biometric device integration
├── leave.ts                         → Leave request & approval
├── payroll.ts                       → Payroll processing
└── roster.ts                        → Duty roster scheduling
```

Also in root:
```
├── staff.ts                         → Staff directory
├── doctors.ts                       → Doctor profiles & credentials
├── doctorSchedule.ts                → Doctor schedule management
├── doctorSchedules.ts               → Bulk doctor scheduling
└── groupAttendance.ts               → Group attendance tracking
```

### INVENTORY MODULE (12 routes)
```
inventory/
├── index.ts                         → Inventory dispatcher
├── items.ts                         → Item catalog management
├── stock.ts                         → Stock level tracking
├── stores.ts                        → Store/warehouse management
├── vendors.ts                       → Vendor management
├── po.ts                            → Purchase order management
├── rfq.ts                           → Request for Quote
├── gr.ts                            → Goods receipt processing
├── req.ts                           → Internal requisitions
├── dispatch.ts                      → Inventory dispatch
├── return.ts                        → Returns & adjustments
├── writeoff.ts                      → Write-off management
├── assets.ts                        → Asset management & tracking
└── settings.ts                      → Inventory configuration
```

### OPERATIONS & FACILITIES (15 routes)
```
├── ot.ts                            → Operation Theatre
├── emergency.ts                     → Emergency Department
├── admissions.ts                    → Admission management
├── housekeeping.ts                  → Housekeeping operations
├── laundry.ts                       → Laundry management
├── kitchen.ts                       → Kitchen/diet management
├── cssd.ts                          → Central Sterile Supply
├── ambulance.ts                     → Ambulance service
├── mortuary.ts                      → Mortuary management
├── biomedicalWaste.ts               → Biomedical waste tracking
├── bloodBank.ts                     → Blood bank operations
├── mlc.ts                           → Medico-legal cases
├── dental.ts                        → Dental operations
├── camos.ts                         → CAMOS system
└── devices.ts                       → Medical device tracking
```

### QUALITY & COMPLIANCE (5 routes)
```
├── audit.ts                         → Audit logging & compliance
├── mfa.ts                           → Multi-factor authentication
├── priorAuth.ts                     → Prior authorization tracking
├── insurance.ts                     → Insurance management
└── procedureOrders.ts               → Procedure order management
```

### TELEMEDICINE & COMMUNICATION (4 routes)
```
├── telemedicine.ts                  → Telemedicine consultations
├── whatsapp.ts                      → WhatsApp integration
├── push.ts                          → Push notification management
└── pushNotifications.ts             → Push notification system
```

### DATA & REPORTING (10 routes)
```
├── dashboard.ts                     → Main dashboard
├── doctorDashboard.ts               → Doctor dashboard
├── reports.ts                       → General reporting engine
├── reportAppointment.ts             → Appointment reports
├── reportLab.ts                     → Lab reports
├── reportPharmacy.ts                → Pharmacy reports
├── marketingReferral.ts             → Referral tracking
├── recurring.ts                     → Recurring charges
├── reminders.ts                     → Appointment reminders
├── trackAnything.ts                 → Generic tracking system
├── questionnaires.ts                → Questionnaire system
└── visitPass.ts                     → Visit pass generation
```

### ADVANCED FEATURES (8 routes)
```
├── ai.ts                            → AI/ML features & insights
├── ccda.ts                          → C-CDA document generation
├── fhir.ts                          → FHIR API endpoints
├── bulk-fhir.ts                     → Bulk FHIR export/import
├── clinicalImages.ts                → Clinical image management
├── dictation.ts                     → Voice dictation system
├── dischargePlanning.ts             → Discharge planning
├── discharge.ts                     → Discharge processing
├── lbfForms.ts                      → Lab-based forms
└── printTemplates.ts                → Print template management
```

### INFRASTRUCTURE & ADMIN (10 routes)
```
├── queue.ts                         → Job queue management
├── branches.ts                      → Branch/location management
├── nurseStation.ts                  → Nurse station operations
├── inputOutput.ts                   → I/O tracking
├── sharepoints.ts                   → Resource sharing
├── settlements.ts                   → Financial settlement
├── shareholders.ts                  → Shareholder management
├── settings.ts                      → System settings
├── accounts.ts                      → User account management
├── auth.ts                          → Tenant authentication
└── website.ts                       → Hospital website management
```

### MISC TENANT ROUTES (5 routes)
```
├── globalHealth.ts                  → Global health data aggregation
├── invitations.ts                   → User invitations
├── inbox.ts                         → Message inbox
├── notifications.ts                 → Notification dispatch
└── customForms.ts                   → Dynamic form builder
```

---

## ROUTE FILE STATISTICS

| Category | Count |
|----------|-------|
| Authentication | 9 |
| Clinical | 13 |
| Patient Management | 7 |
| Visit Management | 7 |
| Billing & Finance | 19 |
| Pharmacy | 3 |
| Laboratory | 4 |
| Radiology | 5 |
| Nursing | 12 |
| HR & Staff | 6 |
| Inventory | 14 |
| Operations | 15 |
| Quality & Compliance | 5 |
| Telemedicine | 4 |
| Reporting | 10 |
| Advanced Features | 8 |
| Infrastructure | 10 |
| Other | 5 |
| **TOTAL** | **203** |

---

## API DESIGN PATTERNS

All routes follow these patterns:

1. **CRUD Operations**: GET, POST, PUT, DELETE for list, create, update, delete
2. **Authentication**: Bearer token validation, role-based access control (RBAC)
3. **Multi-tenancy**: All routes isolated by tenantId
4. **Pagination**: List endpoints support offset/limit
5. **Error Handling**: Standard error response format
6. **Validation**: Zod schemas for request validation

---

## MIDDLEWARE STACK

- Authentication/Authorization
- Tenant isolation
- Rate limiting (implied)
- CORS handling
- Request validation
- Error handling
- Audit logging

---

## DATABASE INTEGRATION

- Drizzle ORM with SQLite (D1)
- 153 migrations covering schema evolution
- Comprehensive indexes for performance
- Foreign key relationships
- Check constraints for data integrity

