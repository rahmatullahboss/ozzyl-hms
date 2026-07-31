/**
 * Haversine distance between two lat/lng points in kilometers.
 */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (lat1 === lat2 && lng1 === lng2) return 0;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Get day of week (0=Sunday, 6=Saturday) from a YYYY-MM-DD date string.
 */
export function getDayOfWeek(dateStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

/**
 * Build SQL LIKE clause for text search across multiple columns.
 */
export function buildSearchClause(
  query: string,
  columns: string[],
): { clause: string; params: string[] } {
  const term = `%${query.replace(/[%_]/g, '')}%`;
  const conditions = columns.map((col) => `${col} LIKE ?`).join(' OR ');
  const params = columns.map(() => term);
  return { clause: `(${conditions})`, params };
}

/**
 * Build pagination clause.
 */
export function buildPagination(page: number, limit: number): { clause: string; params: number[] } {
  const offset = (page - 1) * limit;
  return { clause: 'LIMIT ? OFFSET ?', params: [limit, offset] };
}
