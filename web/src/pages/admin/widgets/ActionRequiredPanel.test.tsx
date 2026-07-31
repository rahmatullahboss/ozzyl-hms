import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActionRequiredPanel from './ActionRequiredPanel';

vi.mock('../command-center/components/ActionCenterSummaryPanel', () => ({
  default: () => <section data-testid="action-center-summary-panel">Authoritative Action Center summary</section>,
}));

describe('ActionRequiredPanel compatibility wrapper', () => {
  it('delegates to the authoritative Action Center summary panel', () => {
    render(<ActionRequiredPanel />);
    expect(screen.getByTestId('action-center-summary-panel')).toHaveTextContent('Authoritative Action Center summary');
  });
});
