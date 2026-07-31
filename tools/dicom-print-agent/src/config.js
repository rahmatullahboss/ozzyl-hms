// ═══════════════════════════════════════════════════════════════════════════════
// Ozzyl HMS — DICOM Print Agent: Configuration Loader
// ═══════════════════════════════════════════════════════════════════════════════

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

/**
 * Paper size presets in millimeters (width x height)
 * Used for scaling DICOM images to the correct print dimensions
 */
const PAPER_SIZES = {
  '8x10':  { width: 203, height: 254, label: '8×10 inch' },
  '10x12': { width: 254, height: 305, label: '10×12 inch' },
  '11x14': { width: 279, height: 356, label: '11×14 inch' },
  '14x17': { width: 356, height: 432, label: '14×17 inch' },
  'A4':    { width: 210, height: 297, label: 'A4' },
  'Letter':{ width: 216, height: 279, label: 'US Letter' },
};

const config = {
  // DICOM network
  dicomPort: parseInt(process.env.DICOM_PORT || '4006', 10),
  aeTitle: process.env.AE_TITLE || 'OZZYL_PRINT',

  // Printing
  printEnabled: process.env.PRINT_ENABLED !== 'false',
  printerName: process.env.PRINTER_NAME || '',
  paperSize: process.env.PAPER_SIZE || '14x17',
  paperDimensions: PAPER_SIZES[process.env.PAPER_SIZE || '14x17'] || PAPER_SIZES['14x17'],

  // Cloud sync
  cloudSyncEnabled: process.env.CLOUD_SYNC_ENABLED !== 'false',
  ozzylApiUrl: process.env.OZZYL_API_URL || '',
  ozzylApiKey: process.env.OZZYL_API_KEY || '',
  tenantId: process.env.TENANT_ID || '',

  // Storage
  storagePath: path.resolve(process.env.STORAGE_PATH || path.join(__dirname, '..', 'received')),

  // Logging
  logPath: path.resolve(process.env.LOG_PATH || path.join(__dirname, '..', 'logs')),
  logLevel: process.env.LOG_LEVEL || 'info',
};

// Validate critical config
function validate() {
  const warnings = [];
  if (config.printEnabled && !config.printerName) {
    warnings.push('PRINTER_NAME is empty — printing will use the OS default printer');
  }
  if (config.cloudSyncEnabled && !config.ozzylApiKey) {
    warnings.push('OZZYL_API_KEY is empty — cloud sync will fail');
  }
  if (config.cloudSyncEnabled && !config.tenantId) {
    warnings.push('TENANT_ID is empty — cloud sync will fail');
  }
  return warnings;
}

module.exports = { config, PAPER_SIZES, validate };
