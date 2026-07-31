import { getTodayGMT6 } from './date-utils';
import { getNextSequence } from './sequence';
import { resolveOrderingClinicianDoctorId } from './lab-order-attribution';

export type PendingPrescriptionLabOrderResult = {
  orderId: number | null;
  orderNo: string | null;
  created: boolean;
  mappedTests: string[];
  unmappedTests: string[];
};

type LabCatalogRow = {
  id: number;
  name: string;
  price: number | null;
};

function normalizeTestName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export async function ensurePendingPrescriptionLabOrder(
  db: D1Database,
  tenantId: string,
  input: {
    prescriptionId: number;
    patientId: number;
    visitId?: number | null;
    orderedBy: string | number | null;
    orderingClinicianDoctorId?: number | null;
    labTests: string[];
  },
): Promise<PendingPrescriptionLabOrderResult> {
  const requestedTests = [...new Set(input.labTests.map(normalizeTestName).filter(Boolean))];
  if (requestedTests.length === 0) {
    return { orderId: null, orderNo: null, created: false, mappedTests: [], unmappedTests: [] };
  }

  const existing = await db.prepare(`
    SELECT id, order_no
    FROM lab_orders
    WHERE tenant_id = ? AND prescription_id = ?
    LIMIT 1
  `).bind(tenantId, input.prescriptionId).first<{ id: number; order_no: string | null }>();
  if (existing) {
    return {
      orderId: Number(existing.id),
      orderNo: existing.order_no ?? null,
      created: false,
      mappedTests: requestedTests,
      unmappedTests: [],
    };
  }

  const { results } = await db.prepare(`
    SELECT id, name, price
    FROM lab_test_catalog
    WHERE tenant_id = ? AND is_active = 1
  `).bind(tenantId).all<LabCatalogRow>();

  const catalog = new Map((results ?? []).map((row) => [normalizeTestName(row.name).toLowerCase(), row]));
  const mapped = requestedTests
    .map((testName) => ({ testName, catalogRow: catalog.get(testName.toLowerCase()) }))
    .filter((item): item is { testName: string; catalogRow: LabCatalogRow } => Boolean(item.catalogRow));
  const unmappedTests = requestedTests.filter((testName) => !catalog.has(testName.toLowerCase()));

  if (mapped.length === 0) {
    return { orderId: null, orderNo: null, created: false, mappedTests: [], unmappedTests };
  }

  const orderNo = await getNextSequence(db, tenantId, 'lab_order', 'LO');
  const orderDate = getTodayGMT6();
  const orderingClinicianDoctorId = await resolveOrderingClinicianDoctorId(db, tenantId, {
    enteredByUserId: input.orderedBy,
    explicitDoctorId: input.orderingClinicianDoctorId,
  });
  const orderResult = await db.prepare(`
    INSERT INTO lab_orders (
      order_no, patient_id, visit_id, ordered_by, ordering_clinician_doctor_id,
      order_date, prescription_id, status, billing_status, tenant_id, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'not_required', ?, datetime('now', '+6 hours'))
  `).bind(
    orderNo,
    input.patientId,
    input.visitId ?? null,
    input.orderedBy ?? null,
    orderingClinicianDoctorId,
    orderDate,
    input.prescriptionId,
    tenantId,
  ).run();

  const orderId = Number(orderResult.meta.last_row_id);
  const itemStatements = mapped.map(({ testName, catalogRow }) => {
    const price = Number(catalogRow.price ?? 0);
    return db.prepare(`
      INSERT INTO lab_order_items (
        lab_order_id, lab_test_id, test_name, unit_price, discount, line_total,
        status, tenant_id, source, created_at
      )
      VALUES (?, ?, ?, ?, 0, ?, 'pending', ?, 'prescription', datetime('now', '+6 hours'))
    `).bind(orderId, catalogRow.id, testName, price, price, tenantId);
  });
  await db.batch(itemStatements);

  return {
    orderId,
    orderNo,
    created: true,
    mappedTests: mapped.map((item) => item.testName),
    unmappedTests,
  };
}
