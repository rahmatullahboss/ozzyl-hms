import type { ReactNode } from 'react';
import { NavLink, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ClipboardCheck,
  LayoutDashboard,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

export type ActionCenterSection = 'overview' | 'approvals' | 'exceptions' | 'collections' | 'tasks';

export interface ActionCenterShellProps {
  activeSection: ActionCenterSection;
  title: string;
  description: string;
  children: ReactNode;
  primaryAction?: ReactNode;
}

interface ActionCenterSummaryResponse {
  data?: {
    approvals?: { totalPending?: number };
    exceptions?: { open?: number };
    collections?: { open?: number };
    tasks?: { open?: number };
    capabilities?: {
      persistentExceptions?: boolean;
      persistentCollections?: boolean;
      persistentTasks?: boolean;
    };
  };
}

interface NavigationItem {
  section: ActionCenterSection;
  label: string;
  path: string;
  icon: ReactNode;
  count?: number;
}

function CountBadge({ section, count }: { section: ActionCenterSection; count: number | undefined }) {
  if (count === undefined) return null;
  return (
    <span
      data-testid={`action-center-count-${section}`}
      className="min-w-6 rounded-full bg-[var(--color-bg-subtle)] px-2 py-0.5 text-center font-data text-xs font-semibold text-[var(--color-text-muted)]"
    >
      {Number(count).toLocaleString()}
    </span>
  );
}

export default function ActionCenterShell({
  activeSection,
  title,
  description,
  children,
  primaryAction,
}: ActionCenterShellProps) {
  const { slug = '' } = useParams<{ slug: string }>();
  const { t } = useTranslation('adminPages');
  const { data, isLoading, isError } = useApiQuery<ActionCenterSummaryResponse>(
    queryKeys.actionCenter.summary(),
    '/api/action-center/summary',
    { staleTime: 30_000 },
  );

  const summary = data?.data;
  const capabilities = summary?.capabilities;
  const base = `/h/${slug}/action`;
  const items: NavigationItem[] = [
    {
      section: 'overview',
      label: t('actionCenter.navigation.overview', { defaultValue: 'Overview' }),
      path: base,
      icon: <LayoutDashboard className="h-4 w-4" aria-hidden="true" />,
    },
    {
      section: 'approvals',
      label: t('actionCenter.navigation.approvals', { defaultValue: 'Approvals' }),
      path: `${base}/approvals`,
      icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />,
      count: summary?.approvals?.totalPending,
    },
    {
      section: 'exceptions',
      label: t('actionCenter.navigation.exceptions', { defaultValue: 'Exceptions' }),
      path: `${base}/exceptions`,
      icon: <AlertTriangle className="h-4 w-4" aria-hidden="true" />,
      count: capabilities?.persistentExceptions ? summary?.exceptions?.open : undefined,
    },
    {
      section: 'collections',
      label: t('actionCenter.navigation.collections', { defaultValue: 'Collections' }),
      path: `${base}/collections`,
      icon: <WalletCards className="h-4 w-4" aria-hidden="true" />,
      count: capabilities?.persistentCollections ? summary?.collections?.open : undefined,
    },
    {
      section: 'tasks',
      label: t('actionCenter.navigation.tasks', { defaultValue: 'Tasks' }),
      path: `${base}/tasks`,
      icon: <ClipboardCheck className="h-4 w-4" aria-hidden="true" />,
      count: capabilities?.persistentTasks ? summary?.tasks?.open : undefined,
    },
  ];

  return (
    <div className="mx-auto max-w-screen-2xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
            {t('actionCenter.eyebrow', { defaultValue: 'Action Center' })}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--color-text-primary)] sm:text-3xl">
            {title}
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)] sm:text-base">
            {description}
          </p>
        </div>
        {primaryAction ? <div className="shrink-0">{primaryAction}</div> : null}
      </header>

      <nav
        aria-label={t('actionCenter.navigationLabel', { defaultValue: 'Action Center' })}
        className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-2 shadow-sm"
      >
        <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
          {items.map((item) => (
            <NavLink
              key={item.section}
              to={item.path}
              end={item.section === 'overview'}
              aria-current={activeSection === item.section ? 'page' : undefined}
              className={() => [
                'inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors duration-200',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2',
                activeSection === item.section
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text-primary)]',
              ].join(' ')}
            >
              {item.icon}
              <span>{item.label}</span>
              <CountBadge section={item.section} count={item.count} />
            </NavLink>
          ))}
        </div>
      </nav>

      {isLoading ? (
        <p className="text-sm text-[var(--color-text-muted)]" role="status">
          {t('actionCenter.loading', { defaultValue: 'Loading Action Center summary…' })}
        </p>
      ) : null}
      {isError ? (
        <p
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          role="status"
        >
          {t('actionCenter.stale', { defaultValue: 'Counts are temporarily unavailable. Queue actions remain available.' })}
        </p>
      ) : null}

      <main className="min-w-0" data-action-center-section={activeSection}>
        {children}
      </main>
    </div>
  );
}
