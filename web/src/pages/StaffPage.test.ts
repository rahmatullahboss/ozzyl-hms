import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = () => readFileSync(resolve(__dirname, './StaffPage.tsx'), 'utf8');

describe('StaffPage', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./StaffPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('does not import the Stethoscope icon (doctors live in DoctorList, not here)', async () => {
    expect(source()).not.toMatch(/\bStethoscope\b/);
  });

  it('does not fetch /api/doctors (doctors are managed in DoctorList)', async () => {
    expect(source()).not.toMatch(/\/api\/doctors\b/);
  });

  it('Staff interface no longer carries a _type discriminator', async () => {
    expect(source()).not.toMatch(/(?:^|[\s,{])_type\s*\??:\s*['"]staff['"]/m);
  });

  it('does not merge staff and doctors into a single allMembers list', async () => {
    expect(source()).not.toMatch(/\ballMembers\b/);
    expect(source()).not.toMatch(/\bdoctorCount\b/);
  });

  it('does not render the Stethoscope icon or (Dr) badge in the table body', async () => {
    expect(source()).not.toMatch(/\(Dr\)/);
  });

  it('CATEGORY_OPTIONS no longer offers "doctor" as a category', async () => {
    expect(source()).not.toMatch(/value:\s*['"]doctor['"]/);
  });

  it('shows software access controls directly inside add/edit staff flow', () => {
    const src = source();
    expect(src).toContain('giveSoftwareAccess');
    expect(src).toContain('LOGIN_ROLE_OPTIONS');
    expect(src).toContain('invite_role');
    expect(src).toContain('send_invite');
  });

  it('offers operational and management login roles from StaffPage', () => {
    const src = source();
    for (const role of ['reception', 'manager', 'accountant', 'director', 'md', 'nurse', 'laboratory', 'pharmacist', 'hospital_admin']) {
      expect(src).toContain(`value: '${role}'`);
    }
  });

  it('offers a broader hospital staff category list including manager roles', () => {
    const src = source();
    for (const role of ['manager', 'operations_manager', 'branch_manager', 'floor_manager', 'billing_cashier', 'ward_boy', 'ot_assistant', 'it_support']) {
      expect(src).toContain(`value: '${role}'`);
    }
  });

  it('keeps staff category values separate from display position labels', () => {
    const src = source();
    expect(src).toContain('categoryLabel(e.target.value)');
    expect(src).toContain('categoryFromPosition(member.position)');
  });

  it('sends selected invite role through the staff-specific invite endpoint', () => {
    const src = source();
    expect(src).toContain('`/api/staff/${member.id}/invite`');
    expect(src).toMatch(/role:\s*inviteRole\s*\|\|\s*undefined/);
    expect(src).not.toContain('/api/invitations`,');
  });

  it('warns the administrator not to open or complete the invite link', () => {
    const src = source();
    expect(src).toContain('The recipient must open this link and create their own password.');
    expect(src).toContain('Do not open or complete the invitation yourself.');
  });

  it('shows account status states on the staff list', () => {
    const src = source();
    for (const labelKey of ['activeLogin', 'pendingInvite', 'expiredInvite', 'revokedInvite', 'noLoginAccess']) {
      expect(src).toContain(labelKey);
    }
  });

  it('persists optional HR/contact fields through the staff payload', () => {
    const src = source();
    for (const field of ['emergencyContact', 'bloodGroup', 'category', 'biometricDeviceId', 'shiftType']) {
      expect(src).toContain(field);
    }
  });

  it('does not require bank account before staff creation', () => {
    const src = source();
    expect(src).toContain('bankAccountLaterPlaceholder');
    expect(src).not.toMatch(/e\.bank_account\s*=/);
    expect(src).not.toMatch(/errors\.bank_account/);
  });

  it('lets admins manage system access bundles from the staff drawer', () => {
    const src = source();
    expect(src).toContain('System Access');
    expect(src).toContain('WORKSPACE_BUNDLES');
    expect(src).toContain('isWorkspaceBundleGranted');
    expect(src).toContain('/api/permissions/user/workspace-bundle');
    expect(src).toContain('roles:manage');
    expect(src).toContain('Access change history');
    expect(src).toContain('No user-specific access changes yet');
  });
});
