import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastProvider } from '../components/Toast';
import { useToast } from '../components/Toast';

function Trigger() {
  const { toast } = useToast();
  return (
    <button onClick={() => toast('success', 'hello world')}>Trigger</button>
  );
}

describe('Toast container', () => {
  it('renders a polite live region for accessibility', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
  });
});
