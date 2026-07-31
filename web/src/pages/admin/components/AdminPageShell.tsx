import type { ReactNode } from 'react';
import DashboardLayout from '../../../components/DashboardLayout';

interface AdminPageShellProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

export default function AdminPageShell({ title, subtitle, actions, children }: AdminPageShellProps) {
  return (
    <DashboardLayout role="hospital_admin">
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="page-title">{title}</h1>
            {subtitle && <p className="section-subtitle mt-1">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </DashboardLayout>
  );
}
