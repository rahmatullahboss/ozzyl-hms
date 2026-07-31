/**
 * Helpers for staff invitation flow.
 *
 * - staffPositionToRole: maps a free-text `staff.position` to an invitable
 *   staff/management role. Case-insensitive substring match keeps legacy
 *   values like "Senior Nurse" or "Lab Technician" working.
 * - generateInviteToken / sha256Hex / expiresIn7Days: shared crypto +
 *   time helpers used by staff and invitation resend flows.
 */

export type StaffInviteRole =
  | 'nurse'
  | 'laboratory'
  | 'reception'
  | 'manager'
  | 'md'
  | 'director'
  | 'pharmacist'
  | 'accountant';

export const STAFF_INVITE_ROLES: readonly StaffInviteRole[] = [
  'nurse',
  'laboratory',
  'reception',
  'manager',
  'md',
  'director',
  'pharmacist',
  'accountant',
] as const;

export function isStaffInviteRole(role: string | null | undefined): role is StaffInviteRole {
  return STAFF_INVITE_ROLES.includes(role as StaffInviteRole);
}

export function staffPositionToRole(position: string | null | undefined): { role: StaffInviteRole } | null {
  const p = (position ?? '').toLowerCase();
  if (!p) return null;
  if (p.includes('md') || p.includes('managing director')) return { role: 'md' };
  if (p.includes('director')) return { role: 'director' };
  if (p.includes('manager')) return { role: 'manager' };
  if (p.includes('nurse')) return { role: 'nurse' };
  if (p.includes('lab') || p.includes('technician')) return { role: 'laboratory' };
  if (p.includes('reception')) return { role: 'reception' };
  if (p.includes('pharmacist')) return { role: 'pharmacist' };
  if (p.includes('accountant') || p.includes('account')) return { role: 'accountant' };
  return null;
}

export function generateInviteToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const d = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function expiresIn7Days(now: number = Date.now()): string {
  return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export function buildInvitePath(subdomain: string | null | undefined, rawToken: string): string {
  const slug = subdomain || 'hospital';
  return `/h/${slug}/accept-invite?token=${rawToken}`;
}

export function buildAbsoluteInviteUrl(baseUrl: string | null | undefined, invitePath: string): string {
  return `${(baseUrl || '').replace(/\/$/, '')}${invitePath}`;
}
