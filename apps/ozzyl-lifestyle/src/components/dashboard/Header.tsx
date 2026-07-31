import { Bell, LogOut, User, ChevronDown, Check, Trash2, BedDouble, FlaskConical, Receipt, Calendar, Pill, Shield } from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

interface HeaderProps {
  userName?: string;
  userEmail?: string;
  userRole?: string;
  onLogout: () => void;
}

interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  is_read: number;
  link?: string;
  created_at: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  lab:        <FlaskConical className="w-4 h-4 text-blue-500" />,
  appointment:<Calendar className="w-4 h-4 text-amber-500" />,
  billing:    <Receipt className="w-4 h-4 text-emerald-500" />,
  admission:  <BedDouble className="w-4 h-4 text-purple-500" />,
  pharmacy:   <Pill className="w-4 h-4 text-pink-500" />,
  system:     <Shield className="w-4 h-4 text-gray-500" />,
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Header({
  userName  = 'User',
  userEmail,
  userRole  = '',
  onLogout,
}: HeaderProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Grab hospital name from localStorage if set
  const tenant = (() => {
    try { return JSON.parse(localStorage.getItem('tenant') ?? '{}'); }
    catch { return {}; }
  })();
  const hospitalName = tenant?.name ?? 'Ozzyl Health';

  const token = localStorage.getItem('hms_token');
  const authHeaders = { Authorization: `Bearer ${token}` };

  // ─── Fetch unread count (polls every 30s) ───────────────────────────────
  const fetchUnreadCount = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/inbox/unread-count', { headers: authHeaders });
      setUnreadCount(data.count ?? 0);
    } catch {
      // Silently fail — badge will show 0
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 30000);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // ─── Fetch notifications list ───────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    setLoadingNotifs(true);
    try {
      const { data } = await axios.get('/api/inbox?limit=15', { headers: authHeaders });
      setNotifications(data.notifications ?? []);
    } catch {
      setNotifications([]);
    } finally {
      setLoadingNotifs(false);
    }
  }, []);

  // ─── Toggle notification panel ──────────────────────────────────────────
  const toggleNotifs = () => {
    const next = !showNotifs;
    setShowNotifs(next);
    setShowDropdown(false);
    if (next) fetchNotifications();
  };

  // ─── Mark single as read ────────────────────────────────────────────────
  const markRead = async (id: number) => {
    try {
      await axios.patch(`/api/inbox/${id}/read`, {}, { headers: authHeaders });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  // ─── Mark all as read ───────────────────────────────────────────────────
  const markAllRead = async () => {
    try {
      await axios.patch('/api/inbox/read-all', {}, { headers: authHeaders });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  };

  // ─── Delete notification ────────────────────────────────────────────────
  const deleteNotif = async (id: number) => {
    try {
      await axios.delete(`/api/inbox/${id}`, { headers: authHeaders });
      const removed = notifications.find(n => n.id === id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (removed && !removed.is_read) setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  // ─── Click outside to close ─────────────────────────────────────────────
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifs(false);
      }
    };
    if (showNotifs) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showNotifs]);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowNotifs(false); setShowDropdown(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Derive avatar initials from userName
  const avatarInitial = String(userName || 'U').trim()[0]?.toUpperCase() ?? 'U';

  return (
    <header className="h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-[var(--color-border)]/80 flex items-center justify-between px-6 shrink-0 sticky top-0 z-20">

      {/* Left: Hospital Name */}
      <div className="flex items-center gap-3">
        {/* Mobile spacer for hamburger */}
        <div className="w-10 lg:hidden" />
        <span className="font-semibold text-[var(--color-primary-dark)] text-[15px] hidden sm:block">
          {hospitalName}
        </span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">

        {/* ─── Notification Bell ─── */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={toggleNotifs}
            aria-label={showNotifs ? "Close notifications" : (unreadCount > 0 ? `${unreadCount} unread notifications. Open notifications` : "Open notifications")}
            aria-expanded={showNotifs}
            aria-controls="notifications-panel"
            className={`relative p-2 rounded-lg hover:bg-[var(--color-border-light)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] ${
              unreadCount > 0 && !showNotifs ? 'animate-ring-pulse' : ''
            }`}
          >
            <Bell className={`w-5 h-5 ${showNotifs ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-secondary)]'}`} aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 ring-2 ring-white dark:ring-slate-900" aria-hidden="true">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* ─── Notification Dropdown ─── */}
          {showNotifs && (
            <div id="notifications-panel" className="absolute right-0 top-full mt-2 w-[360px] max-w-[90vw] bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-xl shadow-modal z-50 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
                <h3 className="font-semibold text-sm text-[var(--color-text)]">Notifications</h3>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-xs text-[var(--color-primary)] hover:underline font-medium">
                    Mark all read
                  </button>
                )}
              </div>

              {/* Notification list */}
              <div className="max-h-[400px] overflow-y-auto">
                {loadingNotifs ? (
                  <div className="p-4 space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="flex gap-3 animate-pulse">
                        <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-slate-700" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 bg-gray-100 dark:bg-slate-700 rounded w-3/4" />
                          <div className="h-2.5 bg-gray-100 dark:bg-slate-700 rounded w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="py-12 text-center">
                    <Bell className="w-10 h-10 mx-auto text-[var(--color-text-muted)] opacity-30 mb-2" />
                    <p className="text-sm text-[var(--color-text-muted)]">No notifications</p>
                  </div>
                ) : (
                  notifications.map(notif => (
                    <div
                      key={notif.id}
                      className={`flex items-start gap-3 px-4 py-3 border-b border-[var(--color-border)] last:border-0 transition-colors group
                        ${notif.is_read ? 'bg-transparent' : 'bg-blue-50/50 dark:bg-blue-900/10'}
                        ${notif.link ? 'cursor-pointer hover:bg-[var(--color-border-light)]' : ''}
                      `}
                      onClick={() => {
                        if (!notif.is_read) markRead(notif.id);
                        if (notif.link) {
                          setShowNotifs(false);
                          window.location.href = notif.link;
                        }
                      }}
                    >
                      {/* Icon */}
                      <div className="w-8 h-8 rounded-full bg-[var(--color-bg)] flex items-center justify-center shrink-0 mt-0.5">
                        {TYPE_ICONS[notif.type] ?? TYPE_ICONS.system}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm leading-tight ${notif.is_read ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text)] font-medium'}`}>
                          {notif.title}
                        </p>
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">{notif.message}</p>
                        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">{timeAgo(notif.created_at)}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        {!notif.is_read && (
                          <button
                            onClick={(e) => { e.stopPropagation(); markRead(notif.id); }}
                            className="p-1 rounded hover:bg-[var(--color-border-light)]"
                            title="Mark as read"
                            aria-label="Mark as read"
                          >
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteNotif(notif.id); }}
                          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                          title="Delete"
                          aria-label="Delete notification"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-[var(--color-border)]" />

        {/* User dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowDropdown(v => !v); setShowNotifs(false); }}
            aria-haspopup="menu"
            aria-expanded={showDropdown}
            aria-controls="user-dropdown-menu"
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--color-border-light)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            {/* Avatar — shows initials with gradient */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-cyan-400 flex items-center justify-center shrink-0 shadow-sm shadow-cyan-500/20">
              <span className="text-white text-xs font-bold leading-none" aria-hidden="true">{avatarInitial}</span>
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium text-[var(--color-text-primary)] leading-none">{userName}</p>
              {userEmail && (
                <p className="text-xs text-[var(--color-text-muted)] leading-none mt-0.5">{userEmail}</p>
              )}
            </div>
            {/* Visually hidden text for screen readers so they know the button state/action */}
            <span className="sr-only">
              {showDropdown ? "Close user menu" : "Open user menu"}
            </span>
            <ChevronDown className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform duration-150 ${showDropdown ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>

          {/* Dropdown menu */}
          {showDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)} aria-hidden="true" />
              <div id="user-dropdown-menu" className="absolute right-0 top-full mt-1.5 w-52 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-xl shadow-modal z-20 overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--color-border)]">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">{userName}</p>
                  {userEmail && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{userEmail}</p>}
                  {userRole && (
                    <span className="badge badge-primary text-xs mt-1.5 capitalize">
                      {userRole.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
                <div className="p-1.5">
                  <button
                    onClick={() => { setShowDropdown(false); onLogout(); }}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
