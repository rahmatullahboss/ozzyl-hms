import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TransposedVitalsTable from './TransposedVitalsTable';
import type { Vital } from './TransposedVitalsTable';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }),
}));

const normalVitals: Vital[] = [
  {
    id: 1,
    temperature: 36.8,
    pulse: 72,
    systolic: 120,
    diastolic: 80,
    spo2: 98,
    respiratory_rate: 16,
    weight: 70,
    bmi: 24.2,
    blood_sugar: 100,
    pain_scale: 2,
    recorded_at: '2026-05-15T10:30:00Z',
  },
  {
    id: 2,
    temperature: 37.0,
    pulse: 80,
    systolic: 125,
    diastolic: 82,
    spo2: 97,
    respiratory_rate: 18,
    weight: 70.5,
    bmi: 24.4,
    blood_sugar: 110,
    pain_scale: 1,
    recorded_at: '2026-05-14T08:00:00Z',
  },
  {
    id: 3,
    temperature: 36.5,
    pulse: 68,
    systolic: 118,
    diastolic: 78,
    spo2: 99,
    respiratory_rate: 14,
    recorded_at: '2026-05-13T14:00:00Z',
  },
];

const criticalVitals: Vital[] = [
  {
    id: 10,
    temperature: 39.5,
    pulse: 130,
    systolic: 190,
    diastolic: 125,
    spo2: 85,
    respiratory_rate: 32,
    recorded_at: '2026-05-15T10:30:00Z',
  },
];

describe('TransposedVitalsTable', () => {
  it('renders the table with metric row headers', () => {
    render(<TransposedVitalsTable vitals={normalVitals} />);
    expect(screen.getByText('BP')).toBeInTheDocument();
    expect(screen.getByText('Heart Rate')).toBeInTheDocument();
    expect(screen.getByText('Temperature')).toBeInTheDocument();
    expect(screen.getByText('SpO\u2082')).toBeInTheDocument();
    expect(screen.getByText('Resp. Rate')).toBeInTheDocument();
    expect(screen.getByText('Weight')).toBeInTheDocument();
    expect(screen.getByText('BMI')).toBeInTheDocument();
    expect(screen.getByText('Blood Sugar')).toBeInTheDocument();
    expect(screen.getByText('Pain Scale')).toBeInTheDocument();
  });

  it('renders timestamp column headers (most recent first)', () => {
    render(<TransposedVitalsTable vitals={normalVitals} />);
    const headers = screen.getAllByTestId(/^timestamp-/);
    expect(headers.length).toBe(3);
    expect(headers[0]).toHaveTextContent(/15 May/);
  });

  it('displays BP values in transposed format', () => {
    render(<TransposedVitalsTable vitals={normalVitals} />);
    expect(screen.getByText('120/80')).toBeInTheDocument();
    expect(screen.getByText('125/82')).toBeInTheDocument();
    expect(screen.getByText('118/78')).toBeInTheDocument();
  });

  it('displays heart rate values with bpm suffix', () => {
    render(<TransposedVitalsTable vitals={normalVitals} />);
    expect(screen.getByText('72 bpm')).toBeInTheDocument();
    expect(screen.getByText('80 bpm')).toBeInTheDocument();
    expect(screen.getByText('68 bpm')).toBeInTheDocument();
  });

  it('displays temperature values with degree suffix', () => {
    render(<TransposedVitalsTable vitals={normalVitals} />);
    expect(screen.getByText('36.8\u00b0C')).toBeInTheDocument();
    expect(screen.getByText('37.0\u00b0C')).toBeInTheDocument();
    expect(screen.getByText('36.5\u00b0C')).toBeInTheDocument();
  });

  it('displays SpO2 values', () => {
    render(<TransposedVitalsTable vitals={normalVitals} />);
    expect(screen.getByText('98%')).toBeInTheDocument();
    expect(screen.getByText('97%')).toBeInTheDocument();
    expect(screen.getByText('99%')).toBeInTheDocument();
  });

  it('shows em dash for missing values', () => {
    const sparseVitals: Vital[] = [
      { id: 1, recorded_at: '2026-05-15T10:30:00Z', pulse: 72 },
    ];
    const { container } = render(<TransposedVitalsTable vitals={sparseVitals} />);
    // Pulse should show value
    expect(screen.getByText('72 bpm')).toBeInTheDocument();
    // BP row should not show any BP value since systolic/diastolic are missing
    expect(screen.queryByText(/\d+\/\d+/)).not.toBeInTheDocument();
    // There should be 9 metric rows, 8 of which have missing values (only pulse has value)
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(9);
  });

  it('applies green color for normal BP', () => {
    render(<TransposedVitalsTable vitals={[{ id: 1, systolic: 120, diastolic: 80, recorded_at: '2026-05-15T10:30:00Z' }]} />);
    const bpCell = screen.getByText('120/80');
    expect(bpCell.className).toMatch(/emerald/);
  });

  it('applies amber color for elevated BP (130-139/80-89)', () => {
    render(<TransposedVitalsTable vitals={[{ id: 1, systolic: 135, diastolic: 85, recorded_at: '2026-05-15T10:30:00Z' }]} />);
    const bpCell = screen.getByText('135/85');
    expect(bpCell.className).toMatch(/amber/);
  });

  it('applies orange color for high BP (140-179/90-119)', () => {
    render(<TransposedVitalsTable vitals={[{ id: 1, systolic: 150, diastolic: 95, recorded_at: '2026-05-15T10:30:00Z' }]} />);
    const bpCell = screen.getByText('150/95');
    expect(bpCell.className).toMatch(/orange/);
  });

  it('applies red color for critical BP (>=180/>=120)', () => {
    render(<TransposedVitalsTable vitals={criticalVitals} />);
    const bpCell = screen.getByText('190/125');
    expect(bpCell.className).toMatch(/red/);
  });

  it('applies amber color for low heart rate (<60)', () => {
    render(<TransposedVitalsTable vitals={[{ id: 1, pulse: 50, recorded_at: '2026-05-15T10:30:00Z' }]} />);
    const hrCell = screen.getByText('50 bpm');
    expect(hrCell.className).toMatch(/amber/);
  });

  it('applies amber color for high heart rate (>100)', () => {
    render(<TransposedVitalsTable vitals={[{ id: 1, pulse: 110, recorded_at: '2026-05-15T10:30:00Z' }]} />);
    const hrCell = screen.getByText('110 bpm');
    expect(hrCell.className).toMatch(/amber/);
  });

  it('applies red color for critical heart rate (<40 or >120)', () => {
    render(<TransposedVitalsTable vitals={criticalVitals} />);
    const hrCell = screen.getByText('130 bpm');
    expect(hrCell.className).toMatch(/red/);
  });

  it('applies red color for high temperature (>=39)', () => {
    render(<TransposedVitalsTable vitals={criticalVitals} />);
    const tempCell = screen.getByText('39.5\u00b0C');
    expect(tempCell.className).toMatch(/red/);
  });

  it('applies amber color for mild fever (37.3-38.9)', () => {
    render(<TransposedVitalsTable vitals={[{ id: 1, temperature: 38.0, recorded_at: '2026-05-15T10:30:00Z' }]} />);
    const tempCell = screen.getByText('38.0\u00b0C');
    expect(tempCell.className).toMatch(/amber/);
  });

  it('applies red color for low SpO2 (<90)', () => {
    render(<TransposedVitalsTable vitals={criticalVitals} />);
    const spo2Cell = screen.getByText('85%');
    expect(spo2Cell.className).toMatch(/red/);
  });

  it('applies amber color for SpO2 90-94%', () => {
    render(<TransposedVitalsTable vitals={[{ id: 1, spo2: 92, recorded_at: '2026-05-15T10:30:00Z' }]} />);
    const spo2Cell = screen.getByText('92%');
    expect(spo2Cell.className).toMatch(/amber/);
  });

  it('applies amber color for elevated respiratory rate (21-29)', () => {
    render(<TransposedVitalsTable vitals={[{ id: 1, respiratory_rate: 25, recorded_at: '2026-05-15T10:30:00Z' }]} />);
    const rrCell = screen.getByText('25/min');
    expect(rrCell.className).toMatch(/amber/);
  });

  it('applies red color for high respiratory rate (>=30)', () => {
    render(<TransposedVitalsTable vitals={criticalVitals} />);
    const rrCell = screen.getByText('32/min');
    expect(rrCell.className).toMatch(/red/);
  });

  it('limits columns to maxColumns (default 6)', () => {
    const manyVitals: Vital[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      pulse: 70 + i,
      recorded_at: `2026-05-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
    }));
    render(<TransposedVitalsTable vitals={manyVitals} />);
    const headers = screen.getAllByTestId(/^timestamp-/);
    expect(headers.length).toBe(6);
  });

  it('respects custom maxColumns', () => {
    const manyVitals: Vital[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      pulse: 70 + i,
      recorded_at: `2026-05-${String(10 + i).padStart(2, '0')}T10:00:00Z`,
    }));
    render(<TransposedVitalsTable vitals={manyVitals} maxColumns={3} />);
    const headers = screen.getAllByTestId(/^timestamp-/);
    expect(headers.length).toBe(3);
  });

  it('renders empty state when no vitals', () => {
    render(<TransposedVitalsTable vitals={[]} />);
    expect(screen.getByText('No vitals recorded')).toBeInTheDocument();
  });

  it('renders table with scrollable container', () => {
    const { container } = render(<TransposedVitalsTable vitals={normalVitals} />);
    const scrollWrapper = container.querySelector('.overflow-x-auto');
    expect(scrollWrapper).toBeInTheDocument();
  });

  it('displays weight and BMI values', () => {
    render(<TransposedVitalsTable vitals={normalVitals} />);
    expect(screen.getByText('70 kg')).toBeInTheDocument();
    expect(screen.getByText('24.2')).toBeInTheDocument();
  });

  it('displays blood sugar values', () => {
    render(<TransposedVitalsTable vitals={normalVitals} />);
    expect(screen.getByText('100 mg/dL')).toBeInTheDocument();
    expect(screen.getByText('110 mg/dL')).toBeInTheDocument();
  });

  it('displays pain scale values', () => {
    render(<TransposedVitalsTable vitals={normalVitals} />);
    expect(screen.getByText('2/10')).toBeInTheDocument();
    expect(screen.getByText('1/10')).toBeInTheDocument();
  });
});
