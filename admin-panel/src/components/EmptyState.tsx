import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** A navigation CTA — rendered as a <Link> with the primary button style. */
  cta?: { label: string; to: string };
  /** Arbitrary action content (e.g. a "Clear filter" button). Rendered after cta. */
  action?: ReactNode;
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  cta,
  action,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      data-testid="empty-state"
      className="flex flex-col items-center justify-center text-center py-10 px-4"
    >
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
        <Icon className="w-6 h-6 text-slate-400" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-md">{description}</p>}
      {cta && (
        <Link
          to={cta.to}
          className="mt-4 inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium"
        >
          {cta.label}
        </Link>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
