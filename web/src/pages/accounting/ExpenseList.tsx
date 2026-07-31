import { useEffect, useState } from 'react';
import { Plus, X, Camera, Eye, CheckCircle2, XCircle } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { compressImageToWebpFile } from '../../lib/compressImage';
import { api } from '../../lib/apiClient';
import { apiBlob } from '../../lib/blobFetch';
import { formatAuditDateTimeGMT6, formatDisplayDate, parseDatabaseTimestampAsUtc } from '../../lib/date-utils';
import { useAuth } from '../../hooks/useAuth';

interface Expense {
  id: number;
  date: string;
  category: string;
  amount: number;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  approval_status?: 'pending' | 'approved' | 'rejected' | null;
  payment_status?: 'unpaid' | 'paid' | 'void' | null;
  receipt_key: string | null;
  receipt_status?: 'not_uploaded' | 'uploaded' | 'verified' | 'rejected';
  receipt_rejection_reason?: string | null;
  created_by: number | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  created_at: string | null;
  approved_at: string | null;
}

interface ExpenseResponse {
  expenses: Expense[];
}

interface ExpenseFormData {
  date: string;
  category: string;
  amount: string;
  description: string;
}

interface ExpensePayload {
  date: string;
  category: string;
  amount: number;
  description?: string;
}

const createInitialExpenseFormData = (): ExpenseFormData => ({
  date: new Date().toISOString().split('T')[0],
  category: 'MISC',
  amount: '',
  description: '',
});

const CAT_LABELS: Record<string, string> = {
  SALARY: 'Staff Salary', MEDICINE: 'Medicine Purchase', RENT: 'Rent',
  ELECTRICITY: 'Electricity', WATER: 'Water Supply', COMMUNICATION: 'Internet & Phone',
  MAINTENANCE: 'Maintenance', SUPPLIES: 'Medical Supplies', MARKETING: 'Marketing',
  DOCTOR: 'Doctor', BANK: 'Bank Charges', MISC: 'Miscellaneous',
};

const CAT_PILL: Record<string, { short: string; cls: string }> = {
  SALARY:         { short: 'Salary',     cls: 'bg-blue-100 text-blue-700' },
  MEDICINE:       { short: 'Medicine',   cls: 'bg-teal-100 text-teal-700' },
  RENT:           { short: 'Rent',       cls: 'bg-amber-100 text-amber-700' },
  ELECTRICITY:    { short: 'Electric',   cls: 'bg-yellow-100 text-yellow-700' },
  WATER:          { short: 'Water',      cls: 'bg-sky-100 text-sky-700' },
  COMMUNICATION:  { short: 'Telecom',    cls: 'bg-indigo-100 text-indigo-700' },
  MAINTENANCE:    { short: 'Maint.',     cls: 'bg-orange-100 text-orange-700' },
  MARKETING:      { short: 'Marketing',  cls: 'bg-pink-100 text-pink-700' },
  SUPPLIES:       { short: 'Supplies',   cls: 'bg-emerald-100 text-emerald-700' },
  DOCTOR:         { short: 'Doctor',     cls: 'bg-cyan-100 text-cyan-700' },
  BANK:           { short: 'Bank',       cls: 'bg-slate-200 text-slate-700' },
};
const CAT_PILL_DEFAULT = { short: 'Misc', cls: 'bg-purple-100 text-purple-700' };
const EXPENSE_RECEIPT_UPLOAD_PERMISSION = 'expenses.receipts.upload';

function relativeTime(timestamp: string | null | undefined): string {
  const d = parseDatabaseTimestampAsUtc(timestamp);
  if (!d) return '—';
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(Math.abs(diffMs) / 60_000);
  if (m < 1)   return 'just now';
  if (m < 60)  return diffMs >= 0 ? `${m}m ago` : `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)  return diffMs >= 0 ? `${h}h ago` : `in ${h}h`;
  const days = Math.floor(h / 24);
  if (diffMs >= 0) {
    if (days === 1) return 'yesterday';
    if (days < 7)   return `${days}d ago`;
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    day: '2-digit',
    month: 'short',
  }).format(d);
}

const STATUS_BADGE: Record<string, string> = {
  pending:  'badge-warning',
  approved: 'badge-success',
  rejected: 'badge-danger',
};

const fmt = (n: number) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

export default function ExpenseList({ role = 'md' }: { role?: string }) {
  const [filters, setFilters]           = useState({ startDate: '', endDate: '', category: '', status: '' });
  const [showModal, setShowModal]       = useState(false);
  const [editingExpense, setEditing]    = useState<Expense | null>(null);
  const [formData, setFormData]         = useState<ExpenseFormData>(createInitialExpenseFormData);
  const [receiptPreview, setReceiptPreview] = useState<{ expenseId: number; url: string } | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState<number | null>(null);
  const [pendingReceipt, setPendingReceipt] = useState<File | null>(null);
  const isAdmin       = role === 'hospital_admin';
  const isDirector    = role === 'director';
  const isMd          = role === 'md';
  const isAccountant  = role === 'accountant';
  const isReception   = role === 'reception' || role === 'receptionist';
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const hasReceiptUploadPermission = permissions.includes('*') || permissions.includes(EXPENSE_RECEIPT_UPLOAD_PERMISSION);
  const canApprove     = isAdmin || isMd || isDirector;
  const canWrite       = canApprove || isAccountant || isReception;
  const canUpload      = canApprove || isAccountant || hasReceiptUploadPermission;
  const receiptUploadOnly = canUpload && !canWrite && !canApprove;
  const canVerify      = canApprove;
  const showCreatedBy  = isAdmin || isMd || isDirector || isAccountant;
  const showApprovedBy = isAdmin || isMd || isDirector;
  const auditColSpan   = (showCreatedBy ? 1 : 0) + (showApprovedBy ? 1 : 0);
  const { t } = useTranslation(['accounting', 'common']);
  const queryClient = useQueryClient();

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate)   params.append('endDate',   filters.endDate);
    if (filters.category)  params.append('category',  filters.category);
    if (filters.status)    params.append('status',    filters.status);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  };

  const queryPath = receiptUploadOnly
    ? `/api/expenses/receipt-queue${buildQueryString()}`
    : `/api/expenses${buildQueryString()}`;
  const queryKey = receiptUploadOnly
    ? queryKeys.accounting.receiptQueue(filters)
    : queryKeys.accounting.expenses(filters);

  const { data, isLoading: loading } = useApiQuery<ExpenseResponse>(
    queryKey,
    queryPath,
  );

  const expenses = data?.expenses ?? [];

  async function handleReceiptUpload(expenseId: number, file: File, inputEl: HTMLInputElement | null) {
    setUploadingReceipt(expenseId);
    try {
      const uploadFile = await compressImageToWebpFile(file, 1800, 0.78);
      const uploadData = new FormData();
      uploadData.append('receipt', uploadFile);
      await api.post(`/api/expenses/${expenseId}/receipt`, uploadData);
      queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
    } catch (err: any) {
      alert(err?.message || 'Failed to upload receipt');
    } finally {
      setUploadingReceipt(null);
      if (inputEl) inputEl.value = '';
    }
  }

  const saveMutation = useApiMutation<{ id?: number }, ExpensePayload>(
    editingExpense ? 'put' : 'post',
    editingExpense ? `/api/expenses/${editingExpense.id}` : '/api/expenses',
    {
      onSuccess: async (result) => {
        const expenseId = editingExpense?.id ?? result.id;
        if (pendingReceipt && expenseId) {
          await handleReceiptUpload(expenseId, pendingReceipt, null);
        }
        setShowModal(false);
        setEditing(null);
        setPendingReceipt(null);
        setFormData(createInitialExpenseFormData());
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
      onError: (error) => alert(error.message || 'Failed to save expense'),
    },
  );

  const approveMutation = useApiMutation<unknown, { id: number }>(
    'post',
    (vars) => `/api/expenses/${vars.id}/approve`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
      onError: (error) => alert(error.message || 'Failed to approve expense'),
    },
  );

  const rejectMutation = useApiMutation<unknown, { id: number }>(
    'post',
    (vars) => `/api/expenses/${vars.id}/reject`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
      onError: (error) => alert(error.message || 'Failed to reject expense'),
    },
  );

  const verifyReceiptMutation = useApiMutation<unknown, { id: number }>(
    'post',
    (vars) => `/api/expenses/${vars.id}/receipt/verify`,
    { onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all }) },
  );

  const rejectReceiptMutation = useApiMutation<unknown, { id: number; reason: string }>(
    'post',
    (vars) => `/api/expenses/${vars.id}/receipt/reject`,
    {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all }),
      onError: (error) => alert(error.message || 'Failed to reject voucher'),
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const amount = Number(formData.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Please enter a valid positive amount.');
      return;
    }

    saveMutation.mutate({
      date: formData.date,
      category: formData.category,
      amount,
      description: formData.description.trim() || undefined,
    });
  };

  const handleApprove = (id: number) => {
    approveMutation.mutate({ id });
  };

  const handleReject = (id: number) => {
    rejectMutation.mutate({ id });
  };

  const openEdit = (expense: Expense) => {
    setEditing(expense);
    setFormData({ date: expense.date, category: expense.category, amount: expense.amount.toString(), description: expense.description || '' });
    setPendingReceipt(null);
    setShowModal(true);
  };

  const openReceiptViewer = async (expenseId: number) => {
    setReceiptPreview({ expenseId, url: '' });
    setReceiptLoading(true);
    try {
      const blob = await apiBlob(`/api/expenses/${expenseId}/receipt`);
      const blobUrl = URL.createObjectURL(blob);
      setReceiptPreview({ expenseId, url: blobUrl });
    } catch (err: any) {
      alert(err?.message || 'Failed to load receipt');
      setReceiptPreview(null);
    } finally {
      setReceiptLoading(false);
    }
  };

  const closeReceiptViewer = () => {
    setReceiptPreview(null);
  };

  useEffect(() => {
    const url = receiptPreview?.url;
    return () => {
      if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [receiptPreview?.url]);

  const totalApproved = expenses.filter(e => (e.approval_status ?? e.status) === 'approved').reduce((s, e) => s + e.amount, 0);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <h1 className="page-title">Expense Management</h1>
          {!receiptUploadOnly && canWrite && <button onClick={() => { setEditing(null); setPendingReceipt(null); setShowModal(true); }} className="btn-danger">
            <Plus className="w-4 h-4" /> Add Expense
          </button>}
        </div>

        {/* ── Filters ── */}
        <div className="card p-4 flex flex-wrap gap-3">
          <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} className="input w-40 text-sm" />
          <input type="date" value={filters.endDate}   onChange={e => setFilters({...filters, endDate:   e.target.value})} className="input w-40 text-sm" />
          <select value={filters.category} onChange={e => setFilters({...filters, category: e.target.value})} className="input w-44 text-sm">
            <option value="">{t('allCategories', { ns: 'billing' })}</option>
            {Object.entries(CAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} className="input w-36 text-sm">
            <option value="">{t('allStatus', { ns: 'billing' })}</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.accounting.expenses(filters) })} className="btn-secondary text-sm">Filter</button>
        </div>

        {/* ── Table ── */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('date', { ns: 'common' })}</th>
                  <th>{t('category', { ns: 'common' })}</th>
                  <th>{t('amount', { ns: 'billing' })}</th>
                  <th>{t('expenseStatus', { ns: 'billing' })}</th>
                  {showCreatedBy  && <th>Created By</th>}
                  {showApprovedBy && <th>Approved By</th>}
                  <th>{t('description', { ns: 'billing' })}</th>
                  <th>Receipt</th>
                  <th>{t('expenseActions', { ns: 'billing' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => <tr key={i}>{[...Array(7 + auditColSpan)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : expenses.length === 0 ? (
                  <tr><td colSpan={7 + auditColSpan} className="py-14 text-center text-[var(--color-text-muted)]">No expense records found</td></tr>
                ) : (
                  expenses.map(expense => {
                    const approvalStatus = expense.approval_status ?? expense.status;
                    return (
                    <tr key={expense.id}>
                      <td className="font-data text-sm">{formatDisplayDate(expense.date)}</td>
                      <td>
                        {(() => {
                          const pill = CAT_PILL[expense.category] ?? CAT_PILL_DEFAULT;
                          return (
                            <span
                              title={CAT_LABELS[expense.category] || expense.category}
                              className={`inline-block max-w-[6.5rem] truncate rounded-full px-2 py-0.5 text-xs font-medium ${pill.cls}`}
                            >
                              {pill.short}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="font-data font-medium text-red-600">{fmt(expense.amount)}</td>
                      <td><span className={`badge ${STATUS_BADGE[approvalStatus] ?? 'badge-secondary'}`}>{approvalStatus.charAt(0).toUpperCase() + approvalStatus.slice(1)}</span></td>
                      {showCreatedBy && (
                        <td className="text-sm">
                          {expense.created_by_name ? (
                            <>
                              <div className="font-medium">{expense.created_by_name}</div>
                              <div className="text-xs text-[var(--color-text-muted)]" title={formatAuditDateTimeGMT6(expense.created_at)}>{relativeTime(expense.created_at)}</div>
                            </>
                          ) : (
                            <span className="text-[var(--color-text-muted)]" title={expense.created_by ? `User #${expense.created_by}` : ''}>Unknown</span>
                          )}
                        </td>
                      )}
                      {showApprovedBy && (
                        <td className="text-sm">
                          {expense.approved_by_name ? (
                            <span className={approvalStatus === 'rejected' ? 'text-red-600' : ''}>
                              <span className="font-medium block">{expense.approved_by_name}</span>
                              <span className="block text-xs" title={formatAuditDateTimeGMT6(expense.approved_at)}>{relativeTime(expense.approved_at)}</span>
                            </span>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                      )}
                      <td className="text-sm text-[var(--color-text-secondary)]">{expense.description || '—'}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {expense.receipt_key ? (
                            <button
                              onClick={() => openReceiptViewer(expense.id)}
                              aria-label="View receipt"
                              className="btn-ghost p-1.5 text-xs text-blue-600 flex items-center gap-1"
                              title="View receipt"
                            >
                              <Eye className="w-3.5 h-3.5" /> View
                            </button>
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)]">—</span>
                          )}
                          <div className="flex flex-col gap-0.5">
                            <span
                              title={expense.receipt_status === 'rejected' ? expense.receipt_rejection_reason ?? undefined : undefined}
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                expense.receipt_status === 'verified' ? 'bg-emerald-100 text-emerald-700'
                                  : expense.receipt_status === 'rejected' ? 'bg-red-100 text-red-700'
                                    : expense.receipt_key ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {expense.receipt_status === 'verified' ? 'Verified'
                                : expense.receipt_status === 'rejected' ? 'Rejected'
                                  : expense.receipt_key ? 'Uploaded' : 'Not uploaded'}
                            </span>
                            {expense.receipt_status === 'rejected' && expense.receipt_rejection_reason && (
                              <span className="max-w-40 truncate text-[10px] text-red-600" title={expense.receipt_rejection_reason}>
                                {expense.receipt_rejection_reason}
                              </span>
                            )}
                          </div>
                          {canUpload && expense.receipt_status !== 'verified' && (
                            <label
                              className={`btn-ghost p-1.5 text-xs cursor-pointer flex items-center gap-1 ${uploadingReceipt === expense.id ? 'opacity-50 pointer-events-none' : 'text-emerald-600'}`}
                              title={expense.receipt_key ? 'Replace receipt' : 'Upload receipt'}
                            >
                              <Camera className="w-3.5 h-3.5" />
                              {uploadingReceipt === expense.id ? 'Uploading...' : expense.receipt_key ? 'Replace' : 'Upload'}
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleReceiptUpload(expense.id, file, e.target);
                                }}
                              />
                            </label>
                          )}
                          {canVerify && expense.receipt_key && expense.receipt_status === 'uploaded' && (
                            <>
                              <button
                                type="button"
                                aria-label="Verify voucher"
                                className="btn-ghost p-1.5 text-emerald-600"
                                onClick={() => verifyReceiptMutation.mutate({ id: expense.id })}
                              ><CheckCircle2 className="w-4 h-4" /></button>
                            </>
                          )}
                          {canVerify && expense.receipt_key && expense.receipt_status !== 'rejected' && (
                            <button
                              type="button"
                              aria-label="Reject voucher"
                              className="btn-ghost p-1.5 text-red-600"
                              onClick={() => {
                                const response = window.prompt('Reason for rejecting this voucher?');
                                if (response === null) return;
                                const reason = response.trim();
                                if (reason.length < 3) {
                                  alert('Please enter a rejection reason of at least 3 characters.');
                                  return;
                                }
                                rejectReceiptMutation.mutate({ id: expense.id, reason });
                              }}
                            ><XCircle className="w-4 h-4" /></button>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex gap-1.5">
                          {!receiptUploadOnly && canWrite && approvalStatus !== 'pending' && (
                            <button onClick={() => openEdit(expense)} className="btn-ghost p-1.5 text-xs">Edit</button>
                          )}
                          {approvalStatus === 'pending' && canApprove && (
                            <>
                              <button onClick={() => handleApprove(expense.id)} className="btn-ghost p-1.5 text-xs text-emerald-600">Approve</button>
                              <button onClick={() => handleReject(expense.id)} className="btn-ghost p-1.5 text-xs text-red-500">Reject</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
              {!loading && expenses.length > 0 && (
                <tfoot className="bg-[var(--color-surface)] border-t border-[var(--color-border)]">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-medium text-sm">Total Approved</td>
                    <td className="px-4 py-3 font-bold text-red-600">{fmt(totalApproved)}</td>
                    <td colSpan={4 + auditColSpan} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ── Create/Edit Modal ── */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t(editingExpense ? 'expenses.editExpenseTitle' : 'expenses.newExpenseTitle')}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label={t('common:close', { defaultValue: 'Close' })}><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="label" htmlFor="expense-date">{t('date')}</label><input id="expense-date" type="date" required className="input" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} /></div>
                <div><label className="label" htmlFor="expense-category">{t('category')}</label>
                  <select id="expense-category" className="input" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                    {Object.entries(CAT_LABELS).map(([v, l]) => <option key={v} value={v}>{t(`expenses.categories.${v.toLowerCase()}`, { defaultValue: l })}</option>)}
                  </select>
                  {formData.category === 'DOCTOR' && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      {t('expenses.doctorExpenseHint', { defaultValue: 'Use Doctor Payout in Cash Operations for doctor commission payments. Use this category only for other doctor-related expenses.' })}
                    </p>
                  )}
                </div>
                <div><label className="label" htmlFor="expense-amount">{t('amountBdt')}</label><input id="expense-amount" type="number" required className="input" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} /></div>
                <div><label className="label" htmlFor="expense-description">{t('description')}</label><input id="expense-description" type="text" className="input" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
                {canUpload && editingExpense?.receipt_status !== 'verified' && (
                  <div>
                    <label className="label" htmlFor="expense-voucher">{t('expenses.voucherPhotoOptional')}</label>
                    <input
                      id="expense-voucher"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="input"
                      onChange={(e) => setPendingReceipt(e.target.files?.[0] ?? null)}
                    />
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{t('cancel')}</button>
                  <button type="submit" className="btn-danger">{t('save')}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Receipt Viewer Modal ── */}
        {receiptPreview && (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[60]"
            onClick={closeReceiptViewer}
          >
            <div className="relative max-w-3xl max-h-[90vh] w-full" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={closeReceiptViewer}
                className="absolute -top-10 right-0 text-white hover:text-gray-300 p-1"
                aria-label="Close receipt viewer"
              >
                <X className="w-6 h-6" />
              </button>
              {receiptLoading ? (
                <div className="flex items-center justify-center h-64">
                  <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white" />
                </div>
              ) : receiptPreview.url ? (
                <img
                  src={receiptPreview.url}
                  alt="Expense receipt"
                  className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl mx-auto"
                />
              ) : null}
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
