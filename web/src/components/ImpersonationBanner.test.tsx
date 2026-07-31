import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import ImpersonationBanner from './ImpersonationBanner';
import { logout, saveToken } from '../hooks/useAuth';

function makeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function renderBanner() {
  return render(
    <MemoryRouter>
      <ImpersonationBanner />
    </MemoryRouter>,
  );
}

afterEach(() => {
  logout();
  cleanup();
});

describe('ImpersonationBanner', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./ImpersonationBanner');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('does not render when no impersonation token is active', () => {
    renderBanner();

    expect(screen.queryByText(/impersonation active/i)).not.toBeInTheDocument();
  });

  it('does not render for a normal hospital admin token', () => {
    saveToken(makeJwt({
      userId: '1',
      role: 'hospital_admin',
      tenantId: '1',
      permissions: ['*'],
    }));

    renderBanner();

    expect(screen.queryByText(/impersonation active/i)).not.toBeInTheDocument();
  });

  it('renders when the current token is an impersonation token', () => {
    saveToken(makeJwt({
      userId: '99',
      role: 'hospital_admin',
      tenantId: '1',
      permissions: ['*'],
      isImpersonation: true,
    }));

    renderBanner();

    expect(screen.getByText(/impersonation active/i)).toBeInTheDocument();
  });
});
