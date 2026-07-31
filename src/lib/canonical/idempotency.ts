export class CanonicalIdempotencyConflictError extends Error {
  readonly code = 'CANONICAL_IDEMPOTENCY_CONFLICT';

  constructor(
    readonly tenantId: string,
    readonly idempotencyKey: string,
  ) {
    super(`Idempotency key already belongs to a different request: ${tenantId}/${idempotencyKey}`);
    this.name = 'CanonicalIdempotencyConflictError';
  }
}

export interface CanonicalCommandEnvelope<T> {
  schemaVersion: 1;
  command: {
    name: string;
    requestFingerprint: string;
    result: T;
  };
  event: unknown;
}

function serializeStable(value: unknown, active: WeakSet<object>, path: string): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`Canonical request must contain finite numbers at ${path}`);
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case 'undefined':
      throw new TypeError(`Canonical request cannot contain undefined at ${path}`);
    case 'bigint':
      throw new TypeError(`Canonical request cannot contain bigint at ${path}`);
    case 'function':
    case 'symbol':
      throw new TypeError(`Canonical request contains a non-serializable value at ${path}`);
    case 'object':
      break;
    default:
      throw new TypeError(`Canonical request contains a non-serializable value at ${path}`);
  }

  const object = value as object;
  if (active.has(object)) throw new TypeError(`Canonical request contains a circular reference at ${path}`);
  active.add(object);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError(`Canonical request cannot contain sparse arrays at ${path}`);
        }
        items.push(serializeStable(value[index], active, `${path}[${index}]`));
      }
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`Canonical request contains a non-plain serializable object at ${path}`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new TypeError(`Canonical request contains symbol keys at ${path}`);
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeStable(record[key], active, `${path}.${key}`)}`);
    return `{${entries.join(',')}}`;
  } finally {
    active.delete(object);
  }
}

export function stableCanonicalJson(value: unknown): string {
  return serializeStable(value, new WeakSet<object>(), '$');
}

export async function createRequestFingerprint(request: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableCanonicalJson(request));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function parseCanonicalCommandEnvelope<T>(payloadJson: string): CanonicalCommandEnvelope<T> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch (error) {
    throw new TypeError('Stored canonical idempotency payload is not valid JSON', { cause: error });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new TypeError('Stored canonical idempotency payload is not an object');
  }
  const envelope = parsed as Record<string, unknown>;
  const command = envelope.command;
  if (envelope.schemaVersion !== 1 || !command || typeof command !== 'object') {
    throw new TypeError('Stored canonical idempotency payload has an unsupported schema');
  }
  const commandRecord = command as Record<string, unknown>;
  if (
    typeof commandRecord.name !== 'string'
    || typeof commandRecord.requestFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(commandRecord.requestFingerprint)
    || !Object.prototype.hasOwnProperty.call(commandRecord, 'result')
  ) {
    throw new TypeError('Stored canonical idempotency command metadata is invalid');
  }

  return parsed as CanonicalCommandEnvelope<T>;
}
