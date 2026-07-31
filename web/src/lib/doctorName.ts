export function stripDoctorPrefix(value?: string | null): string | null {
  const normalized = String(value ?? '')
    .trim()
    .replace(/^(?:dr\.?\s*)+/i, '')
    .trim();
  return normalized || null;
}

export function formatDoctorDisplayName(value?: string | null): string | null {
  const name = stripDoctorPrefix(value);
  return name ? `Dr. ${name}` : null;
}
