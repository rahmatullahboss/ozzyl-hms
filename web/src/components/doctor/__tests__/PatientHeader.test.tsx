import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PatientHeader } from '../PatientHeader';
import type { QueueItem } from '../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));

const basePatient: QueueItem = {
  id: 1,
  patient_id: 100,
  token_no: 5,
  appt_time: '2026-05-26T10:00:00Z',
  visit_type: 'new_patient',
  status: 'in_progress',
  patient_name: 'Rahim Uddin',
  patient_code: 'P-00100',
  patient_mobile: '01712345678',
  patient_age: 45,
  gender: 'Male',
};

describe('PatientHeader', () => {
  it('renders patient basic info (name, age, gender, ID)', () => {
    render(<PatientHeader patient={basePatient} />);

    expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('Male')).toBeInTheDocument();
    expect(screen.getByText(/45\s*yrs/)).toBeInTheDocument();
    expect(screen.getByText('P-00100')).toBeInTheDocument();
    expect(screen.getByText('01712345678')).toBeInTheDocument();
  });

  it('renders token number and visit type', () => {
    render(<PatientHeader patient={basePatient} />);

    expect(screen.getByText(/#Token 5/)).toBeInTheDocument();
    expect(screen.getByText('New Patient')).toBeInTheDocument();
  });

  it('renders allergy badge when allergies exist', () => {
    const patient: QueueItem = {
      ...basePatient,
      allergy_count: 2,
      allergy_summary: 'Penicillin, Aspirin',
    };
    render(<PatientHeader patient={patient} />);

    expect(screen.getByText('ALLERGY')).toBeInTheDocument();
    expect(screen.getByText(/Penicillin, Aspirin/)).toBeInTheDocument();
  });

  it('renders allergy badge when allergy_count > 0 even without summary', () => {
    const patient: QueueItem = {
      ...basePatient,
      allergy_count: 3,
      allergy_summary: null,
    };
    render(<PatientHeader patient={patient} />);

    expect(screen.getByText('ALLERGY')).toBeInTheDocument();
  });

  it('renders chronic disease badges', () => {
    render(
      <PatientHeader
        patient={basePatient}
        riskFactors={{
          isDiabetic: true,
          isHypertensive: true,
          hasCKD: true,
          hasAsthma: true,
          hasHeartDisease: true,
        }}
      />,
    );

    expect(screen.getByText('Diabetic')).toBeInTheDocument();
    expect(screen.getByText('Hypertensive')).toBeInTheDocument();
    expect(screen.getByText('CKD')).toBeInTheDocument();
    expect(screen.getByText('Asthma')).toBeInTheDocument();
    expect(screen.getByText('Heart Disease')).toBeInTheDocument();
  });

  it('renders pregnant badge', () => {
    render(
      <PatientHeader
        patient={{ ...basePatient, gender: 'Female' }}
        riskFactors={{ isPregnant: true }}
      />,
    );

    expect(screen.getByText('Pregnant')).toBeInTheDocument();
  });

  it('renders child badge for age < 12', () => {
    const child: QueueItem = { ...basePatient, patient_age: 8 };
    render(<PatientHeader patient={child} />);

    expect(screen.getByText('Child')).toBeInTheDocument();
  });

  it('renders elderly badge for age > 65', () => {
    const elderly: QueueItem = { ...basePatient, patient_age: 72 };
    render(<PatientHeader patient={elderly} />);

    expect(screen.getByText('Elderly')).toBeInTheDocument();
  });

  it('renders no badges when no risk factors', () => {
    const patient: QueueItem = { ...basePatient, allergy_count: 0, allergy_summary: null };
    render(<PatientHeader patient={patient} />);

    expect(screen.queryByTestId('risk-badges')?.children).toHaveLength(0);
  });

  it('renders blood group when provided', () => {
    render(<PatientHeader patient={basePatient} bloodGroup="O+" />);

    expect(screen.getByText('O+')).toBeInTheDocument();
  });
});
