/**
 * Bengali Number Parser Utility
 * Converts Bengali numerals (০১২৩৪৫৬৭৮৯) to English (0123456789)
 * Also handles common Bengali number formats
 */

const bengaliToEnglish: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

/**
 * Convert Bengali numerals to English
 */
export function bengaliToEnglishNumber(bengaliStr: string): string {
  if (!bengaliStr) return '';
  return bengaliStr.replace(/[০-৯]/g, (digit) => bengaliToEnglish[digit] || digit);
}

/**
 * Parse a Bengali number string to a JavaScript number
 * Handles formats like: "২০", "২০,০০০", "১ লক্ষ", "২ লাখ", "১.৫ কোটি"
 */
export function parseBengaliNumber(str: string): number {
  if (!str) return 0;

  // Convert Bengali digits to English
  let cleaned = bengaliToEnglishNumber(str);

  // Remove commas
  cleaned = cleaned.replace(/,/g, '');

  // Handle "কোটি" (crore) = 10,000,000 (check FIRST — larger multiplier)
  const croreMatch = cleaned.match(/([\d.]+)\s*(?:কোটি|crore)/i);
  if (croreMatch) {
    return parseFloat(croreMatch[1]) * 10000000;
  }

  // Handle "লক্ষ" / "লাখ" (lakh) = 100,000 (both spellings)
  const lakhMatch = cleaned.match(/([\d.]+)\s*(?:লক্ষ|লাখ|lakh)/i);
  if (lakhMatch) {
    return parseFloat(lakhMatch[1]) * 100000;
  }

  // Handle "হাজার" (thousand) = 1,000
  const thousandMatch = cleaned.match(/([\d.]+)\s*(?:হাজার|thousand)/i);
  if (thousandMatch) {
    return parseFloat(thousandMatch[1]) * 1000;
  }

  // Try to extract just the number
  const numMatch = cleaned.match(/[\d.]+/);
  if (numMatch) {
    return parseFloat(numMatch[0]);
  }

  return 0;
}

/**
 * Convert English number to Bengali
 */
export function englishToBengaliNumber(num: number | string): string {
  const englishToBengali: Record<string, string> = {
    '0': '০',
    '1': '১',
    '2': '২',
    '3': '৩',
    '4': '৪',
    '5': '৫',
    '6': '৬',
    '7': '৭',
    '8': '৮',
    '9': '৯',
  };

  return String(num).replace(/[0-9]/g, (digit) => englishToBengali[digit] || digit);
}

/**
 * Format number with Bengali numerals and commas
 */
export function formatBengaliCurrency(amount: number): string {
  const formatted = amount.toLocaleString('bn-BD');
  return `৳${formatted}`;
}

/**
 * Clean phone number (remove spaces, dashes, etc.)
 */
export function cleanPhoneNumber(phone: string): string {
  if (!phone) return '';
  // Convert Bengali digits first
  let cleaned = bengaliToEnglishNumber(phone);
  // Remove all non-digit characters except +
  cleaned = cleaned.replace(/[^\d+]/g, '');
  // Ensure it starts with 0 for BD numbers
  if (cleaned.length === 11 && !cleaned.startsWith('0')) {
    cleaned = '0' + cleaned;
  }
  return cleaned;
}

/**
 * Parse NID number (10, 13, or 17 digits)
 */
export function parseNID(nid: string): string {
  if (!nid) return '';
  return bengaliToEnglishNumber(nid).replace(/\D/g, '');
}
