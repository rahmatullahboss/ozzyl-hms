import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IPDReports from './IPDReports';
import { useApiQuery } from '../hooks/useApiQuery';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('../components/dashboard/KPICard', () => ({ default: ({ title, value }: { title: string; value: string | number }) => <div>{title}:{String(value)}</div> }));
vi.mock('../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));

function queryResult() {
  return { data: { data: [], summary: {} }, isLoading: false, isError: false, refetch: vi.fn() };
}

describe('IPDReports selected date range', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue(queryResult() as never);
  });

  it('passes the selected From/To dates to the active admissions report', async () => {
    render(<IPDReports />);

    fireEvent.click(screen.getByRole('button', { name: 'ipdReports.tabs.admissions' }));
    fireEvent.change(screen.getByLabelText('Report from date'), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText('Report to date'), { target: { value: '2026-07-10' } });

    await waitFor(() => {
      expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]) === '/api/ipd-reports/admissions?from=2026-07-01&to=2026-07-10')).toBe(true);
    });
  });
});
