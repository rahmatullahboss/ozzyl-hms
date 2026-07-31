import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';

function escapeHtml(unsafe: unknown): string {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const labBarcode = new Hono<{ Bindings: Env; Variables: Variables }>();

labBarcode.use('*', requireRole('laboratory', 'lab', 'lab_tech', 'hospital_admin', 'director'));

// ═══════════════════════════════════════════════════════════════════════════════
// Code128 Barcode SVG Generator (no external dependency)
// ═══════════════════════════════════════════════════════════════════════════════

const CODE128_PATTERNS: Record<string, number[]> = {
  '11011001100': [2,1,2,2,2,2],
  '11001101100': [2,2,2,1,2,2],
  '11001100110': [2,2,2,2,2,1],
  '10010011000': [1,2,1,2,2,3],
  '10010001100': [1,2,1,3,2,2],
  '10001001100': [1,3,1,2,2,2],
  '10011001000': [1,2,2,2,1,3],
  '10011000100': [1,2,2,3,1,2],
  '10001100100': [1,3,2,2,1,2],
  '11001001000': [2,2,1,2,1,3],
  '11001000100': [2,2,1,3,1,2],
  '11000100100': [2,3,1,2,1,2],
  '10110011100': [1,1,2,2,3,2],
  '10011011100': [1,2,2,1,3,2],
  '10011001110': [1,2,2,2,3,1],
  '10111001100': [1,1,3,2,2,2],
  '10011101100': [1,2,3,1,2,2],
  '10011100110': [1,2,3,2,2,1],
  '11001110010': [2,2,1,1,3,2],
  '11001011100': [2,2,1,2,3,1],
  '11001001110': [2,2,1,3,1,2],
  '11011100100': [2,1,1,3,1,2],
  '11001110100': [2,2,3,1,1,2],
  '11101101110': [3,1,2,1,3,1],
  '11101001100': [3,1,1,2,2,2],
  '11100101100': [3,2,1,1,2,2],
  '11100100110': [3,2,1,2,2,1],
  '11101100100': [3,1,2,2,1,2],
  '11100110100': [3,2,2,1,1,2],
  '11100110010': [3,2,2,2,1,1],
  '11011011000': [2,1,2,1,2,3],
  '11011000110': [2,1,2,3,2,1],
  '11000110110': [2,3,2,1,2,1],
  '10100011000': [1,1,1,3,2,3],
  '10001011000': [1,3,1,1,2,3],
  '10001000110': [1,3,1,3,2,1],
  '10110001000': [1,1,2,3,1,3],
  '10001101000': [1,3,2,1,1,3],
  '10001100010': [1,3,2,3,1,1],
  '11010001000': [2,1,1,3,1,3],
  '11000101000': [2,3,1,1,1,3],
  '11000100010': [2,3,1,3,1,1],
  '10110111000': [1,1,2,1,3,3],
  '10110001110': [1,1,2,3,3,1],
  '10001101110': [1,3,2,1,3,1],
  '10111011000': [1,1,3,1,2,3],
  '10111000110': [1,1,3,3,2,1],
  '10001110110': [1,3,3,1,2,1],
  '11101110110': [3,1,3,1,2,1],
  '11010001110': [2,1,1,3,3,1],
  '11000101110': [2,3,1,1,3,1],
  '11011101000': [2,1,3,1,1,3],
  '11011100010': [2,1,3,3,1,1],
  '11011101110': [2,1,3,1,3,1],
  '11101011000': [3,1,1,1,2,3],
  '11101000110': [3,1,1,3,2,1],
  '11100010110': [3,3,1,1,2,1],
  '11101101000': [3,1,2,1,1,3],
  '11101100010': [3,1,2,3,1,1],
  '11100011010': [3,3,2,1,1,1],
  '11101111010': [3,1,4,1,1,1],
  '11001000010': [2,2,1,4,1,1],
  '11110001010': [4,3,1,1,1,1],
  '10100111100': [1,1,1,2,2,4],
  '10100001110': [1,1,1,4,2,2],
  '10010111100': [1,2,1,1,2,4],
  '10010000111': [1,2,1,4,2,1],
  '10000101110': [1,4,1,1,2,2],
  '10000100111': [1,4,1,2,2,1],
  '10110011110': [1,1,2,2,1,4],
  '10110000111': [1,1,2,4,1,2],
  '10011011110': [1,2,2,1,1,4],
  '10011000011': [1,2,2,4,1,1],
  '10000110111': [1,4,2,1,1,2],
  '10000110011': [1,4,2,2,1,1],
  '11000010011': [2,4,1,2,1,1],
  '11000010111': [2,4,1,1,1,2],
  '11110111010': [4,1,3,1,1,1],
  '11000111100': [2,2,1,1,1,4],
  '10001111010': [1,3,4,1,1,1],
  '10100111110': [1,1,1,2,4,2],
  '10010111110': [1,2,1,1,4,2],
  '10010011110': [1,2,1,2,4,1],
  '10111100100': [1,1,4,2,1,2],
  '10011110100': [1,2,4,1,1,2],
  '10011110010': [1,2,4,2,1,1],
  '11110100100': [4,1,1,2,1,2],
  '11110010100': [4,2,1,1,1,2],
  '11110010010': [4,2,1,2,1,1],
  '11011011110': [2,1,2,1,4,1],
  '11011110110': [2,1,4,1,2,1],
  '11110110110': [4,1,2,1,2,1],
  '10101111000': [1,1,1,1,4,3],
  '10100011110': [1,1,1,3,4,1],
  '10001011110': [1,3,1,1,4,1],
  '10111101000': [1,1,4,1,1,3],
  '10111100010': [1,1,4,3,1,1],
  '11110101000': [4,1,1,1,1,3],
  '11110100010': [4,1,1,3,1,1],
  '10111011110': [1,1,3,1,4,1],
  '10111101110': [1,1,4,1,3,1],
  '11101011110': [3,1,1,1,4,1],
  '11110101110': [4,1,1,1,3,1],
  '11010000100': [2,1,1,4,1,2],
  '11010010000': [2,1,1,2,1,4],
  '11010011110': [2,1,1,2,3,2],
  '11000111010': [2,3,3,1,1,1],
};

// Code128B character set (ASCII 32-127)
function code128BEncode(input: string): string {
  const START_B = '11010010000';
  const STOP = '1100011101011';
  
  let encoded = START_B;
  let checksum = 104; // START_B value
  
  for (let i = 0; i < input.length; i++) {
    const charCode = input.charCodeAt(i);
    const value = charCode - 32;
    checksum += value * (i + 1);
    
    // Find the pattern for this value
    const patternKeys = Object.keys(CODE128_PATTERNS);
    const pattern = patternKeys[value] || patternKeys[0];
    encoded += pattern;
  }
  
  checksum = checksum % 103;
  const checksumPatternKeys = Object.keys(CODE128_PATTERNS);
  encoded += checksumPatternKeys[checksum] || checksumPatternKeys[0];
  encoded += STOP;
  
  return encoded;
}

function generateBarcodeSVG(data: string, width: number = 200, height: number = 80): string {
  const binary = code128BEncode(data);
  const barWidth = width / binary.length;
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`;
  
  let x = 0;
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === '1') {
      svg += `<rect x="${x}" y="0" width="${barWidth}" height="${height - 15}" fill="black"/>`;
    }
    x += barWidth;
  }
  
  // Add text below
  svg += `<text x="${width / 2}" y="${height - 3}" text-anchor="middle" font-size="10" font-family="monospace">${escapeHtml(data)}</text>`;
  svg += '</svg>';
  
  return svg;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GENERATE BARCODES FOR ORDER
// ═══════════════════════════════════════════════════════════════════════════════

labBarcode.post('/generate/:orderId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const orderId = Number(c.req.param('orderId'));

  const order = await db.$client.prepare(`
    SELECT lo.*, tc.code as tenant_code
    FROM lab_orders lo
    JOIN tenants tc ON lo.tenant_id = tc.id
    WHERE lo.id = ? AND lo.tenant_id = ?
  `).bind(orderId, tenantId).first<{ id: number; order_no: string; tenant_code: string }>();
  if (!order) throw new HTTPException(404, { message: 'Lab order not found' });

  const items = await db.$client.prepare(`
    SELECT loi.*, ltc.name as test_name, ltc.code as test_code
    FROM lab_order_items loi
    JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    WHERE loi.lab_order_id = ?
  `).bind(orderId).all<{ id: number; test_name: string; barcode: string | null }>();

  const updated: Array<{ itemId: number; barcode: string }> = [];

  for (let i = 0; i < items.results.length; i++) {
    const item = items.results[i];
    if (!item.barcode) {
      const seq = String(i + 1).padStart(2, '0');
      const barcode = `${order.tenant_code}-${order.order_no}-${seq}`;
      
      await db.$client.prepare(`
        UPDATE lab_order_items SET barcode = ? WHERE id = ?
      `).bind(barcode, item.id).run();
      
      updated.push({ itemId: item.id, barcode });
    }
  }

  return c.json({ message: 'Barcodes generated', items: updated });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET STICKER HTML FOR THERMAL PRINTER
// ═══════════════════════════════════════════════════════════════════════════════

labBarcode.get('/sticker/:orderId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const orderId = Number(c.req.param('orderId'));

  const order = await db.$client.prepare(`
    SELECT lo.*, p.name as patient_name, p.gender
    FROM lab_orders lo
    JOIN patients p ON lo.patient_id = p.id
    WHERE lo.id = ? AND lo.tenant_id = ?
  `).bind(orderId, tenantId).first<{ id: number; order_no: string; patient_name: string; gender: string; order_date: string }>();
  if (!order) throw new HTTPException(404, { message: 'Lab order not found' });

  const items = await db.$client.prepare(`
    SELECT loi.*, ltc.name as test_name
    FROM lab_order_items loi
    JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
    WHERE loi.lab_order_id = ? AND loi.barcode IS NOT NULL
  `).bind(orderId).all<{ barcode: string; test_name: string }>();

  // Generate sticker HTML (50mm x 25mm thermal label)
  let stickers = '';
  for (const item of items.results) {
    const svg = generateBarcodeSVG(item.barcode, 180, 60);
    stickers += `
      <div class="sticker">
        <div class="patient">${escapeHtml(order.patient_name)} (${escapeHtml(order.gender || 'N/A')})</div>
        <div class="test">${escapeHtml(item.test_name)}</div>
        <div class="date">${escapeHtml(order.order_date)}</div>
        ${svg}
      </div>
    `;
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    @page { size: 50mm 25mm; margin: 1mm; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 0; }
    .sticker { 
      width: 48mm; height: 23mm; 
      display: flex; flex-direction: column; 
      justify-content: center; align-items: center;
      page-break-after: always;
      border: 0.5px solid #ccc;
      padding: 1mm;
    }
    .patient { font-size: 8pt; font-weight: bold; margin-bottom: 1mm; }
    .test { font-size: 7pt; margin-bottom: 1mm; }
    .date { font-size: 6pt; color: #666; }
    svg { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  ${stickers}
</body>
</html>`;

  return c.html(html);
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET BARCODE SVG
// ═══════════════════════════════════════════════════════════════════════════════

labBarcode.get('/svg/:barcode', async (c) => {
  const barcode = c.req.param('barcode');
  const svg = generateBarcodeSVG(barcode);
  return c.body(svg, 200, { 'Content-Type': 'image/svg+xml' });
});

export default labBarcode;
