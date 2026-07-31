export function normalizeConsultationFee(value: unknown): number {
  const fee = Number(value ?? 0);
  if (!Number.isFinite(fee) || fee <= 0) return 0;

  const rounded = Math.round(fee);

  // Older marketplace/doctor-registration flows stored consultation fees in
  // minor units (500 taka -> 50000). Billing now stores and posts taka.
  if (rounded >= 10000 && rounded % 100 === 0) {
    return Math.round(rounded / 100);
  }

  return rounded;
}
