import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Navigate, Outlet } from 'react-router';
import App from './App';
import { useAuth } from './hooks/useAuth';

vi.mock('./hooks/useAuth', () => ({
  useAuth: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('./hooks/useAnalytics', () => ({ useAnalytics: vi.fn() }));
vi.mock('./components/PWAUpdatePrompt', () => ({ PWAUpdatePrompt: () => null }));
vi.mock('./components/AppIconSync', () => ({ AppIconSync: () => null }));
vi.mock('./components/ImpersonationBanner', () => ({ default: () => null }));
vi.mock('./components/ProtectedRoute', () => ({
  ProtectedRoute: ({ allowedRoles }: { allowedRoles?: string[] }) => {
    const { user } = useAuth();
    if (allowedRoles && user && !allowedRoles.includes(user.role)) {
      return <Navigate to="/unauthorized" replace />;
    }
    return <Outlet />;
  },
}));
vi.mock('./pages/PatientTimeline', () => ({ default: () => <div data-testid="patient-timeline-page" /> }));
vi.mock('./pages/PatientChartWorkspace', () => ({ default: () => <div data-testid="patient-chart-page" /> }));
vi.mock('./pages/NurseStation', () => ({ default: () => <div data-testid="nurse-station-page" /> }));
vi.mock('./pages/PatientForm', () => ({ default: () => <div data-testid="patient-form-page" /> }));
vi.mock('./pages/Login', () => ({ default: () => <div data-testid="login-page" /> }));
vi.mock('./pages/AdminLogin', () => ({ default: () => <div data-testid="admin-login-page" /> }));
vi.mock('./pages/HospitalSignup', () => ({ default: () => <div data-testid="signup-page" /> }));
vi.mock('./pages/AcceptInvite', () => ({ default: () => <div data-testid="accept-invite-page" /> }));
vi.mock('./pages/QueueDisplay', () => ({ default: () => <div data-testid="queue-display-page" /> }));
vi.mock('./components/LoadingFallback', () => ({ default: () => <div data-testid="loading-fallback" /> }));
vi.mock('./components/DashboardLayout', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('./lib/hostRouting', () => ({
  getTenantSlugFromHost: () => 'demo',
  isAdminHost: () => false,
  isPatientAppHost: () => false,
  isStaffAuthHost: () => false,
}));
vi.mock('./lib/pwaLaunch', () => ({ getStoredPwaLaunchPath: () => '/h/demo/dashboard' }));
vi.mock('./lib/patientPortalHandoff', () => ({
  buildPatientPortalHandoffTarget: () => '/patient/login',
  shouldUnregisterServiceWorkerScope: () => false,
}));
vi.mock('react-hot-toast', () => ({ Toaster: () => null }));

function setupAuth(role: string) {
  (useAuth as any).mockReturnValue({
    isAuthenticated: true,
    user: { userId: 'test-1', role, permissions: [] },
    token: 'test-token',
  });
}

afterEach(() => cleanup());

describe('nurse navigation routes', () => {
  beforeEach(() => setupAuth('nurse'));

  it.each([
    ['/h/demo/patients/7/timeline', 'patient-timeline-page'],
    ['/h/demo/patients/7/chart', 'patient-chart-page'],
    ['/h/demo/nurse-station', 'nurse-station-page'],
  ])('permits nurse access to %s', async (path, pageTestId) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId(pageTestId)).toBeInTheDocument();
  });

  it('permits nurse access to patient creation', async () => {
    render(
      <MemoryRouter initialEntries={['/h/demo/patients/new']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('patient-form-page')).toBeInTheDocument();
  });
});
