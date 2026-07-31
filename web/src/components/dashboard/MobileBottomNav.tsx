import { useLocation, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LayoutDashboard, Users, Receipt, MoreHorizontal, FlaskConical, Building2, Stethoscope, Wallet } from 'lucide-react';
import { normalizeRole } from '@shared/authz';

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  matchPaths?: string[];
  requiredPermission?: string;
}

function canShowItem(item: NavItem, permissions: string[]): boolean {
  if (!item.requiredPermission) return true;
  if (permissions.includes('*')) return true;
  return permissions.includes(item.requiredPermission);
}

function getNavItems(role: string, base: string, t: (key: string) => string, permissions: string[] = []): NavItem[] {
  const normalizedRole = normalizeRole(role) || role;
  if (normalizedRole === 'laboratory') {
    return [
      { label: t('dashboard'), icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/lab/dashboard` },
      { label: t('tests'), icon: <FlaskConical className="w-5 h-5" />, path: `${base}/lab/orders` },
      { label: t('reagentControl'), icon: <FlaskConical className="w-5 h-5" />, path: `${base}/lab/monitoring` },
      { label: t('more'), icon: <MoreHorizontal className="w-5 h-5" />, path: `${base}/lab/settings` },
    ];
  }

  if (normalizedRole === 'reception') {
    return [
      { label: t('dashboard'), icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/reception/dashboard` },
      { label: t('patients'), icon: <Users className="w-5 h-5" />, path: `${base}/reception/patients` },
      { label: t('billing'), icon: <Receipt className="w-5 h-5" />, path: `${base}/reception/billing-counter` },
      { label: t('more'), icon: <MoreHorizontal className="w-5 h-5" />, path: `${base}/reception/appointments` },
    ];
  }

  if (normalizedRole === 'manager') {
    return [
      { label: t('dashboard'), icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/dashboard`, requiredPermission: 'dashboard:read' },
      { label: t('patients'), icon: <Users className="w-5 h-5" />, path: `${base}/reception/patients`, requiredPermission: 'patients:read' },
      { label: t('billing'), icon: <Receipt className="w-5 h-5" />, path: `${base}/reception/billing-counter`, requiredPermission: 'billing:read' },
      { label: t('more'), icon: <MoreHorizontal className="w-5 h-5" />, path: `${base}/reception/cash-operations`, requiredPermission: 'billing:read' },
    ].filter((item) => canShowItem(item, permissions));
  }

  if (normalizedRole === 'director' || normalizedRole === 'md') {
    return [
      { label: t('dashboard'), icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/${normalizedRole}/dashboard` },
      { label: t('patients'), icon: <Users className="w-5 h-5" />, path: `${base}/patients` },
      { label: t('billing'), icon: <Receipt className="w-5 h-5" />, path: `${base}/billing` },
      { label: t('more'), icon: <Building2 className="w-5 h-5" />, path: `${base}/${normalizedRole}/reports` },
    ];
  }

  if (normalizedRole === 'doctor') {
    return [
      { label: t('dashboard'), icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/doctor/dashboard` },
      { label: t('patients'), icon: <Users className="w-5 h-5" />, path: `${base}/patients` },
      { label: t('prescriptions'), icon: <Receipt className="w-5 h-5" />, path: `${base}/doctor/prescriptions` },
      { label: t('more'), icon: <MoreHorizontal className="w-5 h-5" />, path: `${base}/telemedicine` },
    ];
  }

  if (normalizedRole === 'nurse') {
    return [
      { label: 'Nurse Station', icon: <Stethoscope className="w-5 h-5" />, path: `${base}/nurse-station` },
      { label: t('patients'), icon: <Users className="w-5 h-5" />, path: `${base}/patients` },
      { label: t('vitals'), icon: <Receipt className="w-5 h-5" />, path: `${base}/vitals` },
      { label: t('more'), icon: <MoreHorizontal className="w-5 h-5" />, path: `${base}/nursing` },
    ];
  }

  if (normalizedRole === 'accountant') {
    return [
      { label: t('dashboard'), icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/accountant/dashboard` },
      { label: t('accounting'), icon: <Users className="w-5 h-5" />, path: `${base}/accountant/accounting` },
      { label: t('income'), icon: <Receipt className="w-5 h-5" />, path: `${base}/accountant/income` },
      { label: t('more'), icon: <Building2 className="w-5 h-5" />, path: `${base}/accountant/reports` },
    ];
  }

  // hospital_admin default: Starter HIS mobile shortcuts.
  return [
    {
      label: t('dashboard'),
      icon: <LayoutDashboard className="w-5 h-5" />,
      path: `${base}/dashboard`,
      matchPaths: [`${base}/dashboard`],
    },
    {
      label: t('billing'),
      icon: <Receipt className="w-5 h-5" />,
      path: `${base}/billing-counter`,
      matchPaths: [`${base}/billing-counter`, `${base}/billing`],
    },
    {
      label: t('cashControl'),
      icon: <Wallet className="w-5 h-5" />,
      path: `${base}/cash/drawers`,
      matchPaths: [`${base}/cash`],
    },
    {
      label: t('reagentControl'),
      icon: <FlaskConical className="w-5 h-5" />,
      path: `${base}/lab/monitoring`,
      matchPaths: [`${base}/lab/monitoring`],
    },
    {
      label: t('more'),
      icon: <MoreHorizontal className="w-5 h-5" />,
      path: `${base}/settings`,
    },
  ];
}

interface MobileBottomNavProps {
  role: string;
  permissions?: string[];
}

export default function MobileBottomNav({ role, permissions = [] }: MobileBottomNavProps) {
  const { slug = '' } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation('sidebar');

  const items = getNavItems(role, base, t, permissions);

  const isActive = (item: NavItem) => {
    const paths = item.matchPaths ?? [item.path];
    return paths.some(p => location.pathname.startsWith(p));
  };

  return (
    <nav
      className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-slate-900 border-t border-[var(--color-border)] safe-area-pb"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-stretch">
        {items.map((item) => {
          const active = isActive(item);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset ${
                active
                  ? 'text-[var(--color-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              <span className={`transition-transform ${active ? 'scale-110' : ''}`} aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
              {active && (
                <span className="absolute bottom-0 block w-8 h-0.5 rounded-full bg-[var(--color-primary)]" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
