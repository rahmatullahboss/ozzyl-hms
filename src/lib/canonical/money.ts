export type MinorAmount = number & { readonly __minorAmountBrand: unique symbol };
export type SignedMinorAmount = number & { readonly __signedMinorAmountBrand: unique symbol };

export type DecimalAmount = string | number;

function decimalText(value: DecimalAmount): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new RangeError('Money amount must be finite');
    return String(value);
  }
  return value.trim();
}

function parseMinorUnits(value: DecimalAmount, allowNegative: boolean): number {
  const text = decimalText(value);
  if (!text) throw new TypeError('Money amount cannot be empty');
  if (/e/i.test(text)) throw new TypeError('Money amount must use plain decimal notation');

  const match = /^([+-]?)(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new TypeError('Money amount must contain at most two decimal places');

  const sign = match[1];
  if (sign === '-' && !allowNegative) {
    throw new RangeError('Negative money requires the signed reversal conversion');
  }

  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] ?? '').padEnd(2, '0'));
  let minor = whole * 100n + fraction;
  if (sign === '-') minor = -minor;

  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (minor > max || minor < -max) {
    throw new RangeError('Money minor units overflow the JavaScript safe integer range');
  }

  return Number(minor);
}

/** Converts a non-negative decimal amount to exact integer minor units. */
export function toMinorUnits(value: DecimalAmount): MinorAmount {
  return parseMinorUnits(value, false) as MinorAmount;
}

/** Explicit conversion for signed adjustments, credits, and reversals. */
export function toSignedMinorUnits(value: DecimalAmount): SignedMinorAmount {
  return parseMinorUnits(value, true) as SignedMinorAmount;
}
