/**
 * HR-03: allowlisted staff-facing DTO.
 *
 * The directory repositories intentionally retain their internal compatibility
 * shapes; a low-trust operational response must never spread those objects.
 * Newly added columns (including nested objects) are discarded by default.
 */
export type StaffReadVisibility = {
  compensationRead: boolean;
  bankMetadataRead: boolean;
};

export function maskStaffBankAccount(value: unknown): string | null {
  const account = typeof value === 'string' ? value.trim() : '';
  if (!account) return null;
  if (account.length <= 4) return '••••';
  return `••••${account.slice(-4)}`;
}

export function projectStaffDirectoryRow(input: object, visibility: StaffReadVisibility) {
  const row = input as Record<string, unknown>;
  const member = row.workforce_member && typeof row.workforce_member === 'object'
    ? row.workforce_member as Record<string, unknown>
    : null;

  const operational = {
    id: row.id,
    name: row.name,
    address: row.address,
    position: row.position,
    mobile: row.mobile,
    email: row.email,
    date_of_birth: row.date_of_birth,
    gender: row.gender,
    salutation: row.salutation,
    joining_date: row.joining_date,
    department: row.department,
    status: row.status,
    tenant_id: row.tenant_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    user_id: row.user_id,
    emergency_contact: row.emergency_contact,
    blood_group: row.blood_group,
    category: row.category,
    biometric_device_id: row.biometric_device_id,
    shift_type: row.shift_type,
    pending_invitation_id: row.pending_invitation_id,
    pending_invitation_expires_at: row.pending_invitation_expires_at,
    pending_invitation_role: row.pending_invitation_role,
    pending_invitation_status: row.pending_invitation_status,
    practitioner_public_id: row.practitioner_public_id,
    workforce_member: member ? {
      tenantId: member.tenantId,
      staffId: member.staffId,
      memberPublicId: member.memberPublicId,
      displayName: member.displayName,
      position: member.position,
      department: member.department,
      status: member.status,
      userId: member.userId,
      practitionerPublicId: member.practitionerPublicId,
    } : null,
  };

  return {
    ...operational,
    ...(visibility.compensationRead ? { salary: row.salary } : {}),
    ...(visibility.bankMetadataRead ? { bank_account_masked: maskStaffBankAccount(row.bank_account) } : {}),
  };
}
