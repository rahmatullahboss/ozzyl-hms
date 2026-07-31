import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useApiQuery } from '../../hooks/useApiQuery';
import PatientAnalytics from './PatientAnalytics';

vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderRoute(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/h/:slug/analytics/patients" element={<PatientAnalytics />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PatientAnalytics compatibility redirect', () => {
  it('redirects the tenant route to the Patients command-center workspace', async () => {
    renderRoute('/h/city-hospital/analytics/patients');
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/h/city-hospital/dashboard/v2?tab=patients');
    });
  });

  it('preserves existing period and unknown query state while forcing tab=patients', async () => {
    renderRoute('/h/city-hospital/analytics/patients?tab=money&range=custom&from=2026-07-01&to=2026-07-27&source=referral');
    await waitFor(() => {
      const location = screen.getByTestId('location');
      expect(location).toHaveTextContent('/h/city-hospital/dashboard/v2?');
      expect(location).toHaveTextContent('tab=patients');
      expect(location).toHaveTextContent('range=custom');
      expect(location).toHaveTextContent('from=2026-07-01');
      expect(location).toHaveTextContent('to=2026-07-27');
      expect(location).toHaveTextContent('source=referral');
      expect(location).not.toHaveTextContent('tab=money');
    });
  });

  it('never calls the removed patient analytics API', async () => {
    renderRoute('/h/city-hospital/analytics/patients?range=7d');
    await waitFor(() => expect(screen.getByTestId('location')).toBeInTheDocument());
    expect(useApiQuery).not.toHaveBeenCalled();
  });
});
