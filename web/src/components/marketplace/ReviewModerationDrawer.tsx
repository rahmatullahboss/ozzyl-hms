import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquare,
  RefreshCw,
  Star,
  X,
  XCircle,
} from 'lucide-react';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';

export type ReviewRejectionReason =
  | 'abusive_language'
  | 'personal_information'
  | 'spam'
  | 'irrelevant_content'
  | 'conflict_of_interest'
  | 'fraudulent_review'
  | 'other';

export interface MarketplaceReview {
  id: number;
  reviewer_name?: string | null;
  target_type: string;
  doctor_name?: string | null;
  rating: number;
  review_text?: string | null;
  is_approved: -1 | 0 | 1 | number;
  created_at: string;
  provider_reply?: string | null;
  provider_reply_at_utc?: string | null;
  moderation_reason_code?: ReviewRejectionReason | null;
  moderation_note?: string | null;
  moderated_at_utc?: string | null;
}

interface ModerationEvent {
  id: number;
  reviewId: number;
  eventType: 'approved' | 'rejected' | 'reply_posted' | string;
  actorId: number;
  actorName: string | null;
  reasonCode: ReviewRejectionReason | null;
  note: string | null;
  oldState: -1 | 0 | 1;
  newState: -1 | 0 | 1;
  metadata: Record<string, unknown>;
  createdAtUtc: string;
}

interface EventsResponse {
  data: ModerationEvent[];
}

interface ReviewModerationDrawerProps {
  open: boolean;
  review: MarketplaceReview | null;
  onClose: () => void;
  onChanged?: () => void;
}

type DrawerAction = 'approve' | 'reject' | 'reply';

const REJECTION_REASONS: ReviewRejectionReason[] = [
  'abusive_language',
  'personal_information',
  'spam',
  'irrelevant_content',
  'conflict_of_interest',
  'fraudulent_review',
  'other',
];

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusKey(value: number): 'pending' | 'approved' | 'rejected' {
  if (value === 1) return 'approved';
  if (value === -1) return 'rejected';
  return 'pending';
}

function optionalNote(value: string): { note?: string } {
  const note = value.trim();
  return note ? { note } : {};
}

export default function ReviewModerationDrawer({
  open,
  review,
  onClose,
  onChanged,
}: ReviewModerationDrawerProps) {
  const { t, i18n } = useTranslation(['marketplace', 'common']);
  const queryClient = useQueryClient();
  const reviewId = review?.id ?? 0;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const actionDialogRef = useRef<HTMLDivElement>(null);
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const [action, setAction] = useState<DrawerAction | null>(null);
  const [note, setNote] = useState('');
  const [reasonCode, setReasonCode] = useState<ReviewRejectionReason | ''>('');
  const [replyText, setReplyText] = useState('');
  const [reasonError, setReasonError] = useState(false);

  const eventsQuery = useApiQuery<EventsResponse>(
    ['marketplace', 'reviews', 'events', reviewId],
    `/api/v1/marketplace/reviews/${reviewId}/moderation-events`,
    { enabled: open && review !== null, staleTime: 15_000 },
  );

  const handleSuccess = useCallback(async () => {
    setAction(null);
    setNote('');
    setReasonCode('');
    setReplyText('');
    setReasonError(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['marketplace', 'reviews'] }),
      eventsQuery.refetch(),
    ]);
    onChanged?.();
  }, [eventsQuery, onChanged, queryClient]);

  const approveMutation = useApiMutation<unknown, { note?: string }>(
    'put',
    `/api/v1/marketplace/reviews/${reviewId}/approve`,
    { onSuccess: handleSuccess },
  );
  const rejectMutation = useApiMutation<unknown, { reasonCode: ReviewRejectionReason; note?: string }>(
    'put',
    `/api/v1/marketplace/reviews/${reviewId}/reject`,
    { onSuccess: handleSuccess },
  );
  const replyMutation = useApiMutation<unknown, { reply_text: string }>(
    'post',
    `/api/v1/marketplace/reviews/${reviewId}/reply`,
    { onSuccess: handleSuccess },
  );

  const mutations = useMemo(
    () => [approveMutation, rejectMutation, replyMutation],
    [approveMutation, rejectMutation, replyMutation],
  );
  const anyPending = mutations.some((mutation) => mutation.isPending);
  const conflict = mutations.some((mutation) => mutation.isError && errorStatus(mutation.error) === 409);
  const actionError = mutations.some((mutation) => mutation.isError && errorStatus(mutation.error) !== 409);
  const events = eventsQuery.data?.data ?? [];

  const restorePreviousFocus = useCallback(() => {
    previousFocusRef.current?.focus();
  }, []);

  const closeDrawer = useCallback(() => {
    if (anyPending) return;
    setAction(null);
    restorePreviousFocus();
    onClose();
  }, [anyPending, onClose, restorePreviousFocus]);

  const closeAction = useCallback(() => {
    if (anyPending) return;
    setAction(null);
    setReasonError(false);
    actionTriggerRef.current?.focus();
  }, [anyPending]);

  const openAction = useCallback((nextAction: DrawerAction, trigger: HTMLButtonElement) => {
    actionTriggerRef.current = trigger;
    setAction(nextAction);
    setNote('');
    setReasonCode('');
    setReasonError(false);
    setReplyText(nextAction === 'reply' ? (review?.provider_reply ?? '') : '');
  }, [review?.provider_reply]);

  const refreshAfterConflict = useCallback(async () => {
    mutations.forEach((mutation) => mutation.reset?.());
    await eventsQuery.refetch();
    onChanged?.();
  }, [eventsQuery, mutations, onChanged]);

  useLayoutEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    return () => restorePreviousFocus();
  }, [open, restorePreviousFocus]);

  useLayoutEffect(() => {
    if (!action) return;
    const focusable = actionDialogRef.current?.querySelector<HTMLElement>(
      'select, textarea, input, button:not([disabled])',
    );
    focusable?.focus();
  }, [action]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (action) closeAction();
        else closeDrawer();
        return;
      }
      if (event.key !== 'Tab') return;

      const container = action ? actionDialogRef.current : closeButtonRef.current?.closest('[role="dialog"]');
      if (!(container instanceof HTMLElement)) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [action, closeAction, closeDrawer, open]);

  if (!open || !review) return null;

  const stateKey = statusKey(review.is_approved);
  const target = review.doctor_name || t('marketplace:reviews.hospital');

  return (
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/45" aria-hidden={false}>
      <section
        role="dialog"
        aria-modal="true"
        aria-hidden={action ? true : undefined}
        aria-label={t('marketplace:reviews.drawer.title')}
        className="h-full w-full max-w-2xl overflow-y-auto bg-[var(--color-bg-card)] shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {t('marketplace:reviews.drawer.patientExperience')}
            </p>
            <h2 className="text-xl font-semibold text-[var(--color-text)]">
              {t('marketplace:reviews.drawer.title')}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeDrawer}
            disabled={anyPending}
            aria-label={t('marketplace:reviews.drawer.close')}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--color-border)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-5 p-4 sm:p-6">
          {conflict && (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <p>{t('marketplace:reviews.drawer.conflict')}</p>
              <button
                type="button"
                onClick={() => void refreshAfterConflict()}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-400 px-3 font-medium"
              >
                <RefreshCw className="h-4 w-4" />
                {t('marketplace:reviews.drawer.refresh')}
              </button>
            </div>
          )}
          {actionError && !conflict && (
            <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
              {t('marketplace:reviews.drawer.actionError')}
            </div>
          )}

          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text)]">
                  {review.reviewer_name || t('marketplace:reviews.anonymous')}
                </p>
                <p className="text-sm text-[var(--color-text-muted)]">{target}</p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                stateKey === 'approved'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : stateKey === 'rejected'
                    ? 'border-red-200 bg-red-50 text-red-800'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}>
                {t(`marketplace:reviews.status.${stateKey}`)}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-1" aria-label={`${review.rating}/5`}>
              {Array.from({ length: 5 }, (_, index) => (
                <Star
                  key={index}
                  className={`h-4 w-4 ${index < review.rating ? 'fill-amber-500 text-amber-500' : 'text-slate-300'}`}
                />
              ))}
            </div>
            <p className="mt-4 whitespace-pre-wrap break-words text-base leading-7 text-[var(--color-text)]">
              {review.review_text || '—'}
            </p>
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              {formatDateTime(review.created_at, i18n.language)}
            </p>
          </section>

          <section className="rounded-xl border border-[var(--color-border)] p-4">
            <h3 className="font-semibold text-[var(--color-text)]">{t('marketplace:reviews.drawer.providerReply')}</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-text-muted)]">
              {review.provider_reply || t('marketplace:reviews.drawer.noReply')}
            </p>
            {review.provider_reply_at_utc && (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                {formatDateTime(review.provider_reply_at_utc, i18n.language)}
              </p>
            )}
          </section>

          {review.moderation_reason_code && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              <p className="font-semibold">{t(`marketplace:reviews.reasons.${review.moderation_reason_code}`)}</p>
              {review.moderation_note && <p className="mt-2 whitespace-pre-wrap">{review.moderation_note}</p>}
            </section>
          )}

          <section aria-label={t('marketplace:reviews.drawer.actions')}>
            <h3 className="font-semibold text-[var(--color-text)]">{t('marketplace:reviews.drawer.actions')}</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {review.is_approved === 0 && (
                <>
                  <button
                    type="button"
                    disabled={anyPending}
                    onClick={(event) => openAction('approve', event.currentTarget)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {t('marketplace:reviews.approve')}
                  </button>
                  <button
                    type="button"
                    disabled={anyPending}
                    onClick={(event) => openAction('reject', event.currentTarget)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-red-300 px-4 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" />
                    {t('marketplace:reviews.reject')}
                  </button>
                </>
              )}
              <button
                type="button"
                disabled={anyPending}
                onClick={(event) => openAction('reply', event.currentTarget)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] px-4 text-sm font-semibold text-[var(--color-text)] hover:bg-[var(--color-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MessageSquare className="h-4 w-4" />
                {t('marketplace:reviews.reply')}
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border)] p-4">
            <h3 className="font-semibold text-[var(--color-text)]">{t('marketplace:reviews.drawer.timeline')}</h3>
            {eventsQuery.isLoading ? (
              <div role="status" className="mt-3 flex min-h-16 items-center gap-2 text-sm text-[var(--color-text-muted)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('marketplace:reviews.drawer.timelineLoading')}
              </div>
            ) : eventsQuery.isError ? (
              <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p>{t('marketplace:reviews.drawer.timelineError')}</p>
                <button type="button" onClick={() => void eventsQuery.refetch()} className="mt-2 min-h-11 font-semibold underline">
                  {t('marketplace:reviews.retry')}
                </button>
              </div>
            ) : events.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">{t('marketplace:reviews.drawer.timelineEmpty')}</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {events.map((event) => (
                  <li key={event.id} className="flex gap-3 border-l-2 border-[var(--color-border)] pl-3">
                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--color-text)]">
                        {t(`marketplace:reviews.events.${event.eventType}`)} · {event.actorName || t('marketplace:reviews.drawer.system')}
                      </p>
                      {event.reasonCode && (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          {t(`marketplace:reviews.reasons.${event.reasonCode}`)}
                        </p>
                      )}
                      {event.note && <p className="whitespace-pre-wrap text-sm text-[var(--color-text-muted)]">{event.note}</p>}
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {formatDateTime(event.createdAtUtc, i18n.language)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </section>

      {action && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/55 p-4">
          <div
            ref={actionDialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t(`marketplace:reviews.drawer.${action}Title`)}
            className="w-full max-w-lg rounded-xl bg-[var(--color-bg-card)] p-5 shadow-2xl"
          >
            <h3 className="text-lg font-semibold text-[var(--color-text)]">
              {t(`marketplace:reviews.drawer.${action}Title`)}
            </h3>

            {action === 'reject' && (
              <div className="mt-4">
                <label htmlFor="review-rejection-reason" className="mb-1 block text-sm font-medium">
                  {t('marketplace:reviews.drawer.reason')}
                </label>
                <select
                  id="review-rejection-reason"
                  value={reasonCode}
                  disabled={anyPending}
                  onChange={(event) => {
                    setReasonCode(event.target.value as ReviewRejectionReason | '');
                    setReasonError(false);
                  }}
                  className="input min-h-11 w-full"
                >
                  <option value="">{t('marketplace:reviews.drawer.selectReason')}</option>
                  {REJECTION_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{t(`marketplace:reviews.reasons.${reason}`)}</option>
                  ))}
                </select>
                {reasonError && (
                  <p role="alert" className="mt-2 text-sm font-medium text-red-700">
                    {t('marketplace:reviews.drawer.reasonRequired')}
                  </p>
                )}
              </div>
            )}

            {(action === 'approve' || action === 'reject') && (
              <div className="mt-4">
                <label htmlFor="review-moderation-note" className="mb-1 block text-sm font-medium">
                  {t('marketplace:reviews.drawer.noteOptional')}
                </label>
                <textarea
                  id="review-moderation-note"
                  rows={4}
                  maxLength={2000}
                  value={note}
                  disabled={anyPending}
                  onChange={(event) => setNote(event.target.value)}
                  className="input min-h-28 w-full resize-y"
                />
              </div>
            )}

            {action === 'reply' && (
              <div className="mt-4">
                <label htmlFor="review-provider-reply" className="mb-1 block text-sm font-medium">
                  {t('marketplace:reviews.drawer.replyText')}
                </label>
                <textarea
                  id="review-provider-reply"
                  rows={5}
                  maxLength={4000}
                  value={replyText}
                  disabled={anyPending}
                  onChange={(event) => setReplyText(event.target.value)}
                  className="input min-h-32 w-full resize-y"
                />
              </div>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={anyPending}
                onClick={closeAction}
                className="min-h-11 rounded-lg border border-[var(--color-border)] px-4 text-sm font-semibold disabled:opacity-50"
              >
                {t('common:cancel')}
              </button>
              {action === 'approve' && (
                <button
                  type="button"
                  disabled={anyPending}
                  onClick={() => approveMutation.mutate(optionalNote(note))}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {anyPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('marketplace:reviews.drawer.confirmApprove')}
                </button>
              )}
              {action === 'reject' && (
                <button
                  type="button"
                  disabled={anyPending}
                  onClick={() => {
                    if (!reasonCode) {
                      setReasonError(true);
                      return;
                    }
                    rejectMutation.mutate({ reasonCode, ...optionalNote(note) });
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {anyPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('marketplace:reviews.drawer.confirmReject')}
                </button>
              )}
              {action === 'reply' && (
                <button
                  type="button"
                  disabled={anyPending || !replyText.trim()}
                  onClick={() => replyMutation.mutate({ reply_text: replyText.trim() })}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {anyPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('marketplace:reviews.drawer.postReply')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
