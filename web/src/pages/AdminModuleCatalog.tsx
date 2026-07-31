import { type ReactNode, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Ambulance,
  Baby,
  BedDouble,
  Brain,
  Building2,
  Calendar,
  CreditCard,
  Database,
  Eye,
  FileText,
  FlaskConical,
  Heart,
  MessageSquare,
  Package,
  Pill,
  Printer,
  Receipt,
  Search,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';

type CatalogStatus = 'MVP' | 'Included' | 'Sensitive' | 'Advanced' | 'Specialized';

interface CatalogModule {
  title: string;
  description: string;
  path: string;
  area: string;
  status: CatalogStatus;
  keywords: string[];
  icon: ReactNode;
}

const blueprintModules: CatalogModule[] = [
  {
    title: 'Hospital Profile',
    description: 'Logo, address, contact, license, BIN/TIN, footer and print header identity.',
    path: 'settings/hospital-profile',
    area: 'Organization',
    status: 'MVP',
    keywords: ['hospital', 'profile', 'logo', 'license', 'branch'],
    icon: <Building2 className="h-4 w-4" />,
  },
  {
    title: 'Users & Roles',
    description: 'Staff/user list, account status, department assignment and user access workflow.',
    path: 'staff',
    area: 'People',
    status: 'MVP',
    keywords: ['users', 'staff', 'roles', 'account'],
    icon: <Users className="h-4 w-4" />,
  },
  {
    title: 'Permission Matrix',
    description: 'Module-wise RBAC, role templates, user overrides and permission audit trail.',
    path: 'permissions',
    area: 'People',
    status: 'Sensitive',
    keywords: ['permission', 'rbac', 'role', 'matrix', 'critical'],
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  {
    title: 'Department Setup',
    description: 'OPD/IPD departments with status-based lifecycle instead of destructive deletion.',
    path: 'settings/departments',
    area: 'Organization',
    status: 'MVP',
    keywords: ['department', 'opd', 'ipd', 'inactive'],
    icon: <Building2 className="h-4 w-4" />,
  },
  {
    title: 'Doctor Schedule & Fee',
    description: 'Doctor profile, chamber details, schedule, status and appointment fee controls.',
    path: 'doctors',
    area: 'People',
    status: 'MVP',
    keywords: ['doctor', 'schedule', 'fee', 'bmdc'],
    icon: <Stethoscope className="h-4 w-4" />,
  },
  {
    title: 'Service & Pricing',
    description: 'Billing service master, categories, prices, tax, discount eligibility and packages.',
    path: 'billing-master',
    area: 'Finance',
    status: 'MVP',
    keywords: ['service', 'pricing', 'billing master', 'tax', 'discount'],
    icon: <Receipt className="h-4 w-4" />,
  },
  {
    title: 'OPD / Appointment Settings',
    description: 'Appointment modes, token/queue behavior, follow-up and serial settings.',
    path: 'settings/appointments',
    area: 'Operations',
    status: 'Included',
    keywords: ['opd', 'appointment', 'queue', 'token', 'follow up'],
    icon: <Calendar className="h-4 w-4" />,
  },
  {
    title: 'Billing Settings',
    description: 'Invoice numbering, VAT, due, refund, cancellation and sensitive finance rules.',
    path: 'settings/billing',
    area: 'Finance',
    status: 'Sensitive',
    keywords: ['billing', 'invoice', 'due', 'refund', 'cancel', 'vat'],
    icon: <CreditCard className="h-4 w-4" />,
  },
  {
    title: 'Payment Method Settings',
    description: 'Cash, mobile wallet, card and bank payment method activation and transaction rules.',
    path: 'settings/payments',
    area: 'Finance',
    status: 'Included',
    keywords: ['payment', 'bkash', 'nagad', 'card', 'bank'],
    icon: <CreditCard className="h-4 w-4" />,
  },
  {
    title: 'Lab Test & Report Setup',
    description: 'Test catalog, report templates, reference ranges, sample numbering and workflow setup.',
    path: 'lab-settings',
    area: 'Clinical',
    status: 'MVP',
    keywords: ['lab', 'test', 'report', 'template', 'sample'],
    icon: <FlaskConical className="h-4 w-4" />,
  },
  {
    title: 'Pharmacy Medicine / Stock Rules',
    description: 'Medicine master, suppliers, stock, expiry, narcotic register and pharmacy billing.',
    path: 'pharmacy/items',
    area: 'Clinical',
    status: 'Included',
    keywords: ['pharmacy', 'medicine', 'stock', 'expiry', 'supplier'],
    icon: <Pill className="h-4 w-4" />,
  },
  {
    title: 'Ward / Bed / IPD Settings',
    description: 'Bed map, admissions, IPD charge rules, discharge flow and inpatient billing.',
    path: 'beds',
    area: 'Operations',
    status: 'Included',
    keywords: ['ward', 'bed', 'ipd', 'admission', 'discharge'],
    icon: <BedDouble className="h-4 w-4" />,
  },
  {
    title: 'Print Template Settings',
    description: 'Prescription, invoice, token, lab report and other print template setup.',
    path: 'print-templates',
    area: 'Templates',
    status: 'MVP',
    keywords: ['print', 'template', 'invoice', 'prescription', 'lab report'],
    icon: <Printer className="h-4 w-4" />,
  },
  {
    title: 'SMS / Notification Settings',
    description: 'SMS gateway, event templates, variable chips and notification events.',
    path: 'settings/sms',
    area: 'Templates',
    status: 'Included',
    keywords: ['sms', 'notification', 'template', 'gateway'],
    icon: <MessageSquare className="h-4 w-4" />,
  },
  {
    title: 'Audit Log',
    description: 'Read-only operational and sensitive action history for settings, billing and patient changes.',
    path: 'system-audit',
    area: 'Security',
    status: 'Sensitive',
    keywords: ['audit', 'log', 'history', 'security'],
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  {
    title: 'Backup & Restore',
    description: 'Manual backup action, backup schedule, download control and guarded restore UI.',
    path: 'settings/backup',
    area: 'Security',
    status: 'Sensitive',
    keywords: ['backup', 'restore', 'download', 'data'],
    icon: <Database className="h-4 w-4" />,
  },
  {
    title: 'System Preferences',
    description: 'Language, date/time, currency, timezone, prefix settings and import/export controls.',
    path: 'settings/preferences',
    area: 'System',
    status: 'MVP',
    keywords: ['system', 'preference', 'prefix', 'language', 'timezone'],
    icon: <Settings className="h-4 w-4" />,
  },
  {
    title: 'Setup Wizard',
    description: 'First-run setup steps for hospital profile, departments, doctors, services, users and billing.',
    path: 'setup',
    area: 'System',
    status: 'Included',
    keywords: ['setup', 'wizard', 'onboarding'],
    icon: <Settings className="h-4 w-4" />,
  },
];

const specializedModules: CatalogModule[] = [
  {
    title: 'Dental',
    description: 'Specialty dental charting and dental workflow surface.',
    path: 'dental',
    area: 'Specialty Care',
    status: 'Specialized',
    keywords: ['dental', 'teeth', 'specialty'],
    icon: <Stethoscope className="h-4 w-4" />,
  },
  {
    title: 'Surgery / OT',
    description: 'Operation theatre, surgery schedule, CSSD support and procedure workflow.',
    path: 'surgery',
    area: 'Specialty Care',
    status: 'Specialized',
    keywords: ['surgery', 'ot', 'operation', 'cssd'],
    icon: <Activity className="h-4 w-4" />,
  },
  {
    title: 'Emergency & MLC',
    description: 'Emergency desk, triage-adjacent workflow and medico-legal case tracking.',
    path: 'emergency',
    area: 'Operations',
    status: 'Specialized',
    keywords: ['emergency', 'mlc', 'triage'],
    icon: <Activity className="h-4 w-4" />,
  },
  {
    title: 'Radiology',
    description: 'Radiology requisition, report and imaging workflow surface.',
    path: 'radiology',
    area: 'Diagnostics',
    status: 'Specialized',
    keywords: ['radiology', 'xray', 'scan', 'imaging'],
    icon: <FileText className="h-4 w-4" />,
  },
  {
    title: 'Vaccination',
    description: 'Vaccination module for immunization workflows.',
    path: 'vaccination',
    area: 'Clinical',
    status: 'Specialized',
    keywords: ['vaccine', 'vaccination', 'immunization'],
    icon: <ShieldCheck className="h-4 w-4" />,
  },
  {
    title: 'Maternity',
    description: 'Maternity-focused clinical and operational dashboard.',
    path: 'maternity',
    area: 'Specialty Care',
    status: 'Specialized',
    keywords: ['maternity', 'obstetric', 'birth'],
    icon: <Baby className="h-4 w-4" />,
  },
  {
    title: 'Psychiatry',
    description: 'Psychiatry workflow surface for behavioral health operations.',
    path: 'psychiatry',
    area: 'Specialty Care',
    status: 'Specialized',
    keywords: ['psychiatry', 'mental health'],
    icon: <Brain className="h-4 w-4" />,
  },
  {
    title: 'Eye Exam',
    description: 'Eye exam workflow and ophthalmic assessment surface.',
    path: 'eye-exam',
    area: 'Specialty Care',
    status: 'Specialized',
    keywords: ['eye', 'ophthalmology', 'vision'],
    icon: <Eye className="h-4 w-4" />,
  },
  {
    title: 'Blood Bank',
    description: 'Blood bank stock and operational module.',
    path: 'blood-bank',
    area: 'Support Services',
    status: 'Specialized',
    keywords: ['blood', 'bank', 'donor'],
    icon: <Heart className="h-4 w-4" />,
  },
  {
    title: 'Ambulance',
    description: 'Ambulance dispatch and emergency transport support.',
    path: 'ambulance',
    area: 'Support Services',
    status: 'Specialized',
    keywords: ['ambulance', 'transport', 'emergency'],
    icon: <Ambulance className="h-4 w-4" />,
  },
  {
    title: 'Inventory',
    description: 'Hospital inventory, stock transfers, purchase orders, counts, RFQ and issue workflow.',
    path: 'inventory',
    area: 'Operations',
    status: 'Advanced',
    keywords: ['inventory', 'stock', 'purchase', 'rfq'],
    icon: <Package className="h-4 w-4" />,
  },
  {
    title: 'Insurance',
    description: 'Insurance claims, insurance billing and prior authorization support.',
    path: 'insurance-claims',
    area: 'Finance',
    status: 'Advanced',
    keywords: ['insurance', 'claim', 'prior auth'],
    icon: <FileText className="h-4 w-4" />,
  },
  {
    title: 'Telemedicine',
    description: 'Remote consultation dashboard and video visit room workflow.',
    path: 'telemedicine',
    area: 'Digital Care',
    status: 'Advanced',
    keywords: ['telemedicine', 'video', 'remote'],
    icon: <MessageSquare className="h-4 w-4" />,
  },
  {
    title: 'Helpdesk',
    description: 'Internal helpdesk and support ticket workflow.',
    path: 'helpdesk',
    area: 'Support Services',
    status: 'Included',
    keywords: ['helpdesk', 'support', 'ticket'],
    icon: <MessageSquare className="h-4 w-4" />,
  },
];

const allModules = [...blueprintModules, ...specializedModules];

function matchesQuery(item: CatalogModule, query: string) {
  if (!query) return true;
  const haystack = [
    item.title,
    item.description,
    item.area,
    item.status,
    ...item.keywords,
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function StatusBadge({ status }: { status: CatalogStatus }) {
  const classes: Record<CatalogStatus, string> = {
    MVP: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Included: 'bg-sky-50 text-sky-700 border-sky-200',
    Sensitive: 'bg-red-50 text-red-700 border-red-200',
    Advanced: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    Specialized: 'bg-amber-50 text-amber-700 border-amber-200',
  };

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${classes[status]}`}>
      {status}
    </span>
  );
}

function ModuleGrid({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: CatalogModule[];
  onOpen: (path: string) => void;
}) {
  const { t } = useTranslation(['tenantAdmin']);
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
          <p className="text-xs text-[var(--color-text-muted)]">{t('adminModuleCatalog.modulesCount', { count: items.length })}</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-[var(--color-border)] bg-white p-8 text-center dark:bg-slate-900">
          <p className="text-sm font-medium text-[var(--color-text-primary)]">{t('adminModuleCatalog.noModulesMatched')}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">{t('adminModuleCatalog.noModulesHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <article key={`${title}-${item.title}`} className="card flex min-h-[156px] flex-col p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary-light)] text-[var(--color-primary)]">
                    {item.icon}
                  </span>
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{item.title}</h3>
                    <p className="text-[11px] font-medium text-[var(--color-text-muted)]">{item.area}</p>
                  </div>
                </div>
                <StatusBadge status={item.status} />
              </div>
              <p className="mt-3 flex-1 text-sm leading-5 text-[var(--color-text-secondary)]">{item.description}</p>
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => onOpen(item.path)}
                  className="btn-secondary text-xs"
                  aria-label={`Open ${item.title}`}
                >
                  {t('adminModuleCatalog.open')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

export default function AdminModuleCatalog({ role = 'hospital_admin' }: { role?: string }) {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug ?? ''}`;
  const { t } = useTranslation(['tenantAdmin']);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const filteredBlueprint = useMemo(
    () => blueprintModules.filter((item) => matchesQuery(item, normalizedQuery)),
    [normalizedQuery],
  );
  const filteredSpecialized = useMemo(
    () => specializedModules.filter((item) => matchesQuery(item, normalizedQuery)),
    [normalizedQuery],
  );
  const sensitiveCount = allModules.filter((item) => item.status === 'Sensitive').length;

  const openModule = (path: string) => {
    navigate(`${base}/${path}`);
  };

  return (
    <DashboardLayout role={role}>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('adminModuleCatalog.adminInventory')}</p>
            <h1 className="page-title">{t('adminModuleCatalog.title')}</h1>
            <p className="section-subtitle mt-1">
              {t('adminModuleCatalog.subtitle')}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[28rem]">
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-3 dark:bg-slate-900">
              <p className="text-lg font-semibold text-[var(--color-text-primary)]">{blueprintModules.length}</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">{t('adminModuleCatalog.blueprintItems')}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-3 dark:bg-slate-900">
              <p className="text-lg font-semibold text-[var(--color-primary)]">{specializedModules.length}</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">{t('adminModuleCatalog.specializedModules')}</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-3 dark:bg-slate-900">
              <p className="text-lg font-semibold text-red-600">{sensitiveCount}</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">{t('adminModuleCatalog.sensitiveControls')}</p>
            </div>
          </div>
        </header>

        <div className="relative max-w-2xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('adminModuleCatalog.searchPlaceholder')}
            className="input pl-10"
            aria-label={t('adminModuleCatalog.searchAriaLabel')}
          />
        </div>

        <ModuleGrid title={t('adminModuleCatalog.blueprintCoverage')} items={filteredBlueprint} onOpen={openModule} />
        <ModuleGrid title={t('adminModuleCatalog.specializedModulesTitle')} items={filteredSpecialized} onOpen={openModule} />
      </div>
    </DashboardLayout>
  );
}
