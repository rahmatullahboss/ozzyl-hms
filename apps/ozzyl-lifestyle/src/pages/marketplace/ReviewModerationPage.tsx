import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { formatDoctorName } from '../../lib/doctor-display';
import DashboardLayout from '../../components/DashboardLayout';
import toast from 'react-hot-toast';
import { CheckCircle, XCircle, MessageSquare, Star, Filter } from 'lucide-react';

interface Review {
  id: number;
  reviewer_name?: string;
  target_type: string;
  doctor_name?: string;
  rating: number;
  review_text?: string;
  is_approved: number;
  created_at: string;
  provider_reply?: string;
}

export default function ReviewModerationPage({ role = 'hospital_admin' }: { role?: string }) {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [replyingId, setReplyingId] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');

  const { data, isLoading } = useQuery<{ data: Review[]; pagination: { total: number } }>({
    queryKey: ['marketplace', 'reviews', statusFilter],
    queryFn: () => api.get<{ data: Review[]; pagination: { total: number } }>(`/api/v1/marketplace/reviews/all?status=${statusFilter === 'all' ? '' : statusFilter}`),
  });
  const reviews = data?.data ?? [];

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.put(`/api/v1/marketplace/reviews/${id}/approve`, {}),
    onSuccess: () => { toast.success('Review approved'); queryClient.invalidateQueries({ queryKey: ['marketplace', 'reviews'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason?: string }) => api.put(`/api/v1/marketplace/reviews/${id}/reject`, { reason }),
    onSuccess: () => { toast.success('Review rejected'); queryClient.invalidateQueries({ queryKey: ['marketplace', 'reviews'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const replyMutation = useMutation({
    mutationFn: ({ id, reply_text }: { id: number; reply_text: string }) => api.post(`/api/v1/marketplace/reviews/${id}/reply`, { reply_text }),
    onSuccess: () => { toast.success('Reply posted'); setReplyingId(null); setReplyText(''); queryClient.invalidateQueries({ queryKey: ['marketplace', 'reviews'] }); },
    onError: (err: any) => toast.error(err.message || 'Failed'),
  });

  const statusBadge = (s: number) => {
    if (s === 1) return <span className="badge badge-success">Approved</span>;
    if (s === -1) return <span className="badge badge-error">Rejected</span>;
    return <span className="badge badge-warning">Pending</span>;
  };

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <div className="page-header">
          <div>
            <h1 className="page-title">Review Moderation</h1>
            <p className="section-subtitle mt-1">Approve, reject, and reply to patient reviews</p>
          </div>
        </div>

        <div className="card p-3 flex gap-3 flex-wrap items-center">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
          {(['all', 'pending', 'approved', 'rejected'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === s ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead><tr><th>Patient</th><th>Type</th><th>Rating</th><th>Review</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {isLoading ? (
                  [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((__, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : reviews.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-[var(--color-text-muted)]">No reviews found.</td></tr>
                ) : (
                  reviews.map((r: Review) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.reviewer_name ?? 'Anonymous'}</td>
                      <td>{r.doctor_name ? formatDoctorName(r.doctor_name) : 'Hospital'}</td>
                      <td><div className="flex items-center gap-1"><Star className="w-4 h-4 text-amber-500 fill-amber-500" />{r.rating}</div></td>
                      <td className="max-w-xs truncate">{r.review_text ?? '—'}</td>
                      <td>{statusBadge(r.is_approved)}</td>
                      <td className="text-xs">{r.created_at?.slice(0, 10)}</td>
                      <td>
                        <div className="flex gap-1">
                          {r.is_approved === 0 && (
                            <>
                              <button onClick={() => approveMutation.mutate(r.id)} className="btn-ghost text-xs text-emerald-600" title="Approve"><CheckCircle className="w-4 h-4" /></button>
                              <button onClick={() => { const reason = prompt('Rejection reason (optional):'); rejectMutation.mutate({ id: r.id, reason: reason || undefined }); }} className="btn-ghost text-xs text-red-600" title="Reject"><XCircle className="w-4 h-4" /></button>
                            </>
                          )}
                          <button onClick={() => { setReplyingId(r.id); setReplyText(r.provider_reply ?? ''); }} className="btn-ghost text-xs text-blue-600" title="Reply"><MessageSquare className="w-4 h-4" /></button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {replyingId && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
              <h3 className="text-lg font-semibold">Reply to Review</h3>
              <textarea rows={3} value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Write your professional reply..." className="input w-full text-sm" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setReplyingId(null)} className="btn btn-secondary text-sm">Cancel</button>
                <button onClick={() => replyMutation.mutate({ id: replyingId, reply_text: replyText })} disabled={replyMutation.isPending} className="btn btn-primary text-sm">{replyMutation.isPending ? 'Posting...' : 'Post Reply'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
