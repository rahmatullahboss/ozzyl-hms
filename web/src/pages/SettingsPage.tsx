import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  BedDouble,
  Bell,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Database,
  Download,
  FileText,
  FlaskConical,
  Globe,
  Hash,
  ImageIcon,
  Key,
  Layers,
  Lock,
  MessageSquare,
  Palette,
  Pill,
  Printer,
  Receipt,
  Save,
  Search,
  Send,
  Settings,
  Shield,
  Stethoscope,
  Trash2,
  Upload,
  UserCog,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { useSettingsForm } from '../hooks/useSettingsForm';
import { queryKeys } from '../lib/queryKeys';
import { getTenant, getToken } from '../hooks/useAuth';
import { getTenantSlugFromPath } from '../hooks/useTenantSlug';
import { compressImage } from '../lib/compressImage';
import { applyDynamicManifest, applyPwaIcons } from '../lib/pwaPrompt';

type InlinePanelId = 'hospital-profile' | 'billing-settings' | 'sms-settings';

interface SettingsItem {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  path?: string;
  inline?: InlinePanelId;
  badge?: 'MVP' | 'Sensitive' | 'Setup';
  keywords: string[];
}

interface SettingsCategory {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  color: string;
  items: SettingsItem[];
}

interface HospitalInfo {
  name: string;
  short_name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  registration_number: string;
  bin_tin: string;
  tagline: string;
  footer_text: string;
}

const emptyHospitalInfo: HospitalInfo = {
  name: '',
  short_name: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  registration_number: '',
  bin_tin: '',
  tagline: '',
  footer_text: '',
};

function useSettingsCategories(): SettingsCategory[] {
  return [
    {
      id: 'organization',
      label: 'Organization',
      description: 'Hospital setup, branches, departments, identity',
      icon: <Building2 className="w-5 h-5" />,
      color: 'bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300',
      items: [
        {
          id: 'hospital-profile',
          label: 'Hospital Profile',
          description: 'Logo, address, contact, license, BIN/TIN, footer text',
          icon: <Building2 className="w-4 h-4" />,
          inline: 'hospital-profile',
          badge: 'MVP',
          keywords: ['hospital', 'clinic', 'logo', 'address', 'phone', 'email', 'license', 'bin', 'tin', 'footer'],
        },
        {
          id: 'branch-setup',
          label: 'Branch Setup',
          description: 'Branch codes, addresses, managers, active status',
          icon: <Globe className="w-4 h-4" />,
          path: 'multi-branch',
          keywords: ['branch', 'multi branch', 'manager', 'location'],
        },
        {
          id: 'department-setup',
          label: 'Department Setup',
          description: 'OPD/IPD departments with inactive instead of delete',
          icon: <Layers className="w-4 h-4" />,
          path: 'settings/departments',
          badge: 'MVP',
          keywords: ['department', 'opd', 'ipd', 'medicine', 'surgery', 'inactive'],
        },
      ],
    },
    {
      id: 'people',
      label: 'People',
      description: 'Users, role templates, doctors, staff access',
      icon: <Users className="w-5 h-5" />,
      color: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300',
      items: [
        {
          id: 'users-roles',
          label: 'Users & Roles',
          description: 'Add users, assign roles, department, branch, status',
          icon: <UserCog className="w-4 h-4" />,
          path: 'staff',
          badge: 'MVP',
          keywords: ['user', 'users', 'roles', 'staff', 'username', 'mobile', 'password'],
        },
        {
          id: 'permission-matrix',
          label: 'Permission Matrix',
          description: 'Module-wise RBAC with special critical permissions',
          icon: <Shield className="w-4 h-4" />,
          path: 'permissions',
          badge: 'Sensitive',
          keywords: ['permission', 'rbac', 'matrix', 'access', 'discount', 'refund', 'backup', 'invoice cancel'],
        },
        {
          id: 'doctor-setup',
          label: 'Doctor Setup',
          description: 'Profiles, fees, schedules, rooms, BMDC numbers',
          icon: <Stethoscope className="w-4 h-4" />,
          path: 'doctors',
          badge: 'MVP',
          keywords: ['doctor', 'fee', 'schedule', 'room', 'bmdc', 'consultation'],
        },
        {
          id: 'staff',
          label: 'Staff',
          description: 'Staff registry and HR handoff',
          icon: <Users className="w-4 h-4" />,
          path: 'staff',
          keywords: ['staff', 'employee', 'department', 'active'],
        },
      ],
    },
    {
      id: 'operations',
      label: 'Operations',
      description: 'Appointment, service, lab, pharmacy, IPD controls',
      icon: <Activity className="w-5 h-5" />,
      color: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
      items: [
        {
          id: 'service-pricing',
          label: 'Service & Pricing',
          description: 'Service categories, prices, VAT, discounts, commissions',
          icon: <Receipt className="w-4 h-4" />,
          path: 'billing-master',
          badge: 'MVP',
          keywords: ['service', 'pricing', 'price', 'fee', 'vat', 'discount', 'commission', 'bulk import'],
        },
        {
          id: 'opd-appointment-settings',
          label: 'OPD / Appointment Settings',
          description: 'Serial, token, queue, follow-up validity rules',
          icon: <Calendar className="w-4 h-4" />,
          path: 'settings/appointments',
          keywords: ['appointment', 'opd', 'serial', 'token', 'queue', 'follow up'],
        },
        {
          id: 'lab-test-setup',
          label: 'Lab Test Setup',
          description: 'Test catalog, parameters, categories, report workflow',
          icon: <FlaskConical className="w-4 h-4" />,
          path: 'lab-settings',
          badge: 'MVP',
          keywords: ['lab', 'test', 'parameter', 'report', 'template', 'sample', 'approval'],
        },
        {
          id: 'pharmacy-settings',
          label: 'Pharmacy Settings',
          description: 'Medicine master, categories, suppliers, stock rules',
          icon: <Pill className="w-4 h-4" />,
          path: 'pharmacy/items',
          keywords: ['pharmacy', 'medicine', 'stock', 'expiry', 'batch', 'supplier'],
        },
        {
          id: 'ipd-bed-settings',
          label: 'IPD / Bed Settings',
          description: 'Wards, bed map, charges, deposit and discharge rules',
          icon: <BedDouble className="w-4 h-4" />,
          path: 'beds',
          keywords: ['ipd', 'bed', 'ward', 'admission', 'deposit', 'discharge'],
        },
      ],
    },
    {
      id: 'finance',
      label: 'Finance',
      description: 'Billing, payment, discount, due, refund controls',
      icon: <Wallet className="w-5 h-5" />,
      color: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
      items: [
        {
          id: 'billing-settings',
          label: 'Billing Settings',
          description: 'Invoice numbering, VAT, due, partial payment, refund rules',
          icon: <Receipt className="w-4 h-4" />,
          inline: 'billing-settings',
          badge: 'Sensitive',
          keywords: ['billing', 'invoice', 'number', 'currency', 'vat', 'due', 'refund', 'cancel'],
        },
        {
          id: 'payment-methods',
          label: 'Payment Methods',
          description: 'Cash, bKash, Nagad, Rocket, card, bank transfer',
          icon: <CreditCard className="w-4 h-4" />,
          path: 'settings/payments',
          badge: 'MVP',
          keywords: ['payment', 'cash', 'bkash', 'nagad', 'rocket', 'card', 'bank'],
        },
        {
          id: 'discount-rules',
          label: 'Discount Rules',
          description: 'Cashier limits, approval amount, mandatory reasons',
          icon: <AlertTriangle className="w-4 h-4" />,
          path: 'settings/discounts',
          badge: 'Sensitive',
          keywords: ['discount', 'approval', 'reason', 'cashier', 'permission'],
        },
        {
          id: 'cash-expense-controls',
          label: 'Cash Expense Controls',
          description: 'Expense approval threshold for petty cash and direct expenses',
          icon: <Wallet className="w-4 h-4" />,
          path: 'reception/cash-operations',
          badge: 'Sensitive',
          keywords: ['expense', 'cash', 'approval threshold', 'petty cash', 'md approval'],
        },
        {
          id: 'due-refund-rules',
          label: 'Due / Refund Rules',
          description: 'Due allowance, reminders, refund and cancellation policy',
          icon: <Wallet className="w-4 h-4" />,
          inline: 'billing-settings',
          badge: 'Sensitive',
          keywords: ['due', 'refund', 'cancel', 'invoice', 'approval'],
        },
      ],
    },
    {
      id: 'templates',
      label: 'Templates',
      description: 'Print, SMS, report and public templates',
      icon: <Printer className="w-5 h-5" />,
      color: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300',
      items: [
        {
          id: 'print-settings',
          label: 'Print Settings',
          description: 'Prescription, invoice, POS, token, lab report layouts',
          icon: <Printer className="w-4 h-4" />,
          path: 'print-templates',
          badge: 'MVP',
          keywords: ['print', 'template', 'prescription', 'invoice', 'token', 'lab report', 'test print'],
        },
        {
          id: 'sms-settings',
          label: 'SMS Settings',
          description: 'Gateway, sender ID, event templates, test SMS',
          icon: <Bell className="w-4 h-4" />,
          inline: 'sms-settings',
          keywords: ['sms', 'notification', 'gateway', 'template', 'sender', 'test sms'],
        },
        {
          id: 'email-settings',
          label: 'Email Settings',
          description: 'SMTP/Resend provider, email events, test email',
          icon: <Send className="w-4 h-4" />,
          path: 'settings/email',
          keywords: ['email', 'smtp', 'resend', 'notification', 'mail', 'test email'],
        },
        {
          id: 'report-templates',
          label: 'Report Templates',
          description: 'Report headers, export defaults, print behavior',
          icon: <FileText className="w-4 h-4" />,
          path: 'reports',
          keywords: ['report', 'template', 'export', 'print', 'pdf'],
        },
        {
          id: 'website-settings',
          label: 'Website Settings',
          description: 'Public booking page, SEO and online presence',
          icon: <Globe className="w-4 h-4" />,
          path: 'website',
          keywords: ['website', 'public', 'booking', 'seo'],
        },
      ],
    },
    {
      id: 'security',
      label: 'Security',
      description: 'Policy, sessions, audit trail, backup controls',
      icon: <Shield className="w-5 h-5" />,
      color: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
      items: [
        {
          id: 'security-settings',
          label: 'Security Settings',
          description: 'Password policy, session timeout, failed login limits',
          icon: <Lock className="w-4 h-4" />,
          path: 'settings/security',
          badge: 'Sensitive',
          keywords: ['security', 'password', 'session', 'login', 'ip', 'device'],
        },
        {
          id: 'mfa',
          label: 'Two-Factor Auth',
          description: 'Optional MFA for sensitive admin accounts',
          icon: <Key className="w-4 h-4" />,
          path: 'mfa',
          keywords: ['mfa', '2fa', 'otp', 'authenticator'],
        },
        {
          id: 'audit-log',
          label: 'Audit Log',
          description: 'Read-only trail for patient, billing, lab and settings changes',
          icon: <FileText className="w-4 h-4" />,
          path: 'system-audit',
          badge: 'MVP',
          keywords: ['audit', 'log', 'before', 'after', 'settings change', 'permission change'],
        },
        {
          id: 'backup',
          label: 'Backup',
          description: 'Manual backup, auto backup, download and restore guard',
          icon: <Database className="w-4 h-4" />,
          path: 'settings/backup',
          badge: 'Sensitive',
          keywords: ['backup', 'restore', 'download', 'data'],
        },
      ],
    },
    {
      id: 'system',
      label: 'System',
      description: 'Language, prefixes, reports, import and first setup',
      icon: <Settings className="w-5 h-5" />,
      color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
      items: [
        {
          id: 'system-preferences',
          label: 'System Preferences',
          description: 'Language, date format, timezone, currency, theme',
          icon: <Palette className="w-4 h-4" />,
          path: 'settings/preferences',
          keywords: ['language', 'date', 'time', 'currency', 'timezone', 'theme'],
        },
        {
          id: 'number-prefixes',
          label: 'System Prefix Settings',
          description: 'Patient, invoice, lab sample, prescription, admission prefixes',
          icon: <Hash className="w-4 h-4" />,
          path: 'settings/preferences',
          badge: 'MVP',
          keywords: ['prefix', 'patient id', 'invoice', 'lab sample', 'prescription', 'admission'],
        },
        {
          id: 'report-access',
          label: 'Report Access Control',
          description: 'Role-wise report view, export, print and phone masking',
          icon: <FileText className="w-4 h-4" />,
          path: 'permissions',
          keywords: ['report', 'access', 'export', 'excel', 'pdf', 'discount', 'profit'],
        },
        {
          id: 'import-export',
          label: 'Import / Export Settings',
          description: 'Bulk import services, medicines and patients via Excel',
          icon: <Download className="w-4 h-4" />,
          path: 'settings/import-export',
          keywords: ['import', 'export', 'excel', 'bulk', 'sample format'],
        },
        {
          id: 'setup-wizard',
          label: 'Setup Wizard',
          description: 'First-run hospital profile, departments, doctors, services, print',
          icon: <Settings className="w-4 h-4" />,
          path: 'setup',
          badge: 'Setup',
          keywords: ['setup', 'wizard', 'first run', 'template', 'onboarding'],
        },
      ],
    },
  ];
}

function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  hint,
  autoComplete,
}: {
  id: string;
  label: string;
  type?: string;
  value: string | number;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input
        id={id}
        aria-label={label}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="input"
      />
      {hint && <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

function TextAreaField({
  id,
  label,
  value,
  onChange,
  rows = 3,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <textarea
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className="input min-h-[88px] resize-y"
      />
      {hint && <p className="mt-1.5 text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

function SelectField<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ label: string; value: T }>;
}) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="input"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-[var(--color-border-light)] px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-[var(--color-text-primary)]">{label}</p>
        {hint && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]'}`}
      >
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'right-1' : 'left-1'}`} />
      </button>
    </div>
  );
}

function SettingsSaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard?: () => void;
}) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-4 z-20 rounded-xl border border-amber-200 bg-amber-50 p-3 shadow-lg dark:bg-amber-950/40 dark:border-amber-800">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-100">You have unsaved changes</p>
        <div className="flex gap-2">
          {onDiscard && (
            <button type="button" onClick={onDiscard} className="btn-secondary text-sm">Discard</button>
          )}
          <button type="button" onClick={onSave} disabled={saving} className="btn-primary text-sm">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PanelHeader({
  title,
  subtitle,
  onClose,
  icon,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  icon: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary-light)] text-[var(--color-primary)]">
          {icon}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Settings</p>
          <h2 className="section-title">{title}</h2>
          <p className="section-subtitle mt-1">{subtitle}</p>
        </div>
      </div>
      <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Close settings panel">
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

function HospitalHeaderPreview({
  info,
  logoUrl,
  mode,
}: {
  info: HospitalInfo;
  logoUrl: string | null;
  mode: 'invoice' | 'prescription';
}) {
  const hospitalName = info.name || getTenant()?.name || 'City Care Hospital';

  return (
    <aside className="card p-5 lg:sticky lg:top-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Live Header Preview</p>
          <h3 className="mt-1 text-base font-semibold text-[var(--color-text-primary)]">
            {mode === 'invoice' ? 'Invoice Header' : 'Prescription Header'}
          </h3>
        </div>
        <span className="badge-info">{mode === 'invoice' ? 'Invoice' : 'Rx'}</span>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900">
        <div className="flex items-start gap-3 border-b border-[var(--color-border)] pb-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-slate-50">
            {logoUrl ? (
              <img src={logoUrl} alt={`${hospitalName} logo`} className="h-full w-full object-contain" onError={() => undefined} />
            ) : (
              <ImageIcon className="h-6 w-6 text-[var(--color-text-muted)]" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-lg font-bold text-slate-900">{hospitalName}</p>
            {info.tagline && <p className="text-xs font-medium text-slate-600">{info.tagline}</p>}
            <p className="mt-1 text-xs text-slate-600">Address: {info.address || 'Dhaka, Bangladesh'}</p>
            <p className="text-xs text-slate-600">
              Phone: {info.phone || '01XXXXXXXXX'}{info.email ? ` | ${info.email}` : ''}
            </p>
            {info.registration_number && <p className="text-xs text-slate-500">License: {info.registration_number}</p>}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
          <div className="rounded border border-dashed border-slate-200 p-2">{mode === 'invoice' ? 'Bill To' : 'Patient'}</div>
          <div className="rounded border border-dashed border-slate-200 p-2 text-right">{mode === 'invoice' ? 'Invoice No.' : 'BMDC / Visit'}</div>
        </div>
      </div>

      <p className="mt-3 text-xs text-[var(--color-text-muted)]">
        Logo upload is previewed before print template changes, so onboarding staff can align invoice and prescription headers early.
      </p>
    </aside>
  );
}

function HospitalProfilePanel({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewMode, setPreviewMode] = useState<'invoice' | 'prescription'>('invoice');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [hospitalInfo, setHospitalInfo] = useState<HospitalInfo>({
    ...emptyHospitalInfo,
    name: getTenant()?.name ?? '',
  });

  const { data: settingsData } = useApiQuery<{
    settings?: Record<string, string>;
    hospital_info?: Partial<HospitalInfo>;
  }>(queryKeys.settings.all, '/api/settings');

  useEffect(() => {
    if (settingsData?.hospital_info) {
      setHospitalInfo((current) => ({ ...current, ...settingsData.hospital_info }));
    }
    const logo = settingsData?.settings?.hospital_logo_url;
    if (logo) setLogoUrl(`${logo}?t=${Date.now()}`);
  }, [settingsData]);

  const saveMutation = useApiMutation<unknown, { hospital_info: HospitalInfo }>('put', '/api/settings', {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
      toast.success('Hospital profile saved');
    },
    onError: () => toast.error('Failed to save hospital profile'),
  });

  const logoUploadMutation = useMutation<{ logo_url?: string }, Error, File>({
    mutationFn: async (file: File) => {
      const compressed = await compressImage(file, 400, 0.8);
      const formData = new FormData();
      formData.append('logo', compressed, file.name);
      const token = getToken();
      const slug = getTenantSlugFromPath();
      const headers: Record<string, string> = {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(slug ? { 'X-Tenant-Subdomain': slug } : {}),
      };
      const response = await fetch('/api/settings/logo', { method: 'POST', headers, body: formData });
      if (!response.ok) throw new Error('Logo upload failed');
      return response.json();
    },
    onSuccess: (data) => {
      const nextUrl = `${data.logo_url ?? '/api/settings/logo'}?t=${Date.now()}`;
      setLogoUrl(nextUrl);
      applyPwaIcons(nextUrl);
      applyDynamicManifest(nextUrl);
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
      toast.success('Logo uploaded');
    },
    onError: () => toast.error('Logo upload failed'),
    onSettled: () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const logoRemoveMutation = useApiMutation<void, void>('delete', '/api/settings/logo', {
    onSuccess: () => {
      setLogoUrl(null);
      applyPwaIcons(null);
      applyDynamicManifest(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all });
      toast.success('Logo removed');
    },
    onError: () => toast.error('Failed to remove logo'),
  });

  const updateInfo = (key: keyof HospitalInfo, value: string) => {
    setHospitalInfo((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="space-y-5" aria-label="Hospital Profile">
      <PanelHeader
        title="Hospital Profile"
        subtitle="Logo, address, license and print header identity"
        onClose={onClose}
        icon={<Building2 className="h-5 w-5" />}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="card p-5 space-y-5">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)] p-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-[var(--color-border)] bg-white">
                {logoUrl ? (
                  <img src={logoUrl} alt="Hospital logo" className="h-full w-full object-contain" onError={() => setLogoUrl(null)} />
                ) : (
                  <ImageIcon className="h-8 w-8 text-[var(--color-text-muted)]" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Logo Upload</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Compresses in the browser, stores the final asset in R2, and previews it here.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    ref={fileInputRef}
                    id="hospital-logo-upload"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) logoUploadMutation.mutate(file);
                    }}
                  />
                  <button type="button" onClick={() => fileInputRef.current?.click()} className="btn-secondary text-sm" disabled={logoUploadMutation.isPending}>
                    <Upload className="w-4 h-4" /> {logoUploadMutation.isPending ? 'Uploading...' : 'Upload Logo'}
                  </button>
                  {logoUrl && (
                    <button type="button" onClick={() => logoRemoveMutation.mutate(undefined as void)} className="btn-secondary text-sm text-red-600">
                      <Trash2 className="w-4 h-4" /> Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="hospital-name" label="Hospital / Clinic Name" value={hospitalInfo.name} onChange={(value) => updateInfo('name', value)} />
            <Field id="hospital-short-name" label="Short Name" value={hospitalInfo.short_name} onChange={(value) => updateInfo('short_name', value)} />
          </div>
          <TextAreaField id="hospital-address" label="Address" value={hospitalInfo.address} rows={2} onChange={(value) => updateInfo('address', value)} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="hospital-phone" label="Phone Number" type="tel" value={hospitalInfo.phone} onChange={(value) => updateInfo('phone', value)} />
            <Field id="hospital-email" label="Email" type="email" value={hospitalInfo.email} onChange={(value) => updateInfo('email', value)} />
            <Field id="hospital-website" label="Website" type="url" value={hospitalInfo.website} onChange={(value) => updateInfo('website', value)} />
            <Field id="hospital-license" label="License Number" value={hospitalInfo.registration_number} onChange={(value) => updateInfo('registration_number', value)} />
            <Field id="hospital-bin-tin" label="BIN / TIN" value={hospitalInfo.bin_tin} onChange={(value) => updateInfo('bin_tin', value)} />
            <Field id="hospital-slogan" label="Slogan / Tagline" value={hospitalInfo.tagline} onChange={(value) => updateInfo('tagline', value)} />
          </div>
          <TextAreaField id="hospital-footer" label="Slogan / Footer Text" value={hospitalInfo.footer_text} onChange={(value) => updateInfo('footer_text', value)} />

          <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] pt-4">
            <button type="button" onClick={() => saveMutation.mutate({ hospital_info: hospitalInfo })} disabled={saveMutation.isPending} className="btn-primary">
              <Save className="w-4 h-4" /> {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setPreviewMode('invoice')} className="btn-secondary">
              <Receipt className="w-4 h-4" /> Preview Invoice Header
            </button>
            <button type="button" onClick={() => setPreviewMode('prescription')} className="btn-secondary">
              <FileText className="w-4 h-4" /> Preview Prescription Header
            </button>
          </div>
        </div>

        <HospitalHeaderPreview info={hospitalInfo} logoUrl={logoUrl} mode={previewMode} />
      </div>
    </section>
  );
}

interface BillingSettingsData {
  invoice_prefix: string;
  invoice_reset: 'daily' | 'monthly' | 'yearly' | 'never';
  currency: string;
  decimal_allowed: boolean;
  vat_enabled: boolean;
  discount_enabled: boolean;
  due_allowed: boolean;
  partial_payment_allowed: boolean;
  refund_allowed: boolean;
  cancel_window_hours: number;
  cancel_reason_required: boolean;
  admin_approval_required: boolean;
  max_discount_amount: number;
  max_discount_percent: number;
  discount_reason_required: boolean;
  approval_required_above: number;
  due_opd_allowed: boolean;
  due_ipd_allowed: boolean;
  due_pharmacy_allowed: boolean;
}

function AccordionSection({
  title,
  description,
  children,
  defaultOpen = true,
}: {
  title: string;
  description: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white dark:bg-slate-900">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-sm font-semibold text-[var(--color-text-primary)]">{title}</span>
          <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{description}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="border-t border-[var(--color-border)] p-4">{children}</div>}
    </div>
  );
}

function BillingSettingsPanel({ onClose }: { onClose: () => void }) {
  const { values, update, save, dirty, setValues, loading, saving } = useSettingsForm<BillingSettingsData>({
    queryKey: ['settings', 'billing-control-room'],
    prefix: 'billing_',
    defaultValues: {
      invoice_prefix: 'INV',
      invoice_reset: 'monthly',
      currency: 'BDT',
      decimal_allowed: false,
      vat_enabled: false,
      discount_enabled: true,
      due_allowed: true,
      partial_payment_allowed: true,
      refund_allowed: false,
      cancel_window_hours: 24,
      cancel_reason_required: true,
      admin_approval_required: true,
      max_discount_amount: 500,
      max_discount_percent: 10,
      discount_reason_required: true,
      approval_required_above: 500,
      due_opd_allowed: true,
      due_ipd_allowed: true,
      due_pharmacy_allowed: false,
    },
  });

  const originalValues = useRef(values);
  useEffect(() => {
    if (!dirty) originalValues.current = values;
  }, [dirty, values]);

  return (
    <section className="space-y-5" aria-label="Billing Settings">
      <PanelHeader
        title="Billing Settings"
        subtitle="Invoice numbering, discount, due, refund and cancellation policies"
        onClose={onClose}
        icon={<Receipt className="h-5 w-5" />}
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Critical finance settings</p>
            <p className="mt-1 text-xs leading-5">
              Changes to due, refund, discount approval and invoice cancellation affect billing behavior. These changes must remain permission-protected and audit-logged on save.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => <div key={index} data-testid="skeleton" className="skeleton h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-3">
          <AccordionSection title="Invoice Number" description="Prefix, reset schedule, currency and decimal behavior">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field id="invoice-prefix" label="Invoice Prefix" value={values.invoice_prefix} onChange={(value) => update('invoice_prefix', value)} />
              <SelectField
                id="invoice-reset"
                label="Invoice Number Reset"
                value={values.invoice_reset}
                onChange={(value) => update('invoice_reset', value)}
                options={[
                  { label: 'Daily', value: 'daily' },
                  { label: 'Monthly', value: 'monthly' },
                  { label: 'Yearly', value: 'yearly' },
                  { label: 'Never', value: 'never' },
                ]}
              />
              <Field id="billing-currency" label="Currency" value={values.currency} onChange={(value) => update('currency', value)} />
              <ToggleRow label="Decimal Allowed" checked={values.decimal_allowed} onChange={(value) => update('decimal_allowed', value)} />
            </div>
          </AccordionSection>

          <AccordionSection title="Payment Methods" description="Primary payment controls are managed in Payment Methods">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {['Cash', 'bKash / Nagad / Rocket', 'Card / Bank Transfer'].map((method) => (
                <div key={method} className="rounded-lg border border-[var(--color-border-light)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{method}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">Open Payment Methods to set active status, transaction ID and charges.</p>
                </div>
              ))}
            </div>
          </AccordionSection>

          <AccordionSection title="Discount Rules" description="Cashier limits, approval threshold and mandatory reasons">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ToggleRow label="Discount Enabled" checked={values.discount_enabled} onChange={(value) => update('discount_enabled', value)} />
              <ToggleRow label="Discount Reason Mandatory" checked={values.discount_reason_required} onChange={(value) => update('discount_reason_required', value)} />
              <Field id="max-discount-amount" label="Max Discount Amount" type="number" value={values.max_discount_amount} onChange={(value) => update('max_discount_amount', Number(value))} />
              <Field id="max-discount-percent" label="Max Discount Percentage" type="number" value={values.max_discount_percent} onChange={(value) => update('max_discount_percent', Number(value))} />
              <Field id="approval-required-above" label="Approval Required Above" type="number" value={values.approval_required_above} onChange={(value) => update('approval_required_above', Number(value))} />
            </div>
          </AccordionSection>

          <AccordionSection title="Due Rules" description="Where due is allowed and whether partial payment can be accepted">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ToggleRow label="Due Allowed" checked={values.due_allowed} onChange={(value) => update('due_allowed', value)} hint="Turning this off blocks new due invoices but keeps old due records." />
              <ToggleRow label="Partial Payment Allowed" checked={values.partial_payment_allowed} onChange={(value) => update('partial_payment_allowed', value)} />
              <ToggleRow label="Due Allowed for OPD" checked={values.due_opd_allowed} onChange={(value) => update('due_opd_allowed', value)} />
              <ToggleRow label="Due Allowed for IPD" checked={values.due_ipd_allowed} onChange={(value) => update('due_ipd_allowed', value)} />
              <ToggleRow label="Due Allowed for Pharmacy" checked={values.due_pharmacy_allowed} onChange={(value) => update('due_pharmacy_allowed', value)} />
            </div>
          </AccordionSection>

          <AccordionSection title="Refund & Cancel Rules" description="Refund, invoice cancellation window, reasons and approval">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ToggleRow label="Refund Allowed" checked={values.refund_allowed} onChange={(value) => update('refund_allowed', value)} hint="Requires billing refund permission." />
              <ToggleRow label="Cancel Reason Mandatory" checked={values.cancel_reason_required} onChange={(value) => update('cancel_reason_required', value)} />
              <ToggleRow label="Admin Approval Required" checked={values.admin_approval_required} onChange={(value) => update('admin_approval_required', value)} />
              <Field id="cancel-window" label="Invoice Cancel Allowed Within Hours" type="number" value={values.cancel_window_hours} onChange={(value) => update('cancel_window_hours', Number(value))} />
            </div>
          </AccordionSection>

          <AccordionSection title="VAT / Tax" description="VAT enablement and receipt display controls">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ToggleRow label="VAT Enabled" checked={values.vat_enabled} onChange={(value) => update('vat_enabled', value)} />
              <div className="rounded-lg border border-[var(--color-border-light)] p-3">
                <p className="text-sm font-medium text-[var(--color-text-primary)]">Tax Source of Truth</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Service-specific VAT remains on the service catalog so historical invoices stay reproducible.</p>
              </div>
            </div>
          </AccordionSection>
        </div>
      )}

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={() => setValues(originalValues.current)}
      />
    </section>
  );
}

interface SmsSettingsData {
  provider_name: string;
  api_url: string;
  api_key: string;
  sender_id: string;
  balance_check_enabled: boolean;
  test_mobile: string;
  appointment_confirmation: boolean;
  payment_confirmation: boolean;
  lab_report_ready: boolean;
  due_reminder: boolean;
  followup_reminder: boolean;
  admission_confirmation: boolean;
  discharge_confirmation: boolean;
  appointment_template: string;
}

const smsVariables = ['{patient_name}', '{doctor_name}', '{date}', '{serial_no}', '{hospital_name}'];

function SmsSettingsPanel({ onClose }: { onClose: () => void }) {
  const { values, update, save, dirty, setValues, loading, saving } = useSettingsForm<SmsSettingsData>({
    queryKey: ['settings', 'sms-control-room'],
    prefix: 'sms_',
    defaultValues: {
      provider_name: '',
      api_url: '',
      api_key: '',
      sender_id: '',
      balance_check_enabled: false,
      test_mobile: '',
      appointment_confirmation: true,
      payment_confirmation: true,
      lab_report_ready: true,
      due_reminder: false,
      followup_reminder: false,
      admission_confirmation: true,
      discharge_confirmation: true,
      appointment_template: 'Dear {patient_name}, your appointment with {doctor_name} is on {date}. Serial {serial_no}. - {hospital_name}',
    },
  });
  const originalValues = useRef(values);
  useEffect(() => {
    if (!dirty) originalValues.current = values;
  }, [dirty, values]);

  const sendTestSms = () => {
    toast.success('Test SMS request queued');
  };

  return (
    <section className="space-y-5" aria-label="SMS Settings">
      <PanelHeader
        title="SMS Settings"
        subtitle="Gateway, sender ID, event templates and test SMS"
        onClose={onClose}
        icon={<Bell className="h-5 w-5" />}
      />

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => <div key={index} data-testid="skeleton" className="skeleton h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            <div className="card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">SMS Gateway Setup</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="sms-provider-name" label="Provider Name" value={values.provider_name} onChange={(value) => update('provider_name', value)} />
                <Field id="sms-sender-id" label="Sender ID" value={values.sender_id} onChange={(value) => update('sender_id', value)} />
                <Field id="sms-api-url" label="API URL" value={values.api_url} onChange={(value) => update('api_url', value)} />
                <Field id="sms-api-key" label="API Key" type="password" value={values.api_key} onChange={(value) => update('api_key', value)} autoComplete="off" />
                <Field id="sms-test-mobile" label="Test Mobile Number" value={values.test_mobile} onChange={(value) => update('test_mobile', value)} placeholder="01XXXXXXXXX" />
                <ToggleRow label="Balance Check Enabled" checked={values.balance_check_enabled} onChange={(value) => update('balance_check_enabled', value)} />
              </div>
            </div>

            <div className="card p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">SMS Events</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ToggleRow label="Appointment Confirmation" checked={values.appointment_confirmation} onChange={(value) => update('appointment_confirmation', value)} />
                <ToggleRow label="Payment Confirmation" checked={values.payment_confirmation} onChange={(value) => update('payment_confirmation', value)} />
                <ToggleRow label="Lab Report Ready" checked={values.lab_report_ready} onChange={(value) => update('lab_report_ready', value)} />
                <ToggleRow label="Due Reminder" checked={values.due_reminder} onChange={(value) => update('due_reminder', value)} />
                <ToggleRow label="Follow-up Reminder" checked={values.followup_reminder} onChange={(value) => update('followup_reminder', value)} />
                <ToggleRow label="Admission Confirmation" checked={values.admission_confirmation} onChange={(value) => update('admission_confirmation', value)} />
                <ToggleRow label="Discharge Confirmation" checked={values.discharge_confirmation} onChange={(value) => update('discharge_confirmation', value)} />
              </div>
            </div>

            <div className="card p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Available Variables</p>
                {smsVariables.map((variable) => (
                  <span key={variable} className="rounded-full bg-[var(--color-primary-light)] px-2.5 py-1 text-xs font-medium text-[var(--color-primary-dark)]">
                    {variable}
                  </span>
                ))}
              </div>
              <TextAreaField
                id="appointment-template"
                label="Appointment Template"
                value={values.appointment_template}
                onChange={(value) => update('appointment_template', value)}
                rows={4}
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={save} disabled={saving} className="btn-primary">
                  <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Template'}
                </button>
                <button type="button" onClick={sendTestSms} className="btn-secondary">
                  <Send className="w-4 h-4" /> Send Test SMS
                </button>
              </div>
            </div>
          </div>

          <aside className="card p-5 lg:sticky lg:top-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Template Preview</p>
            <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-white p-4 text-sm leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-100">
              {values.appointment_template
                .replace(/\{patient_name\}/g, 'Rahim Uddin')
                .replace(/\{doctor_name\}/g, 'Dr. Ayesha Karim')
                .replace(/\{date\}/g, '29-05-2026')
                .replace(/\{serial_no\}/g, 'OPD-014')
                .replace(/\{hospital_name\}/g, getTenant()?.name ?? 'City Care Hospital')}
            </div>
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">Variables keep SMS templates reusable without storing patient-specific text in settings.</p>
          </aside>
        </div>
      )}

      <SettingsSaveBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={() => setValues(originalValues.current)}
      />
    </section>
  );
}

export default function SettingsPage({
  role = 'hospital_admin',
  initialPanel = null,
}: {
  role?: string;
  initialPanel?: InlinePanelId | null;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug ?? ''}`;
  const [search, setSearch] = useState('');
  const [inlinePanel, setInlinePanel] = useState<InlinePanelId | null>(initialPanel);
  const categories = useSettingsCategories();

  useEffect(() => {
    setInlinePanel(initialPanel);
  }, [initialPanel]);

  const flattenedItems = useMemo(() => (
    categories.flatMap((category) => category.items.map((item) => ({ category, item })))
  ), [categories]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return flattenedItems;
    return flattenedItems.filter(({ category, item }) => {
      const haystack = [
        category.label,
        category.description,
        item.label,
        item.description,
        ...item.keywords,
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }, [flattenedItems, search]);

  const filteredCategories = useMemo(() => {
    if (!search.trim()) return categories;
    return categories
      .map((category) => ({
        ...category,
        items: filteredItems.filter((entry) => entry.category.id === category.id).map((entry) => entry.item),
      }))
      .filter((category) => category.items.length > 0);
  }, [categories, filteredItems, search]);

  const openItem = (item: SettingsItem) => {
    if (item.inline) {
      setInlinePanel(item.inline);
      return;
    }
    if (item.path) {
      navigate(item.path.startsWith('/') ? item.path : `${base}/${item.path}`);
    }
  };

  const closePanel = () => setInlinePanel(null);

  const panel = inlinePanel === 'hospital-profile'
    ? <HospitalProfilePanel onClose={closePanel} />
    : inlinePanel === 'billing-settings'
      ? <BillingSettingsPanel onClose={closePanel} />
      : inlinePanel === 'sms-settings'
        ? <SmsSettingsPanel onClose={closePanel} />
        : null;

  if (panel) {
    return (
      <DashboardLayout role={role}>
        <div className="mx-auto max-w-6xl space-y-5">
          <button type="button" onClick={closePanel} className="btn-ghost text-sm">
            <ChevronRight className="h-4 w-4 rotate-180" /> Admin Settings
          </button>
          {panel}
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role={role}>
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Admin Control Room</p>
            <h1 className="page-title">{t('adminSettingsTitle', { defaultValue: 'Admin Settings' })}</h1>
            <p className="section-subtitle mt-1">
              Configure hospital identity, access, billing, print, audit, backup and operating workflows from one place.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[24rem]">
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-3 dark:bg-slate-900">
              <p className="text-lg font-semibold text-[var(--color-text-primary)]">13</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">MVP controls</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-3 dark:bg-slate-900">
              <p className="text-lg font-semibold text-amber-600">6</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">Sensitive zones</p>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-white p-3 dark:bg-slate-900">
              <p className="text-lg font-semibold text-emerald-600">7</p>
              <p className="text-[11px] text-[var(--color-text-muted)]">Categories</p>
            </div>
          </div>
        </header>

        <div className="relative max-w-2xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search settings... invoice, doctor fee, sms, bed charge, permission"
            className="input pl-10 pr-10"
            aria-label="Search settings"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-border-light)] hover:text-[var(--color-text-primary)]"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {search.trim() && (
          <section className="card p-4" aria-label="Search results">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Search results</h2>
                <p className="text-xs text-[var(--color-text-muted)]">{filteredItems.length} matching settings</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {filteredItems.map(({ category, item }) => (
                <button
                  key={`${category.id}-${item.id}`}
                  type="button"
                  onClick={() => openItem(item)}
                  className="rounded-lg border border-[var(--color-border)] p-3 text-left transition hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)]"
                >
                  <p className="text-xs font-semibold text-[var(--color-primary)]">{category.label} &gt; {item.label}</p>
                  <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{item.description}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {filteredCategories.length === 0 ? (
          <div className="card p-10 text-center">
            <Search className="mx-auto mb-3 h-10 w-10 text-[var(--color-text-muted)]" />
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">No settings found</p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Try another keyword such as invoice, sms, doctor, permission or backup.</p>
          </div>
        ) : (
          filteredCategories.map((category) => (
            <section key={category.id} className="space-y-3" aria-labelledby={`${category.id}-settings-heading`}>
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${category.color}`}>{category.icon}</div>
                <div>
                  <h2 id={`${category.id}-settings-heading`} className="text-base font-semibold text-[var(--color-text-primary)]">{category.label}</h2>
                  <p className="text-xs text-[var(--color-text-muted)]">{category.description}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {category.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-label={item.label}
                    onClick={() => openItem(item)}
                    className="card group min-h-[118px] p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
                  >
                    <div className="flex h-full items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-border-light)] text-[var(--color-text-muted)] transition-colors group-hover:bg-[var(--color-primary-light)] group-hover:text-[var(--color-primary)]">
                        {item.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{item.label}</p>
                          {item.badge && (
                            <span className={item.badge === 'Sensitive' ? 'badge-warning text-[10px]' : item.badge === 'MVP' ? 'badge-success text-[10px]' : 'badge-info text-[10px]'}>
                              {item.badge}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-text-muted)]">{item.description}</p>
                        <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-primary)] opacity-0 transition-opacity group-hover:opacity-100">
                          Open Settings <ChevronRight className="h-3.5 w-3.5" />
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}
