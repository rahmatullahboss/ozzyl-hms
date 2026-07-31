import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import toast from 'react-hot-toast';
import {
  ArrowRightLeft, CheckCircle, XCircle, Clock, Building2, User, Stethoscope,
  AlertTriangle, Filter, ChevronLeft, ChevronRight, RefreshCw, Eye, FileText,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';

interface Referral {
  id: number;
  from_tenant_id: string;
  to_tenant_id: string;
  patient_global_id: string;
  patient_name: string | null;
  patient_phone: string | null;
  patient_dob: string | null;
  patient_gender: string | null;
  patient_blood_group: string | null;
  from_hospital_name: string | null;
  to_hospital_name: string | null;
  referring_doctor_name: string | null;
  receiving_doctor_name: string | null;
  urgency: string;
  reason: string | null;
  clinical_notes: string | null;
  status: string;
  decline_reason: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  created_at: string;
  documents: Array<{
    id: number;
    document_type: string;
    title: string | null;
  }>;
}

export default function IncomingReferralQueue({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['referral', 'common']);
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const newReferralPath = role === 'doctor' ? `/h/${slug}/doctor/referrals/new` : `/h/${slug}/referrals/new`;
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState<'incoming' | 'outgoing'>('incoming');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedReferral, setSelectedReferral] = useState<Referral | null>(null);

  const limit = 20;

  const { data, isLoading, isFetching } = useApiQuery<{
    data: Referral[];
    pagination: { page: number; limit: number; total: number };
  }>(
    ['referrals', direction, page, statusFilter],
    `/api/v1/referrals?direction=${direction}&page=${page}&limit=${limit}${statusFilter ? '&status=' + statusFilter : ''}`
  );

  const referrals = data?.data ?? [];
  const totalPages = Math.ceil((data?.pagination.total ?? 0) / limit);

  const updateStatusMutation = useApiMutation('put', (vars: any) => `/api/v1/referrals/${vars.id}/status`, {
    onSuccess: () => {
      toast.success(t('queue.actions.statusUpdated'));
      queryClient.invalidateQueries({ queryKey: ['referrals'] });
      setSelectedReferral(null);
    },
    onError: (err: any) => toast.error(err.message || t('common:operationFailed')),
  });

  const urgencyBadge = (u: string) => {
    if (u === 'emergency') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200"><AlertTriangle className="w-3 h-3" /> {t('common:urgencies.emergency')}</span>;
    if (u === 'urgent') return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200"><Clock className="w-3 h-3" /> {t('common:urgencies.urgent')}</span>;
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">{t('common:urgencies.routine')}</span>;
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-700 border-gray-200',
      accepted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
      declined: 'bg-red-100 text-red-700 border-red-200',
      completed: 'bg-blue-100 text-blue-700 border-blue-200',
      cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
    };
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${map[s] ?? map.pending}`}>{t(`common:statuses.${s}`)}</span>;
  };

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <ArrowRightLeft className="w-6 h-6 text-[var(--color-primary)]" />
              {t('queue.title')}
            </h1>
            <p className="section-subtitle mt-1">{t('queue.subtitle')}</p>
          </div>
          <button onClick={() => navigate(newReferralPath)} className="btn-primary text-sm self-start flex items-center gap-1">
            <ArrowRightLeft className="w-4 h-4" /> {t('queue.actions.new')}
          </button>
        </div>

        {/* Direction Toggle + Filters */}
        <div className="card p-3 flex flex-wrap gap-2 items-center">
          <div className="flex rounded-xl border border-[var(--color-border)] overflow-hidden">
            <button
              onClick={() => { setDirection('incoming'); setPage(1); }}
              className={`px-4 py-2 text-sm font-medium transition-colors ${direction === 'incoming' ? 'bg-[var(--color-primary)] text-white' : 'bg-white text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
            >
              {t('common:directions.incoming')}
            </button>
            <button
              onClick={() => { setDirection('outgoing'); setPage(1); }}
              className={`px-4 py-2 text-sm font-medium transition-colors ${direction === 'outgoing' ? 'bg-[var(--color-primary)] text-white' : 'bg-white text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
            >
              {t('common:directions.outgoing')}
            </button>
          </div>

          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input text-sm">
            <option value="">{t('common:allStatuses') || 'All Statuses'}</option>
            <option value="pending">{t('common:statuses.pending')}</option>
            <option value="accepted">{t('common:statuses.accepted')}</option>
            <option value="declined">{t('common:statuses.declined')}</option>
            <option value="completed">{t('common:statuses.completed')}</option>
            <option value="cancelled">{t('common:statuses.cancelled')}</option>
          </select>

          <button
            onClick={() => { setPage(1); setStatusFilter(''); }}
            className="ml-auto btn-ghost text-xs flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> {t('common:reset')}
          </button>
          {isFetching && <div className="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />}
        </div>


        {/* Referrals Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead>
                <tr>
                  <th>{t('common:sn')}</th>
                  <th>{t('queue.table.patient')}</th>
                  <th>{direction === 'incoming' ? t('queue.table.hospitalFrom') : t('queue.table.hospitalTo')}</th>
                  <th>{t('queue.table.doctor')}</th>
                  <th>{t('queue.table.urgency')}</th>
                  <th>{t('queue.table.status')}</th>
                  <th>{t('queue.table.date')}</th>
                  <th>{t('common:actions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>{[...Array(8)].map((__, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                  ))
                ) : referrals.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-[var(--color-text-muted)]">
                      <ArrowRightLeft className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="font-medium text-lg">{t('common:noReferrals', { direction: t(`common:directions.${direction}`) })}</p>
                      <p className="section-subtitle mt-1">{t(`common:referralPlaceholder.${direction}`)}</p>
                    </td>
                  </tr>
                ) : (
                  referrals.map(r => (
                    <tr key={r.id} className={r.status === 'declined' || r.status === 'cancelled' ? 'opacity-50' : ''}>
                      <td className="font-mono text-xs">#{r.id}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                          <div>
                            <p className="font-medium text-sm">{r.patient_name ?? t('common:n_a')}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{r.patient_gender ?? ''} {r.patient_blood_group ? `· ${r.patient_blood_group}` : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                          <span className="text-sm">{direction === 'incoming' ? r.from_hospital_name : r.to_hospital_name}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Stethoscope className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                          <span className="text-sm">{direction === 'incoming' ? r.referring_doctor_name : r.receiving_doctor_name}</span>
                        </div>
                      </td>
                      <td>{urgencyBadge(r.urgency)}</td>
                      <td>{statusBadge(r.status)}</td>
                      <td className="text-xs">{r.created_at?.slice(0, 10)}</td>
                      <td>
                        <div className="flex gap-1">
                          <button onClick={() => setSelectedReferral(r)} className="btn-ghost text-xs text-blue-600 p-1" title={t('queue.actions.viewDetails')}>
                            <Eye className="w-4 h-4" />
                          </button>
                          {direction === 'incoming' && r.status === 'pending' && (
                            <>
                              <button
                                onClick={() => updateStatusMutation.mutate({ id: r.id, status: 'accepted' })}
                                className="btn-ghost text-xs text-emerald-600 p-1"
                                title={t('queue.actions.accept')}
                              >
                                <CheckCircle className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  const reason = prompt(t('queue.modal.declineReason') as string);
                                  updateStatusMutation.mutate({ id: r.id, status: 'declined', decline_reason: reason || undefined });
                                }}
                                className="btn-ghost text-xs text-red-600 p-1"
                                title={t('queue.actions.decline')}
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {direction === 'incoming' && r.status === 'accepted' && (
                            <button
                              onClick={() => updateStatusMutation.mutate({ id: r.id, status: 'completed' })}
                              className="btn-ghost text-xs text-blue-600 p-1"
                              title={t('queue.actions.complete')}
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>


        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex justify-center gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary text-sm px-3 py-1.5 disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1.5 text-sm text-[var(--color-text-muted)]">{page} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-secondary text-sm px-3 py-1.5 disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Detail Modal */}
        {selectedReferral && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{t('queue.modal.referralId', { id: selectedReferral.id })}</h3>
                <button onClick={() => setSelectedReferral(null)} className="btn-ghost p-1"><XCircle className="w-5 h-5" /></button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  {urgencyBadge(selectedReferral.urgency)}
                  {statusBadge(selectedReferral.status)}
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 bg-[var(--color-bg)] rounded-lg">
                    <p className="text-xs text-[var(--color-text-muted)] mb-1">{t('common:patient')}</p>
                    <p className="font-medium">{selectedReferral.patient_name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">{selectedReferral.patient_phone}</p>
                  </div>
                  <div className="p-3 bg-[var(--color-bg)] rounded-lg">
                    <p className="text-xs text-[var(--color-text-muted)] mb-1">{t('queue.table.hospitalFrom')}</p>
                    <p className="font-medium">{selectedReferral.from_hospital_name}</p>
                  </div>
                  <div className="p-3 bg-[var(--color-bg)] rounded-lg">
                    <p className="text-xs text-[var(--color-text-muted)] mb-1">{t('queue.table.hospitalTo')}</p>
                    <p className="font-medium">{selectedReferral.to_hospital_name}</p>
                  </div>
                  <div className="p-3 bg-[var(--color-bg)] rounded-lg">
                    <p className="text-xs text-[var(--color-text-muted)] mb-1">{t('queue.table.doctor')}</p>
                    <p className="font-medium">{selectedReferral.referring_doctor_name ?? '—'}</p>
                  </div>
                </div>

                {selectedReferral.reason && (
                  <div className="p-3 bg-[var(--color-bg)] rounded-lg">
                    <p className="text-xs text-[var(--color-text-muted)] mb-1">{t('create.labels.reason')}</p>
                    <p className="text-sm">{selectedReferral.reason}</p>
                  </div>
                )}

                {selectedReferral.clinical_notes && (
                  <div className="p-3 bg-[var(--color-bg)] rounded-lg">
                    <p className="text-xs text-[var(--color-text-muted)] mb-1">{t('create.labels.clinicalNotes')}</p>
                    <p className="text-sm whitespace-pre-wrap">{selectedReferral.clinical_notes}</p>
                  </div>
                )}

                {selectedReferral.documents.length > 0 && (
                  <div>
                    <p className="text-xs text-[var(--color-text-muted)] mb-2">{t('create.labels.attachedDocs')}</p>
                    <div className="space-y-1">
                      {selectedReferral.documents.map(d => (
                        <div key={d.id} className="flex items-center gap-2 p-2 bg-[var(--color-bg)] rounded-lg text-sm">
                          <FileText className="w-4 h-4 text-[var(--color-text-muted)]" />
                          <span className="capitalize">{t(`create.docTypes.${d.document_type}`) || d.document_type.replace(/_/g, ' ')}</span>
                          <span className="text-[var(--color-text-muted)]">{d.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedReferral.decline_reason && (
                  <div className="p-3 bg-red-50 rounded-lg">
                    <p className="text-xs text-red-600 mb-1">{t('queue.modal.declineTitle')}</p>
                    <p className="text-sm text-red-700">{selectedReferral.decline_reason}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
