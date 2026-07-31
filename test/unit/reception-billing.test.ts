import { describe, expect, it } from 'vitest';

import { buildCheckedInVisit } from '../../web/src/lib/receptionBilling';

describe('reception billing helpers', () => {
  const appointment = {
    id: 101,
    patient_id: 202,
    patient_name: 'Test Patient',
    patient_code: 'P-202',
    patient_mobile: '01700000000',
    doctor_id: 303,
    doctor_name: 'Dr Test',
  };

  it('keeps check-in visit out of the doctor room when sendToRoom is false', () => {
    const visit = buildCheckedInVisit({ appointment, visitId: 404, sentToRoom: false });

    expect(visit).toMatchObject({
      id: 404,
      appointment_id: appointment.id,
      patient_id: appointment.patient_id,
      doctor_id: appointment.doctor_id,
      status: 'initiated',
    });
  });

  it('marks check-in visit as engaged only when sendToRoom is true', () => {
    const visit = buildCheckedInVisit({ appointment, visitId: 405, sentToRoom: true });

    expect(visit?.status).toBe('engaged');
  });
});
