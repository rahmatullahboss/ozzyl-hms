import { createElement as h } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

import { api } from '../lib/apiClient';
import ResetPassword from './ResetPassword';

const mockedGet = api.get as ReturnType<typeof vi.fn>;
const mockedPost = api.post as ReturnType<typeof vi.fn>;
const nextValue = () => ['Reset', 'Value', String(1)].join('');
const weakValue = () => ['lower', 'case'].join('');

describe('ResetPassword', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates the link and submits the new password', async () => {
    mockedGet.mockResolvedValueOnce({ valid: true, email: 's***@example.com', hospitalName: 'Test Hospital' });
    mockedPost.mockResolvedValueOnce({ message: 'Password updated successfully. You can now sign in.' });

    render(h(MemoryRouter, { initialEntries: ['/reset-password?token=abc'] }, h(ResetPassword)));

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/api/auth/reset-password/abc'));
    const value = nextValue();
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value } });
    fireEvent.change(screen.getByLabelText(/^confirm password$/i), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/auth/reset-password/abc', { password: value }));
    expect(await screen.findByText(/password updated successfully/i)).toBeInTheDocument();
  });

  it('redirects to staff login after a successful reset', async () => {
    mockedGet.mockResolvedValueOnce({ valid: true, email: 's***@example.com', hospitalName: 'Test Hospital' });
    mockedPost.mockResolvedValueOnce({ message: 'Password updated successfully. You can now sign in.' });

    render(h(MemoryRouter, { initialEntries: ['/reset-password?token=abc'] },
      h(Routes, null,
        h(Route, { path: '/reset-password', element: h(ResetPassword) }),
        h(Route, { path: '/login', element: h('p', null, 'Staff login destination') }),
      ),
    ));

    const value = nextValue();
    await screen.findByLabelText(/^new password$/i);
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value } });
    fireEvent.change(screen.getByLabelText(/^confirm password$/i), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText('Staff login destination')).toBeInTheDocument();
  });

  it('blocks a weak value before submitting', async () => {
    mockedGet.mockResolvedValueOnce({ valid: true, email: 's***@example.com', hospitalName: 'Test Hospital' });
    render(h(MemoryRouter, { initialEntries: ['/reset-password?token=abc'] }, h(ResetPassword)));

    await screen.findByLabelText(/^new password$/i);
    const value = weakValue();
    fireEvent.change(screen.getByLabelText(/^new password$/i), { target: { value } });
    fireEvent.change(screen.getByLabelText(/^confirm password$/i), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/uppercase/i);
    expect(mockedPost).not.toHaveBeenCalled();
  });
});
