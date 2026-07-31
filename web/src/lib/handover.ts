export type RoleBasePathRole = 'hospital_admin' | 'reception' | string;

export interface ReceptionBillFormData {
  testBill: number;
  doctorVisitBill: number;
  operationBill: number;
  admissionBill: number;
  medicineBill: number;
  discount: number;
}

interface BuildReceptionBillPayloadInput {
  patientId: number;
  fireServiceCharge: number;
  form: ReceptionBillFormData;
}

export function getRoleBasePath(slug: string, role: RoleBasePathRole): string {
  const hospitalBasePath = `/h/${slug}`;
  if (role === 'reception') {
    return `${hospitalBasePath}/reception`;
  }
  return hospitalBasePath;
}

export function getIpdRunningBillPrintPath(basePath: string, admissionId: number | string): string {
  return `${basePath}/ip-billing/${admissionId}/running-print`;
}

export function buildReceptionBillPayload({
  patientId,
  fireServiceCharge,
  form,
}: BuildReceptionBillPayloadInput) {
  const items = [
    { itemCategory: 'test', quantity: 1, unitPrice: form.testBill },
    { itemCategory: 'doctor_visit', quantity: 1, unitPrice: form.doctorVisitBill },
    { itemCategory: 'operation', quantity: 1, unitPrice: form.operationBill },
    { itemCategory: 'admission', quantity: 1, unitPrice: form.admissionBill },
    { itemCategory: 'medicine', quantity: 1, unitPrice: form.medicineBill },
    {
      itemCategory: 'fire_service',
      description: 'Fire Service',
      quantity: 1,
      unitPrice: fireServiceCharge,
    },
  ].filter((item) => item.unitPrice > 0);

  return {
    patientId,
    discount: form.discount,
    items,
  };
}
