import { Link, useLocation, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Home } from 'lucide-react';

interface BreadcrumbSegment {
  label: string;
  path: string;
  isLast: boolean;
}

/**
 * Route segment to i18n label mapping.
 * Keys are the URL segment, values are i18n keys in the 'sidebar' namespace.
 * Add new entries here when adding new routes.
 */
const SEGMENT_LABELS: Record<string, string> = {
  // Top-level
  dashboard:           'dashboard',
  patients:            'patientsOverview',
  appointments:        'appointments',
  'queue-management':  'opdQueue',
  emergency:           'emergency',
  mlc:                 'mlc',
  ot:                  'ot',
  surgery:             'surgery',
  cssd:                'cssd',
  admissions:          'admissionsOverview',
  beds:                'beds',
  'nurse-station':     'nurseStation',
  nursing:             'nursing',
  'doctor-schedule':   'doctorSchedule',
  doctors:             'doctors',
  telemedicine:        'telemedicine',
  maternity:           'maternity',
  kitchen:             'kitchen',
  laundry:             'laundry',
  housekeeping:        'housekeeping',
  ambulance:           'ambulance',
  mortuary:            'mortuary',
  'biomedical-waste':  'bioWaste',
  'ward-supply':       'wardSupply',
  helpdesk:            'helpdesk',
  tests:               'labOverview',
  'lab-settings':      'labSettings',
  'lab-machines':      'labMachines',
  radiology:           'radiology',
  pharmacy:            'pharmacyOverview',
  inventory:           'inventory',
  'medical-records':   'medicalRecords',
  'health-records':    'healthRecords',
  vitals:              'vitals',
  allergies:           'allergies',
  clinical:            'clinicalAssessments',
  'care-plans':        'carePlans',
  'track-anything':    'trackAnything',
  questionnaires:      'questionnaires',
  camos:               'camos',
  dictation:           'dictation',
  'procedure-orders':  'procedureOrders',
  'e-prescribing':     'ePrescribing',
  'blood-bank':        'bloodBank',
  dental:              'dental',
  psychiatry:          'psychiatry',
  'eye-exam':          'eyeExam',
  'physical-exam':     'physicalExam',
  vaccination:         'vaccination',
  billing:             'billingOverview',
  'billing-counter':   'billingCounter',
  'billing-master':    'billingMaster',
  'billing-provisional': 'provisionalBilling',
  deposits:            'deposits',
  'credit-notes':      'creditNotes',
  'billing-handover':  'billHandover',
  'billing-cancellation': 'billCancellation',
  settlements:         'settlements',
  'insurance-claims':  'insurance',
  'insurance-billing': 'insuranceBilling',
  'ip-billing':        'ipBilling',
  payments:            'payments',
  commissions:         'doctorCommissions',
  accounting:          'accountingOverview',
  income:              'income',
  expenses:            'expenses',
  recurring:           'recurring',
  accounts:            'accounts',
  journal:             'journal',
  'profit-loss':       'profit',
  'fiscal-year-settings': 'fiscalYearSettings',
  'voucher-verification': 'voucherVerification',
  staff:               'staffOverview',
  hr:                  'hrPayroll',
  leave:               'leaveManagement',
  'duty-roster':       'dutyRoster',
  'attendance-punch':  'attendance',
  shareholders:        'shareholders',
  'group-attendance':  'groupAttendance',
  'fee-sheet':         'feeSheet',
  reports:             'reportsOverview',
  pdf:                 'pdfGeneration',
  'system-audit':      'systemAudit',
  'patient-duplicates': 'patientDuplicates',
  inbox:               'inbox',
  'form-builder':      'formBuilder',
  'multi-branch':      'multiBranch',
  'asset-management':  'assetManagement',
  setup:               'setupWizard',
  'software-modules':  'softwareModules',
  whatsapp:            'whatsapp',
  website:             'website',
  'print-templates':   'printTemplates',
  settings:            'settings',
  profile:             'profile',
  mfa:                 'mfa',
  notifications:       'notifications',
  permissions:         'permissions',
  invitations:         'invitations',
  'marketing-referral': 'marketingReferral',
  referrals:           'referrals',
  'review-moderation': 'reviewModeration',
  'marketplace-bookings': 'marketplaceBookings',
  help:                'helpCenter',
  'ai-assistant':      'aiAssistant',
  'quality-kpi':       'qualityKpi',
  'death-records':     'deathRecords',
  'ipd-reports':       'ipdReports',
  'discharge-planning': 'dischargePlanning',
  'lab':               'labOverview',
  'order/new':         'newOrder',
  dispensing:          'dispensing',
  new:                 'new',
  // Admin panel routes
  'admin-dashboard':   'adminDashboard',
  action:              'actionCenter',
  'pending-approvals': 'pendingApprovals',
  alerts:              'alertsExceptions',
  tasks:               'tasksFollowups',
  monitor:             'operationsMonitor',
  drawers:             'liveCashDrawers',
  handover:            'shiftHandover',
  collections:         'dailyCollection',
  refunds:             'refunds',
  dues:                'dueCollection',
  'approval-policies': 'approvalPolicies',
  'escalation-rules':  'escalationRules',
  'hospital-profile':  'hospitalProfile',
  suspicious:          'suspiciousActivities',
  exports:             'exportHistory',
  'patient-access':    'patientRecordAccess',
  executive:           'executiveOverview',
  builder:             'customReportBuilder',
  // Pharmacy sub-routes
  items:               'items',
  categories:          'categories',
  generics:            'generics',
  suppliers:           'suppliers',
  stock:               'stock',
  po:                  'purchaseOrders',
  grn:                 'goodsReceipts',
  invoices:            'invoices',
  prescriptions:       'prescriptions',
  narcotics:           'narcoticRegister',
  'write-offs':        'writeOffs',
  dispatches:          'dispatches',
  'patient-billing':   'patientBilling',
  receipts:            'receipts',
  'supplier-ledger':   'supplierLedger',
  'dispensary-stock':  'dispensaryStock',
  'tax-config':        'taxConfig',
  'dosage-templates':  'dosageTemplates',
  'approval-queue':    'approvalQueue',
  'price-history':     'priceHistory',
  // Inventory sub-routes
  issues:              'inventoryIssues',
  transfers:           'inventoryTransfers',
  returns:             'inventoryReturns',
  counts:              'stockCounts',
  'adjustment-requests': 'adjustmentRequests',
  'write-off':         'writeOffs',
  'return-to-vendor':  'returnToVendor',
  'master-data':       'masterData',
  rfq:                 'rfqQuotations',
  'import-export':     'importExport',
  donations:           'donations',
  ledger:              'ledger',
  traceability:        'traceability',
  // Accounting sub-routes
  audit:               'audit',
  // Reception sub-routes
  'online-approvals':  'onlineApprovals',
  'doctor-status':     'doctorStatus',
  'patient-card-scan': 'patientCardScan',
  // Doctor sub-routes
  opd:                 'opd',
  ipd:                 'ipd',
  overview:            'overview',
  visits:              'visits',
  summary:             'summary',
  // Common
  print:               'print',
  room:                'room',
};

// Aliases for segments that need human-readable fallbacks
const SEGMENT_FALLBACKS: Record<string, string> = {
  po: 'Purchase Orders',
  grn: 'Goods Receipts',
  ipd: 'IPD',
  opd: 'OPD',
  mfa: 'MFA',
  cssd: 'CSSD',
  mlc: 'MLC',
  ot: 'OT',
  rfq: 'RFQ',
  pdf: 'PDF Generation',
  // Admin panel fallbacks
  'admin-dashboard': 'Dashboard',
  action: 'Action Center',
  'pending-approvals': 'Pending Approvals',
  alerts: 'Alerts & Exceptions',
  tasks: 'Tasks & Follow-ups',
  monitor: 'Operations Monitor',
  drawers: 'Live Cash Drawers',
  handover: 'Shift Handover',
  collections: 'Daily Collection',
  refunds: 'Refunds',
  dues: 'Due Collection',
  'approval-policies': 'Approval Policies',
  'escalation-rules': 'Escalation Rules',
  'hospital-profile': 'Hospital Profile',
  suspicious: 'Suspicious Activities',
  exports: 'Export History',
  'patient-access': 'Patient Record Access',
  executive: 'Executive Overview',
  revenue: 'Revenue Analytics',
  builder: 'Custom Report Builder',
  adjustments: 'Stock Adjustments',
  sessions: 'Login Sessions',
};

interface BreadcrumbsProps {
  /** Optional override: skip certain segments (e.g. 'h', slug) */
  skipSegments?: string[];
  /** Optional: max depth (default 4) */
  maxDepth?: number;
}

export default function Breadcrumbs({ skipSegments = [], maxDepth = 4 }: BreadcrumbsProps) {
  const location = useLocation();
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation('sidebar');

  const rawSegments = location.pathname.split('/').filter(Boolean);
  const isTenantRoute = rawSegments[0] === 'h' && Boolean(slug);
  const omittedSegments = new Set(['h', ...(slug ? [slug] : []), ...skipSegments]);
  const segments = rawSegments.filter((s) => !omittedSegments.has(s));

  if (segments.length <= 1) return null;

  // Build full path for every segment first
  const allCrumbs: BreadcrumbSegment[] = [];
  let accumulatedPath = isTenantRoute ? `/h/${slug}` : '';

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    accumulatedPath = `${accumulatedPath}/${segment}`.replace(/\/+/g, '/');
    const isActionCollections = segment === 'collections' && segments[i - 1] === 'action';
    const i18nKey = isActionCollections ? 'actionCenterCollections' : SEGMENT_LABELS[segment];
    const fallback = isActionCollections
      ? 'Collections'
      : SEGMENT_FALLBACKS[segment] ?? segment;
    const label = i18nKey
      ? t(i18nKey, { defaultValue: fallback })
      : fallback.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    allCrumbs.push({
      label,
      path: accumulatedPath,
      isLast: i === segments.length - 1,
    });
  }

  // Only display the last `maxDepth` crumbs (but with correct full paths)
  const crumbs = allCrumbs.slice(-maxDepth);
  // Mark the first visible crumb as not-last if we truncated
  if (crumbs.length > 0) {
    crumbs[crumbs.length - 1].isLast = true;
  }

  const homePath = isTenantRoute
    ? `/h/${slug}/dashboard`
    : rawSegments[0] === 'super-admin'
      ? '/super-admin/dashboard'
      : '/';

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] flex-wrap">
        <li>
          <Link
            to={homePath}
            className="flex items-center gap-1 hover:text-[var(--color-primary)] transition-colors"
            aria-label="Home"
          >
            <Home className="w-3.5 h-3.5" />
          </Link>
        </li>
        {crumbs.map((crumb) => (
          <li key={crumb.path} className="flex items-center gap-1">
            <ChevronRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {crumb.isLast ? (
              <span className="font-medium text-[var(--color-text-primary)]" aria-current="page">
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.path}
                className="hover:text-[var(--color-primary)] transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
