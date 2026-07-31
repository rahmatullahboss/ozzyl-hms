const fs = require('fs');
const path = require('path');
const { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } = require('crypto');

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_BASE_DELAY_MS = 30_000;
const DEFAULT_MAX_DELAY_MS = 15 * 60_000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function safeId() {
  return `${Date.now()}_${process.pid}_${randomUUID()}`;
}

function itemPath(queueDir, id) {
  return path.join(queueDir, `${id}.json`);
}

function calculateBackoffMs(attempts, options = {}) {
  const baseDelayMs = Number(options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Number(options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const exponent = Math.max(0, Number(attempts || 0));
  const delay = baseDelayMs * Math.pow(2, exponent);
  return Math.min(delay, maxDelayMs);
}

function deriveEncryptionKey(secret) {
  if (!secret) return null;
  return createHash('sha256').update(String(secret), 'utf8').digest();
}

function encryptItem(item, encryptionKey) {
  if (!encryptionKey) return JSON.stringify(item, null, 2);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const plaintext = Buffer.from(JSON.stringify(item), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    version: 2,
    encrypted: true,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }, null, 2);
}

function decryptItem(raw, encryptionKey) {
  const parsed = JSON.parse(raw);
  if (!parsed || parsed.version !== 2 || parsed.encrypted !== true) return parsed;
  if (!encryptionKey) throw new Error('Encrypted LIS queue item cannot be opened without encryption key');
  if (parsed.algorithm !== 'aes-256-gcm' || !parsed.iv || !parsed.authTag || !parsed.ciphertext) {
    throw new Error('Invalid encrypted LIS queue envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(parsed.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(parsed.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

function fsyncDirectory(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    // Some filesystems do not permit fsync on directories; file fsync + rename still applies.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function atomicWrite(filePath, contents) {
  ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporaryPath, filePath);
    fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore close failure */ }
    }
    try { fs.unlinkSync(temporaryPath); } catch { /* ignore cleanup failure */ }
    throw error;
  }
}

function createRetryQueue(queueDir, options = {}) {
  ensureDir(queueDir);
  const maxAttempts = Number(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const encryptionKey = deriveEncryptionKey(options.encryptionKey);

  function writeItem(filePath, item) {
    atomicWrite(filePath, encryptItem(item, encryptionKey));
  }

  function enqueue(endpoint, payload, reason, metadata = {}) {
    const now = new Date().toISOString();
    const id = safeId();
    const item = {
      id,
      endpoint,
      payload,
      deliveryId: metadata.deliveryId || null,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      nextAttemptAt: now,
      lastError: reason || null,
    };
    writeItem(itemPath(queueDir, id), item);
    return item;
  }

  function quarantineCorrupt(filePath) {
    const quarantinedPath = filePath.replace(/\.json$/, `.corrupt.${Date.now()}.json`);
    try {
      fs.renameSync(filePath, quarantinedPath);
      fsyncDirectory(queueDir);
    } catch {
      // If quarantine fails, leave the file unreadable; list() will continue to exclude it this pass.
    }
    return quarantinedPath;
  }

  function list() {
    ensureDir(queueDir);
    return fs.readdirSync(queueDir)
      .filter((name) => name.endsWith('.json') && !name.includes('.failed.') && !name.includes('.corrupt.'))
      .sort()
      .map((name) => {
        const filePath = path.join(queueDir, name);
        try {
          const item = decryptItem(fs.readFileSync(filePath, 'utf8'), encryptionKey);
          if (!item || typeof item !== 'object' || !item.id || !item.endpoint || !('payload' in item)) {
            throw new Error('Invalid LIS queue item');
          }
          return { filePath, item };
        } catch {
          quarantineCorrupt(filePath);
          return null;
        }
      })
      .filter(Boolean);
  }

  function due(now = new Date()) {
    const nowMs = now.getTime();
    return list().filter(({ item }) => {
      const nextAttemptMs = Date.parse(item.nextAttemptAt || item.createdAt || '');
      return !Number.isFinite(nextAttemptMs) || nextAttemptMs <= nowMs;
    });
  }

  function markDelivered(filePath) {
    fs.unlinkSync(filePath);
    fsyncDirectory(queueDir);
  }

  function markFailed(filePath, item, errorMessage) {
    const attempts = Number(item.attempts || 0) + 1;
    const now = new Date();
    if (attempts >= maxAttempts) {
      const failedPath = filePath.replace(/\.json$/, `.failed.${Date.now()}.json`);
      writeItem(failedPath, {
        ...item,
        attempts,
        updatedAt: now.toISOString(),
        lastError: errorMessage,
        terminal: true,
      });
      fs.unlinkSync(filePath);
      fsyncDirectory(queueDir);
      return { terminal: true, attempts, filePath: failedPath };
    }

    const nextAttemptAt = new Date(now.getTime() + calculateBackoffMs(attempts, options)).toISOString();
    const updated = {
      ...item,
      attempts,
      updatedAt: now.toISOString(),
      nextAttemptAt,
      lastError: errorMessage,
    };
    writeItem(filePath, updated);
    return { terminal: false, attempts, nextAttemptAt };
  }

  return { enqueue, list, due, markDelivered, markFailed, queueDir };
}

module.exports = {
  createRetryQueue,
  calculateBackoffMs,
};
