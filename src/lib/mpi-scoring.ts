// ═══════════════════════════════════════════════════════════════════════════════
// MPI Scoring — Probabilistic patient matching for cross-tenant deduplication
// ═══════════════════════════════════════════════════════════════════════════════

export const MATCH_WEIGHTS = {
  nid_exact: 100,
  phone_exact: 40,
  name_exact: 30,
  name_phonetic: 20,
  dob_exact: 25,
  gender_match: 5,
  blood_group_match: 5,
} as const;

export const AUTO_LINK_THRESHOLD = 90;
export const REVIEW_THRESHOLD = 50;

export interface IdentityFields {
  id: number;
  national_id?: string | null;
  primary_name?: string | null;
  primary_phone?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  blood_group?: string | null;
}

export interface PairScore {
  score: number;
  matchDetails: Record<string, number>;
}

/**
 * Lightweight phonetic normalizer for South Asian / Bangladeshi names.
 * Not Soundex (too English-centric). Instead:
 * - Lowercase, trim
 * - Strip diacritics
 * - Collapse doubled consonants (Mohammed → Mohamed)
 * - Normalize common Bengali romanization variants
 * - Strip trailing 'a', 'ah', 'ha' equivalence
 */
export function normalizePhonetic(name: string): string {
  let s = name
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Common romanization variants (BEFORE doubled-letter collapse)
  s = s
    .replace(/sh/g, 's')
    .replace(/ch/g, 'c')
    .replace(/th/g, 't')
    .replace(/ph/g, 'f')
    .replace(/kh/g, 'k')
    .replace(/gh/g, 'g')
    .replace(/dh/g, 'd')
    .replace(/bh/g, 'b')
    .replace(/zh/g, 'z')
    .replace(/oo/g, 'u')
    .replace(/ee/g, 'i')
    .replace(/ou/g, 'u');

  // Collapse doubled letters (AFTER digraph replacement)
  s = s.replace(/(.)\1+/g, '$1');

  // Strip trailing vowel variants
  s = s.replace(/[aeiou]h?$/g, '');

  // Remove spaces and hyphens for comparison
  s = s.replace(/[\s\-'.]/g, '');

  return s;
}

/**
 * Compute weighted match score between two identity records.
 * Returns aggregate score (0-100+) and per-field breakdown.
 */
export function computePairScore(a: IdentityFields, b: IdentityFields): PairScore {
  const matchDetails: Record<string, number> = {};
  let score = 0;

  // NID exact match — deterministic link
  if (a.national_id && b.national_id && a.national_id === b.national_id) {
    matchDetails.nid_exact = MATCH_WEIGHTS.nid_exact;
    score += MATCH_WEIGHTS.nid_exact;
    return { score: Math.min(score, 100), matchDetails };
  }

  // Phone exact
  if (a.primary_phone && b.primary_phone) {
    const pa = a.primary_phone.replace(/[\s\-+]/g, '').slice(-10);
    const pb = b.primary_phone.replace(/[\s\-+]/g, '').slice(-10);
    if (pa === pb && pa.length >= 10) {
      matchDetails.phone_exact = MATCH_WEIGHTS.phone_exact;
      score += MATCH_WEIGHTS.phone_exact;
    }
  }

  // Name matching
  if (a.primary_name && b.primary_name) {
    const na = a.primary_name.toLowerCase().trim();
    const nb = b.primary_name.toLowerCase().trim();
    if (na === nb) {
      matchDetails.name_exact = MATCH_WEIGHTS.name_exact;
      score += MATCH_WEIGHTS.name_exact;
    } else {
      // Phonetic comparison
      const pa = normalizePhonetic(a.primary_name);
      const pb = normalizePhonetic(b.primary_name);
      if (pa === pb && pa.length > 2) {
        matchDetails.name_phonetic = MATCH_WEIGHTS.name_phonetic;
        score += MATCH_WEIGHTS.name_phonetic;
      }
    }
  }

  // DOB exact
  if (a.date_of_birth && b.date_of_birth && a.date_of_birth === b.date_of_birth) {
    matchDetails.dob_exact = MATCH_WEIGHTS.dob_exact;
    score += MATCH_WEIGHTS.dob_exact;
  }

  // Gender
  if (a.gender && b.gender && a.gender.toLowerCase() === b.gender.toLowerCase()) {
    matchDetails.gender_match = MATCH_WEIGHTS.gender_match;
    score += MATCH_WEIGHTS.gender_match;
  }

  // Blood group
  if (a.blood_group && b.blood_group && a.blood_group === b.blood_group) {
    matchDetails.blood_group_match = MATCH_WEIGHTS.blood_group_match;
    score += MATCH_WEIGHTS.blood_group_match;
  }

  return { score: Math.min(score, 100), matchDetails };
}

/**
 * Convert a score to an action recommendation.
 */
export function scoreToAction(score: number): 'auto_link' | 'review' | 'ignore' {
  if (score >= AUTO_LINK_THRESHOLD) return 'auto_link';
  if (score >= REVIEW_THRESHOLD) return 'review';
  return 'ignore';
}
