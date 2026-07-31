import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider, useToast } from '../components/Toast';
import Login from '../pages/Login';
import ConfirmDialog from '../components/ConfirmDialog';
import Layout from '../components/Layout';
import { AuthProvider } from '../hooks/useAuth';

function renderLayout() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <Layout />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('Icon-only buttons have accessible names', () => {
  it('Layout hamburger menu has an aria-label', () => {
    renderLayout();
    const menuBtn = screen.getByRole('button', { name: /open menu/i });
    expect(menuBtn).toBeInTheDocument();
  });
});

describe('Login password toggle', () => {
  it('has an aria-label that toggles between "Show password" and "Hide password"', () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <Login />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>,
    );
    const toggle = screen.getByRole('button', { name: /show password/i });
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();
  });
});

describe('Toast close button', () => {
  it('has an aria-label when a toast is visible', () => {
    function Trigger() {
      const { toast } = useToast();
      return <button onClick={() => toast('success', 'hi')}>Show</button>;
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /show/i }));
    expect(screen.getByRole('button', { name: /dismiss notification/i })).toBeInTheDocument();
  });
});

describe('ConfirmDialog close button', () => {
  it('has an aria-label', () => {
    render(
      <ConfirmDialog
        open
        title="T"
        message="M"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /close dialog/i })).toBeInTheDocument();
  });
});
