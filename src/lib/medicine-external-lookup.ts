export type ExternalMedicineResult = {
  name: string;
  generic: string | null;
  manufacturer: string | null;
  strength: string | null;
  dosage_form: string | null;
  source: 'medex';
};

function cleanHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function isMissingMasterDrugTable(error: unknown): boolean {
  return error instanceof Error && /no such table: master_(drugs|generics|companies)/i.test(error.message);
}

function splitMedicineTitle(rawTitle: string): { name: string; strength: string | null; dosageForm: string | null } {
  const formMatch = rawTitle.match(/\(([^)]+)\)$/);
  const dosageForm = formMatch?.[1]?.trim() || null;
  const withoutForm = formMatch ? rawTitle.replace(/\s*\([^)]+\)$/, '').trim() : rawTitle.trim();
  const strengthMatch = withoutForm.match(
    /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|ml|iu|units?|%)\b(?:\s*\/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|ml|iu|units?|%))?(?:\s*\+\s*\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|gm|ml|iu|units?|%)\b)*/i,
  );
  const strength = strengthMatch?.[0]?.replace(/\s+/g, '') || null;
  const name = strength
    ? withoutForm.replace(strengthMatch![0], '').replace(/\s+/g, ' ').trim()
    : withoutForm;

  return { name: name || withoutForm, strength, dosageForm };
}

export async function fetchAndCacheMedexMedicines(db: D1Database, query: string): Promise<ExternalMedicineResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const response = await fetch(`https://medex.com.bd/search?search=${encodeURIComponent(q)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 HMS medicine catalog cache',
    },
  });
  if (!response.ok) return [];

  const html = await response.text();
  const regex = /<div class="search-result-title">.*?<a[^>]*>(.*?)<\/a>.*?<\/div>\s*<p>(.*?)<\/p>/gs;
  const results: ExternalMedicineResult[] = [];

  for (let match = regex.exec(html); match !== null; match = regex.exec(html)) {
    const rawTitle = cleanHtml(match[1] ?? '');
    const description = (match[2] ?? '').replace(/\n/g, ' ');
    if (!rawTitle) continue;

    const { name, strength, dosageForm } = splitMedicineTitle(rawTitle);
    const generic = /<i>\((.*?)\)<\/i>/.exec(description)?.[1]?.trim() || null;
    const manufacturer = /(?:is manufactured by|by)\s+([^<]+?)(?:\.|$)/.exec(description)?.[1]?.trim() || null;

    if (!name || results.some((item) => item.name.toLowerCase() === name.toLowerCase() && item.strength === strength && item.dosage_form === dosageForm)) {
      continue;
    }

    results.push({
      name,
      generic,
      manufacturer,
      strength,
      dosage_form: dosageForm,
      source: 'medex',
    });
  }

  for (const item of results) {
    try {
      let genericId: number | null = null;
      if (item.generic) {
        const existingGeneric = await db.prepare('SELECT id FROM master_generics WHERE name = ? COLLATE NOCASE')
          .bind(item.generic)
          .first<{ id: number }>();
        genericId = existingGeneric?.id ?? (await db.prepare('INSERT INTO master_generics (name) VALUES (?) RETURNING id')
          .bind(item.generic)
          .first<{ id: number }>())?.id ?? null;
      }

      let companyId: number | null = null;
      if (item.manufacturer) {
        const existingCompany = await db.prepare('SELECT id FROM master_companies WHERE name = ? COLLATE NOCASE')
          .bind(item.manufacturer)
          .first<{ id: number }>();
        companyId = existingCompany?.id ?? (await db.prepare('INSERT INTO master_companies (name) VALUES (?) RETURNING id')
          .bind(item.manufacturer)
          .first<{ id: number }>())?.id ?? null;
      }

      await db.prepare(`
        INSERT INTO master_drugs (brand_name, generic_id, company_id, form, strength)
        SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
          SELECT 1 FROM master_drugs
          WHERE brand_name = ? COLLATE NOCASE
            AND COALESCE(form, '') = COALESCE(?, '') COLLATE NOCASE
            AND COALESCE(strength, '') = COALESCE(?, '') COLLATE NOCASE
        )
      `).bind(
        item.name,
        genericId,
        companyId,
        item.dosage_form,
        item.strength,
        item.name,
        item.dosage_form,
        item.strength,
      ).run();
    } catch (error) {
      if (isMissingMasterDrugTable(error)) return results;
      throw error;
    }
  }

  return results;
}
