import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import StreakTrackerCard from './StreakTrackerCard';
import type { StreakData } from './StreakTrackerCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

const baseStreaks: StreakData[] = [
  { streak_type: 'daily_checkin', current_count: 5, longest_count: 10, last_logged_date: '2026-04-16' },
];

const baseWeekDays = [true, true, true, false, false, false, false];

describe('StreakTrackerCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders streak count in Bengali', () => {
    render(<StreakTrackerCard streaks={baseStreaks} weekDays={baseWeekDays} todayIndex={3} />);
    expect(screen.getByText(/৫streak\.title/)).toBeInTheDocument();
  });

  it('renders "Start your streak" when streak is 0', () => {
    const noStreak: StreakData[] = [
      { streak_type: 'daily_checkin', current_count: 0, longest_count: 0, last_logged_date: '' },
    ];
    render(<StreakTrackerCard streaks={noStreak} weekDays={baseWeekDays} todayIndex={3} />);
    const elements = screen.getAllByText('streak.start');
    expect(elements.length).toBeGreaterThanOrEqual(1);
  });

  it('renders correct motivational key for streak >= 7', () => {
    const longStreak: StreakData[] = [
      { streak_type: 'daily_checkin', current_count: 8, longest_count: 15, last_logged_date: '2026-04-16' },
    ];
    render(<StreakTrackerCard streaks={longStreak} weekDays={baseWeekDays} todayIndex={3} />);
    expect(screen.getByText('streak.day7')).toBeInTheDocument();
  });

  it('renders correct motivational key for streak >= 14', () => {
    const longStreak: StreakData[] = [
      { streak_type: 'daily_checkin', current_count: 14, longest_count: 20, last_logged_date: '2026-04-16' },
    ];
    render(<StreakTrackerCard streaks={longStreak} weekDays={baseWeekDays} todayIndex={3} />);
    expect(screen.getByText('streak.day14')).toBeInTheDocument();
  });

  it('renders correct motivational key for streak >= 30', () => {
    const longStreak: StreakData[] = [
      { streak_type: 'daily_checkin', current_count: 30, longest_count: 30, last_logged_date: '2026-04-16' },
    ];
    render(<StreakTrackerCard streaks={longStreak} weekDays={baseWeekDays} todayIndex={3} />);
    expect(screen.getByText('streak.day30')).toBeInTheDocument();
  });

  it('renders 7 day columns', () => {
    render(<StreakTrackerCard streaks={baseStreaks} weekDays={baseWeekDays} todayIndex={3} />);
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sun')).toBeInTheDocument();
  });

  it('renders checkmark for completed days', () => {
    render(<StreakTrackerCard streaks={baseStreaks} weekDays={baseWeekDays} todayIndex={3} />);
    const checks = screen.getAllByText('✓');
    expect(checks.length).toBe(3);
  });

  it('shows sparkle for streak >= 7', () => {
    const longStreak: StreakData[] = [
      { streak_type: 'daily_checkin', current_count: 10, longest_count: 10, last_logged_date: '2026-04-16' },
    ];
    render(<StreakTrackerCard streaks={longStreak} weekDays={baseWeekDays} todayIndex={3} />);
    expect(screen.getByText('✨')).toBeInTheDocument();
  });

  it('hides sparkle for streak < 7', () => {
    render(<StreakTrackerCard streaks={baseStreaks} weekDays={baseWeekDays} todayIndex={3} />);
    expect(screen.queryByText('✨')).toBeNull();
  });
});
