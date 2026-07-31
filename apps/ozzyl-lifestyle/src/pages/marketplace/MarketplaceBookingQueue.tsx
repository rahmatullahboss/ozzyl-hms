import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import toast from 'react-hot-toast';
import {
  ShoppingCart, CheckCircle, XCircle, Clock, CalendarDays,
  Stethoscope, User, Phone, Filter, Globe, Video,
  ChevronLeft, ChevronRight, RefreshCw, ExternalLink,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';

interface MarketplaceBooking {
  id: number;
  patient_global_id: string;
  patient_name: string | null;
  patient_phone: string | null;
  doctor_id: number;
  doctor_name: string | null;
  doctor_specialty: string | null;
  booking_date: string;
  booking_time: string;
  token_number: number | null;
  fee: number;
  status: string;
  source: string;
  local_appointment_id: number | null;
  created_at: string;
}

interface BookingStats {
  total: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  marketplace: number;
  telemedicine: number;
}

export default function MarketplaceBookingQueue({ role = 'hospital_admin' }: { role?: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');

  const limit = 20;

  const { data, isLoading, isFetching } = useQuery<{
    data: MarketplaceBooking[];
    pagination: { page: number; limit: number; total: number };
    stats: BookingStats;
  }>({
    queryKey: ['marketplace-admin', 'bookings', page, statusFilter, sourceFilter, dateFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (statusFilter) params.set('status', statusFilter);
      if (sourceFilter) params.set('source', sourceFilter);
      if (dateFilter) params.set('date', dateFilter);
      return api.get(`/api/v1/marketplace-admin/bookings?${params}`);
    },
  });

  const bookings = data?.data ?? [];
  const stats = data?.stats ?? { total: 0, confirmed: 0, completed: 0, cancelled: 0, marketplace: 0, telemedicine: 0 };
  const totalPages = Math.ceil((data?.pagination.total ?? 0) / limit);

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: string; reason?: string }) =>
      api.put(`/api/v1/marketplace-admin/bookings/${id}/status`, { status, reason }),
    onSuccess: () => {
      toast.success('Booking status updated');
      queryClient.invalidateQueries({ queryKey: ['marketplace-admin', 'bookings'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update'),
  });

  const statusBadge = (status: string) => {
    const map: Record<string, { cls: string; icon: React.ReactNode }> = {
      confirmed: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: <CheckCircle className="w-3 h-3" /> },
      completed: { cls: 'bg-blue-50 text-blue-700 border-blue-200', icon: <CheckCircle className="w-3 h-3" /> },
      cancelled: { cls: 'bg-red-50 text-red-700 border-red-200', icon: <XCircle className="w-3 h-3" /> },
      no_show:   { cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock className="w-3 h-3" /> },
    };
    const s = map[status] ?? { cls: 'bg-gray-50 text-gray-600 border-gray-200', icon: <Clock className="w-3 h-3" /> };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${s.cls}`}>
        {s.icon} {status.replace(/_/g, ' ')}
      </span>
    );
  };

  const sourceBadge = (source: string) => {
    if (source === 'marketplace') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
        <Globe className="w-3 h-3" /> Marketplace
      </span>
    );
    if (source === 'telemedicine') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-50 text-cyan-700 border border-cyan-200">
        <Video className="w-3 h-3" /> Telemedicine
      </span>
    );
    return <span className="text-xs text-gray-400">{source}</span>;
  };

  const feeDisplay = (fee: number) => fee ? `৳${(fee / 100).toLocaleString()}` : '—';

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <ShoppingCart className="w-6 h-6 text-[var(--color-primary)]" />
              Marketplace Booking Queue
            </h1>
            <p className="section-subtitle mt-1">Manage incoming appointments from marketplace and telemedicine</p>
          </div>
          <button onClick={() => navigate('/dashboard')} className="btn-secondary text-sm self-start">
            Back to Dashboard
          </button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total', value: stats.total, color: 'text-[var(--color-primary)]', icon: <ShoppingCart className="w-5 h-5" /> },
            { label: 'Confirmed', value: stats.confirmed, color: 'text-emerald-600', icon: <CheckCircle className="w-5 h-5" /> },
            { label: 'Completed', value: stats.completed, color: 'text-blue-600', icon: <CheckCircle className="w-5 h-5" /> },
            { label: 'Cancelled', value: stats.cancelled, color: 'text-red-600', icon: <XCircle className="w-5 h-5" /> },
          ].map(s => (
            <div key={s.label} className="card p-4 flex items-center gap-3">
              <div className={s.color}>{s.icon}</div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">{s.label}</p>
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Source Breakdown */}
        <div className="card p-4 flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-purple-600" />
            <span className="text-sm text-[var(--color-text-muted)]">Marketplace:</span>
            <span className="text-sm font-bold text-purple-700">{stats.marketplace}</span>
          </div>
          <div className="flex items-center gap-2">
            <Video className="w-4 h-4 text-cyan-600" />
            <span className="text-sm text-[var(--color-text-muted)]">Telemedicine:</span>
            <span className="text-sm font-bold text-cyan-700">{stats.telemedicine}</span>
          </div>
          <button
            onClick={() => { setPage(1); setStatusFilter(''); setSourceFilter(''); setDateFilter(''); }}
            className="ml-auto btn-ghost text-xs flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Reset
          </button>
        </div>

        {/* Filters */}
        <div className="card p-3 flex flex-wrap gap-2 items-center">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }} className="input text-sm">
            <option value="">All Statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>
          <select value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setPage(1); }} className="input text-sm">
            <option value="">All Sources</option>
            <option value="marketplace">Marketplace</option>
            <option value="telemedicine">Telemedicine</option>
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={e => { setDateFilter(e.target.value); setPage(1); }}
            className="input text-sm"
          />
          {isFetching && <div className="ml-auto w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />}
        </div>

        {/* Bookings Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Date & Time</th>
                  <th>Fee</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>{[...Array(8)].map((__, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                  ))
                ) : bookings.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center py-12 text-[var(--color-text-muted)]">
                      <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">No marketplace bookings found</p>
                      <p className="text-xs mt-1">Bookings from marketplace and telemedicine will appear here</p>
                    </td>
                  </tr>
                ) : (
                  bookings.map(b => (
                    <tr key={b.id} className={b.status === 'cancelled' ? 'opacity-50' : ''}>
                      <td className="font-mono text-xs">#{b.id}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <User className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                          <div>
                            <p className="font-medium text-sm">{b.patient_name ?? 'Unknown'}</p>
                            {b.patient_phone && <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1"><Phone className="w-3 h-3" />{b.patient_phone}</p>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Stethoscope className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                          <div>
                            <p className="text-sm">{b.doctor_name ?? '—'}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{b.doctor_specialty ?? ''}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <CalendarDays className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                          <div>
                            <p className="text-sm">{b.booking_date}</p>
                            <p className="text-xs text-[var(--color-text-muted)]">{b.booking_time} {b.token_number ? `(Token #${b.token_number})` : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="font-medium text-green-700">{feeDisplay(b.fee)}</td>
                      <td>{sourceBadge(b.source)}</td>
                      <td>{statusBadge(b.status)}</td>
                      <td>
                        <div className="flex gap-1">
                          {b.status === 'confirmed' && (
                            <>
                              <button
                                onClick={() => updateStatusMutation.mutate({ id: b.id, status: 'completed' })}
                                className="btn-ghost text-xs text-emerald-600 p-1"
                                title="Mark Completed"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  const reason = prompt('Cancellation reason (optional):');
                                  updateStatusMutation.mutate({ id: b.id, status: 'cancelled', reason: reason || undefined });
                                }}
                                className="btn-ghost text-xs text-red-600 p-1"
                                title="Cancel"
                              >
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {b.local_appointment_id && (
                            <button
                              onClick={() => navigate(`/h/${location.pathname.split('/')[2]}/patients`)}
                              className="btn-ghost text-xs text-blue-600 p-1"
                              title="View Patient"
                            >
                              <ExternalLink className="w-4 h-4" />
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
      </div>
    </DashboardLayout>
  );
}
