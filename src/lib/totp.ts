const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/, '').toUpperCase();
  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of cleaned) {
    const index = BASE32_CHARS.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(output);
}

export async function generateTotp(secret: string, time?: number): Promise<string> {
  const now = time ?? Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / 30);
  const keyBytes = base32Decode(secret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const counterBuffer = new ArrayBuffer(8);
  new DataView(counterBuffer).setUint32(4, counter, false);
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, counterBuffer),
  );
  const offset = signature[signature.length - 1] & 0x0f;
  const value = (
    ((signature[offset] & 0x7f) << 24)
    | (signature[offset + 1] << 16)
    | (signature[offset + 2] << 8)
    | signature[offset + 3]
  ) % 1_000_000;
  return String(value).padStart(6, '0');
}

export async function verifyTotp(
  secret: string,
  code: string,
  window = 1,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  for (let offset = -window; offset <= window; offset += 1) {
    if (await generateTotp(secret, now + offset * 30) === code) return true;
  }
  return false;
}
