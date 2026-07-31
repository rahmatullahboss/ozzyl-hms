import type { ShiftRepository, WorkforceMemberRepository } from './ports';
import { WorkforceError } from '../domain/errors';
import type { ShiftDefinition, WorkforceMemberRef } from '../domain/workforce-member';

export type LegacyStaffCompatibilityDto = {
  id: number;
  name: string;
  address: string;
  position: string;
  salary: number;
  bank_account: string;
  mobile: string;
  email: string | null;
  date_of_birth: string | null;
  gender: string | null;
  salutation: string | null;
  joining_date: string | null;
  department: string | null;
  status: 'active' | 'inactive';
  tenant_id: number | string;
  created_at: string | null;
  updated_at: string | null;
  user_id: number | null;
  emergency_contact: string | null;
  blood_group: string | null;
  category: string | null;
  biometric_device_id: string | null;
  shift_type: string | null;
  pending_invitation_id: number | null;
  pending_invitation_expires_at: string | null;
  pending_invitation_role: string | null;
  pending_invitation_status: 'accepted' | 'revoked' | 'expired' | 'pending' | null;
  practitioner_public_id: string | null;
  workforce_member: WorkforceMemberRef;
};

export interface WorkforceDirectoryRepository extends WorkforceMemberRepository, ShiftRepository {
  listActiveDirectoryEntries(tenantId: string): Promise<LegacyStaffCompatibilityDto[]>;
  getDirectoryEntry(tenantId: string, staffId: number): Promise<LegacyStaffCompatibilityDto | null>;
}

export async function requireActiveMember(
  repository: WorkforceMemberRepository,
  tenantId: string,
  staffId: number,
): Promise<WorkforceMemberRef> {
  const member = await repository.getMember(tenantId, staffId);
  if (!member) {
    throw new WorkforceError('WORKFORCE_MEMBER_NOT_FOUND', 'Staff member not found', 404);
  }
  if (member.status !== 'active') {
    throw new WorkforceError('WORKFORCE_MEMBER_INACTIVE', 'Staff member is inactive', 409);
  }
  return member;
}

export async function requireActiveShift(
  repository: ShiftRepository,
  tenantId: string,
  shiftId: number,
): Promise<ShiftDefinition> {
  const shift = await repository.getShift(tenantId, shiftId);
  if (!shift) {
    throw new WorkforceError('SHIFT_NOT_FOUND', 'Shift not found', 404);
  }
  if (!shift.isActive) {
    throw new WorkforceError('SHIFT_INACTIVE', 'Shift is inactive', 409);
  }
  return shift;
}
