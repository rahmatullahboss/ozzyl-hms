export type PaidAppointmentContextItem = {
  appointmentId: number;
  doctorId: number | null;
  doctorName: string | null;
  appointmentType: string | null;
  appointmentDate: string | null;
  paidAt: string;
};

type PaidAppointmentContextRow = {
  appointment_id: number;
  doctor_id: number | null;
  doctor_name: string | null;
  appointment_type: string | null;
  appointment_date: string | null;
  paid_at: string;
};

export async function loadPaidAppointmentContext(
  d1: D1Database,
  input: { tenantId: string; patientId: number; doctorId?: number | null },
): Promise<{ selectedDoctor: PaidAppointmentContextItem | null; latestAnyDoctor: PaidAppointmentContextItem | null }> {
  const { results } = await d1.prepare(`
    /* paid_appointment_context */
    WITH positive_payment_bills AS (
      SELECT
        b.id AS bill_id,
        b.tenant_id,
        b.patient_id,
        b.visit_id,
        b.doctor_visit_bill,
        b.created_at,
        MAX(COALESCE(p.date, b.created_at)) AS paid_at
      FROM bills b
      JOIN payments p
        ON p.bill_id = b.id
       AND p.tenant_id = b.tenant_id
       AND p.amount > 0
      WHERE b.tenant_id = ?
        AND b.patient_id = ?
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      GROUP BY b.id, b.tenant_id, b.patient_id, b.visit_id, b.doctor_visit_bill, b.created_at
    ),
    appointment_links AS (
      SELECT
        ppb.bill_id,
        ppb.tenant_id,
        ppb.patient_id,
        ppb.created_at,
        ppb.paid_at,
        v.visit_date,
        v.doctor_id AS visit_doctor_id,
        COALESCE(v.appointment_id, bp.appointment_id) AS appointment_id
      FROM positive_payment_bills ppb
      LEFT JOIN visits v
        ON v.id = ppb.visit_id
       AND v.tenant_id = ppb.tenant_id
      LEFT JOIN (
        SELECT tenant_id, billed_bill_id, MAX(appointment_id) AS appointment_id
        FROM billing_provisional_items
        WHERE item_category = 'doctor_visit'
          AND appointment_id IS NOT NULL
          AND bill_status = 'finalized'
          AND COALESCE(is_active, 1) = 1
          AND cancelled_at IS NULL
        GROUP BY tenant_id, billed_bill_id
      ) bp
        ON bp.billed_bill_id = ppb.bill_id
       AND bp.tenant_id = ppb.tenant_id
      WHERE COALESCE(ppb.doctor_visit_bill, 0) > 0
         OR bp.appointment_id IS NOT NULL
         OR EXISTS (
           SELECT 1
           FROM invoice_items ii
           WHERE ii.tenant_id = ppb.tenant_id
             AND ii.bill_id = ppb.bill_id
             AND ii.item_category = 'doctor_visit'
             AND COALESCE(ii.status, 'active') <> 'cancelled'
         )
    )
    SELECT
      a.id AS appointment_id,
      COALESCE(a.doctor_id, links.visit_doctor_id) AS doctor_id,
      d.name AS doctor_name,
      a.appointment_type,
      COALESCE(a.appt_date, links.visit_date, date(links.created_at), date(links.paid_at)) AS appointment_date,
      links.paid_at
    FROM appointment_links links
    JOIN appointments a
      ON a.id = links.appointment_id
     AND a.tenant_id = links.tenant_id
     AND a.patient_id = links.patient_id
    LEFT JOIN doctors d
      ON d.id = COALESCE(a.doctor_id, links.visit_doctor_id)
     AND d.tenant_id = links.tenant_id
    ORDER BY datetime(links.paid_at) DESC, a.id DESC
    LIMIT 50
  `).bind(input.tenantId, input.patientId).all<PaidAppointmentContextRow>();

  const mapRow = (row: PaidAppointmentContextRow): PaidAppointmentContextItem => ({
    appointmentId: Number(row.appointment_id),
    doctorId: row.doctor_id == null ? null : Number(row.doctor_id),
    doctorName: row.doctor_name ?? null,
    appointmentType: row.appointment_type ?? null,
    appointmentDate: row.appointment_date ?? null,
    paidAt: String(row.paid_at),
  });

  const latestAnyDoctor = results[0] ? mapRow(results[0]) : null;
  const selectedRow = input.doctorId
    ? results.find((row) => Number(row.doctor_id) === Number(input.doctorId))
    : undefined;

  return {
    selectedDoctor: selectedRow ? mapRow(selectedRow) : null,
    latestAnyDoctor,
  };
}
