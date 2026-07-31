type SettingValue = string | number | boolean | undefined;

const DEFAULT_DIVIDEND_ELIGIBLE_TYPES = ['owner', 'profit', 'investor', 'shareholder'];
const ALLOWED_DIVIDEND_ELIGIBLE_TYPES = new Set([...DEFAULT_DIVIDEND_ELIGIBLE_TYPES, 'doctor']);

export function getDividendEligibleTypes(settings: Record<string, SettingValue>): string[] {
  const raw = String(settings['dividend_eligible_types'] ?? '').trim();
  if (!raw) return [...DEFAULT_DIVIDEND_ELIGIBLE_TYPES];

  const parsed = raw
    .split(',')
    .map(value => value.trim())
    .filter(value => ALLOWED_DIVIDEND_ELIGIBLE_TYPES.has(value));

  return parsed.length > 0 ? [...new Set(parsed)] : [...DEFAULT_DIVIDEND_ELIGIBLE_TYPES];
}

export function allocateWholeTaka(totalAmount: number, rows: Array<{ id: number; weight: number }>): Map<number, number> {
  const totalWeight = rows.reduce((sum, row) => sum + Math.max(0, Number(row.weight || 0)), 0);
  const pool = Math.round(Math.max(0, totalAmount));
  const exactRows = rows.map((row) => {
    const weight = Math.max(0, Number(row.weight || 0));
    const exact = totalWeight > 0 ? (pool * weight) / totalWeight : 0;
    const floorAmount = Math.floor(exact);
    return { id: row.id, floorAmount, fraction: exact - floorAmount };
  });

  let residual = pool - exactRows.reduce((sum, row) => sum + row.floorAmount, 0);
  const allocation = new Map(exactRows.map(row => [row.id, row.floorAmount]));

  for (const row of [...exactRows].sort((a, b) => b.fraction - a.fraction || a.id - b.id)) {
    if (residual <= 0) break;
    allocation.set(row.id, (allocation.get(row.id) ?? 0) + 1);
    residual -= 1;
  }

  return allocation;
}
