import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import MfaSetup from './MfaSetup';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../hooks/useApiQuery', () => ({ useApiQuery: vi.fn(), useApiMutation: vi.fn(), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('../components/DashboardLayout', () => ({ default: ({ children, role }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { useApiQuery, useApiMutation } from '../hooks/useApiQuery';
import { apiFetch } from '../lib/apiClient';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('MfaSetup', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders title', () => {
    (useApiQuery as any).mockReturnValue({ data: null, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<MfaSetup />, { wrapper: Wrapper });
    expect(screen.getByText('mfa.title')).toBeInTheDocument();
  });

  it('shows MFA not enabled state', () => {
    (useApiQuery as any).mockReturnValue({ data: { enabled: false, methods: [], backup_codes_remaining: 0 }, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<MfaSetup />, { wrapper: Wrapper });
    expect(screen.getByText('mfa.notEnabled')).toBeInTheDocument();
  });

  it('shows MFA enabled state with methods', () => {
    (useApiQuery as any).mockReturnValue({
      data: { enabled: true, methods: [{ id: 1, mfa_type: 'totp', is_enabled: 1, is_verified: 1 }], backup_codes_remaining: 5 },
      isLoading: false,
    });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<MfaSetup />, { wrapper: Wrapper });
    expect(screen.getByText('mfa.enabled')).toBeInTheDocument();
    expect(screen.getByText('TOTP')).toBeInTheDocument();
  });

  it('shows setup options when not enabled and clicking setup', () => {
    (useApiQuery as any).mockReturnValue({ data: { enabled: false, methods: [], backup_codes_remaining: 0 }, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
    render(<MfaSetup />, { wrapper: Wrapper });
    fireEvent.click(screen.getByText('mfa.setup'));
    expect(screen.getByText('mfa.chooseMethod')).toBeInTheDocument();
    expect(screen.getByText('mfa.totp')).toBeInTheDocument();
    expect(screen.getByText('mfa.sms')).toBeInTheDocument();
  });
});
