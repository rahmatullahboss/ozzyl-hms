import * as fs from 'fs';

const filePath = 'src/routes/tenant/reception.ts';
let content = fs.readFileSync(filePath, 'utf-8');

const targetStr = `  const db = getDb(c.env.DB);

  // ⚡ BOLT OPTIMIZATION:
  // Replaced Promise.all() with db.$client.batch() for patient context drawer fetch.
  // Why: Promise.all() sends 11 separate HTTP network requests to Cloudflare D1.
  //      db.$client.batch() sends a single network request containing all 11 queries.
  // Impact: Eliminates 10 network round-trips, significantly reducing latency when opening the patient context drawer.
  let batchResults;
  try {
    batchResults = await db.$client.batch([
      db.$client.prepare(\`
        SELECT id, patient_code, name, mobile, age, gender, date_of_birth, address
        FROM patients
        WHERE tenant_id = ? AND id = ?
      \`).bind(tenantId, patientId),
      db.$client.prepare(\`
        SELECT v.id, v.visit_no, v.visit_type, v.visit_date, v.status, v.doctor_id, d.name AS doctor_name
        FROM visits v
        LEFT JOIN doctors d ON d.id = v.doctor_id AND d.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.patient_id = ?
        ORDER BY v.created_at DESC
        LIMIT 8
      \`).bind(tenantId, patientId),
      db.$client.prepare(\`
        SELECT b.id, b.invoice_no, b.visit_id,
               COALESCE(b.total, 0) AS total_amount,
               COALESCE(b.paid, 0) AS paid_amount,
               COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) AS due,
               b.status, b.created_at,
               COALESCE(b.test_bill, 0) AS test_bill,
               COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
               COALESCE(b.operation_bill, 0) AS operation_bill,
               COALESCE(b.admission_bill, 0) AS admission_bill,
               COALESCE(b.medicine_bill, 0) AS medicine_bill,
               v.appointment_id AS visit_appointment_id
        FROM bills b
        LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
        WHERE b.tenant_id = ?
          AND b.patient_id = ?
          AND COALESCE(b.status, 'open') NOT IN ('paid', 'cancelled', 'refunded')
          AND COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) > 0
        ORDER BY b.created_at DESC
        LIMIT 50
      \`).bind(tenantId, patientId),
      db.$client.prepare(\`
        SELECT b.id, b.invoice_no, b.visit_id,
               COALESCE(b.total, 0) AS total_amount,
               COALESCE(b.paid, 0) AS paid_amount,
               COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) AS due,
               b.status, b.created_at,
               COALESCE(b.test_bill, 0) AS test_bill,
               COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
               COALESCE(b.operation_bill, 0) AS operation_bill,
               COALESCE(b.admission_bill, 0) AS admission_bill,
               COALESCE(b.medicine_bill, 0) AS medicine_bill,
               v.appointment_id AS visit_appointment_id
        FROM bills b
        LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
        WHERE b.tenant_id = ? AND b.patient_id = ?
        ORDER BY b.created_at DESC
        LIMIT 10
      \`).bind(tenantId, patientId),
      db.$client.prepare(\`
        SELECT a.id, a.admission_no, a.status, a.admission_date, a.bed_id,
               b.ward_name, b.bed_number, d.name AS doctor_name
        FROM admissions a
        LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
        LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
        WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status IN ('admitted','critical','transferred')
        ORDER BY a.admission_date DESC
        LIMIT 1
      \`).bind(tenantId, patientId),
      db.$client.prepare(\`
        SELECT a.id, a.admission_no, a.status, a.admission_date, a.discharge_date,
               b.ward_name, b.bed_number, d.name AS doctor_name
        FROM admissions a
        LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
        LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
        WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status = 'discharged'
        ORDER BY a.admission_date DESC
        LIMIT 5
      \`).bind(tenantId, patientId),
      db.$client.prepare(\`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) AS total_deposits,
          COALESCE(SUM(CASE WHEN transaction_type = 'refund' THEN amount ELSE 0 END), 0) AS total_refunds,
          COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0) AS total_adjustments
        FROM billing_deposits
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
      \`).bind(tenantId, patientId),
      db.$client.prepare(\`
        SELECT lo.id, lo.order_no, lo.status, lo.order_date,
               COUNT(loi.id) AS item_count,
               SUM(CASE WHEN COALESCE(loi.status, lo.status) IN ('completed','verified','delivered','reported') THEN 1 ELSE 0 END) AS ready_count
        FROM lab_orders lo
        LEFT JOIN lab_order_items loi ON loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
        WHERE lo.tenant_id = ? AND lo.patient_id = ?
        GROUP BY lo.id
        ORDER BY lo.order_date DESC
        LIMIT 8
      \`).bind(tenantId, patientId),
      db.$client.prepare(\`
        SELECT p.id, p.receipt_no, p.amount, p.payment_method, p.payment_type, p.date, p.created_at,
               b.invoice_no
        FROM payments p
        JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND b.patient_id = ?
        ORDER BY COALESCE(p.date, p.created_at) DESC
        LIMIT 10
      \`).bind(tenantId, patientId),
      db.$client.prepare(\`
        SELECT id, deposit_receipt_no, amount, transaction_type, payment_method, reference_bill_id, remarks, created_at
        FROM billing_deposits
        WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 10
      \`).bind(tenantId, patientId),
      db.$client.prepare(\`
        SELECT COALESCE(SUM(p.amount), 0) AS total_paid
        FROM payments p
        JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
        WHERE p.tenant_id = ? AND b.patient_id = ?
      \`).bind(tenantId, patientId),
    ]);
  } catch (error) {
    batchResults = [];
  }

  const patient = batchResults[0]?.results?.[0] as Record<string, unknown> | undefined;
  const visits = { results: batchResults[1]?.results ?? [] };
  const dueBills = { results: batchResults[2]?.results ?? [] };
  const bills = { results: batchResults[3]?.results ?? [] };
  const admission = batchResults[4]?.results?.[0] as Record<string, unknown> | undefined;
  const pastAdmissions = { results: batchResults[5]?.results ?? [] };
  const deposits = batchResults[6]?.results?.[0] as Record<string, number> | undefined;
  const labOrders = { results: batchResults[7]?.results ?? [] };
  const payments = { results: batchResults[8]?.results ?? [] };
  const depositLedger = { results: batchResults[9]?.results ?? [] };
  const totalPaidResult = batchResults[10]?.results?.[0] as Record<string, unknown> | undefined;`;

const replacement = `  const db = getDb(c.env.DB);

  // ⚡ BOLT OPTIMIZATION:
  // We use db.$client.batch() for the core required queries to eliminate round-trips.
  // For the non-critical data, we run them separately in parallel with individual .catch()
  // to preserve the original error handling, ensuring a single failed secondary query
  // doesn't crash the entire request.

  // 1. Critical core data (batched)
  const batchResults = await db.$client.batch([
    db.$client.prepare(\`
      SELECT id, patient_code, name, mobile, age, gender, date_of_birth, address
      FROM patients
      WHERE tenant_id = ? AND id = ?
    \`).bind(tenantId, patientId),
    db.$client.prepare(\`
      SELECT v.id, v.visit_no, v.visit_type, v.visit_date, v.status, v.doctor_id, d.name AS doctor_name
      FROM visits v
      LEFT JOIN doctors d ON d.id = v.doctor_id AND d.tenant_id = v.tenant_id
      WHERE v.tenant_id = ? AND v.patient_id = ?
      ORDER BY v.created_at DESC
      LIMIT 8
    \`).bind(tenantId, patientId),
    db.$client.prepare(\`
      SELECT b.id, b.invoice_no, b.visit_id,
             COALESCE(b.total, 0) AS total_amount,
             COALESCE(b.paid, 0) AS paid_amount,
             COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) AS due,
             b.status, b.created_at,
             COALESCE(b.test_bill, 0) AS test_bill,
             COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
             COALESCE(b.operation_bill, 0) AS operation_bill,
             COALESCE(b.admission_bill, 0) AS admission_bill,
             COALESCE(b.medicine_bill, 0) AS medicine_bill,
             v.appointment_id AS visit_appointment_id
      FROM bills b
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        AND b.patient_id = ?
        AND COALESCE(b.status, 'open') NOT IN ('paid', 'cancelled', 'refunded')
        AND COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) > 0
      ORDER BY b.created_at DESC
      LIMIT 50
    \`).bind(tenantId, patientId),
    db.$client.prepare(\`
      SELECT b.id, b.invoice_no, b.visit_id,
             COALESCE(b.total, 0) AS total_amount,
             COALESCE(b.paid, 0) AS paid_amount,
             COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) AS due,
             b.status, b.created_at,
             COALESCE(b.test_bill, 0) AS test_bill,
             COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
             COALESCE(b.operation_bill, 0) AS operation_bill,
             COALESCE(b.admission_bill, 0) AS admission_bill,
             COALESCE(b.medicine_bill, 0) AS medicine_bill,
             v.appointment_id AS visit_appointment_id
      FROM bills b
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      WHERE b.tenant_id = ? AND b.patient_id = ?
      ORDER BY b.created_at DESC
      LIMIT 10
    \`).bind(tenantId, patientId),
    db.$client.prepare(\`
      SELECT a.id, a.admission_no, a.status, a.admission_date, a.bed_id,
             b.ward_name, b.bed_number, d.name AS doctor_name
      FROM admissions a
      LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
      LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status IN ('admitted','critical','transferred')
      ORDER BY a.admission_date DESC
      LIMIT 1
    \`).bind(tenantId, patientId),
  ]);

  const patient = batchResults[0]?.results?.[0] as Record<string, unknown> | undefined;
  const visits = { results: batchResults[1]?.results ?? [] };
  const dueBills = { results: batchResults[2]?.results ?? [] };
  const bills = { results: batchResults[3]?.results ?? [] };
  const admission = batchResults[4]?.results?.[0] as Record<string, unknown> | undefined;

  // 2. Non-critical secondary queries (parallel, with fallback error handling)
  const [pastAdmissions, deposits, labOrders, payments, depositLedger, totalPaidResult] = await Promise.all([
    c.env.DB.prepare(\`
      SELECT a.id, a.admission_no, a.status, a.admission_date, a.discharge_date,
             b.ward_name, b.bed_number, d.name AS doctor_name
      FROM admissions a
      LEFT JOIN beds b ON b.id = a.bed_id AND b.tenant_id = a.tenant_id
      LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      WHERE a.tenant_id = ? AND a.patient_id = ? AND a.status = 'discharged'
      ORDER BY a.admission_date DESC
      LIMIT 5
    \`).bind(tenantId, patientId).all().catch(() => ({ results: [] })),
    c.env.DB.prepare(\`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) AS total_deposits,
        COALESCE(SUM(CASE WHEN transaction_type = 'refund' THEN amount ELSE 0 END), 0) AS total_refunds,
        COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0) AS total_adjustments
      FROM billing_deposits
      WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
    \`).bind(tenantId, patientId).first<Record<string, number>>(),
    c.env.DB.prepare(\`
      SELECT lo.id, lo.order_no, lo.status, lo.order_date,
             COUNT(loi.id) AS item_count,
             SUM(CASE WHEN COALESCE(loi.status, lo.status) IN ('completed','verified','delivered','reported') THEN 1 ELSE 0 END) AS ready_count
      FROM lab_orders lo
      LEFT JOIN lab_order_items loi ON loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
      WHERE lo.tenant_id = ? AND lo.patient_id = ?
      GROUP BY lo.id
      ORDER BY lo.order_date DESC
      LIMIT 8
    \`).bind(tenantId, patientId).all().catch(() => ({ results: [] })),
    c.env.DB.prepare(\`
      SELECT p.id, p.receipt_no, p.amount, p.payment_method, p.payment_type, p.date, p.created_at,
             b.invoice_no
      FROM payments p
      JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND b.patient_id = ?
      ORDER BY COALESCE(p.date, p.created_at) DESC
      LIMIT 10
    \`).bind(tenantId, patientId).all().catch(() => ({ results: [] })),
    c.env.DB.prepare(\`
      SELECT id, deposit_receipt_no, amount, transaction_type, payment_method, reference_bill_id, remarks, created_at
      FROM billing_deposits
      WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
      ORDER BY created_at DESC
      LIMIT 10
    \`).bind(tenantId, patientId).all().catch(() => ({ results: [] })),
    c.env.DB.prepare(\`
      SELECT COALESCE(SUM(p.amount), 0) AS total_paid
      FROM payments p
      JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? AND b.patient_id = ?
    \`).bind(tenantId, patientId).first<Record<string, unknown>>().catch(() => ({ total_paid: 0 })),
  ]);`;

if (content.includes(targetStr)) {
  content = content.replace(targetStr, replacement);
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log('Successfully replaced the block');
} else {
  console.log('Could not find the target block');
}
