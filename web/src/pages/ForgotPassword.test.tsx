import { createElement as h } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/apiClient', () => ({
  api: { post: vi.fn() },
}));

import { api } from '../lib/apiClient';
import ForgotPassword from './ForgotPassword';

const mockedPost = api.post as ReturnType<typeof vi.fn>;

describe('ForgotPassword', () => {
  beforeEach(() => vi.clearAllMocks());

  it('submits the email and shows a neutral confirmation', async () => {
    mockedPost.mockResolvedValueOnce({
      message: 'If an active account exists for that email, a password reset link has been sent.',
    });

    render(h(MemoryRouter, null, h(ForgotPassword)));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'staff@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/auth/forgot-password', {
      email: 'staff@example.com',
    }));
    expect(await screen.findByText(/if an active account exists/i)).toBeInTheDocument();
  });
});
