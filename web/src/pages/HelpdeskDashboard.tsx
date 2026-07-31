import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import {
  Ticket, Plus, Search, RefreshCw, MessageSquare, Clock, AlertTriangle,
  CheckCircle, XCircle, ArrowUpCircle, User, Filter, Send,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';

interface TicketItem {
  id: number; ticket_no: string; title: string; description: string; category: string;
  priority: string; status: string; requester_name: string; assigned_to_name?: string;
  created_at: string; due_at?: string; ward_name?: string; patient_name?: string;
  resolution_time_minutes?: number; reopened_count: number;
}

interface Comment {
  id: number; author_name: string; content: string; is_internal: number; is_system: number; created_at: string;
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  closed: 'bg-gray-100 text-gray-600',
  escalated: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
};

const PRIORITY_COLORS: Record<string, string> = {
  low: 'badge-secondary',
  medium: 'badge-primary',
  high: 'badge-warning',
  critical: 'badge-danger',
};

const CATEGORIES = ['it', 'facility', 'equipment', 'billing', 'hr', 'security', 'other'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'escalated', 'cancelled'];

export default function HelpdeskDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['helpdesk', 'common']);
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TicketItem | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);

  const [form, setForm] = useState({
    title: '', description: '', category: 'it' as string, priority: 'medium' as string,
    wardName: '', patientName: '',
  });

  useEffect(() => { setPage(1); }, [statusFilter, priorityFilter, categoryFilter]);

  const { data: stats } = useApiQuery<{ openTickets: number; criticalTickets: number; resolvedToday: number; slaBreached: number; avgResolutionMinutes: number; byCategory: { category: string; count: number }[] }>(
    ['helpdesk', 'stats'],
    '/api/helpdesk/stats'
  );

  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (statusFilter) params.set('status', statusFilter);
  if (priorityFilter) params.set('priority', priorityFilter);
  if (categoryFilter) params.set('category', categoryFilter);

  const { data: ticketData, isLoading: loadingTickets } = useApiQuery<{ tickets: TicketItem[]; pagination: { total: number } }>(
    ['helpdesk', 'tickets', statusFilter, priorityFilter, categoryFilter, page],
    `/api/helpdesk/tickets?${params.toString()}`
  );

  const createMutation = useApiMutation('post', '/api/helpdesk/tickets', {
    onSuccess: () => {
      toast.success(t('dashboard.toasts.ticketCreated'));
      setShowModal(false);
      setForm({ title: '', description: '', category: 'it', priority: 'medium', wardName: '', patientName: '' });
      queryClient.invalidateQueries({ queryKey: ['helpdesk'] });
    },
    onError: (err: any) => toast.error(err.message || t('common:operationFailed')),
  });

  const updateMutation = useApiMutation('patch', (vars: any) => `/api/helpdesk/tickets/${vars.id}`, {
    onSuccess: () => {
      toast.success(t('dashboard.toasts.ticketUpdated'));
      queryClient.invalidateQueries({ queryKey: ['helpdesk'] });
    },
    onError: (err: any) => toast.error(err.message || t('common:operationFailed')),
  });

  const commentMutation = useApiMutation('post', '/api/helpdesk/comments', {
    onSuccess: () => {
      toast.success(t('dashboard.toasts.commentAdded'));
      setNewComment('');
      if (selectedTicket) loadComments(selectedTicket.id);
      queryClient.invalidateQueries({ queryKey: ['helpdesk'] });
    },
    onError: (err: any) => toast.error(err.message || t('common:operationFailed')),
  });

  const loadComments = async (ticketId: number) => {
    const res = await api.get<{ comments: Comment[] }>(`/api/helpdesk/tickets/${ticketId}/comments`);
    setComments(res?.comments ?? []);
  };

  const openDetail = async (ticket: TicketItem) => {
    setSelectedTicket(ticket);
    await loadComments(ticket.id);
    setShowDetail(true);
  };

  const submitTicket = () => {
    if (!form.title || !form.description) { toast.error(t('dashboard.toasts.validationError')); return; }
    createMutation.mutate({
      title: form.title, description: form.description,
      category: form.category, priority: form.priority,
      wardName: form.wardName || undefined, patientName: form.patientName || undefined,
    });
  };

  const submitComment = () => {
    if (!newComment.trim() || !selectedTicket) return;
    commentMutation.mutate({ ticketId: selectedTicket.id, content: newComment, isInternal });
  };

  return (
    <DashboardLayout role={role}>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('dashboard.title')}</h1>
            <p className="section-subtitle mt-1">{t('dashboard.subtitle')}</p>
          </div>
        </div>

        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard title={t('dashboard.stats.openTickets')} value={String(stats?.openTickets ?? 0)} icon={<Ticket className="w-5 h-5" />} iconBg="bg-blue-50 text-blue-600" loading={!stats} />
          <KPICard title={t('dashboard.stats.critical')} value={String(stats?.criticalTickets ?? 0)} icon={<AlertTriangle className="w-5 h-5" />} iconBg="bg-red-50 text-red-600" loading={!stats} />
          <KPICard title={t('dashboard.stats.resolvedToday')} value={String(stats?.resolvedToday ?? 0)} icon={<CheckCircle className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" loading={!stats} />
          <KPICard title={t('dashboard.stats.slaBreached')} value={String(stats?.slaBreached ?? 0)} icon={<Clock className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" loading={!stats} />
          <KPICard title={t('dashboard.stats.avgResolution')} value={`${stats?.avgResolutionMinutes ?? 0}m`} icon={<Clock className="w-5 h-5" />} iconBg="bg-purple-50 text-purple-600" loading={!stats} />
        </div>

        {/* Category breakdown */}
        {stats?.byCategory && stats.byCategory.length > 0 && (
          <div className="card p-4">
            <p className="text-sm font-medium text-[var(--color-text-secondary)] mb-2">{t('dashboard.charts.byCategory')}</p>
            <div className="flex flex-wrap gap-2">
              {stats.byCategory.map(c => (
                <span key={c.category} className="badge badge-primary text-xs">{t(`categories.${c.category}`)}: {c.count}</span>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="card p-3 flex gap-3 flex-wrap items-center">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
          <select className="input w-36 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">{t('dashboard.filters.allStatus')}</option>
            {STATUSES.map(s => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
          </select>
          <select className="input w-36 text-sm" value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
            <option value="">{t('dashboard.filters.allPriority')}</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
          </select>
          <select className="input w-36 text-sm" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="">{t('dashboard.filters.allCategories')}</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
          </select>
          <button onClick={() => queryClient.invalidateQueries({ queryKey: ['helpdesk'] })} className="btn-ghost ml-auto text-sm">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setShowModal(true)} className="btn-primary text-sm flex items-center gap-1">
            <Plus className="w-4 h-4" /> {t('dashboard.tickets.create')}
          </button>
        </div>

        {/* Tickets Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base text-sm">
              <thead>
                <tr>
                  <th>{t('dashboard.tickets.table.ticketNo')}</th>
                  <th>{t('dashboard.tickets.table.title')}</th>
                  <th>{t('dashboard.tickets.table.category')}</th>
                  <th>{t('dashboard.tickets.table.priority')}</th>
                  <th>{t('dashboard.tickets.table.status')}</th>
                  <th>{t('dashboard.tickets.table.requester')}</th>
                  <th>{t('dashboard.tickets.table.assigned')}</th>
                  <th>{t('dashboard.tickets.table.date')}</th>
                  <th>{t('dashboard.tickets.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {loadingTickets ? (
                  [...Array(5)].map((_, i) => <tr key={i}>{[...Array(9)].map((__, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : ticketData?.tickets?.length === 0 ? (
                  <tr><td colSpan={9}><EmptyState icon={<Ticket className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('dashboard.tickets.noTickets')} description={t('dashboard.tickets.noTicketsDesc')} /></td></tr>
                ) : (
                  ticketData?.tickets?.map(ticket => (
                    <tr key={ticket.id} className="cursor-pointer hover:bg-[var(--color-bg-secondary)]" onClick={() => openDetail(ticket)}>
                      <td className="font-mono text-xs">{ticket.ticket_no}</td>
                      <td className="font-medium max-w-xs truncate">{ticket.title}</td>
                      <td>{t(`categories.${ticket.category}`)}</td>
                      <td><span className={`badge ${PRIORITY_COLORS[ticket.priority] ?? 'badge-secondary'} text-xs`}>{t(`priority.${ticket.priority}`)}</span></td>
                      <td><span className={`badge text-xs ${STATUS_COLORS[ticket.status] ?? 'bg-gray-100'}`}>{t(`status.${ticket.status}`)}</span></td>
                      <td>{ticket.requester_name}</td>
                      <td>{ticket.assigned_to_name ?? '—'}</td>
                      <td className="text-xs">{String(ticket.created_at).slice(0,10)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          {ticket.status === 'open' && <button onClick={() => updateMutation.mutate({ id: ticket.id, body: { status: 'in_progress' } })} className="btn-ghost text-xs text-amber-600"><ArrowUpCircle className="w-4 h-4" /></button>}
                          {ticket.status === 'in_progress' && <button onClick={() => updateMutation.mutate({ id: ticket.id, body: { status: 'resolved' } })} className="btn-ghost text-xs text-emerald-600"><CheckCircle className="w-4 h-4" /></button>}
                          {ticket.status === 'resolved' && <button onClick={() => updateMutation.mutate({ id: ticket.id, body: { status: 'closed' } })} className="btn-ghost text-xs text-gray-600"><XCircle className="w-4 h-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
              <h3 className="text-lg font-semibold">{t('dashboard.tickets.newTicketModal')}</h3>
              <input placeholder={t('dashboard.tickets.title')} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="input w-full text-sm" />
              <textarea placeholder={t('dashboard.tickets.description')} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={3} className="input w-full text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input text-sm">
                  {CATEGORIES.map(c => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
                </select>
                <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="input text-sm">
                  {PRIORITIES.map(p => <option key={p} value={p}>{t(`priority.${p}`)}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input placeholder={t('dashboard.tickets.wardName')} value={form.wardName} onChange={e => setForm(f => ({ ...f, wardName: e.target.value }))} className="input text-sm" />
                <input placeholder={t('dashboard.tickets.patientName')} value={form.patientName} onChange={e => setForm(f => ({ ...f, patientName: e.target.value }))} className="input text-sm" />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowModal(false)} className="btn btn-secondary text-sm">{t('common:cancel')}</button>
                <button onClick={submitTicket} disabled={createMutation.isPending} className="btn btn-primary text-sm">{createMutation.isPending ? t('dashboard.tickets.saving') : t('dashboard.tickets.createBtn')}</button>
              </div>
            </div>
          </div>
        )}

        {/* Detail Modal */}
        {showDetail && selectedTicket && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-[var(--color-bg-card)] rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-mono text-xs text-[var(--color-text-muted)]">{selectedTicket.ticket_no}</p>
                  <h3 className="text-lg font-semibold">{selectedTicket.title}</h3>
                  <div className="flex gap-2 mt-1">
                    <span className={`badge ${PRIORITY_COLORS[selectedTicket.priority] ?? 'badge-secondary'} text-xs`}>{t(`priority.${selectedTicket.priority}`)}</span>
                    <span className={`badge text-xs ${STATUS_COLORS[selectedTicket.status] ?? 'bg-gray-100'}`}>{t(`status.${selectedTicket.status}`)}</span>
                    <span className="badge badge-secondary text-xs">{t(`categories.${selectedTicket.category}`)}</span>
                  </div>
                </div>
                <button onClick={() => setShowDetail(false)} className="btn-ghost"><XCircle className="w-5 h-5" /></button>
              </div>

              <div className="text-sm text-[var(--color-text-secondary)] space-y-1">
                <p><span className="font-medium">{t('dashboard.tickets.table.requester')}:</span> {selectedTicket.requester_name}</p>
                <p><span className="font-medium">{t('dashboard.tickets.table.assigned')}:</span> {selectedTicket.assigned_to_name ?? t('dashboard.unassigned')}</p>
                {selectedTicket.ward_name && <p><span className="font-medium">{t('dashboard.tickets.wardName')}:</span> {selectedTicket.ward_name}</p>}
                {selectedTicket.patient_name && <p><span className="font-medium">{t('dashboard.tickets.patientName')}:</span> {selectedTicket.patient_name}</p>}
                <p><span className="font-medium">{t('dashboard.tickets.createdDate')}:</span> {String(selectedTicket.created_at).slice(0,10)}</p>
                {selectedTicket.due_at && <p><span className="font-medium">{t('dashboard.tickets.due')}:</span> {String(selectedTicket.due_at).slice(0,10)}</p>}
              </div>

              <div className="bg-[var(--color-bg-secondary)] rounded-lg p-3 text-sm">
                {selectedTicket.description}
              </div>

              {/* Status actions */}
              <div className="flex gap-2 flex-wrap">
                {selectedTicket.status === 'open' && <button onClick={() => { updateMutation.mutate({ id: selectedTicket.id, body: { status: 'in_progress' } }); setShowDetail(false); }} className="btn btn-primary text-sm">{t('dashboard.tickets.modal.startWorking')}</button>}
                {selectedTicket.status === 'in_progress' && <button onClick={() => { updateMutation.mutate({ id: selectedTicket.id, body: { status: 'resolved' } }); setShowDetail(false); }} className="btn btn-primary text-sm">{t('dashboard.tickets.modal.markResolved')}</button>}
                {selectedTicket.status === 'resolved' && <button onClick={() => { updateMutation.mutate({ id: selectedTicket.id, body: { status: 'closed' } }); setShowDetail(false); }} className="btn btn-secondary text-sm">{t('dashboard.tickets.modal.closeTicket')}</button>}
                <button onClick={() => { updateMutation.mutate({ id: selectedTicket.id, body: { status: 'escalated' } }); setShowDetail(false); }} className="btn btn-secondary text-sm">{t('dashboard.tickets.modal.escalate')}</button>
              </div>

              {/* Comments */}
              <div className="border-t border-[var(--color-border)] pt-4">
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1"><MessageSquare className="w-4 h-4" /> {t('dashboard.tickets.modal.comments')}</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto mb-3">
                  {comments.length === 0 ? (
                    <p className="text-xs text-[var(--color-text-muted)]">{t('dashboard.tickets.modal.noComments')}</p>
                  ) : (
                    comments.map(c => (
                      <div key={c.id} className={`text-sm rounded-lg p-2 ${c.is_system ? 'bg-blue-50 text-blue-800' : c.is_internal ? 'bg-amber-50' : 'bg-[var(--color-bg-secondary)]'}`}>
                        <div className="flex justify-between">
                          <span className="font-medium text-xs">{c.author_name} {c.is_internal ? `(${t('dashboard.tickets.modal.internal')})` : ''}</span>
                          <span className="text-[10px] text-[var(--color-text-muted)]">{String(c.created_at).slice(0,16).replace('T', ' ')}</span>
                        </div>
                        <p className="mt-0.5">{c.content}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-2">
                  <input placeholder={t('dashboard.tickets.modal.addComment')} value={newComment} onChange={e => setNewComment(e.target.value)} className="input text-sm flex-1" onKeyDown={e => e.key === 'Enter' && submitComment()} />
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} /> {t('dashboard.tickets.modal.internal')}
                  </label>
                  <button onClick={submitComment} disabled={commentMutation.isPending} className="btn btn-primary text-sm"><Send className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
