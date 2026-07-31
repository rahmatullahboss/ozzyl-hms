import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import { Building2 } from 'lucide-react';

function renderWithRouter(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('EmptyState', () => {
  it('renders an icon, title, and optional CTA', () => {
    renderWithRouter(
      <EmptyState
        icon={Building2}
        title="No hospitals yet"
        description="Add your first hospital to get started."
        cta={{ label: 'Add Hospital', to: '/hospitals/new' }}
      />,
    );
    expect(screen.getByText('No hospitals yet')).toBeInTheDocument();
    expect(screen.getByText('Add your first hospital to get started.')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /add hospital/i });
    expect(cta).toHaveAttribute('href', '/hospitals/new');
  });

  it('renders without a CTA when none is provided', () => {
    renderWithRouter(<EmptyState icon={Building2} title="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
