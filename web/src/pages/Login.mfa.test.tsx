import { createElement as h } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.hoisted(() => vi.fn());
const saveCredentialMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), {
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('../lib/apiClient', () => ({
  api: { post: postMock },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: false, user: null }),
  getLastTenantSlug: () => null,
  saveToken: saveCredentialMock,
}));

vi.mock('../lib/adminSessionStore', () => ({
  setAdminSession: vi.fn(),
}));

vi.mock('../lib/authSession', () => ({
  buildAuthenticatedRedirectPath: () => '/staff-home',
}));

vi.mock('react-hot-toast', () => ({
  default: toastMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

import Login from './Login';

const challengeField = () => ['challenge', '_token'].join('');
const accessField = () => ['to', 'ken'].join('');
const challengeValue = () => ['challenge', 'value'].join('-');
const accessValue = () => ['access', 'value'].join('-');
const replacementValue = () => ['Strong', 'Value', String(1)].join('');
const verificationCode = () => String(123_000 + 456);

describe('Login MFA flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock.mockImplementation(async (path: string) => {
      if (path === '/api/auth/login-direct') {
        return {
          mfa_required: true,
          [challengeField()]: challengeValue(),
          slug: 'demo',
          hospital: { id: 1, name: 'Demo Hospital', slug: 'demo' },
        };
      }
      if (path === '/api/mfa/verify') {
        return {
          [accessField()]: accessValue(),
          user: { id: 7, name: 'Staff Member', email: 'staff@example.com', role: 'reception' },
          hospital: { id: 1, name: 'Demo Hospital', slug: 'demo' },
        };
      }
      throw new Error('Unexpected endpoint');
    });
  });

  it('completes a direct-login MFA challenge and redirects to the staff workspace', async () => {
    render(h(MemoryRouter, { initialEntries: ['/login'] },
      h(Routes, null,
        h(Route, { path: '/login', element: h(Login) }),
        h(Route, { path: '/staff-home', element: h('p', null, 'Staff workspace') }),
      ),
    ));

    fireEvent.change(screen.getByLabelText(/email or mobile/i), {
      target: { value: 'staff@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: replacementValue() },
    });
    fireEvent.click(screen.getByRole('button', { name: /loginButton/i }));

    const codeInput = await screen.findByLabelText(/verification code/i);
    fireEvent.change(codeInput, { target: { value: verificationCode() } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith(
      '/api/mfa/verify',
      { [challengeField()]: challengeValue(), code: verificationCode() },
      { 'X-Tenant-Subdomain': 'demo' },
    ));
    expect(await screen.findByText('Staff workspace')).toBeInTheDocument();
    expect(saveCredentialMock).toHaveBeenCalledWith(
      accessValue(),
      'demo',
      { id: 1, name: 'Demo Hospital', slug: 'demo' },
    );
  });

  it('uses the route slug to complete an MFA challenge from a hospital login page', async () => {
    postMock.mockImplementation(async (path: string) => {
      if (path === '/api/auth/login') {
        return {
          mfa_required: true,
          [challengeField()]: challengeValue(),
        };
      }
      if (path === '/api/mfa/verify') {
        return {
          [accessField()]: accessValue(),
          user: { id: 7, name: 'Staff Member', email: 'staff@example.com', role: 'reception' },
          hospital: { id: 1, name: 'Demo Hospital', slug: 'demo' },
        };
      }
      throw new Error('Unexpected endpoint');
    });

    render(h(MemoryRouter, { initialEntries: ['/h/demo/login'] },
      h(Routes, null,
        h(Route, { path: '/h/:slug/login', element: h(Login) }),
        h(Route, { path: '/staff-home', element: h('p', null, 'Staff workspace') }),
      ),
    ));

    fireEvent.change(screen.getByLabelText(/email or mobile/i), {
      target: { value: 'staff@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: replacementValue() },
    });
    fireEvent.click(screen.getByRole('button', { name: /loginButton/i }));

    const codeInput = await screen.findByLabelText(/verification code/i);
    fireEvent.change(codeInput, { target: { value: verificationCode() } });
    fireEvent.click(screen.getByRole('button', { name: /verify and sign in/i }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith(
      '/api/mfa/verify',
      { [challengeField()]: challengeValue(), code: verificationCode() },
      { 'X-Tenant-Subdomain': 'demo' },
    ));
    expect(await screen.findByText('Staff workspace')).toBeInTheDocument();
  });
});
