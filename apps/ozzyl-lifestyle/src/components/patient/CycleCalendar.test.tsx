import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CycleCalendar from './CycleCalendar';

describe('CycleCalendar', () => {
  it('renders the core titles and current prediction status', () => {
    render(<CycleCalendar />);
    expect(screen.getByText('Cycle Tracker')).toBeInTheDocument();
    expect(screen.getByText('Prediction')).toBeInTheDocument();
    expect(screen.getByText('Day 4')).toBeInTheDocument();
    expect(screen.getByText('of Period')).toBeInTheDocument();
    expect(screen.getByText('Next cycle expected in 24 days.')).toBeInTheDocument();
  });

  it('renders the days of the week', () => {
    render(<CycleCalendar />);
    const weekdays = ['M', 'T', 'W', 'F', 'S'];
    weekdays.forEach((dayText) => {
      expect(screen.getAllByText(dayText).length).toBeGreaterThan(0);
    });
  });

  it('renders days 1 to 30', () => {
    render(<CycleCalendar />);
    // Testing specific boundary days
    expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '15' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30' })).toBeInTheDocument();
  });

  it('renders the action buttons', () => {
    render(<CycleCalendar />);
    expect(screen.getByText('Log Symptoms')).toBeInTheDocument();
    expect(screen.getByText('Edit Dates')).toBeInTheDocument();
  });
});
