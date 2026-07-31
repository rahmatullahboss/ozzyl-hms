import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  color?: 'primary' | 'success' | 'warning' | 'error' | 'info';
}

const colorClasses = {
  primary: 'bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400',
  success: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
  warning: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  error: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
  info: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
};

export default function StatCard({ label, value, icon, color = 'primary' }: StatCardProps) {
  return (
    <div className="card p-4 flex items-center gap-4">
      {icon && (
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          {icon}
        </div>
      )}
      <div>
        <p className="text-sm text-[var(--color-text-muted)]">{label}</p>
        <p className="text-xl font-bold text-[var(--color-text-primary)]">{value}</p>
      </div>
    </div>
  );
}
