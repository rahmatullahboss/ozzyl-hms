import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ToastProvider } from '../components/Toast';
import RemoteControl from '../pages/RemoteControl';

function renderRC() {
  return render(
    <ToastProvider>
      <RemoteControl />
    </ToastProvider>,
  );
}

describe('RemoteControl maintenance toggle', () => {
  it('renders a switch role with aria-checked=false initially', () => {
    renderRC();
    const toggle = screen.getByRole('switch', { name: /maintenance mode/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('opens a confirm dialog when clicked from off state, and flips on confirm', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderRC();
    const toggle = screen.getByRole('switch', { name: /maintenance mode/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    // First click opens the confirm dialog — the switch is still off until
    // the user confirms and the backend call resolves.
    const confirm = await screen.findByRole('button', { name: /^enable$/i });
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
  });

  it('calls the real backend endpoint when maintenance is confirmed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ enabled: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderRC();
    const toggle = screen.getByRole('switch', { name: /maintenance mode/i });
    fireEvent.click(toggle);
    const confirm = await screen.findByRole('button', { name: /^enable$/i });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/admin/remote/maintenance');
    expect(init?.method).toBe('POST');
    const body = JSON.parse((init?.body as string) || '{}');
    expect(body).toEqual({ enabled: true });
  });

  it('shows a caution banner that names which actions are live vs disabled', () => {
    renderRC();
    const banner = screen.getByRole('note');
    // The banner is honest about the new state: maintenance/broadcast/
    // revoke are live; emergency shutdown + force password reset are
    // disabled pending an ops process.
    expect(banner.textContent).toMatch(/caution|maintenance|broadcast|revocation/i);
    expect(banner.textContent).toMatch(/shutdown|password reset/i);
  });
});

describe('RemoteControl broadcast', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends a POST to /api/admin/remote/broadcast with target and message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ sent: 1, target: 'all' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderRC();
    const textarea = screen.getByPlaceholderText(/broadcast message/i);
    fireEvent.change(textarea, { target: { value: 'Scheduled maintenance tonight' } });
    const sendBtn = screen.getByRole('button', { name: /send broadcast/i });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/admin/remote/broadcast');
    const body = JSON.parse((init?.body as string) || '{}');
    expect(body.message).toBe('Scheduled maintenance tonight');
    expect(body.target).toBe('all');
  });

  it('does not call the API when the message is empty', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderRC();
    const sendBtn = screen.getByRole('button', { name: /send broadcast/i });
    fireEvent.click(sendBtn);

    // Wait a tick to be sure no fetch fired
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('RemoteControl revoke-sessions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls /api/admin/remote/revoke-sessions on confirm', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ revoked: 1, scope: 'admins' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    renderRC();
    const revokeBtn = screen.getByRole('button', { name: /^revoke$/i });
    fireEvent.click(revokeBtn);
    // The confirm dialog has a different label. The confirm button there
    // is inside a dialog. We select it via the dialog heading context.
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /^revoke$/i });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/admin/remote/revoke-sessions');
    expect(init?.method).toBe('POST');
  });
});
