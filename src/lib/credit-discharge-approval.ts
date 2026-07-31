export const CREDIT_DISCHARGE_APPROVAL_KIND = 'credit_discharge' as const;
export const CREDIT_DISCHARGE_APPROVAL_STORAGE_TYPE = 'manual_adjustment' as const;

export function isCreditDischargeApproval(
  type: unknown,
  requestData: Record<string, unknown> | null | undefined,
): boolean {
  const normalizedType = String(type ?? '').trim();
  if (normalizedType === CREDIT_DISCHARGE_APPROVAL_KIND) return true;
  if (normalizedType !== CREDIT_DISCHARGE_APPROVAL_STORAGE_TYPE) return false;
  return String(requestData?.approvalKind ?? '').trim() === CREDIT_DISCHARGE_APPROVAL_KIND;
}

export function publicApprovalType(
  type: unknown,
  requestData: Record<string, unknown> | null | undefined,
): string {
  return isCreditDischargeApproval(type, requestData)
    ? CREDIT_DISCHARGE_APPROVAL_KIND
    : String(type ?? '').trim();
}
