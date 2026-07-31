import { z } from 'zod';

const BANGLA_DIGITS: Record<string, string> = {
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
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

function normalizeDigits(value: string): string {
  return Array.from(value, (digit) => BANGLA_DIGITS[digit] ?? digit).join("");
}

export function normalizeBangladeshMobile(value: string): string | null {
  const digits = normalizeDigits(value).replace(/\D/g, '');

  if (/^01[3-9]\d{8}$/.test(digits)) {
    return digits;
  }

  if (/^8801[3-9]\d{8}$/.test(digits)) {
    return `0${digits.slice(3)}`;
  }

  if (/^1[3-9]\d{8}$/.test(digits)) {
    return `0${digits}`;
  }

  return null;
}

export const bangladeshMobileSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeBangladeshMobile(value);
  if (!normalized) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Invalid Bangladesh mobile number',
    });
    return z.NEVER;
  }

  return normalized;
});

export const optionalBangladeshMobileSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value;
    return value.trim() === '' ? undefined : value;
  },
  bangladeshMobileSchema.optional(),
);
