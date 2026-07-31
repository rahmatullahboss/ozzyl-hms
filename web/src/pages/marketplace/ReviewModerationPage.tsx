import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, MessageSquareText, Star } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import ReviewModerationDrawer, {
  type MarketplaceReview,
} from '../../components/marketplace/ReviewModerationDrawer';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatDoctorName } from '../../lib/doctor-display';

type ReviewStatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

interface ReviewListResponse {
  data: MarketplaceReview[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
}

function statusKey(value: number): 'pending' | 'approved' | 'rejected' {
  if (value === 1) return 'approved';
  if (value === -1) return 'rejected';
  return 'pending';
}

function preview(value: string | null | undefined): string {
  const text = value?.trim();
  if (!text) return '—';
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export default function ReviewModerationPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['marketplace', 'common']);
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>('pending');
  const [selectedReview, setSelectedReview] = useState<MarketplaceReview | null>(null);

  const statusParam = statusFilter === 'all' ? '' : statusFilter;
  const reviewsQuery = useApiQuery<ReviewListResponse>(
    ['marketplace', 'reviews', statusFilter],
    `/api/v1/marketplace/reviews/all?status=${statusParam}`,
    { staleTime: 15_000 },
  );
  const reviews = reviewsQuery.data?.data ?? [];

  return (
    <DashboardLayout role={role}>
      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <header className="page-header">
          <div>
            <h1 className="page-title">{t('marketplace:reviews.title')}</h1>
            <p className="section-subtitle mt-1">{t('marketplace:reviews.subtitle')}</p>
          </div>
        </header>

        <section
          aria-label={t('marketplace:reviews.filtersLabel')}
          className="card flex flex-wrap items-center gap-2 p-3"
        >
          <Filter className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          {(['all', 'pending', 'approved', 'rejected'] as const).map((status) => (
            <button
              key={status}
              type="button"
              aria-pressed={statusFilter === status}
              onClick={() => {
                setStatusFilter(status);
                setSelectedReview(null);
              }}
              className={`min-h-11 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
                statusFilter === status
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'border border-[var(--color-border)] bg-[var(--color-bg-card)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]'
              }`}
            >
              {t(`marketplace:reviews.status.${status}`)}
            </button>
          ))}
        </section>

        <section className="card overflow-hidden" aria-label={t('marketplace:reviews.title')}>
          {reviewsQuery.isLoading ? (
            <div role="status" className="flex min-h-56 items-center justify-center p-6 text-sm text-[var(--color-text-muted)]">
              {t('marketplace:reviews.loading')}
            </div>
          ) : reviewsQuery.isError ? (
            <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
              <p>{t('marketplace:reviews.error')}</p>
              <button
                type="button"
                onClick={() => void reviewsQuery.refetch()}
                className="mt-3 min-h-11 rounded-lg border border-red-300 px-4 font-semibold"
              >
                {t('marketplace:reviews.retry')}
              </button>
            </div>
          ) : reviews.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-2 p-6 text-center text-[var(--color-text-muted)]">
              <MessageSquareText className="h-8 w-8" aria-hidden="true" />
              <p>{t('marketplace:reviews.noReviews')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base min-w-[780px] text-sm">
                <thead>
                  <tr>
                    <th>{t('marketplace:reviews.table.patient')}</th>
                    <th>{t('marketplace:reviews.table.type')}</th>
                    <th>{t('marketplace:reviews.table.rating')}</th>
                    <th>{t('marketplace:reviews.table.review')}</th>
                    <th>{t('marketplace:reviews.table.status')}</th>
                    <th>{t('marketplace:reviews.table.date')}</th>
                    <th>{t('marketplace:reviews.table.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((review) => {
                    const state = statusKey(review.is_approved);
                    const target = review.doctor_name
                      ? formatDoctorName(review.doctor_name, t('marketplace:reviews.doctorPrefix', 'Dr.'))
                      : t('marketplace:reviews.hospital');
                    const fullText = review.review_text?.trim() || t('marketplace:reviews.noReviewText');

                    return (
                      <tr key={review.id}>
                        <td className="font-medium">{review.reviewer_name || t('marketplace:reviews.anonymous')}</td>
                        <td>{target}</td>
                        <td>
                          <div className="flex items-center gap-1" aria-label={`${review.rating}/5`}>
                            <Star className="h-4 w-4 fill-amber-500 text-amber-500" aria-hidden="true" />
                            <span>{review.rating}</span>
                          </div>
                        </td>
                        <td className="max-w-md">
                          <button
                            type="button"
                            aria-label={fullText}
                            onClick={() => setSelectedReview(review)}
                            className="min-h-11 w-full rounded-md px-2 py-2 text-left leading-5 text-[var(--color-text)] hover:bg-[var(--color-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                          >
                            {preview(review.review_text)}
                          </button>
                        </td>
                        <td>
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                            state === 'approved'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : state === 'rejected'
                                ? 'border-red-200 bg-red-50 text-red-800'
                                : 'border-amber-200 bg-amber-50 text-amber-800'
                          }`}>
                            {t(`marketplace:reviews.status.${state}`)}
                          </span>
                        </td>
                        <td className="text-xs tabular-nums">{review.created_at?.slice(0, 10) || '—'}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => setSelectedReview(review)}
                            className="min-h-11 rounded-lg border border-[var(--color-border)] px-3 text-sm font-medium hover:bg-[var(--color-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                          >
                            {t('marketplace:reviews.openReview')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      <ReviewModerationDrawer
        open={selectedReview !== null}
        review={selectedReview}
        onClose={() => setSelectedReview(null)}
        onChanged={() => {
          setSelectedReview(null);
          void reviewsQuery.refetch();
        }}
      />
    </DashboardLayout>
  );
}
