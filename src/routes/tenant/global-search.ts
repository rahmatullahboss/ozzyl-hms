import { Hono } from 'hono';
import { requireRole } from '../../middleware/rbac';
import { buildInvoiceSearchTermList } from '../../lib/invoice-search';
import { globalSearchQuerySchema } from '../../schemas/global-search';
import type { Env, Variables } from '../../types';

const globalSearch = new Hono<{ Bindings: Env; Variables: Variables }>();

globalSearch.use('/*', requireRole('hospital_admin', 'md', 'director', 'manager', 'accountant', 'reception', 'doctor', 'nurse', 'pharmacist', 'laboratory'));

// GET / — Unified search across entities
globalSearch.get('/', async (c) => {
  const tenantId = c.get('tenantId');
  const db = c.env.DB;
  const query = globalSearchQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return c.json({ error: query.error.flatten() }, 400);
  }

  const { q, limit } = query.data;
  const searchTerm = `%${q}%`;

  // Smart invoice search: handle common typos where users type letter `o`/`O`
  // instead of digit `0` (e.g. "INV-oooo23" → "INV-000023"). Also strip any
  // "INV-" prefix and pad numeric portion so a user can search just "23".
  // The compact term matches invoice numbers even when users add/remove dashes,
  // e.g. `BL-0000-14`, `BL000014`, and stored `BL-000014`.
  const invoiceTermList = buildInvoiceSearchTermList(q);
  const invoiceReferenceExpr = `COALESCE(NULLIF(TRIM(b.invoice_no), ''), NULLIF(TRIM(b.bill_no), ''), CAST(b.id AS TEXT))`;
  const invoiceCompactExpr = `REPLACE(REPLACE(REPLACE(UPPER(${invoiceReferenceExpr}), '-', ''), ' ', ''), '/', '')`;
  const invoiceSearchClauses = invoiceTermList.flatMap(() => [
    `${invoiceReferenceExpr} LIKE ?`,
    `${invoiceReferenceExpr} LIKE ?`,
    `${invoiceReferenceExpr} LIKE ?`,
    `${invoiceCompactExpr} LIKE ?`,
  ]);
  const invoiceSearchParams = invoiceTermList.flatMap((term) => [term.original, term.normalized, term.padded, term.compact]);

  const batchResults = await db.batch([
    db
      .prepare(
        `SELECT id, name, mobile, mobile AS phone, patient_code FROM patients WHERE tenant_id = ? AND (name LIKE ? OR mobile LIKE ? OR patient_code LIKE ?) LIMIT ?`
      )
      .bind(tenantId, searchTerm, searchTerm, searchTerm, limit),
    db
      .prepare(
        `SELECT b.id, ${invoiceReferenceExpr} AS invoice_no, b.patient_id, b.total, b.paid, b.status, b.created_at,
                COALESCE(p.name, '') AS patient_name,
                COALESCE(p.patient_code, '') AS patient_code
         FROM bills b
         LEFT JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
         WHERE b.tenant_id = ?
           AND (
             ${invoiceSearchClauses.join('\n             OR ')}
             OR CAST(b.patient_id AS TEXT) LIKE ?
             OR p.name LIKE ?
             OR p.patient_code LIKE ?
           )
         ORDER BY b.id DESC
         LIMIT ?`
      )
      .bind(
        tenantId,
        ...invoiceSearchParams,
        searchTerm,
        searchTerm,
        searchTerm,
        limit,
      ),
    db
      .prepare(
        `SELECT id, name, phone FROM doctors WHERE tenant_id = ? AND (name LIKE ? OR phone LIKE ?) LIMIT ?`
      )
      .bind(tenantId, searchTerm, searchTerm, limit),
    db
      .prepare(
        `SELECT id, patient_id, patient_name, bed_number, status FROM admissions WHERE tenant_id = ? AND (patient_name LIKE ? OR bed_number LIKE ? OR CAST(patient_id AS TEXT) LIKE ?) AND status = 'admitted' LIMIT ?`
      )
      .bind(tenantId, searchTerm, searchTerm, searchTerm, limit),
  ]);

  const patientsResult = batchResults[0]?.results || [];
  const billsResult = batchResults[1]?.results || [];
  const doctorsResult = batchResults[2]?.results || [];
  const admissionsResult = batchResults[3]?.results || [];

  return c.json({
    data: {
      query: q,
      patients: patientsResult,
      bills: billsResult,
      doctors: doctorsResult,
      admissions: admissionsResult,
      totalResults:
        patientsResult.length +
        billsResult.length +
        doctorsResult.length +
        admissionsResult.length,
    },
  });
});

export { buildInvoiceSearchTerms } from '../../lib/invoice-search';

export default globalSearch;
