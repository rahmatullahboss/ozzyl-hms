import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { LogOut } from 'lucide-react';
import { useAuth, logout } from '../hooks/useAuth';
import { useCurrentUserAccess } from '../hooks/useCurrentUserAccess';
import { api, ApiClientError } from '../lib/apiClient';
import { clearAdminSession, isAdminAuthenticated } from '../lib/adminSessionStore';
import { useAdminSession } from '../hooks/useAdminSession';
import { useHandoverGuard } from '../hooks/useHandoverGuard';
import Sidebar from './dashboard/Sidebar';
import Header from './dashboard/Header';
import SyncStatusBar from './SyncStatusBar';
import OfflineIndicator from './nursing/OfflineIndicator';
import MobileBottomNav from './dashboard/MobileBottomNav';
import CommandPalette from './dashboard/CommandPalette';
import Breadcrumbs from './dashboard/Breadcrumbs';
import ShiftHandoverModal from './nursing/ShiftHandoverModal';


function workspaceRoleFromPath(pathname: string, fallbackRole: string): string {
  if (/^\/h\/[^/]+\/reception(?:\/|$)/.test(pathname)) return 'reception';
  if (/^\/h\/[^/]+\/md(?:\/|$)/.test(pathname)) return 'md';
  if (/^\/h\/[^/]+\/director(?:\/|$)/.test(pathname)) return 'director';
  if (/^\/h\/[^/]+\/accountant(?:\/|$)/.test(pathname)) return 'accountant';
  if (/^\/h\/[^/]+\/lab(?:\/|$)/.test(pathname)) return 'laboratory';
  if (/^\/h\/[^/]+\/pharmacy(?:\/|$)/.test(pathname)) return 'pharmacist';
  if (/^\/h\/[^/]+\/doctor(?:\/|$)/.test(pathname)) return 'doctor';
  if (/^\/h\/[^/]+\/(?:nursing|nurse-station|nurse-tasks|nurse-reports|vitals)(?:\/|$)/.test(pathname)) return 'nurse';
  return fallbackRole;
}

interface DashboardLayoutProps {
  children: ReactNode;
  role: string;
  fullWidth?: boolean;
  showBreadcrumbs?: boolean;
}

/**
 * DashboardLayout — shell for every authenticated dashboard page.
 *
 * Auth is already enforced by ProtectedRoute (wrapper route element).
 * This layout reads user info from the JWT via useAuth() — no separate
 * localStorage check needed, no redundant redirect.
 */
export default function DashboardLayout({ children, role, fullWidth = false, showBreadcrumbs = true }: DashboardLayoutProps) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const { user: adminSessionUser } = useAdminSession();
  const location = useLocation();
  const currentUserAccess = useCurrentUserAccess(Boolean(user && location.pathname.startsWith('/h/')));
  const actualRole = currentUserAccess.data?.user?.role ?? user?.role ?? adminSessionUser?.role ?? role;
  const effectiveRole = workspaceRoleFromPath(location.pathname, actualRole);
  const dashboardPermissions = currentUserAccess.data?.effective_permissions ?? user?.permissions ?? [];
  const isRestrictedViewer = effectiveRole === 'shareholder_viewer';
  const navigate = useNavigate();
  const [showHandoverModal, setShowHandoverModal] = useState(false);

  const isNurse = user?.role === 'nurse';
  const { needsHandover, pendingTasks, markCompleted } = useHandoverGuard(
    isNurse ? { pendingVitals: 0, overdueMeds: 0, criticalPatients: 0 } : { pendingVitals: 0, overdueMeds: 0, criticalPatients: 0 },
  );

  const performLogout = () => {
    // The super-admin logout endpoint clears a different HttpOnly
    // cookie (`admin_token`); staff logout clears `hms_staff_session`.
    // Capture the session type before clearing stores so the final
    // redirect still goes to the correct login page.
    const wasAdminSession = isAdminAuthenticated();
    const logoutPath = wasAdminSession
      ? '/api/admin/logout'
      : '/api/auth/logout';

    void api
      .post<{ message?: string; success?: boolean }>(logoutPath, {})
      .catch((error) => {
        if (!(error instanceof ApiClientError)) {
          // Network or unexpected failure — still complete the client
          // side logout so the user is not stranded in the UI.
          console.warn('Logout request failed:', error);
        }
      })
      .finally(() => {
        logout();
        clearAdminSession();
        toast.success(t('auth.signedOut'));
        navigate(wasAdminSession ? '/admin/login' : '/login');
      });
  };

  const handleLogout = () => {
    if (isNurse && needsHandover) {
      setShowHandoverModal(true);
      return;
    }
    performLogout();
  };

  const handleHandoverComplete = () => {
    markCompleted();
    performLogout();
  };

  return (
    <div className="min-h-screen overflow-x-clip bg-[var(--color-bg-primary)]">
      <div className="flex h-screen overflow-hidden">
        {fullWidth ? null : <Sidebar role={effectiveRole} permissions={dashboardPermissions} onLogout={handleLogout} />}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {isRestrictedViewer ? (
            <header className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-white px-4 dark:bg-slate-900 sm:px-6">
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Shareholder Financial Portal</p>
                <p className="text-xs text-[var(--color-text-muted)]">Read-only access</p>
              </div>
              <button type="button" onClick={handleLogout} className="btn-secondary text-sm">
                <LogOut className="h-4 w-4" /> {t('signOut')}
              </button>
            </header>
          ) : (
            <Header
              userName={user?.userId ?? 'User'}
              userEmail=""
              userRole={effectiveRole}
              userPermissions={dashboardPermissions}
              actualUserRole={actualRole}
              onLogout={handleLogout}
            />
          )}
          {/* pb-16 on mobile to avoid content hiding behind bottom nav */}
          <main className={`flex-1 overflow-x-clip overflow-y-auto pb-20 sm:pb-6 ${showBreadcrumbs ? 'p-3 sm:p-6' : 'px-3 pt-2 sm:px-6 sm:pt-3'}`}>
            {/* Offline / sync indicator — only visible when there's something to report */}
            <div className={`${showBreadcrumbs ? 'mb-4' : 'mb-2'} empty:mb-0 empty:hidden space-y-2`}>
              <SyncStatusBar />
              <OfflineIndicator />
            </div>
            {showBreadcrumbs ? <Breadcrumbs /> : null}
            {children}
          </main>
        </div>
      </div>
      {/* Restricted viewers intentionally have no cross-module navigation. */}
      {!isRestrictedViewer && <CommandPalette role={effectiveRole} permissions={dashboardPermissions} />}
      {!isRestrictedViewer && <MobileBottomNav role={effectiveRole} permissions={dashboardPermissions} />}

      {/* Shift handover guard — shown before logout for nurses with pending tasks */}
      {showHandoverModal && (
        <ShiftHandoverModal
          isOpen={showHandoverModal}
          onClose={() => setShowHandoverModal(false)}
          autoSummary={{
            pendingVitals: pendingTasks,
            overdueMeds: 0,
            criticalPatients: 0,
            notes: [],
          }}
          isForced
          onComplete={handleHandoverComplete}
        />
      )}
    </div>
  );
}
