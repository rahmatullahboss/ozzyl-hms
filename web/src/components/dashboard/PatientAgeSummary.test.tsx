import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PatientAgeAnalyticsResponse } from '../../types/executiveDashboard';
import PatientAgeSummary from './PatientAgeSummary';

const data: PatientAgeAnalyticsResponse = {
  period: { preset: '7d', startDate: '2026-07-21', endDate: '2026-07-27', label: 'Selected period' },
  metadata: {
    contractVersion: 'patient-age-at-service-v1',
    grain: 'age_bucket',
    ageBasis: 'completed_years_at_service_date',
    dateBasis: 'service_date',
    timezone: 'Asia/Dhaka',
    moneyUnit: 'major',
    currencyCode: 'BDT',
    averageBillDenominator: 'unique_bills',
    repeatVisitRateNumerator: 'patients_with_multiple_visits',
    repeatVisitRateDenominator: 'unique_patients',
  },
  rows: [
    { bucket: '0_5', label: '0–5 years', uniquePatients: 2, visits: 3, admissions: 1, services: 4, billCount: 2, collection: 1000, averageBill: 500, repeatPatients: 1, repeatVisitRate: 50, patientShare: 40 },
    { bucket: '6_17', label: '6–17 years', uniquePatients: 0, visits: 0, admissions: 0, services: 0, billCount: 0, collection: 0, averageBill: 0, repeatPatients: 0, repeatVisitRate: 0, patientShare: 0 },
    { bucket: '18_30', label: '18–30 years', uniquePatients: 3, visits: 4, admissions: 0, services: 6, billCount: 3, collection: 1500, averageBill: 500, repeatPatients: 1, repeatVisitRate: 33.33, patientShare: 60 },
    { bucket: '31_45', label: '31–45 years', uniquePatients: 0, visits: 0, admissions: 0, services: 0, billCount: 0, collection: 0, averageBill: 0, repeatPatients: 0, repeatVisitRate: 0, patientShare: 0 },
    { bucket: '46_60', label: '46–60 years', uniquePatients: 0, visits: 0, admissions: 0, services: 0, billCount: 0, collection: 0, averageBill: 0, repeatPatients: 0, repeatVisitRate: 0, patientShare: 0 },
    { bucket: '61_plus', label: '61+ years', uniquePatients: 0, visits: 0, admissions: 0, services: 0, billCount: 0, collection: 0, averageBill: 0, repeatPatients: 0, repeatVisitRate: 0, patientShare: 0 },
    { bucket: 'unknown', label: 'Unknown age', uniquePatients: 0, visits: 0, admissions: 0, services: 0, billCount: 0, collection: 0, averageBill: 0, repeatPatients: 0, repeatVisitRate: 0, patientShare: 0 },
  ],
  totals: { uniquePatients: 5, visits: 7, admissions: 1, services: 10, billCount: 5, collection: 2500, averageBill: 500, repeatPatients: 2, repeatVisitRate: 40, patientShare: 100 },
  warnings: ['Collection is attributed from bill paid totals to the invoice service date; payment-date allocation is not used.'],
};

describe('PatientAgeSummary', () => {
  it('renders all buckets in stable order with count and textual share', () => {
    render(<PatientAgeSummary data={data} loading={false} error={false} onRetry={vi.fn()} onBucketSelect={vi.fn()} />);
    const buttons = screen.getAllByRole('button', { name: /Open .* age details/i });
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Open 0–5 years age details',
      'Open 6–17 years age details',
      'Open 18–30 years age details',
      'Open 31–45 years age details',
      'Open 46–60 years age details',
      'Open 61+ years age details',
      'Open Unknown age age details',
    ]);
    expect(screen.getByText('2 patients · 40%')).toBeInTheDocument();
    expect(screen.getByTestId('patient-age-share-0_5')).toHaveStyle({ width: '40%' });
  });

  it('shows unique patients, visits, services, collection, and average bill', () => {
    render(<PatientAgeSummary data={data} loading={false} error={false} onRetry={vi.fn()} onBucketSelect={vi.fn()} />);
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText(/BDT\s*2,500/)).toBeInTheDocument();
    expect(screen.getAllByText(/BDT\s*500/).length).toBeGreaterThan(0);
  });

  it('surfaces the unknown DOB warning', () => {
    render(<PatientAgeSummary data={{ ...data, warnings: [...data.warnings, 'Some activity is grouped under Unknown age because date of birth is missing, invalid, or after the service date.'] }} loading={false} error={false} onRetry={vi.fn()} onBucketSelect={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unknown age');
  });

  it('calls the selected bucket callback', () => {
    const onBucketSelect = vi.fn();
    render(<PatientAgeSummary data={data} loading={false} error={false} onRetry={vi.fn()} onBucketSelect={onBucketSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open 18–30 years age details' }));
    expect(onBucketSelect).toHaveBeenCalledWith('18_30');
  });

  it('renders loading, error with retry, empty, and unavailable states', () => {
    const onRetry = vi.fn();
    const { rerender } = render(<PatientAgeSummary loading data={undefined} error={false} onRetry={onRetry} onBucketSelect={vi.fn()} />);
    expect(screen.getByLabelText('Loading patient age analytics')).toBeInTheDocument();

    rerender(<PatientAgeSummary loading={false} data={undefined} error onRetry={onRetry} onBucketSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry patient age analytics' }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<PatientAgeSummary loading={false} data={{ ...data, totals: { ...data.totals, uniquePatients: 0 }, rows: data.rows.map((row) => ({ ...row, uniquePatients: 0 })) }} error={false} onRetry={onRetry} onBucketSelect={vi.fn()} />);
    expect(screen.getByText('No patient activity was found for this period.')).toBeInTheDocument();

    rerender(<PatientAgeSummary loading={false} data={undefined} error={false} onRetry={onRetry} onBucketSelect={vi.fn()} />);
    expect(screen.getByText('Patient age analytics is unavailable.')).toBeInTheDocument();
  });
});
