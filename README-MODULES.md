# Ozzyl HMS — Master Module & System Inventory

> **Project:** ozzyl-hms (Hospital Management System) — multi-tenant SaaS
> **Generated:** 2026-06-12
> **Stack:** Hono + Cloudflare Workers · D1 (SQLite) · React 19 + Vite · TanStack Query · Cloudflare R2 / KV / Vectorize · Drizzle ORM · pnpm workspace
> **Live:** https://hms-saas-production.rahmatullahzisan.workers.dev
> **Repo:** /Users/rahmatullahzisan/Desktop/Dev/hms
>
> This document is a **complete inventory** of every module, sub-module, route, page, component, schema file, and infrastructure asset in the project. It is the source of truth for the system-review work tracked in `REVIEW.md`.

---

## How to read this file

- Each **Module** is a top-level business capability.
- Sub-sections break the module into **backend routes** (`src/routes/...`), **frontend pages** (`web/src/pages/...`), **shared libraries** (`src/lib/...`), **DB tables** (in Drizzle schema), **tests** (`test/...`), and **UI components** (`web/src/components/...`).
- File paths are **relative to repo root** unless an absolute path is given.

---

## 0. Workspace & Repository Layout

The repo is a **pnpm monorepo**:

```
hms/
├── src/                 # Cloudflare Worker backend (Hono) — single Worker, all routes
├── web/                 # Tenant + patient + doctor React app
├── admin-panel/         # Super-admin React app (separate Vite build)
├── apps/
│   ├── api/             # Additional backend (older split — see apps/api)
│   ├── ozzyl-lifestyle/ # Patient PWA / lifestyle app
│   └── ozzyl_health/    # Flutter mobile app (Android + iOS)
├── packages/
│   ├── shared/          # Shared TS package
│   └── ozzyl_core/      # Dart core package for Flutter
├── migrations/          # 346 SQL migration files (D1)
├── landing/             # Marketing site (Astro)
├── docs/                # 40+ design / status docs
├── load-tests/          # k6 load / smoke / stress scripts
├── scripts/             # Build + local-server + deploy helpers
├── tools/               # DICOM / HL7 / lab-middleware helper agents
├── plugins/             # Plugin modules
├── design-system/       # Design system source
├── data/                # Generated schema manifest
├── test/                # 330+ Vitest test files
├── drizzle/             # Drizzle ORM config
├── wrangler.toml        # Cloudflare Worker config
├── tenant-schema.sql    # Full tenant schema dump
├── package.json         # Root pnpm scripts
├── CLAUDE.md            # Project memory
└── pnpm-workspace.yaml
```

**Workspace packages (`pnpm-workspace.yaml`):**
- `web`
- `admin-panel`
- `apps/api`
- `apps/ozzyl-lifestyle`
- `packages/*`

---

## 1. Auth & Session Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/login-direct.ts`, `src/routes/register.ts`, `src/routes/doctor-auth.ts`, `src/routes/patient-auth.ts`, `src/routes/tenant/auth.ts`, `src/routes/admin/index.ts`, `src/routes/public-invite.ts` | Email + password login, slug-free login, doctor login, patient login, super-admin login, invitation acceptance, hospital self-signup |
| Middleware | `src/middleware/auth.ts`, `src/middleware/tenant.ts`, `src/middleware/rbac.ts`, `src/middleware/csrf.ts`, `src/middleware/subscription.ts`, `src/middleware/ai-guard.ts` | JWT validation, tenant resolution, RBAC, CSRF, subscription gating, AI access control |
| Pages | `web/src/pages/Login.tsx`, `AdminLogin.tsx`, `DoctorLogin.tsx`, `PatientLoginPage.tsx`, `DoctorRegister.tsx`, `HospitalSignup.tsx`, `AcceptInvite.tsx`, `InviteStaff.tsx`, `MfaSetup.tsx` | All login / register / invite UIs |
| Components | `web/src/components/ProtectedRoute.tsx`, `ImpersonationBanner.tsx` | Route guard, super-admin impersonation banner |
| Libraries | `src/lib/password.ts`, `src/lib/refresh-token.ts`, `src/lib/token-blacklist.ts`, `src/lib/otp.ts`, `src/lib/session.ts` (web), `src/lib/authSession.ts` (web) | bcrypt hashing, JWT rotation, OTP / TOTP, MFA, session storage |
| MFA | `src/routes/tenant/mfa.ts` | TOTP / MFA setup + verify |
| Tests | `test/auth.test.ts`, `authz.test.ts`, `admin-auth-boundary.test.ts`, `doctor-auth.test.ts`, `doctor-auth-timing.test.ts`, `patient-auth-otp.test.ts`, `patient-auth-rate-limit.test.ts`, `mfa.test.ts` | — |

**Features:** slug-free & slug-based login, JWT (8h), bcrypt 10 rounds, MFA/TOTP, super-admin impersonation, CSRF origin guard, RBAC 7-tier + dynamic permissions, refresh tokens, rate limit (KV-based).

---

## 2. Patient Management Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/patients.ts`, `patients-chart.ts`, `patients-summary.ts`, `patients-timeline.ts`, `patients-soap-templates.ts`, `patientDuplicates.ts`, `patientPortal.ts`, `patientHospitalLinks.ts`, `patientReported.ts`, `mpi.ts`, `healthRecord.ts`, `medicalRecords.ts`, `patients-soap-templates.ts` | CRUD, photo upload, timeline, chart, portal, duplicate detection, MPI, SOAP templates |
| Patient portal | `src/routes/patient-auth.ts`, `patient-phr.ts`, `patient-card.ts`, `patient-amendments.ts`, `global-portal.ts` | PHR (personal health record), patient card, amendment workflow |
| Frontend pages | `web/src/pages/PatientList.tsx`, `PatientDetail.tsx`, `PatientForm.tsx`, `PatientPortal.tsx`, `PatientTimeline.tsx`, `PatientOnboardingPage.tsx`, `PatientChartWorkspace.tsx`, `PatientChartPrint.tsx`, `PatientDuplicates.tsx`, `PatientCardScanner.tsx`, `PatientSnapshot.tsx`, `web/src/pages/doctor/PatientOverview.tsx`, `IPDWorkspace.tsx`, `OPDRecord.tsx`, `VisitSummary.tsx` | List, detail, form, portal, timeline, chart, scanner |
| Components | `web/src/components/clinical/PatientEmrHeader.tsx`, `TimelineEventExpandable.tsx`, `TransposedVitalsTable.tsx`, `UnifiedFilterBar.tsx`, `web/src/components/doctor/PatientHeader.tsx`, `PatientAIWidget.tsx`, `PatientLabTrendsPanel.tsx`, `PatientDrawer.tsx` | EMR header, AI summary widget, lab trends, drawer |
| Libraries | `src/lib/uhid.ts`, `src/lib/patient-age.ts`, `src/lib/mpi-scoring.ts`, `src/lib/global-identity.ts`, `src/lib/parent-visit-chain.ts`, `src/lib/health-summary.ts`, `src/lib/health-card-html.ts`, `src/lib/health-card-utils.ts`, `src/lib/health-timeline.ts`, `src/lib/printableHealthCard.ts` (web), `src/lib/family-graph.ts`, `src/lib/family-risk.ts` | UHID generation, age compute, MPI scoring, family graph, health card rendering |
| Tests | `test/patients.test.ts`, `patient-onboarding.test.ts`, `patient-b2c.test.ts`, `patient-card-qr.test.ts`, `patient-registration-linking.test.ts`, `patient-amendments.test.ts`, `mpi-scoring.test.ts`, `family-risk.test.ts`, `global-identity-service.test.ts`, `health-summary-provenance.test.ts`, `patient-phr-reported-experience.test.ts`, `patient-portal-route-order.test.ts` | — |

**Features:** registration, photo upload (R2), duplicate detection, MPI (Master Patient Index), UHID system, timeline, patient portal, PHR export, patient card QR, family relationships, identity claims.

---

## 3. Reception / OPD / Queue Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/reception.ts`, `visits.ts`, `queue.ts`, `appointments.ts`, `visitPass.ts`, `visit-services-layer.ts` (in migrations 0157), `reception.ts`, `doctor-schedule.ts`, `doctorSchedule.ts`, `doctorSchedules.ts`, `reception-hot-path-indexes.ts` | Visit creation, queue tokens, appointment scheduling, visit passes |
| Frontend pages | `web/src/pages/ReceptionDashboard.tsx`, `QueueManagement.tsx`, `QueueDisplay.tsx`, `AppointmentScheduler.tsx`, `AppointmentSettings.tsx`, `OnlineAppointmentApproval.tsx`, `CreateReferral.tsx`, `IncomingReferralQueue.tsx`, `ReceptionReportsPage.tsx`, `NurseReportsPage.tsx` | Reception control, queue mgmt, queue display, appointments, referrals |
| Components | `web/src/components/reception/CustomSerialInput.tsx`, `DischargeModal.tsx`, `ProvisionalBillingModal.tsx`, `ReceptionModals.tsx`, `ReceptionPatientDrawer.tsx`, `ReceptionTopBar.tsx`, `TokenReservationPanel.tsx` | Reception UI helpers |
| Libraries | `src/lib/token-reservations.ts`, `src/lib/sequence.ts`, `src/lib/doctor-daily-status.ts`, `src/lib/doctor-fees.ts`, `src/lib/appointment-daily-flow.ts`, `src/lib/visit-guards.ts`, `src/lib/patient-live-visit.ts`, `src/lib/smart-card-priority.ts` (web), `src/lib/reception-helpers.ts` (web), `src/lib/receptionBilling.ts` (web) | Token reservation, daily flow, daily status, visit guards |
| Tests | `test/reception.test.ts`, `reception-module.test.ts`, `reception-finance-audit.test.ts`, `reception-report-access.test.ts`, `queue-production-contract.test.ts`, `queue-token-flexible-schema.test.ts`, `token-reservation.test.ts`, `token-reservations.test.ts`, `appointments.test.ts`, `appointment-checkin.test.ts`, `appointment-eligibility.test.ts`, `visits.test.ts`, `visit-pass-redeem.test.ts` | — |

**Features:** walk-in visit, daily list, token/serial desk, multi-priority (normal/urgent/emergency/vip), counters, transfer, flexible token numbering, appointment scheduling, conflict check, online appointment approval, doctor referral queue.

---

## 4. Doctor Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/doctors.ts`, `consultations.ts`, `prescriptions.ts`, `doctorSchedule.ts`, `doctorSchedules.ts`, `doctor-schedule.ts`, `doctorCertificates.ts`, `commissions.ts`, `commissions-reports.ts` (in routes/tenant), `orderSets.ts`, `dose-templates.ts`, `advice-templates.ts`, `doctorDashboard.ts` (referenced), `ePrescribing.ts` | Doctor CRUD, schedule, consultation notes, prescriptions, certificates, commissions, order sets, dose/advice templates, dashboards |
| Frontend pages | `web/src/pages/doctor/DoctorDashboard.tsx`, `DoctorList.tsx`, `DoctorDetail.tsx`, `DoctorProfile.tsx`, `DoctorSchedule.tsx`, `DoctorStatusPage.tsx`, `DoctorReportReview.tsx`, `DoctorCertificates.tsx`, `web/src/pages/DoctorDashboard.tsx` (root), `DoctorLabResults.tsx`, `DigitalPrescription.tsx`, `PrescriptionPrint.tsx`, `ConsultationNotes.tsx`, `CommissionManagement.tsx`, `CommissionRules.tsx`, `OrderSetManager.tsx`, `EPRESCRIBINGDashboard.tsx` | Doctor workspace, schedule, certificates, prescriptions, commissions |
| Components | `web/src/components/doctor/DoctorDrawer.tsx`, `DoctorForm.tsx`, `DoctorPhotoUploader.tsx`, `DoctorTimeline.tsx`, `DoctorWorkspaceDrawer.tsx`, `KpiCard.tsx`, `QueueTable.tsx`, `QuickActions.tsx`, `QuickPrescriptionForm.tsx`, `ReportReviewPanel.tsx`, `RightPanel.tsx`, `ScheduleGrid.tsx`, `ScheduleTimeline.tsx`, `SmartPhrases.tsx`, `VisitingHoursSelector.tsx`, `AIScribe.tsx` | Doctor workspace, AI scribe, schedule grid |
| Libraries | `src/lib/prescription-safety.ts`, `prescription-lab-orders.ts`, `prescription-usage-stats.ts`, `src/lib/doctor-display.ts` (web), `src/lib/doctor-dashboard.ts`, `src/lib/doctor-lab-inbox.ts`, `src/lib/ot-commission-calc.ts`, `src/lib/drug-safety.ts` | Prescription safety, drug interaction check, AI scribe, doctor display name, lab inbox |
| Tests | `test/doctors.test.ts`, `doctor-module.test.ts`, `doctor-dashboard-contract.test.ts`, `doctor-daily-patient-count.test.ts`, `doctor-stats-consolidation.test.ts`, `doctor-fee-validation.test.ts`, `doctor-fees.test.ts`, `doctor-lifecycle-atomicity.test.ts`, `doctor-role-guards.test.ts`, `doctor-schedule-auth.test.ts`, `doctor-shift-partial-time-validation.test.ts`, `doctor-shift-time-validation.test.ts`, `doctor-audit-log.test.ts`, `prescription-safety.test.ts`, `prescription-allergy-safety.test.ts`, `prescription-drug-interaction-safety.test.ts`, `prescription-finalization-integrity.test.ts`, `prescription-fulfilment-migration.test.ts`, `prescription-history.test.ts`, `prescription-hospital-dispense.test.ts`, `prescription-lock-version.test.ts`, `prescription-override-audit.test.ts`, `prescription-print-items.test.ts`, `prescription-read-permissions.test.ts`, `prescription-usage-stats.test.ts`, `prescription-autosave.test.ts` | — |

**Features:** doctor schedule, queue, consultation notes, digital prescription writing + print, e-prescribing, drug-drug interaction check, allergy cross-check, order sets, dose/advice templates, doctor certificates, commission structure, commission reports, AI scribe.

---

## 5. IPD / Inpatient Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/admissions.ts`, `discharge.ts`, `dischargePlanning.ts`, `ipdCharges.ts`, `ipdReports.ts`, `ipBilling.ts`, `nurseStation.ts`, `bed-management.ts` (in `src/routes/tenant/admissions.ts`), `feeSheet.ts`, `deposits.ts`, `inputOutput.ts`, `vitals.ts`, `doctor-nurse-bed-link.ts` (in admissions), `visit-services-layer.ts` (in migrations 0157) | Admission, bed assignment, bed management, daily charges, discharge process, discharge summary, IPD reports, IP billing, nurse station, fee sheet, deposits, I/O |
| Frontend pages | `web/src/pages/AdmissionIPD.tsx`, `BedManagement.tsx`, `DischargeSummary.tsx`, `DischargePlanningPage.tsx`, `IPDCharges.tsx`, `IPDReports.tsx`, `IPDRunningBillPrint.tsx`, `IPBillingPage.tsx`, `NurseStation.tsx`, `VitalsPage.tsx`, `WardSupplyDashboard.tsx`, `DoctorStatusPage.tsx` | Admission, beds, discharge, IPD charges, nurse station, vitals, ward supply |
| Components | `web/src/components/nursing/WardBedGrid.tsx`, `WardBillingTab.tsx`, `DrawerOverviewTab.tsx`, `DrawerVitalsTab.tsx`, `DrawerNotesTab.tsx`, `DrawerIOTab.tsx`, `IOChartsTab.tsx`, `DrawerMARTab.tsx`, `MARTab.tsx`, `MedicationOrdersTab.tsx`, `DrawerOrdersTab.tsx`, `DrawerServicesTab.tsx`, `DrawerDietTab.tsx`, `DrawerDischargeTab.tsx`, `DrawerCarePlanTab.tsx`, `DrawerActivityLogTab.tsx`, `DrawerLabSampleTab.tsx`, `DrawerIVFluidTab.tsx`, `DrawerRespiratoryTab.tsx`, `ShiftHandoverModal.tsx`, `OfflineIndicator.tsx`, `VoiceNoteButton.tsx`, `DrugRequisitionTab.tsx`, `EmergencyAlertButton.tsx`, `ICUFlowSheet.tsx`, `vitalsFrequency.ts` | Comprehensive nursing tab set |
| Libraries | `src/lib/bed-charges.ts`, `src/lib/discharge-billing-guards.ts`, `src/lib/visit-guards.ts`, `src/lib/ipd-billing-summary.ts`, `src/lib/parent-visit-chain.ts`, `src/lib/patient-deposits.ts`, `src/lib/clinical-reminder-dates.ts` | Bed auto-charges, discharge guards, IPD summary |
| Tests | `test/ipd.test.ts`, `ipd-package-bed-charges.test.ts`, `ip-billing-calculations.test.ts`, `discharge-role-guards.test.ts`, `reception.test.ts`, `wards-bed-grid.test.ts`, `bed-management-bed-types.test.ts` | — |

**Features:** admission, bed allocation, ICU/HDU tracking, bed auto-charges, daily IPD charges, fee sheet, provisional billing, running bill print, discharge process, discharge summary PDF, discharge planning, deposits, vital signs tracking, I/O charts.

---

## 6. Laboratory Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/lab.ts`, `tests.ts`, `labSettings.ts`, `labMachines.ts`, `labMachineDowntime.ts`, `labNotifications.ts`, `labBarcode.ts`, `labMonitoring.ts`, `labQc.ts`, `labCalibrations.ts`, `labComponents.ts`, `labWorkflow.ts`, `labValidation.ts`, `lab-results.ts`, `requisitions.ts` | Lab orders, results, catalog, settings, machines, monitoring, QC, calibrations, components, workflow, validation, requisitions, barcodes |
| Frontend pages | `web/src/pages/LaboratoryDashboard.tsx`, `LabTestOrderForm.tsx`, `TestCatalog.tsx`, `LabSettingsPage.tsx`, `LabReportPrint.tsx`, `ReportLabPage.tsx`, `LabMachineSettings.tsx`, `LabMonitoringDashboard.tsx`, `LabQcDashboard.tsx`, `LabMachineSettings.tsx` | Lab dashboard, order form, catalog, settings, report print |
| Components | `web/src/components/lab/PanelResultEntry.tsx`, `ResultInput.tsx` | Lab result entry UI |
| Libraries | `src/lib/lab-workflow.ts`, `lab-finance.ts`, `lab-cancellation.ts`, `lab-consumables.ts`, `lab-formula-evaluator.ts`, `lab-machine-capabilities.ts`, `src/lib/hl7-parser.ts`, `src/lib/astm-parser.ts`, `src/lib/code128.ts` (barcode), `src/lib/barcode-utils.ts` | Lab workflow, HL7v2 parser, ASTM parser, barcode, formula evaluator |
| Tools | `tools/lab-middleware/`, `tools/hl7-agent/` | Lab middleware + HL7 listener agents |
| Tests | `test/lab.test.ts`, `lab-routes.test.ts`, `lab-core-units.test.ts`, `lab-workflow.test.ts`, `lab-mvp-workflow.test.ts`, `lab-finance.test.ts`, `lab-finance-routes.test.ts`, `lab-cancellation-workflow.test.ts`, `lab-consumables-automation.test.ts`, `lab-lis.test.ts`, `lab-machine-integration-readiness.test.ts`, `lab-machine-billing-gate.test.ts`, `lab-billing-gate.test.ts`, `lab-critical-fixes.test.ts`, `lab-formula.test.ts`, `lab-order-from-prescription.test.ts` | — |

**Features:** test catalog, order creation, result entry (free text + structured), critical value alerts, LOINC codes, reference ranges, formula-based results, HL7v2/ASTM parsers, LIS middleware, machine integration, machine downtime, lab QC, calibrations, validations, requisitions, barcodes, PDF report print, lab settings.

---

## 7. Radiology Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/radiology/{index.ts,catalog.ts,orders.ts,reports.ts,pacs.ts}` | Radiology index, catalog, orders, reports, PACS |
| Frontend pages | `web/src/pages/RadiologyDashboard.tsx` | Single dashboard with 4 tabs (orders, scan, report, PACS) |
| Components | `web/src/components/radiology/ReportDetailModal.tsx` | Report detail modal |
| Tools | `tools/dicom-print-agent/` | DICOM print agent |
| Tests | `test/radiology-enhanced.test.ts`, `radiology-pacs-forward.test.ts`, `radiology-billing-gate.test.ts` | — |

**Features:** orders tab, scan/unscan workflow, report creation with template dropdown, finalize workflow, film type tracking, DICOM image viewer (OHIF), PACS study list, modality filter, KPI stats, STAT order alerts, report numbering (RAD-YYYYMMDD-###), idempotency, DICOM print agent.

---

## 8. Pharmacy Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/pharmacy/{index.ts,master.ts,purchase.ts,stock.ts,advanced.ts,invoices.ts}`, `pharmacy.ts`, `pharmacyReturns.ts`, `prescriptions.ts`, `ePrescribing.ts`, `prescriptionFulfilment.ts`, `prescription-orders.ts` (nursing), `prescription-fulfilment.ts` | Pharmacy overview, master data, purchase orders, stock, advanced features, invoices, returns, prescription fulfillment, e-prescribing |
| Pharmacy inventory | `src/routes/tenant/inventory/{items.ts,stock.ts,stores.ts,vendors.ts,po.ts,rfq.ts,gr.ts,req.ts,dispatch.ts,return.ts,returns.ts,writeoff.ts,assets.ts,settings.ts,reorder.ts,locations.ts,reservations.ts,countSessions.ts,donations.ts,adjustmentRequests.ts,importExport.ts,pharmacyBridge.ts,workflowAdapters.ts,dispatch.ts,issues.ts,reports.ts,helpers.ts,index.ts}` | Full inventory sub-system: items, stock, stores, vendors, PO, RFQ, GR, requisitions, dispatch, returns, write-off, assets, settings, reorder, count sessions, donations, adjustments, import/export, pharmacy bridge |
| Frontend pages | `web/src/pages/pharmacy/{PharmacyOverview,ItemList,ItemPriceHistory,GenericList,CategoryList,SupplierList,SupplierLedger,PurchaseOrderForm,PurchaseOrderList,GoodsReceiptForm,GoodsReceiptList,InvoiceForm,InvoiceList,InvoiceReceipt,DispatchList,StockList,DispensaryStock,NarcoticRegister,WriteOffList,ExpiryReport,StockReport,SalesReport,SettlementList,ApprovalQueuePage,DosageTemplatesPage,TaxConfigPage,PatientBillingPage,PrescriptionList,ReturnList,DepositList}.tsx`, `web/src/pages/PharmacyDashboard.tsx`, `MedicineDispensing.tsx`, `web/src/pages/inventory/{InventoryDashboard,StockList,InventoryLedger,StockAdjustment,GoodsReceiptList,GoodsReceiptForm,PurchaseOrderForm,PurchaseOrderList,RequisitionForm,RequisitionList,DispatchForm,DispatchList,InventoryReturnPage,InventoryReturnToVendorPage,InventoryWriteOffPage,InventoryRFQPage,InventoryReportsPage,InventoryImportExportPage,InventoryMasterDataPage,InventoryDonationPage,InventoryIssuePage,InventoryTransferPage,InventoryTraceability,InventoryCountPage,InventoryAdjustmentRequestPage}.tsx` | 25+ pharmacy pages + 23+ inventory pages |
| Components | `web/src/components/PharmacyOverview.tsx` (web admin) | — |
| Libraries | `src/lib/prescription-lab-orders.ts`, `pharmacy-barcode.ts`, `pharmacy-multi-price.ts`, `src/lib/inventory-core.ts`, `src/lib/diagnostic-catalog.ts`, `src/lib/diagnostic-billing.ts`, `src/lib/po-verification.ts`, `src/lib/supplier-ledger.ts` | Multi-price pharmacy, barcode, inventory core, PO verification |
| Tests | `test/pharmacy.test.ts`, `pharmacy-enterprise.test.ts`, `pharmacy-mvp-features.test.ts`, `pharmacy-phase2-phase3.test.ts`, `pharmacy-billing-accounting.test.ts`, `pharmacy-enhanced-modules.test.ts`, `pharmacy-returns-critical.test.ts`, `pharmacy.test.ts`, `inventory-core-rules.test.ts`, `drug-interaction-engine.test.ts` | — |

**Features:** master drug catalog, prescription management, e-prescribing with digital signatures, drug dispensing, PO/GRN/Invoice cycle, supplier management, narcotics register, expiry management, tax config, discounts, write-off, stock alerts, return lists, deposit lists, approval queue, dosage templates, patient billing, multi-price pharmacy, full inventory cycle (PO→GR→stock→issue→return→write-off→reorder).

---

## 9. Billing & Payments Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/billing.ts`, `billingMaster.ts`, `billingCounter.ts`, `billingCancellation.ts`, `billingHandover.ts`, `billingInsurance.ts`, `billingProvisional.ts`, `billingReports.ts`, `billingAging.ts`, `billingCreditStatus.ts`, `creditNotes.ts`, `settlements.ts`, `deposits.ts`, `payments.ts`, `payment-methods.ts`, `empCash.ts`, `ipBilling.ts`, `feeSheet.ts`, `cash-book.ts`, `bank-book.ts`, `due-aging.ts`, `vouchers.ts`, `bill-versions.ts`, `shift-closing.ts`, `priceCategories.ts` | Full billing: counter sessions, cancellation, handover, insurance, provisional, reports, aging, credit status, credit notes, settlements, deposits, payments, payment methods, IPD bill, fee sheet, cash book, bank book, due aging, vouchers, bill versions, shift closing, price categories |
| Frontend pages | `web/src/pages/BillingDashboard.tsx`, `BillingMasterPage.tsx`, `BillPrint.tsx`, `BillCancellationPage.tsx`, `BillingHandoverPage.tsx`, `BillingCounterPage.tsx`, `InsuranceBillingPage.tsx`, `InsuranceClaims.tsx`, `IPBillingPage.tsx`, `ProvisionalBillingPage.tsx`, `FeeSheet.tsx`, `DepositsPage.tsx`, `PaymentsPage.tsx`, `SettlementsPage.tsx`, `CreditNotesPage.tsx`, `PatientSettlementsPage.tsx`, `CashBankBook.tsx`, `DueAgingReport.tsx`, `BillVersionHistory.tsx`, `DiscountRulesSettings.tsx`, `PaymentMethodsSettings.tsx` | Full billing UI set |
| Components | `web/src/components/invoice/{ConsultationInvoiceBody,DiagnosticInvoiceBody,InvoiceBrandHeader,InvoiceFooter,InvoiceItemAmounts,InvoiceTotalsPayment}.tsx`, `web/src/components/reception/ProvisionalBillingModal.tsx`, `BillingHandoverModal` (referenced) | Invoice body templates, totals, brand |
| Libraries | `src/lib/billing-counter-session.ts`, `src/lib/billing-finalization.ts`, `src/lib/billing-payment-state.ts`, `src/lib/billing-category-totals.ts`, `src/lib/audit-bill-state.ts`, `src/lib/payment-gateway.ts`, `src/lib/invoice-retry.ts`, `src/lib/diagnostic-billing.ts`, `src/lib/diagnostic-catalog.ts`, `src/lib/discount-policy.ts`, `src/lib/emp-cash.ts`, `src/lib/shift-closing.ts`, `src/lib/billAmounts.ts` (web), `src/lib/ipd-helpers.ts` (web), `src/lib/ipdDischargeFinancial.ts` (web), `src/lib/receptionBilling.ts` (web) | Billing counter session, idempotency, discount policy |
| Tests | `test/billing.test.ts`, `billing-mvp.test.ts`, `billing-invoice-print.test.ts`, `billing-cancellation-mvp.test.ts`, `billing-catalog-migration.test.ts`, `billing-counter-cash-handling.test.ts`, `billing-counter-referrer.test.ts`, `billing-discount-audit.test.ts`, `billing-financial-controls.test.ts`, `billing-refund-approval.test.ts`, `billing-reports.test.ts`, `billing-tax-calculation.test.ts`, `payments.test.ts`, `payment-gateway.test.ts`, `duplicate-bill-guard.test.ts`, `diagnostic-billing.test.ts`, `diagnostic-catalog.test.ts`, `ssf.test.ts` | — |

**Features:** bill creation (OPD/IPD/Lab/Pharmacy), payment collection (cash/card/bKash/Nagad), **payment idempotency** (unique key on `(idempotency_key, tenant_id)`), bill cancellation, bill handover, insurance claims, prior authorization, deposits, credit notes, settlements, multi-currency, due aging, cash/bank book, bill versions, shift closing, price categories, discount rules, payment methods config, provisional billing.

---

## 10. Accounting & Finance Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/accounting.ts`, `accounts.ts`, `journal.ts`, `profit.ts`, `income.ts`, `expenses.ts`, `recurring.ts`, `shareholders.ts`, `costCenters.ts`, `subLedgers.ts`, `fiscalYears.ts`, `commissions.ts`, `audit.ts` | Chart of accounts, double-entry journal, P&L, income/expense, recurring, shareholders, cost centers, sub-ledgers, fiscal years, commissions, audit log |
| Frontend pages | `web/src/pages/accounting/{AccountingDashboard,AuditLogs,ChartOfAccounts,ExpenseList,IncomeList,JournalEntries,ProfitLoss,RecurringExpenses,Reports,ShareholderManagement,VoucherVerification,FiscalYearSettings}.tsx` | Full accounting UI set |
| Components | `web/src/components/accounting/SettlementSlipModal.tsx`, `web/src/components/shareholders/PdfImportModal.tsx` | Settlement slip, PDF import |
| Libraries | `src/lib/accounting-backfill.ts`, `accounting-hardening.ts`, `accounting-helpers.ts`, `accounting-invariants.ts`, `accounting-periods.ts`, `accounting-posting.ts`, `accounting-provisioning.ts`, `accounting-reporting.ts`, `direct-finance-accounting.ts`, `fiscal-year.ts`, `shareholder-settings.ts` | Double-entry bookkeeping, posting engine, fiscal year, shareholder settings |
| Tests | `test/accounting.test.ts`, `accounting-api.test.ts`, `accounting-backfill.test.ts`, `accounting-features.test.ts`, `accounting-hardening-logic.test.ts`, `accounting-i18n.test.ts`, `accounting-invariants.test.ts`, `accounting-posting.test.ts`, `journal-accounts.test.ts`, `expenses.test.ts`, `commission-settlement-accounting.test.ts`, `agent-referral-commissions.test.ts`, `fiscal-year.test.ts`, `fiscal-year-date.test.ts`, `shareholders.test.ts`, `shareholders-bulk-import.test.ts`, `audit.test.ts` | — |

**Features:** chart of accounts, double-entry journal (debit/credit), cost centers, sub-ledgers, fiscal year + period lock, income, expense, recurring auto-post, P&L, shareholder management + dividends, audit log, multi-tenant accounting, voucher verification, PDF import for shareholder data.

---

## 11. Inventory Module

(Already covered in §8 Pharmacy as sub-system; listed again for explicit visibility)

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/inventory/*` (30 files) | Items, stock, stores, vendors, PO, RFQ, GR, requisitions, dispatch, return, write-off, assets, settings, reorder, count sessions, donations, adjustments, reservations, transfers, QR, reports, import/export, pharmacy bridge |
| Frontend pages | `web/src/pages/inventory/*` (23 files) | Dashboard, list pages, forms, reports, trace, transfer, count, RFQ, donation, adjustment, import/export, master data |
| Libraries | `src/lib/inventory-core.ts`, `src/lib/po-verification.ts`, `src/lib/supplier-ledger.ts` | Inventory core, PO verification, supplier ledger |
| Tests | `test/inventory-core-rules.test.ts` | — |

**Features:** full supply chain PO→GR→stock→issue→return→write-off→reorder, asset management with AMC, RFQ, count sessions, donations, adjustments, QR-based stock, traceability, reservations, transfers, import/export.

---

## 12. Nursing Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/nursing/{index.ts,wards.ts,mar.ts,medication-orders.ts,medication-reconciliation.ts,iv-drugs.ts,io-charts.ts,handover.ts,notes.ts,care-plan.ts,opd.ts,wound-care.ts,monitoring.ts,ai-handover.ts,assignments.ts,barcode.ts,blood-sugar.ts,clinical-summary.ts,consultation-requests.ts,diet-sheet.ts,drug-requisition.ts,favourites.ts,investigation-results.ts,medication-due.ts,nursing-orders.ts,patient-transfer.ts,reports.ts,respiratory.ts,ward-billing.ts}` (29 files) | Comprehensive nursing operations |
| Frontend pages | `web/src/pages/NurseStation.tsx`, `NursingDashboard.tsx`, `NurseTasksPage.tsx`, `NurseWorkloadPage.tsx`, `VitalsPage.tsx`, `WardSupplyDashboard.tsx` | Nurse station + dashboards |
| Components | `web/src/components/nursing/*` (50+ components: `PatientDrawer.tsx`, `WardBedGrid.tsx`, all `Drawer*Tab` components, `MARTab`, `IOChartsTab`, `ICUFlowSheet`, `BarcodeScanner`, `BloodSugarTab`, `ClinicalSummaryTab`, `ConsultationRequestsTab`, `DietSheetTab`, `DrugRequisitionTab`, `EmergencyAlertButton`, `MedicationOrdersTab`, `NursingOrdersTab`, `OfflineIndicator`, `PatientTransferTab`, `ReconciliationTab`, `ShiftHandoverModal`, `VoiceNoteButton`, `WardBillingTab`) | Comprehensive nursing UI |
| Tests | `test/nursing.test.ts`, `nursing-routes.test.ts`, `nursing-routes-part2.test.ts`, `nursing-index-routes.test.ts`, `nursing-routes-part2.test.ts` | — |

**Features:** MAR (medication admin record), medication orders, reconciliation, IV drugs, I/O charts, wound care, shift handovers, medication due, nursing orders, patient transfer, monitoring, AI handover, clinical summary, vital signs, blood sugar, respiratory, diet sheet, drug requisition, ward billing, emergency alert button, voice notes, ICU flowsheet, barcode scanner, favourites, investigation results, OPD nursing.

---

## 13. HR / Staff / Payroll Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/hr/{index.ts,attendance.ts,biometric.ts,leave.ts,payroll.ts,roster.ts}`, `staff.ts`, `groupAttendance.ts`, `doctors.ts` (doctor mgmt), `doctorSchedule.ts` | Attendance, biometric, leave, payroll, roster, staff, group attendance, doctor schedule |
| Frontend pages | `web/src/pages/HRDashboard.tsx`, `StaffPage.tsx`, `AttendancePunch.tsx`, `DutyRoster.tsx`, `GroupAttendance.tsx`, `MfaSetup.tsx`, `ProfilePage.tsx` | HR dashboard, staff list, attendance, duty roster, group attendance |
| Tests | `test/hr.test.ts`, `hr-unit-new.test.ts`, `hr-gaps.test.ts`, `hr-leave.test.ts`, `hr-roster-biometric-schemas.test.ts`, `staff.test.ts`, `user-management.test.ts`, `module7-user-control-audit.test.ts`, `users-me-schema-drift.test.ts` | — |

**Features:** staff CRUD, attendance, biometric integration, leave management, duty roster, payroll, group attendance, 7-tier RBAC, staff invitation, MFA setup, staff photo, mobile/email.

---

## 14. Operations & Facilities Module

### 14.1 Operation Theatre (OT)
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/ot.ts`, `procedureOrders.ts` |
| Frontend | `web/src/pages/OTDashboard.tsx`, `OTCalendar.tsx`, `OTReports.tsx`, `OTSettings.tsx`, `ProcedureOrdersDashboard.tsx` |
| Components | `web/src/components/ot/{BookingDetailDrawer.tsx,RoomMatrix.tsx}` |
| Tests | `test/ot-billing-lifecycle.test.ts` |
| Features | Theatre scheduling, procedure orders, instrument tracking, anesthesia logs, OT blueprint, room matrix, booking detail |

### 14.2 Emergency
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/emergency.ts` |
| Frontend | `web/src/pages/EmergencyDashboard.tsx`, `OTDashboard.tsx` (overlap), `TriageChatbot.tsx` |
| Libraries | `src/lib/emergency-profile.ts` |
| Tests | `test/global-emergency-pack.test.ts`, `public-emergency-profile.test.ts` |
| Features | Triage, queue, emergency admission, profile, public pack |

### 14.3 Admissions & Beds — see §5
### 14.4 Housekeeping
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/housekeeping.ts` |
| Frontend | `web/src/pages/HousekeepingManagement.tsx` |
| Libraries | `src/lib/housekeeping-helpers.ts` |
| Features | Task management, bed links, room cleaning |

### 14.5 Laundry
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/laundry.ts` |
| Frontend | `web/src/pages/LaundryManagement.tsx` |
| Features | Laundry cycle tracking |

### 14.6 Kitchen / Diet
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/kitchen.ts`, `src/routes/food.ts` (global) |
| Frontend | `web/src/pages/KitchenManagement.tsx` |
| Features | Diet management, food system |

### 14.7 CSSD (Central Sterile Supply)
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/cssd.ts` |
| Frontend | `web/src/pages/CssdManagement.tsx` |
| Features | Sterilization cycle |

### 14.8 Ambulance
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/ambulance.ts` |
| Frontend | `web/src/pages/AmbulanceManagement.tsx` |
| Features | Ambulance dispatch |

### 14.9 Mortuary
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/mortuary.ts` |
| Frontend | `web/src/pages/MortuaryManagement.tsx` |
| Features | Mortuary management, death records |

### 14.10 Death Records
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/deathRecords.ts` |
| Frontend | `web/src/pages/DeathRecords.tsx` |
| Features | Death record keeping |

### 14.11 Blood Bank
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/bloodBank.ts` |
| Frontend | `web/src/pages/BloodBankManagement.tsx` |
| Features | Blood inventory, donor link |

### 14.12 MLC (Medico-Legal Cases)
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/mlc.ts` |
| Frontend | `web/src/pages/MlcManagement.tsx` |
| Features | MLC tracking |

### 14.13 Maternity
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/maternity.ts` |
| Frontend | `web/src/pages/MaternityDashboard.tsx` |
| Tests | `test/maternity.test.ts` |
| Features | Maternity patients, ANC visits, delivery register, PNC visits, newborns, statistics |

### 14.14 Dental
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/dental.ts` |
| Frontend | `web/src/pages/Dental.tsx` |
| Tests | `test/dental.test.ts` |
| Features | Treatment plan, periodontal charting, X-ray tracking |

### 14.15 Eye Exam
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/clinical/eye-exam.ts` |
| Frontend | `web/src/pages/EyeExamDashboard.tsx` |
| Features | Eye examination |

### 14.16 CAMOS
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/camos.ts` |
| Frontend | `web/src/pages/Camos.tsx` |
| Features | CAMOS operations |

### 14.17 Biomedical Waste
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/biomedicalWaste.ts` |
| Frontend | `web/src/pages/BiomedicalWasteManagement.tsx` |
| Features | Waste tracking |

### 14.18 WardSupply
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/wardSupply.ts` |
| Frontend | `web/src/pages/WardSupplyDashboard.tsx` |
| Tests | `test/ward-supply.test.ts`, `wardsupply.test.ts` |
| Features | Ward requisition, approval, dispatch, receipt, ward stock |

### 14.19 Helpdesk
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/helpdesk.ts` |
| Frontend | `web/src/pages/HelpdeskDashboard.tsx`, `HelpCenterPage.tsx` |
| Tests | `test/helpdesk.test.ts` |
| Features | Ticket creation, SLA tracking, assignment, comments, status workflow |

### 14.20 Asset Management
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/inventory/assets.ts` (and inventory) |
| Frontend | `web/src/pages/AssetManagement.tsx` |
| Features | Asset tracking + AMC |

### 14.21 Devices
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/devices.ts`, `src/routes/notifications.ts` (device push) |
| Frontend | (not exposed) |
| Tests | `test/device-notifications.test.ts`, `device-tracking.test.ts` |
| Features | Medical device tracking, device notifications |

### 14.22 Psychiatry
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/psychiatry.ts` |
| Frontend | `web/src/pages/Psychiatry.tsx` |
| Tests | `test/psychiatry.test.ts` |
| Features | Psychiatric assessments, mental health scoring |

### 14.23 Dictation
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/dictation.ts` |
| Frontend | `web/src/pages/DictationPage.tsx` |
| Tests | `test/dictation.test.ts` |
| Features | Voice-to-text dictation |

### 14.24 Requisitions
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/requisitions.ts` |
| Frontend | (covered in inventory) |
| Features | Cross-department requisition workflow |

### 14.25 Group Attendance
| Layer | Files |
|-------|-------|
| Backend | `src/routes/tenant/groupAttendance.ts` |
| Frontend | `web/src/pages/GroupAttendance.tsx` |
| Features | Group attendance marking |

---

## 15. Clinical Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/clinical/{index.ts,allergies.ts,assessments.ts,care-plans.ts,diagnosis.ts,diet.ts,encounters.ts,eye-exam.ts,forms.ts,glucose.ts,history.ts,images.ts,medications.ts,notes.ts,problem-list.ts,ros.ts,sdoh.ts,vitals.ts}`, `clinicalReminders.ts`, `clinicalDecisionSupport.ts`, `clinicalImages.ts`, `clinicalDecisionSupport.ts`, `physicalExam.ts`, `allergies.ts`, `vaccinations.ts`, `consent-management.ts` (in tenant via `consents.ts`), `cds-enhancements.ts`, `medicalRecords.ts`, `terminology.ts` | Comprehensive clinical feature set |
| Frontend pages | `web/src/pages/ClinicalAssessments.tsx`, `ConsultationNotes.tsx`, `CarePlansDashboard.tsx`, `PhysicalExamDashboard.tsx`, `EyeExamDashboard.tsx`, `AllergiesPage.tsx`, `VaccinationDashboard.tsx`, `VitalsPage.tsx`, `TrackAnythingDashboard.tsx`, `TriageChatbot.tsx`, `ImportExternalRecords.tsx`, `HealthRecordSharing.tsx`, `CustomFormBuilder.tsx`, `QuestionnairesPage.tsx`, `Camos.tsx`, `MedicalRecordsDashboard.tsx`, `Dental.tsx` | Clinical workspace |
| Components | `web/src/components/clinical/{AllergyPanel,AssessmentsTab,DiagnosisOrders,DiagnosisTab,DietTab,GlucoseTab,HistoryTab,LabFlowsheet,MedicationsPanel,NoteEditor,NotesList,PatientEmrHeader,PrescriptionRepeatButton,ProblemListPanel,ProblemListTab,ROSTab,SDOHTab,TimelineEventExpandable,TransposedVitalsTable,UnifiedFilterBar,VitalsPanel}` | 20+ clinical UI components |
| Libraries | `src/lib/drug-safety.ts`, `clinical-reminder-dates.ts`, `chart-ai-summary.ts`, `document-classifier.ts`, `follow-up-validity.ts`, `consent-rules.ts`, `consent-cleanup.ts`, `consent-helpers.ts`, `src/lib/mental-health-scoring.ts` | Drug safety, reminders, AI summary, document classifier, consent |
| Tests | `test/clinical-assessments.test.ts`, `clinical-depth.test.ts`, `clinical-ehr-routes.test.ts`, `clinical-mar.test.ts`, `clinical-reminder-dates.test.ts`, `clinical-review-workflow.test.ts`, `consultations.test.ts`, `consultation-prescription-link.test.ts`, `consultation-status.test.ts`, `consent-v2.test.ts`, `consent-docs-kpi.test.ts`, `consent-clinical-areas.test.ts`, `care-plans.test.ts`, `allergy-staleness.test.ts`, `vitals-api.test.ts`, `track-anything.test.ts` | — |

**Features:** SOAP notes, problem lists (ICD-10/11), diagnosis, vitals, physical exam, care plans, medication records, consultation, clinical history, ROS, SDOH, clinical review status, patient-reported data, consent management, clinical decision support (CDS), clinical reminders, clinical images, custom forms, questionnaires, AI chart summary, track-anything, triage chatbot, import external records, health record sharing.

---

## 16. Quality, Compliance & Audit Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/audit.ts`, `priorAuth.ts`, `insurance.ts`, `mfa.ts`, `qualityKpi.ts`, `consents.ts`, `documents.ts` | Audit logs, prior auth, insurance, MFA, quality KPIs, consent, documents |
| Middleware | `src/middleware/audit.ts` (auto-audit) | Auto-audit middleware |
| Frontend pages | `web/src/pages/SystemAuditLog.tsx`, `web/src/pages/accounting/AuditLogs.tsx`, `PermissionManagement.tsx`, `web/src/pages/admin/{AuditExplorer,LoginSessions,FinancialAudit,PatientRecordAccess,StaffActivityLog,SuspiciousActivities,DiscountReferenceAnalytics,DiscountReview,StockMovementPage,RefundRequestDetail,RefundDetail,DoctorPayoutDetail,ShiftHandoverDetail,ExportHistory,TaskFollowups,DiscountRules,EscalationRules,PendingApprovals,TelemedicineMonitor,LoginSessions,RefundDetail,AlertsExceptions,ApprovalPolicies,CollectionFollowup,DailyCollectionReport,NotificationSettings,ExpenseDetailPage,StockOverview,InventoryAlerts,RefundRequestDetail,RefundDetail}.tsx` | Admin compliance suite |
| Tests | `test/audit.test.ts`, `audit.test.ts`, `prior-auth.test.ts`, `security.test.ts` | — |

**Features:** audit logging with immutability, prior authorization workflow, insurance claims, MFA/TOTP, quality KPIs (ALOS, readmission, mortality), consent management with e-signature, document management, RBAC permissions management, login sessions, patient record access log, staff activity log, suspicious activity detection, financial audit, discount review/analytics, refund approval workflow, export history.

---

## 17. Reports & Analytics Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/reports.ts`, `reportLab.ts`, `reportPharmacy.ts`, `reportAppointment.ts`, `dashboard.ts`, `predictiveAnalytics.ts` | Reports (general, lab, pharmacy, appointment), main dashboard, predictive analytics |
| Frontend pages | `web/src/pages/ReportsDashboard.tsx`, `ReportLabPage.tsx`, `ReportPharmacyPage.tsx`, `ReportAppointmentPage.tsx`, `BillingReportsPage.tsx`, `ReceptionReportsPage.tsx`, `NurseReportsPage.tsx`, `IPDReports.tsx`, `OTReports.tsx`, `OTCalendar.tsx`, `OTSettings.tsx`, `web/src/pages/analytics/{CustomReportBuilder,DeptAnalytics,DoctorAnalytics,ExecutiveOverview,InventoryAnalytics,PatientAnalytics,RevenueAnalytics}.tsx`, `web/src/pages/admin/{FinancialReports,DepartmentComparison,BranchComparison,AdminDashboard,Dashboard,ApprovalCenter,StockOverview}.tsx`, `web/src/pages/QualityKpiDashboard.tsx`, `PredictiveAnalytics.tsx` | Reports UI set |
| Components | `web/src/components/admin/widgets/{ActionRequiredPanel,AuditFeedWidget,KPISummaryCards,LiveCashDrawerWidget,OperationsSnapshot,PaymentMethodBreakdown,RevenueTrendChart}.tsx`, `web/src/components/admin/monitor/{DiagnosticMonitor,IPDMonitor,OPDMonitor,PharmacyMonitor}.tsx` | Widgets & monitors |
| Tests | `test/reports.test.ts`, `reports-analytics.test.ts`, `dashboard.test.ts`, `predictive-analytics.test.ts`, `admin-dashboard-stats.test.ts`, `admin-stats-date-range.test.ts`, `admin-opd-monitor-queue.test.ts`, `admin-ipd-monitor-stats.test.ts`, `admin-pharmacy-monitor.test.ts`, `admin-diagnostic-monitor.test.ts`, `admin-alerts-tasks.test.ts`, `admin-system-health-status.test.ts` | — |

**Features:** revenue reports (daily/monthly), patient statistics, occupancy, doctor performance, multi-branch analytics, executive overview, department analytics, inventory analytics, billing reports, pharmacy reports, lab reports, appointment reports, IPD reports, OT reports, quality KPI dashboards, predictive analytics, custom report builder, KPI summary cards, live cash drawer widget, payment method breakdown, OPD/IPD/diagnostic/pharmacy monitors.

---

## 18. Telemedicine & Communication Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/telemedicine.ts`, `whatsapp.ts`, `push.ts`, `pushNotifications.ts`, `notifications.ts`, `inbox.ts` | Telemedicine sessions, WhatsApp, push, notifications, inbox |
| Frontend pages | `web/src/pages/TelemedicineDashboard.tsx`, `TelemedicineRoom.tsx`, `WhatsAppDashboard.tsx`, `NotificationsCenter.tsx`, `InboxPage.tsx` | Telemedicine UI |
| Libraries | `src/lib/video.ts`, `src/lib/whatsapp.ts` (web), `src/lib/sms.ts`, `src/lib/email.ts`, `src/lib/web-push.ts`, `src/lib/push-notifications.ts` (web), `src/lib/pwaLaunch.ts` (web), `src/lib/pwaPrompt.ts` (web) | Video session, WhatsApp, SMS, email, push notifications, PWA |
| Tests | `test/telemedicine-video.test.ts`, `telemedicine-settings.test.ts`, `push-notifications.test.ts`, `patient-push-notifications.test.ts` | — |

**Features:** telemedicine session creation, video room (CF Realtime SFU + Jitsi fallback), session history, session end + summary, WhatsApp messaging, push notifications (Web Push API), SMS (SSL Wireless / bNotify), email (Resend), in-app notifications, inbox messaging, PWA install prompt.

---

## 19. AI / Intelligence Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/ai.ts`, `ai-patient-summary.ts`, `predictiveAnalytics.ts`, `chart-ai-summary.ts` (lib), `chart-ai-summary.ts` (route via lib), `ai-pdf.ts` (referenced) | AI chat, AI patient summary, predictive analytics, AI PDF |
| Frontend pages | `web/src/pages/AIAssistant.tsx`, `TriageChatbot.tsx`, `PredictiveAnalytics.tsx` | AI assistant UI |
| Components | `web/src/components/doctor/AIScribe.tsx` | AI scribe |
| Libraries | `src/lib/ai.ts`, `ai-memory.ts`, `ai-wellness-context.ts`, `chart-ai-summary.ts`, `daily-insights.ts`, `health-score.ts`, `crisis-detection.ts`, `patient-ai-planner.ts`, `src/lib/mental-health-scoring.ts`, `src/lib/seasonal-alerts.ts` | AI chat, memory, insights, scoring, planner, crisis detection |
| Middleware | `src/middleware/ai-guard.ts` | AI access guard |
| Tests | `test/ai.test.ts`, `ai-guard.test.ts`, `ai-wellness-context.test.ts`, `chart-ai-summary.test.ts`, `crisis-detection.test.ts`, `daily-insights.test.ts`, `mental-health-screening.test.ts`, `patient-ai-planner.test.ts`, `health-score.test.ts`, `wellness-logs.test.ts`, `wellness-profile.test.ts`, `wellness-trends-api.test.ts` | — |

**Features:** AI medical chat (OpenRouter API), long-term memory (Cloudflare Vectorize `hms-ai-memory`), feedback system, AI PDF analysis, AI scribe, AI patient summary, predictive analytics, AI triage chatbot, daily insights, health score, crisis detection, patient AI planner, mental health scoring, seasonal alerts, rate limiting (KV token bucket).

---

## 20. Multi-Tenancy, Branch, Onboarding & Marketplace

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/branches.ts`, `settings.ts`, `website.ts`, `settings-import-export.ts`, `permissions.ts`, `users.ts`, `priceCategories.ts`, `payment-methods.ts`, `departments.ts`, `printTemplates.ts`, `marketplace*.ts` (multiple), `hospitalSite.ts` (public), `public/hospitals.ts` (public), `src/routes/register.ts`, `src/routes/onboarding.ts`, `src/routes/sync.ts` | Multi-tenant infra |
| Frontend pages | `web/src/pages/SettingsPage.tsx`, `SystemPreferences.tsx`, `WebsiteSettings.tsx`, `EmailSettings.tsx`, `PrintTemplateSettings.tsx`, `DepartmentsSettings.tsx`, `SecuritySettings.tsx`, `DiscountRulesSettings.tsx`, `ImportExportSettings.tsx`, `HospitalAdminDashboard.tsx`, `SuperAdminDashboard.tsx`, `SuperAdminSettings.tsx`, `SuperAdminHospitalList.tsx`, `SuperAdminHospitalDetail.tsx`, `SuperAdminHealth.tsx`, `SuperAdminAuditLog.tsx`, `SuperAdminOnboardingQueue.tsx`, `HospitalSetupWizard.tsx`, `HospitalSignup.tsx`, `MarketplaceLanding.tsx`, `web/src/pages/marketplace/{DoctorDirectory,DoctorProfile,HospitalDirectory,HospitalProfile,MarketplaceBookingQueue,ReviewModerationPage}.tsx` | Tenant + marketplace UIs |
| Components | `web/src/components/UnifiedLogo.tsx` (referenced), `web/src/components/HospitalCombobox.tsx` | — |
| Libraries | `src/lib/marketplace-helpers.ts`, `hospital-logo-url.ts`, `health-card-html.ts`, `website-provisioning.ts`, `local-sync-outbox.ts` | — |
| Tests | `test/tenant.test.ts`, `tenant-isolation.test.ts`, `branches-commissions.test.ts`, `onboarding-api.test.ts`, `onboarding-progression.test.ts`, `registration-seeding-contract.test.ts`, `marketplace-booking.test.ts`, `marketplace-reviews.test.ts`, `marketplace-search.test.ts` | — |

**Features:** hospital self-registration, multi-tenant data isolation, multi-branch management, per-tenant settings, custom branding (logo, name, contact), per-tenant sequence counters, hospital website with SSR, public hospital directory, public doctor directory, marketplace booking, provider reviews, marketplace review moderation, doctor auth for marketplace, hospital linking, public site cache, departments, import/export settings, email settings, security settings, payment methods config, print templates, discount rules, price categories, system preferences, super-admin dashboard / health / audit / onboarding queue.

---

## 21. Cross-Hospital Referrals, Consent, Patient Identity

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/referrals.ts`, `referralHospitals.ts`, `externalReferringDoctors.ts`, `marketingReferral.ts`, `consents.ts`, `mpi.ts`, `patientHospitalLinks.ts`, `globalHealth.ts`, `healthRecord.ts` | Cross-hospital referrals, external doctors, marketing referrals, consents, MPI, hospital links, global health |
| Frontend pages | `web/src/pages/CreateReferral.tsx`, `IncomingReferralQueue.tsx`, `HealthRecordSharing.tsx`, `MarketingReferral.tsx` | Referral UI |
| Tests | `test/referral-clinical-role-guards.test.ts`, `referral-commissions.test.ts`, `external-referring-doctors.test.ts`, `consent-clinical-areas.test.ts`, `consent-v2.test.ts`, `consent-docs-kpi.test.ts`, `mpi-scoring.test.ts`, `merge-map.test.ts`, `health-record-staleness.test.ts` | — |

**Features:** cross-hospital patient sharing (NID/MPI + consent + QR), inbound/outbound referral tracking, external referring doctors, marketing referral, consent management for clinical areas, MPI hardening, hospital linking, merge/unmerge maps, global patient health, global emergency profile, visit passes.

---

## 22. Patient-Facing Apps (Ozzyl Lifestyle + Ozzyl Health)

| App | Location | Stack | Purpose |
|-----|----------|-------|---------|
| Ozzyl Lifestyle (PWA) | `apps/ozzyl-lifestyle/` | React 19 + Vite + Capacitor | Patient PHR portal, PWA, mobile lifestyle app |
| Ozzyl Health (Flutter) | `apps/ozzyl_health/` | Flutter | Native Android & iOS app |
| Landing site | `landing/` | Astro | Marketing site |
| Patient PHR backend | `src/routes/patient-phr.ts`, `patient-card.ts`, `patient-amendments.ts`, `global-portal.ts`, `wellness.ts`, `food.ts`, `hospital-links.ts`, `device-notifications` | Patient-facing APIs |
| Patient portal features | `wellness-logs`, `wellness-profile`, `wellness-trends-api`, `patient-ai-plans`, `patient-ai-plan-progress`, `medicine-reminders`, `lifestyle-water-and-medicine`, `barcode-foods`, `wearable-samples`, `mental-health-screenings`, `cycle-meditation`, `walking-challenges`, `health-tips-feedback-analytics`, `health-articles`, `food-system`, `cycle-tracking`, `achievements`, `streaks`, `goals-api`, `sleep-activity-api`, `seasonal-social` | Wellness + lifestyle |
| Patient tests | `test/patient-phr-reported-experience.test.ts`, `patient-portal-i18n.test.ts`, `patient-portal-route-order.test.ts`, `patient-portal-ux.test.ts`, `patient-write-permissions.test.ts`, `patient-food-diary.test.ts`, `patient-live-visit.test.ts`, `patient-medication-reconciliation.test.ts`, `patient-medicine-reminders.test.ts`, `patient-b2c.test.ts`, `patient-onboarding.test.ts`, `patient-push-notifications.test.ts` | — |

**Features:** self-service patient portal, PHR export, patient card, magic links, visit passes, wearable data, lifestyle (water, food, medicine, walk challenges, meditation, cycle, sleep, achievements, streaks, goals), AI plans, AI plan progress, health tips, health articles, food system, nutrition tracking, food photo AI, patient amendments, patient-reported experience, push notifications, wellness profile, wellness logs, daily insights.

---

## 23. Admin Panel (Super-Admin)

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Build | `admin-panel/` (own `package.json`, `vite.config.ts`, `vitest.config.ts`) | Standalone Vite app |
| Pages | `admin-panel/src/pages/{Dashboard,Hospitals,HospitalDetail,Users,Onboarding,Analytics,SystemHealth,AuditLogs,Login,LocalSchemaSync,RemoteControl,NotFound}.tsx` | Super-admin console |
| Components | `admin-panel/src/components/{Layout,ConfirmDialog,CreateHospitalModal,ProvisionHospitalModal,EmptyState,ErrorBoundary,Pagination,Toast,Breadcrumb,nav-helpers}.tsx` | UI primitives |
| Services | `admin-panel/src/services/api.ts` | API client |
| Tests | `admin-panel/src/test/`, `test/admin-*.test.ts` (35+ files: `admin-addons-rbac`, `admin-alerts-tasks`, `admin-audit-explorer-routes`, `admin-auth-boundary`, `admin-dashboard-stats`, `admin-detail-routes`, `admin-diagnostic-monitor`, `admin-discount-references`, `admin-ipd-monitor-stats`, `admin-opd-monitor-queue`, `admin-pharmacy-monitor`, `admin-provision-secure`, `admin-route-exposure`, `admin-stats-date-range`, `admin-system-health-status`, `super-admin-*`) | — |
| Docs | `admin-panel/ADMIN_PANEL_UI_UX_REVIEW.md`, `admin-panel/REVIEW_2026-06-12.md`, `docs/admin-panel-pending-issues.md`, `docs/ozzyl-admin-panel-blueprint.md`, `docs/ozzyl-admin-panel-interface-blueprint.md`, `docs/ozzyl-admin-panel-progress.md` | — |

**Features:** super-admin dashboard, hospital list + detail, users, onboarding queue, system health, analytics, audit logs, provisioning (secure hospital creation), local schema sync, remote control.

---

## 24. Local Server (Edge / Offline Mode)

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend | `src/routes/local-server/schema-sync.ts`, `src/routes/sync.ts`, `src/lib/local-server/schema-sync.ts` | Local-server mode support |
| Scripts | `scripts/local-server/{start.sh,migrate.sh,import-snapshot.sh,export-schema-snapshot.ts,export-tenant-snapshot.ts,install-stack.sh,update-stack.sh,install-auto-update.sh,backup.sh,health-check.sh}` | Local server ops |
| Env | `.dev.vars.local_server`, `.local-sensitive/` | Local server config |
| Routes API | `GET /api/local-server/status`, `GET /api/health/deep`, `app.route('/api/sync', syncRoutes)`, `app.route('/api/local-server/schema-sync', schemaSyncRoutes)` | Local server API |
| Tests | `test/local-schema-sync-engine.test.ts`, `local-schema-sync-routes.test.ts`, `local-schema-sync-cloud-routes.test.ts`, `local-sync-routes.test.ts` | — |

**Features:** runs in `local_server` environment, cloud sync payload, schema snapshot export/import, tenant snapshot export, backup, health check, **disabled when offline**: SMS, email, online payment, workers AI, vectorize.

---

## 25. Integration & Interoperability Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/fhir.ts`, `bulk-fhir.ts`, `ccda.ts` | FHIR R4, Bulk FHIR, C-CDA |
| Libraries | `src/lib/fhir/{mappers.ts,search.ts,types.ts}`, `src/lib/blue-button.ts`, `src/lib/bulk-fhir.ts`, `src/lib/ccda.ts` | FHIR mapping, search, types, Blue Button, bulk FHIR, C-CDA |
| Tools | `tools/dicom-print-agent/`, `tools/hl7-agent/`, `tools/lab-middleware/` | DICOM print, HL7 listener, lab middleware |
| Tests | `test/fhir.test.ts`, `fhir-write.test.ts`, `bulk-fhir.test.ts`, `ccda.test.ts`, `blue-button.test.ts` | — |

**Features:** FHIR R4 endpoints, bulk FHIR, C-CDA document generation, Blue Button, HL7v2 parser, ASTM parser, lab middleware, DICOM print agent.

---

## 26. Notifications & Inbox

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/notifications.ts`, `push.ts`, `pushNotifications.ts`, `inbox.ts` | In-app notifications, push, inbox |
| Frontend | `web/src/pages/NotificationsCenter.tsx`, `InboxPage.tsx` | Notification UIs |
| Tests | `test/notifications.test.ts` | — |

**Features:** in-app notifications, email (Resend), SMS (SSL Wireless / bNotify), Web Push API, PWA push, inbox messaging, mark as read.

---

## 27. Settings, Configuration, Subscription

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/settings.ts`, `priceCategories.ts`, `payment-methods.ts`, `departments.ts`, `printTemplates.ts`, `settings-import-export.ts`, `mfa.ts`, `permissions.ts`, `users.ts` | Settings, pricing, payments, departments, print templates, MFA, permissions, user mgmt |
| Frontend | `web/src/pages/SettingsPage.tsx`, `SystemPreferences.tsx`, `EmailSettings.tsx`, `PrintTemplateSettings.tsx`, `DepartmentsSettings.tsx`, `SecuritySettings.tsx`, `DiscountRulesSettings.tsx`, `ImportExportSettings.tsx`, `PermissionManagement.tsx`, `PaymentMethodsSettings.tsx` | Settings UIs |
| Middleware | `src/middleware/subscription.ts` | Subscription gating |
| Tests | `test/permissions.test.ts` (within `test/security/` and `test/rbac-*`) | — |

**Features:** hospital branding (logo, name, contact), per-tenant settings, branch management, custom branding, per-tenant sequence counters, price categories, payment methods, departments, print templates, email settings, security settings, discount rules, import/export, system preferences, MFA, dynamic RBAC permissions, user management.

---

## 28. Marketing & Growth

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Backend routes | `src/routes/tenant/marketingReferral.ts`, `src/routes/marketplace.ts`, `src/routes/marketplace-admin.ts`, `src/routes/marketplace-patient.ts`, `src/routes/marketplace-reviews.ts` | Marketing referrals, marketplace (admin/patient/reviews) |
| Frontend | `web/src/pages/MarketingReferral.tsx`, `MarketplaceLanding.tsx`, `web/src/pages/marketplace/{DoctorDirectory,DoctorProfile,HospitalDirectory,HospitalProfile,MarketplaceBookingQueue,ReviewModerationPage}.tsx` | Marketing UI |
| Libraries | `src/lib/marketplace-helpers.ts` | — |
| Tests | `test/marketplace-booking.test.ts`, `marketplace-reviews.test.ts`, `marketplace-search.test.ts` | — |

**Features:** marketing referral program, agent referral commissions, public marketplace, hospital & doctor directories, location-based search, provider reviews, review moderation, marketplace booking queue, marketplace admin.

---

## 29. Authorization, Security & Compliance

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Middleware | `src/middleware/{auth.ts,tenant.ts,rbac.ts,csrf.ts,security.ts,rate-limit.ts,audit.ts,subscription.ts,ai-guard.ts}` | Auth, tenant, RBAC, CSRF, security, rate limit, audit, subscription, AI guard |
| Libraries | `src/lib/security.ts`, `src/lib/request-idempotency.ts`, `src/lib/token-blacklist.ts`, `src/lib/sentry.ts`, `src/lib/server-error-logging.ts`, `src/lib/bangladesh-phone.ts` | Security helpers, idempotency, sentry, error logging, BD phone validation |
| Tests | `test/security.test.ts`, `rbac-authorization.test.ts`, `rbac-route-middleware.test.ts`, `accessibility-ratelimit.test.ts`, `chaos-engineering.test.ts`, `concurrency.test.ts`, `tenant-isolation.test.ts`, `module7-user-control-audit.test.ts`, `resilience.test.ts`, `performance.test.ts`, `compliance.test.ts`, `pdf-xss.test.ts`, `schema-validation.test.ts`, `regression.test.ts`, `edge-cases.test.ts`, `edge-cases-comprehensive.test.ts`, `ui-wiring-audit.test.ts` | — |

**Features:** JWT, bcrypt 10 rounds, 7-tier RBAC + dynamic permissions, CSRF origin guard, rate limiting (KV per-IP/tenant), payment idempotency, audit logging (immutable), CSP headers, HSTS, X-Frame-Options, X-XSS-Protection, Referrer-Policy, Permissions-Policy, CORS, Sentry (`toucan-js`), error logging, tenant isolation verified, chaos engineering, concurrency tests, resilience tests, performance tests, compliance tests, PDF XSS prevention, schema validation.

---

## 30. i18n / Localization Module

| Layer | File(s) | Purpose |
|-------|---------|---------|
| Locales | `web/public/locales/{en,bn}/` (multiple JSON files) | i18next translation |
| Setup | `web/src/lib/i18n.ts`, `bengaliNumbers.ts` | i18next config, Bengali numerals |
| Coverage | 1946 tests pass for i18n (per `feedback` memory) | 1660+ keys, 6 new namespaces |
| Tests | `test/accounting-i18n.test.ts`, `disaster-recovery-i18n.test.ts`, `patient-portal-i18n.test.ts`, `test/i18n/` | — |

**Languages:** English (EN), Bengali (বাংলা / BN).

---

## 31. Testing, CI/CD, Quality Infrastructure

| Layer | Files / Tooling |
|-------|----------------|
| Test runner | `vitest.config.ts`, `vitest.config.real.ts`, `vitest.workers.config.ts`, `vitest.config.integration.ts` (4 configs) |
| Test files | 330+ files in `test/` |
| Unit / integration | `test/integration/`, `test/unit/`, `test/utils/`, `test/workers/`, `test/security/`, `test/generated/`, `test/integration/{data-integrity,edge-cases}/` |
| E2E | `playwright.config.ts`, `e2e/` (Playwright) — `test:e2e`, `test:e2e:smoke`, `test:e2e:api`, `test:e2e:browser` |
| Load | `load-tests/k6-{smoke,load,stress}.js` — k6 with `test:load`, `test:load:billing`, `test:load:concurrent`, `test:load:spike`, `test:load:endurance` |
| Real-DB | `test/integration/real-db/setup.sh`, `vitest.config.real.ts`, `test:real` |
| Smoke | `test/smoke/deploy-smoke.ts`, `test:smoke:deploy` |
| Prod checks | `scripts/prod-authenticated-checks.mjs` |
| Coverage | `@vitest/coverage-v8`, `test:coverage`, `test:coverage:all` |
| Super-admin tests | `scripts/run-super-admin-tests.sh` |
| Migration manifest | `scripts/build-migration-manifest.ts`, `scripts/upload-schema-migration-manifest.ts` |
| Visual regression | `test/visual-regression.test.ts` |
| Accessibility | `test/accessibility-wcag.test.ts`, `test/accessibility-ratelimit.test.ts` |
| Frontend wiring | `test/ui-wiring-audit.test.ts` |
| CI/CD | `.github/` |
| Migrations | `scripts/apply-migrations.sh` |
| Backup & recovery | `docs/backup-recovery-runbook.md` |

**Total test files:** 330+ covering unit, integration, E2E (Playwright), load (k6), smoke, visual regression, accessibility, UI wiring.

---

## 32. Database Migrations

- **Total migrations:** 346 SQL files in `migrations/` (D1-compatible SQLite).
- **Plus:** `apply_0143_0148_safe.sql`, `fix_corrupted_transactions.sql`, `processed/` (16 files), `seed_*.sql` (4 files).
- **Schema management:** Drizzle ORM (`drizzle.config.ts`, `src/db/schema/*.ts`), `src/db/schema/schema.ts` (508KB main file), `relations.ts`, `meta/0000_snapshot.json`, `_journal.json`.
- **Schema files:** `schema.ts`, `clinicalMar.ts`, `mpi.ts`, `healthCards.ts`, `terminology.ts`, `relations.ts`, `index.ts`, `approval-requests.ts`, `bill-versions.ts`, `doctor.ts`, `finance.ts`, `shift-closings.ts`, `meta/`.
- **Generated manifest:** `src/data/schema-migrations.generated.ts`, `scripts/build-migration-manifest.ts`.

**Migration groups (by era):**

| Era | Migrations | What they cover |
|-----|-----------|-----------------|
| Foundation 0001-0049 | Schema fix, invitations, ICD-10, payment gateway, multi-branch, telemedicine, appointments, prescriptions, lab, notifications, vitals, discharge, insurance, AI memory, pharmacy sales, push subs, lab enhancements, onboarding, patient portal, lab critical thresholds, subs, hospital website, website analytics, emergency, OT, clinical enhancements, advanced billing, shareholders, inventory, patient columns, doctors email, visits columns, emergency type, billing master, lab settings, insurance depth, shareholder constraints, distributions, nursing, e-prescribing, HR, performance indexes | Core HMS, billing, IPD, lab, pharmacy, HR, nursing, e-prescribing |
| Specializations 0050-0100 | Clinical assessments, MAR, medical records, MR cert unique, MAR audit, radiology, radiology fixes, pharmacy v2, master drugs, drugs data, pharmacy tax, pharmacy phase3, invitation hardening, LIS enterprise, patient magic links, Bengali intake, blog reviews, custom domains, SOAP templates, portable health records, clinical forms, UHID, tier 1-4 ports, duty roster, OPD queue tokens, asset AMC, kitchen, blood bank, MLC, CSSD, MFA, laundry, housekeeping, ambulance, mortuary, patient duplicate merge, WhatsApp, global patient auth, print templates, discharge planning, patient auth hardening, biomedical waste, B2C patient vault, blood donor link, consent v2, central terminology, terminology seed, MPI hardening | Module-by-module expansion |
| Global Health 0100-0150 | Unmerge, health cards, lab LOINC, merge map, consent clinical, global identity claims, identity nullable, claim codes, clinical review, consent purpose defaults, patient reported experience, visit passes, global family links, family proxy, vault R2 uploads, wallet export, clinical provenance, global vitals, identity prod hotfix, marketplace columns, patient AI plans, doctor columns, plan progress, marketplace bookings, reviews, doctor auth, marketplace indexes, lifestyle water/medicine, drug indexes, reminder strength, health tips feedback, global reported bootstrap, wellness profile, wellness logs, food system, AI insights, hospital linking, user devices, barcode foods, wearable samples, mental health screenings, cycle meditation, walking challenges, onboarding progress, patient amendments, patient devices, LIS full upgrade, lab signatories, clinical reminders, dynamic RBAC, order sets, consent documents KPI, clinical notes images, AI addon, maternity, AI summaries, dental, wardsupply, helpdesk, cross-hospital referrals, HR leave rejection, health articles, visit services, procedure billing, danphe billing gaps, bed auto charges, lab consumables, lab formula ranges, lab machine orders, QC calibrations, SMS machine QC validation, validation rules, machine downtime, appointment checkin, source, patients email DOB, admission guardian, admission cancel, discharge cancel fields, condition types, enhanced discharge summary, diagnostic LIS RIS readiness, provisional discharge, death details, nursing sprint 3, patient card QR tokens, inventory production grade, danphe operational gap, nursing IPD full build, fix appointment audit | Patient portal, marketplace, global identity, LIS, RBAC, dental, maternity, etc. |
| Accounting/Finance 0186-0245 | Inventory production grade, accounting foundation tables, cost centers & subledgers, voucher types, doctor lab finance, lab cancellation, referring doctor to bills, expand commission types, doctor commission settlements, incentive splitting, accounting posting core, expand event types, journal line dimensions, payment idempotency, inventory pharmacy GL expansion, accounting audit hardening, subledger engine link, billing invoice idempotency, supplier payment, inventory GR accounting, doctor profile columns, default accounting FY, billing counter sessions, counter active session guards, deposit counter linkage, reconcile zero discharge bed charges, counter link settlements credit notes, FY period lock sync, shareholder dividend accounting, repair shareholder payable, ensure line immutability, normalize doctor consultation fees, billing mutation idempotency, direct income expense accounting, reclassify doctor fee normalization, tenant-scoped account mappings, appointment billing handoff, unify billing price categories, bills payment method, procedure to invoice items, seed accounting mappings, lab order items source, patient inbox hot path, sync lab catalog, basic daily flow, billing handover counter session, cash handover accounting, payment method asset mappings, expand doctor appointment fee types, agent referral commission accounting, pharmacy invoice counter session, audit log immutability, reception doctor daily status, reception doctor status enhanced, reception hot path, patient UHID tenant unique, doctor appointment eligibility days, diagnostic catalog single source, active uniqueness, price map backfill, backfill lab test categories, billing service item usage, doctors user id, LIS workflow completion, expense receipt photo, inventory complete workflow, seed common lab catalog, external referring doctors, inventory GR other charges, billing catalog tenant guards, pharmacy inventory bridge, reorder config, seed accounting defaults, stock reservation | Heavy accounting hardening |
| Advanced 0246-0298 | Billing credit bill status, handover enhancements, fraction incentive system, IPD gap fill, consultation prescription link, HR gaps dept weekend policy, bill tax columns, dose templates, user management fields, advice templates, audit action expansion, bill discount audit, credit note approval, bill status on discharge, expand audit action check, nursing emergency alerts, visit services admission id, billing counter internal transfers, default hospital websites, prescription lock version, overrides, medication fulfillment orders, doctor certificates, housekeeping task bed link, nursing respiratory, admissions nurse id, approval billing shift tables, bank transactions, payment methods table, discount by name, admission fee, package billing fields, discount by name universal, IPD ledger blind close, IPD billing categories, cash counter monitoring, billing counter workstation lock, token reservations, local sync foundation, prescription doctor usage stats, token reservation date range, OT blueprint foundation, OT anesthesia logs, cash drawer cash drop, bills referred by hospitals, flexible token serial, patient optional mobile | Final polish, hardening, additional modules |
| Local Sync 0336-0346 | Local schema sync tables, sync payloads, prescription lab order pending billing, backfill prescription lab test usage, bills general referrer, local cloud pull sync, bank deposit custody, doctor invitation linking, staff extended fields, leave request requested to, users photo URL mobile | Local server sync layer |

---

## 33. Infrastructure / Cloudflare

| Resource | Details |
|----------|---------|
| **API** | Cloudflare Workers (Hono) — single worker |
| **Database** | Cloudflare D1 (SQLite) — `hms-super-admin-production` + staging |
| **Cache / Sessions / Rate Limit** | Cloudflare KV — prod + staging namespaces |
| **File Storage** | Cloudflare R2 — `hms-uploads-production`, `hms-uploads-staging` |
| **AI / Vectorize** | Cloudflare AI + Vectorize index `hms-ai-memory` |
| **Frontend** | Cloudflare Pages (React 19 + Vite) — `web/`, `admin-panel/`, `landing/` |
| **Email** | Resend API (`RESEND_API_KEY` secret) |
| **SMS** | Stub mode; SSL Wireless / bNotify ready |
| **Mobile payments** | bKash + Nagad secrets ready |
| **Video** | Cloudflare Realtime SFU secrets ready |
| **CI/CD** | GitHub Actions: deploy + Android APK + iOS build |
| **Durable Object** | `src/do/dashboard-state.ts` (`DashboardDO`) |
| **Scheduled** | `src/scheduled.ts` referenced in `app.route(...)` (currently imported) |
| **Worker config** | `wrangler.toml` |
| **Worker types** | `worker-configuration.d.ts` (512KB generated) |
| **Deploy scripts** | `scripts/local-server/*`, `scripts/apply-migrations.sh`, `scripts/upload-schema-migration-manifest.ts` |
| **Health check** | `GET /api/health` and `GET /api/health/deep` |
| **Local server status** | `GET /api/local-server/status` |

**Environments:** `top-level` (dev), `--env staging`, `--env production`.

---

## 34. Schema / DB Tables — Quick Map

The Drizzle schema (`src/db/schema/schema.ts`, 508KB) defines hundreds of tables. The Drizzle-generated migration log lives in `drizzle/0000_snapshot.json` + `_journal.json`. From migrations + analysis, the table families are:

**Core clinical:** `patients`, `users`, `visits`, `appointments`, `consultations`, `admissions`, `beds`, `departments`, `staff`, `doctors`, `wards`, `vitals`, `physical_exam`, `allergies`, `vaccinations`, `patient_reported_data`, `care_plans`, `problem_list`, `diagnoses`, `clinical_assessments`, `clinical_mar`.

**Nursing:** `nur_care_plans`, `nur_notes`, `nur_medication_admin`, `nur_intake_output`, `nur_patient_monitoring`, `nur_iv_drugs`.

**Pharmacy:** `prescriptions`, `prescription_items`, `master_drugs`, `pharmacy_sales`, `pharmacy_inventory`, `dispensary_stock`, `pharmacy_invoices`, `pharmacy_purchase_orders`, `pharmacy_goods_receipt`, `pharmacy_suppliers`, `pharmacy_categories`, `pharmacy_generics`, `pharmacy_narcotic_register`, `pharmacy_write_off`, `pharmacy_returns`, `pharmacy_deposits`, `pharmacy_settlements`, `pharmacy_dosage_templates`, `pharmacy_tax_config`.

**Lab:** `lab_orders`, `lab_results`, `test_catalog`, `lab_settings`, `loinc_codes`, `lab_machines`, `lab_machine_downtime`, `lab_calibrations`, `lab_components`, `lab_qc`, `lab_workflow`, `lab_validation`, `lab_barcodes`, `lab_consumables`, `lab_requisitions`, `lab_signatories`.

**Radiology:** `radiology_orders`, `radiology_reports`, `radiology_dicom`, `radiology_pacs`, `radiology_catalog`, `radiology_film_types`, `radiology_report_templates`.

**Inventory:** `inventory_items`, `inventory_stock`, `purchase_orders`, `goods_receipt`, `vendors`, `stores`, `stores_stock`, `asset_management`, `inventory_reservations`, `inventory_adjustments`, `inventory_donations`, `inventory_transfers`, `inventory_count_sessions`, `inventory_write_off`, `inventory_dispatch`, `inventory_requisitions`, `inventory_rfq`.

**Billing:** `billing`, `billing_items`, `insurance_claims`, `payments`, `deposits`, `fee_sheet`, `provisional_billing`, `credit_notes`, `settlements`, `bill_versions`, `billing_counter_sessions`, `price_categories`, `payment_methods`, `bill_tax`, `cancelled_bills`, `bill_discount_audit`.

**HR:** `attendance`, `biometric_logs`, `leaves`, `payroll`, `duty_roster`, `staff_extended`, `staff_photos`.

**Accounting:** `chart_of_accounts`, `journal_entries`, `expenses`, `income`, `shareholders`, `recurring_expenses`, `cost_centers`, `sub_ledgers`, `fiscal_years`, `fiscal_year_periods`, `vouchers`, `account_mappings`, `voucher_types`.

**IPD:** `admissions`, `beds`, `bed_types`, `discharge_summaries`, `ipd_charges`, `ipd_running_bills`, `admission_guardians`, `nurse_assignments`.

**Operation Theatre:** `ot_bookings`, `ot_anesthesia_logs`, `ot_procedures`, `procedure_orders`.

**Emergency:** `emergency_visits`, `triage_records`, `emergency_profiles`.

**Maternity:** `maternity_patients`, `maternity_anc_visits`, `maternity_delivery`, `maternity_newborns`, `maternity_pnc_visits`.

**Cross-cutting:** `audit_logs`, `invitations`, `notifications`, `push_subscriptions`, `user_accounts`, `mfa`, `tenants`, `mpi`, `health_cards`, `global_patient_links`, `patient_vault`, `consent_records`, `global_family_links`, `wellness_profiles`, `food_system`, `wearable_data`, `sequence_counters`, `sequence_counters_branches`, `global_patient_vitals`, `clinical_provenance_sources`, `patient_amendments`, `patient_devices`, `share_token_prescriptions`, `prescription_share_tokens`, `prescription_fulfilment`, `prescription_override_audit`, `prescription_lock_version`, `prescription_usage_stats`, `prescription_doctor_usage_stats`, `doctor_certificates`, `medical_records`, `clinical_images`, `clinical_encounters`, `clinical_notes`, `clinical_reminders`, `medication_reminders`, `lifestyle_water_logs`, `lifestyle_medicine_logs`, `lifestyle_sleep_logs`, `lifestyle_activity_logs`, `achievements`, `streaks`, `goals`, `walking_challenges`, `cycle_tracking`, `meditation_logs`, `mental_health_screenings`, `food_diary`, `food_photo_ai`, `health_tips`, `health_tips_feedback`, `health_articles`, `patient_reported_experience`, `wallet_export_snapshots`, `terminology`, `terminology_seed`, `consent_clinical_areas`, `consent_purpose_defaults`, `merge_map`, `unmerge_log`, `global_identity_claims`, `patient_claim_codes`, `clinical_review_status`, `patient_visit_passes`, `visit_pass_redeems`, `global_family_proxy_invites`, `patient_vault_r2_uploads`, `claim_codes`, `barcode_foods`, `wearable_samples`, `marketplace_tenant_columns`, `marketplace_doctor_columns`, `marketplace_bookings`, `provider_reviews`, `marketplace_indexes`, `doctor_auth`, `master_drugs_nocase`, `patient_medicine_reminder_strength`, `patient_ai_plans`, `patient_ai_plan_progress`, `lifestyle_water_and_medicine`, `onboarding_progress`, `patient_amendments`, `patient_devices`, `lab_signatories_delta`, `order_sets`, `consent_documents_kpi`, `cross_hospital_referrals`, `patient_hospital_links`, `hospital_links`, `user_devices`, `patient_vault`, `patient_card_qr_tokens`, `track_anything`, `visit_services_layer`, `procedure_billing_items`, `danphe_billing_gaps`, `bed_auto_charges`, `lab_consumables_monitoring`, `lab_formula_reference_ranges`, `lab_machine_orders`, `lab_sms_machine_qc_validation`, `lab_qc_calibrations`, `lab_validation_rules`, `lab_machine_downtime`, `appointment_checkin`, `appointment_source`, `patients_email_dob`, `admission_guardian_fields`, `admission_cancel`, `discharge_cancel_fields`, `discharge_condition_types`, `enhanced_discharge_summary_fields`, `diagnostic_lis_ris_readiness`, `provisional_discharge`, `death_details`, `nursing_sprint3`, `inventory_production_grade`, `danphe_operational_gap_closure`, `nursing_ipd_fullbuild`, `fix_appointment_audit_constraints`, `accounting_foundation_tables`, `cost_centers_and_subledgers`, `voucher_types_and_numbering`, `doctor_lab_finance`, `lab_cancellation_reference_indexes`, `referring_doctor_to_bills`, `expand_commission_types`, `doctor_commission_settlements`, `incentive_splitting`, `accounting_posting_core`, `accounting_journal_line_dimensions`, `payment_idempotency`, `inventory_pharmacy_gl_expansion`, `accounting_audit_hardening`, `subledger_engine_link`, `billing_invoice_idempotency`, `supplier_payment_accounting_event`, `inventory_goods_receipt_accounting_status`, `doctor_profile_operational_columns`, `default_accounting_fiscal_year`, `billing_counter_sessions`, `billing_counter_active_session_guards`, `billing_deposit_counter_linkage`, `reconcile_zero_discharge_bed_charges`, `counter_link_settlements_credit_notes`, `fiscal_year_period_lock_sync`, `shareholder_dividend_accounting`, `repair_shareholder_payable_mapping`, `ensure_accounting_line_immutability`, `normalize_doctor_consultation_fees`, `billing_mutation_idempotency`, `direct_income_expense_accounting`, `reclassify_doctor_fee_normalization_dates`, `tenant_scoped_account_mappings`, `appointment_billing_handoff`, `unify_billing_price_categories`, `bills_payment_method_and_remarks`, `counter_type_check`, `procedure_to_invoice_items_category`, `seed_accounting_mappings`, `lab_order_items_source_column`, `patient_inbox_hot_path_indexes`, `sync_lab_catalog_to_billing`, `basic_daily_flow_appointment_cash`, `billing_handover_counter_session`, `cash_handover_accounting`, `payment_method_asset_mappings`, `expand_doctor_appointment_fee_types`, `agent_referral_commission_accounting`, `pharmacy_invoice_counter_session`, `audit_log_immutability`, `reception_doctor_daily_status`, `reception_doctor_status_enhanced`, `reception_hot_path_indexes`, `patient_uhid_tenant_unique`, `doctor_appointment_eligibility_days`, `diagnostic_catalog_single_source`, `diagnostic_catalog_active_uniqueness`, `diagnostic_price_map_backfill`, `backfill_lab_test_categories_from_catalog`, `billing_service_item_usage_stats`, `doctors_user_id`, `lis_workflow_completion`, `expense_receipt_photo`, `inventory_complete_workflow`, `seed_common_lab_catalog`, `external_referring_doctors`, `inventory_gr_other_charges`, `billing_catalog_tenant_guards`, `pharmacy_inventory_bridge`, `reorder_config`, `seed_accounting_defaults_for_existing_tenants`, `stock_reservation`, `billing_credit_bill_status`, `handover_enhancements`, `fraction_incentive_system`, `ipd_gap_fill`, `consultation_prescription_link`, `hr_gaps_department_weekend_policy`, `bill_tax_columns`, `dose_templates`, `user_management_fields`, `advice_templates`, `audit_action_expansion`, `bill_discount_audit`, `credit_note_approval`, `bill_status_on_discharge`, `expand_audit_action_check`, `nursing_emergency_alerts`, `visit_services_admission_id`, `billing_counter_internal_transfers`, `default_hospital_websites`, `prescription_lock_version`, `prescription_overrides`, `medication_fulfilment_orders`, `doctor_certificates`, `housekeeping_task_bed_link`, `nursing_respiratory`, `admissions_nurse_id`, `approval_billing_shift_tables`, `bank_transactions`, `payment_methods_table`, `discount_by_name`, `admission_fee`, `package_billing_fields`, `discount_by_name_universal`, `ipd_ledger_and_blind_close`, `ipd_billing_categories`, `cash_counter_monitoring_enhancements`, `billing_counter_workstation_lock`, `token_reservations`, `local_sync_foundation`, `prescription_doctor_usage_stats`, `token_reservation_date_range`, `ot_blueprint_foundation`, `ot_anesthesia_logs`, `cash_drawer_cash_drop_movement`, `bills_referred_by_and_hospitals`, `flexible_token_serial`, `patient_optional_mobile`, `local_schema_sync_tables`, `local_sync_payloads`, `prescription_lab_order_pending_billing`, `backfill_prescription_lab_test_usage_stats`, `bills_general_referrer_name`, `local_cloud_pull_sync`, `bank_deposit_custody`, `doctor_invitation_linking`, `staff_extended_fields_email`, `leave_request_requested_to`, `users_photo_url_and_mobile`.

---

## 35. External Tools & Helper Agents (`tools/`)

- `tools/dicom-print-agent/` — DICOM print service for radiology
- `tools/hl7-agent/` — HL7 listener service for lab integration
- `tools/lab-middleware/` — Lab machine integration middleware
- `tools/generate-rbac-tests.ts` — RBAC test generator

---

## 36. Documentation (40+ files in `docs/`)

| File | Topic |
|------|-------|
| `ECOSYSTEM_ARCHITECTURE_REVIEW.md` | Full ecosystem review |
| `ECOSYSTEM_TODO.md` | Ecosystem TODOs |
| `HMS_MATURITY_REPORT_2026-04-20.md` | Maturity report |
| `LIS_COMPARISON_HMS_vs_OPENEMR.md` | LIS vs OpenEMR |
| `P2-known-issues.md` | P2 issues |
| `PRODUCTION_READINESS_REPORT.md` | Production readiness |
| `WEB_PLATFORM_SCOPE.md` | Web platform scope |
| `accounting-api.md` | Accounting API |
| `admin-panel-pending-issues.md` | Admin panel issues |
| `android-signing-secrets.md` | Android signing |
| `backup-recovery-runbook.md` | Backup runbook |
| `billing-accounting-danphe-parity-audit-2026-05-10.md` | Parity audit |
| `cash-management-blueprint.md` | Cash mgmt |
| `danphe-operational-module-gap-analysis.md` | Danphe gap |
| `doctor-module-guide-bn.md` | Doctor guide BN |
| `ehr-gap-analysis.md` | EHR gap |
| `financial-system-review.md` | Finance review |
| `future-health-card-qr-production-hardening.md` | Health card QR |
| `hospital-website-plan.md` | Website plan |
| `inventory-danphe-gap-review.md` | Inventory vs Danphe |
| `md-dashboard-guide.md` | MD dashboard |
| `native/` | Native app docs |
| `operations/` | Operations docs |
| `optimization-backlog.md` | Optimization |
| `ot-blueptint.md` | OT blueprint |
| `ozzyl-admin-panel-blueprint.md` | Admin panel |
| `ozzyl-admin-panel-interface-blueprint.md` | Admin panel UI |
| `ozzyl-admin-panel-progress.md` | Admin panel progress |
| `ozzyl-health-mobile-a-z-checklist-2026-05-01.md` | Mobile checklist |
| `patient-portal-next-steps-2026-04-11.md` | Patient portal |
| `pharmacy-remaining-tasks.md` | Pharmacy TODO |
| `phase3-roadmap.md` | Phase 3 roadmap |
| `plans/` | Plans |
| `pre-production-patient-ecosystem-report-2026-04-11.md` | Patient ecosystem |
| `production-patient-auth-schema-fix.md` | Auth schema fix |
| `proposals/` | Proposals |
| `rbac-permission-matrix.md` | RBAC matrix |
| `reception-api-contracts.md` | Reception API |
| `reception-service-test-billing-readiness-2026-05-11.md` | Billing readiness |
| `sprint-8-14-completion.md` | Sprint completion |
| `superpowers/` | Superpowers |

---

## 37. Role Matrix (from `feature-list.md`)

| Role | Patients | Billing | Lab | Pharmacy | IPD | Accounting | Staff | AI |
|------|:--------:|:-------:|:---:|:--------:|:---:|:----------:|:-----:|:--:|
| `super_admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `hospital_admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `doctor` | 👁️ read | — | ✅ order | — | — | — | — | ✅ |
| `nurse` | ✅ | — | ✅ collect | ✅ dispense | ✅ | — | — | — |
| `reception` | ✅ | ✅ collect | — | — | — | — | — | — |
| `accountant` | — | ✅ | — | — | — | ✅ | — | — |
| `director` | 👁️ | 👁️ | — | — | — | ✅ view | — | — |
| `md` | ✅ view | ✅ view | — | — | ✅ view | ✅ view | 👁️ | — |
| `lab` | — | — | ✅ | — | — | — | — | — |
| `pharmacist` | — | ✅ | — | ✅ | — | — | — | — |

---

## Summary Counts

| Asset | Count |
|-------|-------|
| Backend route files | ~210 (top-level + `tenant/*`, `admin/*`, `public/*`, `local-server/*`) |
| Frontend pages (root + sub-folders) | ~177 root + ~95 in sub-folders (pharmacy, accounting, admin, inventory, marketplace, doctor, etc.) = ~270+ |
| Frontend components | ~150+ (with tests) across 17 sub-folders |
| Drizzle schema files | 13 |
| Migrations | 346 |
| Test files | 330+ |
| Documentation files | 40+ |
| Helper agents | 3 (DICOM, HL7, lab-middleware) |
| Workspace packages | 5 (web, admin-panel, apps/api, apps/ozzyl-lifestyle, packages/*) |

---

## Module Roster (for review — used in `REVIEW.md`)

The following 37 module groups will each be reviewed in `REVIEW.md` and findings will be tracked:

1. Auth & Session
2. Patient Management
3. Reception / OPD / Queue
4. Doctor Module
5. IPD / Inpatient
6. Laboratory
7. Radiology
8. Pharmacy
9. Billing & Payments
10. Accounting & Finance
11. Inventory
12. Nursing
13. HR / Staff / Payroll
14. Operations & Facilities (14 sub-modules: OT, Emergency, Housekeeping, Laundry, Kitchen, CSSD, Ambulance, Mortuary, Death Records, Blood Bank, MLC, Maternity, Dental, Eye Exam, CAMOS, Biomedical Waste, WardSupply, Helpdesk, Asset Management, Devices, Psychiatry, Dictation, Requisitions, Group Attendance)
15. Clinical
16. Quality, Compliance & Audit
17. Reports & Analytics
18. Telemedicine & Communication
19. AI / Intelligence
20. Multi-Tenancy, Branch, Onboarding & Marketplace
21. Cross-Hospital Referrals, Consent, Patient Identity
22. Patient-Facing Apps (Ozzyl Lifestyle + Ozzyl Health)
23. Admin Panel (Super-Admin)
24. Local Server (Edge / Offline Mode)
25. Integration & Interoperability
26. Notifications & Inbox
27. Settings, Configuration, Subscription
28. Marketing & Growth
29. Authorization, Security & Compliance
30. i18n / Localization
31. Testing, CI/CD, Quality Infrastructure
32. Database Migrations
33. Infrastructure / Cloudflare
34. Schema / DB Tables
35. External Tools & Helper Agents
36. Documentation
37. Role Matrix & Authorization

*End of README-MODULES.md*
