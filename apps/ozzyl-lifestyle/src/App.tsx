import type { ComponentType } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { PWAUpdatePrompt } from './components/PWAUpdatePrompt';
import { AppIconSync } from './components/AppIconSync';
import { getStoredPwaLaunchPath } from './lib/pwaLaunch';
import { useAnalytics } from './hooks/useAnalytics';
import { Toaster } from 'react-hot-toast';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useAuth } from './hooks/useAuth';
import { useTranslation } from 'react-i18next';
import ImpersonationBanner from './components/ImpersonationBanner';
import DashboardLayout from './components/DashboardLayout';
import Login from './pages/Login';
import AdminLogin from './pages/AdminLogin';
import HospitalSignup from './pages/HospitalSignup';
import AcceptInvite from './pages/AcceptInvite';
import InviteStaff from './pages/InviteStaff';
import PatientList from './pages/PatientList';
import PatientForm from './pages/PatientForm';
import LaboratoryDashboard from './pages/LaboratoryDashboard';
import ReceptionDashboard from './pages/ReceptionDashboard';
import MDDashboard from './pages/MDDashboard';
import DirectorDashboard from './pages/DirectorDashboard';
import SettingsPage from './pages/SettingsPage';
import AccessControlPage from './pages/AccessControlPage';
import WebsiteSettings from './pages/WebsiteSettings';
import HospitalAdminDashboard from './pages/HospitalAdminDashboard';
import HospitalSetupWizard from './pages/HospitalSetupWizard';
import AccountingDashboard from './pages/accounting/AccountingDashboard';
import IncomeList from './pages/accounting/IncomeList';
import ExpenseList from './pages/accounting/ExpenseList';
import Reports from './pages/accounting/Reports';
import AuditLogs from './pages/accounting/AuditLogs';
import RecurringExpenses from './pages/accounting/RecurringExpenses';
import ChartOfAccounts from './pages/accounting/ChartOfAccounts';
import PharmacyDashboard from './pages/PharmacyDashboard';
import PharmacyOverview from './pages/pharmacy/PharmacyOverview';
import PharmItemList from './pages/pharmacy/ItemList';
import PharmCategoryList from './pages/pharmacy/CategoryList';
import PharmGenericList from './pages/pharmacy/GenericList';
import PharmSupplierList from './pages/pharmacy/SupplierList';
import PharmPurchaseOrderList from './pages/pharmacy/PurchaseOrderList';
import PharmPurchaseOrderForm from './pages/pharmacy/PurchaseOrderForm';
import PharmGoodsReceiptList from './pages/pharmacy/GoodsReceiptList';
import PharmGoodsReceiptForm from './pages/pharmacy/GoodsReceiptForm';
import PharmStockList from './pages/pharmacy/StockList';
import PharmInvoiceList from './pages/pharmacy/InvoiceList';
import PharmInvoiceForm from './pages/pharmacy/InvoiceForm';
import PharmDepositList from './pages/pharmacy/DepositList';
import PharmSettlementList from './pages/pharmacy/SettlementList';
import PharmPrescriptionList from './pages/pharmacy/PrescriptionList';
import PharmNarcoticRegister from './pages/pharmacy/NarcoticRegister';
import PharmWriteOffList from './pages/pharmacy/WriteOffList';
import PharmDispatchList from './pages/pharmacy/DispatchList';
import PatientBillingPage from './pages/pharmacy/PatientBillingPage';
import InvoiceReceipt from './pages/pharmacy/InvoiceReceipt';
import StockReport from './pages/pharmacy/StockReport';
import SalesReport from './pages/pharmacy/SalesReport';
import ExpiryReport from './pages/pharmacy/ExpiryReport';
import SupplierLedger from './pages/pharmacy/SupplierLedger';
import DispensaryStock from './pages/pharmacy/DispensaryStock';
import TaxConfigPage from './pages/pharmacy/TaxConfigPage';
import DosageTemplatesPage from './pages/pharmacy/DosageTemplatesPage';
import ApprovalQueuePage from './pages/pharmacy/ApprovalQueuePage';
import ItemPriceHistory from './pages/pharmacy/ItemPriceHistory';
import BillingDashboard from './pages/BillingDashboard';
import ShareholderManagement from './pages/accounting/ShareholderManagement';
import JournalEntries from './pages/accounting/JournalEntries';
import ConsultationNotes from './pages/ConsultationNotes';
import CommissionManagement from './pages/CommissionManagement';
import IPDCharges from './pages/IPDCharges';
import TestCatalog from './pages/TestCatalog';
import ProfitLoss from './pages/accounting/ProfitLoss';
import AIAssistant from './pages/AIAssistant';
import StaffPage from './pages/StaffPage';
import HRDashboard from './pages/HRDashboard';
import PatientDetail from './pages/PatientDetail';
import PatientChartWorkspace from './pages/PatientChartWorkspace';
import PatientChartPrint from './pages/PatientChartPrint';
import ReportsDashboard from './pages/ReportsDashboard';
import BillPrint from './pages/BillPrint';
import AppointmentScheduler from './pages/AppointmentScheduler';
import DigitalPrescription from './pages/DigitalPrescription';
import DoctorDashboard from './pages/DoctorDashboard';
import LabTestOrderForm from './pages/LabTestOrderForm';
import MedicineDispensing from './pages/MedicineDispensing';
import AdmissionIPD from './pages/AdmissionIPD';
import BedManagement from './pages/BedManagement';
import NotificationsCenter from './pages/NotificationsCenter';
import NurseStation from './pages/NurseStation';
import DischargeSummary from './pages/DischargeSummary';
import PrescriptionPrint from './pages/PrescriptionPrint';
import DoctorSchedule from './pages/DoctorSchedule';
import SystemAuditLog from './pages/SystemAuditLog';
import LabReportPrint from './pages/LabReportPrint';
import PatientTimeline from './pages/PatientTimeline';
import InsuranceClaims from './pages/InsuranceClaims';
import InsuranceBillingPage from './pages/InsuranceBillingPage';
import MultiBranchDashboard from './pages/MultiBranchDashboard';
import PatientPortal from './pages/PatientPortal';
import TelemedicineDashboard from './pages/TelemedicineDashboard';
import TelemedicineRoom from './pages/TelemedicineRoom';
import TriageChatbot from './pages/TriageChatbot';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import SuperAdminHospitalList from './pages/SuperAdminHospitalList';
import SuperAdminHospitalDetail from './pages/SuperAdminHospitalDetail';
import SuperAdminOnboardingQueue from './pages/SuperAdminOnboardingQueue';
import SuperAdminSettings from './pages/SuperAdminSettings';
import SuperAdminAuditLog from './pages/SuperAdminAuditLog';
import SuperAdminHealth from './pages/SuperAdminHealth';
import EmergencyDashboard from './pages/EmergencyDashboard';
import OTDashboard from './pages/OTDashboard';
import DepositsPage from './pages/DepositsPage';
import CreditNotesPage from './pages/CreditNotesPage';
import SettlementsPage from './pages/SettlementsPage';
import BillingHandoverPage from './pages/BillingHandoverPage';
import BillCancellationPage from './pages/BillCancellationPage';
import VitalsPage from './pages/VitalsPage';
import AllergiesPage from './pages/AllergiesPage';
import ClinicalAssessments from './pages/ClinicalAssessments';
import InventoryDashboard from './pages/inventory/InventoryDashboard';
import StockList from './pages/inventory/StockList';
import PurchaseOrderList from './pages/inventory/PurchaseOrderList';
import PurchaseOrderForm from './pages/inventory/PurchaseOrderForm';
import GoodsReceiptList from './pages/inventory/GoodsReceiptList';
import GoodsReceiptForm from './pages/inventory/GoodsReceiptForm';
import RequisitionList from './pages/inventory/RequisitionList';
import RequisitionForm from './pages/inventory/RequisitionForm';
import DispatchList from './pages/inventory/DispatchList';
import DispatchForm from './pages/inventory/DispatchForm';
import StockAdjustment from './pages/inventory/StockAdjustment';
import InventoryLedger from './pages/inventory/InventoryLedger';
import BillingMasterPage from './pages/BillingMasterPage';
import ProvisionalBillingPage from './pages/ProvisionalBillingPage';
import LabSettingsPage from './pages/LabSettingsPage';
import ReportLabPage from './pages/ReportLabPage';
import ReportPharmacyPage from './pages/ReportPharmacyPage';
import ReportAppointmentPage from './pages/ReportAppointmentPage';
import IPBillingPage from './pages/IPBillingPage';
import PaymentsPage from './pages/PaymentsPage';
import InboxPage from './pages/InboxPage';
import NursingDashboard from './pages/NursingDashboard';
import EPrescribingDashboard from './pages/EPrescribingDashboard';
import MedicalRecordsDashboard from './pages/MedicalRecordsDashboard';
import RadiologyDashboard from './pages/RadiologyDashboard';
import VaccinationDashboard from './pages/VaccinationDashboard';
import HealthRecordSharing from './pages/HealthRecordSharing';
import ImportExternalRecords from './pages/ImportExternalRecords';
import Dental from './pages/Dental';
import Psychiatry from './pages/Psychiatry';
import EyeExamDashboard from './pages/EyeExamDashboard';
import PhysicalExamDashboard from './pages/PhysicalExamDashboard';
import DictationPage from './pages/DictationPage';
import CustomFormBuilder from './pages/CustomFormBuilder';
import CarePlansDashboard from './pages/CarePlansDashboard';
import TrackAnythingDashboard from './pages/TrackAnythingDashboard';
import PriorAuthDashboard from './pages/PriorAuthDashboard';
import ProcedureOrdersDashboard from './pages/ProcedureOrdersDashboard';
import QuestionnairesPage from './pages/QuestionnairesPage';
import MarketingReferral from './pages/MarketingReferral';
import GroupAttendance from './pages/GroupAttendance';
import FeeSheet from './pages/FeeSheet';
import Camos from './pages/Camos';
import HelpCenterPage from './pages/HelpCenterPage';
import DutyRoster from './pages/DutyRoster';
import AttendancePunch from './pages/AttendancePunch';
import QueueDisplay from './pages/QueueDisplay';
import QueueManagement from './pages/QueueManagement';
import AssetManagement from './pages/AssetManagement';
import KitchenManagement from './pages/KitchenManagement';
import BloodBankManagement from './pages/BloodBankManagement';
import MlcManagement from './pages/MlcManagement';
import CssdManagement from './pages/CssdManagement';
import LaundryManagement from './pages/LaundryManagement';
import HousekeepingManagement from './pages/HousekeepingManagement';
import AmbulanceManagement from './pages/AmbulanceManagement';
import MortuaryManagement from './pages/MortuaryManagement';
import PatientDuplicates from './pages/PatientDuplicates';
import WhatsAppDashboard from './pages/WhatsAppDashboard';
import PrintTemplateSettings from './pages/PrintTemplateSettings';
import DischargePlanningPage from './pages/DischargePlanningPage';
import BiomedicalWasteManagement from './pages/BiomedicalWasteManagement';
import PatientLoginPage from './pages/PatientLoginPage';
import PatientCardClaimPage from './pages/PatientCardClaimPage';
import PatientDashboardPage from './pages/PatientDashboardPage';
import PatientOnboardingPage from './pages/PatientOnboardingPage';
import MarketplaceLanding from './pages/MarketplaceLanding';
import HospitalDirectory from './pages/marketplace/HospitalDirectory';
import HospitalProfile from './pages/marketplace/HospitalProfile';
import DoctorDirectory from './pages/marketplace/DoctorDirectory';
import DoctorProfile from './pages/marketplace/DoctorProfile';
import ReviewModerationPage from './pages/marketplace/ReviewModerationPage';
import MarketplaceBookingQueue from './pages/marketplace/MarketplaceBookingQueue';
import DoctorRegister from './pages/DoctorRegister';
import DoctorLogin from './pages/DoctorLogin';

function Unauthorized() {
  const { t } = useTranslation('common');
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>{t('accessDenied')}</h1>
      <p>{t('noPermission')}</p>
      <a href="javascript:history.back()">{t('goBack')}</a>
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

function App() {
  // Track SPA page views in Google Analytics 4
  useAnalytics();
  const launchPath = getStoredPwaLaunchPath(localStorage);

  return (
    <>
      <Toaster position="top-right" />
      <AppIconSync />
      <PWAUpdatePrompt />
      <ImpersonationBanner />
      <Routes>
        {/* ─── Public: Landing / Marketing ─────────────────────────── */}
        <Route path="/" element={<Navigate to="/patient/login" replace />} />
        <Route path="/login" element={<Navigate to="/patient/login" replace />} />
        <Route path="/patient" element={<Navigate to="/patient/login" replace />} />
        <Route path="/patient/login" element={<PatientLoginPage />} />
        <Route path="/patient/claim-card" element={<PatientCardClaimPage />} />
        <Route path="/patient/onboarding" element={<PatientOnboardingPage />} />
        <Route path="/patient/dashboard" element={<PatientDashboardPage />} />
        <Route path="/patient/home" element={<PatientDashboardPage />} />
        <Route path="/patient/care" element={<PatientDashboardPage />} />
        <Route path="/patient/records" element={<PatientDashboardPage />} />
        <Route path="/patient/wellness" element={<PatientDashboardPage />} />
        <Route path="/patient/family" element={<PatientDashboardPage />} />
        <Route path="/patient/privacy" element={<PatientDashboardPage />} />
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

        {/* ─── Hospital slug-based routes: /h/:slug/* ───────────────── */}
        {/* All hospital access goes through /h/:slug so we can extract  */}
        {/* the tenant slug from the URL and inject it as X-Tenant-Subdomain */}
        <Route path="/h/:slug">
          {/* Public within slug context */}
          <Route path="login" element={<Login />} />
          <Route path="accept-invite" element={<AcceptInvite />} />
          <Route path="queue-display" element={<QueueDisplay />} />

          {/* ─── Permission-gated admin tools ───────────────────────── */}
          <Route element={<ProtectedRoute requiredPermission="roles:manage" />}>
            <Route path="access-control" element={<RoleAwareRoute component={AccessControlPage} />} />
          </Route>

          {/* ─── Hospital Admin ─────────────────────────────────────── */}
          <Route element={<ProtectedRoute allowedRoles={['hospital_admin']} />}>
            <Route path="dashboard" element={<HospitalAdminDashboard role="hospital_admin" />} />
            <Route path="patients" element={<PatientList role="hospital_admin" />} />
            <Route path="patients/new" element={<PatientForm role="hospital_admin" />} />
            <Route path="patients/:id" element={<PatientDetail role="hospital_admin" />} />
            <Route path="tests" element={<LaboratoryDashboard role="hospital_admin" />} />
            <Route path="billing" element={<BillingDashboard role="hospital_admin" />} />
            <Route path="billing/:billId/print" element={<BillPrint role="hospital_admin" />} />
            {/* ─── Pharmacy (full module) ──────────────────────────── */}
            <Route path="pharmacy" element={<PharmacyOverview role="hospital_admin" />} />
            <Route path="pharmacy/items" element={<PharmItemList role="hospital_admin" />} />
            <Route path="pharmacy/categories" element={<PharmCategoryList role="hospital_admin" />} />
            <Route path="pharmacy/generics" element={<PharmGenericList role="hospital_admin" />} />
            <Route path="pharmacy/suppliers" element={<PharmSupplierList role="hospital_admin" />} />
            <Route path="pharmacy/stock" element={<PharmStockList role="hospital_admin" />} />
            <Route path="pharmacy/po" element={<PharmPurchaseOrderList role="hospital_admin" />} />
            <Route path="pharmacy/po/new" element={<PharmPurchaseOrderForm role="hospital_admin" />} />
            <Route path="pharmacy/grn" element={<PharmGoodsReceiptList role="hospital_admin" />} />
            <Route path="pharmacy/grn/new" element={<PharmGoodsReceiptForm role="hospital_admin" />} />
            <Route path="pharmacy/invoices" element={<PharmInvoiceList role="hospital_admin" />} />
            <Route path="pharmacy/invoices/new" element={<PharmInvoiceForm role="hospital_admin" />} />
            <Route path="pharmacy/deposits" element={<PharmDepositList role="hospital_admin" />} />
            <Route path="pharmacy/settlements" element={<PharmSettlementList role="hospital_admin" />} />
            <Route path="pharmacy/prescriptions" element={<PharmPrescriptionList role="hospital_admin" />} />
            <Route path="pharmacy/narcotics" element={<PharmNarcoticRegister role="hospital_admin" />} />
            <Route path="pharmacy/write-offs" element={<PharmWriteOffList role="hospital_admin" />} />
            <Route path="pharmacy/dispatches" element={<PharmDispatchList role="hospital_admin" />} />
            <Route path="pharmacy/patient-billing" element={<PatientBillingPage role="hospital_admin" />} />
            <Route path="pharmacy/invoices/:id/receipt" element={<InvoiceReceipt role="hospital_admin" />} />
            <Route path="pharmacy/reports/stock" element={<StockReport role="hospital_admin" />} />
            <Route path="pharmacy/reports/sales" element={<SalesReport role="hospital_admin" />} />
            <Route path="pharmacy/reports/expiry" element={<ExpiryReport role="hospital_admin" />} />
            <Route path="pharmacy/supplier-ledger" element={<SupplierLedger role="hospital_admin" />} />
            <Route path="pharmacy/dispensary-stock" element={<DispensaryStock role="hospital_admin" />} />
            <Route path="pharmacy/tax-config" element={<TaxConfigPage role="hospital_admin" />} />
            <Route path="pharmacy/dosage-templates" element={<DosageTemplatesPage role="hospital_admin" />} />
            <Route path="pharmacy/approval-queue" element={<ApprovalQueuePage role="hospital_admin" />} />
            <Route path="pharmacy/price-history" element={<ItemPriceHistory role="hospital_admin" />} />
            <Route path="accounting" element={<AccountingDashboard role="hospital_admin" />} />
            <Route path="income" element={<IncomeList role="hospital_admin" />} />
            <Route path="expenses" element={<ExpenseList role="hospital_admin" />} />
            <Route path="recurring" element={<RecurringExpenses role="hospital_admin" />} />
            <Route path="accounts" element={<ChartOfAccounts role="hospital_admin" />} />
            <Route path="staff" element={<StaffPage role="hospital_admin" />} />
            <Route path="hr" element={<HRDashboard role="hospital_admin" />} />
            <Route path="duty-roster" element={<DutyRoster role="hospital_admin" />} />
            <Route path="attendance-punch" element={<AttendancePunch role="hospital_admin" />} />
            <Route path="shareholders" element={<ShareholderManagement role="hospital_admin" />} />
            <Route path="journal" element={<JournalEntries role="hospital_admin" />} />
            <Route path="consultation-notes" element={<ConsultationNotes role="hospital_admin" />} />
            <Route path="commissions" element={<CommissionManagement role="hospital_admin" />} />
            <Route path="ipd-charges" element={<IPDCharges role="hospital_admin" />} />
            <Route path="test-catalog" element={<TestCatalog role="hospital_admin" />} />
            <Route path="profit-loss" element={<ProfitLoss role="hospital_admin" />} />
            <Route path="ai-assistant" element={<AIAssistant role="hospital_admin" />} />
            <Route path="reports" element={<ReportsDashboard role="hospital_admin" />} />
            <Route path="audit" element={<AuditLogs role="hospital_admin" />} />
            <Route path="settings" element={<SettingsPage role="hospital_admin" />} />
            <Route path="website" element={<WebsiteSettings role="hospital_admin" />} />
            <Route path="invitations" element={<InviteStaff />} />
            <Route path="appointments" element={<AppointmentScheduler role="hospital_admin" />} />
            <Route path="queue-management" element={<QueueManagement role="hospital_admin" />} />
            <Route path="prescriptions/new" element={<DigitalPrescription />} />
            <Route path="prescriptions/:rxId" element={<DigitalPrescription />} />
            <Route path="lab/order/new" element={<LabTestOrderForm />} />
            <Route path="pharmacy/dispensing" element={<MedicineDispensing />} />
            <Route path="admissions" element={<AdmissionIPD role="hospital_admin" />} />
            <Route path="beds" element={<BedManagement role="hospital_admin" />} />
            <Route path="notifications" element={<NotificationsCenter role="hospital_admin" />} />
            <Route path="e-prescribing" element={<EPrescribingDashboard role="hospital_admin" />} />
            <Route path="medical-records" element={<MedicalRecordsDashboard role="hospital_admin" />} />
            <Route path="admissions/:admissionId/discharge" element={<DischargeSummary role="hospital_admin" />} />
            <Route path="prescriptions/:prescriptionId/print" element={<PrescriptionPrint role="hospital_admin" />} />
            <Route path="system-audit" element={<SystemAuditLog role="hospital_admin" />} />
            <Route path="lab/:labId/report" element={<LabReportPrint role="hospital_admin" />} />
            <Route path="insurance-claims" element={<InsuranceClaims role="hospital_admin" />} />
            <Route path="insurance-billing" element={<InsuranceBillingPage role="hospital_admin" />} />
            <Route path="multi-branch" element={<MultiBranchDashboard role="hospital_admin" />} />
            <Route path="patient-portal" element={<PatientPortal />} />
            <Route path="triage" element={<TriageChatbot />} />
            <Route path="emergency" element={<EmergencyDashboard role="hospital_admin" />} />
            <Route path="ot" element={<OTDashboard role="hospital_admin" />} />
            <Route path="deposits" element={<DepositsPage role="hospital_admin" />} />
            <Route path="credit-notes" element={<CreditNotesPage role="hospital_admin" />} />
            <Route path="settlements" element={<SettlementsPage role="hospital_admin" />} />
            <Route path="billing-handover" element={<BillingHandoverPage role="hospital_admin" />} />
            <Route path="billing-cancellation" element={<BillCancellationPage role="hospital_admin" />} />
            <Route path="ip-billing" element={<IPBillingPage role="hospital_admin" />} />
            <Route path="payments" element={<PaymentsPage role="hospital_admin" />} />
            <Route path="inbox" element={<InboxPage role="hospital_admin" />} />
            <Route path="vitals" element={<VitalsPage role="hospital_admin" />} />
            <Route path="allergies" element={<AllergiesPage role="hospital_admin" />} />
            <Route path="clinical" element={<ClinicalAssessments role="hospital_admin" />} />
            <Route path="radiology" element={<RadiologyDashboard />} />
            <Route path="vaccination" element={<VaccinationDashboard />} />
            <Route path="health-records" element={<HealthRecordSharing role="hospital_admin" />} />
            <Route path="import-records" element={<ImportExternalRecords role="hospital_admin" />} />
            <Route path="dental" element={<Dental role="hospital_admin" />} />
            <Route path="psychiatry" element={<Psychiatry role="hospital_admin" />} />
            <Route path="marketing-referral" element={<MarketingReferral role="hospital_admin" />} />
            <Route path="group-attendance" element={<GroupAttendance role="hospital_admin" />} />
            <Route path="fee-sheet" element={<FeeSheet role="hospital_admin" />} />
            <Route path="camos" element={<Camos role="hospital_admin" />} />
            {/* ─── Inventory ─────────────────────────────── */}
            <Route path="inventory" element={<InventoryDashboard role="hospital_admin" />} />
            <Route path="inventory/stock" element={<StockList role="hospital_admin" />} />
            <Route path="inventory/stock/adjust" element={<StockAdjustment role="hospital_admin" />} />
            <Route path="inventory/po" element={<PurchaseOrderList role="hospital_admin" />} />
            <Route path="inventory/po/new" element={<PurchaseOrderForm role="hospital_admin" />} />
            <Route path="inventory/gr" element={<GoodsReceiptList role="hospital_admin" />} />
            <Route path="inventory/gr/new" element={<GoodsReceiptForm role="hospital_admin" />} />
            <Route path="inventory/requisitions" element={<RequisitionList role="hospital_admin" />} />
            <Route path="inventory/requisitions/new" element={<RequisitionForm role="hospital_admin" />} />
            <Route path="inventory/dispatches" element={<DispatchList role="hospital_admin" />} />
            <Route path="inventory/dispatches/new" element={<DispatchForm role="hospital_admin" />} />
            <Route path="inventory/ledger" element={<InventoryLedger role="hospital_admin" />} />
            <Route path="asset-management" element={<AssetManagement role="hospital_admin" />} />
            <Route path="kitchen" element={<KitchenManagement role="hospital_admin" />} />
            <Route path="blood-bank" element={<BloodBankManagement role="hospital_admin" />} />
            <Route path="mlc" element={<MlcManagement role="hospital_admin" />} />
            <Route path="cssd" element={<CssdManagement role="hospital_admin" />} />
            <Route path="laundry" element={<LaundryManagement role="hospital_admin" />} />
            <Route path="housekeeping" element={<HousekeepingManagement role="hospital_admin" />} />
            <Route path="ambulance" element={<AmbulanceManagement role="hospital_admin" />} />
            <Route path="mortuary" element={<MortuaryManagement role="hospital_admin" />} />
            <Route path="patient-duplicates" element={<PatientDuplicates role="hospital_admin" />} />
            <Route path="whatsapp" element={<WhatsAppDashboard role="hospital_admin" />} />
            <Route path="print-templates" element={<PrintTemplateSettings role="hospital_admin" />} />
            <Route path="discharge-planning" element={<DischargePlanningPage role="hospital_admin" />} />
            <Route path="biomedical-waste" element={<BiomedicalWasteManagement role="hospital_admin" />} />
            {/* ─── Billing Master & Provisional ─────────────────── */}
            <Route path="billing-master" element={<BillingMasterPage role="hospital_admin" />} />
            <Route path="billing-provisional" element={<ProvisionalBillingPage role="hospital_admin" />} />
            {/* ─── Lab Settings ─────────────────────────────────── */}
            <Route path="lab-settings" element={<LabSettingsPage role="hospital_admin" />} />
            {/* ─── Reports ──────────────────────────────────────── */}
            <Route path="reports/lab" element={<ReportLabPage role="hospital_admin" />} />
            <Route path="reports/pharmacy" element={<ReportPharmacyPage role="hospital_admin" />} />
            <Route path="reports/appointments" element={<ReportAppointmentPage role="hospital_admin" />} />
            {/* ─── Help Center ─────────────────────────────────────── */}
            <Route path="help" element={<HelpCenterPage />} />
            <Route path="review-moderation" element={<ReviewModerationPage role="hospital_admin" />} />
            <Route path="marketplace-bookings" element={<MarketplaceBookingQueue role="hospital_admin" />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['hospital_admin', 'md']} />}>
            <Route path="telemedicine" element={<TelemedicineDashboardRoute />} />
            <Route path="telemedicine/room/:roomId" element={<TelemedicineRoomRoute />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['hospital_admin', 'doctor', 'md', 'nurse', 'reception']} />}>
            <Route path="patients/:id/timeline" element={<RoleAwareRoute component={PatientTimeline} />} />
            <Route path="patients/:id/chart" element={<RoleAwareRoute component={PatientChartWorkspace} />} />
            <Route path="patients/:id/chart/print" element={<RoleAwareRoute component={PatientChartPrint} />} />
            <Route path="import-records" element={<RoleAwareRoute component={ImportExternalRecords} />} />
            <Route path="dental" element={<RoleAwareRoute component={Dental} />} />
            <Route path="psychiatry" element={<RoleAwareRoute component={Psychiatry} />} />
            <Route path="eye-exam" element={<RoleAwareRoute component={EyeExamDashboard} />} />
            <Route path="physical-exam" element={<RoleAwareRoute component={PhysicalExamDashboard} />} />
            <Route path="dictation" element={<RoleAwareRoute component={DictationPage} />} />
            <Route path="care-plans" element={<RoleAwareRoute component={CarePlansDashboard} />} />
            <Route path="track-anything" element={<RoleAwareRoute component={TrackAnythingDashboard} />} />
            <Route path="prior-auth" element={<RoleAwareRoute component={PriorAuthDashboard} />} />
            <Route path="procedure-orders" element={<RoleAwareRoute component={ProcedureOrdersDashboard} />} />
            <Route path="questionnaires" element={<RoleAwareRoute component={QuestionnairesPage} />} />
            <Route path="form-builder" element={<RoleAwareRoute component={CustomFormBuilder} />} />
            <Route path="group-attendance" element={<RoleAwareRoute component={GroupAttendance} />} />
            <Route path="fee-sheet" element={<RoleAwareRoute component={FeeSheet} />} />
            <Route path="camos" element={<RoleAwareRoute component={Camos} />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['doctor', 'md', 'hospital_admin']} />}>
            <Route path="doctor/dashboard" element={<DoctorDashboard />} />
            <Route path="doctor/prescriptions" element={<DigitalPrescription />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['nurse', 'md', 'hospital_admin']} />}>
            <Route path="nurse-station" element={<NurseStationRoute />} />
            <Route path="nursing" element={<NursingDashboardRoute />} />
            <Route path="doctor-schedule" element={<DoctorScheduleRoute />} />
            <Route path="vitals" element={<VitalsRoute />} />
          </Route>

          {/* ─── Laboratory ──────────────────────────────────────────── */}
          <Route element={<ProtectedRoute allowedRoles={['laboratory', 'hospital_admin']} />}>
            <Route path="lab/dashboard" element={<LaboratoryDashboard />} />
            <Route path="lab/tests" element={<LaboratoryDashboard />} />
          </Route>

          {/* ─── Reception ───────────────────────────────────────────── */}
          <Route element={<ProtectedRoute allowedRoles={['reception', 'hospital_admin']} />}>
            <Route path="reception/dashboard" element={<RoleAwareRoute component={ReceptionDashboard} />} />
            <Route path="reception/patients" element={<RoleAwareRoute component={PatientList} />} />
            <Route path="reception/patients/new" element={<RoleAwareRoute component={PatientForm} />} />
            <Route path="reception/patients/:id" element={<RoleAwareRoute component={PatientDetail} />} />
            <Route path="reception/billing" element={<RoleAwareRoute component={ReceptionDashboard} />} />
            <Route path="reception/billing/:billId/print" element={<RoleAwareRoute component={BillPrint} />} />
            <Route path="reception/appointments" element={<RoleAwareRoute component={AppointmentScheduler} />} />
            <Route path="reception/queue" element={<RoleAwareRoute component={QueueManagement} />} />
            <Route path="reception/prescriptions/new" element={<DigitalPrescription />} />
            <Route path="reception/prescriptions/:rxId" element={<DigitalPrescription />} />
            <Route path="reception/help" element={<HelpCenterPage />} />
          </Route>

          {/* ─── Managing Director ───────────────────────────────────── */}
          <Route element={<ProtectedRoute allowedRoles={['md', 'hospital_admin']} />}>
            <Route path="md/dashboard" element={<RoleAwareRoute component={MDDashboard} />} />
            <Route path="md/staff" element={<RoleAwareRoute component={StaffPage} />} />
            <Route path="md/hr" element={<RoleAwareRoute component={HRDashboard} />} />
            <Route path="md/duty-roster" element={<RoleAwareRoute component={DutyRoster} />} />
            <Route path="md/attendance-punch" element={<RoleAwareRoute component={AttendancePunch} />} />
            <Route path="md/accounting" element={<RoleAwareRoute component={AccountingDashboard} />} />
            <Route path="md/income" element={<RoleAwareRoute component={IncomeList} />} />
            <Route path="md/expenses" element={<RoleAwareRoute component={ExpenseList} />} />
            <Route path="md/recurring" element={<RoleAwareRoute component={RecurringExpenses} />} />
            <Route path="md/accounts" element={<RoleAwareRoute component={ChartOfAccounts} />} />
            <Route path="md/reports" element={<RoleAwareRoute component={Reports} />} />
            <Route path="md/audit" element={<RoleAwareRoute component={AuditLogs} />} />
            <Route path="md/staff" element={<RoleAwareRoute component={StaffPage} />} />
            <Route path="md/hr" element={<RoleAwareRoute component={HRDashboard} />} />
            <Route path="md/help" element={<HelpCenterPage />} />
          </Route>

          {/* ─── Director ────────────────────────────────────────────── */}
          <Route element={<ProtectedRoute allowedRoles={['director', 'hospital_admin']} />}>
            <Route path="director/dashboard" element={<RoleAwareRoute component={DirectorDashboard} />} />
            <Route path="director/accounting" element={<RoleAwareRoute component={AccountingDashboard} />} />
            <Route path="director/income" element={<RoleAwareRoute component={IncomeList} />} />
            <Route path="director/expenses" element={<RoleAwareRoute component={ExpenseList} />} />
            <Route path="director/recurring" element={<RoleAwareRoute component={RecurringExpenses} />} />
            <Route path="director/accounts" element={<RoleAwareRoute component={ChartOfAccounts} />} />
            <Route path="director/reports" element={<RoleAwareRoute component={Reports} />} />
            <Route path="director/audit" element={<RoleAwareRoute component={AuditLogs} />} />
            <Route path="director/shareholders" element={<RoleAwareRoute component={DirectorDashboard} />} />
            <Route path="director/profit" element={<RoleAwareRoute component={DirectorDashboard} />} />
            <Route path="director/settings" element={<RoleAwareRoute component={SettingsPage} />} />
            <Route path="director/help" element={<HelpCenterPage />} />
          </Route>

          {/* ─── Pharmacist ──────────────────────────────────────────── */}
          <Route element={<ProtectedRoute allowedRoles={['pharmacist', 'hospital_admin']} />}>
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
            <Route path="pharmacy/help" element={<HelpCenterPage />} />
          </Route>

          <Route element={<ProtectedRoute allowedRoles={['accountant', 'hospital_admin', 'director', 'md']} />}>
            <Route path="accountant/dashboard" element={<RoleAwareRoute component={AccountingDashboard} />} />
            <Route path="accountant/accounting" element={<RoleAwareRoute component={AccountingDashboard} />} />
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
    </>
  );
}

export default App;
