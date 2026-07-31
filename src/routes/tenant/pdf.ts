/**
 * PDF routes — Bangla-compatible HTML invoice and patient card endpoints.
 *
 * GET /api/pdf/invoice/:billingId   — Full invoice HTML (open in browser, Ctrl+P)
 * GET /api/pdf/patient-card/:id     — Patient ID card HTML
 *
 * Add ?autoprint=1 to trigger window.print() automatically after fonts load.
 *
 * Frontend usage:
 *   window.open(`/api/pdf/invoice/${billingId}?autoprint=1`, '_blank');
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { renderInvoiceHtml, renderPatientCardHtml } from '../../lib/pdf-bangla';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';


function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const ALLOWED_PDF_ROLES = ['hospital_admin', 'reception', 'doctor', 'nurse'];

const pdfRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── GET /invoice/:billId ─────────────────────────────────────────────────────
pdfRoutes.get('/invoice/:billId', async (c) => {
  const tenantId = requireTenantId(c);
  const billId = c.req.param('billId');
  const role = c.get('role');
  if (!role || !ALLOWED_PDF_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Insufficient permissions' });
  }
  const db = getDb(c.env.DB);

  try {
    // Fetch bill from the actual 'bills' table (flat category amounts)
    const bill = await db.$client.prepare(`
      SELECT b.id, b.invoice_no, b.test_bill, b.admission_bill,
             b.doctor_visit_bill, b.operation_bill, b.medicine_bill,
             b.discount, b.total, b.paid, b.due,
             b.created_at,
             p.name         AS patient_name,
             p.patient_code,
             p.mobile       AS patient_mobile,
             t.name         AS hospital_name,
             t.address      AS hospital_address,
             t.phone        AS hospital_phone
      FROM bills b
      JOIN patients p ON b.patient_id = p.id AND p.tenant_id = b.tenant_id
      JOIN tenants  t ON b.tenant_id  = t.id
      WHERE b.id = ? AND b.tenant_id = ?
    `).bind(billId, tenantId).first<{
      id: number;
      invoice_no: string | null;
      test_bill: number;
      admission_bill: number;
      doctor_visit_bill: number;
      operation_bill: number;
      medicine_bill: number;
      discount: number;
      total: number;
      paid: number;
      due: number;
      created_at: string;
      patient_name: string;
      patient_code: string;
      patient_mobile: string;
      hospital_name: string;
      hospital_address?: string;
      hospital_phone?: string;
    }>();

    if (!bill) throw new HTTPException(404, { message: 'Invoice not found' });

    // Fetch actual invoice items for detailed line-item printing
    const { results: invoiceItems } = await db.$client.prepare(`
      SELECT description, quantity, unit_price, line_total, item_category
      FROM invoice_items
      WHERE bill_id = ? AND tenant_id = ? AND COALESCE(status, 'active') = 'active'
      ORDER BY id ASC
    `).bind(billId, tenantId).all<{
      description: string | null;
      quantity: number;
      unit_price: number;
      line_total: number;
      item_category: string;
    }>();

    // Use actual line items if available, otherwise fall back to category totals
    const categoryBn: Record<string, string> = {
      test: 'ল্যাব পরীক্ষা',
      admission: 'ভর্তি ফি',
      doctor_visit: 'ডাক্তার ভিজিট',
      operation: 'অপারেশন',
      medicine: 'ঔষধ',
      service: 'সেবা',
    };

    const items = invoiceItems.length > 0
      ? invoiceItems.map(item => ({
          description: item.description ?? item.item_category,
          descriptionBn: categoryBn[item.item_category] ?? item.item_category,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          total: item.line_total,
        }))
      : [
          { key: 'test_bill' as const, en: 'Lab Tests', bn: 'ল্যাব পরীক্ষা' },
          { key: 'admission_bill' as const, en: 'Admission', bn: 'ভর্তি ফি' },
          { key: 'doctor_visit_bill' as const, en: 'Doctor Visit', bn: 'ডাক্তার ভিজিট' },
          { key: 'operation_bill' as const, en: 'Operation / OT', bn: 'অপারেশন' },
          { key: 'medicine_bill' as const, en: 'Medicine', bn: 'ঔষধ' },
        ]
          .filter(cat => (bill[cat.key] as number) > 0)
          .map(cat => ({
            description: cat.en,
            descriptionBn: cat.bn,
            quantity: 1,
            unitPrice: bill[cat.key] as number,
            total: bill[cat.key] as number,
          }));

    const discount = bill.discount ?? 0;
    const subtotal = bill.total + discount;

    const html = renderInvoiceHtml({
      invoiceNo: bill.invoice_no || `INV-${bill.id}`,
      date: bill.created_at?.split('T')[0] ?? new Date().toISOString().split('T')[0],
      patientName: bill.patient_name,
      patientCode: bill.patient_code,
      patientMobile: bill.patient_mobile,
      hospitalName: bill.hospital_name,
      hospitalAddress: bill.hospital_address,
      hospitalPhone: bill.hospital_phone,
      items,
      subtotal,
      discount: discount > 0 ? discount : undefined,
      totalAmount: bill.total,
      paidAmount: bill.paid,
      dueAmount: bill.due,
    });

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to generate invoice' });
  }
});

// ─── GET /patient-card/:patientId ─────────────────────────────────────────────
pdfRoutes.get('/patient-card/:patientId', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  const role = c.get('role');
  if (!role || !ALLOWED_PDF_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Insufficient permissions' });
  }
  const db = getDb(c.env.DB);

  try {
    const patient = await db.$client.prepare(`
      SELECT p.*,
             t.name as hospital_name
      FROM patients p
      JOIN tenants  t ON p.tenant_id = t.id
      WHERE p.id = ? AND p.tenant_id = ?
    `).bind(patientId, tenantId).first<{
      patient_code: string;
      name: string;
      name_bn?: string;
      date_of_birth?: string;
      gender?: string;
      mobile: string;
      address?: string;
      blood_group?: string;
      created_at: string;
      emergency_contact?: string;
      hospital_name: string;
    }>();

    if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

    const html = renderPatientCardHtml({
      patientCode: patient.patient_code,
      name: patient.name,
      nameBn: patient.name_bn,
      dateOfBirth: patient.date_of_birth,
      gender: patient.gender,
      mobile: patient.mobile,
      address: patient.address,
      bloodGroup: patient.blood_group,
      registrationDate: patient.created_at.split('T')[0],
      emergencyContact: patient.emergency_contact,
      hospitalName: patient.hospital_name,
    });

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to generate patient card' });
  }
});

// ─── GET /vaccination-certificate/:patientId ──────────────────────────────
pdfRoutes.get('/vaccination-certificate/:patientId', async (c) => {
  const tenantId = requireTenantId(c);
  const patientId = Number(c.req.param('patientId'));
  const role = c.get('role');
  if (!role || !ALLOWED_PDF_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Insufficient permissions' });
  }
  if (Number.isNaN(patientId)) throw new HTTPException(400, { message: 'Invalid patient ID' });

  const db = getDb(c.env.DB);
  const autoprint = c.req.query('autoprint') === '1';

  try {
    const [patient, tenant, vaccinationsResult] = await Promise.all([
      db.$client.prepare('SELECT * FROM patients WHERE id = ? AND tenant_id = ?').bind(patientId, tenantId).first(),
      db.$client.prepare('SELECT name, address, phone FROM tenants WHERE id = ?').bind(tenantId).first(),
      db.$client.prepare(`
        SELECT pv.*, vm.name AS vaccine_name, vm.name_bn AS vaccine_name_bn, vm.code AS vaccine_code
        FROM patient_vaccinations pv
        JOIN vaccine_master vm ON pv.vaccine_id = vm.id
        WHERE pv.tenant_id = ? AND pv.patient_id = ? AND pv.status = 'completed'
        ORDER BY pv.administered_date ASC
      `).bind(tenantId, patientId).all(),
    ]);

    if (!patient) throw new HTTPException(404, { message: 'Patient not found' });
    const vaccinations = vaccinationsResult.results ?? [];

    const rows = vaccinations.map((v: any, i: number) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(v.vaccine_name)}${v.vaccine_name_bn ? ` / ${escapeHtml(v.vaccine_name_bn)}` : ''}</td>
        <td>${escapeHtml(v.vaccine_code)}</td>
        <td>${v.dose_number}</td>
        <td>${escapeHtml(v.administered_date)}</td>
        <td>${escapeHtml(v.batch_number) ?? '-'}</td>
        <td>${escapeHtml(v.manufacturer) ?? '-'}</td>
        <td>${escapeHtml(v.route) ?? '-'}</td>
        <td>${escapeHtml(v.next_dose_date) ?? '-'}</td>
      </tr>
    `).join('');

    const patientAge = patient.date_of_birth
      ? Math.floor((Date.now() - new Date(patient.date_of_birth as string).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
      : patient.age ?? '-';

    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Vaccination Certificate — ${escapeHtml(patient.name as string)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Noto Sans Bengali', sans-serif; font-size: 12px; color: #1a1a1a; padding: 20mm 15mm; }
    .header { text-align: center; border-bottom: 2px solid #0891b2; padding-bottom: 12px; margin-bottom: 16px; }
    .header h1 { font-size: 18px; color: #0891b2; }
    .header p { font-size: 11px; opacity: 0.7; margin-top: 4px; }
    .title { text-align: center; font-size: 16px; font-weight: 700; margin: 16px 0 4px; }
    .title-bn { text-align: center; font-size: 14px; color: #555; margin-bottom: 16px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin-bottom: 16px; padding: 12px; background: #f8fafc; border-radius: 6px; }
    .info-grid .label { font-weight: 600; font-size: 11px; color: #555; }
    .info-grid .value { font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #0891b2; color: #fff; padding: 8px 6px; text-align: left; font-size: 11px; }
    td { padding: 6px; border-bottom: 1px solid #e5e7eb; font-size: 11px; }
    tr:nth-child(even) { background: #f8fafc; }
    .footer { margin-top: 24px; display: flex; justify-content: space-between; padding-top: 12px; border-top: 1px solid #d1d5db; }
    .footer .sig { text-align: center; }
    .footer .sig-line { border-top: 1px solid #333; width: 160px; margin: 30px auto 4px; }
    .no-print { text-align: center; margin-bottom: 12px; }
    .no-print button { padding: 8px 24px; background: #0891b2; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; }
    @media print { .no-print { display: none; } body { padding: 10mm; } }
  </style>
</head>
<body>
  <div class="no-print"><button onclick="window.print()">Print / Download PDF</button></div>
  <div class="header">
    <h1>${escapeHtml((tenant as any)?.name) || 'Hospital'}</h1>
    <p>${escapeHtml((tenant as any)?.address) ?? ''} ${(tenant as any)?.phone ? `| ${escapeHtml((tenant as any).phone)}` : ''}</p>
  </div>
  <div class="title">Vaccination Certificate</div>
  <div class="title-bn">টিকাদান সনদপত্র</div>
  <div class="info-grid">
    <div><span class="label">Patient Name / রোগীর নাম:</span></div><div class="value">${escapeHtml(patient.name as string)}</div>
    <div><span class="label">Patient ID:</span></div><div class="value">${escapeHtml((patient.patient_code ?? patientId) as string)}</div>
    <div><span class="label">Age / বয়স:</span></div><div class="value">${patientAge}</div>
    <div><span class="label">Gender / লিঙ্গ:</span></div><div class="value">${escapeHtml(patient.gender as string) || '-'}</div>
    <div><span class="label">Date of Birth:</span></div><div class="value">${escapeHtml(patient.date_of_birth as string) || '-'}</div>
    <div><span class="label">Mobile:</span></div><div class="value">${escapeHtml(patient.mobile as string) || '-'}</div>
  </div>
  <table>
    <thead><tr><th>#</th><th>Vaccine / টিকা</th><th>Code</th><th>Dose</th><th>Date / তারিখ</th><th>Batch</th><th>Manufacturer</th><th>Route</th><th>Next Dose</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="9" style="text-align:center;padding:16px;opacity:0.5">No vaccination records</td></tr>'}</tbody>
  </table>
  <div class="footer">
    <div class="sig"><div class="sig-line"></div><div style="font-size:11px">Authorized Signature / অনুমোদিত স্বাক্ষর</div></div>
    <div style="font-size:10px;opacity:0.6;text-align:right"><p>Generated: ${new Date().toISOString().split('T')[0]}</p><p>Total Vaccinations: ${vaccinations.length}</p></div>
  </div>
  ${autoprint ? `<script>document.fonts.ready.then(()=>setTimeout(()=>window.print(),300));</script>` : ''}
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to generate vaccination certificate' });
  }
});

export default pdfRoutes;
