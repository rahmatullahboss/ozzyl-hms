import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, ExternalLink, RefreshCw, UserCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { useAuth } from '../../hooks/useAuth';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTime } from '../../lib/format';
import type {
  ExceptionDetailResponse,
  ExceptionEventsResponse,
  ExceptionStatus,
} from './exceptionTypes';

interface ExceptionDetailDrawerProps {
  open: boolean;
  caseId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}

const ACTIVE_STATUSES = new Set<ExceptionStatus>(['open', 'acknowledged', 'in_progress', 'snoozed']);

function statusTone(status: ExceptionStatus): string {
  if (status === 'resolved') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'dismissed') return 'bg-slate-100 text-slate-700 ring-slate-200';
  if (status === 'in_progress') return 'bg-blue-50 text-blue-700 ring-blue-200';
  if (status === 'acknowledged') return 'bg-cyan-50 text-cyan-700 ring-cyan-200';
  if (status === 'snoozed') return 'bg-violet-50 text-violet-700 ring-violet-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function severityTone(severity: string): string {
  if (severity === 'critical') return 'bg-red-50 text-red-700 ring-red-200';
  if (severity === 'info') return 'bg-blue-50 text-blue-700 ring-blue-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function sourceUrl(slug: string, href: string | null): string | null {
  if (!href || !href.startsWith('/')) return null;
  return `/h/${slug}${href}`;
}

export default function ExceptionDetailDrawer({
  open,
  caseId,
  onClose,
  onChanged,
}: ExceptionDetailDrawerProps) {
  const { t } = useTranslation('adminPages');
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const [snoozedUntil, setSnoozedUntil] = useState('');
  const [resolutionCode, setResolutionCode] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [dismissalReason, setDismissalReason] = useState('');
  const [reopenNote, setReopenNote] = useState('');

  const enabled = open && Number.isInteger(caseId) && Number(caseId) > 0;
  const id = enabled ? Number(caseId) : 0;
  const detailQuery = useApiQuery<ExceptionDetailResponse>(
    queryKeys.actionCenter.exceptions.detail(id),
    `/api/action-center/exceptions/${id}`,
    { enabled },
  );
  const eventsQuery = useApiQuery<ExceptionEventsResponse>(
    queryKeys.actionCenter.exceptions.events(id),
    `/api/action-center/exceptions/${id}/events`,
    { enabled },
  );

  const handleSuccess = async () => {
    setSnoozedUntil('');
    setResolutionCode('');
    setResolutionNote('');
    setDismissalReason('');
    setReopenNote('');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.actionCenter.exceptions.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.actionCenter.summary() }),
    ]);
    await Promise.all([detailQuery.refetch(), eventsQuery.refetch()]);
    onChanged?.();
  };

  const acknowledgeMutation = useApiMutation<ExceptionDetailResponse, Record<string, never>>(
    'put', `/api/action-center/exceptions/${id}/acknowledge`, { onSuccess: handleSuccess },
  );
  const assignMutation = useApiMutation<ExceptionDetailResponse, { assignedTo: number }>(
    'put', `/api/action-center/exceptions/${id}/assign`, { onSuccess: handleSuccess },
  );
  const startMutation = useApiMutation<ExceptionDetailResponse, Record<string, never>>(
    'put', `/api/action-center/exceptions/${id}/start`, { onSuccess: handleSuccess },
  );
  const snoozeMutation = useApiMutation<ExceptionDetailResponse, { snoozedUntil: string }>(
    'put', `/api/action-center/exceptions/${id}/snooze`, { onSuccess: handleSuccess },
  );
  const resolveMutation = useApiMutation<ExceptionDetailResponse, { resolutionCode: string; note: string }>(
    'put', `/api/action-center/exceptions/${id}/resolve`, { onSuccess: handleSuccess },
  );
  const dismissMutation = useApiMutation<ExceptionDetailResponse, { reason: string }>(
    'put', `/api/action-center/exceptions/${id}/dismiss`, { onSuccess: handleSuccess },
  );
  const reopenMutation = useApiMutation<ExceptionDetailResponse, { note: string }>(
    'put', `/api/action-center/exceptions/${id}/reopen`, { onSuccess: handleSuccess },
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setSnoozedUntil('');
    setResolutionCode('');
    setResolutionNote('');
    setDismissalReason('');
    setReopenNote('');
  }, [caseId]);

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open]);

  if (!open || !caseId) return null;

  const exceptionCase = detailQuery.data?.data;
  const events = eventsQuery.data?.data ?? [];
  const mutations = [
    acknowledgeMutation,
    assignMutation,
    startMutation,
    snoozeMutation,
    resolveMutation,
    dismissMutation,
    reopenMutation,
  ];
  const isPending = mutations.some((item) => item.isPending);
  const failedMutation = mutations.find((item) => item.isError);
  const isConflict = Number((failedMutation?.error as { status?: number } | null)?.status) === 409;
  const active = exceptionCase ? ACTIVE_STATUSES.has(exceptionCase.status) : false;
  const source = exceptionCase ? sourceUrl(slug, exceptionCase.sourceHref) : null;
  const userId = Number(user?.userId ?? 0);

  return (
    <div className="fixed inset-0 z-50" aria-live="polite">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-slate-950/35"
        aria-label={t('alerts.close')}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-[var(--color-border-light)] bg-[var(--color-bg-card)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border-light)] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
              {t('alerts.drawer.eyebrow')}
            </p>
            <h2 id={titleId} className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">
              {exceptionCase?.title ?? t('alerts.drawer.loadingTitle')}
            </h2>
            {exceptionCase ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${severityTone(exceptionCase.severity)}`}>
                  {t(`alerts.severity.${exceptionCase.severity}`)}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusTone(exceptionCase.status)}`}>
                  {t(`alerts.status.${exceptionCase.status}`)}
                </span>
              </div>
            ) : null}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            aria-label={t('alerts.close')}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {detailQuery.isLoading ? (
            <p role="status" className="text-sm text-[var(--color-text-muted)]">{t('alerts.drawer.loading')}</p>
          ) : detailQuery.isError || !exceptionCase ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {t('alerts.drawer.error')}
            </div>
          ) : (
            <div className="space-y-5">
              {isConflict ? (
                <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">{t('alerts.conflict')}</p>
                  <button
                    type="button"
                    className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                    onClick={() => {
                      void detailQuery.refetch();
                      void eventsQuery.refetch();
                    }}
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    {t('alerts.refreshCase')}
                  </button>
                </div>
              ) : failedMutation ? (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {t('alerts.actionError')}
                </div>
              ) : null}

              <section className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-subtle)] p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                  <div>
                    <p className="text-sm leading-6 text-[var(--color-text-primary)]">{exceptionCase.description}</p>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div><dt className="text-xs text-[var(--color-text-muted)]">{t('alerts.fields.rule')}</dt><dd className="mt-1 font-medium">{exceptionCase.ruleKey}</dd></div>
                      <div><dt className="text-xs text-[var(--color-text-muted)]">{t('alerts.fields.module')}</dt><dd className="mt-1 font-medium">{exceptionCase.module}</dd></div>
                      <div><dt className="text-xs text-[var(--color-text-muted)]">{t('alerts.fields.assignee')}</dt><dd className="mt-1 font-medium">{exceptionCase.assignedToName ?? t('alerts.unassigned')}</dd></div>
                      <div><dt className="text-xs text-[var(--color-text-muted)]">{t('alerts.fields.slaAge')}</dt><dd className="mt-1 font-data font-medium">{exceptionCase.slaAgeHours}h</dd></div>
                      <div><dt className="text-xs text-[var(--color-text-muted)]">{t('alerts.fields.firstDetected')}</dt><dd className="mt-1 font-medium">{formatDateTime(exceptionCase.firstDetectedAt)}</dd></div>
                      <div><dt className="text-xs text-[var(--color-text-muted)]">{t('alerts.fields.lastDetected')}</dt><dd className="mt-1 font-medium">{formatDateTime(exceptionCase.lastDetectedAt)}</dd></div>
                    </dl>
                    {source ? (
                      <a
                        href={source}
                        className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] px-3 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        {t('alerts.openSource')}
                      </a>
                    ) : null}
                  </div>
                </div>
              </section>

              {active ? (
                <section aria-labelledby={`${titleId}-actions`} className="space-y-4 rounded-2xl border border-[var(--color-border-light)] p-4">
                  <h3 id={`${titleId}-actions`} className="font-semibold text-[var(--color-text-primary)]">{t('alerts.drawer.actionsTitle')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {exceptionCase.status === 'open' || exceptionCase.status === 'snoozed' ? (
                      <button type="button" disabled={isPending} onClick={() => acknowledgeMutation.mutate({})} className="btn-secondary min-h-11 disabled:opacity-50">
                        {t('alerts.actions.acknowledge')}
                      </button>
                    ) : null}
                    {userId > 0 ? (
                      <button type="button" disabled={isPending} onClick={() => assignMutation.mutate({ assignedTo: userId })} className="btn-secondary min-h-11 disabled:opacity-50">
                        <UserCheck className="mr-2 inline h-4 w-4" aria-hidden="true" />
                        {t('alerts.actions.assignToMe')}
                      </button>
                    ) : null}
                    {exceptionCase.status === 'open' || exceptionCase.status === 'acknowledged' || exceptionCase.status === 'snoozed' ? (
                      <button type="button" disabled={isPending} onClick={() => startMutation.mutate({})} className="btn-secondary min-h-11 disabled:opacity-50">
                        {t('alerts.actions.start')}
                      </button>
                    ) : null}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium text-[var(--color-text-primary)]">
                      <span className="mb-1 block">{t('alerts.fields.snoozedUntil')}</span>
                      <input type="datetime-local" value={snoozedUntil} onChange={(event) => setSnoozedUntil(event.target.value)} className="input min-h-11 w-full" />
                    </label>
                    <div className="flex items-end">
                      <button type="button" disabled={isPending || !snoozedUntil} onClick={() => snoozeMutation.mutate({ snoozedUntil })} className="btn-secondary min-h-11 w-full disabled:opacity-50">
                        {t('alerts.actions.snooze')}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-3 rounded-xl bg-[var(--color-bg-subtle)] p-3">
                    <label className="text-sm font-medium">
                      <span className="mb-1 block">{t('alerts.fields.resolutionCode')}</span>
                      <input value={resolutionCode} onChange={(event) => setResolutionCode(event.target.value)} className="input min-h-11 w-full" />
                    </label>
                    <label className="text-sm font-medium">
                      <span className="mb-1 block">{t('alerts.fields.resolutionNote')}</span>
                      <textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} rows={3} className="input w-full resize-y" />
                    </label>
                    <button type="button" disabled={isPending || !resolutionCode.trim() || !resolutionNote.trim()} onClick={() => resolveMutation.mutate({ resolutionCode: resolutionCode.trim(), note: resolutionNote.trim() })} className="btn-primary min-h-11 disabled:opacity-50">
                      {t('alerts.actions.resolve')}
                    </button>
                  </div>

                  <div className="grid gap-3 rounded-xl border border-red-100 bg-red-50/60 p-3">
                    <label className="text-sm font-medium text-red-900">
                      <span className="mb-1 block">{t('alerts.fields.dismissalReason')}</span>
                      <textarea value={dismissalReason} onChange={(event) => setDismissalReason(event.target.value)} rows={2} className="input w-full resize-y" />
                    </label>
                    <button type="button" disabled={isPending || !dismissalReason.trim()} onClick={() => dismissMutation.mutate({ reason: dismissalReason.trim() })} className="min-h-11 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                      {t('alerts.actions.dismiss')}
                    </button>
                  </div>
                </section>
              ) : (
                <section className="space-y-3 rounded-2xl border border-[var(--color-border-light)] p-4">
                  <h3 className="font-semibold">{t('alerts.drawer.reopenTitle')}</h3>
                  <label className="text-sm font-medium">
                    <span className="mb-1 block">{t('alerts.fields.reopenNote')}</span>
                    <textarea value={reopenNote} onChange={(event) => setReopenNote(event.target.value)} rows={3} className="input w-full resize-y" />
                  </label>
                  <button type="button" disabled={isPending || !reopenNote.trim()} onClick={() => reopenMutation.mutate({ note: reopenNote.trim() })} className="btn-primary min-h-11 disabled:opacity-50">
                    {t('alerts.actions.reopen')}
                  </button>
                </section>
              )}

              <section aria-labelledby={`${titleId}-timeline`} className="rounded-2xl border border-[var(--color-border-light)] p-4">
                <h3 id={`${titleId}-timeline`} className="font-semibold text-[var(--color-text-primary)]">{t('alerts.drawer.timelineTitle')}</h3>
                {eventsQuery.isLoading ? (
                  <p role="status" className="mt-3 text-sm text-[var(--color-text-muted)]">{t('alerts.drawer.timelineLoading')}</p>
                ) : events.length === 0 ? (
                  <p className="mt-3 text-sm text-[var(--color-text-muted)]">{t('alerts.drawer.timelineEmpty')}</p>
                ) : (
                  <ol className="mt-4 space-y-4">
                    {events.map((event) => (
                      <li key={event.id} className="relative border-l-2 border-[var(--color-border-light)] pl-4">
                        <div className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-[var(--color-primary)]" />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{t(`alerts.events.${event.eventType}`, { defaultValue: event.eventType })}</p>
                          <time className="text-xs text-[var(--color-text-muted)]">{formatDateTime(event.createdAt)}</time>
                        </div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{event.actorName ?? t('alerts.systemActor')}</p>
                        {event.note ? <p className="mt-1 text-sm text-[var(--color-text-primary)]">{event.note}</p> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
