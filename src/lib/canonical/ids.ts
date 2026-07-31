export type PublicId = string & { readonly __publicIdBrand: unique symbol };

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MAX_TIMESTAMP = (1n << 48n) - 1n;
const MAX_RANDOM = (1n << 80n) - 1n;

let lastTimestamp = -1n;
let lastRandom = 0n;

function encodeBase32(value: bigint, length: number): string {
  let remaining = value;
  let output = '';
  for (let index = 0; index < length; index += 1) {
    output = CROCKFORD_BASE32[Number(remaining & 31n)] + output;
    remaining >>= 5n;
  }
  if (remaining !== 0n) throw new RangeError('Value exceeds public ID encoding width');
  return output;
}

function random80Bits(): bigint {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

function validateTimestamp(nowMs: number): bigint {
  if (!Number.isInteger(nowMs) || nowMs < 0 || BigInt(nowMs) > MAX_TIMESTAMP) {
    throw new RangeError('Public ID timestamp must be a non-negative integer below 2^48');
  }
  return BigInt(nowMs);
}

/**
 * Creates a monotonic ULID-compatible 26-character public identifier.
 *
 * IDs generated in the same millisecond increment their random component. If the
 * process clock moves backwards, ordering remains monotonic by retaining the last
 * observed timestamp. Internal database IDs are never encoded in the result.
 */
export function createPublicId(nowMs: number = Date.now()): PublicId {
  let timestamp = validateTimestamp(nowMs);

  if (timestamp > lastTimestamp) {
    lastTimestamp = timestamp;
    lastRandom = random80Bits();
  } else {
    timestamp = lastTimestamp;
    if (lastRandom === MAX_RANDOM) {
      if (lastTimestamp === MAX_TIMESTAMP) {
        throw new RangeError('Public ID monotonic range exhausted');
      }
      lastTimestamp += 1n;
      timestamp = lastTimestamp;
      lastRandom = 0n;
    } else {
      lastRandom += 1n;
    }
  }

  return `${encodeBase32(timestamp, 10)}${encodeBase32(lastRandom, 16)}` as PublicId;
}
