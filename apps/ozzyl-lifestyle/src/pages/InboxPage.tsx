import { useState, useEffect, useCallback } from 'react';
import { Bell, Check, CheckCheck, Trash2, ExternalLink, Filter, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import EmptyState from '../components/dashboard/EmptyState';
import { api } from '../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  is_read: number;
  link?: string;
  created_at: string;
}

function fmtAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function typeColor(type: string): string {
  switch (type) {
    case 'appointment': return 'from-blue-500 to-cyan-500';
    case 'billing': return 'from-emerald-500 to-teal-500';
    case 'lab': return 'from-purple-500 to-violet-500';
    case 'emergency': return 'from-red-500 to-orange-500';
    case 'admission': return 'from-amber-500 to-yellow-500';
    case 'pharmacy': return 'from-pink-500 to-rose-500';
    default: return 'from-slate-400 to-slate-600';
  }
}

function typeBadge(type: string): string {
  switch (type) {
    case 'appointment': return 'badge-info';
    case 'billing': return 'badge-success';
    case 'lab': return 'badge-warning';
    case 'emergency': return 'badge-danger';
    case 'admission': return 'badge-info';
    default: return 'badge-info';
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InboxPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('sidebar');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = filter === 'unread' ? '?unread=1' : '';
      const data = await api.get<{ notifications: Notification[] }>(`/api/inbox${params}`);
      setNotifications(data.notifications ?? []);
    } catch {
      toast.error(t('notifications.failed_to_load_notifications'));
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await api.get<{ count: number }>('/api/inbox/unread-count');
      setUnreadCount(data.count ?? 0);
    } catch { /* silently ignore */ }
  }, []);

  const markRead = async (id: number) => {
    try {
      await api.patch(`/api/inbox/${id}/read`);
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch {
      toast.error(t('notifications.failed_to_mark_as_read'));
    }
  };

  const markAllRead = async () => {
    try {
      await api.patch('/api/inbox/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
      toast.success(t('notifications.all_marked_as_read'));
    } catch {
      toast.error(t('notifications.failed_to_mark_all_as_read'));
    }
  };

  const deleteNotification = async (id: number) => {
    try {
      await api.delete(`/api/inbox/${id}`);
      setNotifications(prev => prev.filter(n => n.id !== id));
      toast.success(t('notifications.notification_deleted'));
    } catch {
      toast.error(t('notifications.failed_to_delete'));
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await fetchNotifications();
    await fetchUnreadCount();
    setRefreshing(false);
  };

  useEffect(() => { fetchNotifications(); fetchUnreadCount(); }, [fetchNotifications, fetchUnreadCount]);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6 max-w-screen-lg mx-auto">

        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title flex items-center gap-2">
                {t('inbox')}
                {unreadCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] rounded-full bg-[var(--color-primary)] text-white text-xs font-bold px-1.5">
                    {unreadCount}
                  </span>
                )}
              </h1>
              <p className="section-subtitle">Notifications & alerts</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={refresh} disabled={refreshing} className="btn-ghost p-2">
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="btn-secondary">
                <CheckCheck className="w-4 h-4" /> Mark all read
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--color-text-muted)]" />
          {(['all', 'unread'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-[var(--color-border-light)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
              }`}
            >
              {f === 'all' ? 'All' : `Unread (${unreadCount})`}
            </button>
          ))}
        </div>

        {/* Notification List */}
        <div className="space-y-2">
          {loading ? (
            [...Array(6)].map((_, i) => (
              <div key={i} className="card p-4 flex items-start gap-4">
                <div className="skeleton w-10 h-10 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-3/4 rounded" />
                  <div className="skeleton h-3 w-full rounded" />
                  <div className="skeleton h-3 w-1/4 rounded" />
                </div>
              </div>
            ))
          ) : notifications.length === 0 ? (
            <div className="card p-12">
              <EmptyState
                icon={<Bell className="w-10 h-10 text-[var(--color-text-muted)]" />}
                title={filter === 'unread' ? 'No unread notifications' : 'No notifications'}
                description="When there are updates, they'll appear here."
              />
            </div>
          ) : (
            notifications.map(notif => (
              <div
                key={notif.id}
                className={`card p-4 flex items-start gap-4 transition-all hover:shadow-md ${
                  !notif.is_read ? 'border-l-4 border-l-[var(--color-primary)] bg-[var(--color-primary-light)]' : ''
                }`}
              >
                {/* Type icon */}
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${typeColor(notif.type)} flex items-center justify-center shadow-sm shrink-0`}>
                  <Bell className="w-5 h-5 text-white" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-sm font-semibold ${!notif.is_read ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
                      {notif.title}
                    </span>
                    <span className={`${typeBadge(notif.type)} text-[10px]`}>{notif.type}</span>
                    {!notif.is_read && (
                      <span className="w-2 h-2 rounded-full bg-[var(--color-primary)] shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)] line-clamp-2">{notif.message}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[11px] text-[var(--color-text-muted)]">{fmtAgo(notif.created_at)}</span>
                    {notif.link && (
                      <a href={notif.link} className="text-[11px] text-[var(--color-primary)] hover:underline flex items-center gap-0.5">
                        <ExternalLink className="w-3 h-3" /> View
                      </a>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {!notif.is_read && (
                    <button onClick={() => markRead(notif.id)} className="btn-ghost p-1.5" title="Mark as read">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => deleteNotification(notif.id)} className="btn-ghost p-1.5 text-red-400 hover:text-red-600" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
