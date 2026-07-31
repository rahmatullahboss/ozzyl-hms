import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import DoctorTodayBreakdownModal, { DoctorDailySummary } from './DoctorTodayBreakdownModal';

const baseDoctor: DoctorDailySummary = {
  doctor_id: 11,
  doctor_name: 'Dr. Example Three',
  patient_count: 6,
  doctor_visit_count: 6,
  doctor_visit_amount: 1800,
  test_count: 4,
  test_order_count: 4,
  test_collection_amount: 3200,
  commission_amount: 700,
};

describe('DoctorTodayBreakdownModal', () => {
  it('returns null when doctor is null', () => {
    const { container } = render(
      <DoctorTodayBreakdownModal doctor={null} today="2026-06-06" onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the doctor name in the title and the today date', () => {
    render(
      <DoctorTodayBreakdownModal doctor={baseDoctor} today="2026-06-06" onClose={() => {}} />
    );
    expect(screen.getByText('Dr. Example Three')).toBeInTheDocument();
    expect(screen.getByText(/Today — 2026-06-06/)).toBeInTheDocument();
  });

  it('shows the breakdown math for the example doctor', () => {
    render(
      <DoctorTodayBreakdownModal doctor={baseDoctor} today="2026-06-06" onClose={() => {}} />
    );
    expect(screen.getByText('Patients seen')).toBeInTheDocument();
    expect(screen.getByText('Tests ordered')).toBeInTheDocument();
    expect(screen.getByText('Revenue from patients')).toBeInTheDocument();
    expect(screen.getByText('Revenue from tests')).toBeInTheDocument();
    expect(screen.getByText('Total collection')).toBeInTheDocument();
    expect(screen.getByText('Commission paid out')).toBeInTheDocument();
    expect(screen.getByText('Net hospital income')).toBeInTheDocument();

    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('৳1,800')).toBeInTheDocument();
    expect(screen.getByText('৳3,200')).toBeInTheDocument();
    expect(screen.getByText('৳5,000')).toBeInTheDocument();
    expect(screen.getByText('৳700')).toBeInTheDocument();
    expect(screen.getByText('৳4,300')).toBeInTheDocument();
  });

  it('shows real negative net hospital income in error color, not floored at zero', () => {
    const negative: DoctorDailySummary = {
      doctor_id: 21,
      doctor_name: 'Dr. Negative',
      doctor_visit_amount: 500,
      test_collection_amount: 0,
      commission_amount: 1500,
    };

    const { container } = render(
      <DoctorTodayBreakdownModal doctor={negative} today="2026-06-06" onClose={() => {}} />
    );
    expect(screen.getByText('Dr. Negative')).toBeInTheDocument();
    expect(screen.getByText('-৳1,000')).toBeInTheDocument();
    const netValue = screen.getByText('-৳1,000');
    expect(netValue.className).toMatch(/text-\[var\(--color-error\)\]/);
    expect(container).toBeTruthy();
  });

  it('calls onClose when the user presses Escape', () => {
    const onClose = vi.fn();
    render(
      <DoctorTodayBreakdownModal doctor={baseDoctor} today="2026-06-06" onClose={onClose} />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles sparse doctor data with only name and id', () => {
    const sparse: DoctorDailySummary = {
      doctor_id: 12,
      doctor_name: 'Dr. Sparse',
    };
    render(
      <DoctorTodayBreakdownModal doctor={sparse} today="2026-06-06" onClose={() => {}} />
    );
    expect(screen.getByText('Dr. Sparse')).toBeInTheDocument();
    expect(screen.getByText('Patients seen')).toBeInTheDocument();
    expect(screen.getByText('Tests ordered')).toBeInTheDocument();
    expect(screen.getAllByText('৳0').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Net hospital income')).toBeInTheDocument();
  });
});
