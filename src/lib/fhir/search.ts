// ═══════════════════════════════════════════════════════════════════════════════
// FHIR Search Parameter → SQL Helper
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Builds WHERE clauses and bind parameters from FHIR search query params.
 * Only appends conditions for params that are present and non-empty.
 */
export interface SearchClause {
  where: string[];
  params: (string | number)[];
}

export function buildSearchClauses(
  query: Record<string, string | undefined>,
  fieldMap: Record<string, { column: string; op: 'eq' | 'like' | 'date' | 'ref' }>
): SearchClause {
  const where: string[] = [];
  const params: (string | number)[] = [];

  for (const [param, config] of Object.entries(fieldMap)) {
    const value = query[param];
    if (!value) continue;

    switch (config.op) {
      case 'eq':
        where.push(`${config.column} = ?`);
        params.push(value);
        break;
      case 'like':
        where.push(`${config.column} LIKE ?`);
        params.push(`%${value}%`);
        break;
      case 'date':
        // Support FHIR date prefix: eq, ge, le, gt, lt
        if (value.startsWith('ge')) {
          where.push(`${config.column} >= ?`);
          params.push(value.slice(2));
        } else if (value.startsWith('le')) {
          where.push(`${config.column} <= ?`);
          params.push(value.slice(2));
        } else if (value.startsWith('gt')) {
          where.push(`${config.column} > ?`);
          params.push(value.slice(2));
        } else if (value.startsWith('lt')) {
          where.push(`${config.column} < ?`);
          params.push(value.slice(2));
        } else {
          // Default: exact date match (or eq prefix)
          const dateVal = value.startsWith('eq') ? value.slice(2) : value;
          where.push(`date(${config.column}) = ?`);
          params.push(dateVal);
        }
        break;
      case 'ref':
        // FHIR reference: "Patient/123" or just "123"
        where.push(`${config.column} = ?`);
        params.push(value.includes('/') ? value.split('/').pop()! : value);
        break;
    }
  }

  return { where, params };
}

/**
 * Parses _count parameter with default and max limit.
 */
export function parseCount(query: Record<string, string | undefined>, defaultLimit = 50, maxLimit = 200): number {
  const raw = query['_count'];
  if (!raw) return defaultLimit;
  const n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) return defaultLimit;
  return Math.min(n, maxLimit);
}
