import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PatientEmrHeader from '../PatientEmrHeader';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown>) => opts?.defaultValue ?? k }),
}));

const basePatient = {
  id: 1,
  patient_code: 'P-001',
  name: 'John Doe',
  age: 45,
  gender: 'Male',
  blood_group: 'A+',
  mobile: '01712345678',
};

describe('PatientEmrHeader', () => {
  it('renders patient name', () => {
    render(<PatientEmrHeader patient={basePatient} />);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('renders age and gender', () => {
    render(<PatientEmrHeader patient={basePatient} />);
    expect(screen.getByText(/45y/)).toBeInTheDocument();
    expect(screen.getByText(/Male/)).toBeInTheDocument();
  });

  it('renders blood group with icon', () => {
    render(<PatientEmrHeader patient={basePatient} />);
    expect(screen.getByText('A+')).toBeInTheDocument();
  });

  it('renders patient code', () => {
    render(<PatientEmrHeader patient={basePatient} />);
    expect(screen.getByText('P-001')).toBeInTheDocument();
  });

  it('renders allergies as red badges', () => {
    const allergies = [
      { id: 1, allergen: 'Penicillin', severity: 'severe' as const, allergy_type: 'drug' },
      { id: 2, allergen: 'Peanuts', severity: 'moderate' as const, allergy_type: 'food' },
    ];
    render(<PatientEmrHeader patient={basePatient} allergies={allergies} />);
    expect(screen.getByText('Penicillin')).toBeInTheDocument();
    expect(screen.getByText('Peanuts')).toBeInTheDocument();
    const allergyBadges = screen.getAllByTestId('allergy-badge');
    expect(allergyBadges.length).toBe(2);
    allergyBadges.forEach((badge) => {
      expect(badge.className).toMatch(/red/);
    });
  });

  it('renders no allergy badges when allergies is empty', () => {
    render(<PatientEmrHeader patient={basePatient} allergies={[]} />);
    expect(screen.queryByTestId('allergy-badge')).not.toBeInTheDocument();
  });

  it('renders chronic conditions as orange badges', () => {
    render(<PatientEmrHeader patient={basePatient} chronicConditions={['Diabetes', 'Hypertension']} />);
    expect(screen.getByText('Diabetes')).toBeInTheDocument();
    expect(screen.getByText('Hypertension')).toBeInTheDocument();
    const conditionBadges = screen.getAllByTestId('chronic-badge');
    expect(conditionBadges.length).toBe(2);
    conditionBadges.forEach((badge) => {
      expect(badge.className).toMatch(/orange/);
    });
  });

  it('renders visit type badge', () => {
    render(<PatientEmrHeader patient={basePatient} visitType="OPD" />);
    expect(screen.getByText('OPD')).toBeInTheDocument();
  });

  it('renders last visit date', () => {
    render(<PatientEmrHeader patient={basePatient} lastVisitDate="2026-05-20T10:00:00Z" />);
    expect(screen.getByText(/20 May 2026/)).toBeInTheDocument();
  });

  it('renders without optional props', () => {
    render(<PatientEmrHeader patient={basePatient} />);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('P-001')).toBeInTheDocument();
    expect(screen.queryByTestId('allergy-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chronic-badge')).not.toBeInTheDocument();
  });

  it('has sticky positioning', () => {
    const { container } = render(<PatientEmrHeader patient={basePatient} />);
    const header = container.firstChild as HTMLElement;
    expect(header).toHaveAttribute('data-testid', 'patient-emr-header');
    expect(header.className).toMatch(/sticky/);
  });

  it('renders UHID when patient_code is not present', () => {
    const patient = { ...basePatient, patient_code: undefined, uhid: 'UHID-123' };
    render(<PatientEmrHeader patient={patient} />);
    expect(screen.getByText('UHID-123')).toBeInTheDocument();
  });

  it('renders patient_code when both patient_code and uhid are present', () => {
    const patient = { ...basePatient, uhid: 'UHID-123' };
    render(<PatientEmrHeader patient={patient} />);
    expect(screen.getByText('P-001')).toBeInTheDocument();
  });

  it('does not render blood group section when blood_group is missing', () => {
    const patient = { ...basePatient, blood_group: undefined };
    render(<PatientEmrHeader patient={patient} />);
    expect(screen.queryByText('A+')).not.toBeInTheDocument();
  });

  it('renders visit type badge with different types', () => {
    const { rerender } = render(<PatientEmrHeader patient={basePatient} visitType="Emergency" />);
    expect(screen.getByText('Emergency')).toBeInTheDocument();

    rerender(<PatientEmrHeader patient={basePatient} visitType="IPD" />);
    expect(screen.getByText('IPD')).toBeInTheDocument();
  });
});
