import { lazy, Suspense, type ComponentType, type ReactNode, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { PWAUpdatePrompt } from './components/PWAUpdatePrompt';
import { AppIconSync } from './components/AppIconSync';
import { getStoredPwaLaunchPath } from './lib/pwaLaunch';
import {
  buildPatientPortalHandoffTarget,
  shouldUnregisterServiceWorkerScope,
} from './lib/patientPortalHandoff';
import { getTenantSlugFromHost, isAdminHost, isPatientAppHost, isStaffAuthHost } from './lib/hostRouting';
import { useAnalytics } from './hooks/useAnalytics';
import { Toaster } from 'react-hot-toast';
import { ProtectedRoute } from './components/ProtectedRoute';
import { saveToken, useAuth } from './hooks/useAuth';
import { useCurrentUserAccess } from './hooks/useCurrentUserAccess';
import { useTranslation } from 'react-i18next';
import { getWorkspaceAccessDefinition, type WorkspaceId } from '@shared/workspaceAccess';
import { resolveDashboardEntryWorkspace } from './lib/dashboardEntry';
import { buildTenantRedirectTarget } from './lib/tenantRedirect';
import ImpersonationBanner from './components/ImpersonationBanner';
import DashboardLayout from './components/DashboardLayout';
import LoadingFallback from './components/LoadingFallback';
import { apiFetch } from './lib/apiClient';
import {
  clearAdminSession,
  isAdminAuthenticated,
  setAdminSession,
} from './lib/adminSessionStore';

// ─── Static imports: Auth pages (needed on first load) ──────────────────────
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AdminLogin from './pages/AdminLogin';
import HospitalSignup from './pages/HospitalSignup';
import AcceptInvite from './pages/AcceptInvite';

// ─── Lazy imports: Dashboards ───────────────────────────────────────────────
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'));
const DiscountReview = lazy(() => import('./pages/admin/DiscountReview'));
const RefundDetail = lazy(() => import('./pages/admin/RefundDetail'));
const OPDMonitor = lazy(() => import('./pages/admin/monitor/OPDMonitor'));
const DiagnosticMonitor = lazy(() => import('./pages/admin/monitor/DiagnosticMonitor'));
const PharmacyMonitor = lazy(() => import('./pages/admin/monitor/PharmacyMonitor'));
const OperationsMonitorPage = lazy(() => import('./pages/admin/OperationsMonitorPage'));
const StockOverview = lazy(() => import('./pages/admin/StockOverview'));
const StockMovementPage = lazy(() => import('./pages/admin/StockMovementPage'));
const BranchComparisonPage = lazy(() => import('./pages/admin/BranchComparisonPage'));
const PendingApprovals = lazy(() => import('./pages/admin/PendingApprovals'));
const ActionCenterOverview = lazy(() => import('./pages/admin/ActionCenterOverview'));
const DailyCollectionReport = lazy(() => import('./pages/admin/DailyCollectionReport'));
const FinancialReports = lazy(() => import('./pages/admin/FinancialReports'));
const StaffActivityLog = lazy(() => import('./pages/admin/StaffActivityLog'));
const TelemedicineMonitor = lazy(() => import('./pages/admin/TelemedicineMonitor'));
const DiscountRules = lazy(() => import('./pages/admin/DiscountRules'));
const DoctorDashboard = lazy(() => import('./pages/DoctorDashboard'));
const LaboratoryDashboard = lazy(() => import('./pages/LaboratoryDashboard'));
const ReceptionDashboard = lazy(() => import('./pages/ReceptionDashboard'));
const ManagerDashboard = lazy(() => import('./pages/ManagerDashboard'));
const CashOperationsPage = lazy(() => import('./pages/reception/CashOperationsPage'));
const AdminPdfGenerationPage = lazy(() => import('./pages/AdminPdfGenerationPage'));
const ReceptionPrintCenter = lazy(() => import('./pages/reception/ReceptionPrintCenter'));
const MDDashboard = lazy(() => import('./pages/MDDashboard'));
const DirectorDashboard = lazy(() => import('./pages/DirectorDashboard'));
const BillingDashboard = lazy(() => import('./pages/BillingDashboard'));
const BillingCounterPage = lazy(() => import('./pages/BillingCounterPage'));
const CashBankBook = lazy(() => import('./pages/CashBankBook'));
const AdminTransactionControlCenter = lazy(() => import('./pages/AdminTransactionControlCenter'));
const AlertsExceptions = lazy(() => import('./pages/admin/AlertsExceptions'));
const TasksFollowups = lazy(() => import('./pages/admin/TasksFollowups'));
const AuditExplorer = lazy(() => import('./pages/admin/AuditExplorer'));
const FinancialAudit = lazy(() => import('./pages/admin/FinancialAudit'));
const ExportHistory = lazy(() => import('./pages/admin/ExportHistory'));
const LoginSessions = lazy(() => import('./pages/admin/LoginSessions'));
const SuspiciousActivities = lazy(() => import('./pages/admin/SuspiciousActivities'));
const OfflineSyncReview = lazy(() => import('./pages/admin/OfflineSyncReview'));
const DiscountReferenceAnalytics = lazy(() => import('./pages/admin/DiscountReferenceAnalytics'));
const HospitalProfileAdmin = lazy(() => import('./pages/admin/HospitalProfile'));
const ApprovalPolicies = lazy(() => import('./pages/admin/ApprovalPolicies'));
const EscalationRules = lazy(() => import('./pages/admin/EscalationRules'));
const NotificationSettings = lazy(() => import('./pages/admin/NotificationSettings'));
const DueReceivables = lazy(() => import('./pages/admin/DueReceivables'));
const InventoryAlerts = lazy(() => import('./pages/admin/InventoryAlerts'));
const PatientRecordAccess = lazy(() => import('./pages/admin/PatientRecordAccess'));
const PatientAnalytics = lazy(() => import('./pages/analytics/PatientAnalytics'));
const DoctorPayoutDetail = lazy(() => import('./pages/admin/DoctorPayoutDetail'));
const RefundRequestDetail = lazy(() => import('./pages/admin/RefundRequestDetail'));
const ExpenseDetailPage = lazy(() => import('./pages/admin/ExpenseDetailPage'));
const CashDrawerDetail = lazy(() => import('./pages/admin/CashDrawerDetail'));
const ShiftHandoverDetail = lazy(() => import('./pages/admin/ShiftHandoverDetail'));
const PharmacyDashboard = lazy(() => import('./pages/PharmacyDashboard'));
const NursingDashboard = lazy(() => import('./pages/NursingDashboard'));
const EmergencyDashboard = lazy(() => import('./pages/EmergencyDashboard'));
const EPrescribingDashboard = lazy(() => import('./pages/EPrescribingDashboard'));
const MedicalRecordsDashboard = lazy(() => import('./pages/MedicalRecordsDashboard'));
const RadiologyDashboard = lazy(() => import('./pages/RadiologyDashboard'));
const VaccinationDashboard = lazy(() => import('./pages/VaccinationDashboard'));
const HRDashboard = lazy(() => import('./pages/HRDashboard'));
const LeaveManagement = lazy(() => import('./pages/LeaveManagement'));
const HospitalSetupWizard = lazy(() => import('./pages/HospitalSetupWizard'));
const ReportsDashboard = lazy(() => import('./pages/ReportsDashboard'));
const QualityKpiDashboard = lazy(() => import('./pages/QualityKpiDashboard'));
const EyeExamDashboard = lazy(() => import('./pages/EyeExamDashboard'));
const PhysicalExamDashboard = lazy(() => import('./pages/PhysicalExamDashboard'));
const CarePlansDashboard = lazy(() => import('./pages/CarePlansDashboard'));
const TrackAnythingDashboard = lazy(() => import('./pages/TrackAnythingDashboard'));
const PriorAuthDashboard = lazy(() => import('./pages/PriorAuthDashboard'));
const ProcedureOrdersDashboard = lazy(() => import('./pages/ProcedureOrdersDashboard'));
const MultiBranchDashboard = lazy(() => import('./pages/MultiBranchDashboard'));
const WhatsAppDashboard = lazy(() => import('./pages/WhatsAppDashboard'));
const OTDashboard = lazy(() => import('./pages/OTDashboard'));
const OTSettings = lazy(() => import('./pages/OTSettings'));
const CommissionRules = lazy(() => import('./pages/CommissionRules'));
const OTCalendar = lazy(() => import('./pages/OTCalendar'));
const IntraOpCanvas = lazy(() => import('./pages/IntraOpCanvas'));
const OTReports = lazy(() => import('./pages/OTReports'));
const BillingReportsPage = lazy(() => import('./pages/BillingReportsPage'));

// ─── Lazy imports: Super Admin ──────────────────────────────────────────────
const SuperAdminDashboard = lazy(() => import('./pages/SuperAdminDashboard'));
const SuperAdminHospitalList = lazy(() => import('./pages/SuperAdminHospitalList'));
const SuperAdminHospitalDetail = lazy(() => import('./pages/SuperAdminHospitalDetail'));
const SuperAdminOnboardingQueue = lazy(() => import('./pages/SuperAdminOnboardingQueue'));
const SuperAdminSettings = lazy(() => import('./pages/SuperAdminSettings'));
const SuperAdminAuditLog = lazy(() => import('./pages/SuperAdminAuditLog'));
const SuperAdminHealth = lazy(() => import('./pages/SuperAdminHealth'));
const SuperAdminPlatformStaff = lazy(() => import('./pages/SuperAdminPlatformStaff'));

// ─── Lazy imports: Patient Management ───────────────────────────────────────
const PatientList = lazy(() => import('./pages/PatientList'));
const PatientForm = lazy(() => import('./pages/PatientForm'));
const PatientDetail = lazy(() => import('./pages/PatientDetail'));
const PatientChartWorkspace = lazy(() => import('./pages/PatientChartWorkspace'));
const PatientChartPrint = lazy(() => import('./pages/PatientChartPrint'));
const PatientTimeline = lazy(() => import('./pages/PatientTimeline'));
const PatientPortal = lazy(() => import('./pages/PatientPortal'));
const PatientDuplicates = lazy(() => import('./pages/PatientDuplicates'));

// ─── Lazy imports: Clinical ─────────────────────────────────────────────────
const ConsultationNotes = lazy(() => import('./pages/ConsultationNotes'));
const DigitalPrescription = lazy(() => import('./pages/DigitalPrescription'));
const LabTestOrderForm = lazy(() => import('./pages/LabTestOrderForm'));
const MedicineDispensing = lazy(() => import('./pages/MedicineDispensing'));
const NurseStation = lazy(() => import('./pages/NurseStation'));
const NurseTasksPage = lazy(() => import('./pages/NurseTasksPage'));
const NurseReportsPage = lazy(() => import('./pages/NurseReportsPage'));
const DischargeSummary = lazy(() => import('./pages/DischargeSummary'));
const PrescriptionPrint = lazy(() => import('./pages/PrescriptionPrint'));
const DoctorSchedule = lazy(() => import('./pages/DoctorSchedule'));
const LabReportPrint = lazy(() => import('./pages/LabReportPrint'));
const VitalsPage = lazy(() => import('./pages/VitalsPage'));
const AllergiesPage = lazy(() => import('./pages/AllergiesPage'));
const ClinicalAssessments = lazy(() => import('./pages/ClinicalAssessments'));
const ClinicalRemindersPage = lazy(() => import('./pages/ClinicalRemindersPage'));
const Dental = lazy(() => import('./pages/Dental'));
const WardSupplyDashboard = lazy(() => import('./pages/WardSupplyDashboard'));
const HelpdeskDashboard = lazy(() => import('./pages/HelpdeskDashboard'));
const Psychiatry = lazy(() => import('./pages/Psychiatry'));
const DictationPage = lazy(() => import('./pages/DictationPage'));
const CustomFormBuilder = lazy(() => import('./pages/CustomFormBuilder'));
const QuestionnairesPage = lazy(() => import('./pages/QuestionnairesPage'));
const HealthRecordSharing = lazy(() => import('./pages/HealthRecordSharing'));
const PatientCardScanner = lazy(() => import('./pages/PatientCardScanner'));
const ImportExternalRecords = lazy(() => import('./pages/ImportExternalRecords'));
const DischargePlanningPage = lazy(() => import('./pages/DischargePlanningPage'));
const NurseWorkloadPage = lazy(() => import('./pages/NurseWorkloadPage'));
const Camos = lazy(() => import('./pages/Camos'));

// ─── Lazy imports: Appointments & Queue ─────────────────────────────────────
const AppointmentScheduler = lazy(() => import('./pages/AppointmentScheduler'));
const QueueDisplay = lazy(() => import('./pages/QueueDisplay'));
const QueueManagement = lazy(() => import('./pages/QueueManagement'));

// ─── Lazy imports: Admissions & IPD ─────────────────────────────────────────
const AdmissionIPD = lazy(() => import('./pages/AdmissionIPD'));
const AdmissionSlipPrint = lazy(() => import('./pages/AdmissionSlipPrint'));
const BedManagement = lazy(() => import('./pages/BedManagement'));
const IPDReports = lazy(() => import('./pages/IPDReports'));
const DeathRecords = lazy(() => import('./pages/DeathRecords'));

// ─── Lazy imports: Billing & Payments ───────────────────────────────────────
const BillPrint = lazy(() => import('./pages/BillPrint'));
const LabTestBillPrint = lazy(() => import('./pages/LabTestBillPrint'));
const IPDRunningBillPrint = lazy(() => import('./pages/IPDRunningBillPrint'));
const DepositsPage = lazy(() => import('./pages/DepositsPage'));
const CreditNotesPage = lazy(() => import('./pages/CreditNotesPage'));
const PatientSettlementsPage = lazy(() => import('./pages/PatientSettlementsPage'));
const BillingHandoverPage = lazy(() => import('./pages/BillingHandoverPage'));
const ReceptionReportsPage = lazy(() => import('./pages/ReceptionReportsPage'));
const DoctorStatusPage = lazy(() => import('./pages/DoctorStatusPage'));
const OnlineAppointmentApproval = lazy(() => import('./pages/OnlineAppointmentApproval'));
const BillCancellationPage = lazy(() => import('./pages/BillCancellationPage'));
const InsuranceClaims = lazy(() => import('./pages/InsuranceClaims'));
const InsuranceBillingPage = lazy(() => import('./pages/InsuranceBillingPage'));
const BillingMasterPage = lazy(() => import('./pages/BillingMasterPage'));
const ProvisionalBillingPage = lazy(() => import('./pages/ProvisionalBillingPage'));
const IPBillingPage = lazy(() => import('./pages/IPBillingPage'));
const PaymentsPage = lazy(() => import('./pages/PaymentsPage'));
const CommissionManagement = lazy(() => import('./pages/CommissionManagement'));
const FeeSheet = lazy(() => import('./pages/FeeSheet'));

// ─── Lazy imports: Pharmacy ─────────────────────────────────────────────────
const PharmacyOverview = lazy(() => import('./pages/pharmacy/PharmacyOverview'));
const PharmItemList = lazy(() => import('./pages/pharmacy/ItemList'));
const PharmCategoryList = lazy(() => import('./pages/pharmacy/CategoryList'));
const PharmGenericList = lazy(() => import('./pages/pharmacy/GenericList'));
const PharmSupplierList = lazy(() => import('./pages/pharmacy/SupplierList'));
const PharmPurchaseOrderList = lazy(() => import('./pages/pharmacy/PurchaseOrderList'));
const PharmPurchaseOrderForm = lazy(() => import('./pages/pharmacy/PurchaseOrderForm'));
const PharmGoodsReceiptList = lazy(() => import('./pages/pharmacy/GoodsReceiptList'));
const PharmGoodsReceiptForm = lazy(() => import('./pages/pharmacy/GoodsReceiptForm'));
const PharmStockList = lazy(() => import('./pages/pharmacy/StockList'));
const PharmInvoiceList = lazy(() => import('./pages/pharmacy/InvoiceList'));
const PharmInvoiceForm = lazy(() => import('./pages/pharmacy/InvoiceForm'));
const PharmDepositList = lazy(() => import('./pages/pharmacy/DepositList'));
const PharmSettlementList = lazy(() => import('./pages/pharmacy/SettlementList'));
const PharmPrescriptionList = lazy(() => import('./pages/pharmacy/PrescriptionList'));
const PharmNarcoticRegister = lazy(() => import('./pages/pharmacy/NarcoticRegister'));
const PharmWriteOffList = lazy(() => import('./pages/pharmacy/WriteOffList'));
const PharmDispatchList = lazy(() => import('./pages/pharmacy/DispatchList'));
const PatientBillingPage = lazy(() => import('./pages/pharmacy/PatientBillingPage'));
const InvoiceReceipt = lazy(() => import('./pages/pharmacy/InvoiceReceipt'));
const StockReport = lazy(() => import('./pages/pharmacy/StockReport'));
const SalesReport = lazy(() => import('./pages/pharmacy/SalesReport'));
const ExpiryReport = lazy(() => import('./pages/pharmacy/ExpiryReport'));
const SupplierLedger = lazy(() => import('./pages/pharmacy/SupplierLedger'));
const DispensaryStock = lazy(() => import('./pages/pharmacy/DispensaryStock'));
const TaxConfigPage = lazy(() => import('./pages/pharmacy/TaxConfigPage'));
const DosageTemplatesPage = lazy(() => import('./pages/pharmacy/DosageTemplatesPage'));
const ApprovalQueuePage = lazy(() => import('./pages/pharmacy/ApprovalQueuePage'));
const ItemPriceHistory = lazy(() => import('./pages/pharmacy/ItemPriceHistory'));
const PharmReturnList = lazy(() => import('./pages/pharmacy/ReturnList'));

// ─── Lazy imports: Accounting ───────────────────────────────────────────────
const AccountingDashboard = lazy(() => import('./pages/accounting/AccountingDashboard'));
const IncomeList = lazy(() => import('./pages/accounting/IncomeList'));
const ExpenseList = lazy(() => import('./pages/accounting/ExpenseList'));
const Reports = lazy(() => import('./pages/accounting/Reports'));
const RecurringExpenses = lazy(() => import('./pages/accounting/RecurringExpenses'));
const ChartOfAccounts = lazy(() => import('./pages/accounting/ChartOfAccounts'));
const ShareholderManagement = lazy(() => import('./pages/accounting/ShareholderManagement'));
const ShareholderViewerDashboard = lazy(() => import('./pages/ShareholderViewerDashboard'));
const JournalEntries = lazy(() => import('./pages/accounting/JournalEntries'));
const ProfitLoss = lazy(() => import('./pages/accounting/ProfitLoss'));
const FiscalYearSettings = lazy(() => import('./pages/accounting/FiscalYearSettings'));
const VoucherVerification = lazy(() => import('./pages/accounting/VoucherVerification'));

// ─── Lazy imports: Inventory ────────────────────────────────────────────────
const InventoryDashboard = lazy(() => import('./pages/inventory/InventoryDashboard'));
const InventoryQuickStartPage = lazy(() => import('./pages/inventory/InventoryQuickStartPage'));
const StockList = lazy(() => import('./pages/inventory/StockList'));
const PurchaseOrderList = lazy(() => import('./pages/inventory/PurchaseOrderList'));
const PurchaseOrderForm = lazy(() => import('./pages/inventory/PurchaseOrderForm'));
const GoodsReceiptList = lazy(() => import('./pages/inventory/GoodsReceiptList'));
const GoodsReceiptForm = lazy(() => import('./pages/inventory/GoodsReceiptForm'));
const RequisitionList = lazy(() => import('./pages/inventory/RequisitionList'));
const RequisitionForm = lazy(() => import('./pages/inventory/RequisitionForm'));
const DispatchList = lazy(() => import('./pages/inventory/DispatchList'));
const DispatchForm = lazy(() => import('./pages/inventory/DispatchForm'));
const StockAdjustment = lazy(() => import('./pages/inventory/StockAdjustment'));
const InventoryLedger = lazy(() => import('./pages/inventory/InventoryLedger'));
const InventoryTraceability = lazy(() => import('./pages/inventory/InventoryTraceability'));
const InventoryIssuePage = lazy(() => import('./pages/inventory/InventoryIssuePage'));
const InventoryTransferPage = lazy(() => import('./pages/inventory/InventoryTransferPage'));
const InventoryReturnPage = lazy(() => import('./pages/inventory/InventoryReturnPage'));
const InventoryCountPage = lazy(() => import('./pages/inventory/InventoryCountPage'));
const InventoryReportsPage = lazy(() => import('./pages/inventory/InventoryReportsPage'));
const InventoryAdjustmentRequestPage = lazy(() => import('./pages/inventory/InventoryAdjustmentRequestPage'));
const InventoryWriteOffPage = lazy(() => import('./pages/inventory/InventoryWriteOffPage'));
const InventoryReturnToVendorPage = lazy(() => import('./pages/inventory/InventoryReturnToVendorPage'));
const InventoryMasterDataPage = lazy(() => import('./pages/inventory/InventoryMasterDataPage'));
const InventoryRFQPage = lazy(() => import('./pages/inventory/InventoryRFQPage'));
const InventoryImportExportPage = lazy(() => import('./pages/inventory/InventoryImportExportPage'));
const InventoryDonationPage = lazy(() => import('./pages/inventory/InventoryDonationPage'));
const InventoryConsumptionAutomation = lazy(() => import('./pages/inventory/InventoryConsumptionAutomation'));
const InventoryAccounting = lazy(() => import('./pages/InventoryAccounting'));

// ─── Lazy imports: Telemedicine ─────────────────────────────────────────────
const TelemedicineDashboard = lazy(() => import('./pages/TelemedicineDashboard'));
const TelemedicineRoom = lazy(() => import('./pages/TelemedicineRoom'));
const TriageChatbot = lazy(() => import('./pages/TriageChatbot'));

// ─── Lazy imports: Settings & Admin ─────────────────────────────────────────
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AdminModuleCatalog = lazy(() => import('./pages/AdminModuleCatalog'));
const DepartmentsSettings = lazy(() => import('./pages/DepartmentsSettings'));
const AppointmentSettings = lazy(() => import('./pages/AppointmentSettings'));
const PaymentMethodsSettings = lazy(() => import('./pages/PaymentMethodsSettings'));
const SecuritySettings = lazy(() => import('./pages/SecuritySettings'));
const EmailSettings = lazy(() => import('./pages/EmailSettings'));
const DiscountRulesSettings = lazy(() => import('./pages/DiscountRulesSettings'));
const BackupSettings = lazy(() => import('./pages/BackupSettings'));
const SystemPreferences = lazy(() => import('./pages/SystemPreferences'));
const ImportExportSettings = lazy(() => import('./pages/ImportExportSettings'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const WebsiteSettings = lazy(() => import('./pages/WebsiteSettings'));
const InviteStaff = lazy(() => import('./pages/InviteStaff'));
const StaffPage = lazy(() => import('./pages/StaffPage'));
const SystemAuditLog = lazy(() => import('./pages/SystemAuditLog'));
const SafetyOverrideAuditPage = lazy(() => import('./pages/SafetyOverrideAuditPage'));
const NotificationsCenter = lazy(() => import('./pages/NotificationsCenter'));
const PermissionManagement = lazy(() => import('./pages/PermissionManagement'));
const PrintTemplateSettings = lazy(() => import('./pages/PrintTemplateSettings'));
const LabSettingsPage = lazy(() => import('./pages/LabSettingsPage'));
const LabMachineSettings = lazy(() => import('./pages/LabMachineSettings'));
const LabMonitoringDashboard = lazy(() => import('./pages/LabMonitoringDashboard'));
const LabQcDashboard = lazy(() => import('./pages/LabQcDashboard'));
const MfaSetup = lazy(() => import('./pages/MfaSetup'));

// ─── Lazy imports: Order Sets, Consents, Documents ──────────────────────────
const OrderSetManager = lazy(() => import('./pages/OrderSetManager'));
const ConsentManagement = lazy(() => import('./pages/ConsentManagement'));
const DocumentManager = lazy(() => import('./pages/DocumentManager'));

// ─── Lazy imports: Reports ──────────────────────────────────────────────────
const ReportLabPage = lazy(() => import('./pages/ReportLabPage'));
const ReportPharmacyPage = lazy(() => import('./pages/ReportPharmacyPage'));
const ReportAppointmentPage = lazy(() => import('./pages/ReportAppointmentPage'));

// ─── Lazy imports: Specialty & Misc ─────────────────────────────────────────
const TestCatalog = lazy(() => import('./pages/TestCatalog'));
const AIAssistant = lazy(() => import('./pages/AIAssistant'));
const InboxPage = lazy(() => import('./pages/InboxPage'));
const MarketingReferral = lazy(() => import('./pages/MarketingReferral'));
const GroupAttendance = lazy(() => import('./pages/GroupAttendance'));
const HelpCenterPage = lazy(() => import('./pages/HelpCenterPage'));
const DutyRoster = lazy(() => import('./pages/DutyRoster'));
const AttendancePunch = lazy(() => import('./pages/AttendancePunch'));
const PayrollGeneration = lazy(() => import('./pages/PayrollGeneration'));
const AssetManagement = lazy(() => import('./pages/AssetManagement'));
const KitchenManagement = lazy(() => import('./pages/KitchenManagement'));
const BloodBankManagement = lazy(() => import('./pages/BloodBankManagement'));
const MlcManagement = lazy(() => import('./pages/MlcManagement'));
const CssdManagement = lazy(() => import('./pages/CssdManagement'));
const LaundryManagement = lazy(() => import('./pages/LaundryManagement'));
const HousekeepingManagement = lazy(() => import('./pages/HousekeepingManagement'));
const AmbulanceManagement = lazy(() => import('./pages/AmbulanceManagement'));
const MortuaryManagement = lazy(() => import('./pages/MortuaryManagement'));
const MaternityDashboard = lazy(() => import('./pages/MaternityDashboard'));
const BiomedicalWasteManagement = lazy(() => import('./pages/BiomedicalWasteManagement'));

// ─── Lazy imports: Marketplace ──────────────────────────────────────────────
const MarketplaceLanding = lazy(() => import('./pages/MarketplaceLanding'));
const HospitalDirectory = lazy(() => import('./pages/marketplace/HospitalDirectory'));
const HospitalProfile = lazy(() => import('./pages/marketplace/HospitalProfile'));
const DoctorDirectory = lazy(() => import('./pages/marketplace/DoctorDirectory'));
const DoctorProfile = lazy(() => import('./pages/marketplace/DoctorProfile'));
const ReviewModerationPage = lazy(() => import('./pages/marketplace/ReviewModerationPage'));
const MarketplaceBookingQueue = lazy(() => import('./pages/marketplace/MarketplaceBookingQueue'));
const CreateReferral = lazy(() => import('./pages/CreateReferral'));
const IncomingReferralQueue = lazy(() => import('./pages/IncomingReferralQueue'));
const DoctorRegister = lazy(() => import('./pages/DoctorRegister'));
const DoctorLogin = lazy(() => import('./pages/DoctorLogin'));
const DoctorLabResults = lazy(() => import('./pages/DoctorLabResults'));
const DoctorList = lazy(() => import('./pages/doctor/DoctorList'));
const DoctorDetail = lazy(() => import('./pages/doctor/DoctorDetail'));
const PatientOverview = lazy(() => import('./pages/doctor/PatientOverview'));
const OPDRecord = lazy(() => import('./pages/doctor/OPDRecord'));
const VisitSummaryPage = lazy(() => import('./pages/doctor/VisitSummary'));
const IPDWorkspace = lazy(() => import('./pages/doctor/IPDWorkspace'));
const DoctorReportReview = lazy(() => import('./pages/doctor/DoctorReportReview'));
const DoctorSelfProfile = lazy(() => import('./pages/doctor/DoctorProfile'));
const DoctorCertificates = lazy(() => import('./pages/doctor/DoctorCertificates'));

function workspacePermissions(workspaceId: WorkspaceId): string[] {
  const workspace = getWorkspaceAccessDefinition(workspaceId);
  if (!workspace) throw new Error(`Unknown workspace access definition: ${workspaceId}`);
  return [...workspace.requiredPermissions];
}

function PatientPortalHandoff() {
  const location = useLocation();

  useEffect(() => {
    const handoffTarget = buildPatientPortalHandoffTarget(location);

    async function handoff() {
      if ('serviceWorker' in navigator) {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(
            registrations
              .filter((registration) =>
                shouldUnregisterServiceWorkerScope(registration.scope, window.location.origin),
              )
              .map((registration) => registration.unregister()),
          );
        } catch {
          // Ignore SW cleanup failures and continue with a full reload.
        }
      }

      window.location.replace(handoffTarget);
    }

    void handoff();
  }, [location]);

  return null;
}

function Unauthorized() {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>{t('accessDenied')}</h1>
      <p>{t('noPermission')}</p>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#0891b2', cursor: 'pointer', textDecoration: 'underline' }}>
        {t('goBack')}
      </button>
    </div>
  );
}

function NotFound() {
  const { t } = useTranslation('common');
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>{t('pageNotFound')}</h1>
      <a href="/">{t('home')}</a>
    </div>
  );
}

function TelemedicineDashboardRoute() {
  const { user } = useAuth();
  return <TelemedicineDashboard role={user?.role ?? 'hospital_admin'} />;
}

function TelemedicineRoomRoute() {
  const { user } = useAuth();
  return <TelemedicineRoom role={user?.role ?? 'hospital_admin'} />;
}

function NurseStationRoute() {
  const { user } = useAuth();
  return <NurseStation role={user?.role ?? 'hospital_admin'} />;
}

function NursingDashboardRoute() {
  const { user } = useAuth();
  return <NursingDashboard role={user?.role ?? 'hospital_admin'} />;
}

function NurseReportsRoute() {
  const { user } = useAuth();
  return <NurseReportsPage role={user?.role ?? 'hospital_admin'} />;
}

function DoctorScheduleRoute() {
  const { user } = useAuth();
  return <DoctorSchedule role={user?.role ?? 'hospital_admin'} />;
}

function VitalsRoute() {
  const { user } = useAuth();
  return <VitalsPage role={user?.role ?? 'hospital_admin'} />;
}

function RoleAwareRoute<T extends { role?: string }>({
  component: Component,
  props,
}: {
  component: ComponentType<T>;
  props?: Omit<T, 'role'>;
}) {
  const { user } = useAuth();
  return <Component {...(props as T)} role={user?.role ?? 'hospital_admin'} />;
}

function TenantRedirect({ path, preserveSearch = false }: { path: string; preserveSearch?: boolean }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const { search } = useLocation();
  return <Navigate to={buildTenantRedirectTarget(slug, path, search, preserveSearch)} replace />;
}

function ActionCenterApprovalsRoute() {
  return <DashboardLayout role="hospital_admin"><PendingApprovals embedded /></DashboardLayout>;
}

function DashboardEntryRoute() {
  const { user } = useAuth();
  const { slug = '' } = useParams<{ slug: string }>();
  const currentUserAccess = useCurrentUserAccess(Boolean(user));
  const effectiveRole = currentUserAccess.data?.user?.role ?? user?.role;
  const permissions = currentUserAccess.data?.effective_permissions ?? user?.permissions ?? [];

  if (effectiveRole === 'hospital_admin') return <AdminDashboard />;

  const workspace = resolveDashboardEntryWorkspace(effectiveRole, permissions);
  if (workspace) {
    return <Navigate to={`/h/${slug}/${workspace.path}`} replace />;
  }

  return <Navigate to="/unauthorized" replace />;
}

function HostRouteGuard() {
  const location = useLocation();

  if (isAdminHost()) {
    if (location.pathname === '/login') {
      return <Navigate to="/admin/login" replace />;
    }
    if (location.pathname.startsWith('/patient')) {
      return <Navigate to="/admin/login" replace />;
    }
  }

  if (isStaffAuthHost()) {
    if (location.pathname === '/admin' || location.pathname === '/admin/login') {
      return <Navigate to="/login" replace />;
    }
    if (location.pathname.startsWith('/patient')) {
      return <Navigate to="/login" replace />;
    }
  }

  if (isPatientAppHost()) {
    if (location.pathname === '/login') {
      return <Navigate to="/patient/login" replace />;
    }
  }

  return null;
}

function StaffSessionBootstrap({ children }: { children: ReactNode }) {
  // P0-34 follow-up: on every navigation, if the in-memory token is
  // gone (initial load, hard reload, tab restore) but we are not on a
  // public route, ask the backend to mint a fresh access token from the
  // HttpOnly staff session cookie. The token is then stored in memory
  // only — the cookie stays unreadable from JavaScript.
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      if (isAuthenticated) {
        if (!cancelled) setChecked(true);
        return;
      }

      const path = location.pathname;
      // Public routes do not need a staff session at all.
      const skip =
        path.startsWith('/patient') ||
        path.startsWith('/admin') ||
        path.startsWith('/signup') ||
        path.includes('/accept-invite') ||
        path === '/login' ||
        path === '/forgot-password' ||
        path === '/reset-password' ||
        path === '/unauthorized' ||
        path.startsWith('/marketplace') ||
        path.startsWith('/doctor');

      if (skip) {
        if (!cancelled) setChecked(true);
        return;
      }

      try {
        const res = await apiFetch<{
          token?: string;
          user?: { role?: string };
          hospital?: { id: number | string; name: string; slug: string };
        }>('/api/auth/refresh', { method: 'POST' });
        if (!cancelled && res.token) {
          saveToken(res.token, res.hospital?.slug ?? null, res.hospital ?? null);
        }
      } catch {
        // No valid HttpOnly session cookie. Let the normal route guards
        // (ProtectedRoute) send the user to /login.
      } finally {
        if (!cancelled) setChecked(true);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, location.pathname]);

  if (!checked) {
    return <LoadingFallback />;
  }
  return <>{children}</>;
}

function AdminSessionBootstrap({ children }: { children: ReactNode }) {
  // P0-34 follow-up, super_admin branch: on every navigation, if the
  // admin session indicator is gone (initial load, hard reload, tab
  // restore) but we are on a super-admin route, ask the backend to
  // confirm the HttpOnly `admin_token` cookie. The response only
  // returns a user indicator — the JWT itself stays in the cookie.
  const location = useLocation();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const path = location.pathname;
      const isAdminRoute =
        path === '/admin/login' ||
        path.startsWith('/super-admin') ||
        path === '/admin' ||
        path === '/admin/dashboard';

      if (!isAdminRoute) {
        if (!cancelled) setChecked(true);
        return;
      }

      if (isAdminAuthenticated()) {
        if (!cancelled) setChecked(true);
        return;
      }

      try {
        const res = await apiFetch<{
          user?: { id: string; email: string; name: string; role: string };
        }>('/api/admin/refresh', { method: 'POST' });
        if (!cancelled && res.user?.role === 'super_admin') {
          setAdminSession({
            userId: res.user.id,
            role: 'super_admin',
            name: res.user.name,
            email: res.user.email,
          });
        }
      } catch {
        try {
          const staffRes = await apiFetch<{
            user?: { id: string; email: string; name: string; role: string };
          }>('/api/admin/platform-staff/refresh', { method: 'POST' });
          const role = staffRes.user?.role;
          if (
            !cancelled &&
            staffRes.user &&
            (role === 'platform_admin' || role === 'platform_setup' || role === 'platform_support' || role === 'platform_auditor')
          ) {
            setAdminSession({
              userId: staffRes.user.id,
              role,
              name: staffRes.user.name,
              email: staffRes.user.email,
            });
          }
        } catch {
          // No valid HttpOnly admin/platform-staff session — let the normal
          // route guards (ProtectedRoute) send the user to /admin/login.
          clearAdminSession();
        }
      } finally {
        if (!cancelled) setChecked(true);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  if (!checked) {
    return <LoadingFallback />;
  }
  return <>{children}</>;
}

function App() {
  // Track SPA page views in Google Analytics 4
  useAnalytics();
  const hostSlug = getTenantSlugFromHost();
  const launchPath = getStoredPwaLaunchPath(localStorage);
  const resolvedLaunchPath = isAdminHost()
    ? '/admin/login'
    : isStaffAuthHost()
      ? '/login'
    : isPatientAppHost()
      ? '/patient/login'
    : hostSlug
      ? `/h/${hostSlug}`
      : launchPath;

  return (
    <>
      <Toaster position="top-right" />
      <AppIconSync />
      <PWAUpdatePrompt />
      <ImpersonationBanner />
      <HostRouteGuard />
      <AdminSessionBootstrap>
        <StaffSessionBootstrap>
        <Suspense fallback={<LoadingFallback />}>
        <Routes>
        {/* ─── Public: Landing / Marketing ─────────────────────────── */}
        <Route path="/" element={<Navigate to={resolvedLaunchPath} replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/patient/*" element={<PatientPortalHandoff />} />
        <Route path="/signup" element={<HospitalSignup />} />
        <Route path="/unauthorized" element={<Unauthorized />} />

        {/* ─── Admin portal shortcut ────────────────────────────────── */}
        <Route path="/admin" element={<Navigate to="/admin/login" replace />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/dashboard" element={<Navigate to="/super-admin/dashboard" replace />} />

        {/* ─── Super Admin Dashboard ───────────────────────────── */}
        <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
          <Route path="/super-admin/dashboard" element={<DashboardLayout role="super_admin"><SuperAdminDashboard /></DashboardLayout>} />
          <Route path="/super-admin/hospitals" element={<DashboardLayout role="super_admin"><SuperAdminHospitalList /></DashboardLayout>} />
          <Route path="/super-admin/hospitals/:id" element={<DashboardLayout role="super_admin"><SuperAdminHospitalDetail /></DashboardLayout>} />
          <Route path="/super-admin/onboarding" element={<DashboardLayout role="super_admin"><SuperAdminOnboardingQueue /></DashboardLayout>} />
          <Route path="/super-admin/settings" element={<DashboardLayout role="super_admin"><SuperAdminSettings /></DashboardLayout>} />
          <Route path="/super-admin/audit-log" element={<DashboardLayout role="super_admin"><SuperAdminAuditLog /></DashboardLayout>} />
          <Route path="/super-admin/health" element={<DashboardLayout role="super_admin"><SuperAdminHealth /></DashboardLayout>} />
        </Route>
        <Route element={<ProtectedRoute allowedRoles={['super_admin', 'platform_admin', 'platform_setup', 'platform_support', 'platform_auditor']} />}>
          <Route path="/super-admin/platform-staff" element={<DashboardLayout role="super_admin"><SuperAdminPlatformStaff /></DashboardLayout>} />
        </Route>

        {/* ─── Hospital slug-based routes: /h/:slug/* ───────────────── */}
        {/* All hospital access goes through /h/:slug so we can extract  */}
        {/* the tenant slug from the URL and inject it as X-Tenant-Subdomain */}
        <Route path="/h/:slug">
          {/* Public within slug context */}
          <Route path="login" element={<Login />} />
          <Route path="accept-invite" element={<AcceptInvite />} />
          <Route path="queue-display" element={<QueueDisplay />} />

          {/* ─── Read-only shareholder financial portal ───────────── */}
          <Route element={<ProtectedRoute requiredAllPermissions={['shareholder_portal:read']} />}>
            <Route path="shareholder/dashboard" element={<ShareholderViewerDashboard />} />
          </Route>

          {/* ─── Hospital Admin ─────────────────────────────────────── */}
          <Route element={<ProtectedRoute allowedRoles={['hospital_admin']} />}>
            <Route path="dashboard/v2" element={<AdminDashboard forceCommandCenter />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['hospital_admin', 'doctor', 'md', 'nurse', 'reception', 'laboratory', 'pharmacist', 'accountant', 'director', 'manager']} />}>
            <Route path="dashboard" element={<DashboardEntryRoute />} />
            <Route path="patients" element={<RoleAwareRoute component={PatientList} />} />
            <Route path="patients/new" element={<RoleAwareRoute component={PatientForm} />} />
            <Route path="patients/:id" element={<RoleAwareRoute component={PatientDetail} />} />
            <Route path="appointments" element={<RoleAwareRoute component={AppointmentScheduler} />} />
            <Route path="ai-assistant" element={<RoleAwareRoute component={AIAssistant} />} />
            <Route path="consultation-notes" element={<RoleAwareRoute component={ConsultationNotes} />} />
            <Route path="prescriptions/new" element={<DigitalPrescription />} />
            <Route path="prescriptions/:rxId" element={<DigitalPrescription />} />
            <Route path="prescriptions/:prescriptionId/print" element={<RoleAwareRoute component={PrescriptionPrint} />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['hospital_admin', 'doctor', 'md', 'nurse', 'reception', 'laboratory', 'pharmacist', 'accountant', 'director', 'shareholder_viewer']} />}>
            <Route path="profile" element={<RoleAwareRoute component={ProfilePage} />} />
          </Route>

          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('access-control')} />}>
            <Route path="permissions" element={<PermissionManagement role="hospital_admin" />} />
          </Route>

          <Route element={<ProtectedRoute requiredAnyPermissions={['staff:write']} />}>
            <Route path="invitations" element={<InviteStaff />} />
          </Route>

          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('reports-dashboard')} />}>
            <Route path="reports" element={<RoleAwareRoute component={ReportsDashboard} />} />
            <Route path="reports/pdf" element={<RoleAwareRoute component={AdminPdfGenerationPage} />} />
          </Route>

          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('inventory-dashboard')} />}>
            <Route path="inventory" element={<RoleAwareRoute component={InventoryDashboard} />} />
            <Route path="inventory/quick-start" element={<RoleAwareRoute component={InventoryQuickStartPage} />} />
            <Route path="inventory/stock" element={<RoleAwareRoute component={StockList} />} />
            <Route path="inventory/po" element={<RoleAwareRoute component={PurchaseOrderList} />} />
            <Route path="inventory/gr" element={<RoleAwareRoute component={GoodsReceiptList} />} />
            <Route path="inventory/requisitions" element={<RoleAwareRoute component={RequisitionList} />} />
            <Route path="inventory/dispatches" element={<RoleAwareRoute component={DispatchList} />} />
            <Route path="inventory/alerts" element={<RoleAwareRoute component={InventoryAlerts} />} />
            <Route path="inventory/overview" element={<RoleAwareRoute component={StockOverview} />} />
            <Route path="inventory/movements" element={<TenantRedirect path="inventory/stock" />} />
            <Route path="inventory/ledger" element={<RoleAwareRoute component={InventoryLedger} />} />
            <Route path="inventory/traceability" element={<RoleAwareRoute component={InventoryTraceability} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('inventory-reports')} />}>
            <Route path="inventory/reports" element={<RoleAwareRoute component={InventoryReportsPage} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('inventory-entry')} />}>
            <Route path="inventory/gr/new" element={<RoleAwareRoute component={GoodsReceiptForm} />} />
            <Route path="inventory/po/new" element={<RoleAwareRoute component={PurchaseOrderForm} />} />
            <Route path="inventory/requisitions/new" element={<RoleAwareRoute component={RequisitionForm} />} />
            <Route path="inventory/dispatches/new" element={<RoleAwareRoute component={DispatchForm} />} />
            <Route path="inventory/counts" element={<RoleAwareRoute component={InventoryCountPage} />} />
            <Route path="inventory/purchase" element={<RoleAwareRoute component={RequisitionList} />} />
            <Route path="inventory/master-data" element={<RoleAwareRoute component={InventoryMasterDataPage} />} />
            <Route path="inventory/consumption-rules" element={<RoleAwareRoute component={InventoryConsumptionAutomation} props={{ mode: 'rules' }} />} />
            <Route path="inventory/rfq" element={<RoleAwareRoute component={InventoryRFQPage} />} />
            <Route path="inventory/import-export" element={<RoleAwareRoute component={InventoryImportExportPage} />} />
            <Route path="inventory/donations" element={<RoleAwareRoute component={InventoryDonationPage} />} />
            <Route path="inventory/return-to-vendor" element={<RoleAwareRoute component={InventoryReturnToVendorPage} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['inventory:consume']} />}>
            <Route path="inventory/issues" element={<RoleAwareRoute component={InventoryIssuePage} />} />
            <Route path="inventory/returns" element={<RoleAwareRoute component={InventoryReturnPage} />} />
            <Route path="inventory/consumption-queue" element={<RoleAwareRoute component={InventoryConsumptionAutomation} props={{ mode: 'queue' }} />} />
            <Route path="inventory/consumption-exceptions" element={<RoleAwareRoute component={InventoryConsumptionAutomation} props={{ mode: 'exceptions' }} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['inventory:transfer']} />}>
            <Route path="inventory/transfers" element={<RoleAwareRoute component={InventoryTransferPage} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['inventory:adjust']} />}>
            <Route path="inventory/stock/adjust" element={<RoleAwareRoute component={StockAdjustment} />} />
            <Route path="inventory/adjustments" element={<RoleAwareRoute component={StockAdjustment} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('inventory-supervisor')} />}>
            <Route path="inventory/adjustment-requests" element={<RoleAwareRoute component={InventoryAdjustmentRequestPage} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['inventory:write', 'inventory:approve']} />}>
            <Route path="inventory/write-off" element={<RoleAwareRoute component={InventoryWriteOffPage} />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['hospital_admin']} />}>
            <Route path="tests" element={<LaboratoryDashboard role="hospital_admin" />} />
            <Route path="billing" element={<BillingDashboard role="hospital_admin" />} />
            <Route path="billing-counter" element={<BillingCounterPage role="hospital_admin" />} />
            <Route path="cash-bank-book" element={<CashBankBook role="hospital_admin" />} />
            <Route path="transaction-control" element={<AdminTransactionControlCenter role="hospital_admin" />} />
            <Route path="accounting" element={<AccountingDashboard role="hospital_admin" />} />
            <Route path="income" element={<IncomeList role="hospital_admin" />} />
            <Route path="expenses" element={<ExpenseList role="hospital_admin" />} />
            <Route path="recurring" element={<RecurringExpenses role="hospital_admin" />} />
            <Route path="accounts" element={<ChartOfAccounts role="hospital_admin" />} />
            <Route path="staff" element={<StaffPage role="hospital_admin" />} />
            <Route path="hr" element={<HRDashboard role="hospital_admin" />} />
            <Route path="hr/leave" element={<LeaveManagement role="hospital_admin" />} />
            <Route path="hr/payroll-generation" element={<PayrollGeneration role="hospital_admin" />} />
            <Route path="duty-roster" element={<DutyRoster role="hospital_admin" />} />
            <Route path="attendance-punch" element={<AttendancePunch role="hospital_admin" />} />
            <Route path="shareholders" element={<ShareholderManagement role="hospital_admin" />} />
            <Route path="journal" element={<JournalEntries role="hospital_admin" />} />
            <Route path="commissions" element={<CommissionManagement role="hospital_admin" />} />
            <Route path="test-catalog" element={<TestCatalog role="hospital_admin" />} />
            <Route path="profit-loss" element={<ProfitLoss role="hospital_admin" />} />
            <Route path="fiscal-year-settings" element={<FiscalYearSettings role="hospital_admin" />} />
            <Route path="voucher-verification" element={<VoucherVerification role="hospital_admin" />} />
            <Route path="billing-reports" element={<BillingReportsPage role="hospital_admin" />} />
            <Route path="audit" element={<SystemAuditLog role="hospital_admin" />} />
            <Route path="software-modules" element={<AdminModuleCatalog role="hospital_admin" />} />
            <Route path="settings" element={<SettingsPage role="hospital_admin" />} />
            <Route path="settings/billing" element={<SettingsPage role="hospital_admin" initialPanel="billing-settings" />} />
            <Route path="settings/email" element={<EmailSettings role="hospital_admin" />} />
            <Route path="settings/appointments" element={<AppointmentSettings role="hospital_admin" />} />
            <Route path="settings/security" element={<SecuritySettings role="hospital_admin" />} />
            <Route path="settings/backup" element={<BackupSettings role="hospital_admin" />} />
            <Route path="settings/import-export" element={<ImportExportSettings role="hospital_admin" />} />
            <Route path="mfa" element={<MfaSetup />} />
            <Route path="website" element={<WebsiteSettings role="hospital_admin" />} />
            <Route path="queue-management" element={<QueueManagement role="hospital_admin" />} />
            <Route path="lab/order/new" element={<LabTestOrderForm />} />
            <Route path="pharmacy/dispensing" element={<MedicineDispensing />} />
            <Route path="ipd-reports" element={<IPDReports role="hospital_admin" />} />
            <Route path="e-prescribing" element={<EPrescribingDashboard role="hospital_admin" />} />
            <Route path="safety-overrides" element={<SafetyOverrideAuditPage />} />
            <Route path="medical-records" element={<MedicalRecordsDashboard role="hospital_admin" />} />
            <Route path="admissions/:admissionId/discharge" element={<DischargeSummary role="hospital_admin" />} />
            <Route path="death-records" element={<DeathRecords role="hospital_admin" />} />
            <Route path="lab/:labId/report" element={<LabReportPrint role="hospital_admin" />} />
            <Route path="insurance-claims" element={<InsuranceClaims role="hospital_admin" />} />
            <Route path="insurance-billing" element={<InsuranceBillingPage role="hospital_admin" />} />
            <Route path="multi-branch" element={<MultiBranchDashboard role="hospital_admin" />} />
            <Route path="patient-portal" element={<PatientPortal />} />
            <Route path="triage" element={<TriageChatbot />} />
            <Route path="emergency" element={<EmergencyDashboard role="hospital_admin" />} />
            <Route path="ot" element={<OTDashboard role="hospital_admin" />} />
            <Route path="ot/calendar" element={<OTCalendar role="hospital_admin" />} />
            <Route path="ot/case/:bookingId" element={<IntraOpCanvas role="hospital_admin" />} />
            <Route path="ot/reports" element={<OTReports role="hospital_admin" />} />
            <Route path="ot/settings" element={<OTSettings role="hospital_admin" />} />
            <Route path="ot/commission-rules" element={<CommissionRules role="hospital_admin" />} />
            <Route path="surgery" element={<OTDashboard role="hospital_admin" />} />
            <Route path="deposits" element={<DepositsPage role="hospital_admin" />} />
            <Route path="credit-notes" element={<CreditNotesPage role="hospital_admin" />} />
            <Route path="settlements" element={<PatientSettlementsPage role="hospital_admin" />} />
            <Route path="billing-handover" element={<BillingHandoverPage role="hospital_admin" />} />
            <Route path="billing-cancellation" element={<BillCancellationPage role="hospital_admin" />} />
            <Route path="payments" element={<PaymentsPage role="hospital_admin" />} />
            <Route path="inbox" element={<InboxPage role="hospital_admin" />} />
            <Route path="medical-records" element={<MedicalRecordsDashboard role="hospital_admin" />} />
            <Route path="radiology" element={<RadiologyDashboard />} />
            <Route path="vaccination" element={<VaccinationDashboard />} />
            <Route path="health-records" element={<HealthRecordSharing role="hospital_admin" />} />
            <Route path="patient-card-scan" element={<PatientCardScanner role="hospital_admin" />} />
            <Route path="import-records" element={<ImportExternalRecords role="hospital_admin" />} />
            <Route path="helpdesk" element={<HelpdeskDashboard role="hospital_admin" />} />
            <Route path="psychiatry" element={<Psychiatry role="hospital_admin" />} />
            <Route path="marketing-referral" element={<MarketingReferral role="hospital_admin" />} />
            <Route path="group-attendance" element={<GroupAttendance role="hospital_admin" />} />
            <Route path="fee-sheet" element={<FeeSheet role="hospital_admin" />} />
            <Route path="camos" element={<Camos role="hospital_admin" />} />
            {/* ─── Inventory ─────────────────────────────── */}
            <Route path="inventory" element={<InventoryDashboard role="hospital_admin" />} />
            <Route path="inventory/quick-start" element={<InventoryQuickStartPage role="hospital_admin" />} />
            <Route path="inventory/stock" element={<StockList role="hospital_admin" />} />
            <Route element={<ProtectedRoute requiredAnyPermissions={['inventory:adjust']} />}>
              <Route path="inventory/stock/adjust" element={<StockAdjustment role="hospital_admin" />} />
            </Route>
            <Route path="inventory/po" element={<PurchaseOrderList role="hospital_admin" />} />
            <Route path="inventory/po/new" element={<PurchaseOrderForm role="hospital_admin" />} />
            <Route path="inventory/gr" element={<GoodsReceiptList role="hospital_admin" />} />
            <Route element={<ProtectedRoute requiredAnyPermissions={['inventory:write']} />}>
              <Route path="inventory/gr/new" element={<GoodsReceiptForm role="hospital_admin" />} />
            </Route>
            <Route path="inventory/requisitions" element={<RequisitionList role="hospital_admin" />} />
            <Route path="inventory/requisitions/new" element={<RequisitionForm role="hospital_admin" />} />
            <Route path="inventory/dispatches" element={<DispatchList role="hospital_admin" />} />
            <Route path="inventory/dispatches/new" element={<DispatchForm role="hospital_admin" />} />
            <Route path="inventory/issues" element={<InventoryIssuePage role="hospital_admin" />} />
            <Route element={<ProtectedRoute requiredAnyPermissions={['inventory:transfer']} />}>
              <Route path="inventory/transfers" element={<InventoryTransferPage role="hospital_admin" />} />
            </Route>
            <Route path="inventory/returns" element={<InventoryReturnPage role="hospital_admin" />} />
            <Route path="inventory/counts" element={<InventoryCountPage role="hospital_admin" />} />
            <Route path="inventory/reports" element={<InventoryReportsPage role="hospital_admin" />} />
            <Route path="inventory/adjustment-requests" element={<InventoryAdjustmentRequestPage role="hospital_admin" />} />
            <Route path="inventory/write-off" element={<InventoryWriteOffPage role="hospital_admin" />} />
            <Route path="inventory/return-to-vendor" element={<InventoryReturnToVendorPage role="hospital_admin" />} />
            <Route path="inventory/master-data" element={<InventoryMasterDataPage role="hospital_admin" />} />
            <Route path="inventory/rfq" element={<InventoryRFQPage role="hospital_admin" />} />
            <Route path="inventory/import-export" element={<InventoryImportExportPage role="hospital_admin" />} />
            <Route path="inventory/donations" element={<InventoryDonationPage role="hospital_admin" />} />
            <Route path="inventory/ledger" element={<InventoryLedger role="hospital_admin" />} />
            <Route path="inventory/traceability" element={<InventoryTraceability role="hospital_admin" />} />
            <Route path="inventory/consumption-rules" element={<InventoryConsumptionAutomation role="hospital_admin" mode="rules" />} />
            <Route path="inventory/consumption-queue" element={<InventoryConsumptionAutomation role="hospital_admin" mode="queue" />} />
            <Route path="inventory/consumption-exceptions" element={<InventoryConsumptionAutomation role="hospital_admin" mode="exceptions" />} />
            <Route path="inventory/accounting" element={<InventoryAccounting role="hospital_admin" />} />
            <Route path="asset-management" element={<AssetManagement role="hospital_admin" />} />
            <Route path="kitchen" element={<KitchenManagement role="hospital_admin" />} />
            <Route path="blood-bank" element={<BloodBankManagement role="hospital_admin" />} />
            <Route path="mlc" element={<MlcManagement role="hospital_admin" />} />
            <Route path="cssd" element={<CssdManagement role="hospital_admin" />} />
            <Route path="laundry" element={<LaundryManagement role="hospital_admin" />} />
            <Route path="ambulance" element={<AmbulanceManagement role="hospital_admin" />} />
            <Route path="mortuary" element={<MortuaryManagement role="hospital_admin" />} />
            <Route path="maternity" element={<MaternityDashboard role="hospital_admin" />} />
            <Route path="patient-duplicates" element={<PatientDuplicates role="hospital_admin" />} />
            <Route path="whatsapp" element={<WhatsAppDashboard role="hospital_admin" />} />
            <Route path="print-templates" element={<PrintTemplateSettings role="hospital_admin" />} />
            <Route path="biomedical-waste" element={<BiomedicalWasteManagement role="hospital_admin" />} />
            {/* ─── Billing Master & Provisional ─────────────────── */}
            <Route path="billing-master" element={<BillingMasterPage role="hospital_admin" />} />
            <Route path="billing-provisional" element={<ProvisionalBillingPage role="hospital_admin" />} />
            {/* ─── Lab Settings ─────────────────────────────────── */}
            <Route path="lab-settings" element={<LabSettingsPage role="hospital_admin" />} />
            <Route path="lab-machines" element={<LabMachineSettings role="hospital_admin" />} />
            {/* ─── RBAC & Admin ────────────────────────────────── */}
            <Route path="quality-kpi" element={<QualityKpiDashboard role="hospital_admin" />} />
            {/* ─── Reports ──────────────────────────────────────── */}
            <Route path="reports/lab" element={<ReportLabPage role="hospital_admin" />} />
            <Route path="reports/pharmacy" element={<ReportPharmacyPage role="hospital_admin" />} />
            <Route path="reports/appointments" element={<ReportAppointmentPage role="hospital_admin" />} />
            {/* ─── Help Center ─────────────────────────────────────── */}
            <Route path="help" element={<HelpCenterPage />} />
            <Route path="patient-experience/reviews" element={<ReviewModerationPage role="hospital_admin" />} />
            <Route path="review-moderation" element={<TenantRedirect path="patient-experience/reviews" preserveSearch />} />
            <Route path="marketplace-bookings" element={<MarketplaceBookingQueue role="hospital_admin" />} />
            <Route path="referrals" element={<IncomingReferralQueue role="hospital_admin" />} />
            <Route path="referrals/new" element={<CreateReferral role="hospital_admin" />} />
            <Route path="setup" element={<HospitalSetupWizard role="hospital_admin" />} />
            <Route path="doctors" element={<DoctorList role="hospital_admin" />} />
            <Route path="doctors/:id" element={<DoctorDetail />} />
            <Route path="approvals" element={<TenantRedirect path="action" />} />
            {/* ─── Action Center ───────────────────────────────────── */}
            <Route path="admin-dashboard" element={<TenantRedirect path="dashboard" />} />
            <Route path="action" element={<ActionCenterOverview />} />
            <Route path="action/approvals" element={<ActionCenterApprovalsRoute />} />
            <Route path="action/exceptions" element={<AlertsExceptions />} />
            <Route path="action/collections" element={<DueReceivables />} />
            <Route path="action/tasks" element={<TasksFollowups />} />
            <Route path="action/pending-approvals" element={<TenantRedirect path="action/approvals" preserveSearch />} />
            <Route path="alerts" element={<TenantRedirect path="action/exceptions" preserveSearch />} />
            <Route path="tasks" element={<TenantRedirect path="action/tasks" preserveSearch />} />
            <Route path="monitor/operations" element={<OperationsMonitorPage />} />
            <Route path="monitor/opd" element={<OPDMonitor />} />
            <Route path="monitor/lab" element={<DiagnosticMonitor />} />
            <Route path="monitor/ipd" element={<TenantRedirect path="beds" />} />
            <Route path="monitor/ot" element={<RoleAwareRoute component={OTDashboard} />} />
            <Route path="monitor/pharmacy" element={<PharmacyMonitor />} />
            <Route path="monitor/telemedicine" element={<TenantRedirect path="telemedicine" />} />
            <Route path="monitor/emergency" element={<RoleAwareRoute component={EmergencyDashboard} />} />
            <Route path="cash/drawers" element={<AdminTransactionControlCenter role="hospital_admin" />} />
            <Route path="cash/drawers/:drawerId" element={<CashDrawerDetail />} />
            <Route path="cash/handover" element={<RoleAwareRoute component={BillingHandoverPage} />} />
            <Route path="cash/handover/:handoverId" element={<ShiftHandoverDetail />} />
            <Route path="cash/collections" element={<ReceptionReportsPage role="hospital_admin" />} />
            <Route path="cash/discounts" element={<DiscountReview />} />
            <Route path="cash/discounts/analytics" element={<DiscountReferenceAnalytics />} />
            <Route path="cash/refunds" element={<RefundDetail />} />
            <Route path="cash/refunds/:refundId" element={<RefundRequestDetail />} />
            <Route path="cash/expenses" element={<RoleAwareRoute component={ExpenseList} />} />
            <Route path="cash/expenses/:expenseId" element={<ExpenseDetailPage />} />
            <Route path="cash/commissions" element={<RoleAwareRoute component={CommissionManagement} />} />
            <Route path="cash/commissions/:doctorId" element={<DoctorPayoutDetail />} />
            <Route path="cash/dues" element={<TenantRedirect path="action/collections" preserveSearch />} />
            <Route path="cash/followups" element={<TenantRedirect path="action/collections?followup=due" preserveSearch />} />
            <Route path="cash/deposits" element={<RoleAwareRoute component={DepositsPage} />} />
            <Route path="inventory/alerts" element={<InventoryAlerts />} />
            <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('reagent-control')} />}>
              <Route path="reagent-control" element={<LabMonitoringDashboard role="hospital_admin" mode="reagent-control" />} />
            </Route>
            <Route path="inventory/overview" element={<StockOverview />} />
            <Route path="inventory/movements" element={<TenantRedirect path="inventory/stock" />} />
            <Route path="inventory/purchase" element={<RoleAwareRoute component={RequisitionList} />} />
            <Route path="inventory/adjustments" element={<RoleAwareRoute component={StockAdjustment} />} />
            <Route path="sessions" element={<LoginSessions />} />
            <Route path="activity-log" element={<AuditExplorer />} />
            <Route path="system-audit" element={<SystemAuditLog role="hospital_admin" />} />
            <Route path="audit/financial" element={<FinancialAudit />} />
            <Route path="audit/safety-overrides" element={<SafetyOverrideAuditPage />} />
            <Route path="reports/financial" element={<TenantRedirect path="reports" />} />
            <Route path="audit/patient-access" element={<PatientRecordAccess />} />
            <Route path="audit/suspicious" element={<SuspiciousActivities />} />
            <Route path="audit/offline-sync" element={<OfflineSyncReview />} />
            <Route path="audit/exports" element={<ExportHistory />} />
            <Route path="analytics/executive" element={<TenantRedirect path="reports" />} />
            <Route path="analytics/revenue" element={<TenantRedirect path="reports" />} />
            <Route path="analytics/departments" element={<TenantRedirect path="reports" />} />
            <Route path="analytics/doctors" element={<TenantRedirect path="reports" />} />
            <Route path="analytics/patients" element={<PatientAnalytics />} />
            <Route path="analytics/inventory" element={<TenantRedirect path="inventory/reports" />} />
            <Route path="analytics/branches" element={<BranchComparisonPage />} />
            <Route path="analytics/builder" element={<TenantRedirect path="reports" />} />
            <Route path="settings/approval-policies" element={<ApprovalPolicies />} />
            <Route path="settings/discounts" element={<TenantRedirect path="settings/billing" />} />
            <Route path="settings/notifications" element={<NotificationSettings />} />
            <Route path="settings/escalation-rules" element={<EscalationRules />} />
            <Route path="settings/hospital-profile" element={<HospitalProfileAdmin />} />
            <Route path="settings/departments" element={<RoleAwareRoute component={DepartmentsSettings} />} />
            <Route path="settings/payments" element={<RoleAwareRoute component={PaymentMethodsSettings} />} />
            <Route path="settings/sms" element={<RoleAwareRoute component={EmailSettings} />} />
            <Route path="settings/preferences" element={<RoleAwareRoute component={SystemPreferences} />} />
          </Route>

          {/* ─── IPD admissions and billing (reception can manage bed transfer here) ─── */}
          <Route element={<ProtectedRoute allowedRoles={['hospital_admin', 'nurse', 'md', 'reception', 'receptionist', 'accountant']} />}>
            <Route path="admissions" element={<RoleAwareRoute component={AdmissionIPD} />} />
            <Route path="admissions/:admissionId/print" element={<RoleAwareRoute component={AdmissionSlipPrint} />} />
            <Route path="ip-billing" element={<RoleAwareRoute component={IPBillingPage} />} />
            <Route path="ip-billing/:admissionId/running-print" element={<RoleAwareRoute component={IPDRunningBillPrint} />} />
          </Route>

          {/* ─── Nursing Module (accessible by nurse + hospital_admin) ─── */}
          <Route element={<ProtectedRoute allowedRoles={['hospital_admin', 'nurse', 'md']} />}>
            <Route path="nurse-tasks" element={<RoleAwareRoute component={NurseTasksPage} />} />
            <Route path="beds" element={<RoleAwareRoute component={BedManagement} />} />            <Route path="ward-supply" element={<RoleAwareRoute component={WardSupplyDashboard} />} />
            <Route path="discharge-planning" element={<RoleAwareRoute component={DischargePlanningPage} />} />
            <Route path="housekeeping" element={<RoleAwareRoute component={HousekeepingManagement} />} />
            <Route path="allergies" element={<RoleAwareRoute component={AllergiesPage} />} />
            <Route path="notifications" element={<RoleAwareRoute component={NotificationsCenter} />} />
            <Route path="nurse-workload" element={<RoleAwareRoute component={NurseWorkloadPage} />} />
            <Route path="help" element={<HelpCenterPage />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['hospital_admin', 'md', 'doctor']} />}>
            <Route path="telemedicine" element={<TelemedicineDashboardRoute />} />
            <Route path="telemedicine/room/:roomId" element={<TelemedicineRoomRoute />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['hospital_admin', 'doctor', 'md', 'nurse', 'reception']} />}>
            <Route path="patients/:id/timeline" element={<RoleAwareRoute component={PatientTimeline} />} />
            <Route path="patients/:id/chart" element={<RoleAwareRoute component={PatientChartWorkspace} />} />
            <Route path="patients/:id/chart/print" element={<RoleAwareRoute component={PatientChartPrint} />} />
            <Route path="patient-card-scan" element={<RoleAwareRoute component={PatientCardScanner} />} />
            <Route path="import-records" element={<RoleAwareRoute component={ImportExternalRecords} />} />
            <Route path="dental" element={<RoleAwareRoute component={Dental} />} />
            <Route path="psychiatry" element={<RoleAwareRoute component={Psychiatry} />} />
            <Route path="eye-exam" element={<RoleAwareRoute component={EyeExamDashboard} />} />
            <Route path="physical-exam" element={<RoleAwareRoute component={PhysicalExamDashboard} />} />
            <Route path="dictation" element={<RoleAwareRoute component={DictationPage} />} />
            <Route path="clinical" element={<RoleAwareRoute component={ClinicalAssessments} />} />
            <Route path="care-plans" element={<RoleAwareRoute component={CarePlansDashboard} />} />
            <Route path="track-anything" element={<RoleAwareRoute component={TrackAnythingDashboard} />} />
            <Route path="prior-auth" element={<RoleAwareRoute component={PriorAuthDashboard} />} />
            <Route path="procedure-orders" element={<RoleAwareRoute component={ProcedureOrdersDashboard} />} />
            <Route path="questionnaires" element={<RoleAwareRoute component={QuestionnairesPage} />} />
            <Route path="form-builder" element={<RoleAwareRoute component={CustomFormBuilder} />} />
            <Route path="group-attendance" element={<RoleAwareRoute component={GroupAttendance} />} />
            <Route path="fee-sheet" element={<RoleAwareRoute component={FeeSheet} />} />
            <Route path="camos" element={<RoleAwareRoute component={Camos} />} />
            {/* ─── Order Sets, Clinical Reminders, Consents, Documents ─── */}
            <Route path="order-sets" element={<RoleAwareRoute component={OrderSetManager} />} />
            <Route path="clinical-reminders" element={<RoleAwareRoute component={ClinicalRemindersPage} />} />
            <Route path="consents" element={<RoleAwareRoute component={ConsentManagement} />} />
            <Route path="billing/:billId/print" element={<RoleAwareRoute component={BillPrint} />} />
            <Route path="billing/:billId/lab-print" element={<RoleAwareRoute component={LabTestBillPrint} />} />
            <Route path="documents" element={<RoleAwareRoute component={DocumentManager} />} />
          </Route>

          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('doctor-dashboard')} />}>
            <Route path="doctor/dashboard" element={<DoctorDashboard />} />
            <Route path="doctor/profile" element={<DoctorSelfProfile />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['doctor', 'md', 'hospital_admin']} />}>
            <Route path="doctor/lab-results" element={<DoctorLabResults />} />
            <Route path="doctor/prescriptions" element={<DigitalPrescription />} />
            <Route path="doctor/opd/:patientId/:apptId" element={<RoleAwareRoute component={OPDRecord} />} />
            <Route path="doctor/ipd/:admissionId" element={<RoleAwareRoute component={IPDWorkspace} />} />
            <Route path="doctor/ipd/:admissionId/discharge" element={<DischargeSummary role="doctor" />} />
            <Route path="doctor/lab-orders" element={<LabTestOrderForm />} />
            <Route path="patients/:id/overview" element={<RoleAwareRoute component={PatientOverview} />} />
            <Route path="patients/:id/visits/:visitId/summary" element={<RoleAwareRoute component={VisitSummaryPage} />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['doctor']} />}>
            <Route path="doctors/dashboard" element={<Navigate to="doctor/dashboard" replace />} />
            <Route path="doctor/report-review" element={<DoctorReportReview />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['doctor', 'md']} />}>
            <Route path="doctor/certificates" element={<DoctorCertificates />} />
            <Route path="doctor/referrals" element={<IncomingReferralQueue role="doctor" />} />
            <Route path="doctor/referrals/new" element={<CreateReferral role="doctor" />} />
          </Route>

          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('nursing-dashboard')} />}>
            <Route path="nurse-station" element={<NurseStationRoute />} />
            <Route path="nursing" element={<NursingDashboardRoute />} />
            <Route path="nurse-reports" element={<NurseReportsRoute />} />
            <Route path="vitals" element={<VitalsRoute />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['doctor', 'nurse', 'md', 'hospital_admin']} />}>
            <Route path="doctor-schedule" element={<DoctorScheduleRoute />} />
          </Route>

          {/* ─── Manager ─────────────────────────────────────────────── */}
          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('manager-dashboard')} />}>
            <Route path="manager/dashboard" element={<DashboardLayout role="manager"><ManagerDashboard /></DashboardLayout>} />
          </Route>

          {/* ─── Laboratory ──────────────────────────────────────────── */}
          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('lab-dashboard')} />}>
            <Route path="lab/dashboard" element={<LaboratoryDashboard />} />
            <Route path="lab/tests" element={<LaboratoryDashboard />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['tests:write']} />}>
            <Route path="lab/orders" element={<LabTestOrderForm />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['lab_machines:read', 'lab_machines:write']} />}>
            <Route path="lab/machines" element={<RoleAwareRoute component={LabMachineSettings} />} />
            <Route path="lab/monitoring" element={<LabMonitoringDashboard />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['lab_machines:write']} />}>
            <Route path="lab/settings" element={<LabSettingsPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['tests:verify']} />}>
            <Route path="lab/qc" element={<LabQcDashboard />} />
          </Route>

          {/* ─── Reception ───────────────────────────────────────────── */}
          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('reception-dashboard')} />}>
            <Route path="reception/dashboard" element={<RoleAwareRoute component={ReceptionDashboard} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['billing:cash:read', 'billing:counter:handover', 'accounting:read', 'billing:read', 'billing.counter.read', 'billing.counter.management_cash.read', 'billing.counter.management_cash.receive']} />}>
            <Route path="reception/cash-operations" element={<CashOperationsPage />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['patients:read']} />}>
            <Route path="reception/patients" element={<RoleAwareRoute component={PatientList} />} />
            <Route path="reception/patients/:id" element={<RoleAwareRoute component={PatientDetail} />} />
            <Route path="reception/patient-card-scan" element={<PatientCardScanner role="reception" />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['patients:write']} />}>
            <Route path="reception/patients/new" element={<RoleAwareRoute component={PatientForm} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['billing:read', 'billing.counter.read']} />}>
            <Route path="reception/billing-counter" element={<BillingCounterPage role="reception" />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['billing:read']} />}>
            <Route path="reception/billing" element={<BillingDashboard role="reception" />} />
            <Route path="reception/billing-provisional" element={<ProvisionalBillingPage role="reception" />} />
            <Route path="reception/billing/:billId/print" element={<RoleAwareRoute component={BillPrint} />} />
            <Route path="reception/billing/:billId/lab-print" element={<RoleAwareRoute component={LabTestBillPrint} />} />
            <Route path="reception/payments" element={<PaymentsPage role="reception" />} />
            <Route path="reception/deposits" element={<RoleAwareRoute component={DepositsPage} />} />
            <Route path="reception/credit-notes" element={<RoleAwareRoute component={CreditNotesPage} />} />
            <Route path="reception/settlements" element={<PatientSettlementsPage role="reception" />} />
            <Route path="reception/billing-handover" element={<RoleAwareRoute component={BillingHandoverPage} />} />
            <Route path="reception/insurance" element={<RoleAwareRoute component={InsuranceBillingPage} />} />
            <Route path="reception/reports" element={<RoleAwareRoute component={ReceptionReportsPage} />} />
            <Route path="reception/reports/pdf" element={<RoleAwareRoute component={AdminPdfGenerationPage} />} />
            <Route path="reception/print" element={<RoleAwareRoute component={ReceptionPrintCenter} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['ip-billing:read']} />}>
            <Route path="reception/ip-billing" element={<IPBillingPage role="reception" />} />
            <Route path="reception/ip-billing/:admissionId/running-print" element={<RoleAwareRoute component={IPDRunningBillPrint} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['appointments:read']} />}>
            <Route path="reception/appointments" element={<RoleAwareRoute component={AppointmentScheduler} />} />
            <Route path="reception/queue" element={<RoleAwareRoute component={QueueManagement} />} />
            <Route path="reception/doctor-status" element={<RoleAwareRoute component={DoctorStatusPage} />} />
            <Route path="reception/online-approvals" element={<RoleAwareRoute component={OnlineAppointmentApproval} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['prescriptions:write']} />}>
            <Route path="reception/prescriptions/new" element={<DigitalPrescription />} />
            <Route path="reception/prescriptions/:rxId" element={<DigitalPrescription />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['beds:read', 'admissions:read']} />}>
            <Route path="reception/beds" element={<RoleAwareRoute component={BedManagement} />} />
            <Route path="reception/admissions" element={<RoleAwareRoute component={AdmissionIPD} />} />
            <Route path="reception/admissions/:admissionId/print" element={<RoleAwareRoute component={AdmissionSlipPrint} />} />
            <Route path="reception/ipd-reports" element={<RoleAwareRoute component={IPDReports} />} />
            <Route path="reception/admissions/:admissionId/discharge" element={<DischargeSummary role="reception" />} />
            <Route path="reception/death-records" element={<DeathRecords role="reception" />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['blood_bank:read']} />}>
            <Route path="reception/blood-bank" element={<BloodBankManagement role="reception" />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['ambulance:read']} />}>
            <Route path="reception/ambulance" element={<AmbulanceManagement role="reception" />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['dashboard:read', 'patients:read', 'appointments:read', 'billing:read']} />}>
            <Route path="reception/help" element={<HelpCenterPage />} />
          </Route>

          {/* ─── Managing Director / permission-based management workspace ─── */}
          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('md-dashboard')} />}>
            <Route path="md/dashboard" element={<RoleAwareRoute component={MDDashboard} />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['md']} />}>
            <Route path="md/pending-approvals" element={<PendingApprovals role="md" />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['staff:read']} />}>
            <Route path="md/staff" element={<RoleAwareRoute component={StaffPage} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['hr:read']} />}>
            <Route path="md/hr" element={<RoleAwareRoute component={HRDashboard} />} />
            <Route path="md/hr/leave" element={<RoleAwareRoute component={LeaveManagement} />} />
            <Route path="md/duty-roster" element={<RoleAwareRoute component={DutyRoster} />} />
            <Route path="md/attendance-punch" element={<RoleAwareRoute component={AttendancePunch} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['accounting:read']} />}>
            <Route path="md/accounting" element={<RoleAwareRoute component={AccountingDashboard} />} />
            <Route path="md/accounts" element={<RoleAwareRoute component={ChartOfAccounts} />} />
            <Route path="md/handover" element={<RoleAwareRoute component={BillingHandoverPage} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['income:read']} />}>
            <Route path="md/income" element={<RoleAwareRoute component={IncomeList} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['expenses:read']} />}>
            <Route path="md/expenses" element={<RoleAwareRoute component={ExpenseList} />} />
            <Route path="md/recurring" element={<RoleAwareRoute component={RecurringExpenses} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['reports:read']} />}>
            <Route path="md/reports" element={<RoleAwareRoute component={Reports} />} />
            <Route path="md/reports/pdf" element={<RoleAwareRoute component={AdminPdfGenerationPage} />} />
            <Route path="md/discounts" element={<RoleAwareRoute component={DiscountReview} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['audit:read']} />}>
            <Route path="md/audit" element={<RoleAwareRoute component={SystemAuditLog} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['profit:calculate']} />}>
            <Route path="md/profit" element={<RoleAwareRoute component={ProfitLoss} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['fiscalYear:write']} />}>
            <Route path="md/fiscal-year-settings" element={<RoleAwareRoute component={FiscalYearSettings} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['voucher:verify']} />}>
            <Route path="md/voucher-verification" element={<RoleAwareRoute component={VoucherVerification} />} />
          </Route>
          <Route element={<ProtectedRoute requiredAnyPermissions={['dashboard:read', 'reports:read', 'staff:read', 'accounting:read']} />}>
            <Route path="md/help" element={<HelpCenterPage />} />
          </Route>

          {/* ─── Director ────────────────────────────────────────────── */}
          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('director-dashboard')} />}>
            <Route path="director/dashboard" element={<RoleAwareRoute component={DirectorDashboard} />} />
          </Route>
          <Route element={<ProtectedRoute allowedRoles={['director', 'hospital_admin']} />}>
            <Route path="director/pending-approvals" element={<PendingApprovals role="director" />} />
            <Route path="director/accounting" element={<RoleAwareRoute component={AccountingDashboard} />} />
            <Route path="director/income" element={<RoleAwareRoute component={IncomeList} />} />
            <Route path="director/expenses" element={<RoleAwareRoute component={ExpenseList} />} />
            <Route path="director/recurring" element={<RoleAwareRoute component={RecurringExpenses} />} />
            <Route path="director/accounts" element={<RoleAwareRoute component={ChartOfAccounts} />} />
            <Route path="director/reports" element={<RoleAwareRoute component={Reports} />} />
            <Route path="director/reports/pdf" element={<RoleAwareRoute component={AdminPdfGenerationPage} />} />
            <Route path="director/discounts" element={<RoleAwareRoute component={DiscountReview} />} />
            <Route path="director/audit" element={<RoleAwareRoute component={SystemAuditLog} />} />
            <Route path="director/shareholders" element={<RoleAwareRoute component={ShareholderManagement} />} />
            <Route path="director/profit" element={<RoleAwareRoute component={ProfitLoss} />} />
            <Route path="director/fiscal-year-settings" element={<RoleAwareRoute component={FiscalYearSettings} />} />
            <Route path="director/voucher-verification" element={<RoleAwareRoute component={VoucherVerification} />} />
            <Route path="director/settings" element={<RoleAwareRoute component={SettingsPage} />} />
            <Route path="director/help" element={<HelpCenterPage />} />
          </Route>

          {/* ─── Pharmacist ──────────────────────────────────────────── */}
          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('pharmacy-dashboard')} />}>
            <Route path="pharmacy" element={<RoleAwareRoute component={PharmacyOverview} />} />
            <Route path="pharmacy/dashboard" element={<RoleAwareRoute component={PharmacyOverview} />} />
            <Route path="pharmacy/items" element={<RoleAwareRoute component={PharmItemList} />} />
            <Route path="pharmacy/categories" element={<RoleAwareRoute component={PharmCategoryList} />} />
            <Route path="pharmacy/generics" element={<RoleAwareRoute component={PharmGenericList} />} />
            <Route path="pharmacy/suppliers" element={<RoleAwareRoute component={PharmSupplierList} />} />
            <Route path="pharmacy/stock" element={<RoleAwareRoute component={PharmStockList} />} />
            <Route path="pharmacy/po" element={<RoleAwareRoute component={PharmPurchaseOrderList} />} />
            <Route path="pharmacy/po/new" element={<RoleAwareRoute component={PharmPurchaseOrderForm} />} />
            <Route path="pharmacy/grn" element={<RoleAwareRoute component={PharmGoodsReceiptList} />} />
            <Route path="pharmacy/grn/new" element={<RoleAwareRoute component={PharmGoodsReceiptForm} />} />
            <Route path="pharmacy/invoices" element={<RoleAwareRoute component={PharmInvoiceList} />} />
            <Route path="pharmacy/invoices/new" element={<RoleAwareRoute component={PharmInvoiceForm} />} />
            <Route path="pharmacy/deposits" element={<RoleAwareRoute component={PharmDepositList} />} />
            <Route path="pharmacy/settlements" element={<RoleAwareRoute component={PharmSettlementList} />} />
            <Route path="pharmacy/prescriptions" element={<RoleAwareRoute component={PharmPrescriptionList} />} />
            <Route path="pharmacy/narcotics" element={<RoleAwareRoute component={PharmNarcoticRegister} />} />
            <Route path="pharmacy/write-offs" element={<RoleAwareRoute component={PharmWriteOffList} />} />
            <Route path="pharmacy/dispatches" element={<RoleAwareRoute component={PharmDispatchList} />} />
            <Route path="pharmacy/patient-billing" element={<RoleAwareRoute component={PatientBillingPage} />} />
            <Route path="pharmacy/invoices/:id/receipt" element={<RoleAwareRoute component={InvoiceReceipt} />} />
            <Route path="pharmacy/reports/stock" element={<RoleAwareRoute component={StockReport} />} />
            <Route path="pharmacy/reports/sales" element={<RoleAwareRoute component={SalesReport} />} />
            <Route path="pharmacy/reports/expiry" element={<RoleAwareRoute component={ExpiryReport} />} />
            <Route path="pharmacy/supplier-ledger" element={<RoleAwareRoute component={SupplierLedger} />} />
            <Route path="pharmacy/dispensary-stock" element={<RoleAwareRoute component={DispensaryStock} />} />
            <Route path="pharmacy/tax-config" element={<RoleAwareRoute component={TaxConfigPage} />} />
            <Route path="pharmacy/dosage-templates" element={<RoleAwareRoute component={DosageTemplatesPage} />} />
            <Route path="pharmacy/approval-queue" element={<RoleAwareRoute component={ApprovalQueuePage} />} />
            <Route path="pharmacy/price-history" element={<RoleAwareRoute component={ItemPriceHistory} />} />
            <Route path="pharmacy/help" element={<HelpCenterPage />} />
            <Route path="pharmacy/returns" element={<RoleAwareRoute component={PharmReturnList} />} />
          </Route>

          <Route element={<ProtectedRoute requiredAnyPermissions={workspacePermissions('accounting-dashboard')} />}>
            <Route path="accountant/dashboard" element={<RoleAwareRoute component={AccountingDashboard} />} />
            <Route path="accountant/accounting" element={<RoleAwareRoute component={AccountingDashboard} />} />
            <Route path="accountant/billing-counter" element={<RoleAwareRoute component={BillingCounterPage} />} />
            <Route path="accountant/cash-bank-book" element={<RoleAwareRoute component={CashBankBook} />} />
            <Route path="accountant/deposits" element={<RoleAwareRoute component={DepositsPage} />} />
            <Route path="accountant/credit-notes" element={<RoleAwareRoute component={CreditNotesPage} />} />
            <Route path="accountant/settlements" element={<RoleAwareRoute component={PatientSettlementsPage} />} />
            <Route path="accountant/billing-handover" element={<RoleAwareRoute component={BillingHandoverPage} />} />
            <Route path="accountant/billing-cancellation" element={<RoleAwareRoute component={BillCancellationPage} />} />
            <Route path="accountant/payments" element={<RoleAwareRoute component={PaymentsPage} />} />
            <Route path="accountant/commissions" element={<RoleAwareRoute component={CommissionManagement} />} />
            <Route path="accountant/accounts" element={<RoleAwareRoute component={ChartOfAccounts} />} />
            <Route path="accountant/journal" element={<RoleAwareRoute component={JournalEntries} />} />
            <Route path="accountant/audit" element={<RoleAwareRoute component={SystemAuditLog} />} />
            <Route path="accountant/fiscal-year-settings" element={<RoleAwareRoute component={FiscalYearSettings} />} />
            <Route path="accountant/voucher-verification" element={<RoleAwareRoute component={VoucherVerification} />} />
            <Route path="accountant/income" element={<RoleAwareRoute component={IncomeList} />} />
            <Route path="accountant/expenses" element={<RoleAwareRoute component={ExpenseList} />} />
            <Route path="accountant/reports" element={<RoleAwareRoute component={Reports} />} />
          </Route>

          {/* Default redirect within slug: go to dashboard */}
          <Route index element={<Navigate to="dashboard" replace />} />
        </Route>

        {/* Marketplace — public, no auth required */}
        <Route path="/marketplace" element={<MarketplaceLanding />} />
        <Route path="/marketplace/hospitals" element={<HospitalDirectory />} />
        <Route path="/marketplace/hospitals/:id" element={<HospitalProfile />} />
        <Route path="/marketplace/doctors" element={<DoctorDirectory />} />
        <Route path="/marketplace/doctors/:id" element={<DoctorProfile />} />
        <Route path="/doctor/register" element={<DoctorRegister />} />
        <Route path="/doctor/login" element={<DoctorLogin />} />

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
        </Suspense>
        </StaffSessionBootstrap>
      </AdminSessionBootstrap>
    </>
  );
}

export default App;
