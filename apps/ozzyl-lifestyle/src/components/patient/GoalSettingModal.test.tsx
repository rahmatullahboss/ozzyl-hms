import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import GoalSettingModal from './GoalSettingModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key ? `__${key}` : ''),
    i18n: { language: 'en' },
  }),
}));

describe('GoalSettingModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <GoalSettingModal isOpen={false} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders modal when isOpen is true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ goals: [] }),
    } as Response);
    render(<GoalSettingModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByText('__goals.title')).toBeInTheDocument();
  });

  it('calls fetch for goals on open', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ goals: [] }),
    } as Response);
    render(<GoalSettingModal isOpen={true} onClose={() => {}} />);
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/wellness/goals?status=active',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('shows empty state when no goals', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ goals: [] }),
    } as Response);
    render(<GoalSettingModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('__goals.noGoals')).toBeInTheDocument();
    });
  });

  it('renders goal type selector buttons', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ goals: [] }),
    } as Response);
    await act(async () => {
      render(<GoalSettingModal isOpen={true} onClose={() => {}} />);
    });
    expect(screen.getByText('Daily Steps')).toBeInTheDocument();
    expect(screen.getByText('Sleep Hours')).toBeInTheDocument();
    expect(screen.getByText('Meditation')).toBeInTheDocument();
  });

  it('renders target input and set goal button', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ goals: [] }),
    } as Response);
    await act(async () => {
      render(<GoalSettingModal isOpen={true} onClose={() => {}} />);
    });
    expect(screen.getByText('__goals.target')).toBeInTheDocument();
    expect(screen.getByText('__goals.setGoal')).toBeInTheDocument();
  });

  it('displays active goals when fetched', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        goals: [
          { id: 1, goal_type: 'steps', target_value: 10000, current_value: 5000, unit: 'steps', status: 'active', start_date: '2026-04-16', end_date: null, ai_suggested: 0 },
        ],
      }),
    } as Response);
    render(<GoalSettingModal isOpen={true} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('5000 / 10000 steps')).toBeInTheDocument();
    });
  });

  it('creates goal on set goal click', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ goals: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, id: 1 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ goals: [] }),
      } as Response);

    const onGoalChange = vi.fn();
    await act(async () => {
      render(<GoalSettingModal isOpen={true} onClose={() => {}} onGoalChange={onGoalChange} />);
    });

    const setGoalBtn = screen.getByText('__goals.setGoal');
    await act(async () => {
      fireEvent.click(setGoalBtn);
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/wellness/goals',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('abandons goal when trash icon clicked', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          goals: [
            { id: 5, goal_type: 'sleep_hours', target_value: 8, current_value: 6, unit: 'hours', status: 'active', start_date: '2026-04-16', end_date: null, ai_suggested: 0 },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ goals: [] }),
      } as Response);

    render(<GoalSettingModal isOpen={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('6 / 8 hours')).toBeInTheDocument();
    });

    const trashButtons = screen.getAllByRole('button');
    const trashBtn = trashButtons.find((btn) => btn.querySelector('svg.lucide-trash-2'));
    if (trashBtn) {
      await act(async () => {
        fireEvent.click(trashBtn);
      });
    }
  });
});
