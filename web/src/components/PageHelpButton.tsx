import { useState, useMemo, useEffect } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  Info,
  X,
  Lightbulb,
  CheckCircle2,
  ChevronRight,
  BookOpen,
  Sparkles,
} from 'lucide-react';

function resolveHelpKey(pathname: string): string {
  const path = pathname.replace(/\/$/, '');

  // Super admin routes
  if (path.startsWith('/super-admin/')) {
    const sub = path.replace('/super-admin/', '');
    if (sub === 'dashboard') return 'superAdminDashboard';
    if (sub === 'hospitals') return 'superAdminHospitals';
    if (sub === 'hospitals/') return 'superAdminHospitals';
    if (sub.includes('hospital/')) return 'superAdminHospitalDetail';
    if (sub === 'onboarding') return 'superAdminOnboarding';
    if (sub === 'audit-log') return 'superAdminAudit';
    if (sub === 'health') return 'superAdminHealth';
    if (sub === 'settings') return 'superAdminSettings';
    return 'superAdminDashboard';
  }

  // Extract route after /h/:slug/ or direct routes
  const slugMatch = path.match(/^\/h\/[^/]+\/(.*)$/);
  const subPath = slugMatch ? slugMatch[1] : path.replace(/^\//, '');

  const exactMap: Record<string, string> = {
    // Core
    'dashboard': 'dashboard',
    'patients': 'patients',
    'patients/new': 'patients',
    'patient-list': 'patients',
    'patient-form': 'patients',
    'patient-duplicates': 'patients',
    'patient-portal': 'patientPortal',
    'patient-snapshot': 'patientDetail',
    'patient-timeline': 'patientDetail',
    'patient-chart': 'patientDetail',
    'patient-chart-workspace': 'patientDetail',
    'patient-chart-print': 'patientDetail',
    'appointments': 'appointments',
    'appointment-scheduler': 'appointments',
    'queue-management': 'queueManagement',
    'queue-display': 'queueManagement',

    // Billing
    'billing': 'billing',
    'billing-master': 'billingMaster',
    'billing-provisional': 'billingProvisional',
    'billing-counter': 'billing_counter',
    'reception/billing-counter': 'billing_counter',
    'billing-handover': 'billingHandover',
    'billing-cancellation': 'billCancellation',
    'bill-print': 'billPrint',
    'ip-billing': 'ipBilling',
    'payments': 'payments',
    'deposits': 'deposits',
    'credit-notes': 'creditNotes',
    'settlements': 'settlements',
    'fee-sheet': 'feeSheet',
    'insurance-billing': 'insuranceBilling',
    'insurance-claims': 'insuranceClaims',
    'prior-auth': 'priorAuth',
    'provisional-billing': 'billingProvisional',

    // Pharmacy
    'pharmacy': 'pharmacy',
    'pharmacy/dashboard': 'pharmacyDashboard',
    'pharmacy/overview': 'pharmacyDashboard',
    'pharmacy/items': 'pharmacyItems',
    'pharmacy/stock': 'pharmacyStock',
    'pharmacy/dispensary-stock': 'pharmacyStock',
    'pharmacy/po': 'pharmacyPO',
    'pharmacy/purchase-orders': 'pharmacyPO',
    'pharmacy/grn': 'pharmacyGRN',
    'pharmacy/goods-receipt': 'pharmacyGRN',
    'pharmacy/invoices': 'pharmacyInvoices',
    'pharmacy/prescriptions': 'pharmacyPrescriptions',
    'pharmacy/prescription-list': 'pharmacyPrescriptions',
    'pharmacy/narcotics': 'pharmacyNarcotics',
    'pharmacy/narcotic-register': 'pharmacyNarcotics',
    'pharmacy/approval-queue': 'pharmacyApproval',
    'pharmacy/expiry-report': 'pharmacyStock',
    'pharmacy/sales-report': 'pharmacyReports',
    'pharmacy/stock-report': 'pharmacyReports',
    'pharmacy/suppliers': 'pharmacySuppliers',
    'pharmacy/supplier-ledger': 'pharmacySuppliers',
    'pharmacy/category': 'pharmacyItems',
    'pharmacy/generic': 'pharmacyItems',
    'pharmacy/dosage-templates': 'pharmacyItems',
    'pharmacy/tax-config': 'pharmacyItems',
    'pharmacy/deposits': 'pharmacyDeposits',
    'pharmacy/write-off': 'pharmacyWriteOff',
    'pharmacy/patient-billing': 'pharmacyPatientBilling',
    'medicine-dispensing': 'pharmacy',
    'digital-prescription': 'ePrescribing',
    'prescription-print': 'prescriptionPrint',
    'dosage-templates': 'pharmacyItems',

    // Lab
    'tests': 'labDashboard',
    'lab/dashboard': 'labDashboard',
    'lab/tests': 'labDashboard',
    'lab/orders': 'labOrders',
    'lab/test-catalog': 'labTests',
    'lab/report-print': 'labReports',
    'lab/monitoring': 'labMonitoring',
    'lab-settings': 'labSettings',
    'lab-machines': 'labMachines',
    'lab-test-order': 'labOrders',
    'laboratory': 'labDashboard',

    // IPD
    'admissions': 'admissions',
    'admission-ipd': 'admissions',
    'beds': 'beds',
    'bed-management': 'beds',
    'nurse-station': 'nurseStation',
    'nursing': 'nursingDashboard',
    'nursing-dashboard': 'nursingDashboard',
    'vitals': 'vitals',
    'allergies': 'allergies',
    'discharge-planning': 'dischargePlanning',
    'discharge-summary': 'dischargeSummary',
    'ward-supply': 'wardSupply',
    'care-plans': 'carePlans',
    'clinical-assessments': 'clinicalAssessments',
    'clinical-reminders': 'clinicalReminders',
    'order-set-manager': 'orderSets',
    'procedure-orders': 'procedureOrders',
    'physical-exam': 'physicalExam',
    'eye-exam': 'eyeExam',

    // Emergency / OT
    'emergency': 'emergency',
    'emergency-dashboard': 'emergency',
    'ot': 'ot',
    'surgery': 'ot',
    'ot-dashboard': 'ot',
    'triage-chatbot': 'triageChatbot',
    'mortuary': 'mortuary',
    'mlc': 'mlc',

    // Clinical
    'e-prescribing': 'ePrescribing',
    'medical-records': 'medicalRecords',
    'consultation-notes': 'consultationNotes',
    'dictation': 'dictation',
    'radiology': 'radiology',
    'radiology-dashboard': 'radiology',
    'telemedicine': 'telemedicine',
    'telemedicine-dashboard': 'telemedicine',
    'telemedicine-room': 'telemedicineRoom',
    'dental': 'dental',
    'psychiatry': 'psychiatry',
    'maternity': 'maternity',
    'vaccination': 'vaccination',
    'document-manager': 'documentManager',
    'consent-management': 'consentManagement',
    'import-external-records': 'importRecords',
    'health-record-sharing': 'healthRecordSharing',
    'questionnaires': 'questionnaires',
    'patient-form-builder': 'customFormBuilder',
    'custom-form-builder': 'customFormBuilder',

    // Inventory
    'inventory': 'inventory',
    'inventory/dashboard': 'inventoryDashboard',
    'inventory/stock': 'inventoryStock',
    'inventory/stock-list': 'inventoryStock',
    'inventory/ledger': 'inventoryLedger',
    'inventory/po': 'inventoryPO',
    'inventory/purchase-orders': 'inventoryPO',
    'inventory/gr': 'inventoryGR',
    'inventory/goods-receipt': 'inventoryGR',
    'inventory/requisition': 'inventoryRequisition',
    'inventory/requisitions': 'inventoryRequisition',
    'inventory/dispatch': 'inventoryDispatch',
    'inventory/stock-adjustment': 'inventoryStockAdjustment',

    // Accounting
    'accounting': 'accounting',
    'accounting/dashboard': 'accountingDashboard',
    'income': 'accountingIncome',
    'expenses': 'accountingExpenses',
    'recurring': 'accountingRecurring',
    'accounts': 'accountingAccounts',
    'chart-of-accounts': 'accountingAccounts',
    'journal-entries': 'accountingJournal',
    'profit-loss': 'accountingReports',
    'accounting/reports': 'accountingReports',
    'accounting/audit-logs': 'accountingAudit',
    'accounting/shareholders': 'shareholders',
    'shareholders': 'shareholders',

    // Reports
    'reports': 'reports',
    'reports/lab': 'reportLab',
    'reports/pharmacy': 'reportPharmacy',
    'reports/appointments': 'reportAppointments',
    'reports-dashboard': 'reports',
    'predictive-analytics': 'predictiveAnalytics',
    'quality-kpi': 'qualityKpi',

    // Settings / Admin
    'settings': 'settings',
    'website': 'websiteSettings',
    'website-settings': 'websiteSettings',
    'print-templates': 'printTemplates',
    'permissions': 'permissions',
    'permission-management': 'permissions',

    // Staff / HR
    'staff': 'staff',
    'staff-page': 'staff',
    'hr': 'hr',
    'hr-dashboard': 'hr',
    'hr/leave': 'leaveManagement',
    'leave-management': 'leaveManagement',
    'duty-roster': 'dutyRoster',
    'attendance-punch': 'attendancePunch',
    'group-attendance': 'groupAttendance',
    'invite-staff': 'inviteStaff',

    // Role dashboards
    'doctor/dashboard': 'doctorDashboard',
    'doctor/prescriptions': 'doctorDashboard',
    'doctor/schedule': 'doctorSchedule',
    'reception/dashboard': 'receptionDashboard',
    'reception/patients': 'receptionDashboard',
    'reception/appointments': 'receptionDashboard',
    'reception/billing': 'receptionDashboard',
    'reception/queue': 'receptionDashboard',
    'md/dashboard': 'mdDashboard',
    'md/staff': 'mdDashboard',
    'md/hr': 'mdDashboard',
    'md/accounting': 'mdDashboard',
    'md/reports': 'mdDashboard',
    'md/profit': 'mdDashboard',
    'director/dashboard': 'directorDashboard',
    'director/accounting': 'directorDashboard',
    'director/reports': 'directorDashboard',
    'director/shareholders': 'directorDashboard',
    'director/profit': 'directorDashboard',
    'director/settings': 'directorDashboard',
    'multi-branch': 'multiBranch',

    // Help & Communication
    'help': 'helpCenter',
    'helpcenter': 'helpCenter',
    'help-center': 'helpCenter',
    'inbox': 'inbox',
    'notifications': 'notifications',
    'notifications-center': 'notifications',

    // Support services
    'ambulance': 'ambulance',
    'blood-bank': 'bloodBank',
    'biomedical-waste': 'biomedicalWaste',
    'cssd': 'cssd',
    'housekeeping': 'housekeeping',
    'kitchen': 'kitchen',
    'laundry': 'laundry',
    'asset-management': 'assetManagement',
    'camos': 'camos',

    // Marketing
    'marketing': 'marketing',
    'marketing-referral': 'marketing',
    'whatsapp-dashboard': 'whatsapp',
    'create-referral': 'createReferral',
    'incoming-referrals': 'incomingReferrals',

    // Marketplace
    'marketplace': 'marketplace',
    'marketplace/landing': 'marketplace',
    'marketplace/doctors': 'marketplaceDoctors',
    'marketplace/hospitals': 'marketplaceHospitals',
    'marketplace/booking-queue': 'marketplaceQueue',
    'marketplace/reviews': 'marketplaceReviews',
    'hospital-profile': 'hospitalProfile',
    'doctor-profile': 'doctorProfile',

    // Misc
    'hospital-setup': 'hospitalSetup',
    'hospital-setup-wizard': 'hospitalSetup',
    'track-anything': 'trackAnything',
    'ai-assistant': 'aiAssistant',
    'commission': 'commission',
    'system-audit': 'systemAudit',
  };

  if (exactMap[subPath]) return exactMap[subPath];

  // Pattern matches
  if (subPath.startsWith('patients/')) return 'patientDetail';
  if (subPath.startsWith('billing/')) return 'billing';
  if (subPath.startsWith('lab/')) return 'labDashboard';
  if (subPath.startsWith('inventory/')) return 'inventory';
  if (subPath.startsWith('pharmacy/')) return 'pharmacy';
  if (subPath.startsWith('reception/')) return 'receptionDashboard';
  if (subPath.startsWith('doctor/')) return 'doctorDashboard';
  if (subPath.startsWith('md/')) return 'mdDashboard';
  if (subPath.startsWith('director/')) return 'directorDashboard';
  if (subPath.startsWith('reports/')) return 'reports';
  if (subPath.startsWith('accounting/')) return 'accounting';
  if (subPath.startsWith('marketplace/')) return 'marketplace';
  if (subPath.startsWith('super-admin/')) return 'superAdminDashboard';

  return '';
}

export default function PageHelpButton() {
  const { t, i18n } = useTranslation('pageHelp');
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!i18n.hasResourceBundle(i18n.language, 'pageHelp')) {
      i18n.loadNamespaces('pageHelp').catch(() => {});
    }
  }, [i18n.language, i18n]);

  const helpKey = useMemo(() => resolveHelpKey(location.pathname), [location.pathname]);

  const languageCandidates = [
    i18n.resolvedLanguage,
    i18n.language,
    i18n.language?.split('-')[0],
    'en',
  ].filter(Boolean) as string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (languageCandidates
    .map((lng) => i18n.getResourceBundle(lng, 'pageHelp'))
    .find((bundle: any) => bundle?.pages) ?? {}) as any;
  const pageData = helpKey ? raw?.pages?.[helpKey] : null;

  const hasHelp = !!pageData?.title;

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (!mounted) return null;

  return (
    <>
      {/* Inline trigger button — rendered inside Header so it never overlaps page content */}
      <button
        onClick={() => setOpen(true)}
        className="relative p-2 rounded-lg hover:bg-[var(--color-border-light)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        title={t('drawerTitle')}
        aria-label={t('drawerTitle')}
      >
        <Info className="w-5 h-5 text-[var(--color-text-secondary)]" />
      </button>

      {/* Drawer rendered via portal so it escapes any containing-block ancestors (e.g. backdrop-filter) */}
      {createPortal(
        <>
          {/* Backdrop */}
          {open && (
            <div
              className="fixed inset-0 z-[101] bg-black/40 backdrop-blur-sm transition-opacity"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Drawer */}
          <div
            className={`fixed top-0 right-0 z-[102] h-full w-full sm:w-[420px] bg-white dark:bg-slate-900 shadow-2xl transform transition-transform duration-300 ease-out ${
              open ? 'translate-x-0' : 'translate-x-full'
            }`}
            aria-hidden={!open}
            role="dialog"
            aria-modal="true"
          >
        <div className="flex flex-col h-full">
          {/* Drawer Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] bg-gradient-to-r from-[var(--color-primary)]/10 to-cyan-400/10">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)] flex items-center justify-center text-white">
                <BookOpen className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-[var(--color-text)]">{t('drawerTitle')}</h2>
                <p className="text-[11px] text-[var(--color-text-muted)]">{t('drawerSubtitle')}</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              aria-label={t('close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {hasHelp ? (
              <>
                {/* Page Title */}
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[var(--color-primary)]" />
                  <h3 className="text-base font-bold text-[var(--color-text)]">
                    {pageData.title}
                  </h3>
                </div>

                {/* Overview */}
                {pageData.overview && (
                  <section className="bg-[var(--color-bg)] rounded-xl p-4 border border-[var(--color-border)]">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
                      {t('sections.overview')}
                    </h4>
                    <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                      {pageData.overview}
                    </p>
                  </section>
                )}

                {/* Features */}
                {Array.isArray(pageData.features) && pageData.features.length > 0 && (
                  <section>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                      {t('sections.features')}
                    </h4>
                    <ul className="space-y-2">
                      {pageData.features.map((feature: string, i: number) => (
                        <li key={i} className="flex items-start gap-2.5 text-sm text-[var(--color-text)]">
                          <ChevronRight className="w-3.5 h-3.5 text-[var(--color-primary)] shrink-0 mt-0.5" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {/* How to Use */}
                {Array.isArray(pageData.howToUse) && pageData.howToUse.length > 0 && (
                  <section>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
                      {t('sections.howToUse')}
                    </h4>
                    <ol className="space-y-2.5">
                      {pageData.howToUse.map((step: string, i: number) => (
                        <li key={i} className="flex gap-3 text-sm text-[var(--color-text)]">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-cyan-400 text-white text-[11px] font-bold flex items-center justify-center">
                            {i + 1}
                          </span>
                          <span className="leading-relaxed pt-0.5">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}

                {/* Tips */}
                {Array.isArray(pageData.tips) && pageData.tips.length > 0 && (
                  <section className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800">
                    <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">
                      <Lightbulb className="w-3.5 h-3.5" />
                      {t('sections.tips')}
                    </h4>
                    <ul className="space-y-1.5">
                      {pageData.tips.map((tip: string, i: number) => (
                        <li key={i} className="flex gap-2 text-sm text-emerald-800 dark:text-emerald-300">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <BookOpen className="w-12 h-12 text-[var(--color-text-muted)] opacity-30 mb-4" />
                <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">
                  {t('notFoundTitle')}
                </h3>
                <p className="text-xs text-[var(--color-text-secondary)] max-w-xs mb-5">
                  {t('notFoundDesc')}
                </p>
                <button
                  onClick={() => {
                    setOpen(false);
                    window.location.href = '/h/help';
                  }}
                  className="px-4 py-2 rounded-lg bg-[var(--color-primary)] text-white text-xs font-semibold hover:brightness-110 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                >
                  {t('goToHelpCenter')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
        </>,
        document.body
      )}
    </>
  );
}
