import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LabFlowsheet from './LabFlowsheet';
import type { LabResult } from './LabFlowsheet';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }),
}));

const normalResults: LabResult[] = [
  { test_name: 'Hemoglobin', result_value: 14.2, unit: 'g/dL', normal_range: '12.0-16.0', abnormal_flag: 'normal', collected_at: '2026-05-15' },
  { test_name: 'Hemoglobin', result_value: 13.8, unit: 'g/dL', normal_range: '12.0-16.0', abnormal_flag: 'normal', collected_at: '2026-05-10' },
  { test_name: 'WBC', result_value: 7.5, unit: 'x10^3/uL', normal_range: '4.0-11.0', abnormal_flag: 'normal', collected_at: '2026-05-15' },
  { test_name: 'WBC', result_value: 8.2, unit: 'x10^3/uL', normal_range: '4.0-11.0', abnormal_flag: 'normal', collected_at: '2026-05-10' },
  { test_name: 'Platelets', result_value: 250, unit: 'x10^3/uL', normal_range: '150-400', abnormal_flag: 'normal', collected_at: '2026-05-15' },
];

const abnormalResults: LabResult[] = [
  { test_name: 'Hemoglobin', result_value: 14.2, unit: 'g/dL', normal_range: '12.0-16.0', abnormal_flag: 'normal', collected_at: '2026-05-15' },
  { test_name: 'Hemoglobin', result_value: 10.5, unit: 'g/dL', normal_range: '12.0-16.0', abnormal_flag: 'low', collected_at: '2026-05-10' },
  { test_name: 'WBC', result_value: 15.0, unit: 'x10^3/uL', normal_range: '4.0-11.0', abnormal_flag: 'high', collected_at: '2026-05-15' },
  { test_name: 'WBC', result_value: 7.5, unit: 'x10^3/uL', normal_range: '4.0-11.0', abnormal_flag: 'normal', collected_at: '2026-05-10' },
];

const criticalResults: LabResult[] = [
  { test_name: 'Potassium', result_value: 6.8, unit: 'mEq/L', normal_range: '3.5-5.0', abnormal_flag: 'critical_high', collected_at: '2026-05-15' },
  { test_name: 'Potassium', result_value: 4.2, unit: 'mEq/L', normal_range: '3.5-5.0', abnormal_flag: 'normal', collected_at: '2026-05-10' },
  { test_name: 'Platelets', result_value: 30, unit: 'x10^3/uL', normal_range: '150-400', abnormal_flag: 'critical_low', collected_at: '2026-05-15' },
];

describe('LabFlowsheet', () => {
  it('renders the table with test names as rows', () => {
    render(<LabFlowsheet results={normalResults} />);
    expect(screen.getByText('Hemoglobin')).toBeInTheDocument();
    expect(screen.getByText('WBC')).toBeInTheDocument();
    expect(screen.getByText('Platelets')).toBeInTheDocument();
  });

  it('renders date columns (most recent first)', () => {
    render(<LabFlowsheet results={normalResults} />);
    const headers = screen.getAllByTestId(/^date-col-/);
    expect(headers.length).toBe(2);
    expect(headers[0]).toHaveTextContent(/15 May/);
    expect(headers[1]).toHaveTextContent(/10 May/);
  });

  it('displays numeric result values in cells', () => {
    render(<LabFlowsheet results={normalResults} />);
    expect(screen.getByTestId('cell-Hemoglobin-2026-05-15')).toHaveTextContent('14.2');
    expect(screen.getByTestId('cell-Hemoglobin-2026-05-10')).toHaveTextContent('13.8');
    expect(screen.getByTestId('cell-WBC-2026-05-15')).toHaveTextContent('7.5');
  });

  it('shows unit alongside result value', () => {
    render(<LabFlowsheet results={normalResults} />);
    expect(screen.getByTestId('cell-Hemoglobin-2026-05-15')).toHaveTextContent('g/dL');
  });

  it('shows reference range as subtitle under test name', () => {
    render(<LabFlowsheet results={normalResults} />);
    expect(screen.getByText('12.0-16.0')).toBeInTheDocument();
    expect(screen.getByText('4.0-11.0')).toBeInTheDocument();
  });

  it('shows em dash for cells with no result on that date', () => {
    render(<LabFlowsheet results={normalResults} />);
    // Platelets only has data on 2026-05-15, not 2026-05-10
    const plateletCell = screen.getByTestId('cell-Platelets-2026-05-10');
    expect(plateletCell.textContent).toMatch(/\u2014|—/);
  });

  it('applies red color for critical_high values', () => {
    render(<LabFlowsheet results={criticalResults} />);
    const cell = screen.getByTestId('cell-Potassium-2026-05-15');
    expect(cell.className).toMatch(/red/);
  });

  it('applies red color for critical_low values', () => {
    render(<LabFlowsheet results={criticalResults} />);
    const cell = screen.getByTestId('cell-Platelets-2026-05-15');
    expect(cell.className).toMatch(/red/);
  });

  it('applies orange color for high abnormal values', () => {
    render(<LabFlowsheet results={abnormalResults} />);
    const cell = screen.getByTestId('cell-WBC-2026-05-15');
    expect(cell.className).toMatch(/orange/);
  });

  it('applies orange color for low abnormal values', () => {
    render(<LabFlowsheet results={abnormalResults} />);
    const cell = screen.getByTestId('cell-Hemoglobin-2026-05-10');
    expect(cell.className).toMatch(/orange/);
  });

  it('does not apply abnormal colors for normal values', () => {
    render(<LabFlowsheet results={normalResults} />);
    const cell = screen.getByTestId('cell-Hemoglobin-2026-05-15');
    expect(cell.className).not.toMatch(/red/);
    expect(cell.className).not.toMatch(/orange/);
  });

  it('renders trend indicator for each test row', () => {
    render(<LabFlowsheet results={normalResults} />);
    expect(screen.getByTestId('trend-Hemoglobin')).toBeInTheDocument();
    expect(screen.getByTestId('trend-WBC')).toBeInTheDocument();
  });

  it('shows upward trend arrow when values are increasing', () => {
    const increasingResults: LabResult[] = [
      { test_name: 'Glucose', result_value: 200, unit: 'mg/dL', normal_range: '70-100', abnormal_flag: 'high', collected_at: '2026-05-15' },
      { test_name: 'Glucose', result_value: 150, unit: 'mg/dL', normal_range: '70-100', abnormal_flag: 'high', collected_at: '2026-05-10' },
      { test_name: 'Glucose', result_value: 100, unit: 'mg/dL', normal_range: '70-100', abnormal_flag: 'normal', collected_at: '2026-05-05' },
    ];
    render(<LabFlowsheet results={increasingResults} />);
    const trend = screen.getByTestId('trend-Glucose');
    expect(trend.textContent).toMatch(/\u2191/);
  });

  it('shows downward trend arrow when values are decreasing', () => {
    const decreasingResults: LabResult[] = [
      { test_name: 'Hemoglobin', result_value: 10, unit: 'g/dL', normal_range: '12.0-16.0', abnormal_flag: 'low', collected_at: '2026-05-15' },
      { test_name: 'Hemoglobin', result_value: 12, unit: 'g/dL', normal_range: '12.0-16.0', abnormal_flag: 'normal', collected_at: '2026-05-10' },
      { test_name: 'Hemoglobin', result_value: 14, unit: 'g/dL', normal_range: '12.0-16.0', abnormal_flag: 'normal', collected_at: '2026-05-05' },
    ];
    render(<LabFlowsheet results={decreasingResults} />);
    const trend = screen.getByTestId('trend-Hemoglobin');
    expect(trend.textContent).toMatch(/\u2193/);
  });

  it('shows stable indicator when values are not changing', () => {
    const stableResults: LabResult[] = [
      { test_name: 'WBC', result_value: 7.5, unit: 'x10^3/uL', normal_range: '4.0-11.0', abnormal_flag: 'normal', collected_at: '2026-05-15' },
      { test_name: 'WBC', result_value: 7.5, unit: 'x10^3/uL', normal_range: '4.0-11.0', abnormal_flag: 'normal', collected_at: '2026-05-10' },
      { test_name: 'WBC', result_value: 7.5, unit: 'x10^3/uL', normal_range: '4.0-11.0', abnormal_flag: 'normal', collected_at: '2026-05-05' },
    ];
    render(<LabFlowsheet results={stableResults} />);
    const trend = screen.getByTestId('trend-WBC');
    expect(trend.textContent).toMatch(/\u2192/);
  });

  it('limits date columns to maxColumns (default 8)', () => {
    const manyDatesResults: LabResult[] = Array.from({ length: 10 }, (_, i) => ({
      test_name: 'Glucose',
      result_value: 100 + i,
      unit: 'mg/dL',
      normal_range: '70-100',
      abnormal_flag: 'normal' as const,
      collected_at: `2026-05-${String(i + 1).padStart(2, '0')}`,
    }));
    render(<LabFlowsheet results={manyDatesResults} />);
    const headers = screen.getAllByTestId(/^date-col-/);
    expect(headers.length).toBe(8);
  });

  it('respects custom maxColumns', () => {
    const manyDatesResults: LabResult[] = Array.from({ length: 10 }, (_, i) => ({
      test_name: 'Glucose',
      result_value: 100 + i,
      unit: 'mg/dL',
      normal_range: '70-100',
      abnormal_flag: 'normal' as const,
      collected_at: `2026-05-${String(i + 1).padStart(2, '0')}`,
    }));
    render(<LabFlowsheet results={manyDatesResults} maxColumns={3} />);
    const headers = screen.getAllByTestId(/^date-col-/);
    expect(headers.length).toBe(3);
  });

  it('renders empty state when no results', () => {
    render(<LabFlowsheet results={[]} />);
    expect(screen.getByText('No lab results available')).toBeInTheDocument();
  });

  it('renders table with scrollable container', () => {
    const { container } = render(<LabFlowsheet results={normalResults} />);
    const scrollWrapper = container.querySelector('.overflow-x-auto');
    expect(scrollWrapper).toBeInTheDocument();
  });

  it('handles string result values', () => {
    const stringResults: LabResult[] = [
      { test_name: 'Blood Group', result_value: 'A+', abnormal_flag: 'normal', collected_at: '2026-05-15' },
    ];
    render(<LabFlowsheet results={stringResults} />);
    expect(screen.getByTestId('cell-Blood Group-2026-05-15')).toHaveTextContent('A+');
  });

  it('handles null abnormal_flag as normal', () => {
    const nullFlagResults: LabResult[] = [
      { test_name: 'Calcium', result_value: 9.5, unit: 'mg/dL', normal_range: '8.5-10.5', abnormal_flag: null, collected_at: '2026-05-15' },
    ];
    render(<LabFlowsheet results={nullFlagResults} />);
    const cell = screen.getByTestId('cell-Calcium-2026-05-15');
    expect(cell.className).not.toMatch(/red/);
    expect(cell.className).not.toMatch(/orange/);
  });

  it('groups results by test_name correctly', () => {
    render(<LabFlowsheet results={normalResults} />);
    // Should have 3 unique test names
    const rows = screen.getAllByTestId(/^row-/);
    expect(rows.length).toBe(3);
  });
});
