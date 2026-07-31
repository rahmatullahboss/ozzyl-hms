#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
//
//   ██████╗ ███████╗███████╗██╗   ██╗██╗
//  ██╔═══██╗╚══███╔╝╚══███╔╝╚██╗ ██╔╝██║
//  ██║   ██║  ███╔╝   ███╔╝  ╚████╔╝ ██║
//  ██║   ██║ ███╔╝   ███╔╝    ╚██╔╝  ██║
//  ╚██████╔╝███████╗███████╗   ██║   ███████╗
//   ╚═════╝ ╚══════╝╚══════╝   ╚═╝   ╚══════╝
//
//  DICOM Print Agent — Local Hospital Middleware
//  Part of Ozzyl HMS (Hospital Management System)
//
//  Receives DICOM images from X-ray/CR/DR machines,
//  prints to local printer, and syncs to cloud.
//
// ═══════════════════════════════════════════════════════════════════════════════

const { config, validate } = require('./config');
const logger = require('./logger');
const DicomScp = require('./dicom-scp');
const { convertDicomToPng } = require('./image-convert');
const { printImage, getAvailablePrinters, getPrintStats } = require('./printer');
const { syncToCloud, getSyncStats } = require('./cloud-sync');
const { promptTosAcceptance } = require('./tos');

async function main() {
  // ─── License Agreement (first-run only) ────────────────────────────────────
  await promptTosAcceptance();
  // ─── Startup Banner ──────────────────────────────────────────────────────────
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════════════════╗');
  console.log('  ║          Ozzyl HMS — DICOM Print Agent v1.0.0           ║');
  console.log('  ╠═══════════════════════════════════════════════════════════╣');
  console.log(`  ║  AE Title    : ${config.aeTitle.padEnd(40)}║`);
  console.log(`  ║  DICOM Port  : ${String(config.dicomPort).padEnd(40)}║`);
  console.log(`  ║  Printing    : ${(config.printEnabled ? 'ENABLED' : 'DISABLED').padEnd(40)}║`);
  console.log(`  ║  Cloud Sync  : ${(config.cloudSyncEnabled ? 'ENABLED' : 'DISABLED').padEnd(40)}║`);
  console.log(`  ║  Paper Size  : ${config.paperDimensions.label.padEnd(40)}║`);
  console.log('  ╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  // ─── Validate Configuration ──────────────────────────────────────────────────
  const warnings = validate();
  if (warnings.length > 0) {
    warnings.forEach((w) => logger.warn(`⚠ ${w}`));
    console.log('');
  }

  // ─── List Available Printers ─────────────────────────────────────────────────
  if (config.printEnabled) {
    try {
      const printers = await getAvailablePrinters();
      if (printers.length > 0) {
        logger.info(`Available printers: ${printers.join(', ')}`);
        if (config.printerName && !printers.includes(config.printerName)) {
          logger.warn(`Configured printer "${config.printerName}" not found! Available: ${printers.join(', ')}`);
        }
      } else {
        logger.warn('No printers detected on this system');
      }
    } catch {
      logger.warn('Could not enumerate printers');
    }
  }

  // ─── Start DICOM SCP Server ──────────────────────────────────────────────────
  const scp = new DicomScp();

  // Wire up the image processing pipeline
  scp.on('imageReceived', async (imageInfo) => {
    const { filePath, metadata } = imageInfo;

    try {
      // Step 1: Convert DICOM to printable PNG
      const { outputPath } = await convertDicomToPng(filePath);

      // Step 2: Print (runs synchronously relative to this image)
      if (config.printEnabled) {
        const printResult = await printImage(outputPath, metadata);
        if (!printResult.success) {
          logger.error(`Print failed for ${metadata.patientName}: ${printResult.message}`);
        }
      }

      // Step 3: Cloud sync (runs in background, non-blocking)
      if (config.cloudSyncEnabled) {
        syncToCloud(imageInfo).catch((err) => {
          logger.error(`Cloud sync error (non-blocking): ${err.message}`);
        });
      }
    } catch (err) {
      logger.error(`Image processing pipeline error: ${err.message}`);
      // Even if conversion/print fails, try cloud sync with the raw .dcm
      if (config.cloudSyncEnabled) {
        syncToCloud(imageInfo).catch(() => {});
      }
    }
  });

  await scp.start();

  // ─── Status Reporter ─────────────────────────────────────────────────────────
  // Print status every 5 minutes
  setInterval(() => {
    const scpStats = scp.getStats();
    const prntStats = getPrintStats();
    const cloudStats = getSyncStats();

    logger.info(
      `Status — Received: ${scpStats.received} | ` +
        `Printed: ${prntStats.totalPrinted} | ` +
        `Synced: ${cloudStats.uploaded} | ` +
        `Queue: ${cloudStats.queueLength}`
    );
  }, 5 * 60 * 1000);

  // ─── Graceful Shutdown ───────────────────────────────────────────────────────
  const shutdown = () => {
    logger.info('Shutting down DICOM Print Agent...');
    scp.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (err) => {
    logger.error(`Uncaught exception: ${err.message}`);
    logger.error(err.stack);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled rejection: ${reason}`);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
