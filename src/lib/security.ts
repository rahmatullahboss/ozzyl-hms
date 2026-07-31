/**
 * Safely stringify an object for use in a <script type="application/ld+json"> tag.
 * It escapes <, >, &, \u2028, and \u2029 to prevent XSS.
 */
export function safeJsonStringify(obj: any): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
