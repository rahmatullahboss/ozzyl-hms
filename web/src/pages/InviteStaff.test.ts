import { createElement as h } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, optsOrDefault?: unknown) => {
      if (typeof optsOrDefault === 'string') return optsOrDefault;
      const opts = optsOrDefault as { defaultValue?: string } | undefined;
      return opts?.defaultValue ?? k;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('../lib/apiClient', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  getToken: vi.fn(() => null),
  getWorkstationId: vi.fn(() => 'hms-ws-test'),
  ApiClientError: class extends Error {
    status: number;
    payload: unknown;
    constructor(message: string, status: number, payload?: unknown) {
      super(message);
      this.status = status;
      this.payload = payload;
      this.name = 'ApiClientError';
    }
  },
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('../hooks/useCurrentUserAccess', () => ({
  useCurrentUserAccess: vi.fn(),
}));

import InviteStaff from './InviteStaff';
import { api } from '../lib/apiClient';
import { useApiQuery } from '../hooks/useApiQuery';
import { useCurrentUserAccess } from '../hooks/useCurrentUserAccess';

const mockedApi = api as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};
const mockedUseApiQuery = useApiQuery as ReturnType<typeof vi.fn>;
const mockedUseCurrentUserAccess = useCurrentUserAccess as ReturnType<typeof vi.fn>;

describe('InviteStaff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseCurrentUserAccess.mockReturnValue({
      data: { effective_permissions: ['*'], workspaces: [] },
      isLoading: false,
      isError: false,
    });
  });

  it('exports a valid React component', async () => {
    const mod = await import('./InviteStaff');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('includes CEO, administration, and manager options in the invite role dropdown', async () => {
    mockedApi.get.mockResolvedValueOnce({ invitations: [] });
    mockedUseApiQuery.mockReturnValue({ data: { doctors: [] }, isLoading: false } as any);

    render(h(MemoryRouter, null, h(InviteStaff)));

    fireEvent.click(screen.getByText(/\+ Invite Staff Member/));

    const roleSelect = await screen.findByLabelText(/^role$/i);
    expect(roleSelect).toHaveTextContent('CEO / Managing Director');
    expect(screen.getByRole('option', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Director' })).not.toBeInTheDocument();
    expect(roleSelect).toHaveTextContent('Manager');
  });

  it('shows doctor profile picker when role=doctor is selected', async () => {
    mockedApi.get.mockResolvedValueOnce({ invitations: [] });
    mockedUseApiQuery.mockReturnValue({
      data: {
        doctors: [
          { id: 1, name: 'Dr. Alice', specialty: 'Cardiology', email: 'alice@h.com' },
          { id: 2, name: 'Dr. Bob', specialty: 'Neurology', email: 'bob@h.com' },
        ],
      },
      isLoading: false,
    } as any);

    render(h(MemoryRouter, null, h(InviteStaff)));

    const inviteButton = screen.getByText(/\+ Invite Staff Member/);
    fireEvent.click(inviteButton);

    const roleSelect = await screen.findByLabelText(/^role$/i);
    fireEvent.change(roleSelect, { target: { value: 'doctor' } });

    await waitFor(() =>
      expect(screen.getByLabelText(/select doctor profile/i)).toBeInTheDocument()
    );

    expect(screen.getByRole('option', { name: /Dr\. Alice/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Dr\. Bob/ })).toBeInTheDocument();
  });

  it('resends a pending invitation and shows the newly generated share link', async () => {
    mockedApi.get.mockResolvedValue({
      invitations: [{
        id: 9,
        email: 'pending@example.com',
        role: 'nurse',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        accepted_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
        invited_by_name: 'Hospital Admin',
        status: 'pending',
      }],
    });
    mockedApi.post.mockResolvedValueOnce({
      inviteLink: '/h/demo/accept-invite?token=[REDACTED_SECRET]',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    mockedUseApiQuery.mockReturnValue({ data: { doctors: [] }, isLoading: false } as any);

    render(h(MemoryRouter, { initialEntries: ['/h/demo/invitations'] }, h(InviteStaff)));

    fireEvent.click(await screen.findByRole('button', { name: /resend/i }));

    await waitFor(() => expect(mockedApi.post).toHaveBeenCalledWith('/api/invitations/9/resend', undefined));
    expect(await screen.findByText(/Invitation created! Share this link/i)).toBeInTheDocument();
    expect(screen.getByText(/recipient must open this link and create their own password/i)).toBeInTheDocument();
    expect(screen.getByText(/do not open or complete the invitation yourself/i)).toBeInTheDocument();
  });

  it('revokes a pending invitation and refreshes the invitation list', async () => {
    mockedApi.get.mockResolvedValue({
      invitations: [{
        id: 12,
        email: 'revoke@example.com',
        role: 'reception',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        accepted_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
        invited_by_name: 'Hospital Admin',
        status: 'pending',
      }],
    });
    mockedApi.delete.mockResolvedValueOnce({ message: 'Invitation revoked' });
    mockedUseApiQuery.mockReturnValue({ data: { doctors: [] }, isLoading: false } as any);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(h(MemoryRouter, { initialEntries: ['/h/demo/invitations'] }, h(InviteStaff)));

    fireEvent.click(await screen.findByRole('button', { name: /revoke/i }));

    await waitFor(() => expect(mockedApi.delete).toHaveBeenCalledWith('/api/invitations/12'));
    expect(mockedApi.get.mock.calls.length).toBeGreaterThan(1);
  });

  it('hides privileged role options when the inviter lacks roles:manage', async () => {
    mockedApi.get.mockResolvedValueOnce({ invitations: [] });
    mockedUseApiQuery.mockReturnValue({ data: { doctors: [] }, isLoading: false } as any);
    mockedUseCurrentUserAccess.mockReturnValue({
      data: { effective_permissions: ['staff:write'], workspaces: [] },
      isLoading: false,
      isError: false,
    });

    render(h(MemoryRouter, null, h(InviteStaff)));
    fireEvent.click(screen.getByText(/\+ Invite Staff Member/));

    const roleSelect = await screen.findByLabelText(/^role$/i);
    expect(roleSelect).not.toHaveTextContent('CEO / Managing Director');
    expect(roleSelect).not.toHaveTextContent('Manager');
    expect(roleSelect).not.toHaveTextContent('Director');
    expect(roleSelect).not.toHaveTextContent('Accountant');
    expect(roleSelect).toHaveTextContent('Nurse');
  });
});
