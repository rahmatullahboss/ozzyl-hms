// ═══════════════════════════════════════════════════════════════════════════════
// Ozzyl HMS — DICOM Print Agent: Printer Module
//
// Sends converted images to the local printer. Works with ANY printer
// installed on the OS — Epson, HP, Canon, Brother, etc.
//
// Windows: Uses pdf-to-printer (SumatraPDF engine)
// Linux/Mac: Uses lp/lpr commands
// ═══════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('./logger');
const { config } = require('./config');

// Print stats tracking
const printStats = {
  totalPrinted: 0,
  totalFailed: 0,
  lastPrintedAt: null,
  printHistory: [], // Last 100 print jobs
};

/**
 * Get list of available printers on the system
 * @returns {Promise<string[]>} Array of printer names
 */
async function getAvailablePrinters() {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      // Use pdf-to-printer on Windows
      const { getPrinters } = require('pdf-to-printer');
      const printers = await getPrinters();
      return printers.map((p) => p.name);
    } else if (platform === 'darwin') {
      // macOS
      const output = execSync('lpstat -a 2>/dev/null || true', { encoding: 'utf-8' });
      return output
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(' ')[0]);
    } else {
      // Linux
      const output = execSync('lpstat -a 2>/dev/null || true', { encoding: 'utf-8' });
      return output
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(' ')[0]);
    }
  } catch (err) {
    logger.error(`Failed to list printers: ${err.message}`);
    return [];
  }
}

/**
 * Print an image file to the configured local printer.
 *
 * @param {string} imagePath - Absolute path to the PNG/JPEG file to print
 * @param {object} metadata - DICOM metadata for logging
 * @param {object} options - Print options override
 * @param {string} options.printerName - Override printer name
 * @param {string} options.paperSize - Override paper size
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function printImage(imagePath, metadata = {}, options = {}) {
  if (!config.printEnabled) {
    logger.info('Printing disabled — skipping print job');
    return { success: true, message: 'Printing disabled' };
  }

  if (!fs.existsSync(imagePath)) {
    const msg = `Print file not found: ${imagePath}`;
    logger.error(msg);
    return { success: false, message: msg };
  }

  const printerName = options.printerName || config.printerName;
  const platform = process.platform;

  const jobInfo = {
    file: path.basename(imagePath),
    printer: printerName || '(default)',
    patient: metadata.patientName || 'Unknown',
    modality: metadata.modality || 'OT',
    timestamp: new Date().toISOString(),
  };

  logger.info(`Printing: ${jobInfo.file} → ${jobInfo.printer} [${jobInfo.patient}]`);

  try {
    if (platform === 'win32') {
      await printWindows(imagePath, printerName);
    } else if (platform === 'darwin') {
      printMac(imagePath, printerName);
    } else {
      printLinux(imagePath, printerName);
    }

    // Track success
    printStats.totalPrinted++;
    printStats.lastPrintedAt = jobInfo.timestamp;
    jobInfo.status = 'success';
    addToHistory(jobInfo);

    logger.info(`Print job sent successfully: ${jobInfo.file}`);
    return { success: true, message: 'Print job sent' };
  } catch (err) {
    // Track failure
    printStats.totalFailed++;
    jobInfo.status = 'failed';
    jobInfo.error = err.message;
    addToHistory(jobInfo);

    logger.error(`Print failed: ${err.message}`);
    return { success: false, message: err.message };
  }
}

/**
 * Print on Windows using pdf-to-printer (SumatraPDF engine)
 * Works with ANY Windows-installed printer
 */
async function printWindows(filePath, printerName) {
  const { print } = require('pdf-to-printer');

  const options = {};
  if (printerName) {
    options.printer = printerName;
  }
  // SumatraPDF can handle images directly
  options.scale = 'fit'; // Fit to page

  await print(filePath, options);
}

/**
 * Print on macOS using lpr command
 */
function printMac(filePath, printerName) {
  let cmd = 'lpr';
  if (printerName) {
    cmd += ` -P "${printerName}"`;
  }
  cmd += ` -o fit-to-page "${filePath}"`;
  execSync(cmd);
}

/**
 * Print on Linux using lpr command
 */
function printLinux(filePath, printerName) {
  let cmd = 'lpr';
  if (printerName) {
    cmd += ` -P "${printerName}"`;
  }
  cmd += ` -o fit-to-page "${filePath}"`;
  execSync(cmd);
}

/**
 * Add a print job to history (keep last 100)
 */
function addToHistory(jobInfo) {
  printStats.printHistory.unshift(jobInfo);
  if (printStats.printHistory.length > 100) {
    printStats.printHistory.pop();
  }
}

/**
 * Get print statistics
 */
function getPrintStats() {
  return { ...printStats, printHistory: [...printStats.printHistory] };
}

module.exports = { printImage, getAvailablePrinters, getPrintStats };
