const DR_PREFIX_TOKENS = ['Dr.', 'Dr', 'Doctor', 'ডাঃ', 'ডা.', 'ডা', 'ডক্টর'] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueTokens(prefix: string): string[] {
  const base = DR_PREFIX_TOKENS.map((t) => t.toLowerCase());
  const trimmed = prefix.trim();
  if (trimmed) {
    base.push(trimmed.toLowerCase());
    base.push(trimmed.replace(/\.+$/, '').toLowerCase());
  }
  return Array.from(new Set(base));
}

export function stripDrPrefix(name: string | null | undefined, prefix?: string): string {
  if (!name) return '';
  const re = new RegExp(`^(?:${uniqueTokens(prefix ?? '').map(escapeRegex).join('|')})\\s*`, 'i');
  let prev = name;
  let curr = prev.replace(re, '');
  while (curr !== prev) {
    prev = curr;
    curr = prev.replace(re, '');
  }
  return curr.trim();
}

export function formatDoctorName(name: string | null | undefined, prefix: string = 'Dr.'): string {
  const clean = stripDrPrefix(name, prefix);
  const trimmedPrefix = prefix.trim() || 'Dr.';
  return clean ? `${trimmedPrefix} ${clean}` : trimmedPrefix;
}

