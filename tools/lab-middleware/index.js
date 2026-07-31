/**
 * Ozzyl Lab Middleware — ASTM + HL7 Bridge
 *
 * Runs on the hospital's local network (Dell R730 server).
 * Listens for ASTM LIS2-A2 and HL7 MLLP connections from lab analyzers,
 * parses messages, and forwards to Ozzyl HMS cloud API.
 *
 * Supported machines: Mindray, Beckman, Sysmex, Bio-Rad, Roche, Siemens, Abbott
 *
 * Usage:
 *   1. cp config.example.json config.json
 *   2. Edit config.json with your hospital's API key and machine IPs
 *   3. npm install
 *   4. npm start
 */

const net = require('net');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createRetryQueue } = require('./retry-queue.cjs');
const { createTransmissionJournal } = require('./transmission-journal.cjs');
const { validateAstmChecksum } = require('./astm-frame.cjs');
const { createSignedHeaders } = require('./bridge-signing.cjs');
const { buildHl7Ack, resolveHl7AckDecision, wrapMllp } = require('./hl7-ack.cjs');
const { buildBridgeHeartbeatPayload } = require('./bridge-heartbeat.cjs');
require('dotenv').config();

// ─── Config ─────────────────────────────────────────────────────────────────

let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
} catch {
  console.error('[!] config.json not found. Copy config.example.json to config.json and edit it.');
  process.exit(1);
}

const API_BASE = process.env.API_BASE_URL || config.api.baseUrl;
const BRIDGE_KEY = process.env.LIS_BRIDGE_API_KEY || process.env.API_KEY || config.api.apiKey;
const BRIDGE_KEY_ID = process.env.LIS_BRIDGE_KEY_ID || config.api.keyId;
const BRIDGE_SIGNING_SECRET = process.env.LIS_BRIDGE_SIGNING_SECRET || config.api.signingSecret;
const QUEUE_ENCRYPTION_KEY = process.env.LIS_BRIDGE_QUEUE_ENCRYPTION_KEY || config.queue?.encryptionKey;
const RAW_MESSAGE_LOGGING_ENABLED = String(process.env.LIS_BRIDGE_RAW_MESSAGE_LOGGING ?? config.logging?.rawMessages ?? 'false').toLowerCase() === 'true';
const HL7_ACK_MODE = process.env.LIS_HL7_ACK_MODE || config.hl7?.ackMode || 'always_ack_after_queue';

if ((BRIDGE_KEY_ID && !BRIDGE_SIGNING_SECRET) || (!BRIDGE_KEY_ID && BRIDGE_SIGNING_SECRET)) {
  throw new Error('Both LIS bridge keyId and signingSecret must be configured together');
}
if (!BRIDGE_KEY_ID && !BRIDGE_KEY) {
  throw new Error('No LIS bridge authentication credential is configured');
}

// ─── Logging ────────────────────────────────────────────────────────────────

const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const QUEUE_DIR = process.env.LIS_BRIDGE_QUEUE_DIR || config.queue?.dir || path.join(__dirname, 'queue');
const TRANSMISSION_JOURNAL_DIR = process.env.LIS_BRIDGE_JOURNAL_DIR || config.queue?.journalDirectory || path.join(__dirname, 'journal');
const QUEUE_RETRY_INTERVAL_MS = Number(process.env.LIS_BRIDGE_RETRY_INTERVAL_MS || config.queue?.retryIntervalMs || 30_000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.LIS_BRIDGE_HEARTBEAT_INTERVAL_MS || config.agent?.heartbeatIntervalMs || 60_000);
const queue = createRetryQueue(QUEUE_DIR, {
  maxAttempts: Number(process.env.LIS_BRIDGE_QUEUE_MAX_ATTEMPTS || config.queue?.maxAttempts || 10),
  baseDelayMs: Number(process.env.LIS_BRIDGE_QUEUE_BASE_DELAY_MS || config.queue?.baseDelayMs || 30_000),
  maxDelayMs: Number(process.env.LIS_BRIDGE_QUEUE_MAX_DELAY_MS || config.queue?.maxDelayMs || 15 * 60_000),
  encryptionKey: QUEUE_ENCRYPTION_KEY,
});
const transmissionJournal = createTransmissionJournal(TRANSMISSION_JOURNAL_DIR, {
  encryptionKey: QUEUE_ENCRYPTION_KEY,
});

function log(level, msg, data) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
  console.log(line);
  fs.appendFileSync(path.join(LOG_DIR, 'middleware.log'), line + '\n');
}

// ─── HTTP Client + persistent retry queue ───────────────────────────────────

async function sendToAPI(endpoint, payload, deliveryId = randomUUID()) {
  const url = API_BASE + endpoint;
  const bodyText = JSON.stringify(payload);
  const authHeaders = BRIDGE_KEY_ID
    ? createSignedHeaders({
        keyId: BRIDGE_KEY_ID,
        secret: BRIDGE_SIGNING_SECRET,
        method: 'POST',
        path: endpoint,
        body: bodyText,
        deliveryId,
      })
    : { ['X-LIS-' + 'Bridge-Key']: BRIDGE_KEY };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: bodyText,
    });
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    if (!res.ok) {
      log('ERROR', 'API ' + res.status, { url, status: res.status, deliveryId });
      return { ok: false, status: res.status, body, deliveryId };
    }
    log('INFO', 'API OK', { url, message: body?.message, logId: body?.logId, deliveryId });
    return { ok: true, body, deliveryId };
  } catch (err) {
    log('ERROR', 'API fetch failed: ' + err.message, { url, deliveryId });
    return { ok: false, error: err.message, deliveryId };
  }
}
function shouldQueueResult(result) {
  if (result.ok) return false;
  if (result.error) return true;
  const status = Number(result.status || 0);
  return status === 429 || status >= 500;
}

async function postToAPI(endpoint, payload) {
  const deliveryId = randomUUID();
  const result = await sendToAPI(endpoint, payload, deliveryId);
  const retryable = shouldQueueResult(result);
  if (retryable) {
    const queuedItem = queue.enqueue(
      endpoint,
      payload,
      result.error || result.status || 'api_failure',
      { deliveryId },
    );
    log('WARN', `Queued LIS payload for retry`, { id: queuedItem.id, endpoint, queueDir: queue.queueDir });
    return { ...result, queued: true, retryable: true, queueId: queuedItem.id };
  }
  if (!result.ok) {
    log('ERROR', `LIS payload rejected and will not be retried`, { endpoint, status: result.status });
  }
  return { ...result, queued: false, retryable: false };
}

async function processRetryQueue() {
  const dueItems = queue.due();
  if (dueItems.length === 0) return;

  log('INFO', `Retrying queued LIS payloads`, { count: dueItems.length });
  for (const { filePath, item } of dueItems) {
    const result = await sendToAPI(item.endpoint, item.payload, item.deliveryId || item.id);
    if (result.ok) {
      queue.markDelivered(filePath);
      log('INFO', `Queued LIS payload delivered`, { id: item.id, endpoint: item.endpoint });
      continue;
    }

    const retry = queue.markFailed(filePath, item, result.error || result.status || 'api_failure');
    log(retry.terminal ? 'ERROR' : 'WARN', `Queued LIS payload retry failed`, {
      id: item.id,
      endpoint: item.endpoint,
      attempts: retry.attempts,
      nextAttemptAt: retry.nextAttemptAt,
      terminal: retry.terminal,
    });
  }
}

function startRetryQueueWorker() {
  log('INFO', `LIS retry queue ready`, { queueDir: queue.queueDir, intervalMs: QUEUE_RETRY_INTERVAL_MS });
  setInterval(() => {
    processRetryQueue().catch((err) => log('ERROR', `Retry queue worker failed: ${err.message}`));
  }, QUEUE_RETRY_INTERVAL_MS).unref?.();
}

async function sendBridgeHeartbeat(lastError) {
  const payload = buildBridgeHeartbeatPayload({
    config,
    queueDepth: queue.list().length,
    queueDir: queue.queueDir,
    ackMode: HL7_ACK_MODE,
    lastError,
  });
  const result = await sendToAPI('/api/lab-machines/bridge-agents/heartbeat', payload);
  if (!result.ok) {
    log('WARN', `LIS bridge heartbeat failed`, { status: result.status, error: result.error });
  }
  return result;
}

function startBridgeHeartbeatWorker() {
  log('INFO', `LIS bridge heartbeat ready`, { intervalMs: HEARTBEAT_INTERVAL_MS });
  setInterval(() => {
    sendBridgeHeartbeat().catch((err) => log('ERROR', `Heartbeat worker failed: ${err.message}`));
  }, HEARTBEAT_INTERVAL_MS).unref?.();
}

// ─── ASTM Protocol Handler ──────────────────────────────────────────────────
// ASTM E1381 frame protocol:
//   ENQ (0x05) → ACK (0x06)
//   STX (0x02) + frame_number + data + ETX (0x03) or ETB (0x17) + checksum + CR LF
//   → ACK (0x06)
//   EOT (0x04) → end of transmission

const ENQ = 0x05;
const ACK = 0x06;
const NAK = 0x15;
const STX = 0x02;
const ETX = 0x03;
const ETB = 0x17;
const EOT = 0x04;
const CR = 0x0D;
const LF = 0x0A;

function startASTMServer(port) {
  const server = net.createServer((socket) => {
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    log('INFO', `ASTM connection from ${remoteAddr}`);

    const machineConfig = (config.astm.machines || []).find(
      m => socket.remoteAddress && socket.remoteAddress.includes(m.ip)
    );
    const machineCode = machineConfig ? machineConfig.machineCode : 'UNKNOWN';

    let messageBuffer = '';     // accumulated record data
    let frameBuffer = Buffer.alloc(0);
    let currentRecord = '';     // for multi-frame (ETB) reassembly
    let checksumErrors = 0;
    let transmissionId = null;

    socket.on('data', async (data) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      frameBuffer = Buffer.concat([frameBuffer, chunk]);

      while (frameBuffer.length > 0) {
        const byte = frameBuffer[0];

        if (byte === ENQ) {
          transmissionId = randomUUID();
          try {
            transmissionJournal.start(transmissionId, { machineCode, remoteAddress: remoteAddr });
          } catch (err) {
            log('ERROR', `ASTM journal start failed for ${machineCode}: ${err.message}`);
            socket.write(Buffer.from([NAK]));
            socket.destroy();
            return;
          }
          socket.write(Buffer.from([ACK]));
          frameBuffer = frameBuffer.slice(1);
          messageBuffer = '';
          currentRecord = '';
          checksumErrors = 0;
          log('INFO', `ASTM ENQ from ${machineCode}, journaled session and sent ACK`, { transmissionId });
        } else if (byte === STX) {
          // Data frame: STX + frame_num + data + ETX/ETB + checksum(2) + CR + LF
          // Find ETX or ETB
          const etxIdx = frameBuffer.indexOf(ETX, 1);
          const etbIdx = frameBuffer.indexOf(ETB, 1);
          let endIdx = -1;
          let isIntermediate = false;

          if (etxIdx >= 0 && etbIdx >= 0) {
            endIdx = Math.min(etxIdx, etbIdx);
            isIntermediate = etbIdx < etxIdx;
          } else if (etxIdx >= 0) {
            endIdx = etxIdx;
          } else if (etbIdx >= 0) {
            endIdx = etbIdx;
            isIntermediate = true;
          }

          if (endIdx < 0) break; // Wait for more data

          // Extract frame content (frame_number + data, between STX and ETX/ETB)
          const frameNumberAndData = frameBuffer.slice(1, endIdx).toString(); // after STX, before ETX/ETB
          const frameContent = frameNumberAndData.slice(1); // skip frame number
          const terminator = frameBuffer[endIdx];

          // Validate checksum
          let checksumValid = true;
          if (frameBuffer.length > endIdx + 2) {
            const expectedCS = frameBuffer.slice(endIdx + 1, endIdx + 3).toString().toUpperCase();
            const checksum = validateAstmChecksum(frameNumberAndData, terminator, expectedCS);
            if (!checksum.valid) {
              checksumErrors++;
              checksumValid = false;
              log('WARN', `ASTM checksum mismatch from ${machineCode}: expected=${checksum.expected} actual=${checksum.actual} (frame #${checksumErrors})`);
              // NAK on checksum failure — analyzer will retry
              socket.write(Buffer.from([NAK]));
            }
          }

          // Skip past frame: STX...ETX/ETB + checksum(2) + CR + optional LF
          let skipTo = endIdx + 1;
          while (skipTo < frameBuffer.length && frameBuffer[skipTo] !== STX && frameBuffer[skipTo] !== EOT && frameBuffer[skipTo] !== ENQ) {
            skipTo++;
          }
          frameBuffer = frameBuffer.slice(skipTo);

          if (!checksumValid) continue; // Don't accumulate bad frames

          try {
            if (!transmissionId) {
              transmissionId = randomUUID();
              transmissionJournal.start(transmissionId, { machineCode, remoteAddress: remoteAddr });
            }
            transmissionJournal.appendFrame(transmissionId, frameContent, isIntermediate);
          } catch (err) {
            log('ERROR', `ASTM frame journal failed for ${machineCode}: ${err.message}`, { transmissionId });
            socket.write(Buffer.from([NAK]));
            socket.destroy();
            return;
          }

          // Multi-frame reassembly only after the frame is durably journaled.
          currentRecord += frameContent;

          if (isIntermediate) {
            // ETB = intermediate frame — more data coming for this record
            socket.write(Buffer.from([ACK]));
            log('DEBUG', `ASTM ETB intermediate frame from ${machineCode}, accumulating`);
          } else {
            // ETX = final frame — record complete
            messageBuffer += currentRecord + '\r';
            currentRecord = '';
            socket.write(Buffer.from([ACK]));
          }

          if (etxIdx >= 0) {
            // ETX = last frame of this record — record complete
          }
          // ETB = intermediate frame — continue collecting
        } else if (byte === EOT) {
          // End of transmission — process full message
          frameBuffer = frameBuffer.slice(1);
          log('INFO', `ASTM EOT from ${machineCode}, processing message (${messageBuffer.length} chars)`);

          if (messageBuffer.length > 0) {
            if (!transmissionId) {
              log('ERROR', `ASTM transmission missing journal identity for ${machineCode}`);
              socket.destroy();
              return;
            }
            try {
              transmissionJournal.markComplete(transmissionId, messageBuffer);
            } catch (err) {
              log('ERROR', `ASTM completion journal failed for ${machineCode}: ${err.message}`, { transmissionId });
              socket.destroy();
              return;
            }

            if (RAW_MESSAGE_LOGGING_ENABLED) {
              const logFile = path.join(LOG_DIR, `astm_${machineCode}_${Date.now()}.raw`);
              fs.writeFileSync(logFile, messageBuffer, { mode: 0o600 });
            }

            const result = await postToAPI('/api/lab-machines/astm/receive', {
              machineCode,
              message: messageBuffer,
            });

            if (result.ok || result.queued) {
              transmissionJournal.markDelivered(transmissionId, {
                deliveryId: result.deliveryId,
                queued: result.queued,
              });
            } else {
              log('WARN', `Failed to push ASTM results for ${machineCode}; completed journal retained`, { transmissionId });
            }
          }
          messageBuffer = '';
          transmissionId = null;
        } else {
          // Unexpected byte — skip
          frameBuffer = frameBuffer.slice(1);
        }
      }
    });

    socket.on('error', (err) => log('ERROR', `ASTM socket error: ${err.message}`, { machineCode }));
    socket.on('close', () => log('INFO', `ASTM disconnected: ${machineCode}`));
  });

  server.listen(port, () => {
    log('INFO', `ASTM server listening on TCP port ${port}`);
    log('INFO', `Configured machines: ${(config.astm.machines || []).map(m => m.name).join(', ')}`);
  });

  server.on('error', (err) => log('ERROR', `ASTM server error: ${err.message}`));
  return server;
}

// ─── HL7 MLLP Handler ───────────────────────────────────────────────────────
// MLLP envelope: VT (0x0B) + HL7 message + FS (0x1C) + CR (0x0D)

const VT = 0x0B;  // Vertical Tab — start block
const FS = 0x1C;  // File Separator — end block

function startHL7Server(port) {
  const server = net.createServer((socket) => {
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    log('INFO', `HL7 MLLP connection from ${remoteAddr}`);

    const machineConfig = (config.hl7.machines || []).find(
      m => socket.remoteAddress && socket.remoteAddress.includes(m.ip)
    );
    const machineCode = machineConfig ? machineConfig.machineCode : 'UNKNOWN';

    let dataBuffer = '';

    socket.on('data', async (data) => {
      dataBuffer += data.toString();

      // Look for complete MLLP messages: VT + message + FS + CR
      while (true) {
        const startIdx = dataBuffer.indexOf('\x0b');
        const endIdx = dataBuffer.indexOf('\x1c\x0d');
        if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) break;

        const hl7Message = dataBuffer.substring(startIdx + 1, endIdx);
        dataBuffer = dataBuffer.substring(endIdx + 2);

        log('INFO', `HL7 message from ${machineCode} (${hl7Message.length} chars)`);

        if (RAW_MESSAGE_LOGGING_ENABLED) {
          const logFile = path.join(LOG_DIR, `hl7_${machineCode}_${Date.now()}.raw`);
          fs.writeFileSync(logFile, hl7Message, { mode: 0o600 });
        }

        // Send to HMS API
        const result = await postToAPI('/api/lab-machines/hl7/receive', {
          machineCode,
          message: hl7Message,
        });

        // Send ACK back (simple ACK)
        const msh = hl7Message.split('\r')[0] || '';
        const fields = msh.split('|');
        const msgControlId = fields[9] || '';
        const decision = resolveHl7AckDecision(result, HL7_ACK_MODE);
        const ack = buildHl7Ack(hl7Message, decision);

        socket.write(wrapMllp(ack));
        log('INFO', `Sent HL7 ${decision.code} for ${msgControlId}`, { mode: HL7_ACK_MODE, text: decision.text, queued: result.queued });
      }
    });

    socket.on('error', (err) => log('ERROR', `HL7 socket error: ${err.message}`, { machineCode }));
    socket.on('close', () => log('INFO', `HL7 disconnected: ${machineCode}`));
  });

  server.listen(port, () => {
    log('INFO', `HL7 MLLP server listening on TCP port ${port}`);
    log('INFO', `Configured machines: ${(config.hl7.machines || []).map(m => m.name).join(', ')}`);
  });

  server.on('error', (err) => log('ERROR', `HL7 server error: ${err.message}`));
  return server;
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════════╗');
console.log('║   Ozzyl Lab Middleware — ASTM + HL7 Bridge   ║');
console.log('╚══════════════════════════════════════════════╝');
console.log(`API: ${API_BASE}`);
console.log('');

startRetryQueueWorker();
startBridgeHeartbeatWorker();
processRetryQueue().catch((err) => log('ERROR', `Initial retry queue pass failed: ${err.message}`));
sendBridgeHeartbeat().catch((err) => log('ERROR', `Initial heartbeat failed: ${err.message}`));

if (config.astm && config.astm.enabled) {
  startASTMServer(config.astm.port || 9100);
}

if (config.hl7 && config.hl7.enabled) {
  startHL7Server(config.hl7.port || 2575);
}

if ((!config.astm || !config.astm.enabled) && (!config.hl7 || !config.hl7.enabled)) {
  console.error('[!] No protocols enabled. Enable astm or hl7 in config.json.');
  process.exit(1);
}

// Graceful shutdown
process.on('SIGINT', () => {
  log('INFO', 'Shutting down...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  log('INFO', 'Shutting down...');
  process.exit(0);
});
