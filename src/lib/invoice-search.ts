/**
 * Helpers for building SQL LIKE patterns that match a user-typed invoice
 * number forgivingly.
 *
 * Extracted from src/routes/tenant/global-search.ts so multiple route
 * handlers can share the same typo-tolerant match logic.
 */

export interface InvoiceSearchTerms {
  /** Raw trimmed query wrapped in % wildcards. */
  original: string;
  /** Query with letter o/O normalised to digit 0, wrapped in % wildcards. */
  normalized: string;
  /**
   * Query collapsed to uppercase letters/digits only and wrapped in % wildcards.
   * This lets searches tolerate extra/missing separators, e.g. `BL-0000-14`,
   * `BL000014`, and `BL 000014` all matching the same stored invoice.
   */
  compact: string;
  /**
   * Padded numeric pattern. When the query contains digits (after replacing
   * letter o/O with digit 0), this is those digits zero-padded to 6 and
   * wrapped in %. Otherwise it equals `original` (e.g. for blank input).
   * Long numeric strings stay unchanged because `padStart` is a no-op when
   * the input already meets the width.
   */
  padded: string;
}

export function buildInvoiceSearchTerms(raw: string): InvoiceSearchTerms {
  const trimmed = raw.trim();
  const zeroNormalized = trimmed.replace(/o/gi, '0');
  const original = `%${trimmed}%`;
  const normalized = `%${zeroNormalized}%`;
  const compactValue = zeroNormalized.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const compact = compactValue.length > 0 ? `%${compactValue}%` : original;

  const digitsOnly = zeroNormalized.replace(/\D/g, '');
  const padded =
    digitsOnly.length > 0
      ? `%${digitsOnly.padStart(6, '0')}%`
      : original;

  return { original, normalized, compact, padded };
}

/**
 * Build invoice patterns for the whole query plus comma/semicolon/newline
 * separated invoice references. This lets a user search several invoice
 * numbers at once, e.g. `14,289,23`.
 */
export function buildInvoiceSearchTermList(raw: string, maxParts = 12): InvoiceSearchTerms[] {
  const parts = [raw, ...raw.split(/[,;\n]+/)]
    .map((part) => part.trim())
    .filter(Boolean);
  const uniqueParts = Array.from(new Set(parts.map((part) => part.toLowerCase())))
    .map((lower) => parts.find((part) => part.toLowerCase() === lower) || lower)
    .slice(0, maxParts);

  if (uniqueParts.length === 0) return [buildInvoiceSearchTerms(raw)];
  return uniqueParts.map((part) => buildInvoiceSearchTerms(part));
}

/**
 * Escape `%` and `_` (SQL LIKE wildcards) in user input so they cannot be
 * used to widen an unintended scan. Callers should pass the escaped value
 * into the helper and also include `ESCAPE '\'` in the SQL clause.
 */
export function escapeLikeWildcards(raw: string): string {
  return raw.replace(/([%_\\])/g, '\\$1');
}
