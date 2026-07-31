import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApiQuery } from '../../hooks/useApiQuery';
import QuickCodedDiagnosis from './QuickCodedDiagnosis';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

describe('QuickCodedDiagnosis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation((_key, path, options) => {
      const enabled = Boolean((options as { enabled?: boolean } | undefined)?.enabled);
      if (!enabled) return { data: null, isLoading: false } as any;
      if (path.includes('/icd10/')) {
        return {
          data: {
            Results: [{ ICD10ID: 501, ICD10Code: 'J06.9', DiseaseName: 'Acute upper respiratory infection, unspecified' }],
          },
          isLoading: false,
        } as any;
      }
      return {
        data: {
          Results: [{ id: 801, code: 'CA40.Z', title: 'Pneumonia, unspecified', is_bd_subset: 1 }],
        },
        isLoading: false,
      } as any;
    });
  });

  it('does not enable catalog search until at least two characters are entered', () => {
    render(<QuickCodedDiagnosis value={null} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Search coded diagnosis'), { target: { value: 'J' } });

    const lastCall = vi.mocked(useApiQuery).mock.calls.at(-1);
    expect(lastCall?.[2]).toMatchObject({ enabled: false });
    expect(screen.getByText('Type at least 2 characters.')).toBeInTheDocument();
  });

  it('selects a normalized ICD-10 catalog result', () => {
    const onChange = vi.fn();
    render(<QuickCodedDiagnosis value={null} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Search coded diagnosis'), { target: { value: 'J06' } });
    fireEvent.click(screen.getByRole('button', { name: /J06.9.*Acute upper respiratory infection/i }));

    expect(onChange).toHaveBeenCalledWith({
      system: 'ICD-10',
      code: 'J06.9',
      description: 'Acute upper respiratory infection, unspecified',
    });
  });

  it('switches to ICD-11 and selects its canonical code and title', () => {
    const onChange = vi.fn();
    render(<QuickCodedDiagnosis value={null} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('Diagnosis coding system'), { target: { value: 'ICD-11' } });
    fireEvent.change(screen.getByLabelText('Search coded diagnosis'), { target: { value: 'CA40' } });
    fireEvent.click(screen.getByRole('button', { name: /CA40.Z.*Pneumonia, unspecified/i }));

    expect(onChange).toHaveBeenCalledWith({
      system: 'ICD-11',
      code: 'CA40.Z',
      description: 'Pneumonia, unspecified',
    });
  });

  it('shows a selected code and lets the doctor remove it', () => {
    const onChange = vi.fn();
    render(
      <QuickCodedDiagnosis
        value={{ system: 'ICD-10', code: 'I10', description: 'Essential hypertension' }}
        onChange={onChange}
      />,
    );

    expect(screen.getByTestId('coded-diagnosis-selected')).toHaveTextContent('I10');
    expect(screen.getByText('Essential hypertension')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove coded diagnosis' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
