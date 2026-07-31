import { Link, useLocation, useParams } from 'react-router';
import {
  LayoutDashboard, Users, FlaskConical, Receipt, Pill, Package,
  UserCog, PieChart, Settings, LogOut, Menu, X,
  Building2, Wallet, TrendingUp, TrendingDown, Repeat,
  BookOpen, FileText, Video, ChevronDown, ChevronRight,
  BedDouble, Stethoscope, Calendar, Shield, ClipboardList,
  Globe, Siren, Scissors, Heart, ShieldAlert, ArrowRightLeft, HeartPulse, PanelLeftClose, PanelLeftOpen,
  XCircle, Handshake, CreditCard, Layers, Beaker, BarChart3, MessageSquare, HelpCircle, Briefcase, Brain, Scan, ShoppingCart, AlertTriangle, RefreshCw, Syringe,
  Fingerprint, CalendarDays, Ticket, Eye, Mic, Activity, Baby, Star, CheckCircle, FileCheck, Percent, ShieldCheck,
  ClipboardCheck, CornerDownLeft, Factory, FileUp, Gift,
  Bell, UserCircle, Database, Printer, Mail, DollarSign,
  Landmark,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeRole } from '@shared/authz';
import { usePrefetch } from '../../hooks/usePrefetch';
import { apiFetch } from '../../lib/apiClient';
import { getTenant } from '../../hooks/useAuth';
import { adminNavGroups } from './adminSidebarConfig';
import { isGroupVisible } from './adminRoleAccess';

interface SidebarProps {
  role: string;
  permissions: string[];
  onLogout: () => void;
}

/** Nav item definition */
export interface NavItem {
  labelKey: string;
  path?: string;
  icon: React.ReactNode;
  /** Permission string required to see this item (e.g. 'patients:read'). If omitted, always visible. */
  requiredPermission?: string;
  children?: NavItem[];
  /** Optional dynamic badge count */
  badge?: number;
}

/** Group of nav items with an optional section label */
export interface NavGroup {
  groupKey?: string; // i18n key for the section label (optional)
  items: NavItem[];
}

/** Items appended to every role's sidebar as a common footer. */
const COMMON_FOOTER_ITEMS: NavItem[] = [
  { labelKey: 'profile', path: 'profile', icon: <UserCircle className="w-4.5 h-4.5" /> },
];

/**
 * Sidebar nav items use paths RELATIVE to `/h/:slug/`.
 * The component reads `slug` from route params and prefixes every link.
 */
function SidebarBase({ role, permissions, onLogout }: SidebarProps) {
  const normalizedRole = normalizeRole(role) || role;
  const location = useLocation();
  const { slug } = useParams<{ slug: string }>();
  const [isOpen, setIsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('hms.sidebar.collapsed') === 'true';
  });
  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem('hms.sidebar.collapsed', String(next));
      return next;
    });
  };
  const { t } = useTranslation('sidebar');
  const navRef = useRef<HTMLElement | null>(null);

  const base = `/h/${slug}`;

  const [hospitalName, setHospitalName] = useState(() => getTenant()?.name ?? 'Ozzyl Health');
  const [hospitalLogo, setHospitalLogo] = useState<string | null>(null);
  const sidebarScope = `${role}:${slug ?? 'default'}`;
  const accordionStorageKey = useMemo(() => `hms.sidebar.accordions:${sidebarScope}`, [sidebarScope]);
  const scrollStorageKey = useMemo(() => `hms.sidebar.scroll:${sidebarScope}`, [sidebarScope]);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.sessionStorage.getItem(`hms.sidebar.accordions:${role}:${slug ?? 'default'}`);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // ── Prefetch on hover ──────────────────────────────────────────────────────
  const prefetch = usePrefetch();
  const prefetchedRef = useRef(new Set<string>());

  /** Map of relative nav paths to their prefetch config [queryKey[], apiUrl] */
  const prefetchMap: Record<string, [string[], string]> = useMemo(
    () => ({
      patients:               [['patients', 'list'], '/api/patients?page=1&limit=20'],
      billing:                [['billing', 'list'], '/api/billing?page=1'],
      'billing-counter':       [['billing-counter', 'services', '', ''], '/api/billing-counter/service-items?limit=12'],
      pharmacy:               [['pharmacy', 'medicines'], '/api/pharmacy/medicines'],
      tests:                  [['lab', 'list'], '/api/lab'],
      appointments:           [['appointments', 'list'], '/api/appointments'],
      'reception/patients':   [['patients', 'list'], '/api/patients?page=1&limit=20'],
      'reception/billing':    [['billing', 'list'], '/api/billing?page=1'],
      'reception/billing-counter': [['billing-counter', 'services', '', ''], '/api/billing-counter/service-items?limit=12'],
      'reception/appointments': [['appointments', 'list'], '/api/appointments'],
    }),
    [],
  );

  const handlePrefetch = (relativePath: string) => {
    if (prefetchedRef.current.has(relativePath)) return;
    const config = prefetchMap[relativePath];
    if (config) {
      prefetchedRef.current.add(relativePath);
      prefetch(config[0], config[1]);
    }
  };

  /** Check if user has required permission */
  const hasPermission = (perm?: string): boolean => {
    if (!perm) return true; // no permission required → always visible
    if (normalizedRole === 'hospital_admin' || normalizedRole === 'super_admin') return true;
    if (permissions.includes('*')) return true; // wildcard → full access
    return permissions.includes(perm);
  };

  useEffect(() => {
    if (hospitalName !== 'Ozzyl Health') return;
    apiFetch<{ hospital_info?: { name?: string }; hospital_logo_url?: string }>('/api/settings')
      .then((data) => {
        const name = data.hospital_info?.name?.trim();
        if (name) {
          setHospitalName(name);
          const current = getTenant() ?? {};
          localStorage.setItem('tenant', JSON.stringify({ ...current, name }));
        }
        if (data.hospital_logo_url) setHospitalLogo(data.hospital_logo_url);
      })
      .catch(() => {
        // Keep product fallback if tenant metadata is unavailable.
      });
  }, [hospitalName]);

  const filterNavItems = (items: NavItem[]): NavItem[] =>
    items.flatMap((item) => {
      if (item.children?.length) {
        const children = filterNavItems(item.children);
        if (children.length === 0) return [];
        return [{ ...item, children }];
      }

      return hasPermission(item.requiredPermission) ? [item] : [];
    });

  // ── Role-based grouped nav ────────────────────────────────────────────────
  const roleNavGroups: Record<string, NavGroup[]> = {
    super_admin: [
      {
        groupKey: 'groupPlatform',
        items: [
          { labelKey: 'dashboard',      path: '/super-admin/dashboard',       icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
          { labelKey: 'platformHealth', path: '/super-admin/health',          icon: <Heart className="w-4.5 h-4.5" /> },
          { labelKey: 'platformStaff',  path: '/super-admin/platform-staff', icon: <UserCog className="w-4.5 h-4.5" /> },
        ],
      },
      {
        groupKey: 'groupHospitals',
        items: [
          { labelKey: 'hospitals',       path: '/super-admin/hospitals',  icon: <Building2 className="w-4.5 h-4.5" />, requiredPermission: 'hospitals:read' },
          { labelKey: 'onboardingQueue', path: '/super-admin/onboarding', icon: <ClipboardList className="w-4.5 h-4.5" />, requiredPermission: 'hospitals:read' },
        ],
      },
      {
        groupKey: 'groupSystem',
        items: [
          { labelKey: 'auditLog',  path: '/super-admin/audit-log', icon: <Shield className="w-4.5 h-4.5" />, requiredPermission: 'audit:read' },
          { labelKey: 'settings',  path: '/super-admin/settings',  icon: <Settings className="w-4.5 h-4.5" />, requiredPermission: 'settings:read' },
        ],
      },
    ],
    platform_admin: [
      {
        groupKey: 'groupPlatform',
        items: [
          { labelKey: 'platformStaff', path: '/super-admin/platform-staff', icon: <UserCog className="w-4.5 h-4.5" /> },
        ],
      },
    ],
    platform_setup: [
      {
        groupKey: 'groupPlatform',
        items: [
          { labelKey: 'platformStaff', path: '/super-admin/platform-staff', icon: <Stethoscope className="w-4.5 h-4.5" /> },
        ],
      },
    ],
    platform_support: [
      {
        groupKey: 'groupPlatform',
        items: [
          { labelKey: 'platformStaff', path: '/super-admin/platform-staff', icon: <Stethoscope className="w-4.5 h-4.5" /> },
        ],
      },
    ],
    platform_auditor: [
      {
        groupKey: 'groupPlatform',
        items: [
          { labelKey: 'platformStaff', path: '/super-admin/platform-staff', icon: <UserCog className="w-4.5 h-4.5" /> },
        ],
      },
    ],
    hospital_admin: adminNavGroups,
    laboratory: [
      {
        items: [
          { labelKey: 'dashboard', path: 'lab/dashboard', icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
          { labelKey: 'tests', path: 'lab/tests', icon: <FlaskConical className="w-4.5 h-4.5" />, requiredPermission: 'tests:read' },
          { labelKey: 'reagentControl', path: 'lab/monitoring', icon: <Activity className="w-4.5 h-4.5" />, requiredPermission: 'lab_machines:read' },
          { labelKey: 'advancedLabSettings', path: 'lab/settings', icon: <Settings className="w-4.5 h-4.5" />, requiredPermission: 'lab_machines:write' },
        ],
      },
    ],
    reception: [
      {
        groupKey: 'groupOperations',
        items: [
          { labelKey: 'dailyDesk', path: 'reception/dashboard', icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
          { labelKey: 'opdSerial', path: 'reception/appointments', icon: <Calendar className="w-4.5 h-4.5" />, requiredPermission: 'appointments:read' },
          { labelKey: 'billingCounter', path: 'reception/billing-counter', icon: <CreditCard className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'cashOperations', path: 'reception/cash-operations', icon: <Wallet className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'admissions', path: 'reception/admissions', icon: <Briefcase className="w-4.5 h-4.5" />, requiredPermission: 'admissions:read' },
          { labelKey: 'reportDelivery', path: 'reception/reports', icon: <BarChart3 className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'shiftReportPrint', path: 'reception/reports/pdf?report=shiftHandover', icon: <Printer className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'doctorStatus', path: 'reception/doctor-status', icon: <Stethoscope className="w-4.5 h-4.5" />, requiredPermission: 'appointments:read' },
          {
            labelKey: 'moreAdvanced',
            icon: <Layers className="w-4.5 h-4.5" />,
            children: [
              { labelKey: 'patients', path: 'reception/patients', icon: <Users className="w-4.5 h-4.5" />, requiredPermission: 'patients:read' },
              { labelKey: 'opdQueue', path: 'reception/queue', icon: <Ticket className="w-4.5 h-4.5" />, requiredPermission: 'appointments:read' },
              { labelKey: 'billing', path: 'reception/billing', icon: <Receipt className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
              { labelKey: 'patientCardScan', path: 'reception/patient-card-scan', icon: <Scan className="w-4.5 h-4.5" />, requiredPermission: 'patients:read' },
              { labelKey: 'onlineApprovals', path: 'reception/online-approvals', icon: <CheckCircle className="w-4.5 h-4.5" />, requiredPermission: 'appointments:read' },
              { labelKey: 'deposits', path: 'reception/deposits', icon: <Wallet className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
              { labelKey: 'creditNotes', path: 'reception/credit-notes', icon: <RefreshCw className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
              { labelKey: 'settlements', path: 'reception/settlements', icon: <Handshake className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
              { labelKey: 'billHandover', path: 'reception/billing-handover', icon: <ArrowRightLeft className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
              { labelKey: 'provisionalBilling', path: 'reception/billing-provisional', icon: <FileText className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
              { labelKey: 'payments', path: 'reception/payments', icon: <CreditCard className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
              { labelKey: 'insurance', path: 'reception/insurance', icon: <ShieldAlert className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
              { labelKey: 'beds', path: 'reception/beds', icon: <BedDouble className="w-4.5 h-4.5" />, requiredPermission: 'beds:read' },
              { labelKey: 'ipBilling', path: 'reception/ip-billing', icon: <BedDouble className="w-4.5 h-4.5" />, requiredPermission: 'ip-billing:read' },
              { labelKey: 'deathRecords', path: 'reception/death-records', icon: <ShieldAlert className="w-4.5 h-4.5" />, requiredPermission: 'patients:read' },
              { labelKey: 'bloodBank', path: 'reception/blood-bank', icon: <Heart className="w-4.5 h-4.5" />, requiredPermission: 'blood_bank:read' },
              { labelKey: 'ambulance', path: 'reception/ambulance', icon: <Siren className="w-4.5 h-4.5" />, requiredPermission: 'ambulance:read' },
            ],
          },
          { labelKey: 'helpCenter', path: 'reception/help', icon: <HelpCircle className="w-4.5 h-4.5" /> },
        ],
      },
    ],
    manager: [
      {
        groupKey: 'groupOperations',
        items: [
          { labelKey: 'managerOverview', path: 'manager/dashboard', icon: <LayoutDashboard className="w-4.5 h-4.5" />, requiredPermission: 'dashboard:read' },
          { labelKey: 'patients', path: 'reception/patients', icon: <Users className="w-4.5 h-4.5" />, requiredPermission: 'patients:read' },
          { labelKey: 'opdSerial', path: 'reception/appointments', icon: <Calendar className="w-4.5 h-4.5" />, requiredPermission: 'appointments:read' },
          { labelKey: 'billingCounter', path: 'reception/billing-counter', icon: <CreditCard className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'cashOperations', path: 'reception/cash-operations', icon: <Wallet className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
        ],
      },
      {
        groupKey: 'groupLaboratory',
        items: [
          { labelKey: 'labDashboard', path: 'lab/dashboard', icon: <FlaskConical className="w-4.5 h-4.5" />, requiredPermission: 'tests:read' },
          { labelKey: 'labOrders', path: 'lab/orders', icon: <FlaskConical className="w-4.5 h-4.5" />, requiredPermission: 'tests:write' },
          { labelKey: 'reagentControl', path: 'lab/monitoring', icon: <Activity className="w-4.5 h-4.5" />, requiredPermission: 'lab_machines:read' },
        ],
      },
      {
        groupKey: 'groupReportsAnalytics',
        items: [
          { labelKey: 'reportDelivery', path: 'reception/reports', icon: <BarChart3 className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
        ],
      },
    ],
    md: [
      {
        items: [
          { labelKey: 'dashboard',  path: 'md/dashboard',  icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
          { labelKey: 'pendingApprovals', path: 'md/pending-approvals', icon: <ShieldCheck className="w-4.5 h-4.5" /> },
          { labelKey: 'accounting', path: 'md/accounting', icon: <Wallet          className="w-4.5 h-4.5" />, requiredPermission: 'accounting:read' },
          { labelKey: 'income',     path: 'md/income',     icon: <TrendingUp      className="w-4.5 h-4.5" />, requiredPermission: 'income:read' },
          { labelKey: 'expenses',   path: 'md/expenses',   icon: <TrendingDown    className="w-4.5 h-4.5" />, requiredPermission: 'expenses:read' },
          { labelKey: 'recurring',  path: 'md/recurring',  icon: <Repeat          className="w-4.5 h-4.5" />, requiredPermission: 'expenses:read' },
          { labelKey: 'accounts',   path: 'md/accounts',   icon: <BookOpen        className="w-4.5 h-4.5" />, requiredPermission: 'accounting:read' },
          { labelKey: 'fiscalYearSettings', path: 'md/fiscal-year-settings', icon: <Calendar className="w-4.5 h-4.5" />, requiredPermission: 'fiscalYear:write' },
          { labelKey: 'voucherVerification', path: 'md/voucher-verification', icon: <FileCheck className="w-4.5 h-4.5" />, requiredPermission: 'voucher:verify' },
          { labelKey: 'reports',    path: 'md/reports',     icon: <PieChart        className="w-4.5 h-4.5" />, requiredPermission: 'reports:read' },
          { labelKey: 'discountReview', path: 'md/discounts', icon: <Percent className="w-4.5 h-4.5" />, requiredPermission: 'reports:read' },
          { labelKey: 'reagentControl', path: 'lab/monitoring', icon: <Activity className="w-4.5 h-4.5" />, requiredPermission: 'lab_machines:read' },
          { labelKey: 'audit',      path: 'md/audit',       icon: <FileText        className="w-4.5 h-4.5" />, requiredPermission: 'audit:read' },
          { labelKey: 'staff',      path: 'md/staff',       icon: <UserCog         className="w-4.5 h-4.5" />, requiredPermission: 'staff:read' },
          { labelKey: 'hrPayroll',  path: 'md/hr',          icon: <Briefcase        className="w-4.5 h-4.5" />, requiredPermission: 'hr:read' },
          { labelKey: 'leaveManagement', path: 'md/hr/leave', icon: <Calendar       className="w-4.5 h-4.5" />, requiredPermission: 'hr:read' },
          { labelKey: 'profit',     path: 'md/profit',      icon: <TrendingUp      className="w-4.5 h-4.5" />, requiredPermission: 'profit:calculate' },
          { labelKey: 'helpCenter', path: 'md/help',        icon: <HelpCircle      className="w-4.5 h-4.5" /> },
        ],
      },
    ],
    director: [
      {
        items: [
          { labelKey: 'dashboard',    path: 'director/dashboard',    icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
          { labelKey: 'pendingApprovals', path: 'director/pending-approvals', icon: <ShieldCheck className="w-4.5 h-4.5" /> },
          { labelKey: 'accounting',   path: 'director/accounting',   icon: <Wallet          className="w-4.5 h-4.5" />, requiredPermission: 'accounting:read' },
          { labelKey: 'income',       path: 'director/income',       icon: <TrendingUp      className="w-4.5 h-4.5" />, requiredPermission: 'income:read' },
          { labelKey: 'expenses',     path: 'director/expenses',     icon: <TrendingDown    className="w-4.5 h-4.5" />, requiredPermission: 'expenses:read' },
          { labelKey: 'fiscalYearSettings', path: 'director/fiscal-year-settings', icon: <Calendar className="w-4.5 h-4.5" />, requiredPermission: 'fiscalYear:write' },
          { labelKey: 'voucherVerification', path: 'director/voucher-verification', icon: <FileCheck className="w-4.5 h-4.5" />, requiredPermission: 'voucher:verify' },
          { labelKey: 'reports',      path: 'director/reports',      icon: <PieChart        className="w-4.5 h-4.5" />, requiredPermission: 'reports:read' },
          { labelKey: 'discountReview', path: 'director/discounts', icon: <Percent className="w-4.5 h-4.5" />, requiredPermission: 'reports:read' },
          { labelKey: 'reagentControl', path: 'lab/monitoring', icon: <Activity className="w-4.5 h-4.5" />, requiredPermission: 'lab_machines:read' },
          { labelKey: 'audit',        path: 'director/audit',        icon: <FileText        className="w-4.5 h-4.5" />, requiredPermission: 'audit:read' },
          { labelKey: 'shareholders', path: 'director/shareholders', icon: <Users           className="w-4.5 h-4.5" />, requiredPermission: 'shareholders:read' },
          { labelKey: 'profit',       path: 'director/profit',       icon: <TrendingUp      className="w-4.5 h-4.5" />, requiredPermission: 'profit:calculate' },
          { labelKey: 'settings',     path: 'director/settings',     icon: <Settings        className="w-4.5 h-4.5" />, requiredPermission: 'settings:read' },
          { labelKey: 'helpCenter',   path: 'director/help',         icon: <HelpCircle      className="w-4.5 h-4.5" /> },
        ],
      },
    ],
    pharmacist: [
      {
        groupKey: 'Pharmacy',
        items: [
          { labelKey: 'dashboard',       path: 'pharmacy/dashboard',   icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
          { labelKey: 'invoices',        path: 'pharmacy/invoices',    icon: <Receipt          className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:read' },
          { labelKey: 'prescriptions',   path: 'pharmacy/prescriptions', icon: <ClipboardList  className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:read' },
        ],
      },
      {
        groupKey: 'Procurement',
        items: [
          { labelKey: 'purchaseOrders',  path: 'pharmacy/po',          icon: <ShoppingCart     className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:write' },
          { labelKey: 'goodsReceipts',   path: 'pharmacy/grn',         icon: <Package          className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:write' },
          { labelKey: 'suppliers',       path: 'pharmacy/suppliers',   icon: <Handshake        className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:read' },
        ],
      },
      {
        groupKey: 'Inventory',
        items: [
          { labelKey: 'stock',           path: 'pharmacy/stock',       icon: <Layers           className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:read' },
          { labelKey: 'items',           path: 'pharmacy/items',       icon: <Pill             className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:read' },
          { labelKey: 'writeOffs',       path: 'pharmacy/write-offs',  icon: <XCircle          className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:write' },
          { labelKey: 'dispatches',      path: 'pharmacy/dispatches',  icon: <ArrowRightLeft   className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:write' },
          { labelKey: 'narcoticRegister', path: 'pharmacy/narcotics',  icon: <ShieldAlert      className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:read' },
        ],
      },
      {
        groupKey: 'Finance',
        items: [
          { labelKey: 'deposits',        path: 'pharmacy/deposits',    icon: <Wallet           className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:read' },
          { labelKey: 'settlements',     path: 'pharmacy/settlements', icon: <CreditCard       className="w-4.5 h-4.5" />, requiredPermission: 'pharmacy:read' },
          { labelKey: 'helpCenter',      path: 'pharmacy/help',        icon: <HelpCircle       className="w-4.5 h-4.5" /> },
        ],
      },
    ],
    doctor: [
      {
        groupKey: 'groupOperations',
        items: [
          { labelKey: 'dashboard',       path: 'doctor/dashboard',    icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
        ],
      },
      {
        groupKey: 'groupClinical',
        items: [
          { labelKey: 'patients', path: 'patients', icon: <Users className="w-4.5 h-4.5" />, requiredPermission: 'patients:read' },
          { labelKey: 'labResults', path: 'doctor/lab-results', icon: <ClipboardList className="w-4.5 h-4.5" /> },
          { labelKey: 'reportReview', path: 'doctor/report-review', icon: <ClipboardList className="w-4.5 h-4.5" /> },
          { labelKey: 'prescriptions', path: 'prescriptions/new', icon: <ClipboardList className="w-4.5 h-4.5" />, requiredPermission: 'prescriptions:write' },
          { labelKey: 'schedule', path: 'doctor-schedule', icon: <ClipboardList className="w-4.5 h-4.5" /> },
          { labelKey: 'certificates', path: 'doctor/certificates', icon: <ClipboardList className="w-4.5 h-4.5" /> },
          { labelKey: 'referrals', path: 'doctor/referrals', icon: <Users className="w-4.5 h-4.5" /> },
          { labelKey: 'profile', path: 'doctor/profile', icon: <Users className="w-4.5 h-4.5" /> },
          { labelKey: 'telemedicine', path: 'telemedicine', icon: <Video className="w-4.5 h-4.5" />, requiredPermission: 'telemedicine:read' },
        ],
      },
      {
        groupKey: 'groupSupport',
        items: [
          { labelKey: 'helpCenter', path: 'help', icon: <HelpCircle className="w-4.5 h-4.5" /> },
        ],
      },
    ],
    nurse: [
      {
        groupKey: 'groupWardsOt',
        items: [
          { labelKey: 'nurseStation', path: 'nurse-station', icon: <Stethoscope className="w-4.5 h-4.5" />, requiredPermission: 'nursing:read' },
          { labelKey: 'nurseTasks', path: 'nurse-tasks', icon: <ClipboardCheck className="w-4.5 h-4.5" />, requiredPermission: 'nursing:read' },
          { labelKey: 'nurseWorkload', path: 'nurse-workload', icon: <Users className="w-4.5 h-4.5" />, requiredPermission: 'nursing:read' },
          { labelKey: 'nursing', path: 'nursing', icon: <HeartPulse className="w-4.5 h-4.5" />, requiredPermission: 'nursing:read' },
          { labelKey: 'nurseReports', path: 'nurse-reports', icon: <BarChart3 className="w-4.5 h-4.5" />, requiredPermission: 'nursing:read' },
          { labelKey: 'admissionsOverview', path: 'admissions', icon: <BedDouble className="w-4.5 h-4.5" />, requiredPermission: 'admissions:read' },
          { labelKey: 'beds', path: 'beds', icon: <ClipboardList className="w-4.5 h-4.5" />, requiredPermission: 'beds:read' },
          { labelKey: 'wardSupply', path: 'ward-supply', icon: <Package className="w-4.5 h-4.5" />, requiredPermission: 'inventory:read' },
        ],
      },
      {
        groupKey: 'groupPatientRecords',
        items: [
          { labelKey: 'patients', path: 'patients', icon: <Users className="w-4.5 h-4.5" />, requiredPermission: 'patients:read' },
          { labelKey: 'vitals', path: 'vitals', icon: <Heart className="w-4.5 h-4.5" />, requiredPermission: 'vitals:read' },
          { labelKey: 'dischargePlanning', path: 'discharge-planning', icon: <ClipboardCheck className="w-4.5 h-4.5" />, requiredPermission: 'nursing:read' },
        ],
      },
      {
        groupKey: 'groupClinical',
        items: [
          { labelKey: 'allergies', path: 'allergies', icon: <AlertTriangle className="w-4.5 h-4.5" />, requiredPermission: 'allergies:read' },
          { labelKey: 'housekeeping', path: 'housekeeping', icon: <Shield className="w-4.5 h-4.5" />, requiredPermission: 'admissions:read' },
        ],
      },
      {
        groupKey: 'groupSupport',
        items: [
          { labelKey: 'notifications', path: 'notifications', icon: <Bell className="w-4.5 h-4.5" /> },
          { labelKey: 'helpCenter', path: 'help', icon: <HelpCircle className="w-4.5 h-4.5" /> },
        ],
      },
    ],
    accountant: [
      {
        items: [
          { labelKey: 'dashboard', path: 'accountant/dashboard', icon: <LayoutDashboard className="w-4.5 h-4.5" /> },
          { labelKey: 'accounting', path: 'accountant/accounting', icon: <Wallet className="w-4.5 h-4.5" />, requiredPermission: 'accounting:read' },
          { labelKey: 'billingCounter', path: 'accountant/billing-counter', icon: <CreditCard className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'cashBankBook', path: 'accountant/cash-bank-book', icon: <Landmark className="w-4.5 h-4.5" />, requiredPermission: 'accounting:read' },
          { labelKey: 'deposits', path: 'accountant/deposits', icon: <Wallet className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'creditNotes', path: 'accountant/credit-notes', icon: <RefreshCw className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'settlements', path: 'accountant/settlements', icon: <Handshake className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'billHandover', path: 'accountant/billing-handover', icon: <ArrowRightLeft className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'payments', path: 'accountant/payments', icon: <CreditCard className="w-4.5 h-4.5" />, requiredPermission: 'billing:read' },
          { labelKey: 'doctorCommissions', path: 'accountant/commissions', icon: <Percent className="w-4.5 h-4.5" />, requiredPermission: 'accounting:read' },
          { labelKey: 'accounts', path: 'accountant/accounts', icon: <BookOpen className="w-4.5 h-4.5" />, requiredPermission: 'accounting:read' },
          { labelKey: 'journal', path: 'accountant/journal', icon: <FileText className="w-4.5 h-4.5" />, requiredPermission: 'accounting:read' },
          { labelKey: 'income', path: 'accountant/income', icon: <TrendingUp className="w-4.5 h-4.5" />, requiredPermission: 'income:read' },
          { labelKey: 'expenses', path: 'accountant/expenses', icon: <TrendingDown className="w-4.5 h-4.5" />, requiredPermission: 'expenses:read' },
          { labelKey: 'reports', path: 'accountant/reports', icon: <PieChart className="w-4.5 h-4.5" />, requiredPermission: 'reports:read' },
          { labelKey: 'audit', path: 'accountant/audit', icon: <ShieldCheck className="w-4.5 h-4.5" />, requiredPermission: 'audit:read' },
          { labelKey: 'helpCenter', path: 'help', icon: <HelpCircle className="w-4.5 h-4.5" /> },
        ],
      },
    ],
  };

  const rawGroups = roleNavGroups[normalizedRole] ?? roleNavGroups.hospital_admin;
  // For admin roles, filter groups by sub-role visibility
  const isAdminRole = ['hospital_admin', 'super_admin', 'branch_manager', 'accounts_manager', 'auditor', 'owner_view'].includes(normalizedRole);
  const baseGroups = isAdminRole
    ? rawGroups.filter(g => isGroupVisible(normalizedRole, g.groupKey))
    : rawGroups;
  const allNavGroups: NavGroup[] = [...baseGroups, { items: COMMON_FOOTER_ITEMS }];

  // Filter nav items by permission, and filter out empty groups
  const navGroups: NavGroup[] = allNavGroups
    .map((group) => ({
      ...group,
      items: filterNavItems(group.items),
    }))
    .filter((group) => group.items.length > 0);
  const roleLabel = t(`roleLabels.${normalizedRole}`, { defaultValue: normalizedRole });

  // Resolve full path: for super_admin keep absolute, for others prefix with /h/:slug/
  const resolvePath = (path: string) =>
    path.startsWith('/') ? path : `${base}/${path}`;

  const isPathActive = (path?: string) => {
    if (!path) return false;
    const fullPath = resolvePath(path).split(/[?#]/)[0];
    return location.pathname === fullPath || location.pathname.startsWith(fullPath + '/');
  };

  const getItemId = (item: NavItem, fallback: string) =>
    item.path ? `${item.labelKey}:path:${item.path}` : `${fallback}:${item.labelKey}`;

  const isItemActive = (item: NavItem): boolean =>
    item.children?.some(isItemActive) ?? isPathActive(item.path);

  const handleNavScroll = () => {
    if (typeof window === 'undefined' || !navRef.current) return;
    window.sessionStorage.setItem(scrollStorageKey, String(navRef.current.scrollTop));
  };

  const handleNavLinkClick = () => {
    handleNavScroll();
    setIsOpen(false);
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(accordionStorageKey, JSON.stringify(expandedItems));
    } catch {
      // Ignore storage failures and continue with in-memory state.
    }
  }, [accordionStorageKey, expandedItems]);

  useEffect(() => {
    if (typeof window === 'undefined' || !navRef.current) return;

    const restoreScroll = () => {
      if (!navRef.current) return;
      const saved = window.sessionStorage.getItem(scrollStorageKey);
      navRef.current.scrollTop = saved ? Number(saved) || 0 : 0;
    };

    restoreScroll();
    const frameId = window.requestAnimationFrame(restoreScroll);
    return () => window.cancelAnimationFrame(frameId);
  }, [scrollStorageKey, expandedItems]);

  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname]);

  const toggleAccordion = (itemId: string) => {
    setExpandedItems((current) => ({
      ...current,
      [itemId]: !current[itemId],
    }));
  };

  const sidebarDefaultLabels: Record<string, string> = {
    accountingFinance: 'Accounting & Finance',
    activityLog: 'Activity Log',
    admissionOverview: 'Admission Overview',
    advancedLabSettings: 'Advanced Lab Settings',
    aiAssistant: 'AI Assistant',
    alertsExceptions: 'Alerts & Exceptions',
    analyticsBranches: 'Branch Analytics',
    analyticsBuilder: 'Analytics Builder',
    analyticsDepartments: 'Department Analytics',
    analyticsDoctors: 'Doctor Analytics',
    analyticsExecutive: 'Executive Analytics',
    analyticsInventory: 'Inventory Analytics',
    analyticsPatients: 'Patient Analytics',
    analyticsRevenue: 'Revenue Analytics',
    appointmentReports: 'Appointment Reports',
    appointmentSettings: 'Appointment Settings',
    appointments: 'Appointments',
    approvalCenter: 'Approval Center',
    approvalPolicies: 'Approval Policies',
    assetManagement: 'Asset Management',
    attendancePunch: 'Attendance Punch',
    audit: 'Audit Log',
    backupSettings: 'Backup Settings',
    billingCancellation: 'Bill Cancellation',
    billingDashboard: 'Billing Dashboard',
    billingHandover: 'Billing Handover',
    billingReports: 'Billing Reports',
    billingSettings: 'Billing Settings',
    biomedicalWaste: 'Biomedical Waste',
    camos: 'CAMOS',
    carePlans: 'Care Plans',
    cashBankBook: 'Cash & Bank Book',
    cashDeposits: 'Cash Deposits',
    clinicalAssessments: 'Clinical Assessments',
    clinicalReminders: 'Clinical Reminders',
    clinicalWorkspace: 'Clinical Workspace',
    collectionFollowups: 'Collection Followups',
    consents: 'Consents',
    consultationNotes: 'Consultation Notes',
    createReferral: 'Create Referral',
    cssd: 'CSSD',
    dental: 'Dental',
    diagnosticManagement: 'Diagnostic Management',
    diagnosticMonitor: 'Diagnostic Monitor',
    diagnosticsAndInsurance: 'Diagnostics & Insurance',
    discountAnalytics: 'Discount Analytics',
    discountSettings: 'Discount Settings',
    doctorSchedule: 'Doctor Schedule',
    documents: 'Documents',
    donations: 'Donations',
    dutyMonitor: 'Duty Monitor',
    emailSettings: 'Email Settings',
    ePrescribing: 'E-Prescribing',
    escalationRules: 'Escalation Rules',
    exportHistory: 'Export History',
    eyeExam: 'Eye Exam',
    feeSheet: 'Fee Sheet',
    financialAudit: 'Financial Audit',
    formBuilder: 'Form Builder',
    goodsReceipts: 'Goods Receipts',
    groupAttendance: 'Group Attendance',
    healthRecords: 'Health Records',
    hospitalOperations: 'Hospital Operations',
    hospitalProfile: 'Hospital Profile',
    importExport: 'Import / Export',
    importExportSettings: 'Import / Export Settings',
    importRecords: 'Import Records',
    incomingReferrals: 'Incoming Referrals',
    inventoryAccounting: 'Inventory Accounting',
    inventoryAlerts: 'Inventory Alerts',
    inventoryAutomation: 'Inventory Automation',
    inventoryDashboard: 'Inventory Dashboard',
    inventoryLedger: 'Inventory Ledger',
    inventoryMain: 'Inventory Main',
    inventoryMasterData: 'Inventory Master Data',
    inventoryOperations: 'Inventory Operations',
    inventoryProcurement: 'Inventory Procurement',
    inventoryQuickStart: 'Inventory Quick Start',
    inventoryTraceability: 'Inventory Traceability',
    labDashboard: 'Lab Dashboard',
    labMachineRoute: 'Lab Machines',
    labMonitoring: 'Lab Monitoring',
    labOrders: 'Lab Orders',
    labQc: 'Lab QC',
    labTests: 'Lab Tests',
    laundry: 'Laundry',
    marketplaceBookings: 'Marketplace Bookings',
    marketingReferral: 'Marketing & Referral',
    maternity: 'Maternity',
    medicalRecords: 'Medical Records',
    mfa: 'MFA Setup',
    mlc: 'MLC',
    mortuary: 'Mortuary',
    multiBranch: 'Multi Branch',
    newDispatch: 'New Dispatch',
    newGoodsReceipt: 'New Goods Receipt',
    newLabOrder: 'New Lab Order',
    newPatient: 'New Patient',
    newPrescription: 'New Prescription',
    newPurchaseOrder: 'New Purchase Order',
    newRequisition: 'New Requisition',
    notificationSettings: 'Notification Settings',
    offlineSyncReview: 'Offline Sync Review',
    orderSets: 'Order Sets',
    otCalendar: 'OT Calendar',
    otCommissionRules: 'OT Commission Rules',
    otDashboard: 'OT Dashboard',
    otMonitor: 'OT Monitor',
    otReports: 'OT Reports',
    otSettings: 'OT Settings',
    patientAccessAudit: 'Patient Access Audit',
    patientCardScan: 'Patient Card Scan',
    patientDuplicates: 'Patient Duplicates',
    patientPortal: 'Patient Portal',
    patients: 'Patients',
    payrollGeneration: 'Payroll Generation',
    pharmacyReports: 'Pharmacy Reports',
    physicalExam: 'Physical Exam',
    platformStaff: 'Platform Staff',
    printTemplates: 'Print Templates',
    priorAuth: 'Prior Authorization',
    procedureOrders: 'Procedure Orders',
    profitLoss: 'Profit & Loss',
    qualityKpi: 'Quality KPI',
    questionNaires: 'Questionnaires',
    questionnaires: 'Questionnaires',
    reportsPdf: 'Reports PDF',
    returnToVendor: 'Return to Vendor',
    reviewModeration: 'Review Moderation',
    rfq: 'RFQ',
    securitySettings: 'Security Settings',
    sessions: 'Login Sessions',
    setupWizard: 'Setup Wizard',
    softwareModules: 'Software Modules',
    specialtyClinical: 'Specialty Clinical',
    stockAdjustment: 'Stock Adjustment',
    stockAdjustments: 'Stock Adjustments',
    stockIssues: 'Stock Issues',
    stockList: 'Stock List',
    suspiciousActivities: 'Suspicious Activities',
    tasksFollowups: 'Tasks & Followups',
    testCatalog: 'Test Catalog',
    transactionControl: 'Transaction Control',
    triage: 'Triage',
    website: 'Website',
  };

  const itemLabel = (labelKey: string) => t(labelKey, {
    defaultValue: sidebarDefaultLabels[labelKey] ?? labelKey,
  });

  const renderNavItem = (item: NavItem, itemId: string, depth = 0): React.ReactNode => {
    const hasChildren = Boolean(item.children?.length);
    const isActive = isItemActive(item);
    const isExpanded = hasChildren && (isActive || expandedItems[itemId]);
    const baseClasses = depth === 0 ? (collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5') : 'pl-10 pr-3 py-2';

    if (hasChildren) {
      if (collapsed) {
        // In collapsed mode, render accordion parent as a simple icon (no expand)
        return (
          <div key={itemId} className="relative group">
            <button
              type="button"
              title={itemLabel(item.labelKey)}
              aria-label={itemLabel(item.labelKey)}
              className={`
                w-full flex items-center justify-center ${baseClasses} rounded-lg text-sm font-medium
                transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset
                text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary-dark)]
              `}
            >
              <span className="shrink-0 text-[var(--color-text-muted)]">
                {item.icon}
              </span>
            </button>
            <div className="pointer-events-none absolute left-full top-0 ml-2 px-2 py-1 rounded bg-slate-800 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[60]">
              {itemLabel(item.labelKey)}
            </div>
          </div>
        );
      }
      return (
        <div key={itemId}>
          <button
            type="button"
            onClick={() => toggleAccordion(itemId)}
            aria-expanded={isExpanded}
            className={`
              w-full group flex items-center gap-3 ${baseClasses} rounded-lg text-sm font-medium
              transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset
              ${isExpanded
                ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]'
                : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary-dark)] hover:translate-x-0.5'
              }
            `}
          >
            <span className={`shrink-0 ${isExpanded ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)]'}`}>
              {item.icon}
            </span>
            <span className="truncate text-left">{itemLabel(item.labelKey)}</span>
            <ChevronDown
              className={`w-4 h-4 ml-auto transition-transform duration-150 ${isExpanded ? 'rotate-180 text-[var(--color-primary)]' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)]'}`}
              aria-hidden="true"
            />
          </button>

          {isExpanded && (
            <div className="mt-1 ml-5 pl-2 border-l border-[var(--color-border)] space-y-0.5">
              {item.children?.map((child, childIdx) => renderNavItem(child, getItemId(child, `${itemId}-${childIdx}`), depth + 1))}
            </div>
          )}
        </div>
      );
    }

    if (!item.path) return null;

    const fullPath = resolvePath(item.path);

    if (collapsed && depth === 0) {
      return (
        <Link
          key={itemId}
          to={fullPath}
          preventScrollReset
          onClick={handleNavLinkClick}
          onMouseEnter={() => item.path && handlePrefetch(item.path)}
          aria-current={isActive ? 'page' : undefined}
          title={itemLabel(item.labelKey)}
          className={`
            relative group flex items-center justify-center ${baseClasses} rounded-lg text-sm font-medium
            transition-all duration-150 cursor-pointer
            ${isActive
              ? 'bg-gradient-to-r from-[var(--color-primary)] to-cyan-400 text-white shadow-sm shadow-cyan-500/20'
              : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary-dark)]'
            }
          `}
        >
          <span className={`shrink-0 ${isActive ? 'text-white' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)]'}`}>
            {item.icon}
          </span>
          <div className="pointer-events-none absolute left-full ml-2 px-2 py-1 rounded bg-slate-800 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-[60]">
            {itemLabel(item.labelKey)}
          </div>
        </Link>
      );
    }

    return (
      <Link
        key={itemId}
        to={fullPath}
        preventScrollReset
        onClick={handleNavLinkClick}
        onMouseEnter={() => item.path && handlePrefetch(item.path)}
        aria-current={isActive ? 'page' : undefined}
        className={`
          group flex items-center gap-3 ${baseClasses} rounded-lg text-sm font-medium
          transition-all duration-150 cursor-pointer
          ${isActive
            ? 'bg-gradient-to-r from-[var(--color-primary)] to-cyan-400 text-white shadow-sm shadow-cyan-500/20'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary-dark)] hover:translate-x-0.5'
          }
        `}
      >
        <span className={`shrink-0 ${isActive ? 'text-white' : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-primary)]'}`}>
          {item.icon}
        </span>
        <span className="truncate">{itemLabel(item.labelKey)}</span>
        {isActive && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-70" />}
      </Link>
    );
  };

  // Get default group label translations
  const groupLabels: Record<string, string> = {
    groupPlatform:   t('groupPlatform',   { defaultValue: 'Platform' }),
    groupHospitals:  t('groupHospitals',  { defaultValue: 'Hospitals' }),
    groupSystem:     t('groupSystem',     { defaultValue: 'System' }),
    groupOperations: t('groupOperations', { defaultValue: 'Operations' }),
    groupClinical:   t('groupClinical',   { defaultValue: 'Clinical' }),
    groupFinance:    t('groupFinance',    { defaultValue: 'Finance' }),
    groupAdmin:      t('groupAdmin',      { defaultValue: 'Administration' }),
    groupSupport:    t('groupSupport',    { defaultValue: 'Support' }),
    groupInventory:  t('groupInventory',  { defaultValue: 'Inventory' }),
    groupPatientRecords:     t('groupPatientRecords',     { defaultValue: 'Patient Records' }),
    groupClinicalAssessments: t('groupClinicalAssessments', { defaultValue: 'Clinical Assessments' }),
    groupProcedures:         t('groupProcedures',         { defaultValue: 'Procedures' }),
    groupSpecialty:          t('groupSpecialty',          { defaultValue: 'Specialty' }),
    groupMarketing:          t('groupMarketing',          { defaultValue: 'Marketing' }),
    // Admin sidebar groups
    groupActionCenter:       t('groupActionCenter',       { defaultValue: 'Action Center' }),
    groupPatientExperience:  t('groupPatientExperience',  { defaultValue: 'Patient Experience' }),
    groupStarterControl:     t('groupStarterControl',     { defaultValue: 'Control Center' }),
    groupReagentStock:       t('groupReagentStock',       { defaultValue: 'Reagent & Stock' }),
    groupPatientServices:    t('groupPatientServices',    { defaultValue: 'Patients & Services' }),
    groupOperationsMonitor:  t('groupOperationsMonitor',  { defaultValue: 'Operations Monitor' }),
    groupDiagnosticLab:      t('groupDiagnosticLab',      { defaultValue: 'Diagnostic Lab' }),
    groupCashFinance:        t('groupCashFinance',        { defaultValue: 'Cash & Finance' }),
    groupInventoryAdmin:     t('groupInventoryAdmin',     { defaultValue: 'Inventory' }),
    groupAdvancedOperations: t('groupAdvancedOperations', { defaultValue: 'Advanced Operations' }),
    groupAdvancedLabLis:     t('groupAdvancedLabLis',     { defaultValue: 'Advanced Lab / LIS' }),
    groupPeopleAccess:       t('groupPeopleAccess',       { defaultValue: 'People & Access' }),
    groupAuditSecurity:      t('groupAuditSecurity',      { defaultValue: 'Audit & Security' }),
    groupReportsAnalytics:   t('groupReportsAnalytics',   { defaultValue: 'Reports & Analytics' }),
    groupSettings:           t('groupSettings',           { defaultValue: 'Settings' }),
  };

  return (
    <>
      {/* ── Mobile hamburger ── */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? "Close sidebar" : "Open sidebar"}
        aria-expanded={isOpen}
        aria-controls="mobile-sidebar"
        className="no-print lg:hidden fixed top-3 left-3 z-[60] p-2 rounded-lg bg-white border border-[var(--color-border)] shadow-card cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
      >
        {isOpen ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
      </button>

      {/* ── Mobile backdrop ── */}
      {isOpen && (
        <div
          className="no-print lg:hidden fixed inset-0 bg-slate-950/55 z-40 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        id="mobile-sidebar"
        className={`
        no-print
        fixed lg:sticky lg:top-0 lg:h-dvh inset-y-0 left-0 z-50
        ${collapsed ? 'lg:w-16' : 'w-[min(88vw,20rem)] lg:w-64'} bg-white dark:bg-slate-900
        border-r border-[var(--color-border)]
        flex flex-col shadow-2xl lg:shadow-none
        transform transition-all duration-200 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none lg:pointer-events-auto lg:translate-x-0'}
      `}>

        {/* Logo & Brand — with gradient strip */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-[var(--color-border)] shrink-0
          bg-gradient-to-r from-cyan-50/60 to-transparent dark:from-cyan-950/20 dark:to-transparent">
          <img
            src={hospitalLogo || '/ozzyl-logo.svg'}
            alt={hospitalName}
            className="w-8 h-8 rounded-lg shrink-0 shadow-md shadow-cyan-500/20 object-cover"
          />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold gradient-text leading-none truncate">{hospitalName}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5 leading-none capitalize">
                {roleLabel.replace(/_/g, ' ')}
              </p>
            </div>
          )}
        </div>

        {/* Navigation with groups */}
        <nav
          ref={navRef}
          className={`flex-1 ${collapsed ? 'px-2' : 'px-3'} py-3 overflow-y-auto overscroll-contain`}
          aria-label="Main navigation"
          onScroll={handleNavScroll}
        >
          {navGroups.map((group, groupIdx) => (
            <div key={groupIdx} className={groupIdx > 0 ? 'mt-4' : ''}>
              {/* Group label */}
              {group.groupKey && !collapsed && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
                  {groupLabels[group.groupKey] ?? group.groupKey}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item, itemIdx) => renderNavItem(item, getItemId(item, `${group.groupKey ?? 'group'}-${groupIdx}-${itemIdx}`)))}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer: collapse toggle + sign out */}
        <div className={`px-3 py-3 border-t border-[var(--color-border)] shrink-0 space-y-1`}>
          <button
            onClick={toggleCollapsed}
            className="hidden lg:flex w-full items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary-dark)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset"
            title={collapsed ? t('expandSidebar', { defaultValue: 'Expand sidebar' }) : t('collapseSidebar', { defaultValue: 'Collapse sidebar' })}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            {!collapsed && <span>{t('collapseSidebar', { defaultValue: 'Collapse' })}</span>}
          </button>
          <button
            onClick={onLogout}
            className={`btn-danger w-full ${collapsed ? 'justify-center' : 'justify-start'} text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-inset`}
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && <span>{t('signOut', { ns: 'common' })}</span>}
          </button>
        </div>
      </aside>
    </>
  );
}


export default memo(SidebarBase);
