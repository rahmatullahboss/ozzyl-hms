const DOSAGE_FORM_PREFIX = /^\s*(tab(?:let)?s?|caps?(?:ule)?s?|syp|syrup|inj(?:ection)?|drop|drops|cream|ointment|susp(?:ension)?|sol(?:ution)?)\s+/i;
const LEADING_BULLET = /^\s*(?:rx\b|[\d]+[.)-]?|[-*•])\s*/i;
const NORMALIZE_SPACING = /\s+/g;
const STRENGTH_PATTERN = /\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?)\b/i;

const NON_MEDICATION_PATTERNS = [
  /\bbp\s*[:=]/i,
  /\bfollow\s*up\b/i,
  /\badvice\b/i,
  /\bdrink\b/i,
  /\bwater\b/i,
  /\bbefore breakfast\b/i,
  /\bafter breakfast\b/i,
  /\bafter lunch\b/i,
  /\bafter dinner\b/i,
  /\bx\s*\d+\s*(?:day|days|week|weeks)\b/i,
  /\b\d+\+\d+\+\d+\b/,
] as const;

const titleCaseUnit = (unit: string) => unit.toLowerCase() === 'unit' || unit.toLowerCase() === 'units'
  ? 'units'
  : unit.toLowerCase();

const normalizeStrength = (text: string) =>
  text.replace(STRENGTH_PATTERN, (_, value: string, unit: string) => `${value} ${titleCaseUnit(unit)}`);

const cleanupLine = (line: string) =>
  normalizeStrength(
    line
      .replace(LEADING_BULLET, '')
      .replace(DOSAGE_FORM_PREFIX, '')
      .replace(NORMALIZE_SPACING, ' ')
      .trim(),
  );

export const buildReportedMedicationName = (medicineName: string, strength?: string | null): string => {
  const trimmedName = medicineName.trim();
  const trimmedStrength = strength?.trim();
  if (!trimmedStrength) return trimmedName;
  const normalizedName = trimmedName.toLowerCase().replace(/\s+/g, '');
  const normalizedStrength = trimmedStrength.toLowerCase().replace(/\s+/g, '');
  if (normalizedName.includes(normalizedStrength)) {
    return trimmedName;
  }
  return `${trimmedName} ${trimmedStrength}`.trim();
};

const extractCandidateFromLine = (line: string): string | undefined => {
  const cleaned = cleanupLine(line);
  if (!cleaned) return undefined;

  if (NON_MEDICATION_PATTERNS.some((pattern) => pattern.test(cleaned))) {
    return undefined;
  }

  const strengthMatch = cleaned.match(STRENGTH_PATTERN);
  if (!strengthMatch) return undefined;

  const strength = `${strengthMatch[1]} ${titleCaseUnit(strengthMatch[2])}`;
  const namePart = cleaned.slice(0, strengthMatch.index).trim();
  if (!namePart || namePart.length < 2) return undefined;
  if (/^[\d/+x.-]+$/i.test(namePart)) return undefined;

  return `${namePart} ${strength}`.replace(NORMALIZE_SPACING, ' ').trim();
};

export const extractMedicationCandidatesFromPrescriptionText = (rawText: string): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const line of rawText.split(/\r?\n/)) {
    const candidate = extractCandidateFromLine(line);
    if (!candidate) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
  }

  return output;
};
