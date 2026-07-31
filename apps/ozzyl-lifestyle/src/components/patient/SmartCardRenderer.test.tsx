import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SmartCardRenderer from './SmartCardRenderer';
import type { SmartCard } from '../../lib/smart-card-priority';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key ? `__${key}` : ''),
    i18n: { language: 'en' },
  }),
}));

describe('SmartCardRenderer', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when cards array is empty', () => {
    const { container } = render(<SmartCardRenderer cards={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a card for each item', () => {
    const cards: SmartCard[] = [
      { type: 'health_tip', priority: 6 },
      { type: 'checkin_prompt', priority: 3 },
    ];
    render(<SmartCardRenderer cards={cards} />);
    expect(screen.getByText('__smartCards.healthTip')).toBeInTheDocument();
    expect(screen.getByText('__smartCards.checkinPrompt')).toBeInTheDocument();
  });

  it('renders critical_alert with ring styling', () => {
    const cards: SmartCard[] = [
      { type: 'critical_alert', priority: 1, props: { alerts: [{ title: 'A', message: 'B' }] } },
    ];
    const { container } = render(<SmartCardRenderer cards={cards} />);
    const card = container.querySelector('.ring-2');
    expect(card).toBeInTheDocument();
  });

  it('renders CTA button when CTA key resolves to different text', () => {
    const cards: SmartCard[] = [
      { type: 'med_reminder', priority: 2 },
    ];
    render(<SmartCardRenderer cards={cards} />);
    expect(screen.getByText('__smartCards.takeNow →')).toBeInTheDocument();
  });

  it('does not render CTA for health_tip (empty CTA key)', () => {
    const cards: SmartCard[] = [
      { type: 'health_tip', priority: 6 },
    ];
    const { container } = render(<SmartCardRenderer cards={cards} />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('calls onAction when CTA button is clicked', () => {
    const onAction = vi.fn();
    const cards: SmartCard[] = [
      { type: 'checkin_prompt', priority: 3 },
    ];
    render(<SmartCardRenderer cards={cards} onAction={onAction} />);
    fireEvent.click(screen.getByText('__smartCards.checkInNow →'));
    expect(onAction).toHaveBeenCalledWith('checkin_prompt', undefined);
  });

  it('renders all 8 card types', () => {
    const cards: SmartCard[] = [
      { type: 'critical_alert', priority: 1 },
      { type: 'med_reminder', priority: 2 },
      { type: 'checkin_prompt', priority: 3 },
      { type: 'streak_at_risk', priority: 4 },
      { type: 'goal_progress', priority: 5 },
      { type: 'health_tip', priority: 6 },
      { type: 'weekly_summary', priority: 7 },
      { type: 'discovery', priority: 8 },
    ];
    render(<SmartCardRenderer cards={cards} />);
    expect(screen.getByText('__smartCards.criticalAlert')).toBeInTheDocument();
    expect(screen.getByText('__smartCards.medReminder')).toBeInTheDocument();
    expect(screen.getByText('__smartCards.checkinPrompt')).toBeInTheDocument();
    expect(screen.getByText('__smartCards.streakAtRisk')).toBeInTheDocument();
    expect(screen.getByText('__smartCards.goalProgress')).toBeInTheDocument();
    expect(screen.getByText('__smartCards.healthTip')).toBeInTheDocument();
    expect(screen.getByText('__smartCards.weeklySummary')).toBeInTheDocument();
    expect(screen.getByText('__smartCards.discovery')).toBeInTheDocument();
  });
});
