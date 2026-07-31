import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ToastProvider, useToast } from '../components/Toast';
import { act } from 'react';

function TestComponent() {
  const { toast } = useToast();
  return (
    <div>
      <button onClick={() => toast('success', 'Success message')}>Success</button>
      <button onClick={() => toast('error', 'Error message')}>Error</button>
      <button onClick={() => toast('warning', 'Warning message')}>Warning</button>
    </div>
  );
}

describe('Toast', () => {
  it('renders children without crashing', () => {
    render(
      <ToastProvider>
        <div>Child</div>
      </ToastProvider>
    );
    expect(screen.getByText('Child')).toBeInTheDocument();
  });

  it('shows success toast when triggered', async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Success'));
    });

    expect(screen.getByText('Success message')).toBeInTheDocument();
  });

  it('shows error toast when triggered', async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Error'));
    });

    expect(screen.getByText('Error message')).toBeInTheDocument();
  });

  it('shows warning toast when triggered', async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Warning'));
    });

    expect(screen.getByText('Warning message')).toBeInTheDocument();
  });

  it('removes toast when close button clicked', async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByText('Success'));
    });

    const closeButton = screen.getByRole('button', { name: /dismiss notification/i });
    await act(async () => {
      fireEvent.click(closeButton);
    });

    await waitFor(() => {
      expect(screen.queryByText('Success message')).not.toBeInTheDocument();
    });
  });

  it('throws when useToast is used outside ToastProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    expect(() => {
      render(<TestComponent />);
    }).toThrow('useToast must be used within a ToastProvider');
    
    consoleSpy.mockRestore();
  });
});
