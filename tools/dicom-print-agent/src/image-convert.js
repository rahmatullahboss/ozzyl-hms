// ═══════════════════════════════════════════════════════════════════════════════
// Ozzyl HMS — DICOM Print Agent: Image Converter
//
// Converts DICOM pixel data to printable PNG images.
// Handles:
//   - 8/10/12/14/16-bit grayscale DICOM images
//   - Window/Level (contrast) adjustment for optimal X-ray viewing
//   - Photometric interpretation (MONOCHROME1 vs MONOCHROME2)
//   - Scaling to target paper/film size
// ═══════════════════════════════════════════════════════════════════════════════

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { config } = require('./config');

/**
 * Parse raw DICOM file to extract pixel data and relevant tags.
 * Uses a lightweight manual parser for the critical tags we need,
 * since dcmjs-dimse's Dataset gives us metadata but not raw pixels easily.
 *
 * For pixel extraction we read the file and parse the DICOM binary format.
 * @param {string} filePath - Path to .dcm file
 * @returns {object} Parsed pixel data and metadata
 */
function parseDicomPixels(filePath) {
  const dcmjsDimse = require('dcmjs-dimse');
  const { Dataset } = dcmjsDimse;

  // Load dataset using dcmjs-dimse
  const dataset = Dataset.fromFile(filePath);
  const elements = dataset.getElements();

  // Extract critical imaging parameters
  const rows = parseInt(elements.Rows || elements['00280010'] || '0', 10);
  const cols = parseInt(elements.Columns || elements['00280011'] || '0', 10);
  const bitsAllocated = parseInt(elements.BitsAllocated || elements['00280100'] || '16', 10);
  const bitsStored = parseInt(elements.BitsStored || elements['00280101'] || bitsAllocated.toString(), 10);
  const highBit = parseInt(elements.HighBit || elements['00280102'] || (bitsStored - 1).toString(), 10);
  const pixelRepresentation = parseInt(elements.PixelRepresentation || elements['00280103'] || '0', 10);
  const photometricInterpretation = elements.PhotometricInterpretation || elements['00280004'] || 'MONOCHROME2';
  const samplesPerPixel = parseInt(elements.SamplesPerPixel || elements['00280002'] || '1', 10);
  const rescaleSlope = parseFloat(elements.RescaleSlope || elements['00281053'] || '1');
  const rescaleIntercept = parseFloat(elements.RescaleIntercept || elements['00281052'] || '0');

  // Window/Level from DICOM header (may be arrays or single values)
  let windowCenter = elements.WindowCenter || elements['00281050'];
  let windowWidth = elements.WindowWidth || elements['00281051'];

  // Handle array values (take first)
  if (Array.isArray(windowCenter)) windowCenter = windowCenter[0];
  if (Array.isArray(windowWidth)) windowWidth = windowWidth[0];
  windowCenter = parseFloat(windowCenter || '0');
  windowWidth = parseFloat(windowWidth || '0');

  // Read pixel data from the raw file
  // DICOM pixel data is at tag (7FE0,0010)
  const fileBuffer = fs.readFileSync(filePath);
  const pixelDataOffset = findPixelDataOffset(fileBuffer);

  let pixelBuffer = null;
  if (pixelDataOffset > 0) {
    // Skip the tag (4 bytes) + VR/length (variable) to get to actual pixel bytes
    pixelBuffer = fileBuffer.subarray(pixelDataOffset);
  }

  return {
    rows,
    cols,
    bitsAllocated,
    bitsStored,
    highBit,
    pixelRepresentation,
    photometricInterpretation: photometricInterpretation.trim(),
    samplesPerPixel,
    rescaleSlope,
    rescaleIntercept,
    windowCenter,
    windowWidth,
    pixelBuffer,
  };
}

/**
 * Find the offset of PixelData (7FE0,0010) in a DICOM file buffer.
 * Scans for the tag bytes in the file.
 */
function findPixelDataOffset(buffer) {
  // PixelData tag: 0x7FE0, 0x0010 in little-endian = E0 7F 10 00
  for (let i = 0; i < buffer.length - 8; i++) {
    if (
      buffer[i] === 0xe0 &&
      buffer[i + 1] === 0x7f &&
      buffer[i + 2] === 0x10 &&
      buffer[i + 3] === 0x00
    ) {
      // After the tag, there's VR (2 bytes) or direct length
      // For Explicit VR: tag(4) + VR(2) + reserved(2) + length(4) = 12 bytes header
      // For OW/OB with explicit VR
      const vr = String.fromCharCode(buffer[i + 4], buffer[i + 5]);
      if (vr === 'OW' || vr === 'OB') {
        // Explicit VR: skip 4(tag) + 2(VR) + 2(reserved) + 4(length) = 12
        return i + 12;
      } else {
        // Implicit VR or short form: skip 4(tag) + 4(length) = 8
        return i + 8;
      }
    }
  }
  return -1;
}

/**
 * Apply Window/Level (contrast) adjustment to pixel values.
 * Converts raw pixel values to 0-255 display range.
 *
 * @param {number} pixelValue - Raw pixel value (after rescale)
 * @param {number} windowCenter - Center of the display window
 * @param {number} windowWidth - Width of the display window
 * @returns {number} 0-255 display value
 */
function applyWindowLevel(pixelValue, windowCenter, windowWidth) {
  if (windowWidth <= 0) return Math.min(255, Math.max(0, pixelValue));

  const minVal = windowCenter - windowWidth / 2;
  const maxVal = windowCenter + windowWidth / 2;

  if (pixelValue <= minVal) return 0;
  if (pixelValue >= maxVal) return 255;
  return Math.round(((pixelValue - minVal) / windowWidth) * 255);
}

/**
 * Convert a DICOM file to a high-quality PNG suitable for printing.
 *
 * @param {string} dicomFilePath - Path to the .dcm file
 * @param {object} options - Conversion options
 * @param {string} options.outputPath - Where to save the PNG (optional, auto-generated if omitted)
 * @param {number} options.dpi - Target DPI for printing (default: 300)
 * @returns {Promise<{outputPath: string, width: number, height: number}>}
 */
async function convertDicomToPng(dicomFilePath, options = {}) {
  const dpi = options.dpi || 300;
  const outputPath = options.outputPath || dicomFilePath.replace(/\.dcm$/i, '.png');

  logger.info(`Converting DICOM to PNG: ${path.basename(dicomFilePath)}`);

  try {
    const dicom = parseDicomPixels(dicomFilePath);

    if (!dicom.pixelBuffer || dicom.rows === 0 || dicom.cols === 0) {
      throw new Error('No valid pixel data found in DICOM file');
    }

    const { rows, cols, bitsAllocated, pixelRepresentation, photometricInterpretation } = dicom;
    const totalPixels = rows * cols;

    // Read raw pixel values based on bit depth
    let rawPixels;
    if (bitsAllocated === 16) {
      if (pixelRepresentation === 1) {
        // Signed 16-bit
        rawPixels = new Int16Array(dicom.pixelBuffer.buffer, dicom.pixelBuffer.byteOffset, totalPixels);
      } else {
        // Unsigned 16-bit
        rawPixels = new Uint16Array(dicom.pixelBuffer.buffer, dicom.pixelBuffer.byteOffset, totalPixels);
      }
    } else if (bitsAllocated === 8) {
      rawPixels = new Uint8Array(dicom.pixelBuffer.buffer, dicom.pixelBuffer.byteOffset, totalPixels);
    } else {
      // For other bit depths, treat as 16-bit
      rawPixels = new Uint16Array(dicom.pixelBuffer.buffer, dicom.pixelBuffer.byteOffset, totalPixels);
    }

    // Apply rescale slope/intercept
    const rescaledPixels = new Float32Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      rescaledPixels[i] = rawPixels[i] * dicom.rescaleSlope + dicom.rescaleIntercept;
    }

    // Auto-calculate window/level if not provided in DICOM header
    let { windowCenter, windowWidth } = dicom;
    if (windowWidth <= 0) {
      // Calculate from data
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < totalPixels; i++) {
        if (rescaledPixels[i] < min) min = rescaledPixels[i];
        if (rescaledPixels[i] > max) max = rescaledPixels[i];
      }
      windowCenter = (min + max) / 2;
      windowWidth = max - min;
      logger.debug(`Auto W/L: center=${windowCenter.toFixed(0)}, width=${windowWidth.toFixed(0)}`);
    }

    // Convert to 8-bit grayscale with window/level
    const displayPixels = Buffer.alloc(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      let val = applyWindowLevel(rescaledPixels[i], windowCenter, windowWidth);

      // MONOCHROME1: invert (white = air, black = bone) — standard for some CR systems
      if (photometricInterpretation === 'MONOCHROME1') {
        val = 255 - val;
      }

      displayPixels[i] = val;
    }

    // Use Sharp to create the final PNG
    // Calculate resize dimensions based on paper size while maintaining aspect ratio
    const { paperDimensions } = config;
    const targetWidthPx = Math.round((paperDimensions.width / 25.4) * dpi);
    const targetHeightPx = Math.round((paperDimensions.height / 25.4) * dpi);

    await sharp(displayPixels, {
      raw: {
        width: cols,
        height: rows,
        channels: 1,
      },
    })
      .resize(targetWidthPx, targetHeightPx, {
        fit: 'inside',           // Maintain aspect ratio, fit within bounds
        withoutEnlargement: false,
        background: { r: 0, g: 0, b: 0 }, // Black background (standard for X-ray film)
      })
      .png({ compressionLevel: 6 })
      .toFile(outputPath);

    logger.info(`PNG created: ${path.basename(outputPath)} (${cols}×${rows} → fit ${paperDimensions.label})`);

    return { outputPath, width: cols, height: rows };
  } catch (err) {
    logger.error(`DICOM conversion failed: ${err.message}`);
    throw err;
  }
}

module.exports = { convertDicomToPng, parseDicomPixels };
