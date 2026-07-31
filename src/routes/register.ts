import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { hashPassword } from '../lib/password';
import { generateToken } from '../middleware/auth';
import { isStrongPassword } from '../middleware/security';
import { TRIAL_DAYS } from '../schemas/pricing';
import type { Env } from '../types';
import { getDb } from '../db';
import { getPermissionsForRole } from '../lib/authz';
import { seedAccountingDefaults } from '../lib/accounting-provisioning';
import { seedInventoryVendorDefaults } from '../lib/inventory-vendor-defaults';
import { seedLabReagentDefaults } from '../lib/lab-reagent-defaults';

// ═══════════════════════════════════════════════════════════
// BILLING DEFAULT SEED — Auto-seed on new hospital registration
// ═══════════════════════════════════════════════════════════

async function seedBillingDefaults(db: ReturnType<typeof getDb>, tenantId: number): Promise<void> {
  // Create Service Departments
  const departments = [
    { name: 'General OPD', code: 'OPD-GEN', order: 1 },
    { name: 'Emergency', code: 'EMERG', order: 2 },
    { name: 'Laboratory', code: 'LAB', order: 3 },
    { name: 'Radiology', code: 'RAD', order: 4 },
    { name: 'IPD General', code: 'IPD-GEN', order: 5 },
    { name: 'IPD Cabin', code: 'IPD-CAB', order: 6 },
    { name: 'IPD ICU', code: 'IPD-ICU', order: 7 },
    { name: 'Dental', code: 'DENTAL', order: 8 },
    { name: 'Eye', code: 'EYE', order: 9 },
    { name: 'Physiotherapy', code: 'PHY', order: 10 },
    { name: 'Cardiology', code: 'CARD', order: 11 },
  ];

  const deptIds: Record<string, number> = {};
  
  for (const dept of departments) {
    const existing = await db.$client.prepare(
      `SELECT id FROM billing_service_departments
       WHERE tenant_id = ?
         AND COALESCE(is_active, 1) = 1
         AND (department_code = ? OR lower(trim(department_name)) = lower(trim(?)))
       ORDER BY CASE WHEN department_code = ? THEN 0 ELSE 1 END, id
       LIMIT 1`
    ).bind(tenantId, dept.code, dept.name, dept.code).first<{ id: number }>();
    if (existing?.id) {
      deptIds[dept.code] = Number(existing.id);
      continue;
    }

    try {
      const result = await db.$client.prepare(
        `INSERT INTO billing_service_departments (department_name, department_code, display_order, tenant_id) VALUES (?, ?, ?, ?)`
      ).bind(dept.name, dept.code, dept.order, tenantId).run();
      deptIds[dept.code] = Number(result.meta.last_row_id ?? 0);
    } catch {
      const recovered = await db.$client.prepare(
        `SELECT id FROM billing_service_departments
         WHERE tenant_id = ?
           AND COALESCE(is_active, 1) = 1
           AND (department_code = ? OR lower(trim(department_name)) = lower(trim(?)))
         ORDER BY CASE WHEN department_code = ? THEN 0 ELSE 1 END, id
         LIMIT 1`
      ).bind(tenantId, dept.code, dept.name, dept.code).first<{ id: number }>();
      if (!recovered?.id) throw new Error(`Failed to seed billing department ${dept.code}`);
      deptIds[dept.code] = Number(recovered.id);
    }
  }

  // Create Service Items
  const items = [
    { name: 'OPD Consultation - General', code: 'OPD-001', dept: 'OPD-GEN', price: 300, tax: true },
    { name: 'OPD Consultation - Specialist', code: 'OPD-002', dept: 'OPD-GEN', price: 500, tax: true },
    { name: 'Follow-up Visit', code: 'OPD-003', dept: 'OPD-GEN', price: 200, tax: true },
    { name: 'Emergency Consultation', code: 'EMR-001', dept: 'EMERG', price: 500, tax: true },
    { name: 'CBC', code: 'LAB-001', dept: 'LAB', price: 300, tax: true },
    { name: 'ESR', code: 'LAB-002', dept: 'LAB', price: 150, tax: true },
    { name: 'FBS', code: 'LAB-003', dept: 'LAB', price: 200, tax: true },
    { name: 'Lipid Profile', code: 'LAB-004', dept: 'LAB', price: 500, tax: true },
    { name: 'LFT', code: 'LAB-005', dept: 'LAB', price: 600, tax: true },
    { name: 'KFT', code: 'LAB-006', dept: 'LAB', price: 600, tax: true },
    { name: 'TSH', code: 'LAB-007', dept: 'LAB', price: 400, tax: true },
    { name: 'X-Ray Chest', code: 'RAD-001', dept: 'RAD', price: 350, tax: true },
    { name: 'Ultrasound Whole Abdomen', code: 'RAD-002', dept: 'RAD', price: 800, tax: true },
    { name: 'ECG', code: 'RAD-003', dept: 'RAD', price: 300, tax: true },
    { name: 'IPD Bed - General (per day)', code: 'IPD-001', dept: 'IPD-GEN', price: 1000, tax: false },
    { name: 'IPD Admission Fee', code: 'IPD-002', dept: 'IPD-GEN', price: 500, tax: false },
    { name: 'IPD Cabin AC (per day)', code: 'IPC-001', dept: 'IPD-CAB', price: 2000, tax: false },
    { name: 'IPD ICU (per day)', code: 'ICU-001', dept: 'IPD-ICU', price: 5000, tax: false },
    { name: 'Dental Consultation', code: 'DEN-001', dept: 'DENTAL', price: 300, tax: true },
    { name: 'Eye Consultation', code: 'EYE-001', dept: 'EYE', price: 400, tax: true },
    { name: 'Physio Consultation', code: 'PHY-001', dept: 'PHY', price: 400, tax: true },
    { name: 'Cardiology Consultation', code: 'CARD-001', dept: 'CARD', price: 600, tax: true },
    { name: 'Normal Delivery', code: 'PROC-001', dept: 'IPD-GEN', price: 5000, tax: false },
    { name: 'Caesarean Section', code: 'PROC-002', dept: 'IPD-GEN', price: 15000, tax: false },
  ];

  for (const item of items) {
    const deptId = deptIds[item.dept];
    if (deptId) {
      const existingItem = await db.$client.prepare(
        `SELECT id FROM billing_service_items
         WHERE tenant_id = ?
           AND item_code = ?
           AND COALESCE(is_active, 1) = 1
         LIMIT 1`
      ).bind(tenantId, item.code).first<{ id: number }>();
      if (existingItem?.id) continue;

      await db.$client.prepare(
        `INSERT INTO billing_service_items (item_name, item_code, service_department_id, price, tax_applicable, tax_percent, allow_discount, tenant_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(item.name, item.code, deptId, item.price, item.tax ? 1 : 0, item.tax ? 15 : 0, 1, tenantId).run();
    }
  }

  // Create default Price Category
  await db.$client.prepare(
    `INSERT INTO billing_price_categories (category_name, category_code, is_default, is_active, tenant_id)
     VALUES (?, ?, ?, ?, ?)`
  ).bind('General', 'GEN', 1, 1, tenantId).run();

  // Create default Scheme
  await db.$client.prepare(
    `INSERT INTO billing_schemes (scheme_name, scheme_code, scheme_type, default_discount_percent, is_active, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind('General', 'GEN', 'general', 0, 1, tenantId).run();

  // Create default Fiscal Year
  const currentYear = new Date().getFullYear();
  await db.$client.prepare(
    `INSERT INTO billing_fiscal_years (fiscal_year_name, start_date, end_date, is_current, is_active, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(`${currentYear}-${currentYear + 1}`, `${currentYear}-01-01`, `${currentYear + 1}-12-31`, 1, 1, tenantId).run();

  console.log(`✅ Billing defaults seeded for tenant ${tenantId}: ${departments.length} depts, ${items.length} items`);
}


const registerRoutes = new Hono<{ Bindings: Env }>();

const registerSchema = z.object({
  hospitalName: z.string().min(2, 'Hospital name must be at least 2 characters'),
  slug: z
    .string()
    .min(3, 'Slug must be at least 3 characters')
    .max(63, 'Slug must be at most 63 characters')
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Slug must be lowercase letters, numbers, or hyphens'),
  adminName: z.string().min(1, 'Admin name required'),
  adminEmail: z.string().email('Valid email required'),
  adminPassword: z.string().min(8, 'Password must be at least 8 characters')
    .refine(isStrongPassword, 'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number'),
});

const RESERVED_SLUGS = ['www', 'api', 'admin', 'super', 'mail', 'ftp', 'test', 'dev', 'app', 'dashboard', 'health'];

// ─── POST /api/register — Public hospital self-signup ─────────────────
registerRoutes.post('/', zValidator('json', registerSchema), async (c) => {
  const db = getDb(c.env.DB);
  const { hospitalName, slug, adminName, adminEmail, adminPassword } = c.req.valid('json');

  if (RESERVED_SLUGS.includes(slug.toLowerCase())) {
    return c.json({ error: 'This slug is reserved. Please choose another.' }, 400);
  }

  try {
    // Check slug uniqueness
    const existing = await db.$client.prepare(
      'SELECT id FROM tenants WHERE subdomain = ?'
    ).bind(slug).first();

    if (existing) {
      return c.json({ error: 'This slug is already taken. Please choose another.' }, 409);
    }

    // Check admin email uniqueness (global — same email cannot register twice)
    const existingEmail = await db.$client.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(adminEmail).first();

    if (existingEmail) {
      return c.json({ error: 'An account with this email already exists.' }, 409);
    }

    const passwordHash = await hashPassword(adminPassword);

    // Create tenant first to get the ID (with trial)
    const tenantResult = await db.$client.prepare(
      `INSERT INTO tenants (name, subdomain, status, plan, plan_price, billing_cycle, trial_ends_at, plan_started_at, created_at)
       VALUES (?, ?, ?, ?, 0, 'monthly', datetime('now', '+' || ? || ' days'), datetime('now'), datetime('now'))`
    ).bind(hospitalName, slug, 'active', 'starter', TRIAL_DAYS).run();

    const tenantId = tenantResult.meta.last_row_id;

    // Create hospital admin user
    const userResult = await db.$client.prepare(
      'INSERT INTO users (email, password_hash, name, role, tenant_id, created_at) VALUES (?, ?, ?, ?, ?, datetime("now"))'
    ).bind(adminEmail, passwordHash, adminName, 'hospital_admin', tenantId).run();

    const userId = userResult.meta.last_row_id;

    // Record trial start in subscription history
    try {
      await db.$client.prepare(
        `INSERT INTO subscription_history (tenant_id, plan, plan_price, billing_cycle, action, notes, created_at)
         VALUES (?, 'starter', 0, 'monthly', 'trial_start', ?, datetime('now'))`
      ).bind(tenantId, `${TRIAL_DAYS}-day trial started`).run();
    } catch {
      // subscription_history table might not exist yet — don't block registration
    }

    // Auto-seed billing departments and service items for new hospital
    await seedBillingDefaults(db, Number(tenantId));
    await seedAccountingDefaults(c.env.DB, Number(tenantId));
    await seedInventoryVendorDefaults(c.env.DB, Number(tenantId));
    await seedLabReagentDefaults(c.env.DB, Number(tenantId));

    // Auto-login: generate JWT
    const token = await generateToken(
      {
        userId: String(userId),
        role: 'hospital_admin',
        tenantId: String(tenantId),
        permissions: getPermissionsForRole('hospital_admin'),
      },
      c.env.JWT_SECRET,
      8
    );

    return c.json({
      message: 'Hospital registered successfully',
      slug,
      token,
      user: { id: userId, name: adminName, email: adminEmail, role: 'hospital_admin' },
      hospital: { id: tenantId, name: hospitalName, slug },
    }, 201);
  } catch (error) {
    console.error('Registration error:', error);
    return c.json({ error: 'Registration failed. Please try again.' }, 500);
  }
});

export default registerRoutes;
