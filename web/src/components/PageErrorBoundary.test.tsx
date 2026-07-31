import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PageErrorBoundary } from '../components/PageErrorBoundary';

function ThrowingComponent({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test rendering error');
  }
  return <div data-testid="child-content">Content rendered</div>;
}

describe('PageErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <PageErrorBoundary>
        <ThrowingComponent shouldThrow={false} />
      </PageErrorBoundary>,
    );

    expect(screen.getByTestId('child-content')).toHaveTextContent('Content rendered');
  });

  it('catches rendering errors and shows fallback UI', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <PageErrorBoundary>
        <ThrowingComponent />
      </PageErrorBoundary>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/try again/i)).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('resets error state when "Try again" is clicked', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    let shouldThrow = true;
    function ToggleComponent() {
      if (shouldThrow) throw new Error('Test error');
      return <div data-testid="recovered">Recovered</div>;
    }

    const { rerender } = render(
      <PageErrorBoundary>
        <ToggleComponent />
      </PageErrorBoundary>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByText(/try again/i));

    rerender(
      <PageErrorBoundary>
        <ToggleComponent />
      </PageErrorBoundary>,
    );

    expect(screen.getByTestId('recovered')).toHaveTextContent('Recovered');

    consoleSpy.mockRestore();
  });

  it('isolates errors - multiple boundaries work independently', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <div>
        <PageErrorBoundary>
          <ThrowingComponent />
        </PageErrorBoundary>
        <PageErrorBoundary>
          <ThrowingComponent shouldThrow={false} />
        </PageErrorBoundary>
      </div>,
    );

    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByTestId('child-content')).toHaveTextContent('Content rendered');

    consoleSpy.mockRestore();
  });

  it('shows error details in collapsible section', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <PageErrorBoundary>
        <ThrowingComponent />
      </PageErrorBoundary>,
    );

    const details = screen.getByText(/error details/i);
    expect(details).toBeInTheDocument();

    fireEvent.click(details);
    expect(screen.getByText(/test rendering error/i)).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
