import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CycleTracker from './CycleTracker';
import MentalHealthScreen from './MentalHealthScreen';
import FoodLogModal from './FoodLogModal';
import ActivityModule from './ActivityModule';
import ConnectedCareTab from './ConnectedCareTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

describe('recent wellness integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/wellness/cycle/history')) {
        return {
          ok: true,
          json: async () => ({ cycles: [], avg_cycle_length: 28, next_predicted: '2026-05-01' }),
        } as Response;
      }
      if (url.includes('/api/hospital-links/consents')) {
        return {
          ok: true,
          json: async () => ({ consents: [] }),
        } as Response;
      }
      if (url.includes('/api/hospital-links/') && url.includes('/data?type=summary')) {
        return {
          ok: true,
          json: async () => ({ data: { appointments: [], prescriptions: [], labs: [], bills: [] } }),
        } as Response;
      }
      if (url.includes('/api/hospital-links/') && url.includes('/pre-visit')) {
        return {
          ok: true,
          json: async () => ({ insight: null, actions: [] }),
        } as Response;
      }
      if (url === '/api/hospital-links') {
        return {
          ok: true,
          json: async () => ({
            hospitals: [
              { id: 42, tenant_id: 'tenant-1', hospital_name: 'Demo Hospital', status: 'active', linked_at: '2026-04-18' },
            ],
          }),
        } as Response;
      }
      if (url.includes('/sync-labs') || url.includes('/sync-prescriptions')) {
        return {
          ok: true,
          json: async () => ({ success: true, synced: 2 }),
        } as Response;
      }
      if (url.includes('/api/wellness/logs/activity')) {
        return {
          ok: true,
          json: async () => ({
            logs: [
              {
                id: 1,
                activity_type: 'walk',
                duration_min: 40,
                calories_burned: 180,
                logged_at: '2026-04-18T08:00:00Z',
              },
            ],
          }),
        } as Response;
      }
      if (url.includes('/api/food/search')) {
        return {
          ok: true,
          json: async () => ({ items: [] }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ success: true }),
      } as Response;
    }));
  });

  it('loads cycle history from the current cycle history endpoint', async () => {
    render(<CycleTracker />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/wellness/cycle/history', { credentials: 'include' });
    });
  });

  it('submits screenings to the dedicated wellness screening endpoint', async () => {
    render(<MentalHealthScreen />);

    for (let index = 0; index < 9; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /0\.\s*Not at all/i }));
    }

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/wellness/screening',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        }),
      );
    });
  });

  it('surfaces food camera capture inside the food log modal', () => {
    render(<FoodLogModal isOpen onClose={vi.fn()} onLogged={vi.fn()} />);

    expect(screen.getByText('Take a Photo of Your Food')).toBeInTheDocument();
  });

  it('shows activity rings alongside the daily activity summary', async () => {
    render(<ActivityModule />);

    await waitFor(() => {
      expect(screen.getByText('Move')).toBeInTheDocument();
      expect(screen.getByText('Exercise')).toBeInTheDocument();
      expect(screen.getByText('Stand')).toBeInTheDocument();
    });
  });

  it('surfaces connected care bridge actions for lab and prescription sync', async () => {
    render(<ConnectedCareTab />);

    expect(await screen.findByText('Bring hospital data into your wellness flow')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sync labs to wellness/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sync prescriptions to tracker/i })).toBeInTheDocument();
  });
});
