import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { requireTenantId } from '../../lib/context-helpers';
import { updateSettingSchema, bulkUpdateSettingsSchema } from '../../schemas/clinical';
import { getDb } from '../../db';
import { normalizeShareholderSettings } from '../../lib/shareholder-settings';
import { resolveHospitalLogoDisplayUrl } from '../../lib/hospital-logo-url';
import { getUploadObjectForResponse } from '../../lib/upload-objects';


const settingsRoutes = new Hono<{
  Bindings: { DB: D1Database; UPLOADS: R2Bucket };
  Variables: { tenantId?: string; role?: string };
}>();

const DEFAULT_SETTINGS: Record<string, string> = {
  share_price: '100000',
  total_shares: '300',
  profit_percentage: '30',
  profit_partner_count: '100',
  owner_partner_count: '200',
  shares_per_profit_partner: '3',
  fire_service_charge: '50',
  ambulance_charge: '500',
  ipd_bed_charge_day_count_mode: 'rolling_24h',
  ipd_bed_charge_grace_hours: '3',
  ipd_bed_charge_partial_day_mode: 'full_day',
  ipd_bed_charge_half_day_after_hours: '0',
  ipd_bed_charge_half_day_ratio: '0.5',
  ipd_bed_charge_check_in_hour: '11',
  ipd_bed_charge_early_check_in_grace_hours: '2',
};

const HOSPITAL_INFO_KEYS = [
  'name',
  'short_name',
  'address',
  'phone',
  'email',
  'website',
  'registration_number',
  'bin_tin',
  'tagline',
  'footer_text',
] as const;
const NOTIFICATION_KEYS = ['low_stock', 'daily_summary', 'new_patient', 'failed_login'] as const;

export function buildHospitalInfo(settings: Record<string, string>) {
  return {
    name: settings.hospital_name ?? '',
    short_name: settings.hospital_short_name ?? '',
    address: settings.hospital_address ?? '',
    phone: settings.hospital_phone ?? '',
    email: settings.hospital_email ?? '',
    website: settings.hospital_website ?? '',
    registration_number: settings.hospital_registration_number ?? '',
    bin_tin: settings.hospital_bin_tin ?? '',
    tagline: settings.hospital_tagline ?? '',
    footer_text: settings.hospital_footer_text ?? '',
  };
}

function buildNotifications(settings: Record<string, string>) {
  return {
    low_stock: settings.notification_low_stock === 'true',
    daily_summary: settings.notification_daily_summary === 'true',
    new_patient: settings.notification_new_patient === 'true',
    failed_login: settings.notification_failed_login === 'true',
  };
}

export function flattenSettingsPayload(settings: Record<string, unknown>) {
  const {
    hospital_info: hospitalInfo,
    notifications,
    ...rawSettings
  } = settings;

  const flattened: Record<string, string | number | boolean> = normalizeShareholderSettings(
    rawSettings as Record<string, string | number | boolean>,
  );

  if (hospitalInfo && typeof hospitalInfo === 'object' && !Array.isArray(hospitalInfo)) {
    for (const key of HOSPITAL_INFO_KEYS) {
      const value = (hospitalInfo as Record<string, unknown>)[key];
      if (value !== undefined) {
        flattened[`hospital_${key}`] = String(value);
      }
    }
  }

  if (notifications && typeof notifications === 'object' && !Array.isArray(notifications)) {
    for (const key of NOTIFICATION_KEYS) {
      const value = (notifications as Record<string, unknown>)[key];
      if (typeof value === 'boolean') {
        flattened[`notification_${key}`] = value;
      }
    }
  }

  return flattened;
}

// ─── Get all settings ────────────────────────────────────────────────────────
settingsRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const settings = await db.$client.prepare(
      'SELECT * FROM settings WHERE tenant_id = ?'
    ).bind(tenantId).all();
    const tenant = await db.$client.prepare(
      'SELECT name FROM tenants WHERE id = ?'
    ).bind(tenantId).first<{ name: string }>();

    // Convert to key-value object
    const settingsObj: Record<string, string> = {};
    for (const row of settings.results as any[]) {
      settingsObj[row.key] = row.value;
    }

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (!settingsObj[key]) {
        settingsObj[key] = value;
      }
    }
    if (!settingsObj.hospital_name && tenant?.name) {
      settingsObj.hospital_name = tenant.name;
    }

    const normalizedSettings = normalizeShareholderSettings(settingsObj);

    // Add hospital logo URL if a logo key exists
    if (settingsObj['hospital_logo']) {
      normalizedSettings['hospital_logo_url'] = await resolveHospitalLogoDisplayUrl(c.env.DB, tenantId);
    }

    return c.json({
      settings: normalizedSettings,
      hospital_info: buildHospitalInfo(settingsObj),
      notifications: buildNotifications(settingsObj),
    });
  } catch (error) {
    return c.json({ error: 'Failed to fetch settings' }, 500);
  }
});

// ─── Upload hospital logo ────────────────────────────────────────────────────
// Accepts multipart/form-data with a "logo" file field.
// The image should be compressed client-side before uploading.
settingsRoutes.post('/logo', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Unauthorized' });

  const formData = await c.req.formData();
  const file = formData.get('logo');

  if (!file || typeof file === 'string') {
    throw new HTTPException(400, { message: 'No logo file provided' });
  }

  // At this point `file` is a File (Blob with name)
  const logoFile = file as unknown as File;

  // Validate file type
  const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
  if (!allowed.includes(logoFile.type)) {
    throw new HTTPException(400, { message: 'Invalid file type. Allowed: PNG, JPEG, WebP, SVG' });
  }

  // Max 2MB (client should compress, but enforce a server-side limit too)
  if (logoFile.size > 2 * 1024 * 1024) {
    throw new HTTPException(400, { message: 'File too large. Maximum 2MB.' });
  }

  const r2Key = `${tenantId}/hospital-logo`;

  try {
    // Upload to R2
    await c.env.UPLOADS.put(r2Key, logoFile.stream(), {
      httpMetadata: { contentType: logoFile.type },
    });

    // Save R2 key in D1
    await db.$client.prepare(
      'INSERT OR REPLACE INTO settings (key, value, tenant_id, updated_at) VALUES (?, ?, ?, datetime("now"))'
    ).bind('hospital_logo', r2Key, tenantId).run();

    return c.json({
      message: 'Logo uploaded successfully',
      logo_url: await resolveHospitalLogoDisplayUrl(c.env.DB, tenantId),
    });
  } catch (error) {
    console.error('[Settings] Logo upload failed:', error);
    return c.json({ error: 'Failed to upload logo' }, 500);
  }
});

// ─── Serve hospital logo ─────────────────────────────────────────────────────
settingsRoutes.get('/logo', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Unauthorized' });

  try {
    // Get R2 key from D1
    const row = await db.$client.prepare(
      'SELECT value FROM settings WHERE key = ? AND tenant_id = ?'
    ).bind('hospital_logo', tenantId).first<{ value: string }>();

    if (!row) {
      return c.json({ error: 'No logo set' }, 404);
    }

    const obj = await getUploadObjectForResponse(c.env as any, row.value);
    if (!obj) {
      return c.json({ error: 'Logo file not found' }, 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', obj.contentType ?? 'image/png');
    headers.set('Cache-Control', 'public, max-age=3600');

    return new Response(obj.body, { headers });
  } catch (error) {
    console.error('[Settings] Logo fetch failed:', error);
    return c.json({ error: 'Failed to fetch logo' }, 500);
  }
});

// ─── Delete hospital logo ────────────────────────────────────────────────────
settingsRoutes.delete('/logo', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  if (!tenantId) throw new HTTPException(401, { message: 'Unauthorized' });

  try {
    // Get R2 key
    const row = await db.$client.prepare(
      'SELECT value FROM settings WHERE key = ? AND tenant_id = ?'
    ).bind('hospital_logo', tenantId).first<{ value: string }>();

    if (row) {
      // Delete from R2
      await c.env.UPLOADS.delete(row.value);
      // Delete from D1
      await db.$client.prepare(
        'DELETE FROM settings WHERE key = ? AND tenant_id = ?'
      ).bind('hospital_logo', tenantId).run();
    }

    return c.json({ message: 'Logo removed' });
  } catch (error) {
    console.error('[Settings] Logo delete failed:', error);
    return c.json({ error: 'Failed to delete logo' }, 500);
  }
});

// ─── Update setting ──────────────────────────────────────────────────────────
settingsRoutes.put('/:key', zValidator('json', updateSettingSchema), async (c) => {
  const db = getDb(c.env.DB);
  const callerRole = c.get('role');
  if (callerRole !== 'hospital_admin' && callerRole !== 'director' && callerRole !== 'md') {
    return c.json({ error: 'Forbidden: Insufficient permissions to update settings' }, 403);
  }

  const key = c.req.param('key');
  const tenantId = requireTenantId(c);
  const { value } = c.req.valid('json');

  try {
    const entries = Object.entries(normalizeShareholderSettings({ [key]: value }));
    for (const [entryKey, entryValue] of entries) {
      await db.$client.prepare(
        'INSERT OR REPLACE INTO settings (key, value, tenant_id, updated_at) VALUES (?, ?, ?, datetime("now"))'
      ).bind(entryKey, String(entryValue), tenantId).run();
    }

    return c.json({ message: 'Setting updated' });
  } catch (error) {
    return c.json({ error: 'Failed to update setting' }, 500);
  }
});

// ─── Bulk update settings ────────────────────────────────────────────────────
settingsRoutes.put('/', zValidator('json', bulkUpdateSettingsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const callerRole = c.get('role');
  if (callerRole !== 'hospital_admin' && callerRole !== 'director' && callerRole !== 'md') {
    return c.json({ error: 'Forbidden: Insufficient permissions to update settings' }, 403);
  }

  const tenantId = requireTenantId(c);
  const settings = flattenSettingsPayload(c.req.valid('json'));

  try {
    for (const [key, value] of Object.entries(settings)) {
      await db.$client.prepare(
        'INSERT OR REPLACE INTO settings (key, value, tenant_id, updated_at) VALUES (?, ?, ?, datetime("now"))'
      ).bind(key, String(value), tenantId).run();
    }

    return c.json({ message: 'Settings updated' });
  } catch (error) {
    return c.json({ error: 'Failed to update settings' }, 500);
  }
});

export default settingsRoutes;
