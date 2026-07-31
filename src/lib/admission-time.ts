export type LegacyAdmissionNaiveSemantics = 'utc' | 'asia_dhaka' | 'infer';

export interface NormalizeLegacyAdmissionInstantInput {
  admissionDate: string;
  createdAt?: string | null;
  naiveSemantics?: LegacyAdmissionNaiveSemantics;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAIVE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const EXPLICIT_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const INFERENCE_TOLERANCE_MS = 5 * 60 * 1000;

interface NaiveParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

function parseParts(match: RegExpMatchArray): NaiveParts {
  const millisecond = match[7] ? Number(match[7].padEnd(3, '0')) : 0;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    millisecond,
  };
}

function utcMilliseconds(parts: NaiveParts): number {
  const value = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  const date = new Date(value);
  if (
    date.getUTCFullYear() !== parts.year
    || date.getUTCMonth() !== parts.month - 1
    || date.getUTCDate() !== parts.day
    || date.getUTCHours() !== parts.hour
    || date.getUTCMinutes() !== parts.minute
    || date.getUTCSeconds() !== parts.second
  ) {
    throw new RangeError('Admission timestamp contains an invalid calendar date or clock time');
  }
  return value;
}

function parseExplicitInstant(raw: string): string | null {
  if (!EXPLICIT_OFFSET.test(raw)) return null;
  const parsed = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) throw new RangeError('Invalid explicit admission timestamp');
  return parsed.toISOString();
}

function parseCreatedAtEvidence(value?: string | null): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const explicit = parseExplicitInstant(raw);
  if (explicit) return new Date(explicit).getTime();

  const naive = raw.match(NAIVE_TIMESTAMP);
  if (naive) return utcMilliseconds(parseParts(naive));

  return null;
}

function asUtcIso(parts: NaiveParts): string {
  return new Date(utcMilliseconds(parts)).toISOString();
}

function asDhakaWallTimeUtcIso(parts: NaiveParts): string {
  return new Date(utcMilliseconds(parts) - DHAKA_OFFSET_MS).toISOString();
}

export function normalizeLegacyAdmissionInstantUtc(
  input: NormalizeLegacyAdmissionInstantInput,
): string {
  const raw = String(input.admissionDate ?? '').trim();
  if (!raw) throw new TypeError('Admission timestamp cannot be empty');

  const explicit = parseExplicitInstant(raw);
  if (explicit) return explicit;

  const dateOnly = raw.match(DATE_ONLY);
  if (dateOnly) return asDhakaWallTimeUtcIso(parseParts(dateOnly));

  const naive = raw.match(NAIVE_TIMESTAMP);
  if (!naive) {
    throw new RangeError('Admission timestamp must be an ISO timestamp or YYYY-MM-DD HH:mm:ss value');
  }

  const parts = parseParts(naive);
  const semantics = input.naiveSemantics ?? 'infer';
  if (semantics === 'utc') return asUtcIso(parts);
  if (semantics === 'asia_dhaka') return asDhakaWallTimeUtcIso(parts);

  const createdAtMs = parseCreatedAtEvidence(input.createdAt);
  if (createdAtMs !== null) {
    const admissionWallClockMs = utcMilliseconds(parts);
    const wallClockDifference = admissionWallClockMs - createdAtMs;

    if (Math.abs(wallClockDifference) <= INFERENCE_TOLERANCE_MS) {
      return asUtcIso(parts);
    }

    if (Math.abs(wallClockDifference - DHAKA_OFFSET_MS) <= INFERENCE_TOLERANCE_MS) {
      return asDhakaWallTimeUtcIso(parts);
    }
  }

  return asDhakaWallTimeUtcIso(parts);
}
