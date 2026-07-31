export function getAdmissionSlipPrintPath(
  basePath: string,
  admissionId: number | string,
): string {
  return `${basePath.replace(/\/$/, '')}/admissions/${admissionId}/print`;
}
