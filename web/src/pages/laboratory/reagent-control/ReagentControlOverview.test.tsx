import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ReagentControlOverview from './ReagentControlOverview';

const policySummary = {
  tone: 'safe' as const,
  title: 'Safe rollout is active',
  description: 'Reagent deduction is attempted when a lab test is billed. Missing stock or recipes create warnings instead of stopping service.',
  timing: 'When billed',
  blocking: 'Billing and results continue',
  recipes: 'Missing recipes create warnings',
};

const setupSteps = [
  { id: 'catalog', label: 'Load starter reagent catalog', detail: 'Create editable starter recipes.', done: false, section: 'recipes' as const },
  { id: 'recipes', label: 'Review missing test recipes', detail: 'Confirm reagent usage.', done: false, section: 'recipes' as const },
  { id: 'stock', label: 'Add current stock and locations', detail: 'Record usable lots.', done: true, section: 'stock' as const },
  { id: 'policy', label: 'Start safe soft-mode control', detail: 'Keep billing and results unblocked.', done: true, section: 'overview' as const },
];

describe('ReagentControlOverview', () => {
  it('shows plain-language status, three actions and guided setup', () => {
    render(
      <ReagentControlOverview
        policySummary={policySummary}
        actions={[
          { id: 'fix-recipes', section: 'recipes', label: 'Set up 4 missing test recipes', description: 'Choose recipe items.' },
          { id: 'review-stock', section: 'stock', label: 'Review 2 stock warnings', description: 'Check lots.' },
          { id: 'review-issues', section: 'issues', label: 'Review 1 reagent issue', description: 'Fix and retry.' },
        ]}
        setupSteps={setupSteps}
        onSectionChange={() => undefined}
        onOpenAdvanced={() => undefined}
      />,
    );

    expect(screen.getByText('Safe rollout is active')).toBeInTheDocument();
    expect(screen.getByText('Billing and results continue')).toBeInTheDocument();
    expect(screen.getAllByTestId('reagent-next-action')).toHaveLength(3);
    expect(screen.getByText('Load starter reagent catalog')).toBeInTheDocument();
    expect(screen.getByText('2 of 4 setup steps complete')).toBeInTheDocument();
    expect(screen.queryByText('OpenELIS-style bridge deployment readiness')).not.toBeInTheDocument();
  });

  it('shows a calm healthy state when no action is required', () => {
    render(
      <ReagentControlOverview
        policySummary={policySummary}
        actions={[]}
        setupSteps={setupSteps.map(step => ({ ...step, done: true }))}
        onSectionChange={() => undefined}
        onOpenAdvanced={() => undefined}
      />,
    );

    expect(screen.getByText('Reagent control is running normally')).toBeInTheDocument();
    expect(screen.getByText('No action is required right now.')).toBeInTheDocument();
  });

  it('routes action and setup buttons and opens advanced settings', () => {
    const onSectionChange = vi.fn();
    const onOpenAdvanced = vi.fn();
    render(
      <ReagentControlOverview
        policySummary={policySummary}
        actions={[
          { id: 'fix-recipes', section: 'recipes', label: 'Set up missing recipes', description: 'Choose recipe items.' },
        ]}
        setupSteps={setupSteps}
        onSectionChange={onSectionChange}
        onOpenAdvanced={onOpenAdvanced}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set up missing recipes' }));
    expect(onSectionChange).toHaveBeenCalledWith('recipes');

    fireEvent.click(screen.getByRole('button', { name: /Load starter reagent catalog/ }));
    expect(onSectionChange).toHaveBeenCalledWith('recipes');

    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }));
    expect(onOpenAdvanced).toHaveBeenCalledTimes(1);
  });

  it('shows compact attention notices without expanding technical details', () => {
    render(
      <ReagentControlOverview
        policySummary={policySummary}
        actions={[]}
        setupSteps={setupSteps}
        attentionNotices={[
          { id: 'analyzer', title: 'Analyzer connection needs attention', detail: '2 unmatched results are waiting.' },
        ]}
        onSectionChange={() => undefined}
        onOpenAdvanced={() => undefined}
      />,
    );

    expect(screen.getByText('Analyzer connection needs attention')).toBeInTheDocument();
    expect(screen.getByText('2 unmatched results are waiting.')).toBeInTheDocument();
    expect(screen.queryByText('Machine breakdown')).not.toBeInTheDocument();
  });
});
