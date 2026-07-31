import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  createLisBridgeRequestSignature,
  sha256Hex as serverSha256Hex,
} from '../src/lib/lis-bridge-signing';

const require = createRequire(import.meta.url);
const {
  buildCanonicalRequest,
  createSignedHeaders,
  sha256Hex,
} = require('../tools/lab-middleware/bridge-signing.cjs');

describe('local LIS bridge request signing', () => {
  it('creates deterministic headers over the exact HTTP body', () => {
    const body = JSON.stringify({ machineCode: 'M1', message: 'HL7' });
    const input = {
      keyId: 'key-1',
      secret: 'signed-' + 'secret',
      method: 'POST',
      path: '/api/lab-machines/hl7/receive',
      body,
      timestamp: 1_700_000_000,
      nonce: 'nonce-1',
      deliveryId: 'delivery-1',
    };

    const headers = createSignedHeaders(input);
    const bodyHash = sha256Hex(body);
    const canonical = buildCanonicalRequest({
      method: input.method,
      path: input.path,
      timestamp: input.timestamp,
      nonce: input.nonce,
      deliveryId: input.deliveryId,
      bodySha256: bodyHash,
    });
    const expectedSignature = createHmac('sha256', input.secret).update(canonical).digest('hex');

    expect(headers).toMatchObject({
      'X-LIS-Key-Id': 'key-1',
      'X-LIS-Timestamp': '1700000000',
      'X-LIS-Nonce': 'nonce-1',
      'X-LIS-Delivery-Id': 'delivery-1',
      'X-LIS-Body-SHA256': bodyHash,
      'X-LIS-Signature': expectedSignature,
    });
  });

  it('binds the signature to body, path and delivery identity', () => {
    const common = {
      keyId: 'key-1',
      secret: 'signed-' + 'secret',
      method: 'POST',
      timestamp: 1_700_000_000,
      nonce: 'nonce-1',
      deliveryId: 'delivery-1',
    };
    const first = createSignedHeaders({ ...common, path: '/a', body: '{"a":1}' });
    const bodyChanged = createSignedHeaders({ ...common, path: '/a', body: '{"a":2}' });
    const pathChanged = createSignedHeaders({ ...common, path: '/b', body: '{"a":1}' });
    const deliveryChanged = createSignedHeaders({ ...common, path: '/a', body: '{"a":1}', deliveryId: 'delivery-2' });

    expect(bodyChanged['X-LIS-Signature']).not.toBe(first['X-LIS-Signature']);
    expect(pathChanged['X-LIS-Signature']).not.toBe(first['X-LIS-Signature']);
    expect(deliveryChanged['X-LIS-Signature']).not.toBe(first['X-LIS-Signature']);
  });

  it('generates fresh nonce and delivery identifiers when omitted', () => {
    const first = createSignedHeaders({
      keyId: 'key-1', secret: 'secret', method: 'POST', path: '/a', body: '{}',
    });
    const second = createSignedHeaders({
      keyId: 'key-1', secret: 'secret', method: 'POST', path: '/a', body: '{}',
    });

    expect(first['X-LIS-Nonce']).not.toBe(second['X-LIS-Nonce']);
    expect(first['X-LIS-Delivery-Id']).not.toBe(second['X-LIS-Delivery-Id']);
  });

  it('matches the Worker signing implementation byte-for-byte', async () => {
    const secret = 'shared-' + 'signing-key';
    const body = JSON.stringify({ machineCode: 'M1', message: 'ORU' });
    const timestamp = 1_700_000_000;
    const nonce = 'nonce-compatible';
    const deliveryId = 'delivery-compatible';
    const path = '/api/lab-machines/hl7/receive';
    const client = createSignedHeaders({
      keyId: 'key-1', secret, method: 'POST', path, body, timestamp, nonce, deliveryId,
    });
    const bodySha256 = await serverSha256Hex(body);
    const serverSignature = await createLisBridgeRequestSignature(secret, {
      method: 'POST', path, timestamp, nonce, deliveryId, bodySha256,
    });

    expect(client['X-LIS-Body-SHA256']).toBe(bodySha256);
    expect(client['X-LIS-Signature']).toBe(serverSignature);
  });
});
