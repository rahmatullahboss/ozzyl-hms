import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StreakTrackerWidget } from './StreakTrackerWidget';

// ATDD RED PHASE: Tests marked with .skip() to indicate failing before implementation
describe('StreakTrackerWidget Validation', () => {
  it('P0: renders 7 distinct days in the tracker layout', () => {
    render(<StreakTrackerWidget />);
    
    // Ensure all 7 days of the week are available in the DOM
    const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    weekDays.forEach(day => {
      expect(screen.getByText(day)).toBeInTheDocument();
    });
  });

  it('P1: prominently displays the current 3 day streak text', () => {
    render(<StreakTrackerWidget />);
    
    expect(screen.getByText('3 Day Streak!')).toBeInTheDocument();
    expect(screen.getByText(/Keep it up/i)).toBeInTheDocument();
  });
});
