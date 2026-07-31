/**
 * Barcode Validation & Normalization Utilities
 *
 * Supports EAN-13 and UPC-A barcode formats commonly used
 * in Bangladeshi packaged food products.
 */

/**
 * Validate a barcode string.
 * Accepts EAN-13 (13 digits) and UPC-A (12 digits).
 * Validates the check digit using the standard algorithm.
 */
export function validateBarcode(code: string): boolean {
  if (!code || typeof code !== 'string') return false;

  const cleaned = code.trim().replace(/\s/g, '');

  // Must be 12 (UPC-A) or 13 (EAN-13) digits
  if (!/^\d{12,13}$/.test(cleaned)) return false;

  // Normalize to 13 digits for check digit validation
  const ean13 = cleaned.length === 12 ? '0' + cleaned : cleaned;

  // EAN-13 check digit algorithm
  const digits = ean13.split('').map(Number);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  }
  const checkDigit = (10 - (sum % 10)) % 10;

  return checkDigit === digits[12];
}

/**
 * Normalize a barcode to EAN-13 format (13 digits).
 * Strips whitespace and pads 12-digit UPC-A to 13-digit EAN-13.
 */
export function normalizeBarcode(code: string): string {
  const cleaned = code.trim().replace(/\s/g, '');
  return cleaned.length === 12 ? '0' + cleaned : cleaned;
}

/**
 * Detect barcode type from string length.
 */
export function detectBarcodeType(code: string): 'ean13' | 'upc_a' | 'unknown' {
  const cleaned = code.trim().replace(/\s/g, '');
  if (/^\d{13}$/.test(cleaned)) return 'ean13';
  if (/^\d{12}$/.test(cleaned)) return 'upc_a';
  return 'unknown';
}
