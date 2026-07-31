import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type {
  CollectionDetailResponse,
  CollectionEventsResponse,
} from './collectionTypes';

interface CollectionDetailDrawerProps {
  open: boolean;
  sourceKey: string | null;
  onClose: () => void;
  onChanged?: () => void;
}

function formatMinor(amountMinor: number, currencyCode: string, language: string): string {
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function majorInputToMinor(value: string): number | null {
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? '').padEnd(2, '0'));
  const minor = whole * 100n + fraction;
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

function validUtc(value: string): boolean {
  return value.endsWith('Z') && Number.isFinite(Date.parse(value));
}

function parseEvidenceUrls(value: string): string[] | null {
  const values = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (values.length > 10) return null;
  try {
    return Array.from(new Set(values.map((item) => {
      const url = new URL(item);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid protocol');
      return url.toString().replace(/\/$/, '');
    })));
  } catch {
    return null;
  }
}

function tenantHref(slug: string, href: string | null): string | null {
  if (!href?.startsWith('/')) return null;
  return `/h/${slug}${href}`;
}

export default function CollectionDetailDrawer({
  open,
  sourceKey,
  onClose,
  onChanged,
}: CollectionDetailDrawerProps) {
  const { t, i18n } = useTranslation('adminReceivables');
  const { slug = '' } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  const [contactChannel, setContactChannel] = useState<'phone' | 'sms' | 'whatsapp' | 'in_person' | 'other'>('phone');
  const [contactOutcome, setContactOutcome] = useState('');
  const [contactNote, setContactNote] = useState('');
  const [contactFollowup, setContactFollowup] = useState('');
  const [followupAt, setFollowupAt] = useState('');
  const [followupNote, setFollowupNote] = useState('');
  const [promiseDate, setPromiseDate] = useState('');
  const [promiseAmount, setPromiseAmount] = useState('');
  const [promiseNote, setPromiseNote] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [disputeNote, setDisputeNote] = useState('');
  const [escalationReason, setEscalationReason] = useState('');
  const [escalationNote, setEscalationNote] = useState('');
  const [escalationAssignee, setEscalationAssignee] = useState('');
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [writeOffAmount, setWriteOffAmount] = useState('');
  const [writeOffReason, setWriteOffReason] = useState('');
  const [writeOffNote, setWriteOffNote] = useState('');
  const [writeOffEvidence, setWriteOffEvidence] = useState('');
  const [writeOffAcknowledged, setWriteOffAcknowledged] = useState(false);

  const enabled = open && Boolean(sourceKey);
  const key = enabled ? String(sourceKey) : '';
  const detailPath = `/api/action-center/collections/invoice/${key}`;
  const eventsPath = `${detailPath}/events`;
  const detailQuery = useApiQuery<CollectionDetailResponse>(
    queryKeys.actionCenter.collections.detail(key),
    detailPath,
    { enabled },
  );
  const eventsQuery = useApiQuery<CollectionEventsResponse>(
    queryKeys.actionCenter.collections.events(key),
    eventsPath,
    { enabled },
  );

  const resetForms = () => {
    setContactChannel('phone');
    setContactOutcome('');
    setContactNote('');
    setContactFollowup('');
    setFollowupAt('');
    setFollowupNote('');
    setPromiseDate('');
    setPromiseAmount('');
    setPromiseNote('');
    setDisputeReason('');
    setDisputeNote('');
    setEscalationReason('');
    setEscalationNote('');
    setEscalationAssignee('');
    setWriteOffOpen(false);
    setWriteOffAmount('');
    setWriteOffReason('');
    setWriteOffNote('');
    setWriteOffEvidence('');
    setWriteOffAcknowledged(false);
  };

  const handleSuccess = async () => {
    resetForms();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.actionCenter.collections.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.actionCenter.summary() }),
    ]);
    await Promise.all([detailQuery.refetch(), eventsQuery.refetch()]);
    onChanged?.();
  };

  const contactMutation = useApiMutation<CollectionDetailResponse, {
    channel: typeof contactChannel;
    outcome: string;
    note: string;
    nextFollowupAtUtc?: string;
    expectedUpdatedAtUtc?: string;
  }>('post', `${detailPath}/contact`, { onSuccess: handleSuccess });
  const followupMutation = useApiMutation<CollectionDetailResponse, {
    nextFollowupAtUtc: string;
    note?: string;
    expectedUpdatedAtUtc?: string;
  }>('put', `${detailPath}/follow-up`, { onSuccess: handleSuccess });
  const promiseMutation = useApiMutation<CollectionDetailResponse, {
    promiseDate: string;
    promiseAmountMinor: number;
    currencyCode: string;
    note: string;
    expectedUpdatedAtUtc?: string;
  }>('put', `${detailPath}/promise`, { onSuccess: handleSuccess });
  const disputeMutation = useApiMutation<CollectionDetailResponse, {
    reason: string;
    note: string;
    expectedUpdatedAtUtc?: string;
  }>('put', `${detailPath}/dispute`, { onSuccess: handleSuccess });
  const escalateMutation = useApiMutation<CollectionDetailResponse, {
    reason: string;
    note: string;
    assignedTo?: number;
    expectedUpdatedAtUtc?: string;
  }>('put', `${detailPath}/escalate`, { onSuccess: handleSuccess });
  const writeOffMutation = useApiMutation<{ data: { approvalId: number; collectionCaseId: number } }, {
    amountMinor: number;
    currencyCode: string;
    reasonCode: 'uncollectible' | 'financial_hardship' | 'billing_dispute' | 'deceased' | 'administrative_adjustment' | 'other';
    note: string;
    evidenceUrls?: string[];
  }>('post', `${detailPath}/write-off-request`, { onSuccess: handleSuccess });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    resetForms();
  }, [sourceKey]);

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

  if (!open || !sourceKey) return null;

  const detail = detailQuery.data?.data;
  const events = eventsQuery.data?.data ?? [];
  const mutations = [contactMutation, followupMutation, promiseMutation, disputeMutation, escalateMutation];
  const isPending = mutations.some((mutation) => mutation.isPending);
  const failedMutation = mutations.find((mutation) => mutation.isError);
  const isConflict = Number((failedMutation?.error as { status?: number } | null)?.status) === 409;
  const writeOffErrorStatus = Number((writeOffMutation.error as { status?: number } | null)?.status);
  const expectedUpdatedAtUtc = detail?.updatedAtUtc ?? undefined;
  const promiseMinor = majorInputToMinor(promiseAmount);
  const writeOffMinor = majorInputToMinor(writeOffAmount);
  const writeOffEvidenceUrls = parseEvidenceUrls(writeOffEvidence);
  const contactValid = contactOutcome.trim().length > 0
    && contactNote.trim().length > 0
    && (!contactFollowup || validUtc(contactFollowup));
  const followupValid = validUtc(followupAt);
  const promiseValid = Boolean(
    detail
    && promiseDate
    && promiseMinor
    && promiseMinor <= detail.dueMinor
    && promiseNote.trim(),
  );
  const disputeValid = disputeReason.trim().length > 0 && disputeNote.trim().length > 0;
  const assignee = escalationAssignee.trim() ? Number(escalationAssignee) : undefined;
  const escalationValid = escalationReason.trim().length > 0
    && escalationNote.trim().length > 0
    && (assignee === undefined || (Number.isSafeInteger(assignee) && assignee > 0));
  const writeOffValid = Boolean(
    detail
    && detail.writeOffRequestCapability === 'available'
    && writeOffMinor
    && writeOffMinor <= detail.dueMinor
    && writeOffReason
    && writeOffNote.trim().length >= 10
    && writeOffNote.trim().length <= 2000
    && writeOffEvidenceUrls
    && writeOffAcknowledged,
  );
  const paymentLink = detail
    ? tenantHref(slug, detail.paymentHref)
    : null;

  const refresh = () => {
    void detailQuery.refetch();
    void eventsQuery.refetch();
  };

  return (
    <div className="fixed inset-0 z-50" aria-live="polite">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-slate-950/35"
        aria-label={t('dueReceivables.actions.close')}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col border-l border-[var(--color-border-light)] bg-[var(--color-bg-card)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border-light)] px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {t('dueReceivables.drawer.title')}
            </p>
            <h2 id={titleId} className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">
              {detail?.invoiceNumber ?? sourceKey}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{detail?.patientName ?? '—'}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('dueReceivables.actions.close')}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {detailQuery.isLoading && !detail ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => <div key={item} className="skeleton h-20 rounded-2xl" />)}
            </div>
          ) : null}

          {detailQuery.isError && !detail ? (
            <section role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900">
              {t('dueReceivables.error')}
            </section>
          ) : null}

          {isConflict ? (
            <section role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <p className="font-semibold">{t('dueReceivables.conflict')}</p>
              <button
                type="button"
                onClick={refresh}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl px-3 font-semibold ring-1 ring-amber-300"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {t('dueReceivables.actions.refreshCase')}
              </button>
            </section>
          ) : null}

          {detail ? (
            <>
              <section className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-subtle)] p-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)]">{t('dueReceivables.amount.total')}</p>
                    <p className="font-data font-semibold">{formatMinor(detail.totalMinor, detail.currencyCode, i18n.language)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)]">{t('dueReceivables.amount.paid')}</p>
                    <p className="font-data font-semibold text-emerald-700">{formatMinor(detail.paidMinor, detail.currencyCode, i18n.language)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)]">{t('dueReceivables.amount.credited')}</p>
                    <p className="font-data font-semibold">{formatMinor(detail.creditedMinor, detail.currencyCode, i18n.language)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)]">{t('dueReceivables.amount.due')}</p>
                    <p className="font-data font-bold text-red-700">{formatMinor(detail.dueMinor, detail.currencyCode, i18n.language)}</p>
                  </div>
                </div>
                <div className="mt-4 border-t border-[var(--color-border-light)] pt-4">
                  {detail.paymentCapability === 'available' && paymentLink ? (
                    <a
                      href={paymentLink}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                    >
                      {t('dueReceivables.payment.collect')}
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                  ) : (
                    <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                      {t('dueReceivables.payment.canonicalRequired')}
                    </p>
                  )}
                </div>
              </section>

              {detail.writeOffRequestCapability === 'available' ? (
                <section className="rounded-2xl border border-red-200 bg-red-50/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-red-900">
                        {t('dueReceivables.writeOff.title', { defaultValue: 'Controlled write-off request' })}
                      </h3>
                      <p className="mt-1 text-sm text-red-800">
                        {t('dueReceivables.writeOff.warning', { defaultValue: 'This does not change the balance now. It creates a high-risk request that requires two independent approvals.' })}
                      </p>
                    </div>
                    {!writeOffOpen ? (
                      <button
                        type="button"
                        onClick={() => {
                          setWriteOffAmount((detail.dueMinor / 100).toFixed(2));
                          setWriteOffOpen(true);
                        }}
                        className="inline-flex min-h-11 items-center justify-center rounded-xl border border-red-300 bg-white px-4 text-sm font-semibold text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                      >
                        {t('dueReceivables.writeOff.open', { defaultValue: 'Request write-off' })}
                      </button>
                    ) : null}
                  </div>

                  {writeOffOpen ? (
                    <div className="mt-4 space-y-3 border-t border-red-200 pt-4">
                      {writeOffMutation.isError ? (
                        <div role="alert" className="rounded-xl border border-red-300 bg-white p-3 text-sm text-red-900">
                          {writeOffErrorStatus === 409
                            ? t('dueReceivables.writeOff.duplicate', { defaultValue: 'A write-off request is already pending. Refresh the case before trying again.' })
                            : t('dueReceivables.writeOff.error', { defaultValue: 'The request could not be submitted. Your entered values have been retained.' })}
                        </div>
                      ) : null}

                      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                        <label className="block text-sm font-medium text-red-950">
                          <span className="mb-1 block">{t('dueReceivables.writeOff.amount', { defaultValue: 'Write-off amount' })}</span>
                          <input
                            inputMode="decimal"
                            aria-label={t('dueReceivables.writeOff.amount', { defaultValue: 'Write-off amount' })}
                            value={writeOffAmount}
                            onChange={(event) => setWriteOffAmount(event.target.value)}
                            className="input min-h-11 w-full bg-white"
                          />
                        </label>
                        <div className="self-end rounded-xl border border-red-200 bg-white px-4 py-3 font-data text-sm font-bold text-red-900">
                          {detail.currencyCode}
                        </div>
                      </div>
                      {writeOffAmount && (!writeOffMinor || writeOffMinor > detail.dueMinor) ? (
                        <p className="text-sm font-medium text-red-800">
                          {t('dueReceivables.writeOff.amountInvalid', { defaultValue: 'Enter a positive amount that does not exceed the live due.' })}
                        </p>
                      ) : null}

                      <label className="block text-sm font-medium text-red-950">
                        <span className="mb-1 block">{t('dueReceivables.writeOff.reason', { defaultValue: 'Write-off reason' })}</span>
                        <select
                          aria-label={t('dueReceivables.writeOff.reason', { defaultValue: 'Write-off reason' })}
                          value={writeOffReason}
                          onChange={(event) => setWriteOffReason(event.target.value)}
                          className="input min-h-11 w-full bg-white"
                        >
                          <option value="">{t('dueReceivables.writeOff.reasonPlaceholder', { defaultValue: 'Select a reason' })}</option>
                          <option value="uncollectible">{t('dueReceivables.writeOff.reasonCodes.uncollectible', { defaultValue: 'Uncollectible after documented recovery attempts' })}</option>
                          <option value="financial_hardship">{t('dueReceivables.writeOff.reasonCodes.financialHardship', { defaultValue: 'Financial hardship' })}</option>
                          <option value="billing_dispute">{t('dueReceivables.writeOff.reasonCodes.billingDispute', { defaultValue: 'Billing dispute adjustment' })}</option>
                          <option value="deceased">{t('dueReceivables.writeOff.reasonCodes.deceased', { defaultValue: 'Patient deceased' })}</option>
                          <option value="administrative_adjustment">{t('dueReceivables.writeOff.reasonCodes.administrativeAdjustment', { defaultValue: 'Administrative adjustment' })}</option>
                          <option value="other">{t('dueReceivables.writeOff.reasonCodes.other', { defaultValue: 'Other documented reason' })}</option>
                        </select>
                      </label>

                      <label className="block text-sm font-medium text-red-950">
                        <span className="mb-1 block">{t('dueReceivables.writeOff.note', { defaultValue: 'Write-off explanation' })}</span>
                        <textarea
                          aria-label={t('dueReceivables.writeOff.note', { defaultValue: 'Write-off explanation' })}
                          value={writeOffNote}
                          onChange={(event) => setWriteOffNote(event.target.value)}
                          className="input min-h-28 w-full bg-white"
                          maxLength={2000}
                        />
                        <span className="mt-1 block text-xs text-red-800">
                          {t('dueReceivables.writeOff.noteHelp', { defaultValue: 'Explain the recovery attempts and why collection is no longer reasonably expected.' })}
                        </span>
                      </label>

                      <label className="block text-sm font-medium text-red-950">
                        <span className="mb-1 block">{t('dueReceivables.writeOff.evidence', { defaultValue: 'Evidence URLs' })}</span>
                        <textarea
                          aria-label={t('dueReceivables.writeOff.evidence', { defaultValue: 'Evidence URLs' })}
                          value={writeOffEvidence}
                          onChange={(event) => setWriteOffEvidence(event.target.value)}
                          className="input min-h-24 w-full bg-white"
                          placeholder={t('dueReceivables.writeOff.evidencePlaceholder', { defaultValue: 'One HTTP or HTTPS URL per line (optional)' })}
                        />
                      </label>
                      {writeOffEvidence && writeOffEvidenceUrls === null ? (
                        <p className="text-sm font-medium text-red-800">
                          {t('dueReceivables.writeOff.evidenceInvalid', { defaultValue: 'Use no more than 10 valid HTTP or HTTPS URLs.' })}
                        </p>
                      ) : null}

                      <label className="flex items-start gap-3 rounded-xl border border-red-200 bg-white p-3 text-sm font-medium text-red-950">
                        <input
                          type="checkbox"
                          aria-label={t('dueReceivables.writeOff.acknowledgement', { defaultValue: 'Recovery is not reasonably expected for this amount.' })}
                          checked={writeOffAcknowledged}
                          onChange={(event) => setWriteOffAcknowledged(event.target.checked)}
                          className="mt-1 h-4 w-4"
                        />
                        <span>{t('dueReceivables.writeOff.acknowledgement', { defaultValue: 'Recovery is not reasonably expected for this amount.' })}</span>
                      </label>

                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setWriteOffOpen(false)}
                          disabled={writeOffMutation.isPending}
                          className="min-h-11 rounded-xl border border-red-200 bg-white px-4 font-semibold text-red-800 disabled:opacity-50"
                        >
                          {t('dueReceivables.writeOff.cancel', { defaultValue: 'Cancel' })}
                        </button>
                        <button
                          type="button"
                          disabled={!writeOffValid || writeOffMutation.isPending}
                          onClick={() => {
                            if (!writeOffMinor || !writeOffEvidenceUrls) return;
                            writeOffMutation.mutate({
                              amountMinor: writeOffMinor,
                              currencyCode: detail.currencyCode,
                              reasonCode: writeOffReason as 'uncollectible' | 'financial_hardship' | 'billing_dispute' | 'deceased' | 'administrative_adjustment' | 'other',
                              note: writeOffNote.trim(),
                              ...(writeOffEvidenceUrls.length > 0 ? { evidenceUrls: writeOffEvidenceUrls } : {}),
                            });
                          }}
                          className="min-h-11 rounded-xl bg-red-700 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {writeOffMutation.isPending
                            ? t('dueReceivables.writeOff.submitting', { defaultValue: 'Submitting write-off request…' })
                            : t('dueReceivables.writeOff.submit', { defaultValue: 'Submit write-off request' })}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : detail.writeOffRequestCapability === 'pending' ? (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                  {t('dueReceivables.writeOff.pending', { defaultValue: 'Write-off request pending approval' })}
                </section>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-[var(--color-border-light)] p-4">
                  <h3 className="font-semibold">{t('dueReceivables.contact.title')}</h3>
                  <div className="mt-3 space-y-3">
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.contact.channel')}</span>
                      <select aria-label={t('dueReceivables.contact.channel')} value={contactChannel} onChange={(event) => setContactChannel(event.target.value as typeof contactChannel)} className="input min-h-11 w-full">
                        {['phone', 'sms', 'whatsapp', 'in_person', 'other'].map((channel) => <option key={channel} value={channel}>{t(`dueReceivables.channel.${channel}`)}</option>)}
                      </select>
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.contact.outcome')}</span>
                      <input aria-label={t('dueReceivables.contact.outcome')} value={contactOutcome} onChange={(event) => setContactOutcome(event.target.value)} className="input min-h-11 w-full" maxLength={500} />
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.contact.note')}</span>
                      <textarea aria-label={t('dueReceivables.contact.note')} value={contactNote} onChange={(event) => setContactNote(event.target.value)} className="input min-h-24 w-full" maxLength={2000} />
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.contact.nextFollowupAtUtc')}</span>
                      <input aria-label={t('dueReceivables.contact.nextFollowupAtUtc')} value={contactFollowup} onChange={(event) => setContactFollowup(event.target.value)} className="input min-h-11 w-full" placeholder="2099-07-20T04:00:00.000Z" />
                    </label>
                    <button type="button" disabled={isPending || !contactValid} onClick={() => contactMutation.mutate({
                      channel: contactChannel,
                      outcome: contactOutcome.trim(),
                      note: contactNote.trim(),
                      ...(contactFollowup ? { nextFollowupAtUtc: contactFollowup } : {}),
                      expectedUpdatedAtUtc,
                    })} className="min-h-11 w-full rounded-xl bg-[var(--color-primary)] px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                      {t('dueReceivables.contact.submit')}
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-[var(--color-border-light)] p-4">
                  <h3 className="font-semibold">{t('dueReceivables.followup.title')}</h3>
                  <div className="mt-3 space-y-3">
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.followup.nextFollowupAtUtc')}</span>
                      <input aria-label={t('dueReceivables.followup.nextFollowupAtUtc')} value={followupAt} onChange={(event) => setFollowupAt(event.target.value)} className="input min-h-11 w-full" placeholder="2099-07-22T04:00:00.000Z" />
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.followup.note')}</span>
                      <textarea aria-label={t('dueReceivables.followup.note')} value={followupNote} onChange={(event) => setFollowupNote(event.target.value)} className="input min-h-24 w-full" maxLength={2000} />
                    </label>
                    <button type="button" disabled={isPending || !followupValid} onClick={() => followupMutation.mutate({
                      nextFollowupAtUtc: followupAt,
                      ...(followupNote.trim() ? { note: followupNote.trim() } : {}),
                      expectedUpdatedAtUtc,
                    })} className="min-h-11 w-full rounded-xl bg-[var(--color-primary)] px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                      {t('dueReceivables.followup.submit')}
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-[var(--color-border-light)] p-4">
                  <h3 className="font-semibold">{t('dueReceivables.promise.title')}</h3>
                  <div className="mt-3 space-y-3">
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.promise.date')}</span>
                      <input type="date" aria-label={t('dueReceivables.promise.date')} value={promiseDate} onChange={(event) => setPromiseDate(event.target.value)} className="input min-h-11 w-full" />
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.promise.amount')}</span>
                      <input inputMode="decimal" aria-label={t('dueReceivables.promise.amount')} value={promiseAmount} onChange={(event) => setPromiseAmount(event.target.value)} className="input min-h-11 w-full" />
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.promise.note')}</span>
                      <textarea aria-label={t('dueReceivables.promise.note')} value={promiseNote} onChange={(event) => setPromiseNote(event.target.value)} className="input min-h-24 w-full" maxLength={2000} />
                    </label>
                    <button type="button" disabled={isPending || !promiseValid} onClick={() => promiseMinor && promiseMutation.mutate({
                      promiseDate,
                      promiseAmountMinor: promiseMinor,
                      currencyCode: detail.currencyCode,
                      note: promiseNote.trim(),
                      expectedUpdatedAtUtc,
                    })} className="min-h-11 w-full rounded-xl bg-[var(--color-primary)] px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                      {t('dueReceivables.promise.submit')}
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-[var(--color-border-light)] p-4">
                  <h3 className="font-semibold">{t('dueReceivables.dispute.title')}</h3>
                  <div className="mt-3 space-y-3">
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.dispute.reason')}</span>
                      <input aria-label={t('dueReceivables.dispute.reason')} value={disputeReason} onChange={(event) => setDisputeReason(event.target.value)} className="input min-h-11 w-full" maxLength={500} />
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.dispute.note')}</span>
                      <textarea aria-label={t('dueReceivables.dispute.note')} value={disputeNote} onChange={(event) => setDisputeNote(event.target.value)} className="input min-h-24 w-full" maxLength={2000} />
                    </label>
                    <button type="button" disabled={isPending || !disputeValid} onClick={() => disputeMutation.mutate({
                      reason: disputeReason.trim(),
                      note: disputeNote.trim(),
                      expectedUpdatedAtUtc,
                    })} className="min-h-11 w-full rounded-xl bg-red-700 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                      {t('dueReceivables.dispute.submit')}
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-[var(--color-border-light)] p-4 lg:col-span-2">
                  <h3 className="font-semibold">{t('dueReceivables.escalate.title')}</h3>
                  <div className="mt-3 grid gap-3 lg:grid-cols-3">
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.escalate.reason')}</span>
                      <input aria-label={t('dueReceivables.escalate.reason')} value={escalationReason} onChange={(event) => setEscalationReason(event.target.value)} className="input min-h-11 w-full" maxLength={500} />
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.escalate.note')}</span>
                      <input aria-label={t('dueReceivables.escalate.note')} value={escalationNote} onChange={(event) => setEscalationNote(event.target.value)} className="input min-h-11 w-full" maxLength={2000} />
                    </label>
                    <label className="block text-sm font-medium">
                      <span className="mb-1 block">{t('dueReceivables.escalate.assignedTo')}</span>
                      <input inputMode="numeric" aria-label={t('dueReceivables.escalate.assignedTo')} value={escalationAssignee} onChange={(event) => setEscalationAssignee(event.target.value)} className="input min-h-11 w-full" />
                    </label>
                  </div>
                  <button type="button" disabled={isPending || !escalationValid} onClick={() => escalateMutation.mutate({
                    reason: escalationReason.trim(),
                    note: escalationNote.trim(),
                    ...(assignee !== undefined ? { assignedTo: assignee } : {}),
                    expectedUpdatedAtUtc,
                  })} className="mt-3 min-h-11 w-full rounded-xl bg-violet-700 px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                    {t('dueReceivables.escalate.submit')}
                  </button>
                </section>
              </div>

              <section className="rounded-2xl border border-[var(--color-border-light)] p-4">
                <h3 className="font-semibold">{t('dueReceivables.timeline.title')}</h3>
                {eventsQuery.isLoading ? (
                  <div className="mt-3 skeleton h-20 rounded-xl" />
                ) : events.length === 0 ? (
                  <p className="mt-3 text-sm text-[var(--color-text-muted)]">{t('dueReceivables.timeline.empty')}</p>
                ) : (
                  <ol className="mt-3 space-y-3">
                    {events.map((event) => (
                      <li key={event.id} className="rounded-xl bg-[var(--color-bg-subtle)] p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{t(`dueReceivables.event.${event.eventType}`, { defaultValue: event.eventType })}</p>
                          <time className="text-xs text-[var(--color-text-muted)]">{event.createdAtUtc}</time>
                        </div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">{event.actorName ?? t('dueReceivables.timeline.system')}</p>
                        {event.note ? <p className="mt-2 text-sm">{event.note}</p> : null}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
