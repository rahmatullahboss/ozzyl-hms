import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { createStaffSchema, updateStaffSchema, paySalarySchema } from '../../schemas/staff';
import { createInvitationSchema } from '../../schemas/invitation';
import { staffPositionToRole, isStaffInviteRole, generateInviteToken, sha256Hex, expiresIn7Days, buildInvitePath, buildAbsoluteInviteUrl } from '../../lib/staff-invite';
import { sendEmail, EmailTemplates } from '../../lib/email';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requirePermission, resolveUserPermissions } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import { recordAndQueueDirectExpenseAccountingEvent } from '../../lib/direct-finance-accounting';
import { isForbiddenTenantInviteRole, isPrivilegedStaffInviteRole } from '../../lib/staff-invite-policy';
import { createD1WorkforceDirectoryRepository } from '../../modules/workforce-management';


const staffRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function auditMeta(c: any) {
  return {
    ipAddress: c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? undefined,
    userAgent: c.req.header('user-agent') ?? undefined,
  };
}

// GET /api/staff — list active staff
staffRoutes.get('/', requirePermission('workforce:read'), async (c) => {
  const tenantId = requireTenantId(c);
  const directory = createD1WorkforceDirectoryRepository(c.env.DB);

  try {
    const staff = await directory.listActiveDirectoryEntries(tenantId);
    return c.json({ staff });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch staff' });
  }
});

// GET /api/staff/salary-report?month=YYYY-MM — monthly salary report for all staff
// ⚠ MUST be defined BEFORE /:id to prevent 'salary-report' from matching as :id
staffRoutes.get('/salary-report', requirePermission('staff:read'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);

  try {
    const report = await db.$client.prepare(
      `SELECT s.id, s.name, s.position, s.salary as base_salary,
              sp.bonus, sp.deduction, sp.net_salary, sp.payment_method,
              sp.payment_date, sp.month,
              CASE WHEN sp.id IS NULL THEN 'unpaid' ELSE 'paid' END as status
       FROM staff s
       LEFT JOIN salary_payments sp ON s.id = sp.staff_id AND sp.month = ? AND sp.tenant_id = ?
       WHERE s.tenant_id = ? AND s.status = 'active'
       ORDER BY s.position, s.name`,
    ).bind(month, tenantId, tenantId).all();

    const summary = await db.$client.prepare(
      `SELECT COUNT(*) as total_staff,
              SUM(CASE WHEN sp.id IS NOT NULL THEN 1 ELSE 0 END) as paid_count,
              SUM(COALESCE(sp.net_salary, 0)) as total_paid
       FROM staff s
       LEFT JOIN salary_payments sp ON s.id = sp.staff_id AND sp.month = ? AND sp.tenant_id = ?
       WHERE s.tenant_id = ? AND s.status = 'active'`,
    ).bind(month, tenantId, tenantId).first();

    return c.json({ month, staff: report.results, summary });
  } catch {
    throw new HTTPException(500, { message: 'Failed to generate salary report' });
  }
});

// GET /api/staff/:id
staffRoutes.get('/:id', requirePermission('workforce:read'), async (c) => {
  const tenantId = requireTenantId(c);
  const staffId = Number(c.req.param('id'));
  const directory = createD1WorkforceDirectoryRepository(c.env.DB);

  if (!Number.isInteger(staffId) || staffId <= 0) {
    throw new HTTPException(404, { message: 'Staff not found' });
  }

  try {
    const member = await directory.getDirectoryEntry(tenantId, staffId);
    if (!member) throw new HTTPException(404, { message: 'Staff not found' });
    return c.json({ staff: member });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch staff' });
  }
});

// POST /api/staff — add staff member with Zod validation
staffRoutes.post('/', requirePermission('workforce:write'), zValidator('json', createStaffSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const result = await db.$client.prepare(
      `INSERT INTO staff (
         name, address, position, salary, bank_account, mobile, email, date_of_birth, gender, salutation,
         joining_date, department, emergency_contact, blood_group, category, biometric_device_id, shift_type,
         status, tenant_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    ).bind(
      data.name,
      data.address ?? '',
      data.position,
      data.salary ?? 0,
      data.bankAccount ?? '',
      data.mobile ?? '',
      data.email ?? null,
      data.dateOfBirth ?? null,
      data.gender ?? null,
      data.salutation ?? null,
      data.joiningDate ?? null,
      data.department ?? null,
      data.emergencyContact ?? null,
      data.bloodGroup ?? null,
      data.category ?? null,
      data.biometricDeviceId ?? null,
      data.shiftType ?? null,
      tenantId,
    ).run();

    const { ipAddress, userAgent } = auditMeta(c);
    await createAuditLog(c.env, tenantId, userId, 'CREATE', 'staff', result.meta.last_row_id as number, null, {
      name: data.name,
      position: data.position,
      salary: data.salary,
      department: data.department,
    }, ipAddress, userAgent);

    return c.json({ message: 'Staff added', id: result.meta.last_row_id }, 201);
  } catch {
    throw new HTTPException(500, { message: 'Failed to add staff' });
  }
});

// PUT /api/staff/:id — update staff details
staffRoutes.put('/:id', requirePermission('workforce:write'), zValidator('json', updateStaffSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(
      'SELECT * FROM staff WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<Record<string, unknown>>();
    if (!existing) throw new HTTPException(404, { message: 'Staff not found' });

    const oldValue = {
      name: existing['name'],
      address: existing['address'],
      position: existing['position'],
      salary: existing['salary'],
      bank_account: existing['bank_account'],
      mobile: existing['mobile'],
      department: existing['department'],
      emergency_contact: existing['emergency_contact'],
      blood_group: existing['blood_group'],
      category: existing['category'],
      biometric_device_id: existing['biometric_device_id'],
      shift_type: existing['shift_type'],
    };

    await db.$client.prepare(
      `UPDATE staff SET
         name = ?, address = ?, position = ?, salary = ?, bank_account = ?, mobile = ?,
         email = ?, date_of_birth = ?, gender = ?, salutation = ?, department = ?,
         emergency_contact = ?, blood_group = ?, category = ?, biometric_device_id = ?, shift_type = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND tenant_id = ?`,
    ).bind(
      data.name        ?? existing['name'],
      data.address     !== undefined ? (data.address ?? '') : existing['address'],
      data.position    ?? existing['position'],
      data.salary      !== undefined ? data.salary      : existing['salary'],
      data.bankAccount !== undefined ? (data.bankAccount ?? '') : existing['bank_account'],
      data.mobile      !== undefined ? (data.mobile ?? '') : existing['mobile'],
      data.email       !== undefined ? data.email : (existing['email'] ?? null),
      data.dateOfBirth !== undefined ? data.dateOfBirth : (existing['date_of_birth'] ?? null),
      data.gender      !== undefined ? data.gender : (existing['gender'] ?? null),
      data.salutation  !== undefined ? data.salutation : (existing['salutation'] ?? null),
      data.department !== undefined ? data.department : existing['department'],
      data.emergencyContact !== undefined ? (data.emergencyContact ?? null) : existing['emergency_contact'],
      data.bloodGroup !== undefined ? (data.bloodGroup ?? null) : existing['blood_group'],
      data.category !== undefined ? (data.category ?? null) : existing['category'],
      data.biometricDeviceId !== undefined ? (data.biometricDeviceId ?? null) : existing['biometric_device_id'],
      data.shiftType !== undefined ? (data.shiftType ?? null) : existing['shift_type'],
      id, tenantId,
    ).run();

    const newValue = {
      name: data.name ?? existing['name'],
      address: data.address !== undefined ? (data.address ?? '') : existing['address'],
      position: data.position ?? existing['position'],
      salary: data.salary !== undefined ? data.salary : existing['salary'],
      bank_account: data.bankAccount !== undefined ? (data.bankAccount ?? '') : existing['bank_account'],
      mobile: data.mobile !== undefined ? (data.mobile ?? '') : existing['mobile'],
      department: data.department !== undefined ? data.department : existing['department'],
      emergency_contact: data.emergencyContact !== undefined ? (data.emergencyContact ?? null) : existing['emergency_contact'],
      blood_group: data.bloodGroup !== undefined ? (data.bloodGroup ?? null) : existing['blood_group'],
      category: data.category !== undefined ? (data.category ?? null) : existing['category'],
      biometric_device_id: data.biometricDeviceId !== undefined ? (data.biometricDeviceId ?? null) : existing['biometric_device_id'],
      shift_type: data.shiftType !== undefined ? (data.shiftType ?? null) : existing['shift_type'],
    };

    const { ipAddress, userAgent } = auditMeta(c);
    await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'staff', Number(id), oldValue, newValue, ipAddress, userAgent);

    return c.json({ message: 'Staff updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update staff' });
  }
});

// DELETE /api/staff/:id — soft deactivate
staffRoutes.delete('/:id', requirePermission('workforce:deactivate'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');

  try {
    const existing = await db.$client.prepare(
      'SELECT id, name, position FROM staff WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<{ id: number; name: string; position: string }>();
    if (!existing) throw new HTTPException(404, { message: 'Staff not found' });

    await db.$client.prepare(
      `UPDATE staff SET status = 'inactive' WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).run();

    const { ipAddress, userAgent } = auditMeta(c);
    await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'staff', Number(id), { status: 'active' }, { status: 'inactive' }, ipAddress, userAgent);

    return c.json({ message: 'Staff deactivated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to deactivate staff' });
  }
});

// POST /api/staff/:id/salary — pay salary with bonus & deduction
staffRoutes.post('/:id/salary', requirePermission('staff:write'), zValidator('json', paySalarySchema), async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const member = await db.$client.prepare(
      'SELECT * FROM staff WHERE id = ? AND tenant_id = ? AND status = ?',
    ).bind(id, tenantId, 'active').first<{ id: number; name: string; salary: number }>();
    if (!member) throw new HTTPException(404, { message: 'Staff not found' });

    // Check duplicate payment for same month
    const existing = await db.$client.prepare(
      'SELECT id FROM salary_payments WHERE staff_id = ? AND month = ? AND tenant_id = ?',
    ).bind(id, data.month, tenantId).first();
    if (existing) throw new HTTPException(409, { message: `Salary already paid for ${data.month}` });

    const bonus = data.bonus;
    const deduction = data.deduction;
    const netSalary = member.salary + bonus - deduction;
    if (netSalary <= 0) {
      throw new HTTPException(400, { message: 'Net salary must be greater than zero' });
    }
    const paymentDate = getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, paymentDate, 'Staff salary payment');

    await db.$client.prepare(
      `INSERT INTO salary_payments
         (staff_id, amount, bonus, deduction, net_salary, payment_method, reference_no, payment_date, month, tenant_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, member.salary, bonus, deduction, netSalary, data.paymentMethod ?? null, data.referenceNo ?? null, paymentDate, data.month, tenantId).run();

    const description = `Salary for ${member.name} - ${data.month}`;
    const expenseResult = await db.$client.prepare(
      `INSERT INTO expenses (
         date, category, amount, description, status, approved_by, approved_at,
         tenant_id, created_by, source_type, source_id, reference_no
       ) VALUES (?, 'Salary', ?, ?, 'approved', ?, datetime('now', '+6 hours'), ?, ?, 'staff_salary', ?, ?)`,
    ).bind(paymentDate, netSalary, description, userId, tenantId, userId, id, data.referenceNo ?? `SALARY-${id}-${data.month}`).run();

    const expenseId = expenseResult.meta.last_row_id;
    await recordAndQueueDirectExpenseAccountingEvent(c, {
      tenantId,
      userId,
      expenseId,
      date: paymentDate,
      category: 'Salary',
      amount: netSalary,
      paymentMethod: data.paymentMethod ?? 'cash',
      description,
    });

    const { ipAddress, userAgent } = auditMeta(c);
    await createAuditLog(c.env, tenantId, userId, 'PAYMENT', 'salary_payments', expenseId as number, null, {
      staffId: id,
      staffName: member.name,
      month: data.month,
      baseSalary: member.salary,
      bonus,
      deduction,
      netSalary,
    }, ipAddress, userAgent);

    return c.json({
      message: 'Salary paid',
      breakdown: { baseSalary: member.salary, bonus, deduction, netSalary },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to pay salary' });
  }
});

// GET /api/staff/:id/salary — salary history for one staff member
staffRoutes.get('/:id/salary', requirePermission('staff:read'), async (c) => {
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  const tenantId = requireTenantId(c);

  try {
    const payments = await db.$client.prepare(
      `SELECT sp.*, s.name as staff_name, s.position
       FROM salary_payments sp JOIN staff s ON sp.staff_id = s.id
       WHERE sp.staff_id = ? AND sp.tenant_id = ? ORDER BY sp.payment_date DESC`,
    ).bind(id, tenantId).all();
    return c.json({ payments: payments.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch salary history' });
  }
});

// POST /api/staff/:id/invite — send an invite for a specific staff profile
staffRoutes.post('/:id/invite', requirePermission('staff:write'), async (c) => {
  const tenantId = requireTenantId(c);
  const callerId = requireUserId(c);
  const callerRole = c.get('role');
  const staffId  = Number(c.req.param('id'));
  if (!Number.isInteger(staffId) || staffId <= 0) {
    return c.json({ error: 'Invalid staff id' }, 400);
  }

  const body = (await c.req.json().catch(() => ({}))) as { email?: string; role?: string };
  const db = getDb(c.env.DB);
  const member = await db.$client.prepare(
    'SELECT id, name, email, position, status, user_id FROM staff WHERE id = ? AND tenant_id = ?'
  ).bind(staffId, tenantId).first<{
    id: number; name: string; email: string | null;
    position: string | null; status: string; user_id: number | null;
  }>();
  if (!member) return c.json({ error: 'Staff not found' }, 404);
  if (member.status !== 'active') return c.json({ error: 'Staff is not active' }, 400);
  if (member.user_id) return c.json({ error: 'Staff already linked to a user' }, 409);

  const requestedRole = typeof body.role === 'string' ? body.role.trim() : '';
  const mapped = requestedRole
    ? (isStaffInviteRole(requestedRole) ? { role: requestedRole } : null)
    : staffPositionToRole(member.position);
  if (!mapped) {
    return c.json({
      error: 'Select a valid login role for this staff member before sending invitation.',
    }, 400);
  }
  if (isForbiddenTenantInviteRole(mapped.role)) {
    return c.json({ error: 'Cannot create hospital_admin or super_admin through staff invitation' }, 400);
  }
  if (isPrivilegedStaffInviteRole(mapped.role) && callerRole !== 'hospital_admin') {
    const callerPermissions = await resolveUserPermissions(
      c.env.DB,
      String(tenantId),
      String(callerRole),
      String(callerId),
    );
    if (!callerPermissions.includes('*') && !callerPermissions.includes('roles:manage')) {
      return c.json({ error: 'Inviting management roles requires roles:manage permission' }, 403);
    }
  }

  const finalEmail = (body.email ?? '').trim() || (member.email ?? '').trim();
  if (!finalEmail) {
    return c.json({ error: 'Email is required (provide body.email or set staff.email)' }, 400);
  }

  const parsed = createInvitationSchema.safeParse({ email: finalEmail, role: mapped.role, staffId });
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, 400);
  }

  const existingUser = await db.$client.prepare(
    'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
  ).bind(finalEmail, tenantId).first();
  if (existingUser) return c.json({ error: 'Email already registered' }, 409);

  const existingInvite = await db.$client.prepare(
    `SELECT id FROM invitations
     WHERE tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL
       AND datetime(expires_at) > datetime('now')
       AND (email = ? OR staff_id = ?)`
  ).bind(tenantId, finalEmail, staffId).first();
  if (existingInvite) {
    return c.json({ error: 'Pending invitation already exists for this staff or email' }, 409);
  }

  const rawToken  = generateInviteToken();
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = expiresIn7Days();

  const result = await db.$client.prepare(
    `INSERT INTO invitations (tenant_id, email, role, token, invited_by, expires_at, staff_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(tenantId, finalEmail, mapped.role, tokenHash, callerId ?? 0, expiresAt, staffId).run();
  const inviteId = result.meta.last_row_id as number;

  await createAuditLog(c.env, tenantId, callerId ?? 0, 'CREATE', 'invitations',
    inviteId, null,
    { email: finalEmail, role: mapped.role, staffId, staffName: member.name, position: member.position },
    c.req.header('CF-Connecting-IP') ?? undefined,
    c.req.header('user-agent') ?? undefined,
  );

  const tenant = await db.$client.prepare('SELECT subdomain, name FROM tenants WHERE id = ?')
    .bind(tenantId).first<{ subdomain: string; name: string }>();
  const inviteLink = buildInvitePath(tenant?.subdomain, rawToken);
  const inviteUrl = buildAbsoluteInviteUrl(c.env.HMS_APP_URL ?? new URL(c.req.url).origin, inviteLink);
  const inviter = await db.$client.prepare('SELECT name FROM users WHERE id = ? AND tenant_id = ?')
    .bind(callerId ?? 0, tenantId).first<{ name: string }>();
  const emailTemplate = EmailTemplates.staffInvite({
    inviteeName: member.name,
    inviterName: inviter?.name ?? 'Hospital Admin',
    role: mapped.role,
    hospitalName: tenant?.name ?? 'HMS',
    inviteUrl,
  });
  const emailResult = await sendEmail(c.env, { to: finalEmail, ...emailTemplate });

  return c.json({
    invite: {
      email:      finalEmail,
      role:       mapped.role,
      staffId,
      staffName:  member.name,
      position:   member.position,
      expiresAt,
      inviteLink,
      emailSent:  emailResult.success,
      emailError: emailResult.success ? undefined : emailResult.error,
    },
  }, 201);
});

export default staffRoutes;
