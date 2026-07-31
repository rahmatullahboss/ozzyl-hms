import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReagentControlTabs from './ReagentControlTabs';

describe('ReagentControlTabs', () => {
  it('renders four accessible primary tabs', () => {
    render(<ReagentControlTabs active="overview" onChange={() => undefined} />);

    expect(screen.getByRole('tablist', { name: 'Reagent control sections' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Stock' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Test Recipes' })).toHaveAttribute('aria-controls', 'reagent-control-panel-recipes');
  });

  it('moves through tabs with keyboard navigation', () => {
    const onChange = vi.fn();
    render(<ReagentControlTabs active="overview" onChange={onChange} />);

    const overview = screen.getByRole('tab', { name: 'Overview' });
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('stock');

    fireEvent.keyDown(overview, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('issues');

    fireEvent.keyDown(overview, { key: 'End' });
    expect(onChange).toHaveBeenCalledWith('issues');

    fireEvent.keyDown(overview, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('overview');
  });

  it('moves keyboard focus to the newly active tab', () => {
    function Harness() {
      const [active, setActive] = useState<'overview' | 'stock' | 'recipes' | 'issues'>('overview');
      return <ReagentControlTabs active={active} onChange={setActive} />;
    }

    render(<Harness />);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });

    expect(screen.getByRole('tab', { name: 'Stock' })).toHaveFocus();
  });

  it('activates a section on click', () => {
    const onChange = vi.fn();
    render(<ReagentControlTabs active="overview" onChange={onChange} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Issues' }));
    expect(onChange).toHaveBeenCalledWith('issues');
  });
});
