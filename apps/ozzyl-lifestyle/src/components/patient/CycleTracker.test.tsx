import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CycleTracker from './CycleTracker';

describe('CycleTracker Validation', () => {
  it('P0: renders cycle tracking widget', () => {
    render(<CycleTracker />);
    expect(screen.getByText('Menstrual Cycle Tracker')).toBeInTheDocument();
  });
});
