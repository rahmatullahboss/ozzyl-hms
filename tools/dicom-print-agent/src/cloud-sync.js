// ═══════════════════════════════════════════════════════════════════════════════
// Ozzyl HMS — DICOM Print Agent: Cloud Sync Module
//
// Uploads received DICOM studies to the Ozzyl HMS cloud backend.
// Features:
//   - Registers DICOM study metadata via PACS API
//   - Uploads .dcm files to Cloudflare R2 via the upload endpoint
//   - Offline queue: stores pending uploads and retries when online
//   - Non-blocking: cloud sync failures don't affect printing
// ═══════════════════════════════════════════════════════════════════════════════

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { config } = require('./config');

// Queue for offline/failed uploads
const uploadQueue = [];
let isProcessingQueue = false;
let retryTimer = null;

// Stats
const syncStats = {
  uploaded: 0,
  failed: 0,
  pending: 0,
  lastSyncAt: null,
};

/**
 * Create an Axios instance configured for Ozzyl HMS API
 */
function createApiClient() {
  return axios.create({
    baseURL: config.ozzylApiUrl,
    timeout: 30000,
    headers: {
      Authorization: `Bearer ${config.ozzylApiKey}`,
      'Content-Type': 'application/json',
      'X-Tenant-ID': config.tenantId,
    },
  });
}

/**
 * Sync a received DICOM image to the Ozzyl HMS cloud.
 * This is called asynchronously after the image is saved locally.
 *
 * @param {object} imageInfo - Contains filePath and metadata
 * @param {string} imageInfo.filePath - Local path to the .dcm file
 * @param {object} imageInfo.metadata - DICOM metadata
 */
async function syncToCloud(imageInfo) {
  if (!config.cloudSyncEnabled) {
    logger.debug('Cloud sync disabled — skipping');
    return;
  }

  if (!config.ozzylApiKey || !config.tenantId) {
    logger.warn('Cloud sync config incomplete (API key or Tenant ID missing) — queuing');
    addToQueue(imageInfo);
    return;
  }

  try {
    const api = createApiClient();
    const { metadata, filePath } = imageInfo;

    // Step 1: Register the study in Ozzyl HMS
    logger.info(`Cloud sync: registering study ${metadata.studyInstanceUid.substring(0, 30)}...`);

    const studyPayload = {
      patient_id: metadata.patientId ? parseInt(metadata.patientId, 10) : undefined,
      patient_name: metadata.patientName || undefined,
      study_instance_uid: metadata.studyInstanceUid,
      sop_class_uid: metadata.sopClassUid || undefined,
      study_date: formatStudyDate(metadata.studyDate) || undefined,
      modality: metadata.modality || undefined,
      study_description: metadata.studyDescription || undefined,
    };

    // Remove undefined fields
    Object.keys(studyPayload).forEach((key) => {
      if (studyPayload[key] === undefined) delete studyPayload[key];
    });

    const registerRes = await api.post('/', studyPayload);
    const studyId = registerRes.data?.id;
    logger.info(`Study registered: ID=${studyId}`);

    // Step 2: Upload the DICOM file to R2
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      const r2Key = `dicom/${config.tenantId}/${metadata.studyInstanceUid}/${metadata.sopInstanceUid}.dcm`;

      logger.info(`Uploading to R2: ${r2Key} (${(fileBuffer.length / 1024).toFixed(1)} KB)`);

      await api.put(`/upload/${r2Key}`, fileBuffer, {
        headers: {
          'Content-Type': 'application/dicom',
          Authorization: `Bearer ${config.ozzylApiKey}`,
        },
        maxBodyLength: 50 * 1024 * 1024, // 50MB limit
      });

      logger.info(`Cloud sync complete: ${path.basename(filePath)}`);
    }

    syncStats.uploaded++;
    syncStats.lastSyncAt = new Date().toISOString();
  } catch (err) {
    const statusCode = err.response?.status;
    const errMsg = err.response?.data?.error || err.message;

    if (statusCode === 200 && err.response?.data?.message?.includes('already registered')) {
      // Study already exists — not an error
      logger.info(`Study already in cloud: ${imageInfo.metadata.studyInstanceUid.substring(0, 30)}...`);
      syncStats.uploaded++;
      return;
    }

    logger.error(`Cloud sync failed (${statusCode || 'network'}): ${errMsg}`);
    syncStats.failed++;

    // Add to retry queue
    addToQueue(imageInfo);
  }
}

/**
 * Format DICOM date (YYYYMMDD) to ISO date (YYYY-MM-DD)
 */
function formatStudyDate(dicomDate) {
  if (!dicomDate || dicomDate.length < 8) return null;
  const clean = dicomDate.replace(/[^0-9]/g, '');
  if (clean.length >= 8) {
    return `${clean.substring(0, 4)}-${clean.substring(4, 6)}-${clean.substring(6, 8)}`;
  }
  return null;
}

/**
 * Add a failed upload to the retry queue
 */
function addToQueue(imageInfo) {
  uploadQueue.push({
    ...imageInfo,
    attempts: (imageInfo.attempts || 0) + 1,
    queuedAt: new Date().toISOString(),
  });
  syncStats.pending = uploadQueue.length;
  logger.info(`Queued for retry: ${uploadQueue.length} pending uploads`);

  // Start retry timer if not already running
  if (!retryTimer) {
    retryTimer = setInterval(processQueue, 60000); // Retry every 60 seconds
    logger.info('Retry timer started (every 60s)');
  }
}

/**
 * Process the retry queue — attempt to upload queued items
 */
async function processQueue() {
  if (isProcessingQueue || uploadQueue.length === 0) return;
  isProcessingQueue = true;

  logger.info(`Processing upload queue: ${uploadQueue.length} pending`);

  // Process up to 5 items per cycle
  const batch = uploadQueue.splice(0, 5);
  for (const item of batch) {
    if (item.attempts > 10) {
      logger.warn(`Giving up on upload after 10 attempts: ${item.metadata?.sopInstanceUid}`);
      continue;
    }

    try {
      await syncToCloud(item);
    } catch {
      // syncToCloud already handles re-queuing on failure
    }
  }

  syncStats.pending = uploadQueue.length;
  isProcessingQueue = false;

  // Stop timer if queue is empty
  if (uploadQueue.length === 0 && retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
    logger.info('Upload queue empty — retry timer stopped');
  }
}

/**
 * Get sync statistics
 */
function getSyncStats() {
  return { ...syncStats, queueLength: uploadQueue.length };
}

module.exports = { syncToCloud, getSyncStats, processQueue };
