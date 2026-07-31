export interface NIDValidationResult {
  valid: boolean;
  format: '10-digit' | '17-digit' | 'invalid';
  error?: string;
  birthMonth?: number;
  birthYear?: number;
}

export function validateBDNationalId(nid: string): NIDValidationResult {
  if (!/^\d+$/.test(nid)) {
    return { valid: false, format: 'invalid', error: 'NID must contain only digits' };
  }

  if (nid.length === 10) {
    return { valid: true, format: '10-digit' };
  }

  if (nid.length !== 17) {
    return { valid: false, format: 'invalid', error: 'NID must be 10 or 17 digits' };
  }

  const birthMonth = Number(nid.slice(9, 11));
  const shortYear = Number(nid.slice(11, 13));
  const birthYear = shortYear > 30 ? 1900 + shortYear : 2000 + shortYear;
  const currentYear = new Date().getUTCFullYear();

  if (birthMonth < 1 || birthMonth > 12) {
    return { valid: false, format: '17-digit', error: 'Invalid birth month in NID', birthMonth, birthYear };
  }

  if (birthYear > currentYear || birthYear < currentYear - 120) {
    return { valid: false, format: '17-digit', error: 'Invalid birth year in NID', birthMonth, birthYear };
  }

  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5, 6, 7, 8, 9];
  const sum = nid
    .slice(0, 16)
    .split('')
    .reduce((acc, digit, index) => acc + Number(digit) * weights[index], 0);

  let checksum = (11 - (sum % 11)) % 11;
  if (checksum === 10) checksum = 0;

  if (checksum !== Number(nid[16])) {
    return { valid: false, format: '17-digit', error: 'Invalid NID checksum', birthMonth, birthYear };
  }

  return { valid: true, format: '17-digit', birthMonth, birthYear };
}
