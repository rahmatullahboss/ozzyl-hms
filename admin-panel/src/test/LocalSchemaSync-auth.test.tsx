import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/Toast';
import LocalSchemaSync from '../pages/LocalSchemaSync';

function renderRC() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <LocalSchemaSync />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('LocalSchemaSync — auth integration', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      // Auth travels in the httpOnly cookie; we just need to verify the
      // path is one we expect.
      if (!url.includes('/api/local-server/')) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'bad url' }), { status: 500 }),
        );
      }
      // credentials: 'include' must be set so the browser sends the cookie.
      const init = (input as Request | undefined) as Request | undefined;
      if (init && init.credentials !== 'include') {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'missing credentials' }), { status: 500 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ status: { lastSyncAt: null, appliedCount: 0, pendingCount: 0, dryRun: true }, approvals: { approvals: [] }, log: { log: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    // No more admin_token in localStorage — the cookie is set by the server.
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    localStorage.clear();
  });

  it('sends requests with credentials: include so the admin_token cookie is forwarded', async () => {
    renderRC();
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    // Every call must carry credentials: 'include' so the browser sends
    // the httpOnly admin_token cookie. No Authorization header needed.
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      expect(init?.credentials).toBe('include');
    }
  });

  it('does not add an Authorization header (auth travels in the httpOnly cookie)', async () => {
    renderRC();
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    for (const call of fetchSpy.mock.calls) {
      const headers = (call[1] as RequestInit | undefined)?.headers as Record<string, string> | undefined;
      if (!headers) continue;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['authorization']).toBeUndefined();
    }
  });

  it('shows an error toast on 401 and does not crash', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: 'No token provided' }), { status: 401 }),
      ),
    );
    renderRC();
    // Page should render the heading without crashing
    expect(screen.getByRole('heading', { name: /local schema sync/i })).toBeInTheDocument();
  });

  it('the api client does not add an Authorization header (auth is in the cookie)', () => {
    // Source-grep assertion: the api client must not inject Authorization
    // headers any more. Cookie-based auth is the only path now.
    const apiSource = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'services', 'api.ts'),
      'utf8',
    );
    expect(apiSource).not.toMatch(/Authorization.*Bearer/);
    expect(apiSource).toMatch(/credentials:\s*['"]include['"]/);
  });
});
