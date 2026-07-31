import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('KPICard', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./KPICard');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBeOneOf(['function', 'object']);
  });

  it('renders a tooltip icon when the tooltip prop is provided', async () => {
    const { default: KPICard } = await import('./KPICard');
    render(<KPICard title="Today Collection" value={56000} tooltip="Revenue from bill payments only" testId="kpi-test" />);
    const tooltip = screen.getByTitle('Revenue from bill payments only');
    expect(tooltip).toBeInTheDocument();
  });

  it('renders the subBreakdown pills with correct sign and color', async () => {
    const { default: KPICard } = await import('./KPICard');
    render(
      <KPICard
        title="Today's Cash Movement"
        value={56000}
        testId="kpi-cash"
        subBreakdown={[
          { label: 'deposit', amount: 500, direction: 'in' },
          { label: 'expense', amount: -300, direction: 'out' },
          { label: 'payout', amount: -32928, direction: 'out' },
        ]}
      />,
    );
    expect(screen.getByText('+৳500 deposit')).toBeInTheDocument();
    expect(screen.getByText('−৳300 expense')).toBeInTheDocument();
    expect(screen.getByText('−৳32,928 payout')).toBeInTheDocument();
  });

  it('renders the detailHint when onClick is set', async () => {
    const { default: KPICard } = await import('./KPICard');
    render(
      <KPICard
        title="Today's Cash Movement"
        value={56000}
        testId="kpi-cash"
        detailHint="View source breakdown"
        onClick={() => {}}
      />,
    );
    expect(screen.getByText('View source breakdown')).toBeInTheDocument();
  });
});
