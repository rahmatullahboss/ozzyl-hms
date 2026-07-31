import { useState, useCallback, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import {
  Bell, FlaskConical, Calendar, DollarSign, BedDouble, Settings, CheckCheck,
  ChevronRight, Loader2
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  is_read: number;
  link?: string;
  created_at: string;
}

type FilterType = 'all' | 'unread' | 'read';

// ─── Type icons ──────────────────────────────────────────────────────────────

const TYPE_ICON: Record<string, { icon: React.ReactNode; bg: string }> = {
  lab:         { icon: <FlaskConical className="w-4 h-4 text-purple-600" />,  bg: 'bg-purple-100' },
  appointment: { icon: <Calendar className="w-4 h-4 text-blue-600" />,        bg: 'bg-blue-100' },
  billing:     { icon: <DollarSign className="w-4 h-4 text-emerald-600" />,   bg: 'bg-emerald-100' },
  admission:   { icon: <BedDouble className="w-4 h-4 text-amber-600" />,      bg: 'bg-amber-100' },
  pharmacy:    { icon: <FlaskConical className="w-4 h-4 text-red-500" />,     bg: 'bg-red-100' },
  system:      { icon: <Settings className="w-4 h-4 text-gray-500" />,        bg: 'bg-gray-100' },
};

// ─── Relative time helper ────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// Demo data
const DEMO_NOTIFICATIONS: Notification[] = [
  { id: 1, type: 'lab', title: 'Lab Results Ready', message: 'Complete blood count for Mohammad Karim is ready for review', is_read: 0, created_at: new Date(Date.now() - 120000).toISOString() },
  { id: 2, type: 'appointment', title: 'New Appointment', message: 'Fatima Begum scheduled consultation with Dr. Rahman at 3:00 PM', is_read: 0, created_at: new Date(Date.now() - 900000).toISOString() },
  { id: 3, type: 'billing', title: 'Payment Received', message: '৳ 5,200 received from Abdul Hashem -- Bill #INV-00045', is_read: 1, created_at: new Date(Date.now() - 3600000).toISOString() },
  { id: 4, type: 'admission', title: 'Patient Admitted', message: 'Emergency admission: Rahim Uddin to ICU-2', is_read: 1, created_at: new Date(Date.now() - 10800000).toISOString() },
  { id: 5, type: 'pharmacy', title: 'Prescription Alert', message: 'Amoxicillin stock low -- 12 units remaining', is_read: 1, created_at: new Date(Date.now() - 86400000).toISOString() },
  { id: 6, type: 'system', title: 'System Update', message: 'Scheduled maintenance on March 15, 2026 at 2:00 AM BST', is_read: 1, created_at: new Date(Date.now() - 172800000).toISOString() },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function NotificationsCenter({ role = 'hospital_admin' }: { role?: string }) {
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const { t } = useTranslation(['notifications', 'common']);
  const queryClient = useQueryClient();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<FilterType>('all');
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const { data: notifData, isLoading: loading, isError } = useApiQuery<{ notifications: Notification[]; unreadCount: number }>(
    queryKeys.notifications.list(filter, 0),
    `/api/notifications?filter=${filter}&limit=20&offset=0`,
  );

  useEffect(() => {
    if (notifData) {
      const items = notifData.notifications ?? [];
      setNotifications(items);
      setUnreadCount(notifData.unreadCount ?? 0);
      setHasMore(items.length === 20);
      setOffset(0);
    } else if (isError) {
      const filtered = filter === 'all' ? DEMO_NOTIFICATIONS
        : filter === 'unread' ? DEMO_NOTIFICATIONS.filter(n => !n.is_read)
        : DEMO_NOTIFICATIONS.filter(n => n.is_read === 1);
      setNotifications(filtered);
      setUnreadCount(DEMO_NOTIFICATIONS.filter(n => !n.is_read).length);
      setHasMore(false);
    }
  }, [notifData, isError, filter]);

  const markRead = async (id: number) => {
    try {
      await api.put(`/api/notifications/${id}/read`, {});
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
      setUnreadCount(c => Math.max(0, c - 1));
    } catch {
      toast.error(t('notifications.failed_to_mark_as_read'));
    }
  };

  const markAllRead = async () => {
    try {
      await api.put('/api/notifications/read-all', {});
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
      toast.success(t('notifications.all_marked_as_read'));
    } catch {
      toast.error(t('notifications.failed_to_mark_all_as_read'));
    }
  };

  const loadMore = async () => {
    const newOffset = offset + 20;
    setLoadingMore(true);
    try {
      const data = await api.get<{ notifications: Notification[]; unreadCount: number }>(
        `/api/notifications?filter=${filter}&limit=20&offset=${newOffset}`
      );
      const items = data.notifications ?? [];
      setNotifications(prev => [...prev, ...items]);
      setUnreadCount(data.unreadCount ?? 0);
      setHasMore(items.length === 20);
      setOffset(newOffset);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('title')}</span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
                <Bell className="w-6 h-6" /> {t('title')}
              </h1>
              {unreadCount > 0 && (
                <span className="text-xs bg-[var(--color-primary)] text-white rounded-full px-2.5 py-0.5 font-medium">
                  {unreadCount} {t('unread')}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1">
                <CheckCheck className="w-4 h-4" /> {t('markAllRead')}
              </button>
            )}
            <select value={filter} onChange={e => setFilter(e.target.value as FilterType)}
              className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm bg-white">
              <option value="all">{t('all')}</option>
              <option value="unread">{t('unread')}</option>
              <option value="read">{t('read')}</option>
            </select>
          </div>
        </div>

        {/* Notification List */}
        <div className="space-y-2">
          {loading ? (
            <div className="card p-8 text-center text-[var(--color-text-muted)]">{t('loading', { ns: 'common' })}</div>
          ) : notifications.length === 0 ? (
            <div className="card p-12 text-center">
              <Bell className="w-10 h-10 mx-auto mb-2 text-[var(--color-text-muted)] opacity-40" />
              <p className="text-[var(--color-text-muted)]">{t('none')}</p>
            </div>
          ) : (
            notifications.map(n => {
              const typeInfo = TYPE_ICON[n.type] ?? TYPE_ICON.system;
              return (
                <div key={n.id}
                  onClick={() => { if (!n.is_read) markRead(n.id); }}
                  className={`card px-4 py-3 flex items-start gap-3 cursor-pointer transition-all hover:shadow-md ${
                    !n.is_read ? 'border-l-4 border-l-[var(--color-primary)] bg-[var(--color-primary)]/[0.03]' : ''
                  }`}>
                  {/* Type Icon */}
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${typeInfo.bg}`}>
                    {typeInfo.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm ${!n.is_read ? 'font-semibold text-[var(--color-text)]' : 'font-medium text-[var(--color-text)]'}`}>
                        {n.title}
                      </p>
                      <span className="text-[10px] text-[var(--color-text-muted)] whitespace-nowrap">
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">{n.message}</p>
                  </div>

                  {/* Unread dot */}
                  {!n.is_read && (
                    <span className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)] flex-shrink-0 mt-1.5" />
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Load more */}
        {hasMore && !loading && notifications.length > 0 && (
          <div className="text-center">
            <button onClick={loadMore} disabled={loadingMore}
              className="btn-secondary inline-flex items-center gap-1">
              {loadingMore ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('loading', { ns: 'common' })}</> : t('loadMore', { defaultValue: 'Load More' })}
            </button>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
