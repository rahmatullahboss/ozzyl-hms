import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LifestyleQuickActions from './LifestyleQuickActions';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

describe('LifestyleQuickActions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders all 4 action buttons', () => {
    render(<LifestyleQuickActions />);
    expect(screen.getByText('quickActions.checkIn')).toBeInTheDocument();
    expect(screen.getByText('quickActions.logFood')).toBeInTheDocument();
    expect(screen.getByText('quickActions.logMood')).toBeInTheDocument();
    expect(screen.getByText('quickActions.trackWater')).toBeInTheDocument();
  });

  it('calls onCheckIn when check-in button is clicked', () => {
    const onCheckIn = vi.fn();
    render(<LifestyleQuickActions onCheckIn={onCheckIn} />);
    fireEvent.click(screen.getByText('quickActions.checkIn'));
    expect(onCheckIn).toHaveBeenCalledTimes(1);
  });

  it('calls onLogFood when food button is clicked', () => {
    const onLogFood = vi.fn();
    render(<LifestyleQuickActions onLogFood={onLogFood} />);
    fireEvent.click(screen.getByText('quickActions.logFood'));
    expect(onLogFood).toHaveBeenCalledTimes(1);
  });

  it('calls onLogMood when mood button is clicked', () => {
    const onLogMood = vi.fn();
    render(<LifestyleQuickActions onLogMood={onLogMood} />);
    fireEvent.click(screen.getByText('quickActions.logMood'));
    expect(onLogMood).toHaveBeenCalledTimes(1);
  });

  it('calls onTrackWater when water button is clicked', () => {
    const onTrackWater = vi.fn();
    render(<LifestyleQuickActions onTrackWater={onTrackWater} />);
    fireEvent.click(screen.getByText('quickActions.trackWater'));
    expect(onTrackWater).toHaveBeenCalledTimes(1);
  });

  it('applies opacity-70 class to completed actions', () => {
    const completedToday = new Set(['checkIn']);
    const { container } = render(<LifestyleQuickActions completedToday={completedToday} />);
    const buttons = container.querySelectorAll('button');
    const checkInBtn = Array.from(buttons).find((b) => b.textContent?.includes('quickActions.checkIn'));
    expect(checkInBtn?.classList.contains('opacity-70')).toBe(true);
  });

  it('renders checkmark overlay for completed actions', () => {
    const completedToday = new Set(['logFood']);
    render(<LifestyleQuickActions completedToday={completedToday} />);
    const svg = document.querySelector('.bg-emerald-500 svg');
    expect(svg).toBeInTheDocument();
  });

  it('does not render checkmark for uncompleted actions', () => {
    const completedToday = new Set(['checkIn']);
    const { container } = render(<LifestyleQuickActions completedToday={completedToday} />);
    const buttons = container.querySelectorAll('button');
    const foodBtn = Array.from(buttons).find((b) => b.textContent?.includes('quickActions.logFood'));
    expect(foodBtn?.querySelector('.bg-emerald-500')).toBeNull();
  });

  it('applies line-through to completed action labels', () => {
    const completedToday = new Set(['logMood']);
    const { container } = render(<LifestyleQuickActions completedToday={completedToday} />);
    const buttons = container.querySelectorAll('button');
    const moodBtn = Array.from(buttons).find((b) => b.textContent?.includes('quickActions.logMood'));
    const label = moodBtn?.querySelector('span');
    expect(label?.classList.contains('line-through')).toBe(true);
  });
});
