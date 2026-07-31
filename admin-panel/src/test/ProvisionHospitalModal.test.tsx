import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/Toast';
import ProvisionHospitalModal from '../components/ProvisionHospitalModal';

function renderModal(props: React.ComponentProps<typeof ProvisionHospitalModal>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ProvisionHospitalModal {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('ProvisionHospitalModal', () => {
  const noop = vi.fn();
  const request = {
    id: 'req-1',
    hospitalName: 'Sunrise Hospital',
    contactName: 'Aisha Khan',
    contactEmail: 'aisha@sunrise.test',
  };

  it('renders nothing when request is null', () => {
    renderModal({ request: null, onClose: noop, onProvisioned: noop });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('prefills admin name and email from the onboarding request', () => {
    renderModal({ request, onClose: noop, onProvisioned: noop });
    expect(screen.getByLabelText(/admin name/i)).toHaveValue('Aisha Khan');
    expect(screen.getByLabelText(/admin email/i)).toHaveValue('aisha@sunrise.test');
  });

  it('calls onClose when Cancel clicked', () => {
    const onClose = vi.fn();
    renderModal({ request, onClose, onProvisioned: noop });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables submit when slug is too short', () => {
    renderModal({ request, onClose: noop, onProvisioned: noop });
    const submit = screen.getByRole('button', { name: /provision hospital/i });
    expect(submit).toBeDisabled();
  });

  it('lowercases and trims slug, validates min length, and posts to provision API', async () => {
    const onProvisioned = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'Hospital provisioned',
          hospital: { id: 99, name: 'Sunrise Hospital', slug: 'sunrise' },
          credentials: { email: 'aisha@sunrise.test', password: 'TmpPass!1' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderModal({ request, onClose: noop, onProvisioned });

    fireEvent.change(screen.getByLabelText(/^slug/i), { target: { value: '  SUNRISE  ' } });
    fireEvent.click(screen.getByRole('button', { name: /provision hospital/i }));

    await waitFor(() => expect(onProvisioned).toHaveBeenCalledOnce());

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/admin/onboarding/req-1/provision');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      slug: 'sunrise',
      adminEmail: 'aisha@sunrise.test',
      adminName: 'Aisha Khan',
      plan: 'starter',
    });
    expect(onProvisioned).toHaveBeenCalledWith({
      hospital: { id: 99, name: 'Sunrise Hospital', slug: 'sunrise' },
      credentials: { email: 'aisha@sunrise.test', password: 'TmpPass!1' },
    });

    fetchSpy.mockRestore();
  });

  it('rejects slug that contains invalid characters by keeping submit disabled', () => {
    renderModal({ request, onClose: noop, onProvisioned: noop });
    fireEvent.change(screen.getByLabelText(/^slug/i), { target: { value: 'BAD SLUG!' } });
    const submit = screen.getByRole('button', { name: /provision hospital/i });
    expect(submit).toBeDisabled();
  });
});
