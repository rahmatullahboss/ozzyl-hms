import { createElement as h } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

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

import AcceptInvite from './AcceptInvite';
import { api } from '../lib/apiClient';

const mockedApi = api as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function renderAt(path: string) {
  return render(
    h(
      MemoryRouter,
      { initialEntries: [path] },
      h(
        Routes,
        null,
        h(Route, { path: 'h/:slug/accept-invite', element: h(AcceptInvite) })
      )
    )
  );
}

describe('AcceptInvite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exports a valid React component', async () => {
    const mod = await import('./AcceptInvite');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('shows doctor name when invitation links to a doctor', async () => {
    mockedApi.get.mockResolvedValueOnce({
      valid: true,
      email: 'drsmith@hospital.com',
      role: 'doctor',
      doctorId: 42,
      doctorName: 'Smith',
      hospitalName: 'Test Hospital',
      slug: 'test',
    });

    renderAt('/h/test/accept-invite?token=abc');

    await waitFor(() =>
      expect(screen.getByText(/Dr\.\s*Smith/i)).toBeInTheDocument()
    );
    expect(mockedApi.get).toHaveBeenCalledWith(
      '/api/invite/abc',
      expect.objectContaining({ 'X-Tenant-Subdomain': 'test' })
    );
  });

  it('falls back to role label when no doctor name', async () => {
    mockedApi.get.mockResolvedValueOnce({
      valid: true,
      email: 'receptionist@hospital.com',
      role: 'reception',
      hospitalName: 'Test Hospital',
      slug: 'test',
    });

    renderAt('/h/test/accept-invite?token=abc');

    await waitFor(() =>
      expect(
        screen.getByText((_, el) => el?.tagName === 'STRONG' && /Reception/.test(el.textContent ?? ''))
      ).toBeInTheDocument()
    );
  });

  it('lets a doctor enter email when invitation link was generated without email', async () => {
    mockedApi.get.mockResolvedValueOnce({
      valid: true,
      email: null,
      role: 'doctor',
      doctorId: 42,
      doctorName: 'Smith',
      hospitalName: 'Test Hospital',
      slug: 'test',
    });
    mockedApi.post.mockResolvedValueOnce({
      token: 'jwt-token',
      user: { role: 'doctor' },
    });

    renderAt('/h/test/accept-invite?token=abc');

    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());

    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    expect(email.disabled).toBe(false);

    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: 'Dr Smith' } });
    fireEvent.change(email, { target: { value: 'smith@example.com' } });
    fireEvent.change(screen.getByLabelText(/^create password$/i), { target: { value: 'Password1' } });
    fireEvent.change(screen.getByLabelText(/^confirm password$/i), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: /accept & create account/i }));

    await waitFor(() =>
      expect(mockedApi.post).toHaveBeenCalledWith('/api/invite/abc/accept', {
        name: 'Dr Smith',
        email: 'smith@example.com',
        password: 'Password1',
      })
    );
  });
});
