import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import EmergencyAdmissionPatientEditAction from './EmergencyAdmissionPatientEditAction';

describe('EmergencyAdmissionPatientEditAction', () => {
  it('keeps patient details editing visible for emergency admissions in any status', async () => {
    const onEdit = vi.fn();
    render(
      <EmergencyAdmissionPatientEditAction
        admission={{
          patientId: 45,
          admissionType: 'emergency',
          admitSource: 'emergency',
          isEmergency: 1,
        }}
        onEdit={onEdit}
      />,
    );

    const action = screen.getByRole('button', { name: 'Edit / Complete Patient Details' });
    expect(action).toBeInTheDocument();
    await userEvent.click(action);
    expect(onEdit).toHaveBeenCalledWith(45);
  });

  it('does not add emergency-specific action to a planned admission', () => {
    render(
      <EmergencyAdmissionPatientEditAction
        admission={{
          patientId: 46,
          admissionType: 'planned',
          admitSource: 'planned',
          isEmergency: 0,
        }}
        onEdit={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Edit / Complete Patient Details' })).not.toBeInTheDocument();
  });
});
