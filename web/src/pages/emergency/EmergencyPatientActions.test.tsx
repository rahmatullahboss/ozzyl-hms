import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import EmergencyPatientActions from './EmergencyPatientActions';

const basePatient = {
  patient_id: 45,
  er_status: 'finalized' as const,
  profile_incomplete: true,
  active_admission_id: 73,
};

describe('EmergencyPatientActions', () => {
  it('keeps patient master editing visible after the emergency case is finalized', async () => {
    const onEdit = vi.fn();
    render(
      <EmergencyPatientActions
        patient={basePatient}
        onEdit={onEdit}
        onAdmit={vi.fn()}
        onTriage={vi.fn()}
        onFinalize={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Edit / Complete Patient Details' })).toBeInTheDocument();
    expect(screen.getByText('Incomplete details')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Admit to IPD/i })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit / Complete Patient Details' }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('shows a distinct IPD admission action for a live emergency case', () => {
    render(
      <EmergencyPatientActions
        patient={{ ...basePatient, er_status: 'triaged', active_admission_id: null }}
        onEdit={vi.fn()}
        onAdmit={vi.fn()}
        onTriage={vi.fn()}
        onFinalize={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Admit to IPD' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalize without admission' })).toBeInTheDocument();
  });

  it('recognizes a canonical-only active admission as an existing admission', () => {
    render(
      <EmergencyPatientActions
        patient={{
          ...basePatient,
          er_status: 'triaged',
          active_admission_id: null,
          active_admission_public_id: 'admission-public-73',
        }}
        onEdit={vi.fn()}
        onAdmit={vi.fn()}
        onTriage={vi.fn()}
        onFinalize={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Complete IPD admission linkage' })).toBeInTheDocument();
  });
});
