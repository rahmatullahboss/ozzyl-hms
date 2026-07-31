import { useLocation, useNavigate, useParams } from 'react-router';
import { LayoutDashboard, Users, Receipt, MoreHorizontal, FlaskConical, Building2 } from 'lucide-react';
import { normalizeRole } from '@shared/authz';

interface NavItem {
  label: string;
  icon: React.ReactNode;
  path: string;
  matchPaths?: string[];
}

function getNavItems(role: string, base: string): NavItem[] {
  const normalizedRole = normalizeRole(role) || role;
  const common = [
    {
      label: 'Dashboard',
      icon: <LayoutDashboard className="w-5 h-5" />,
      path: `${base}/dashboard`,
      matchPaths: [`${base}/dashboard`],
    },
    {
      label: 'Patients',
      icon: <Users className="w-5 h-5" />,
      path: `${base}/patients`,
      matchPaths: [`${base}/patients`],
    },
  ];

  if (normalizedRole === 'laboratory') {
    return [
      { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/lab/dashboard` },
      { label: 'Tests', icon: <FlaskConical className="w-5 h-5" />, path: `${base}/lab/orders` },
      { label: 'Patients', icon: <Users className="w-5 h-5" />, path: `${base}/patients` },
      { label: 'More', icon: <MoreHorizontal className="w-5 h-5" />, path: `${base}/lab/settings` },
    ];
  }

  if (normalizedRole === 'reception') {
    return [
      { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/reception/dashboard` },
      { label: 'Patients', icon: <Users className="w-5 h-5" />, path: `${base}/patients` },
      { label: 'Billing', icon: <Receipt className="w-5 h-5" />, path: `${base}/billing` },
      { label: 'More', icon: <MoreHorizontal className="w-5 h-5" />, path: `${base}/appointments` },
    ];
  }

  if (normalizedRole === 'director' || normalizedRole === 'md') {
    return [
      { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/${normalizedRole}/dashboard` },
      { label: 'Patients', icon: <Users className="w-5 h-5" />, path: `${base}/patients` },
      { label: 'Billing', icon: <Receipt className="w-5 h-5" />, path: `${base}/billing` },
      { label: 'More', icon: <Building2 className="w-5 h-5" />, path: `${base}/${normalizedRole}/reports` },
    ];
  }

  if (normalizedRole === 'doctor') {
    return [
      { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/doctor/dashboard` },
      { label: 'Patients', icon: <Users className="w-5 h-5" />, path: `${base}/patients` },
      { label: 'Billing', icon: <Receipt className="w-5 h-5" />, path: `${base}/doctor/prescriptions` },
      { label: 'More', icon: <MoreHorizontal className="w-5 h-5" />, path: `${base}/telemedicine` },
    ];
  }

  if (normalizedRole === 'nurse') {
    return [
      { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/nurse-station` },
      { label: 'Patients', icon: <Users className="w-5 h-5" />, path: `${base}/patients` },
      { label: 'Billing', icon: <Receipt className="w-5 h-5" />, path: `${base}/vitals` },
      { label: 'More', icon: <MoreHorizontal className="w-5 h-5" />, path: `${base}/nursing` },
    ];
  }

  if (normalizedRole === 'accountant') {
    return [
      { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, path: `${base}/accountant/dashboard` },
      { label: 'Patients', icon: <Users className="w-5 h-5" />, path: `${base}/accountant/accounting` },
      { label: 'Billing', icon: <Receipt className="w-5 h-5" />, path: `${base}/accountant/income` },
      { label: 'More', icon: <Building2 className="w-5 h-5" />, path: `${base}/accountant/reports` },
    ];
  }

  // hospital_admin default
  return [
    ...common,
    {
      label: 'Billing',
      icon: <Receipt className="w-5 h-5" />,
      path: `${base}/billing`,
      matchPaths: [`${base}/billing`],
    },
    {
      label: 'More',
      icon: <MoreHorizontal className="w-5 h-5" />,
      path: `${base}/settings`,
    },
  ];
}

export default function MobileBottomNav({ role }: { role: string }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const location = useLocation();
  const navigate = useNavigate();

  const items = getNavItems(role, base);

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
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[11px] font-medium transition-colors ${
                active
                  ? 'text-[var(--color-primary)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              <span className={`transition-transform ${active ? 'scale-110' : ''}`}>
                {item.icon}
              </span>
              <span>{item.label}</span>
              {active && (
                <span className="absolute bottom-0 block w-8 h-0.5 rounded-full bg-[var(--color-primary)]" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
