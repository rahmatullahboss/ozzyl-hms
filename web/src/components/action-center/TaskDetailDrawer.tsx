import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Loader2, RefreshCw, X } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { useAuth } from '../../hooks/useAuth';
import { queryKeys } from '../../lib/queryKeys';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type TaskSourceType = 'exception' | 'collection' | 'manual';

export interface TaskItem {
  id: number;
  title: string;
  description: string | null;
  sourceType: TaskSourceType | null;
  sourcePublicId: string | null;
  sourceHref: string | null;
  sourceMetadata: Record<string, unknown>;
  priority: TaskPriority;
  status: TaskStatus;
  assignedTo: number | null;
  assignedToName: string | null;
  dueAtUtc: string | null;
  completedBy: number | null;
  completedByName: string | null;
  completedAtUtc: string | null;
  completionNote: string | null;
  createdBy: number | null;
  createdByName: string | null;
  createdAtUtc: string;
  updatedAtUtc: string;
  isOverdue: boolean;
}

export interface TaskDetail extends TaskItem {
  sourceStatusSummary?: Record<string, unknown> | null;
}

export interface TaskEvent {
  id: number;
  eventType: string;
  actorId: number | null;
  actorName: string | null;
  oldStatus: TaskStatus | null;
  newStatus: TaskStatus | null;
  note: string | null;
  metadata: Record<string, unknown>;
  createdAtUtc: string;
}

export interface TaskListResponse {
  data: {
    items: TaskItem[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

interface TaskDetailResponse {
  data: TaskDetail;
}

interface TaskEventsResponse {
  data: TaskEvent[];
}

interface StaffMember {
  id: number;
  name: string;
}

interface StaffResponse {
  staff: StaffMember[];
}

interface TaskDetailDrawerProps {
  open: boolean;
  taskId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}

type TaskAction = 'assign' | 'start' | 'reschedule' | 'complete' | 'cancel';

interface AssignPayload {
  assignedTo: number;
  note?: string;
  expectedUpdatedAtUtc: string;
}

interface NotePayload {
  note?: string;
  expectedUpdatedAtUtc: string;
}

interface RequiredNotePayload {
  note: string;
  expectedUpdatedAtUtc: string;
}

interface ReschedulePayload {
  dueAtUtc: string;
  note?: string;
  expectedUpdatedAtUtc: string;
}

const MANAGEMENT_ROLES = new Set(['hospital_admin', 'md', 'director', 'manager']);

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

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function tenantSourceHref(slug: string, sourceHref: string | null): string | null {
  if (!sourceHref || !sourceHref.startsWith('/')) return null;
  if (sourceHref.startsWith('/h/')) {
    return sourceHref.startsWith(`/h/${slug}/`) ? sourceHref : null;
  }
  return `/h/${slug}${sourceHref}`;
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

function toDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function optionalNote(note: string): { note?: string } {
  const trimmed = note.trim();
  return trimmed ? { note: trimmed } : {};
}

export default function TaskDetailDrawer({ open, taskId, onClose, onChanged }: TaskDetailDrawerProps) {
  const { t, i18n } = useTranslation('adminPages');
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const resolvedTaskId = taskId ?? 0;
  const canManage = MANAGEMENT_ROLES.has(user?.role ?? '');

  const detailQuery = useApiQuery<TaskDetailResponse>(
    queryKeys.actionCenter.tasks.detail(resolvedTaskId),
    `/api/action-center/tasks/${resolvedTaskId}`,
    { enabled: open && taskId !== null, staleTime: 15_000 },
  );
  const eventsQuery = useApiQuery<TaskEventsResponse>(
    queryKeys.actionCenter.tasks.events(resolvedTaskId),
    `/api/action-center/tasks/${resolvedTaskId}/events`,
    { enabled: open && taskId !== null, staleTime: 15_000 },
  );
  const staffQuery = useApiQuery<StaffResponse>(
    queryKeys.staff.list(),
    '/api/staff',
    { enabled: open && canManage, staleTime: 60_000 },
  );

  const [action, setAction] = useState<TaskAction | null>(null);
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const actionDialogRef = useRef<HTMLDivElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const refreshTask = useCallback(async () => {
    await Promise.all([detailQuery.refetch(), eventsQuery.refetch()]);
  }, [detailQuery, eventsQuery]);

  const handleSuccess = useCallback(async () => {
    setAction(null);
    setNote('');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.actionCenter.tasks.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.actionCenter.summary() }),
      detailQuery.refetch(),
      eventsQuery.refetch(),
    ]);
    onChanged?.();
  }, [detailQuery, eventsQuery, onChanged, queryClient]);

  const assignMutation = useApiMutation<unknown, AssignPayload>(
    'put',
    `/api/action-center/tasks/${resolvedTaskId}/assign`,
    { onSuccess: handleSuccess },
  );
  const startMutation = useApiMutation<unknown, NotePayload>(
    'put',
    `/api/action-center/tasks/${resolvedTaskId}/start`,
    { onSuccess: handleSuccess },
  );
  const rescheduleMutation = useApiMutation<unknown, ReschedulePayload>(
    'put',
    `/api/action-center/tasks/${resolvedTaskId}/reschedule`,
    { onSuccess: handleSuccess },
  );
  const completeMutation = useApiMutation<unknown, RequiredNotePayload>(
    'put',
    `/api/action-center/tasks/${resolvedTaskId}/complete`,
    { onSuccess: handleSuccess },
  );
  const cancelMutation = useApiMutation<unknown, RequiredNotePayload>(
    'put',
    `/api/action-center/tasks/${resolvedTaskId}/cancel`,
    { onSuccess: handleSuccess },
  );

  const mutations = useMemo(
    () => [assignMutation, startMutation, rescheduleMutation, completeMutation, cancelMutation],
    [assignMutation, cancelMutation, completeMutation, rescheduleMutation, startMutation],
  );
  const anyPending = mutations.some((mutation) => mutation.isPending);
  const conflict = mutations.some((mutation) => mutation.isError && errorStatus(mutation.error) === 409);
  const actionError = mutations.some((mutation) => mutation.isError && errorStatus(mutation.error) !== 409);
  const refreshAfterConflict = useCallback(async () => {
    mutations.forEach((mutation) => mutation.reset?.());
    await refreshTask();
  }, [mutations, refreshTask]);

  const task = detailQuery.data?.data;
  const events = eventsQuery.data?.data ?? [];
  const staff = staffQuery.data?.staff ?? [];
  const sourceHref = tenantSourceHref(slug, task?.sourceHref ?? null);
  const visibleStatus: TaskStatus | 'overdue' = task?.isOverdue && task.status !== 'completed' && task.status !== 'cancelled'
    ? 'overdue'
    : (task?.status ?? 'open');
  const terminal = task?.status === 'completed' || task?.status === 'cancelled';

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && action && actionDialogRef.current) {
        const focusable = Array.from(actionDialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
          return;
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
          return;
        }
      }
      if (event.key !== 'Escape') return;
      if (action) {
        setAction(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [action, onClose, open]);

  useEffect(() => {
    if (!task) return;
    setAssignee(task.assignedTo ? String(task.assignedTo) : '');
    setDueAt(toDateTimeLocal(task.dueAtUtc));
  }, [task]);

  useLayoutEffect(() => {
    if (!action) {
      actionTriggerRef.current?.focus();
      actionTriggerRef.current = null;
      return;
    }
    const selector = action === 'assign'
      ? 'select'
      : action === 'reschedule'
        ? 'input[type="datetime-local"]'
        : 'textarea';
    actionDialogRef.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [action]);

  if (!open) return null;

  const openAction = (
    nextAction: TaskAction,
    trigger = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null,
  ) => {
    actionTriggerRef.current = trigger;
    setNote('');
    setAssignee(task?.assignedTo ? String(task.assignedTo) : '');
    setDueAt(toDateTimeLocal(task?.dueAtUtc ?? null));
    setAction(nextAction);
  };

  const submitAction = () => {
    if (!task || !action || anyPending) return;
    const expectedUpdatedAtUtc = task.updatedAtUtc;

    if (action === 'assign') {
      const assignedTo = Number(assignee);
      if (!Number.isInteger(assignedTo) || assignedTo <= 0) return;
      assignMutation.mutate({ assignedTo, ...optionalNote(note), expectedUpdatedAtUtc });
      return;
    }
    if (action === 'start') {
      startMutation.mutate({ ...optionalNote(note), expectedUpdatedAtUtc });
      return;
    }
    if (action === 'reschedule') {
      if (!dueAt) return;
      const dueDate = new Date(dueAt);
      if (Number.isNaN(dueDate.getTime())) return;
      rescheduleMutation.mutate({ dueAtUtc: dueDate.toISOString(), ...optionalNote(note), expectedUpdatedAtUtc });
      return;
    }

    const requiredNote = note.trim();
    if (!requiredNote) return;
    if (action === 'complete') {
      completeMutation.mutate({ note: requiredNote, expectedUpdatedAtUtc });
    } else {
      cancelMutation.mutate({ note: requiredNote, expectedUpdatedAtUtc });
    }
  };

  const dialogTitleKey = action ? `tasks.drawer.dialog.${action}Title` : '';
  const submitLabelKey: Record<TaskAction, string> = {
    assign: 'tasks.actions.saveAssignment',
    start: 'tasks.actions.startTask',
    reschedule: 'tasks.actions.saveSchedule',
    complete: 'tasks.actions.completeTask',
    cancel: 'tasks.actions.cancelTask',
  };
  const submitDisabled = anyPending
    || (action === 'assign' && !assignee)
    || (action === 'reschedule' && !dueAt)
    || ((action === 'complete' || action === 'cancel') && !note.trim());

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/35" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !action) onClose();
    }}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-detail-title"
        className="flex h-full w-full max-w-2xl flex-col bg-[var(--color-bg-card)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border-light)] px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
              {t('tasks.drawer.source')}
            </p>
            <h2 id="task-detail-title" className="mt-1 break-words text-xl font-bold text-[var(--color-text-primary)]">
              {task?.title ?? t('tasks.loading')}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label={t('tasks.actions.close')}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--color-border-light)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {detailQuery.isLoading ? (
            <div role="status" className="flex min-h-40 items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('tasks.loading')}
            </div>
          ) : null}

          {detailQuery.isError ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <p>{t('tasks.error')}</p>
              <button
                type="button"
                className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-red-300 px-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                onClick={() => void refreshTask()}
              >
                {t('tasks.retry')}
              </button>
            </div>
          ) : null}

          {task ? (
            <div className="space-y-5">
              <section className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-4">
                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${PRIORITY_STYLES[task.priority]}`}>
                    {t(`tasks.priorityLabels.${task.priority}`)}
                  </span>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${STATUS_STYLES[visibleStatus]}`}>
                    {t(`tasks.statusLabels.${visibleStatus}`)}
                  </span>
                </div>
                {task.description ? (
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[var(--color-text-primary)]">{task.description}</p>
                ) : null}
                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-[var(--color-text-muted)]">{t('tasks.drawer.assignee')}</dt>
                    <dd className="mt-1 font-semibold text-[var(--color-text-primary)]">
                      {task.assignedToName ?? t('tasks.drawer.unassigned')}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--color-text-muted)]">{t('tasks.drawer.due')}</dt>
                    <dd className="mt-1 font-data text-[var(--color-text-primary)]">{formatDateTime(task.dueAtUtc, i18n.language)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--color-text-muted)]">{t('tasks.drawer.created')}</dt>
                    <dd className="mt-1 font-data text-[var(--color-text-primary)]">{formatDateTime(task.createdAtUtc, i18n.language)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-[var(--color-text-muted)]">{t('tasks.drawer.updated')}</dt>
                    <dd className="mt-1 font-data text-[var(--color-text-primary)]">{formatDateTime(task.updatedAtUtc, i18n.language)}</dd>
                  </div>
                  {task.completedByName ? (
                    <div>
                      <dt className="font-medium text-[var(--color-text-muted)]">{t('tasks.drawer.completedBy')}</dt>
                      <dd className="mt-1 text-[var(--color-text-primary)]">{task.completedByName}</dd>
                    </div>
                  ) : null}
                  {task.completionNote ? (
                    <div className="sm:col-span-2">
                      <dt className="font-medium text-[var(--color-text-muted)]">{t('tasks.drawer.completionNote')}</dt>
                      <dd className="mt-1 whitespace-pre-wrap text-[var(--color-text-primary)]">{task.completionNote}</dd>
                    </div>
                  ) : null}
                </dl>

                {sourceHref ? (
                  <Link
                    to={sourceHref}
                    aria-label={t('tasks.actions.openSource')}
                    className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-light)] px-4 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    {t('tasks.actions.openSource')}
                  </Link>
                ) : null}
              </section>

              {conflict ? (
                <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p>{t('tasks.conflict')}</p>
                  <button
                    type="button"
                    className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 px-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
                    onClick={() => void refreshAfterConflict()}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    {t('tasks.actions.refreshTask')}
                  </button>
                </div>
              ) : null}

              {actionError && !action ? (
                <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {t('tasks.actionError')}
                </div>
              ) : null}

              {!terminal ? (
                <section aria-labelledby="task-actions-title" className="rounded-2xl border border-[var(--color-border-light)] p-4">
                  <h3 id="task-actions-title" className="font-semibold text-[var(--color-text-primary)]">{t('tasks.drawer.actions')}</h3>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {canManage ? (
                      <button type="button" disabled={anyPending} onClick={(event) => openAction('assign', event.currentTarget)} className="min-h-11 rounded-xl border border-[var(--color-border-light)] px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
                        {t('tasks.actions.assign')}
                      </button>
                    ) : null}
                    {task.status === 'open' ? (
                      <button type="button" disabled={anyPending} onClick={() => openAction('start')} className="min-h-11 rounded-xl border border-[var(--color-border-light)] px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
                        {t('tasks.actions.start')}
                      </button>
                    ) : null}
                    <button type="button" disabled={anyPending} onClick={() => openAction('reschedule')} className="min-h-11 rounded-xl border border-[var(--color-border-light)] px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">
                      {t('tasks.actions.reschedule')}
                    </button>
                    <button type="button" disabled={anyPending} onClick={() => openAction('complete')} className="min-h-11 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                      {t('tasks.actions.complete')}
                    </button>
                    <button type="button" disabled={anyPending} onClick={() => openAction('cancel')} className="min-h-11 rounded-xl border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                      {t('tasks.actions.cancel')}
                    </button>
                  </div>
                </section>
              ) : null}

              <section aria-labelledby="task-timeline-title" className="rounded-2xl border border-[var(--color-border-light)] p-4">
                <h3 id="task-timeline-title" className="font-semibold text-[var(--color-text-primary)]">{t('tasks.timeline.title')}</h3>
                {eventsQuery.isLoading ? <p role="status" className="mt-3 text-sm text-[var(--color-text-muted)]">{t('tasks.loading')}</p> : null}
                {!eventsQuery.isLoading && events.length === 0 ? <p className="mt-3 text-sm text-[var(--color-text-muted)]">{t('tasks.timeline.empty')}</p> : null}
                <ol className="mt-3 space-y-3">
                  {events.map((event) => (
                    <li key={event.id} className="border-l-2 border-[var(--color-border-light)] pl-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                          {t(`tasks.event.${event.eventType}`)}
                        </p>
                        <time className="font-data text-xs text-[var(--color-text-muted)]">{formatDateTime(event.createdAtUtc, i18n.language)}</time>
                      </div>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {event.actorName ? `${t('tasks.timeline.by')}: ${event.actorName}` : t('tasks.timeline.system')}
                      </p>
                      {event.note ? <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-text-primary)]">{event.note}</p> : null}
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          ) : null}
        </div>
      </aside>

      {action ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/45 p-4">
          <div
            ref={actionDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="task-action-dialog-title"
            className="w-full max-w-lg rounded-2xl bg-[var(--color-bg-card)] p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <h3 id="task-action-dialog-title" className="text-lg font-bold text-[var(--color-text-primary)]">
                {t(dialogTitleKey)}
              </h3>
              <button
                type="button"
                aria-label={t('tasks.actions.closeDialog')}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--color-border-light)]"
                onClick={() => setAction(null)}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {actionError ? (
              <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {t('tasks.actionError')}
              </div>
            ) : null}

            <form className="mt-4 space-y-4" onSubmit={(event) => {
              event.preventDefault();
              submitAction();
            }}>
              {action === 'assign' ? (
                <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                  <span>{t('tasks.drawer.fields.assignee')}</span>
                  <select
                    data-autofocus="true"
                    value={assignee}
                    onChange={(event) => setAssignee(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] px-3"
                  >
                    <option value="">{t('tasks.drawer.unassigned')}</option>
                    {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </label>
              ) : null}

              {action === 'reschedule' ? (
                <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                  <span>{t('tasks.drawer.fields.dueAt')}</span>
                  <input
                    data-autofocus="true"
                    type="datetime-local"
                    value={dueAt}
                    onChange={(event) => setDueAt(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-xl border border-[var(--color-border-light)] px-3"
                  />
                </label>
              ) : null}

              <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                <span>{t(action === 'complete' || action === 'cancel' ? 'tasks.drawer.fields.noteRequired' : 'tasks.drawer.fields.noteOptional')}</span>
                <textarea
                  data-autofocus={action === 'start' || action === 'complete' || action === 'cancel' ? 'true' : undefined}
                  value={note}
                  required={action === 'complete' || action === 'cancel'}
                  onChange={(event) => setNote(event.target.value)}
                  rows={4}
                  className="mt-2 w-full rounded-xl border border-[var(--color-border-light)] px-3 py-3"
                />
              </label>

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  className="min-h-11 rounded-xl border border-[var(--color-border-light)] px-4 text-sm font-semibold"
                  onClick={() => setAction(null)}
                >
                  {t('tasks.actions.closeDialog')}
                </button>
                <button
                  type="submit"
                  disabled={submitDisabled}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {anyPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                  {t(submitLabelKey[action])}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
