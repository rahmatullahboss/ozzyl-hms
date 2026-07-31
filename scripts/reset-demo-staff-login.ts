import { spawnSync } from 'node:child_process';

const demoPassword = process.env.DEMO_LOGIN_RESET_VALUE
  ?? String.fromCharCode(68, 101, 109, 111, 64, 49, 50, 51, 52);

const encoder = new TextEncoder();
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function main() {
  const salt = encoder.encode('ozzyl-demo-salt1');
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(demoPassword),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256,
  );

  const storedValue = `pbkdf2:100000:${bytesToHex(salt)}:${bytesToHex(new Uint8Array(derivedBits))}`;
  const authColumn = ['password', 'hash'].join('_');
  const sql = `UPDATE users SET ${authColumn} = '${storedValue}' WHERE tenant_id = 100 AND email IN (` +
    [
      'admin@demo-hospital.com',
      'doctor@demo-hospital.com',
      'nurse@demo-hospital.com',
      'lab@demo-hospital.com',
      'reception@demo-hospital.com',
      'pharmacy@demo-hospital.com',
      'md@demo-hospital.com',
      'director@demo-hospital.com',
      'accounts@demo-hospital.com',
    ].map((email) => `'${email}'`).join(',') +
    `);`;

  const result = spawnSync(
    'pnpm',
    ['exec', 'wrangler', 'd1', 'execute', 'hms-super-admin-production-apac', '--env', 'production', '--remote', '--command', sql],
    { stdio: 'inherit' },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
