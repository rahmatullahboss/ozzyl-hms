const { createHash, createHmac, randomUUID } = require('crypto');

function sha256Hex(payload) {
  return createHash('sha256').update(String(payload ?? ''), 'utf8').digest('hex');
}

function buildCanonicalRequest(input) {
  const method = String(input.method || '').trim().toUpperCase();
  const requestPath = String(input.path || '').trim();
  const timestamp = Number(input.timestamp);
  const nonce = String(input.nonce || '').trim();
  const deliveryId = String(input.deliveryId || '').trim();
  const bodySha256 = String(input.bodySha256 || '').trim().toLowerCase();
  if (!method || !requestPath || !Number.isInteger(timestamp) || !nonce || !deliveryId || !/^[a-f0-9]{64}$/.test(bodySha256)) {
    throw new Error('Invalid LIS bridge signature input');
  }
  return [method, requestPath, String(timestamp), nonce, deliveryId, bodySha256].join('\n');
}

function createSignedHeaders(input) {
  const keyId = String(input.keyId || '').trim();
  const secret = String(input.secret || '');
  const method = String(input.method || 'POST').toUpperCase();
  const requestPath = String(input.path || '').trim();
  const body = String(input.body ?? '');
  const timestamp = Number.isInteger(input.timestamp) ? input.timestamp : Math.floor(Date.now() / 1000);
  const nonce = String(input.nonce || randomUUID());
  const deliveryId = String(input.deliveryId || randomUUID());
  if (!keyId || !secret || !requestPath) throw new Error('LIS bridge keyId, secret, and path are required');

  const bodySha256 = sha256Hex(body);
  const canonical = buildCanonicalRequest({ method, path: requestPath, timestamp, nonce, deliveryId, bodySha256 });
  const signature = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  return {
    'X-LIS-Key-Id': keyId,
    'X-LIS-Timestamp': String(timestamp),
    'X-LIS-Nonce': nonce,
    'X-LIS-Delivery-Id': deliveryId,
    'X-LIS-Body-SHA256': bodySha256,
    'X-LIS-Signature': signature,
  };
}

module.exports = {
  sha256Hex,
  buildCanonicalRequest,
  createSignedHeaders,
};
