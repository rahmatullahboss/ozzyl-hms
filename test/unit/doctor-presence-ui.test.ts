import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const doctorCard = readFileSync(join(process.cwd(), 'web/src/components/doctor/DoctorPresenceCard.tsx'), 'utf8');
const doctorDashboard = readFileSync(join(process.cwd(), 'web/src/pages/DoctorDashboard.tsx'), 'utf8');
const receptionBoard = readFileSync(join(process.cwd(), 'web/src/components/reception/ReceptionDoctorPresenceBoard.tsx'), 'utf8');

describe('doctor presence UI integration', () => {
  it('shows doctor self-update card on doctor dashboard', () => {
    expect(doctorDashboard).toContain("import { DoctorPresenceCard }");
    expect(doctorDashboard).toContain('<DoctorPresenceCard />');
    expect(doctorCard).toContain('/api/doctor-schedule/me/presence');
    expect(doctorCard).toContain('Today\'s chamber status');
  });

  it('supports doctor arrival delay and absence status fields', () => {
    expect(doctorCard).toContain('expectedArrivalTime');
    expect(doctorCard).toContain('delayMinutes');
    expect(doctorCard).toContain('publicMessage');
    expect(doctorCard).toContain('receptionNote');
    expect(doctorCard).toContain('not_coming');
    expect(doctorCard).toContain('chamber_closed');
    expect(doctorCard).toContain('serial_stopped');
  });

  it('provides reception board and manual override endpoints', () => {
    expect(receptionBoard).toContain('/api/doctor-schedule/presence/today');
    expect(receptionBoard).toContain('/api/doctor-schedule/${vars.doctorId}/presence');
    expect(receptionBoard).toContain('Doctor availability today');
    expect(receptionBoard).toContain('Update status');
  });
});
