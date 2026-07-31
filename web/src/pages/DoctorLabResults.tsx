import { useState, useDeferredValue, useMemo, useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  Clock,
  FileText,
  FlaskConical,
  Search,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import LabFlowsheet, { type LabResult } from '../components/clinical/LabFlowsheet';
import { useApiMutation, useApiQuery, useQueryClient } from '../hooks/useApiQuery';

type Tab = 'recent' | 'pending' | 'abnormal' | 'critical' | 'needs_review' | 'trend';

const TAB_CONFIG: Array<{ key: Tab; label: string }> = [
  { key: 'recent', label: 'Recent' },
  { key: 'pending', label: 'Pending' },
  { key: 'abnormal', label: 'Abnormal' },
  { key: 'critical', label: 'Critical' },
  { key: 'needs_review', label: 'Needs Review' },
  { key: 'trend', label: 'Trend' },
];interface LabResultItem {
  id: number;
  patient_name: string;
  patient_id: number;
  test_name: string;
  collected_at?: string;
  ordered_at?: string;
  result_value?: string;
  unit?: string;
  abnormal_flag?: string | null;
  status: string;
  order_id: number;
  is_acknowledged?: number;
}

interface ResultsResponse {
  results: LabResultItem[];
}

interface SummaryResponse {
  total_reports: number;
  pending: number;
  abnormal: number;
  critical: number;
  needs_review?: number;
}

interface TrendResponse {
  results: LabResult[];
}

function StatCard({
  label,
  value,
  tone = 'slate',
  icon,
}: {
  label: string;
  value: number | string;
  tone?: 'slate' | 'cyan' | 'amber' | 'red' | 'emerald';
  icon: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    slate: 'from-slate-50 to-white border-slate-200 text-slate-900',
    cyan: 'from-cyan-50 to-white border-cyan-200 text-cyan-900',
    amber: 'from-amber-50 to-white border-amber-200 text-amber-900',
    red: 'from-rose-50 to-white border-rose-200 text-rose-900',
    emerald: 'from-emerald-50 to-white border-emerald-200 text-emerald-900',
  };

  return (
    <div className={`rounded-2xl border bg-gradient-to-br ${tones[tone]} p-4 shadow-sm`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
        <div className="text-slate-500">{icon}</div>
      </div>
      <div className="text-3xl font-semibold">{value}</div>
    </div>
  );
}

function flagBadge(flag?: string | null) {
  if (!flag || flag === 'normal') return null;
  const normalized = flag.toLowerCase();
  const cls =
    normalized === 'critical' || normalized === 'critical_high' || normalized === 'critical_low'
      ? 'bg-red-100 text-red-700 border-red-200'
      : normalized === 'high'
        ? 'bg-amber-100 text-amber-700 border-amber-200'
        : 'bg-sky-100 text-sky-700 border-sky-200';
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}>
      {flag.replace(/_/g, ' ')}
    </span>
  );
}

function isReviewableFlag(flag?: string | null): boolean {
  const normalized = String(flag ?? '').toLowerCase();
  return ['high', 'low', 'critical', 'critical_high', 'critical_low', 'abnormal'].includes(normalized);
}

export default function DoctorLabResults({ role = 'doctor' }: { role?: string }) {
  const { t } = useTranslation(['tenantClinical']);
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'recent';
  const [activeTab, setActiveTab] = useState<Tab>(TAB_CONFIG.some((tab) => tab.key === initialTab) ? initialTab : 'recent');
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const queryClient = useQueryClient();

  useEffect(() => {
    const tab = searchParams.get('tab') as Tab | null;
    if (tab && TAB_CONFIG.some((entry) => entry.key === tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const summaryQuery = useApiQuery<SummaryResponse>(
    ['doctor-lab-summary'],
    '/api/lab/doctor/summary',
  );

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (deferredSearch) params.set('search', deferredSearch);
    return params.toString();
  }, [deferredSearch]);

  const recentQuery = useApiQuery<ResultsResponse>(
    ['doctor-lab-recent', deferredSearch],
    `/api/lab/results?scope=doctor&limit=50${queryParams ? `&${queryParams}` : ''}`,
    { enabled: activeTab === 'recent' },
  );

  const pendingQuery = useApiQuery<ResultsResponse>(
    ['doctor-lab-pending', deferredSearch],
    `/api/lab/results?scope=doctor&status=pending&limit=50${queryParams ? `&${queryParams}` : ''}`,
    { enabled: activeTab === 'pending' },
  );

  const abnormalQuery = useApiQuery<ResultsResponse>(
    ['doctor-lab-abnormal', deferredSearch],
    `/api/lab/results?scope=doctor&abnormal_flag=high,low,abnormal&limit=50${queryParams ? `&${queryParams}` : ''}`,
    { enabled: activeTab === 'abnormal' },
  );

  const criticalQuery = useApiQuery<ResultsResponse>(
    ['doctor-lab-critical', deferredSearch],
    `/api/lab/results?scope=doctor&abnormal_flag=critical,critical_high,critical_low&limit=50${queryParams ? `&${queryParams}` : ''}`,
    { enabled: activeTab === 'critical' },
  );

  const needsReviewQuery = useApiQuery<ResultsResponse>(
    ['doctor-lab-needs-review', deferredSearch],
    `/api/lab/results?scope=doctor&needs_review=1&limit=50${queryParams ? `&${queryParams}` : ''}`,
    { enabled: activeTab === 'needs_review' },
  );

  const trendQuery = useApiQuery<TrendResponse>(
    ['doctor-lab-trend'],
    '/api/lab/trend?scope=doctor&limit=100',
    { enabled: activeTab === 'trend' },
  );

  const acknowledgeMutation = useApiMutation<{ success: boolean }, { itemId: number; notes?: string }>(
    'post',
    (vars) => `/api/lab/results/${vars.itemId}/acknowledge`,
    {
      onSuccess: () => {
        toast.success(t('doctorLabResults.toast.acknowledged'));
        queryClient.invalidateQueries({ queryKey: ['doctor-lab-summary'] });
        queryClient.invalidateQueries({ queryKey: ['doctor-lab-recent'] });
        queryClient.invalidateQueries({ queryKey: ['doctor-lab-abnormal'] });
        queryClient.invalidateQueries({ queryKey: ['doctor-lab-critical'] });
        queryClient.invalidateQueries({ queryKey: ['doctor-lab-needs-review'] });
      },
      onError: (error) => toast.error(error.message || t('doctorLabResults.toast.acknowledgeFailed')),
    },
  );

  const summary = summaryQuery.data;

  const activeResults = useMemo(() => {
    switch (activeTab) {
      case 'recent':
        return recentQuery.data?.results ?? [];
      case 'pending':
        return pendingQuery.data?.results ?? [];
      case 'abnormal':
        return abnormalQuery.data?.results ?? [];
      case 'critical':
        return criticalQuery.data?.results ?? [];
      case 'needs_review':
        return needsReviewQuery.data?.results ?? [];
      default:
        return [];
    }
  }, [activeTab, recentQuery.data, pendingQuery.data, abnormalQuery.data, criticalQuery.data, needsReviewQuery.data]);

  const isLoading =
    (activeTab === 'recent' && recentQuery.isLoading) ||
    (activeTab === 'pending' && pendingQuery.isLoading) ||
    (activeTab === 'abnormal' && abnormalQuery.isLoading) ||
    (activeTab === 'critical' && criticalQuery.isLoading) ||
    (activeTab === 'needs_review' && needsReviewQuery.isLoading) ||
    (activeTab === 'trend' && trendQuery.isLoading);

  const handleViewReport = (item: LabResultItem) => {
    navigate(`${basePath}/lab/${item.order_id}/report`);
  };

  const tabLabels: Record<Tab, string> = {
    recent: t('doctorLabResults.tab.recent'),
    pending: t('doctorLabResults.tab.pending'),
    abnormal: t('doctorLabResults.tab.abnormal'),
    critical: t('doctorLabResults.tab.critical'),
    needs_review: t('doctorLabResults.tab.needsReview'),
    trend: t('doctorLabResults.tab.trend'),
  };

  const TAB_RENDER: Array<{ key: Tab; label: string }> = [
    { key: 'recent', label: tabLabels.recent },
    { key: 'pending', label: tabLabels.pending },
    { key: 'abnormal', label: tabLabels.abnormal },
    { key: 'critical', label: tabLabels.critical },
    { key: 'needs_review', label: tabLabels.needs_review },
    { key: 'trend', label: tabLabels.trend },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">
        <section className="rounded-[28px] border border-slate-200 bg-gradient-to-br from-cyan-50 via-white to-slate-50 p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">{t('doctorLabResults.kicker')}</div>
              <h1 className="mt-2 text-3xl font-semibold text-slate-900">{t('doctorLabResults.title')}</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                {t('doctorLabResults.subtitle')}
              </p>
            </div>
            <div className="relative min-w-[280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('doctorLabResults.searchPlaceholder')}
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm outline-none transition focus:border-cyan-500"
              />
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label={t('doctorLabResults.stat.totalReports')} value={summary?.total_reports ?? 0} tone="cyan" icon={<FlaskConical className="h-5 w-5" />} />
          <StatCard label={t('doctorLabResults.stat.pending')} value={summary?.pending ?? 0} tone="amber" icon={<Clock className="h-5 w-5" />} />
          <StatCard label={t('doctorLabResults.stat.abnormal')} value={summary?.abnormal ?? 0} tone="amber" icon={<AlertTriangle className="h-5 w-5" />} />
          <StatCard label={t('doctorLabResults.stat.critical')} value={summary?.critical ?? 0} tone="red" icon={<AlertTriangle className="h-5 w-5" />} />
          <StatCard label={t('doctorLabResults.stat.needsReview')} value={summary?.needs_review ?? 0} tone="emerald" icon={<CheckCircle2 className="h-5 w-5" />} />
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {TAB_RENDER.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-2xl px-4 py-2.5 text-sm font-medium transition ${
                  activeTab === tab.key ? 'bg-cyan-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {activeTab === 'trend' ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">{t('doctorLabResults.trendHeading')}</h2>
            {trendQuery.isLoading ? (
              <div className="py-10 text-center text-sm text-slate-500">{t('doctorLabResults.loadingTrends')}</div>
            ) : (
              <LabFlowsheet results={trendQuery.data?.results ?? []} />
            )}
          </section>
        ) : (
          <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {activeTab === 'recent' && t('doctorLabResults.heading.recent')}
                {activeTab === 'pending' && t('doctorLabResults.heading.pending')}
                {activeTab === 'abnormal' && t('doctorLabResults.heading.abnormal')}
                {activeTab === 'critical' && t('doctorLabResults.heading.critical')}
                {activeTab === 'needs_review' && t('doctorLabResults.heading.needsReview')}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{t('doctorLabResults.showingRecords', { count: activeResults.length })}</p>
            </div>

            {isLoading ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500">{t('doctorLabResults.loading')}</div>
            ) : activeResults.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-slate-500">{t('doctorLabResults.noRecords')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      <th className="px-4 py-3">{t('doctorLabResults.column.patient')}</th>
                      <th className="px-4 py-3">{t('doctorLabResults.column.test')}</th>
                      <th className="px-4 py-3">{t('doctorLabResults.column.date')}</th>
                      <th className="px-4 py-3">{t('doctorLabResults.column.keyResult')}</th>
                      <th className="px-4 py-3">{t('doctorLabResults.column.status')}</th>
                      <th className="px-4 py-3 text-right">{t('doctorLabResults.column.actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {activeResults.map((item) => {
                      const canAcknowledge = isReviewableFlag(item.abnormal_flag) && !item.is_acknowledged;
                      return (
                        <tr key={item.id} className="align-top hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">{item.patient_name}</div>
                            <div className="mt-1 text-xs text-slate-500">#{item.patient_id}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-slate-900">{item.test_name}</div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-slate-700">
                              {item.collected_at
                                ? new Date(item.collected_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                                : item.ordered_at
                                  ? new Date(item.ordered_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                                  : '—'}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {item.result_value ? (
                              <div className="font-medium text-slate-900">
                                {item.result_value}
                                {item.unit ? ` ${item.unit}` : ''}
                              </div>
                            ) : (
                              <div className="text-xs text-slate-400">{t('doctorLabResults.status.pending')}</div>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {flagBadge(item.abnormal_flag)}
                              {item.is_acknowledged ? (
                                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                  {t('doctorLabResults.status.acknowledged')}
                                </span>
                              ) : null}
                              {!flagBadge(item.abnormal_flag) && (
                                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                                  {item.status}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap justify-end gap-2">
                              {['completed', 'verified'].includes(item.status) && (
                                <button
                                  type="button"
                                  onClick={() => handleViewReport(item)}
                                  className="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-700"
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                  {t('doctorLabResults.action.view')}
                                </button>
                              )}
                              {canAcknowledge && (
                                <button
                                  type="button"
                                  disabled={acknowledgeMutation.isPending}
                                  onClick={() => acknowledgeMutation.mutate({
                                    itemId: item.id,
                                    notes: `Reviewed from doctor inbox (${item.test_name})`,
                                  })}
                                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {t('doctorLabResults.action.acknowledge')}
                                </button>
                              )}
                              <Link
                                to={`${basePath}/patients/${item.patient_id}/chart`}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                {t('doctorLabResults.action.chart')}
                              </Link>
                              <Link
                                to={`${basePath}/prescriptions/new?patient=${item.patient_id}&followup=1`}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                              >
                                <CalendarPlus className="h-3.5 w-3.5" />
                                {t('doctorLabResults.action.followUp')}
                              </Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
