const fs = require('fs');
const path = require('path');
const { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } = require('crypto');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function deriveKey(secret) {
  if (!secret) throw new Error('ASTM transmission journal encryption key is required');
  return createHash('sha256').update(String(secret), 'utf8').digest();
}

function filePath(dir, id) {
  return path.join(dir, `${id}.json`);
}

function encrypt(record, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 2,
    encrypted: true,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }, null, 2);
}

function decrypt(raw, key) {
  const envelope = JSON.parse(raw);
  if (!envelope || envelope.version !== 2 || envelope.encrypted !== true
      || envelope.algorithm !== 'aes-256-gcm' || !envelope.iv
      || !envelope.authTag || !envelope.ciphertext) {
    throw new Error('Invalid ASTM transmission journal envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

function fsyncDir(dir) {
  let fd;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    // Directory fsync is not available on every platform.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function atomicWrite(target, contents) {
  ensureDir(path.dirname(target));
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, target);
    fsyncDir(path.dirname(target));
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    try { fs.unlinkSync(temp); } catch { /* ignore */ }
    throw error;
  }
}

function createTransmissionJournal(dir, options = {}) {
  ensureDir(dir);
  const key = deriveKey(options.encryptionKey);

  function quarantine(target) {
    const corrupt = target.replace(/\.json$/, `.corrupt.${Date.now()}.json`);
    try {
      fs.renameSync(target, corrupt);
      fsyncDir(dir);
    } catch {
      // Preserve the unreadable file if quarantine cannot be completed.
    }
  }

  function load(id) {
    const target = filePath(dir, id);
    if (!fs.existsSync(target)) return null;
    try {
      return decrypt(fs.readFileSync(target, 'utf8'), key);
    } catch {
      quarantine(target);
      return null;
    }
  }

  function save(record) {
    atomicWrite(filePath(dir, record.id), encrypt(record, key));
    return record;
  }

  function start(id, metadata = {}) {
    const now = new Date().toISOString();
    return save({
      id,
      machineCode: metadata.machineCode || 'UNKNOWN',
      remoteAddress: metadata.remoteAddress || null,
      state: 'receiving',
      frameCount: 0,
      frames: [],
      message: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  function appendFrame(id, frameContent, isIntermediate) {
    const existing = load(id);
    if (!existing) throw new Error(`ASTM transmission journal not found: ${id}`);
    if (existing.state !== 'receiving') throw new Error(`ASTM transmission is not receiving: ${id}`);
    const updated = {
      ...existing,
      frameCount: Number(existing.frameCount || 0) + 1,
      frames: [...(existing.frames || []), String(frameContent)],
      lastFrameIntermediate: Boolean(isIntermediate),
      updatedAt: new Date().toISOString(),
    };
    return save(updated);
  }

  function markComplete(id, message) {
    const existing = load(id);
    if (!existing) throw new Error(`ASTM transmission journal not found: ${id}`);
    return save({
      ...existing,
      state: 'complete',
      message: String(message),
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  function markDelivered(id, metadata = {}) {
    const target = filePath(dir, id);
    const existing = load(id);
    if (!existing) return false;
    const delivered = {
      ...existing,
      state: 'delivered',
      deliveryId: metadata.deliveryId || null,
      queued: Boolean(metadata.queued),
      deliveredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    save(delivered);
    fs.unlinkSync(target);
    fsyncDir(dir);
    return true;
  }

  return { start, appendFrame, markComplete, markDelivered, load, dir };
}

module.exports = { createTransmissionJournal };
