import type { D1Database } from '@cloudflare/workers-types';
import { HTTPException } from 'hono/http-exception';

export async function assertNoSameDoctorVisitToday(
  db: D1Database,
  input: {
    tenantId: string;
    patientId: number;
    doctorId?: number | null;
    visitDate: string;
    excludeAppointmentId?: number | null;
    allowedExistingStatuses?: string[];
  },
): Promise<void> {
  if (!input.doctorId) return;

  const params: Array<string | number> = [
    input.tenantId,
    input.patientId,
    input.doctorId,
    input.visitDate,
  ];
  let appointmentClause = '';
  if (input.excludeAppointmentId != null) {
    appointmentClause = 'AND (appointment_id IS NULL OR appointment_id != ?)';
    params.push(input.excludeAppointmentId);
  }

  const existing = await db.prepare(`
    SELECT id, visit_no, status
    FROM visits
    WHERE tenant_id = ?
      AND patient_id = ?
      AND doctor_id = ?
      AND visit_date = ?
      ${appointmentClause}
    ORDER BY id DESC
    LIMIT 1
  `).bind(...params).first<{ id: number; visit_no: string | null; status: string | null }>();

  const status = String(existing?.status ?? '').toLowerCase();
  const allowedStatuses = new Set(['cancelled', 'returned', ...(input.allowedExistingStatuses ?? []).map((item) => item.toLowerCase())]);
  if (existing?.id && !allowedStatuses.has(status)) {
    throw new HTTPException(409, {
      message: 'Patient already has visit with same doctor today',
    });
  }
}
