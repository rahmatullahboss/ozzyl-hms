import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { AuthProvider } from '../hooks/useAuth';
import Login from '../pages/Login';

function renderLogin() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <Login />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Login form accessibility attributes', () => {
  it('email input has autocomplete="email", name, and inputMode="email"', () => {
    renderLogin();
    const email = screen.getByLabelText(/email address/i);
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toHaveAttribute('name', 'email');
    expect(email).toHaveAttribute('inputmode', 'email');
    expect(email).toHaveAttribute('spellcheck', 'false');
  });

  it('password input has autocomplete="current-password" and name="password"', () => {
    renderLogin();
    const pwd = screen.getByLabelText(/^password$/i);
    expect(pwd).toHaveAttribute('autocomplete', 'current-password');
    expect(pwd).toHaveAttribute('name', 'password');
  });
});
