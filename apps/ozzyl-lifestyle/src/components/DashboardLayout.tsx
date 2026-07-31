import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import { useAuth, logout } from '../hooks/useAuth';
import Sidebar from './dashboard/Sidebar';
import Header from './dashboard/Header';
import SyncStatusBar from './SyncStatusBar';
import MobileBottomNav from './dashboard/MobileBottomNav';

interface DashboardLayoutProps {
  children: ReactNode;
  role: string;
}

/**
 * DashboardLayout — shell for every authenticated dashboard page.
 *
 * Auth is already enforced by ProtectedRoute (wrapper route element).
 * This layout reads user info from the JWT via useAuth() — no separate
 * localStorage check needed, no redundant redirect.
 */
export default function DashboardLayout({ children, role }: DashboardLayoutProps) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    toast.success(t('auth.signedOut'));
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg-primary)]">
      <div className="flex h-screen overflow-hidden">
        <Sidebar role={role} permissions={user?.permissions ?? []} onLogout={handleLogout} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header
            userName={user?.userId ?? 'User'}
            userEmail=""
            userRole={user?.role ?? role}
            onLogout={handleLogout}
          />
          {/* pb-16 on mobile to avoid content hiding behind bottom nav */}
          <main className="flex-1 overflow-y-auto p-3 sm:p-6 pb-20 sm:pb-6">
            {/* Offline / sync indicator — only visible when there's something to report */}
            <div className="mb-4">
              <SyncStatusBar />
            </div>
            {children}
          </main>
        </div>
      </div>
      {/* Mobile bottom navigation — hidden on sm+ */}
      <MobileBottomNav role={role} />
    </div>
  );
}
