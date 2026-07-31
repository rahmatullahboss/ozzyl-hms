import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import PatientCardClaimPage from './PatientCardClaimPage';

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PatientCardClaimPage', () => {
  const originalFetch = globalThis.fetch;
  const originalLocation = window.location;
  const replace = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, replace },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('claims a hospital-created card through the patient-auth claim-card endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        user: {
          id: 77,
          name: 'Claimed User',
          email: null,
          phone: '01812345678',
          uhid: 'OZ-000998',
          emailVerified: false,
        },
      }),
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={['/patient/claim-card?uhid=OZ-000998']}>
        <Routes>
          <Route path="/patient/claim-card" element={<PatientCardClaimPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/health card uhid/i)).toHaveValue('OZ-000998');

    fireEvent.change(screen.getByLabelText(/claim code/i), { target: { value: 'C-8F4K2Q' } });
    fireEvent.change(screen.getByLabelText(/mobile number/i), { target: { value: '01812345678' } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Claimed User' } });
    fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Claim1234' } });
    fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'Claim1234' } });
    fireEvent.click(screen.getByRole('button', { name: /claim card/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/patient-auth/claim-card', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uhid: 'OZ-000998',
          claim_code: 'C-8F4K2Q',
          name: 'Claimed User',
          phone: '01812345678',
          password: 'Claim1234',
        }),
      });
    });

    expect(JSON.parse(localStorage.getItem('global_patient_user') ?? '{}')).toMatchObject({
      id: 77,
      uhid: 'OZ-000998',
    });
    expect(replace).toHaveBeenCalledWith('/patient/home');
  });
});
