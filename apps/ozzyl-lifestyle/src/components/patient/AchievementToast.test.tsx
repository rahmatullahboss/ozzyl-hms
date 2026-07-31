import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AchievementToast from './AchievementToast';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (key ? `__${key}` : (fallback ?? '')),
    i18n: { language: 'en' },
  }),
}));

describe('AchievementToast', () => {
  it('returns null when achievements array is empty', () => {
    const { container } = render(
      <AchievementToast achievements={[]} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders achievement when achievements are provided', () => {
    render(
      <AchievementToast achievements={['first_checkin']} onClose={() => {}} />,
    );
    expect(screen.getByText('__achievements.unlocked')).toBeInTheDocument();
    expect(screen.getByText('__achievements.first_checkin')).toBeInTheDocument();
  });

  it('shows emoji for achievement key', () => {
    render(
      <AchievementToast achievements={['3_day_streak']} onClose={() => {}} />,
    );
    expect(screen.getByText('🔥')).toBeInTheDocument();
  });

  it('shows counter when multiple achievements', () => {
    render(
      <AchievementToast achievements={['first_checkin', '3_day_streak']} onClose={() => {}} />,
    );
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <AchievementToast achievements={['first_checkin']} onClose={onClose} />,
    );
    const closeButton = screen.getByRole('button');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
