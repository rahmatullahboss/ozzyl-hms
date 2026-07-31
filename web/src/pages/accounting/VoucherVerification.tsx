import { useState } from 'react';
import {
  FileText, CheckCircle, XCircle, Clock, Search,
  Filter, Eye, ChevronDown, AlertCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface PendingVoucher {
  id: number;
  entry_date: string;
  reference?: string;
  description?: string;
  debit_account_id: number;
  credit_account_id: number;
  amount: number;
  debit_code?: string;
  debit_name?: string;
  credit_code?: string;
  credit_name?: string;
  voucher_type_code?: string;
  voucher_number?: string;
  created_by_name?: string;
  created_at?: string;
}

interface PendingResponse {
  pendingEntries: PendingVoucher[];
}

export default function VoucherVerification({ role = 'md' }: { role?: string }) {
  const { t } = useTranslation(['tenantBilling']);
  const queryClient = useQueryClient();

  const [selectedVoucher, setSelectedVoucher] = useState<PendingVoucher | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');

  const { data, isLoading, refetch } = useApiQuery<PendingResponse>(
    queryKeys.accounting.pendingVouchers(),
    '/api/journal/pending',
  );

  const verifyMutation = useApiMutation<unknown, number>(
    'post',
    (id) => `/api/journal/${id}/verify`,
    {
      onSuccess: () => {
        toast.success(t('voucherVerification.verified'));
        setSelectedVoucher(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
        refetch();
      },
      onError: (err) => {
        toast.error(err.message ?? t('voucherVerification.verifyFailed'));
      },
    },
  );

  const rejectMutation = useApiMutation<unknown, { id: number; reason: string }>(
    'post',
    ({ id }) => `/api/journal/${id}/reject`,
    {
      onSuccess: () => {
        toast.success(t('voucherVerification.rejected'));
        setShowRejectModal(false);
        setRejectReason('');
        setSelectedVoucher(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
        refetch();
      },
      onError: (err) => {
        toast.error(err.message ?? t('voucherVerification.rejectFailed'));
      },
    },
  );

  const pendingEntries = data?.pendingEntries ?? [];

  const filteredEntries = filterSearch
    ? pendingEntries.filter(e =>
        (e.voucher_number || '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (e.reference || '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (e.description || '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (e.debit_name || '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (e.credit_name || '').toLowerCase().includes(filterSearch.toLowerCase())
      )
    : pendingEntries;

  const handleVerify = (id: number) => {
    if (!confirm(t('voucherVerification.confirmVerify'))) return;
    verifyMutation.mutate(id);
  };

  const handleRejectClick = (voucher: PendingVoucher) => {
    setSelectedVoucher(voucher);
    setShowRejectModal(true);
    setRejectReason('');
  };

  const handleRejectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVoucher || !rejectReason.trim()) return;
    rejectMutation.mutate({ id: selectedVoucher.id, reason: rejectReason });
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const canVerify = role === 'md' || role === 'director';

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('voucherVerification.title')}</h1>
            <p className="section-subtitle mt-1">{t('voucherVerification.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg text-sm font-medium">
            <Clock className="w-4 h-4" />
            {pendingEntries.length} {t('voucherVerification.pending')}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="card p-4 flex items-center gap-3 border-l-4 border-amber-400">
            <Clock className="w-8 h-8 text-amber-500" />
            <div>
              <p className="text-sm text-[var(--color-text-muted)]">{t('voucherVerification.pendingCount')}</p>
              <p className="text-2xl font-bold">{pendingEntries.length}</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3 border-l-4 border-blue-400">
            <FileText className="w-8 h-8 text-blue-500" />
            <div>
              <p className="text-sm text-[var(--color-text-muted)]">{t('voucherVerification.totalAmount')}</p>
              <p className="text-2xl font-bold">৳{pendingEntries.reduce((s, e) => s + e.amount, 0).toLocaleString()}</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3 border-l-4 border-purple-400">
            <Eye className="w-8 h-8 text-purple-500" />
            <div>
              <p className="text-sm text-[var(--color-text-muted)]">{t('voucherVerification.awaitingReview')}</p>
              <p className="text-2xl font-bold">{pendingEntries.length}</p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="card p-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder={t('voucherVerification.searchPlaceholder')}
              value={filterSearch}
              onChange={e => setFilterSearch(e.target.value)}
              className="input pl-9"
            />
          </div>
        </div>

        {/* Pending Vouchers List */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="p-12 text-center text-[var(--color-text-muted)]">
                {t('voucherVerification.loading')}
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="p-16 text-center text-[var(--color-text-muted)]">
                <CheckCircle className="w-12 h-12 mx-auto mb-3 text-emerald-400" />
                <p className="text-lg font-medium">{t('voucherVerification.allCleared')}</p>
                <p className="text-sm mt-1">{t('voucherVerification.noPending')}</p>
              </div>
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('voucherVerification.date')}</th>
                    <th>{t('voucherVerification.voucher')}</th>
                    <th>{t('voucherVerification.description')}</th>
                    <th>{t('voucherVerification.debitAccount')}</th>
                    <th>{t('voucherVerification.creditAccount')}</th>
                    <th className="text-right">{t('voucherVerification.amount')}</th>
                    <th>{t('voucherVerification.createdBy')}</th>
                    {canVerify && <th>{t('voucherVerification.actions')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map(entry => (
                    <tr key={entry.id} className="hover:bg-amber-50/20">
                      <td className="font-data text-sm">{entry.entry_date}</td>
                      <td>
                        <span className="font-data font-medium text-[var(--color-primary)]">
                          {entry.voucher_number || entry.reference || `JV-${entry.id}`}
                        </span>
                      </td>
                      <td className="text-sm max-w-xs truncate">{entry.description || '—'}</td>
                      <td className="text-sm">
                        <span className="font-data text-red-600">{entry.debit_code}</span>
                        <span className="ml-1 text-[var(--color-text-secondary)]">{entry.debit_name}</span>
                      </td>
                      <td className="text-sm">
                        <span className="font-data text-emerald-600">{entry.credit_code}</span>
                        <span className="ml-1 text-[var(--color-text-secondary)]">{entry.credit_name}</span>
                      </td>
                      <td className="text-right font-data font-semibold">৳{entry.amount.toLocaleString()}</td>
                      <td className="text-sm text-[var(--color-text-muted)]">{entry.created_by_name || '—'}</td>
                      {canVerify && (
                        <td>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleVerify(entry.id)}
                              disabled={verifyMutation.isPending}
                              className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
                              title={t('voucherVerification.verify')}
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              {t('voucherVerification.verify')}
                            </button>
                            <button
                              onClick={() => handleRejectClick(entry)}
                              disabled={rejectMutation.isPending}
                              className="btn-ghost text-xs px-2 py-1.5 text-red-500 hover:text-red-600 flex items-center gap-1"
                              title={t('voucherVerification.reject')}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              {t('voucherVerification.reject')}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Reject Modal */}
        {showRejectModal && selectedVoucher && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('voucherVerification.rejectTitle')}</h3>
                <button onClick={() => { setShowRejectModal(false); setSelectedVoucher(null); setRejectReason(''); }} className="btn-ghost p-1.5">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleRejectSubmit} className="p-5 space-y-4">
                <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center gap-2 text-red-700 mb-2">
                    <AlertCircle className="w-4 h-4" />
                    <span className="font-medium text-sm">{t('voucherVerification.rejecting')}:</span>
                  </div>
                  <p className="text-sm font-data font-semibold text-red-800">
                    {selectedVoucher.voucher_number || `JV-${selectedVoucher.id}`}
                  </p>
                  <p className="text-sm text-red-600 mt-1">
                    ৳{selectedVoucher.amount.toLocaleString()} — {selectedVoucher.description || t('voucherVerification.noDescription')}
                  </p>
                  <p className="text-xs text-red-500 mt-1">
                    {selectedVoucher.debit_name} → {selectedVoucher.credit_name}
                  </p>
                </div>
                <div>
                  <label className="label">{t('voucherVerification.rejectReason')} *</label>
                  <textarea
                    className="input min-h-[100px]"
                    required
                    placeholder={t('voucherVerification.rejectReasonPlaceholder')}
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => { setShowRejectModal(false); setSelectedVoucher(null); setRejectReason(''); }} className="btn-secondary">
                    {t('voucherVerification.cancel')}
                  </button>
                  <button
                    type="submit"
                    disabled={rejectMutation.isPending || !rejectReason.trim()}
                    className="btn-danger"
                  >
                    {rejectMutation.isPending
                      ? t('voucherVerification.rejectingLabel')
                      : t('voucherVerification.confirmReject')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}