import { Bell, LogOut, User, ChevronDown, Check, Trash2, BedDouble, FlaskConical, Receipt, Calendar, Pill, Shield, Globe, Plus, Search, FileText, BarChart3, ArrowRightLeft, ShieldCheck, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router';
import PageHelpButton from '../PageHelpButton';
import WhatsAppButton from '../WhatsAppButton';
import GlobalSearch from '../GlobalSearch';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiFetch } from '../../lib/apiClient';
import { getTenant } from '../../hooks/useAuth';
import { useCurrentUserAccess, type CurrentUserWorkspace } from '../../hooks/useCurrentUserAccess';
import { getAvailableWorkspaces as getFallbackWorkspaces, type WorkspaceAccessDefinition } from '@shared/workspaceAccess';

const UNREAD_COUNT_POLL_MS = 2 * 60_000;

interface HeaderProps {
  userName?: string;
  userEmail?: string;
  userRole?: string;
  userPermissions?: string[];
  actualUserRole?: string;
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

interface WorkspaceOption {
  key: string;
  label: string;
  description: string;
  path: string;
  icon: React.ReactNode;
}

type WorkspaceOptionSource = Pick<CurrentUserWorkspace, 'id' | 'label' | 'description' | 'path' | 'level'>;

function getWorkspaceIcon(workspace: Pick<WorkspaceOptionSource, 'id' | 'path' | 'level'>): React.ReactNode {
  if (workspace.id === 'reception-dashboard') return <Receipt className="w-4 h-4" />;
  if (workspace.id === 'manager-dashboard') return <BarChart3 className="w-4 h-4" />;
  if (workspace.id === 'pharmacy-dashboard') return <Pill className="w-4 h-4" />;
  if (workspace.id === 'lab-dashboard') return <FlaskConical className="w-4 h-4" />;
  if (workspace.id === 'doctor-dashboard') return <User className="w-4 h-4" />;
  if (workspace.id === 'nursing-dashboard') return <BedDouble className="w-4 h-4" />;
  if (workspace.id === 'accounting-dashboard') return <FileText className="w-4 h-4" />;
  if (workspace.id === 'md-dashboard' || workspace.id === 'reports-dashboard') return <BarChart3 className="w-4 h-4" />;
  if (workspace.id === 'director-dashboard') return <Shield className="w-4 h-4" />;
  if (workspace.id === 'access-control') return <ShieldCheck className="w-4 h-4" />;
  if (workspace.id.includes('inventory') || workspace.id === 'reagent-control' || workspace.path.startsWith('inventory')) {
    return <FileText className="w-4 h-4" />;
  }
  return workspace.level === 'admin' ? <ShieldCheck className="w-4 h-4" /> : <BarChart3 className="w-4 h-4" />;
}

function toWorkspaceOption(workspace: WorkspaceOptionSource): WorkspaceOption {
  return {
    key: workspace.id,
    label: workspace.label,
    description: workspace.description,
    path: workspace.path,
    icon: getWorkspaceIcon(workspace),
  };
}

function getFallbackWorkspaceOptions(role: string, permissions: string[]): WorkspaceOption[] {
  return getFallbackWorkspaces(permissions, role).map(toWorkspaceOption);
}

function normalizeWorkspacePath(path: string): string {
  return String(path ?? '').replace(/^\/+|\/+$/g, '');
}

function getRelativeWorkspacePath(pathname: string, slug?: string): string {
  const normalized = normalizeWorkspacePath(pathname);
  if (slug) {
    const tenantPrefix = `h/${slug}`;
    if (normalized === tenantPrefix) return '';
    if (normalized.startsWith(`${tenantPrefix}/`)) return normalized.slice(tenantPrefix.length + 1);
  }

  const parts = normalized.split('/');
  if (parts[0] === 'h' && parts.length > 1) return parts.slice(2).join('/');
  return normalized;
}

function isWorkspacePathActive(currentPath: string, workspacePath: string): boolean {
  const current = normalizeWorkspacePath(currentPath);
  const workspace = normalizeWorkspacePath(workspacePath);
  if (!workspace) return current === '';
  return current === workspace || current.startsWith(`${workspace}/`);
}

function getActiveWorkspaceKey(options: WorkspaceOption[], currentPath: string): string | null {
  let active: WorkspaceOption | null = null;
  for (const option of options) {
    if (!isWorkspacePathActive(currentPath, option.path)) continue;
    if (!active || normalizeWorkspacePath(option.path).length > normalizeWorkspacePath(active.path).length) {
      active = option;
    }
  }
  if (active) return active.key;

  const currentSegment = normalizeWorkspacePath(currentPath).split('/')[0];
  if (!currentSegment) return null;
  return options.find((option) => normalizeWorkspacePath(option.path).split('/')[0] === currentSegment)?.key ?? null;
}


function parseNotificationTimestamp(dateStr: string): Date | null {
  const raw = String(dateStr ?? '').trim();
  if (!raw) return null;

  const normalized = raw.replace(' ', 'T');
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const parsed = new Date(hasTimezone ? normalized : `${normalized}+06:00`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function timeAgo(dateStr: string): string {
  const parsed = parseNotificationTimestamp(dateStr);
  if (!parsed) return '—';

  const diff = Math.max(0, Date.now() - parsed.getTime());
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
  userPermissions = [],
  actualUserRole = userRole,
  onLogout,
}: HeaderProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const { t, i18n } = useTranslation('common');
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const workspacePermissionsKey = userPermissions.join('\u001f');
  const fallbackWorkspaceOptions = useMemo(
    () => getFallbackWorkspaceOptions(actualUserRole, userPermissions),
    [actualUserRole, workspacePermissionsKey],
  );
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);
  const { data: currentUserAccess } = useCurrentUserAccess(true);
  const [hospitalName, setHospitalName] = useState(() => getTenant()?.name ?? 'Ozzyl Health');
  const notifRef = useRef<HTMLDivElement>(null);
  const quickActionRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const currentWorkspacePath = getRelativeWorkspacePath(location.pathname, slug);
  const activeWorkspaceKey = getActiveWorkspaceKey(workspaceOptions, currentWorkspacePath);

  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language === 'en' ? 'bn' : 'en');
  };

  const lang = i18n.language;
  const today = new Date().toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-BD', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  useEffect(() => {
    const apiWorkspaceOptions = (currentUserAccess?.workspaces ?? []).map(toWorkspaceOption);
    setWorkspaceOptions(apiWorkspaceOptions.length > 0 ? apiWorkspaceOptions : fallbackWorkspaceOptions);
  }, [currentUserAccess?.workspaces, fallbackWorkspaceOptions]);

  // ─── Fetch unread count without creating constant background traffic ───
  const fetchUnreadCount = useCallback(async () => {
    if (document.visibilityState !== 'visible') return;

    try {
      const data = await apiFetch<{ count?: number }>('/api/inbox/unread-count');
      setUnreadCount(data.count ?? 0);
    } catch {
      // Silently fail — badge will show 0
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, UNREAD_COUNT_POLL_MS);
    document.addEventListener('visibilitychange', fetchUnreadCount);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', fetchUnreadCount);
    };
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (hospitalName !== 'Ozzyl Health') return;
    apiFetch<{ hospital_info?: { name?: string } }>('/api/settings')
      .then((data) => {
        const name = data.hospital_info?.name?.trim();
        if (name) {
          setHospitalName(name);
          const current = getTenant() ?? {};
          localStorage.setItem('tenant', JSON.stringify({ ...current, name }));
        }
      })
      .catch(() => {
        // Keep product fallback if tenant metadata is unavailable.
      });
  }, [hospitalName]);

  // ─── Fetch notifications list ───────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    setLoadingNotifs(true);
    try {
      const data = await apiFetch<{ notifications?: Notification[] }>('/api/inbox?limit=15');
      setNotifications(data.notifications ?? []);
    } catch {
      setNotifications([]);
    } finally {
      setLoadingNotifs(false);
    }
  }, []);

  const closeTransientMenus = () => {
    setShowQuickActions(false);
    setShowMoreMenu(false);
    setShowWorkspaceMenu(false);
  };

  // ─── Toggle notification panel ──────────────────────────────────────────
  const toggleNotifs = () => {
    const next = !showNotifs;
    setShowNotifs(next);
    setShowDropdown(false);
    closeTransientMenus();
    if (next) fetchNotifications();
  };

  const goToAction = (href: string) => {
    setShowQuickActions(false);
    setShowWorkspaceMenu(false);
    navigate(`/h/${slug ?? ''}/${href}`);
  };

  const goToWorkspace = (href: string) => {
    closeTransientMenus();
    setShowDropdown(false);
    setShowNotifs(false);
    navigate(`/h/${slug ?? ''}/${href}`);
  };

  // ─── Mark single as read ────────────────────────────────────────────────
  const markRead = async (id: number) => {
    try {
      await apiFetch(`/api/inbox/${id}/read`, { method: 'PATCH', body: {} });
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  // ─── Mark all as read ───────────────────────────────────────────────────
  const markAllRead = async () => {
    try {
      await apiFetch('/api/inbox/read-all', { method: 'PATCH', body: {} });
      setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  };

  // ─── Delete notification ────────────────────────────────────────────────
  const deleteNotif = async (id: number) => {
    try {
      await apiFetch(`/api/inbox/${id}`, { method: 'DELETE' });
      const removed = notifications.find(n => n.id === id);
      setNotifications(prev => prev.filter(n => n.id !== id));
      if (removed && !removed.is_read) setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  // ─── Click outside to close floating menus ──────────────────────────────
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notifRef.current && !notifRef.current.contains(target)) {
        setShowNotifs(false);
      }
      if (quickActionRef.current && !quickActionRef.current.contains(target)) {
        setShowQuickActions(false);
      }
      if (workspaceMenuRef.current && !workspaceMenuRef.current.contains(target)) {
        setShowWorkspaceMenu(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setShowMoreMenu(false);
      }
    };
    if (showNotifs || showQuickActions || showMoreMenu || showWorkspaceMenu) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showNotifs, showQuickActions, showMoreMenu, showWorkspaceMenu]);

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowNotifs(false);
        setShowDropdown(false);
        closeTransientMenus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Derive avatar initials from userName
  const avatarInitial = String(userName || 'U').trim()[0]?.toUpperCase() ?? 'U';

  return (
    <header className="h-16 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-[var(--color-border)]/80 flex items-center justify-between px-4 sm:px-6 shrink-0 sticky top-0 z-20">

      {/* Left: Hospital Name + Today */}
      <div className="flex min-w-0 items-center gap-3">
        {/* Mobile spacer for hamburger */}
        <div className="w-10 lg:hidden" />
        <span className="font-semibold text-[var(--color-primary-dark)] text-[15px] hidden sm:block truncate">
          {hospitalName}
        </span>
        <span className="hidden md:block text-xs text-[var(--color-text-muted)] border-l border-[var(--color-border)] pl-3 whitespace-nowrap">
          {today}
        </span>
      </div>

      {/* Right: Actions */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">

        {/* Global Search */}
        <GlobalSearch />

        {workspaceOptions.length > 1 && (
          <div className="relative" ref={workspaceMenuRef}>
            <button
              onClick={() => {
                setShowWorkspaceMenu((value) => !value);
                setShowQuickActions(false);
                setShowMoreMenu(false);
                setShowNotifs(false);
                setShowDropdown(false);
              }}
              className="hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)] text-sm font-medium text-[var(--color-text-secondary)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              title="Switch workspace"
              aria-label="Switch workspace"
              aria-expanded={showWorkspaceMenu}
              aria-controls="workspace-switcher-menu"
            >
              <ArrowRightLeft className="w-4 h-4" />
              <span className="hidden lg:inline">Switch</span>
            </button>
            {showWorkspaceMenu && (
              <div id="workspace-switcher-menu" className="absolute right-0 top-full mt-2 w-72 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-xl shadow-modal z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--color-border)]">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">Switch workspace</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Open the interface for another access area.</p>
                </div>
                <div className="p-1.5 max-h-[360px] overflow-y-auto">
                  {workspaceOptions.map((item) => {
                    const isCurrent = activeWorkspaceKey === item.key;
                    return (
                      <button
                        key={item.key}
                        onClick={() => goToWorkspace(item.path)}
                        aria-current={isCurrent ? 'page' : undefined}
                        className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset ${isCurrent ? 'bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]' : 'text-[var(--color-text)] hover:bg-[var(--color-border-light)]'}`}
                      >
                        <span className="mt-0.5 text-[var(--color-primary)]">{item.icon}</span>
                        <span className="min-w-0">
                          <span className="block font-medium">{item.label}</span>
                          <span className="block text-xs text-[var(--color-text-muted)]">{item.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick Action Button */}
        <div className="relative" ref={quickActionRef}>
          <button
            onClick={() => {
              setShowQuickActions((value) => !value);
              setShowMoreMenu(false);
              setShowNotifs(false);
              setShowDropdown(false);
            }}
            className="p-2 rounded-lg bg-[var(--color-primary)] text-white hover:opacity-90 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
            title="Quick Actions"
            aria-label="Quick Actions"
            aria-expanded={showQuickActions}
            aria-controls="quick-action-menu"
          >
            <Plus className="w-4 h-4" />
          </button>
          {showQuickActions && (
            <div
              id="quick-action-menu"
              className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-xl shadow-modal z-50 overflow-hidden"
            >
              <div className="p-1.5">
                {[
                  { icon: <ShieldCheck className="w-4 h-4" />, label: 'Open Approval Center', href: 'approvals' },
                  { icon: <Search className="w-4 h-4" />, label: 'Search Invoice', href: 'billing' },
                  { icon: <ArrowRightLeft className="w-4 h-4" />, label: 'View Live Counters', href: 'cash/drawers' },
                  { icon: <BarChart3 className="w-4 h-4" />, label: 'Export Daily Report', href: 'cash/collections' },
                  { icon: <FileText className="w-4 h-4" />, label: 'View Audit Log', href: 'system-audit' },
                ].map((action, i) => (
                  <button
                    key={i}
                    onClick={() => goToAction(action.href)}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-sm text-[var(--color-text)] hover:bg-[var(--color-border-light)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset"
                  >
                    {action.icon}
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* More menu: lower priority utilities */}
        <div className="relative" ref={moreMenuRef}>
          <button
            onClick={() => {
              setShowMoreMenu((value) => !value);
              setShowQuickActions(false);
              setShowNotifs(false);
              setShowDropdown(false);
            }}
            title="More actions"
            aria-label="More actions"
            aria-expanded={showMoreMenu}
            aria-controls="header-more-menu"
            className="p-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <MoreHorizontal className="w-5 h-5 text-[var(--color-text-secondary)]" />
          </button>
          {showMoreMenu && (
            <div
              id="header-more-menu"
              className="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-slate-800 border border-[var(--color-border)] rounded-xl shadow-modal z-50 overflow-hidden"
            >
              <div className="p-2 space-y-1">
                <button
                  onClick={() => {
                    toggleLanguage();
                    setShowMoreMenu(false);
                  }}
                  title={lang === 'en' ? 'Switch to Bangla' : 'Switch to English'}
                  aria-label={lang === 'en' ? 'Switch to Bangla' : 'Switch to English'}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border-light)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                >
                  <span className="flex items-center gap-2">
                    <Globe className="w-4 h-4" aria-hidden="true" />
                    Language
                  </span>
                  <span className="text-xs font-semibold text-[var(--color-text-muted)]">{lang === 'en' ? 'বাং' : 'EN'}</span>
                </button>

                <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border-light)] transition-colors">
                  <span>Help</span>
                  <PageHelpButton />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-border-light)] transition-colors">
                  <span>WhatsApp</span>
                  <WhatsAppButton />
                </div>
              </div>
            </div>
          )}
        </div>

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
                  <button onClick={markAllRead} aria-label="Mark all notifications as read" className="text-xs text-[var(--color-primary)] hover:underline font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded">
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
                            className="p-1 rounded hover:bg-[var(--color-border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                            title="Mark as read"
                            aria-label="Mark as read"
                          >
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteNotif(notif.id); }}
                          className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
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
            onClick={() => { setShowDropdown(v => !v); setShowNotifs(false); closeTransientMenus(); }}
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
                    onClick={() => { setShowDropdown(false); navigate(`/h/${slug ?? ''}/profile`); }}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-[var(--color-text)] hover:bg-[var(--color-border-light)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset"
                  >
                    <User className="w-4 h-4" />
                    {t('myProfile', { defaultValue: 'My Profile' })}
                  </button>
                  <button
                    onClick={() => { setShowDropdown(false); onLogout(); }}
                    className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset"
                  >
                    <LogOut className="w-4 h-4" />
                    {t('signOut')}
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
