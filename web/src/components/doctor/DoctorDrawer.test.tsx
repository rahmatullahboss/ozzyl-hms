import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DoctorDrawer } from './DoctorDrawer';

function renderDrawer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DoctorDrawer open doctor={null} onClose={vi.fn()} onSuccess={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DoctorDrawer', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./DoctorDrawer');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders a separate non-negative IPD round fee field', () => {
    renderDrawer();

    const input = screen.getByLabelText('IPD Round Fee');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '0');
  });
});
