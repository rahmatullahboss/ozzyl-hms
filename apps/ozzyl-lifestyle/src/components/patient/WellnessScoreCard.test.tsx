import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import WellnessScoreCard from './WellnessScoreCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

describe('WellnessScoreCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders score with default value 0 in Bengali', () => {
    render(<WellnessScoreCard />);
    expect(screen.getByText('০')).toBeInTheDocument();
  });

  it('renders provided score in Bengali locale', () => {
    render(<WellnessScoreCard totalScore={75} />);
    expect(screen.getByText('৭৫')).toBeInTheDocument();
  });

  it('renders score title label', () => {
    render(<WellnessScoreCard totalScore={50} />);
    expect(screen.getByText('score.title')).toBeInTheDocument();
  });

  it('renders "excellent" label for score >= 90', () => {
    render(<WellnessScoreCard totalScore={92} />);
    expect(screen.getByText('score.excellent')).toBeInTheDocument();
  });

  it('renders "good" label for score >= 80', () => {
    render(<WellnessScoreCard totalScore={85} />);
    expect(screen.getByText('score.good')).toBeInTheDocument();
  });

  it('renders "fair" label for score >= 70', () => {
    render(<WellnessScoreCard totalScore={72} />);
    expect(screen.getByText('score.fair')).toBeInTheDocument();
  });

  it('renders "needsWork" label for score >= 60', () => {
    render(<WellnessScoreCard totalScore={65} />);
    expect(screen.getByText('score.needsWork')).toBeInTheDocument();
  });

  it('renders "attention" label for score < 60', () => {
    render(<WellnessScoreCard totalScore={40} />);
    expect(screen.getByText('score.attention')).toBeInTheDocument();
  });

  it('renders trend indicator when trend > 0', () => {
    render(<WellnessScoreCard totalScore={70} trend={5} />);
    expect(screen.getByText(/score.trend7d/)).toBeInTheDocument();
  });

  it('renders trend indicator when trend < 0', () => {
    render(<WellnessScoreCard totalScore={70} trend={-3} />);
    expect(screen.getByText(/score.trend7d/)).toBeInTheDocument();
  });

  it('does not render trend indicator when trend is 0', () => {
    const { container } = render(<WellnessScoreCard totalScore={70} trend={0} />);
    expect(container.querySelector('.rounded-full')).toBeNull();
  });

  it('renders 4 mini metrics', () => {
    render(<WellnessScoreCard totalScore={70} breakdown={{ sleep: 80, activity: 60, nutrition: 50, mood: 70, medication: 90, vitals: 65 }} />);
    expect(screen.getByText(/modules\.sleep/)).toBeInTheDocument();
    expect(screen.getByText(/modules\.activity/)).toBeInTheDocument();
    expect(screen.getByText(/modules\.mind/)).toBeInTheDocument();
    expect(screen.getByText(/modules\.vitals/)).toBeInTheDocument();
  });
});
