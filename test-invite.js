const crypto = require('crypto');
function generateInviteToken() {
  const array = new Uint8Array(32);
  crypto.webcrypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function sha256Hex(input) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function run() {
  const token = generateInviteToken();
  const hash = await sha256Hex(token);
  console.log("Token:", token);
  console.log("Hash:", hash);
}
run();
