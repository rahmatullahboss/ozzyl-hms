import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  LayoutDashboard,
  Building2,
  Users,
  UserCog,
  FileText,
  ClipboardList,
  Activity,
  Settings,
  LogOut,
  Menu,
  X,
  HeartPulse,
  BarChart3,
} from 'lucide-react';
import { useState } from 'react';
import { isNavItemActive } from './nav-helpers';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['super_admin'] },
  { path: '/hospitals', label: 'Hospitals', icon: Building2, roles: ['super_admin'] },
  { path: '/users', label: 'Users', icon: Users, roles: ['super_admin'] },
  { path: '/platform-staff', label: 'Platform Staff', icon: UserCog, roles: ['super_admin', 'platform_admin', 'platform_setup', 'platform_support'] },
  { path: '/onboarding', label: 'Onboarding', icon: ClipboardList, roles: ['super_admin'] },
  { path: '/audit-logs', label: 'Audit Logs', icon: FileText, roles: ['super_admin', 'platform_admin', 'platform_auditor'] },
  { path: '/analytics', label: 'Analytics', icon: BarChart3, roles: ['super_admin'] },
  { path: '/system-health', label: 'System Health', icon: Activity, roles: ['super_admin', 'platform_admin'] },
  { path: '/remote-control', label: 'Remote Control', icon: Settings, roles: ['super_admin'] },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const visibleNavItems = navItems.filter((item) => !user?.role || item.roles.includes(user.role));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-sidebar-bg text-white transform transition-transform duration-200 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center justify-between h-16 px-6 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <HeartPulse className="w-6 h-6 text-primary-400" />
            <span className="text-lg font-bold">Super Admin</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto" aria-label="Primary">
          {visibleNavItems.map((item) => {
            const isActive = isNavItemActive(item.path, location.pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'text-sidebar-text hover:bg-slate-800 hover:text-sidebar-active'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="font-medium">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-3 px-4 py-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-sm font-bold">
              {user?.name?.charAt(0).toUpperCase() || 'A'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-sidebar-text truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-2 text-sidebar-text hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="font-medium">Logout</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 rounded-lg hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5 text-slate-600" />
          </button>
          <h1 className="text-xl font-semibold text-slate-800 hidden lg:block">
            {visibleNavItems.find((item) => item.path === location.pathname)?.label || 'Dashboard'}
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
