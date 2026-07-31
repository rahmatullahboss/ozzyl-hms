type MedicineUsageItem = {
  medicine_name: string;
  dosage?: string | null;
  frequency?: string | null;
  duration?: string | null;
  instructions?: string | null;
};

function normalizeKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildPrescriptionUsageStatsStatements(
  db: D1Database,
  tenantId: string,
  doctorId: number | null | undefined,
  items: MedicineUsageItem[],
  labTests: string[] = [],
): D1PreparedStatement[] {
  if (!doctorId) return [];

  const medicineStatements = items
    .filter((item) => item.medicine_name?.trim())
    .map((item) => {
      const name = item.medicine_name.trim();
      const strength = item.dosage?.trim() || null;
      const medicineKey = normalizeKey([name, strength].filter(Boolean).join('|'));

      return db.prepare(`
        INSERT INTO prescription_medicine_usage_stats (
          tenant_id, doctor_id, medicine_key, medicine_name, strength,
          default_frequency, default_duration, default_instructions,
          usage_count, last_used_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '+6 hours'), datetime('now', '+6 hours'), datetime('now', '+6 hours'))
        ON CONFLICT(tenant_id, doctor_id, medicine_key) DO UPDATE SET
          medicine_name = excluded.medicine_name,
          strength = COALESCE(excluded.strength, prescription_medicine_usage_stats.strength),
          default_frequency = COALESCE(excluded.default_frequency, prescription_medicine_usage_stats.default_frequency),
          default_duration = COALESCE(excluded.default_duration, prescription_medicine_usage_stats.default_duration),
          default_instructions = COALESCE(excluded.default_instructions, prescription_medicine_usage_stats.default_instructions),
          usage_count = prescription_medicine_usage_stats.usage_count + 1,
          last_used_at = datetime('now', '+6 hours'),
          updated_at = datetime('now', '+6 hours')
      `).bind(
        tenantId,
        doctorId,
        medicineKey,
        name,
        strength,
        item.frequency?.trim() || null,
        item.duration?.trim() || null,
        item.instructions?.trim() || null,
      );
    });

  const labStatements = [...new Set(labTests.map((test) => test.trim()).filter(Boolean))]
    .map((testName) =>
      db.prepare(`
        INSERT INTO prescription_lab_test_usage_stats (
          tenant_id, doctor_id, test_name, usage_count, last_used_at, created_at, updated_at
        ) VALUES (?, ?, ?, 1, datetime('now', '+6 hours'), datetime('now', '+6 hours'), datetime('now', '+6 hours'))
        ON CONFLICT(tenant_id, doctor_id, test_name) DO UPDATE SET
          usage_count = prescription_lab_test_usage_stats.usage_count + 1,
          last_used_at = datetime('now', '+6 hours'),
          updated_at = datetime('now', '+6 hours')
      `).bind(tenantId, doctorId, testName)
    );

  return [...medicineStatements, ...labStatements];
}
