export interface DefaultInventoryVendorProfile {
  code: string;
  name: string;
  contactPerson: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  contactAddress?: string | null;
  city: string;
  country: string;
  creditPeriod: number;
}

export const DEFAULT_INVENTORY_VENDOR_PROFILES: DefaultInventoryVendorProfile[] = [
  {
    code: 'VND-ROCHE-DX',
    name: 'Roche Diagnostics Supplier',
    contactPerson: 'Procurement Desk',
    contactPhone: null,
    contactEmail: null,
    contactAddress: 'Diagnostics and reagent supplier profile',
    city: 'Dhaka',
    country: 'Bangladesh',
    creditPeriod: 30,
  },
  {
    code: 'VND-MINDRAY-BIO',
    name: 'Mindray Biomedical Supplier',
    contactPerson: 'Procurement Desk',
    contactPhone: null,
    contactEmail: null,
    contactAddress: 'Biomedical analyzer and device supplier profile',
    city: 'Dhaka',
    country: 'Bangladesh',
    creditPeriod: 30,
  },
  {
    code: 'VND-LAB-CONS',
    name: 'Local Lab Consumables Supplier',
    contactPerson: 'Procurement Desk',
    contactPhone: null,
    contactEmail: null,
    contactAddress: 'Local supplier for routine laboratory consumables',
    city: 'Dhaka',
    country: 'Bangladesh',
    creditPeriod: 15,
  },
  {
    code: 'VND-TUBE-NEEDLE',
    name: 'Tube & Needle Supplier',
    contactPerson: 'Procurement Desk',
    contactPhone: null,
    contactEmail: null,
    contactAddress: 'Supplier for sample collection tubes, syringes, and needles',
    city: 'Dhaka',
    country: 'Bangladesh',
    creditPeriod: 15,
  },
];

export async function seedInventoryVendorDefaults(
  db: D1Database,
  tenantId: string | number,
): Promise<{ created: number; skipped: number; total: number }> {
  let created = 0;
  let skipped = 0;

  for (const vendor of DEFAULT_INVENTORY_VENDOR_PROFILES) {
    const existing = await db.prepare(`
      SELECT VendorId
      FROM InventoryVendor
      WHERE tenant_id = ?
        AND (UPPER(COALESCE(VendorCode, '')) = UPPER(?) OR lower(trim(VendorName)) = lower(trim(?)))
      LIMIT 1
    `).bind(String(tenantId), vendor.code, vendor.name).first<{ VendorId: number }>();

    if (existing?.VendorId) {
      skipped += 1;
      continue;
    }

    await db.prepare(`
      INSERT INTO InventoryVendor (
        tenant_id, VendorName, VendorCode, ContactPerson, ContactPhone,
        ContactEmail, ContactAddress, City, Country, CreditPeriod,
        IsActive, IsTDSApplicable, TDSPercent, CreatedOn
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, datetime('now'))
    `).bind(
      String(tenantId),
      vendor.name,
      vendor.code,
      vendor.contactPerson,
      vendor.contactPhone ?? null,
      vendor.contactEmail ?? null,
      vendor.contactAddress ?? null,
      vendor.city,
      vendor.country,
      vendor.creditPeriod,
    ).run();

    created += 1;
  }

  return { created, skipped, total: DEFAULT_INVENTORY_VENDOR_PROFILES.length };
}
