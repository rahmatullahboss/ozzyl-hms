import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../components/Toast';
import CreateHospitalModal from '../components/CreateHospitalModal';

function renderModal(props: React.ComponentProps<typeof CreateHospitalModal>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <CreateHospitalModal {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('CreateHospitalModal', () => {
  const noop = vi.fn();

  it('renders nothing when open is false', () => {
    renderModal({ open: false, onClose: noop, onCreated: noop });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders form with hospital name, subdomain, admin fields when open', () => {
    renderModal({ open: true, onClose: noop, onCreated: noop });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/hospital name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/subdomain/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/admin email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/admin name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/admin password/i)).toBeInTheDocument();
  });

  it('calls onClose when Cancel button clicked', () => {
    const onClose = vi.fn();
    renderModal({ open: true, onClose, onCreated: noop });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('submits trimmed form data and calls onCreated with returned hospital', async () => {
    const onCreated = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          message: 'ok',
          hospital: { id: 42, name: 'City Hospital', subdomain: 'city' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderModal({ open: true, onClose: noop, onCreated });

    fireEvent.change(screen.getByLabelText(/hospital name/i), {
      target: { value: '  City Hospital  ' },
    });
    fireEvent.change(screen.getByLabelText(/subdomain/i), {
      target: { value: 'city' },
    });
    fireEvent.change(screen.getByLabelText(/admin email/i), {
      target: { value: 'admin@city.test' },
    });
    fireEvent.change(screen.getByLabelText(/admin name/i), {
      target: { value: 'Jane Admin' },
    });
    fireEvent.change(screen.getByLabelText(/admin password/i), {
      target: { value: 'Strong1Pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create hospital/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      name: 'City Hospital',
      subdomain: 'city',
      adminEmail: 'admin@city.test',
      adminName: 'Jane Admin',
      adminPassword: 'Strong1Pass',
    });
    expect(onCreated).toHaveBeenCalledWith({ id: 42, name: 'City Hospital', subdomain: 'city' });

    fetchSpy.mockRestore();
  });

  it('disables submit and shows inline error when hospital name is empty', () => {
    renderModal({ open: true, onClose: noop, onCreated: noop });
    const submit = screen.getByRole('button', { name: /create hospital/i });
    expect(submit).toBeDisabled();
  });

  it('lowercases subdomain before submit', async () => {
    const onCreated = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'ok', hospital: { id: 1, name: 'X', subdomain: 'foo' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    renderModal({ open: true, onClose: noop, onCreated });
    fireEvent.change(screen.getByLabelText(/hospital name/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/subdomain/i), { target: { value: 'FOO' } });
    fireEvent.click(screen.getByRole('button', { name: /create hospital/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.subdomain).toBe('foo');
    fetchSpy.mockRestore();
  });
});
