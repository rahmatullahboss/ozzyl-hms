# Hospital Admin Panel — Full UI/UX Review

**Date:** 2026-05-25
**Stack:** React 19 + Tailwind CSS v4 + React Router v7 + TanStack Query + Recharts + Lucide Icons + react-hot-toast + react-i18next
**Base URL:** `/h/:slug/*`
**Roles:** hospital_admin, doctor, nurse, reception, laboratory, pharmacist, accountant, md, director, super_admin

---

## 1. Inventory — What's Currently in the Hospital Admin Panel

### 1.1 Pages by Module (100+ pages)

**Dashboard (1)**
| Page | Route | Purpose |
|------|-------|---------|
| HospitalAdminDashboard | `/h/:slug/dashboard` | KPI cards, finance controls, quick actions, today summary, patient/bed/financial/lab/pharmacy summaries, charts, recent activity |

**Patient Management (8)**
| Page | Route | Purpose |
|------|-------|---------|
| PatientList | `/h/:slug/patients` | Searchable patient list |
| PatientForm | `/h/:slug/patients/new` | New patient registration |
| PatientDetail | `/h/:slug/patients/:id` | Patient detail view |
| PatientTimeline | `/h/:slug/patients/:id/timeline` | Patient activity timeline |
| PatientChartWorkspace | `/h/:slug/patients/:id/chart` | Clinical chart workspace |
| PatientChartPrint | `/h/:slug/patients/:id/chart/print` | Print patient chart |
| PatientPortal | `/h/:slug/patient-portal` | Patient self-service portal |
| PatientDuplicates | `/h/:slug/patient-duplicates` | Duplicate patient detection |

**Clinical (20+)**
| Page | Route | Purpose |
|------|-------|---------|
| ConsultationNotes | `/h/:slug/consultation-notes` | Doctor consultation notes |
| DigitalPrescription | `/h/:slug/prescriptions/new` | Digital prescription writing |
| PrescriptionPrint | `/h/:slug/prescriptions/:id/print` | Print prescription |
| LabTestOrderForm | `/h/:slug/lab/order/new` | Order lab tests |
| MedicineDispensing | `/h/:slug/pharmacy/dispensing` | Pharmacy dispensing |
| NurseStation | `/h/:slug/nurse-station` | Nurse station dashboard |
| DischargeSummary | `/h/:slug/admissions/:id/discharge` | Discharge summary |
| VitalsPage | `/h/:slug/vitals` | Patient vitals recording |
| AllergiesPage | `/h/:slug/allergies` | Patient allergies |
| ClinicalAssessments | `/h/:slug/clinical` | Clinical assessments |
| ClinicalRemindersPage | `/h/:slug/clinical-reminders` | Clinical reminders |
| Dental | `/h/:slug/dental` | Dental module |
| Psychiatry | `/h/:slug/psychiatry` | Psychiatry module |
| EyeExamDashboard | `/h/:slug/eye-exam` | Eye examination |
| PhysicalExamDashboard | `/h/:slug/physical-exam` | Physical examination |
| DictationPage | `/h/:slug/dictation` | Voice dictation |
| CarePlansDashboard | `/h/:slug/care-plans` | Care plans |
| TrackAnythingDashboard | `/h/:slug/track-anything` | Custom tracking |
| PriorAuthDashboard | `/h/:slug/prior-auth` | Insurance prior auth |
| ProcedureOrdersDashboard | `/h/:slug/procedure-orders` | Procedure orders |
| QuestionnairesPage | `/h/:slug/questionnaires` | Clinical questionnaires |
| CustomFormBuilder | `/h/:slug/form-builder` | Custom form builder |
| HealthRecordSharing | `/h/:slug/health-records` | Health record sharing |
| PatientCardScanner | `/h/:slug/patient-card-scan` | Patient card scanner |
| ImportExternalRecords | `/h/:slug/import-records` | Import external records |
| DischargePlanningPage | `/h/:slug/discharge-planning` | Discharge planning |
| Camos | `/h/:slug/camos` | Clinical assessment forms |

**Appointments & Queue (3)**
| Page | Route | Purpose |
|------|-------|---------|
| AppointmentScheduler | `/h/:slug/appointments` | Appointment scheduling |
| QueueDisplay | `/h/:slug/queue-display` | Public queue display |
| QueueManagement | `/h/:slug/queue-management` | Queue management |

**Admissions & IPD (5)**
| Page | Route | Purpose |
|------|-------|---------|
| AdmissionIPD | `/h/:slug/admissions` | IPD admissions |
| BedManagement | `/h/:slug/beds` | Bed management |
| IPDCharges | `/h/:slug/ipd-charges` | IPD charges |
| IPDReports | `/h/:slug/ipd-reports` | IPD reports |
| DeathRecords | `/h/:slug/death-records` | Death records |

**Billing & Payments (18)**
| Page | Route | Purpose |
|------|-------|---------|
| BillingDashboard | `/h/:slug/billing` | Billing overview |
| BillingCounterPage | `/h/:slug/billing-counter` | Billing counter |
| BillingMasterPage | `/h/:slug/billing-master` | Billing master data |
| ProvisionalBillingPage | `/h/:slug/billing-provisional` | Provisional billing |
| IPBillingPage | `/h/:slug/ip-billing` | IP billing |
| BillPrint | `/h/:slug/billing/:id/print` | Print bill |
| IPDRunningBillPrint | `/h/:slug/ip-billing/:id/running-print` | IPD running bill print |
| DepositsPage | `/h/:slug/deposits` | Patient deposits |
| CreditNotesPage | `/h/:slug/credit-notes` | Credit notes |
| PatientSettlementsPage | `/h/:slug/settlements` | Patient settlements |
| BillingHandoverPage | `/h/:slug/billing-handover` | Cash handover |
| BillCancellationPage | `/h/:slug/billing-cancellation` | Bill cancellation |
| InsuranceClaims | `/h/:slug/insurance-claims` | Insurance claims |
| InsuranceBillingPage | `/h/:slug/insurance-billing` | Insurance billing |
| PaymentsPage | `/h/:slug/payments` | Payments |
| CommissionManagement | `/h/:slug/commissions` | Doctor commissions |
| FeeSheet | `/h/:slug/fee-sheet` | Fee sheet management |
| OnlineAppointmentApproval | `/h/:slug/reception/online-approvals` | Online appointment approval |

**Pharmacy (30+)**
| Page | Route | Purpose |
|------|-------|---------|
| PharmacyOverview | `/h/:slug/pharmacy` | Pharmacy dashboard |
| PharmItemList | `/h/:slug/pharmacy/items` | Medicine items |
| PharmCategoryList | `/h/:slug/pharmacy/categories` | Medicine categories |
| PharmGenericList | `/h/:slug/pharmacy/generics` | Generic names |
| PharmSupplierList | `/h/:slug/pharmacy/suppliers` | Suppliers |
| PharmPurchaseOrderList | `/h/:slug/pharmacy/po` | Purchase orders |
| PharmPurchaseOrderForm | `/h/:slug/pharmacy/po/new` | New PO form |
| PharmGoodsReceiptList | `/h/:slug/pharmacy/grn` | Goods receipts |
| PharmGoodsReceiptForm | `/h/:slug/pharmacy/grn/new` | New GRN form |
| PharmStockList | `/h/:slug/pharmacy/stock` | Stock list |
| PharmInvoiceList | `/h/:slug/pharmacy/invoices` | Invoices |
| PharmInvoiceForm | `/h/:slug/pharmacy/invoices/new` | New invoice |
| PharmDepositList | `/h/:slug/pharmacy/deposits` | Pharmacy deposits |
| PharmSettlementList | `/h/:slug/pharmacy/settlements` | Pharmacy settlements |
| PharmPrescriptionList | `/h/:slug/pharmacy/prescriptions` | Prescriptions |
| PharmNarcoticRegister | `/h/:slug/pharmacy/narcotics` | Narcotic register |
| PharmWriteOffList | `/h/:slug/pharmacy/write-offs` | Write-offs |
| PharmDispatchList | `/h/:slug/pharmacy/dispatches` | Dispatches |
| PatientBillingPage | `/h/:slug/pharmacy/patient-billing` | Patient billing |
| InvoiceReceipt | `/h/:slug/pharmacy/invoices/:id/receipt` | Invoice receipt |
| StockReport | `/h/:slug/pharmacy/reports/stock` | Stock report |
| SalesReport | `/h/:slug/pharmacy/reports/sales` | Sales report |
| ExpiryReport | `/h/:slug/pharmacy/reports/expiry` | Expiry report |
| SupplierLedger | `/h/:slug/pharmacy/supplier-ledger` | Supplier ledger |
| DispensaryStock | `/h/:slug/pharmacy/dispensary-stock` | Dispensary stock |
| TaxConfigPage | `/h/:slug/pharmacy/tax-config` | Tax configuration |
| DosageTemplatesPage | `/h/:slug/pharmacy/dosage-templates` | Dosage templates |
| ApprovalQueuePage | `/h/:slug/pharmacy/approval-queue` | Approval queue |
| ItemPriceHistory | `/h/:slug/pharmacy/price-history` | Price history |

**Accounting (12)**
| Page | Route | Purpose |
|------|-------|---------|
| AccountingDashboard | `/h/:slug/accounting` | Accounting overview |
| IncomeList | `/h/:slug/income` | Income entries |
| ExpenseList | `/h/:slug/expenses` | Expense entries |
| RecurringExpenses | `/h/:slug/recurring` | Recurring expenses |
| ChartOfAccounts | `/h/:slug/accounts` | Chart of accounts |
| ShareholderManagement | `/h/:slug/shareholders` | Shareholders |
| JournalEntries | `/h/:slug/journal` | Journal entries |
| ProfitLoss | `/h/:slug/profit-loss` | P&L statement |
| FiscalYearSettings | `/h/:slug/fiscal-year-settings` | Fiscal year |
| VoucherVerification | `/h/:slug/voucher-verification` | Voucher verification |
| Reports | `/h/:slug/accounting/reports` | Accounting reports |
| AuditLogs | `/h/:slug/audit` | Accounting audit logs |

**Inventory (20+)**
| Page | Route | Purpose |
|------|-------|---------|
| InventoryDashboard | `/h/:slug/inventory` | Inventory overview |
| StockList | `/h/:slug/inventory/stock` | Stock list |
| StockAdjustment | `/h/:slug/inventory/stock/adjust` | Stock adjustment |
| PurchaseOrderList | `/h/:slug/inventory/po` | Purchase orders |
| PurchaseOrderForm | `/h/:slug/inventory/po/new` | New PO |
| GoodsReceiptList | `/h/:slug/inventory/gr` | Goods receipts |
| GoodsReceiptForm | `/h/:slug/inventory/gr/new` | New GR |
| RequisitionList | `/h/:slug/inventory/requisitions` | Requisitions |
| RequisitionForm | `/h/:slug/inventory/requisitions/new` | New requisition |
| DispatchList | `/h/:slug/inventory/dispatches` | Dispatches |
| DispatchForm | `/h/:slug/inventory/dispatches/new` | New dispatch |
| StockAdjustment | `/h/:slug/inventory/stock/adjust` | Stock adjustment |
| InventoryLedger | `/h/:slug/inventory/ledger` | Inventory ledger |
| InventoryTraceability | `/h/:slug/inventory/traceability` | Traceability |
| InventoryIssuePage | `/h/:slug/inventory/issues` | Issues |
| InventoryTransferPage | `/h/:slug/inventory/transfers` | Transfers |
| InventoryReturnPage | `/h/:slug/inventory/returns` | Returns |
| InventoryCountPage | `/h/:slug/inventory/counts` | Stock counts |
| InventoryReportsPage | `/h/:slug/inventory/reports` | Reports |
| InventoryWriteOffPage | `/h/:slug/inventory/write-off` | Write-offs |
| InventoryReturnToVendorPage | `/h/:slug/inventory/return-to-vendor` | Return to vendor |
| InventoryMasterDataPage | `/h/:slug/inventory/master-data` | Master data |
| InventoryRFQPage | `/h/:slug/inventory/rfq` | RFQ/Quotations |
| InventoryImportExportPage | `/h/:slug/inventory/import-export` | Import/Export |
| InventoryDonationPage | `/h/:slug/inventory/donations` | Donations |
| InventoryAccounting | `/h/:slug/inventory/accounting` | Inventory accounting |

**Specialty & Support (15+)**
| Page | Route | Purpose |
|------|-------|---------|
| EmergencyDashboard | `/h/:slug/emergency` | Emergency module |
| OTDashboard | `/h/:slug/ot` | Operation theatre |
| MaternityDashboard | `/h/:slug/maternity` | Maternity |
| BloodBankManagement | `/h/:slug/blood-bank` | Blood bank |
| MlcManagement | `/h/:slug/mlc` | Medico-legal cases |
| CssdManagement | `/h/:slug/cssd` | CSSD |
| LaundryManagement | `/h/:slug/laundry` | Laundry |
| HousekeepingManagement | `/h/:slug/housekeeping` | Housekeeping |
| AmbulanceManagement | `/h/:slug/ambulance` | Ambulance |
| MortuaryManagement | `/h/:slug/mortuary` | Mortuary |
| KitchenManagement | `/h/:slug/kitchen` | Kitchen |
| BiomedicalWasteManagement | `/h/:slug/biomedical-waste` | Biomedical waste |
| WardSupplyDashboard | `/h/:slug/ward-supply` | Ward supply |
| HelpdeskDashboard | `/h/:slug/helpdesk` | Helpdesk |
| AssetManagement | `/h/:slug/asset-management` | Asset management |

**HR & Staff (8)**
| Page | Route | Purpose |
|------|-------|---------|
| StaffPage | `/h/:slug/staff` | Staff management |
| HRDashboard | `/h/:slug/hr` | HR dashboard |
| LeaveManagement | `/h/:slug/hr/leave` | Leave management |
| DutyRoster | `/h/:slug/duty-roster` | Duty roster |
| AttendancePunch | `/h/:slug/attendance-punch` | Attendance |
| GroupAttendance | `/h/:slug/group-attendance` | Group attendance |
| InviteStaff | `/h/:slug/invitations` | Invite staff |
| PermissionManagement | `/h/:slug/permissions` | RBAC permissions |

**Settings & Admin (10)**
| Page | Route | Purpose |
|------|-------|---------|
| SettingsPage | `/h/:slug/settings` | Hospital settings |
| ProfilePage | `/h/:slug/profile` | User profile |
| WebsiteSettings | `/h/:slug/website` | Website settings |
| PrintTemplateSettings | `/h/:slug/print-templates` | Print templates |
| LabSettingsPage | `/h/:slug/lab-settings` | Lab settings |
| LabMachineSettings | `/h/:slug/lab-machines` | Lab machines |
| MfaSetup | `/h/:slug/mfa` | MFA setup |
| HospitalSetupWizard | `/h/:slug/setup` | Setup wizard |
| SystemAuditLog | `/h/:slug/system-audit` | System audit log |
| NotificationsCenter | `/h/:slug/notifications` | Notifications |

**Reports (7)**
| Page | Route | Purpose |
|------|-------|---------|
| ReportsDashboard | `/h/:slug/reports` | Reports overview |
| ReportLabPage | `/h/:slug/reports/lab` | Lab reports |
| ReportPharmacyPage | `/h/:slug/reports/pharmacy` | Pharmacy reports |
| ReportAppointmentPage | `/h/:slug/reports/appointments` | Appointment reports |
| ReceptionReportsPage | `/h/:slug/reception/reports` | Reception reports |
| LabMonitoringDashboard | `/h/:slug/lab/monitoring` | Lab monitoring |
| LabQcDashboard | `/h/:slug/lab/qc` | Lab QC |

**Telemedicine (2)**
| Page | Route | Purpose |
|------|-------|---------|
| TelemedicineDashboard | `/h/:slug/telemedicine` | Telemedicine overview |
| TelemedicineRoom | `/h/:slug/telemedicine/room/:id` | Video call room |

**Other (10+)**
| Page | Route | Purpose |
|------|-------|---------|
| AIAssistant | `/h/:slug/ai-assistant` | AI assistant |
| InboxPage | `/h/:slug/inbox` | Messaging inbox |
| MarketingReferral | `/h/:slug/marketing-referral` | Marketing referrals |
| IncomingReferralQueue | `/h/:slug/referrals` | Incoming referrals |
| CreateReferral | `/h/:slug/referrals/new` | Create referral |
| DoctorList | `/h/:slug/doctors` | Doctor list |
| DoctorDetail | `/h/:slug/doctors/:id` | Doctor detail |
| DoctorDashboard | `/h/:slug/doctor/dashboard` | Doctor dashboard |
| DoctorDashboardPage | `/h/:slug/doctors/dashboard` | Doctor personal dashboard |
| MultiBranchDashboard | `/h/:slug/multi-branch` | Multi-branch management |
| WhatsAppDashboard | `/h/:slug/whatsapp` | WhatsApp integration |
| QualityKpiDashboard | `/h/:slug/quality-kpi` | Quality KPIs |
| HelpCenterPage | `/h/:slug/help` | Help center |
| TriageChatbot | `/h/:slug/triage` | AI triage chatbot |

### 1.2 Shared Components

| Component | File | Purpose |
|-----------|------|---------|
| DashboardLayout | `components/DashboardLayout.tsx` | Main shell: sidebar + header + main + mobile bottom nav |
| Sidebar | `components/dashboard/Sidebar.tsx` | Role-based sidebar with grouped nav, accordions, prefetch |
| Header | `components/dashboard/Header.tsx` | Top header bar |
| MobileBottomNav | `components/dashboard/MobileBottomNav.tsx` | Mobile bottom navigation |
| KPICard | `components/dashboard/KPICard.tsx` | Dashboard KPI card with skeleton |
| SafeChartFrame | `components/dashboard/SafeChartFrame.tsx` | Chart container with error boundary |
| ThemeContext | `components/dashboard/ThemeContext.tsx` | Dark/light theme context |
| ProtectedRoute | `components/ProtectedRoute.tsx` | Auth guard with role checking |
| ErrorBoundary | `components/ErrorBoundary.tsx` | React error boundary |
| LoadingFallback | `components/LoadingFallback.tsx` | Suspense fallback |
| SyncStatusBar | `components/SyncStatusBar.tsx` | Offline sync status indicator |
| ImpersonationBanner | `components/ImpersonationBanner.tsx` | Impersonation active banner |
| PWAUpdatePrompt | `components/PWAUpdatePrompt.tsx` | PWA update notification |
| AppIconSync | `components/AppIconSync.tsx` | Dynamic app icon |
| PrintButton | `components/PrintButton.tsx` | Print action button |
| HelpButton/HelpPanel | `components/HelpButton.tsx` | Contextual help |
| DrugSearchInput | `components/DrugSearchInput.tsx` | Drug search autocomplete |
| VitalsTrend | `components/VitalsTrend.tsx` | Vitals trend chart |
| WhatsAppButton | `components/WhatsAppButton.tsx` | WhatsApp contact button |

### 1.3 Hooks & Services

| File | Purpose |
|------|---------|
| `hooks/useAuth.tsx` | Auth context — JWT decode, login/logout, token management |
| `hooks/useApiQuery.tsx` | TanStack Query wrapper with tenant-aware API |
| `hooks/useAnalytics.tsx` | GA4 page view tracking |
| `hooks/usePrefetch.ts` | Prefetch on hover for nav items |
| `lib/apiClient.ts` | Centralized API client with tenant header injection |
| `lib/queryKeys.ts` | Standardized query key factory |
| `lib/i18n.ts` | i18next configuration (en + bn) |
| `lib/sync-engine.ts` | Background sync for offline operations |
| `lib/hostRouting.ts` | Subdomain-based routing logic |
| `lib/pwaLaunch.ts` | PWA launch path detection |
| `lib/patientPortalHandoff.ts` | Patient portal redirect logic |

### 1.4 Design System (index.css)

| Token | Purpose |
|-------|---------|
| `--color-primary` (cyan/teal) | Brand primary color |
| `--color-bg-primary/secondary/card` | Surface colors |
| `--color-text-primary/secondary/muted` | Text hierarchy |
| `--color-border` | Border color |
| `--color-success/warning/error/info` | Status colors |
| `--shadow-card/hover/modal/glow` | Shadow system |
| `.card`, `.card-elevated` | Card components |
| `.btn-primary/secondary/ghost/danger` | Button variants |
| `.input`, `.label` | Form components |
| `.table-base` | Table component |
| `.badge-*` | Status badges |
| `.skeleton` | Loading skeleton with shimmer |
| `.page-header`, `.page-title` | Page header pattern |
| `.section-title`, `.section-subtitle` | Section headings |
| `.gradient-text` | Gradient text effect |
| `.font-data` | Monospace for numbers (tabular-nums) |
| Dark mode | Full dark mode via `.dark` class |

---

## 2. UI/UX Issues Found (by Web Interface Guidelines)

### 2.1 Accessibility

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `Sidebar.tsx:749-757` | Hamburger button has `aria-label`, `aria-expanded`, `aria-controls` | ✅ Pass |
| `Sidebar.tsx:669` | Accordion buttons have `aria-expanded` | ✅ Pass |
| `Sidebar.tsx:709` | Nav links have `aria-current="page"` for active | ✅ Pass |
| `Sidebar.tsx:800` | `<nav>` has `aria-label="Main navigation"` | ✅ Pass |
| `Sidebar.tsx:756` | Icons have `aria-hidden="true"` | ✅ Pass |
| `DashboardLayout.tsx:46` | `<main>` landmark present | ✅ Pass |
| `Login.tsx:240` | Email input has `<label htmlFor="email">` | ✅ Pass |
| `Login.tsx:260` | Password input has `<label htmlFor="password">` | ✅ Pass |
| `index.css:217-221` | Global `:focus-visible` styles defined (3px solid, WCAG AA) | ✅ Pass |
| `index.css:224-230` | `prefers-reduced-motion` respected globally | ✅ Pass |
| `HospitalAdminDashboard.tsx:339` | Refresh button — icon-only, has `title` but no `aria-label` | Medium |
| `HospitalAdminDashboard.tsx:342-345` | New Patient button — has visible text | ✅ Pass |
| `main.tsx:49` | Suspense fallback uses inline style, not accessible | Low |
| `App.tsx:313-320` | Unauthorized page — uses `javascript:void` in href (anti-pattern) | Medium |

### 2.2 Focus States

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `index.css:217-221` | Global `:focus-visible` with 3px solid outline | ✅ Pass |
| `index.css:294` | `.input` uses `focus:ring-2` | ✅ Pass |
| `Sidebar.tsx:754` | Hamburger has `focus-visible:ring-2` | ✅ Pass |
| All buttons via `.btn-*` | No explicit focus-visible styles in button classes | Medium |

### 2.3 Forms

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `Login.tsx:246-253` | Email input — has `id`, `type="text"`, `autoFocus`, `required` | ✅ Pass |
| `Login.tsx:265-272` | Password input — has `id`, `type="password"`, `required` | ✅ Pass |
| `Login.tsx:253` | Uses `className="input"` which includes `focus:ring-2` | ✅ Pass |
| `Login.tsx:252` | `autoFocus` on email — desktop only, justified for login | ✅ Pass |
| `Login.tsx:248` | Placeholder uses example pattern | ✅ Pass |
| `Login.tsx:280-286` | Remember me checkbox has proper `<label>` wrapping | ✅ Pass |
| `Login.tsx:246` | Missing `autocomplete="email"` | Low |
| `Login.tsx:266` | Missing `autocomplete="current-password"` | Low |
| `Login.tsx:246` | Missing `name` attribute | Low |
| `Login.tsx:266` | Missing `name` attribute | Low |
| `Login.tsx:246` | Missing `spellCheck={false}` on email | Low |
| `Login.tsx:266` | Missing `spellCheck={false}` on password | Low |

### 2.4 Animation

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `index.css:224-230` | `prefers-reduced-motion` — all animations disabled | ✅ Pass |
| `index.css:136-183` | All keyframe animations use `transform`/`opacity` only | ✅ Pass |
| `Sidebar.tsx:776` | Sidebar transition uses `transition-transform` (explicit) | ✅ Pass |
| `index.css:240-241` | `.card` transition lists explicit properties | ✅ Pass |
| `index.css:199` | `body` transition on `background-color, color` — explicit | ✅ Pass |
| `index.css:411-425` | Animation utilities use correct `transform-origin` | ✅ Pass |

### 2.5 Typography

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `index.css:211-214` | `.font-data` uses `font-variant-numeric: tabular-nums` | ✅ Pass |
| `HospitalAdminDashboard.tsx:168` | `formatCurrency` uses `toLocaleString()` | ✅ Pass |
| `HospitalAdminDashboard.tsx:335` | Date uses `toLocaleDateString(undefined, {...})` — auto locale | ✅ Pass |
| `Sidebar.tsx:790` | Role label uses `capitalize` CSS | ✅ Pass |
| `Login.tsx:302-308` | Loading text uses i18n key, not hardcoded `...` | ✅ Pass |

### 2.6 Content Handling

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `Sidebar.tsx:682` | Nav label uses `truncate` class | ✅ Pass |
| `Sidebar.tsx:722` | Nav label uses `truncate` class | ✅ Pass |
| `Sidebar.tsx:789` | Hospital name uses `truncate` class | ✅ Pass |
| `HospitalAdminDashboard.tsx:740` | Activity user name uses `truncate` | ✅ Pass |
| `HospitalAdminDashboard.tsx:379` | Finance card title uses `truncate` | ✅ Pass |
| `index.css:395-400` | `.hide-mobile` / `.show-mobile-only` for responsive columns | ✅ Pass |

### 2.7 Navigation & State

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `Sidebar.tsx:601-605` | Active path detection includes prefix matching | ✅ Pass |
| `Sidebar.tsx:618-621` | Nav click closes mobile sidebar + saves scroll | ✅ Pass |
| `Sidebar.tsx:646-648` | Route change closes mobile sidebar | ✅ Pass |
| `Sidebar.tsx:61-69` | Accordion state persisted in sessionStorage | ✅ Pass |
| `Sidebar.tsx:632-644` | Scroll position persisted in sessionStorage | ✅ Pass |
| `Sidebar.tsx:706` | Links use `<Link>` (supports Cmd/Ctrl+click) | ✅ Pass |
| `App.tsx:323-330` | 404 page exists | ✅ Pass |
| `App.tsx:312-321` | Unauthorized page exists | ✅ Pass |

### 2.8 Touch & Interaction

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `Sidebar.tsx:799` | Nav has `overscroll-contain` | ✅ Pass |
| `Sidebar.tsx:773` | Sidebar width uses `min(88vw, 20rem)` — safe mobile width | ✅ Pass |
| `DashboardLayout.tsx:46` | Main has `pb-20` on mobile for bottom nav clearance | ✅ Pass |
| `DashboardLayout.tsx:56` | Mobile bottom nav present | ✅ Pass |
| `index.css:186-187` | `box-sizing: border-box` on all elements | ✅ Pass |

### 2.9 Safe Areas & Layout

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `DashboardLayout.tsx:35` | `overflow-x-clip` on root container | ✅ Pass |
| `DashboardLayout.tsx:38` | `min-w-0` on flex child | ✅ Pass |
| `Sidebar.tsx:773` | No `env(safe-area-inset-*)` for notched devices | Low |

### 2.10 Dark Mode & Theming

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `index.css:69` | `@custom-variant dark` for class-based dark mode | ✅ Pass |
| `index.css:108-130` | Full dark mode CSS variable overrides | ✅ Pass |
| `index.css:337-341` | Dark mode badge variants | ✅ Pass |
| `index.css:322-324` | Dark mode table hover | ✅ Pass |
| `index.css:355-363` | Dark mode skeleton | ✅ Pass |
| `Login.tsx:161` | `dark:bg-slate-900` on login form | ✅ Pass |
| `Login.tsx:394` | Dark mode branding panel | ✅ Pass |
| `Sidebar.tsx:773` | `dark:bg-slate-900` on sidebar | ✅ Pass |
| `index.html` | Missing `<meta name="theme-color">` | Low |
| `index.html` | Missing `color-scheme` meta | Low |

### 2.11 Locale & i18n

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `Login.tsx:29` | Uses `useTranslation('auth')` | ✅ Pass |
| `HospitalAdminDashboard.tsx:175` | Uses `useTranslation(['dashboard', 'patients', 'common'])` | ✅ Pass |
| `Sidebar.tsx:51` | Uses `useTranslation('sidebar')` | ✅ Pass |
| `Login.tsx:366-388` | Language switcher (বাংলা / English) | ✅ Pass |
| `HospitalAdminDashboard.tsx:168` | `formatCurrency` uses `toLocaleString()` — auto locale | ✅ Pass |
| `HospitalAdminDashboard.tsx:335` | Date uses `toLocaleDateString(undefined, {...})` — auto locale | ✅ Pass |
| `Sidebar.tsx:595` | Role labels use i18n with fallback | ✅ Pass |

### 2.12 Performance

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `App.tsx:27-260` | All pages lazy-loaded with `lazy()` | ✅ Pass |
| `main.tsx:31-41` | QueryClient with 5min staleTime, 1hr gcTime | ✅ Pass |
| `Sidebar.tsx:76-90` | Prefetch map for hover prefetching | ✅ Pass |
| `Sidebar.tsx:708` | `onMouseEnter` triggers prefetch | ✅ Pass |
| `HospitalAdminDashboard.tsx:664-710` | Charts wrapped in `SafeChartFrame` | ✅ Pass |
| `index.css:344-354` | Skeleton with shimmer animation (no layout reads) | ✅ Pass |
| `DashboardLayout.tsx:49` | SyncStatusBar only renders when needed | ✅ Pass |
| `main.tsx:17-26` | Service worker update handling | ✅ Pass |
| `main.tsx:29` | Background sync engine started | ✅ Pass |

### 2.13 Hover & Interactive States

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `Sidebar.tsx:714-716` | Active nav has gradient bg + shadow | ✅ Pass |
| `Sidebar.tsx:715` | Inactive nav has hover bg + translate-x | ✅ Pass |
| `index.css:267-270` | `.btn-primary` hover has translateY + shadow | ✅ Pass |
| `index.css:278-280` | `.btn-secondary` hover has translateY + shadow | ✅ Pass |
| `index.css:242-244` | `.card` hover has shadow change | ✅ Pass |
| `index.css:319-321` | Table row hover has bg change | ✅ Pass |

### 2.14 Anti-patterns

| File:Line | Issue | Severity |
|-----------|-------|----------|
| `App.tsx:318` | `href="javascript:history.back()"` — anti-pattern | Medium |
| No `user-scalable=no` detected | — | ✅ Pass |
| No `onPaste` + `preventDefault` detected | — | ✅ Pass |
| No `transition: all` detected | — | ✅ Pass |
| No `outline-none` without replacement | — | ✅ Pass |

---

## 3. Structural & UX Observations

### 3.1 What's Working Well

| Area | Details |
|------|---------|
| **Design System** | Comprehensive CSS custom properties with light/dark themes, consistent component classes |
| **Accessibility** | Sidebar has proper ARIA attributes, focus-visible styles globally defined, reduced-motion respected |
| **Performance** | All pages lazy-loaded, prefetch on hover, skeleton loading, background sync |
| **i18n** | Full Bengali + English support with proper locale detection |
| **Dark Mode** | Complete dark mode with proper color token overrides |
| **Mobile** | Mobile bottom nav, responsive sidebar with overlay, mobile card layouts for tables |
| **Offline Support** | Sync engine for offline operations, PWA support |
| **State Persistence** | Sidebar accordion + scroll position saved in sessionStorage |
| **Error Handling** | ErrorBoundary + toast notifications + SafeChartFrame for charts |
| **Role-Based Nav** | 10+ role configurations with permission-based filtering |
| **Typography** | Tabular nums for data, Bangla font support, proper font stack |
| **Loading States** | Skeleton shimmer instead of spinners |

### 3.2 Potential Issues

| Issue | Details | Priority |
|-------|---------|----------|
| **Scale of sidebar** | `hospital_admin` role has 80+ nav items in sidebar — can be overwhelming | High |
| **No search in sidebar** | With 80+ items, no way to search/filter nav items | High |
| **No breadcrumbs** | Deep navigation (inventory/po/new) has no breadcrumb trail | Medium |
| **No recent/favorites** | No way to pin frequently used pages | Medium |
| **javascript: href** | `App.tsx:318` uses `javascript:history.back()` — should use `navigate(-1)` | Medium |
| **Missing meta tags** | No `<meta name="theme-color">` or `color-scheme` in index.html | Low |
| **Safe area insets** | No `env(safe-area-inset-*)` for notched devices | Low |
| **Missing autocomplete attrs** | Login form inputs missing `autocomplete` attributes | Low |

### 3.3 Sidebar Navigation Deep Dive

The `hospital_admin` sidebar has **6 groups** with nested accordions:

1. **Operations** (5 items + 4 accordions)
   - Patient Flow (5 items)
   - Wards & OT (6 items)
   - Doctor Services (4 items)
   - Support Services (8 items)

2. **Clinical** (7 accordions)
   - Lab (4 items)
   - Pharmacy (11 items)
   - Inventory (13 items)
   - Patient Records (4 items)
   - Clinical Assessments (6 items)
   - Procedures (4 items)
   - Specialty (5 items)

3. **Finance** (2 accordions)
   - Billing (15 items)
   - Accounts (7 items)

4. **Administration** (4 accordions)
   - HR & Staff (8 items)
   - Reports & Audit (7 items)
   - System (9 items)
   - Marketing (4 items)
   - Help Center (1 item)

**Total: ~120+ nav items for hospital_admin role**

---

## 4. Priority Recommendations

### High Priority
1. **Add sidebar search** — With 120+ items, a `⌘K` command palette or sidebar search is essential
2. **Add breadcrumbs** — Deep navigation needs breadcrumb trail
3. **Fix `javascript:` href** — Replace with proper router navigation

### Medium Priority
1. **Add favorites/recent** — Let users pin frequently used pages
2. **Add nav item count badges** — Show pending counts (e.g., "Pending Tests: 5")
3. **Add `autocomplete` attrs** to login form inputs
4. **Add `<meta name="theme-color">`** to index.html

### Low Priority
1. **Add safe area insets** for notched devices
2. **Add skip-to-content link** for keyboard users
3. **Consider nav item grouping collapse** — Allow entire groups to be collapsed

---

## 5. File-by-File Summary

```
## web/src/index.css
✅ Comprehensive design system with CSS custom properties
✅ Dark mode via class strategy
✅ Focus-visible globally defined (WCAG AA)
✅ prefers-reduced-motion respected
✅ Skeleton shimmer loading states
✅ Component classes: card, btn-*, input, table-base, badge-*
✅ font-data with tabular-nums for numbers

## web/src/main.tsx
✅ ErrorBoundary wrapping
✅ QueryClient with proper staleTime/gcTime
✅ ThemeProvider
✅ Service worker handling
✅ Background sync engine

## web/src/App.tsx
✅ All pages lazy-loaded
✅ ProtectedRoute with role-based access
✅ 404 and Unauthorized pages
✅ Host-based routing guard
⚠ App.tsx:318 - javascript: href anti-pattern

## web/src/components/DashboardLayout.tsx
✅ Proper layout shell with sidebar + header + main
✅ Mobile bottom nav with pb-20 clearance
✅ SyncStatusBar for offline indicator
✅ Overflow-x-clip for safety

## web/src/components/dashboard/Sidebar.tsx
✅ aria-label on hamburger button
✅ aria-expanded on accordions
✅ aria-current="page" on active links
✅ aria-label on <nav>
✅ Icons have aria-hidden="true"
✅ Truncate on text overflow
✅ Overscroll-contain on nav
✅ Prefetch on hover
✅ SessionStorage persistence for accordions + scroll
✅ 10+ role configurations
✅ Permission-based filtering
⚠ 120+ items for hospital_admin — needs search

## web/src/pages/Login.tsx
✅ Proper <label> with htmlFor
✅ AutoFocus on email input
✅ i18n support
✅ Language switcher (বাংলা / English)
✅ Multi-hospital picker
✅ Google OAuth support
✅ Remember me checkbox
✅ Responsive split layout (form + branding)
⚠ Missing autocomplete attributes
⚠ Missing spellCheck={false}

## web/src/pages/HospitalAdminDashboard.tsx
✅ 8 KPI cards with skeleton loading
✅ Finance controls section
✅ Quick actions
✅ Today summary
✅ Patient summary + Bed dashboard
✅ Financial summary with cashier breakdown
✅ Lab + Pharmacy summaries
✅ Revenue trend chart (LineChart)
✅ Lab tests chart (BarChart)
✅ Recent activity with mobile card + desktop table
✅ Skeleton loading for all sections
✅ Proper i18n for all labels
⚠ Refresh button missing aria-label
```

---

## 6. Comparison: Super Admin vs Hospital Admin

| Aspect | Super Admin (`admin-panel/`) | Hospital Admin (`web/`) |
|--------|------------------------------|------------------------|
| Pages | 10 | 100+ |
| Roles | 1 (super_admin) | 10+ |
| Sidebar items | 8 | 120+ |
| i18n | None | Bengali + English |
| Dark mode | None | Full support |
| Mobile nav | None | Bottom nav + responsive sidebar |
| Loading states | Spinner | Skeleton shimmer |
| Focus styles | Missing | Global focus-visible |
| Reduced motion | Missing | Respected |
| ARIA | Missing on most buttons | Comprehensive |
| Prefetch | None | Hover prefetch |
| Offline support | None | Sync engine + PWA |
| Design system | Inline Tailwind | CSS custom properties + component classes |
| Charts | None | Recharts with SafeChartFrame |
| Error boundary | Yes | Yes + SafeChartFrame |
