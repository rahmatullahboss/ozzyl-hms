import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import DashboardLayout from '../../components/DashboardLayout';
import ActionCenterShell from '../../components/action-center/ActionCenterShell';
import TaskDetailDrawer, {
  type TaskItem,
  type TaskListResponse,
  type TaskPriority,
  type TaskSourceType,
  type TaskStatus,
} from '../../components/action-center/TaskDetailDrawer';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAuth } from '../../hooks/useAuth';
import { queryKeys } from '../../lib/queryKeys';

type TaskView = 'mine' | 'team' | 'due_today' | 'overdue' | 'completed';

const MANAGEMENT_ROLES = new Set(['hospital_admin', 'md', 'director', 'manager']);
const VALID_VIEWS = new Set<TaskView>(['mine', 'team', 'due_today', 'overdue', 'completed']);
const VALID_PRIORITIES = new Set<TaskPriority>(['critical', 'high', 'medium', 'low']);
const VALID_SOURCE_TYPES = new Set<TaskSourceType>(['exception', 'collection', 'manual']);
const PAGE_LIMIT = 50;

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  critical: 'border-red-200 bg-red-50 text-red-800',
  high: 'border-orange-200 bg-orange-50 text-orange-800',
  medium: 'border-amber-200 bg-amber-50 text-amber-800',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-800',
};

const STATUS_STYLES: Record<TaskStatus | 'overdue', string> = {
  open: 'border-sky-200 bg-sky-50 text-sky-800',
  in_progress: 'border-indigo-200 bg-indigo-50 text-indigo-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-700',
  overdue: 'border-red-200 bg-red-50 text-red-800',
};

const VIEW_OPTIONS: Array<{ value: TaskView; labelKey: string; managementOnly?: boolean }> = [
  { value: 'mine', labelKey: 'tasks.views.mine' },
  { value: 'team', labelKey: 'tasks.views.team', managementOnly: true },
  { value: 'due_today', labelKey: 'tasks.views.dueToday', managementOnly: true },
  { value: 'overdue', labelKey: 'tasks.views.overdue', managementOnly: true },
  { value: 'completed', labelKey: 'tasks.views.completed', managementOnly: true },
];

function parsePage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function tenantSourceHref(slug: string, sourceHref: string | null): string | null {
  if (!sourceHref || !sourceHref.startsWith('/')) return null;
  if (sourceHref.startsWith('/h/')) {
    return sourceHref.startsWith(`/h/${slug}/`) ? sourceHref : null;
  }
  return `/h/${slug}${sourceHref}`;
}

function taskStatus(task: TaskItem): TaskStatus | 'overdue' {
  if (task.isOverdue && task.status !== 'completed' && task.status !== 'cancelled') return 'overdue';
  return task.status;
}

function formatDateTime(value: string | null, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function TasksFollowups() {
  const { t, i18n } = useTranslation('adminPages');
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const canManage = MANAGEMENT_ROLES.has(user?.role ?? '');

  const requestedView = searchParams.get('view');
  const view: TaskView = requestedView && VALID_VIEWS.has(requestedView as TaskView)
    && (canManage || requestedView === 'mine')
    ? requestedView as TaskView
    : 'mine';
  const requestedPriority = searchParams.get('priority');
  const priority = requestedPriority && VALID_PRIORITIES.has(requestedPriority as TaskPriority)
    ? requestedPriority as TaskPriority
    : '';
  const requestedSourceType = searchParams.get('sourceType');
  const sourceType = requestedSourceType && VALID_SOURCE_TYPES.has(requestedSourceType as TaskSourceType)
    ? requestedSourceType as TaskSourceType
    : '';
  const search = searchParams.get('search')?.trim() ?? '';
  const page = parsePage(searchParams.get('page'));

  const filters = useMemo<Record<string, unknown>>(() => ({
    view,
    priority,
    sourceType,
    search,
    page,
    limit: PAGE_LIMIT,
  }), [page, priority, search, sourceType, view]);

  const apiPath = useMemo(() => {
    const params = new URLSearchParams();
    params.set('view', view);
    if (priority) params.set('priority', priority);
    if (sourceType) params.set('sourceType', sourceType);
    if (search) params.set('search', search);
    params.set('page', String(page));
    params.set('limit', String(PAGE_LIMIT));
    return `/api/action-center/tasks?${params.toString()}`;
  }, [page, priority, search, sourceType, view]);

  const tasksQuery = useApiQuery<TaskListResponse>(
    queryKeys.actionCenter.tasks.list(filters),
    apiPath,
    { staleTime: 15_000 },
  );

  const items = tasksQuery.data?.data.items ?? [];
  const pagination = tasksQuery.data?.data.pagination ?? {
    page,
    limit: PAGE_LIMIT,
    total: 0,
    totalPages: 0,
  };
  const totalPages = Math.max(1, pagination.totalPages);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSearchParams(next);
  };

  const changeView = (nextView: TaskView) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', nextView);
    next.delete('page');
    setSearchParams(next);
  };

  const changePage = (nextPage: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextPage <= 1) next.delete('page');
    else next.set('page', String(nextPage));
    setSearchParams(next);
  };

  return (
    <DashboardLayout role="hospital_admin">
      <ActionCenterShell
        activeSection="tasks"
        title={t('tasks.title')}
        description={t('tasks.subtitle')}
        primaryAction={(
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
            onClick={() => void tasksQuery.refetch()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t('tasks.refresh')}
          </button>
        )}
      >
        <section className="space-y-4">
          <div className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-3 shadow-sm">
            <div className="flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0" aria-label={t('tasks.filters.view')}>
              {VIEW_OPTIONS.filter((option) => !option.managementOnly || canManage).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={view === option.value}
                  className={[
                    'min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2',
                    view === option.value
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]',
                  ].join(' ')}
                  onClick={() => changeView(option.value)}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-4 shadow-sm md:grid-cols-3">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">
              <span>{t('tasks.filters.priority')}</span>
              <select
                value={priority}
                onChange={(event) => updateParam('priority', event.target.value)}
                className="mt-2 min-h-11 w-full rounded-xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <option value="">{t('tasks.filters.allPriorities')}</option>
                <option value="critical">{t('tasks.priorityLabels.critical')}</option>
                <option value="high">{t('tasks.priorityLabels.high')}</option>
                <option value="medium">{t('tasks.priorityLabels.medium')}</option>
                <option value="low">{t('tasks.priorityLabels.low')}</option>
              </select>
            </label>

            <label className="text-sm font-medium text-[var(--color-text-primary)]">
              <span>{t('tasks.filters.sourceType')}</span>
              <select
                value={sourceType}
                onChange={(event) => updateParam('sourceType', event.target.value)}
                className="mt-2 min-h-11 w-full rounded-xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              >
                <option value="">{t('tasks.filters.allSources')}</option>
                <option value="exception">{t('tasks.source.exception')}</option>
                <option value="collection">{t('tasks.source.collection')}</option>
                <option value="manual">{t('tasks.source.manual')}</option>
              </select>
            </label>

            <label className="text-sm font-medium text-[var(--color-text-primary)]">
              <span>{t('tasks.filters.search')}</span>
              <span className="relative mt-2 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
                <input
                  type="search"
                  value={search}
                  placeholder={t('tasks.filters.searchPlaceholder')}
                  onChange={(event) => updateParam('search', event.target.value)}
                  className="min-h-11 w-full rounded-xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] pl-10 pr-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                />
              </span>
            </label>
          </div>

          {tasksQuery.isLoading ? (
            <div role="status" className="flex min-h-48 items-center justify-center gap-2 rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] text-sm text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('tasks.loading')}
            </div>
          ) : null}

          {tasksQuery.isError ? (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
              <p>{t('tasks.error')}</p>
              <button
                type="button"
                className="mt-3 min-h-11 rounded-xl border border-red-300 px-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                onClick={() => void tasksQuery.refetch()}
              >
                {t('tasks.retry')}
              </button>
            </div>
          ) : null}

          {!tasksQuery.isLoading && !tasksQuery.isError && items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-border-light)] bg-[var(--color-bg-card)] px-5 py-14 text-center">
              <ClipboardCheck className="mx-auto h-10 w-10 text-[var(--color-text-muted)]" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-bold text-[var(--color-text-primary)]">{t('tasks.emptyTitle')}</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('tasks.empty')}</p>
            </div>
          ) : null}

          {!tasksQuery.isLoading && !tasksQuery.isError && items.length > 0 ? (
            <div className="overflow-hidden rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-sm">
                  <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                    <tr>
                      <th scope="col" className="px-4 py-3">{t('tasks.table.task')}</th>
                      <th scope="col" className="px-4 py-3">{t('tasks.table.priority')}</th>
                      <th scope="col" className="px-4 py-3">{t('tasks.table.status')}</th>
                      <th scope="col" className="px-4 py-3">{t('tasks.table.assignee')}</th>
                      <th scope="col" className="px-4 py-3">{t('tasks.table.due')}</th>
                      <th scope="col" className="px-4 py-3">{t('tasks.table.source')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-light)]">
                    {items.map((task) => {
                      const visibleStatus = taskStatus(task);
                      const sourceHref = tenantSourceHref(slug, task.sourceHref);
                      return (
                        <tr key={task.id} className="hover:bg-[var(--color-bg-subtle)]">
                          <td className="px-4 py-3 align-top">
                            <button
                              type="button"
                              aria-label={task.title}
                              className="min-h-11 max-w-md rounded-lg text-left font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                              onClick={() => setSelectedTaskId(task.id)}
                            >
                              <span>{task.title}</span>
                              {task.description ? <span className="mt-1 block line-clamp-2 text-xs font-normal leading-5 text-[var(--color-text-muted)]">{task.description}</span> : null}
                            </button>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${PRIORITY_STYLES[task.priority]}`}>
                              {t(`tasks.priorityLabels.${task.priority}`)}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLES[visibleStatus]}`}>
                              {t(`tasks.statusLabels.${visibleStatus}`)}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top text-[var(--color-text-primary)]">
                            {task.assignedToName ?? t('tasks.drawer.unassigned')}
                          </td>
                          <td className="px-4 py-3 align-top font-data text-[var(--color-text-muted)]">
                            {formatDateTime(task.dueAtUtc, i18n.language)}
                          </td>
                          <td className="px-4 py-3 align-top">
                            {sourceHref ? (
                              <Link
                                to={sourceHref}
                                aria-label={t('tasks.actions.openSource')}
                                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                              >
                                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                                {task.sourceType ? t(`tasks.source.${task.sourceType}`) : t('tasks.source.manual')}
                              </Link>
                            ) : (
                              <span className="text-[var(--color-text-muted)]">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <footer className="flex flex-col gap-3 border-t border-[var(--color-border-light)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-[var(--color-text-muted)]">
                  {t('tasks.pagination.summary', {
                    page: pagination.page,
                    totalPages: pagination.totalPages,
                    total: pagination.total,
                  })}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label={t('tasks.pagination.previous')}
                    disabled={pagination.page <= 1}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--color-border-light)] disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => changePage(pagination.page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('tasks.pagination.next')}
                    disabled={pagination.page >= totalPages}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--color-border-light)] disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => changePage(pagination.page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </footer>
            </div>
          ) : null}
        </section>

        <TaskDetailDrawer
          open={selectedTaskId !== null}
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onChanged={() => void tasksQuery.refetch()}
        />
      </ActionCenterShell>
    </DashboardLayout>
  );
}
