/**
 * HL7v2 Message Parser
 *
 * Parses HL7v2 messages (primarily ORU^R01 results and ORM^O01 orders).
 * Reference: OpenEMR receive_hl7_results.inc.php & gen_hl7_order.inc.php
 *
 * HL7v2 structure:
 *   Segment separator: \r (carriage return)
 *   Field separator: | (pipe)
 *   Component separator: ^ (caret)
 *   Repetition separator: ~ (tilde)
 *   Escape character: \ (backslash)
 *   Sub-component separator: & (ampersand)
 */

export interface HL7Segment {
  type: string;
  fields: (string | string[])[];
}

export interface HL7Message {
  raw: string;
  segments: HL7Segment[];
  messageType: string;       // e.g. "ORU^R01", "ORM^O01"
  messageControlId: string;  // MSH-10
  sendingApp: string;        // MSH-3
  sendingFacility: string;   // MSH-4
  receivingApp: string;      // MSH-5
  receivingFacility: string; // MSH-6
  timestamp: string;         // MSH-7
  version: string;           // MSH-12
}

export interface HL7Patient {
  patientId: string;         // PID-3
  externalId: string;        // PID-2
  lastName: string;
  firstName: string;
  middleName: string;
  dob: string;               // PID-7
  sex: string;               // PID-8
  address: string;
  phone: string;
}

export interface HL7OrderInfo {
  placerOrderNumber: string; // ORC-2 / OBR-2
  fillerOrderNumber: string; // ORC-3 / OBR-3
  specimenId?: string;       // SPM-2/SPM-3 or OBR-3 fallback
  specimenType?: string;     // SPM-4
  orderStatus: string;       // ORC-5
  orderDate: string;
  observationDate: string;   // OBR-7
  specimenReceivedDate: string; // OBR-14
  resultStatus: string;      // OBR-25
  procedureCode: string;     // OBR-4.1
  procedureName: string;     // OBR-4.2
}

export interface HL7Result {
  setId: number;             // OBX-1
  valueType: string;         // OBX-2 (NM, ST, TX, SN, CE, FT)
  resultCode: string;        // OBX-3.1
  resultCodeSystem: string;  // OBX-3.3 (e.g. "LN" for LOINC)
  resultText: string;        // OBX-3.2
  subId: string;             // OBX-4
  value: string;             // OBX-5
  units: string;             // OBX-6
  range: string;             // OBX-7
  abnormalFlag: string;      // OBX-8 (N, H, L, HH, LL, A)
  resultStatus: string;      // OBX-11 (P=preliminary, F=final, C=corrected)
  observationDate: string;   // OBX-14
  producerId: string;        // OBX-15
  comments: string[];        // from NTE segments following this OBX
}

export interface HL7ParsedResult {
  message: HL7Message;
  patient: HL7Patient | null;
  orders: Array<{
    order: HL7OrderInfo;
    results: HL7Result[];
  }>;
  notes: string[];           // message-level NTE segments
}

// ─── Core Parser ────────────────────────────────────────────────────────────

/**
 * Decode HL7 escape sequences (reference: OpenEMR rhl7Text function)
 * \F\ = |  \S\ = ^  \R\ = ~  \T\ = &  \E\ = \
 * \Xhh\ = hex char  \.br\ = newline
 */
export function decodeHL7Escapes(text: string): string {
  return text
    .replace(/\\F\\/g, '|')
    .replace(/\\S\\/g, '^')
    .replace(/\\R\\/g, '~')
    .replace(/\\T\\/g, '&')
    .replace(/\\E\\/g, '\\')
    .replace(/\\.br\\/g, '\n')
    .replace(/\\X([0-9A-Fa-f]{2})\\/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Parse HL7 datetime with optional timezone offset
 * Input: "20260420120000+0600" or "20260420120000" or "20260420"
 * Returns: { datetime: "2026-04-20T12:00:00", timezone: "+0600" }
 */
export function parseHL7DateTime(raw: string): { datetime: string; timezone: string } {
  if (!raw) return { datetime: '', timezone: '' };
  const tzMatch = raw.match(/([+-]\d{4})$/);
  const tz = tzMatch ? tzMatch[1] : '';
  const dt = tzMatch ? raw.slice(0, -5) : raw;

  const y = dt.slice(0, 4);
  const m = dt.slice(4, 6) || '01';
  const d = dt.slice(6, 8) || '01';
  const hh = dt.slice(8, 10) || '00';
  const mm = dt.slice(10, 12) || '00';
  const ss = dt.slice(12, 14) || '00';

  return { datetime: `${y}-${m}-${d}T${hh}:${mm}:${ss}`, timezone: tz };
}

function parseSegment(raw: string, fieldSep = '|', componentSep = '^'): HL7Segment {
  const fields = raw.split(fieldSep);
  const type = fields[0];

  const parsed = fields.slice(1).map(f => {
    // Handle repeating fields (~ separator) — take first repetition
    const firstRep = f.includes('~') ? f.split('~')[0] : f;
    if (firstRep.includes(componentSep)) {
      return firstRep.split(componentSep);
    }
    return firstRep;
  });

  return { type, fields: parsed };
}

function getField(seg: HL7Segment, index: number): string {
  // HL7 fields are 1-indexed in spec; our array is 0-indexed (after type removal)
  const val = seg.fields[index - 1];
  if (!val) return '';
  if (Array.isArray(val)) return val[0] || '';
  return val;
}

/** Get full field value including component separators (e.g. "ORU^R01") */
function getFullField(seg: HL7Segment, index: number): string {
  const val = seg.fields[index - 1];
  if (!val) return '';
  if (Array.isArray(val)) return val.join('^');
  return val;
}

function getComponent(seg: HL7Segment, fieldIndex: number, compIndex: number): string {
  const val = seg.fields[fieldIndex - 1];
  if (!val) return '';
  if (Array.isArray(val)) return val[compIndex - 1] || '';
  return compIndex === 1 ? val : '';
}

// ─── MSH Parser ─────────────────────────────────────────────────────────────

function parseMSH(seg: HL7Segment): Partial<HL7Message> {
  // MSH is special: field 1 = field separator itself, field 2 = encoding chars
  // So our indices shift: MSH-3 = fields[1], MSH-4 = fields[2], etc.
  return {
    sendingApp: getField(seg, 2),
    sendingFacility: getField(seg, 3),
    receivingApp: getField(seg, 4),
    receivingFacility: getField(seg, 5),
    timestamp: getField(seg, 6),
    messageType: getFullField(seg, 8),
    messageControlId: getField(seg, 9),
    version: getField(seg, 11),
  };
}

// ─── PID Parser ─────────────────────────────────────────────────────────────

function parsePID(seg: HL7Segment): HL7Patient {
  return {
    externalId: getField(seg, 2),
    patientId: getComponent(seg, 3, 1),
    lastName: getComponent(seg, 5, 1),
    firstName: getComponent(seg, 5, 2),
    middleName: getComponent(seg, 5, 3),
    dob: getField(seg, 7),
    sex: getField(seg, 8),
    address: getField(seg, 11),
    phone: getField(seg, 13),
  };
}

// ─── ORC/OBR Parser ────────────────────────────────────────────────────────

function parseORC(seg: HL7Segment): Partial<HL7OrderInfo> {
  return {
    placerOrderNumber: getField(seg, 2),
    fillerOrderNumber: getField(seg, 3),
    orderStatus: getField(seg, 5),
    orderDate: getField(seg, 9),
  };
}

function parseOBR(seg: HL7Segment): Partial<HL7OrderInfo> {
  return {
    placerOrderNumber: getField(seg, 2),
    fillerOrderNumber: getField(seg, 3),
    specimenId: getComponent(seg, 3, 1) || getField(seg, 3),
    procedureCode: getComponent(seg, 4, 1),
    procedureName: getComponent(seg, 4, 2),
    observationDate: getField(seg, 7),
    specimenReceivedDate: getField(seg, 14),
    resultStatus: getField(seg, 25),
  };
}

function parseSPM(seg: HL7Segment): Partial<HL7OrderInfo> {
  return {
    specimenId: getComponent(seg, 2, 1) || getComponent(seg, 3, 1) || getField(seg, 2) || getField(seg, 3),
    specimenType: getComponent(seg, 4, 1) || getField(seg, 4),
  };
}

// ─── OBX Parser ─────────────────────────────────────────────────────────────

function parseOBX(seg: HL7Segment): HL7Result {
  return {
    setId: parseInt(getField(seg, 1)) || 0,
    valueType: getField(seg, 2),
    resultCode: getComponent(seg, 3, 1),
    resultText: decodeHL7Escapes(getComponent(seg, 3, 2)),
    resultCodeSystem: getComponent(seg, 3, 3),
    subId: getField(seg, 4),
    value: decodeHL7Escapes(getField(seg, 5)),
    units: getComponent(seg, 6, 1),
    range: getField(seg, 7),
    abnormalFlag: getField(seg, 8),
    resultStatus: getField(seg, 11),
    observationDate: getField(seg, 14),
    producerId: getField(seg, 15),
    comments: [],
  };
}

// ─── Main Parse Function ────────────────────────────────────────────────────

export function parseHL7Message(raw: string): HL7ParsedResult {
  // Normalize line endings — HL7 uses \r but files may have \r\n or \n
  const normalized = raw.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
  const segmentStrings = normalized.split('\r').filter(s => s.trim().length > 0);

  const segments = segmentStrings.map(s => parseSegment(s));

  // Extract MSH
  const mshSeg = segments.find(s => s.type === 'MSH');
  const mshInfo = mshSeg ? parseMSH(mshSeg) : {};

  const message: HL7Message = {
    raw,
    segments,
    messageType: mshInfo.messageType || '',
    messageControlId: mshInfo.messageControlId || '',
    sendingApp: mshInfo.sendingApp || '',
    sendingFacility: mshInfo.sendingFacility || '',
    receivingApp: mshInfo.receivingApp || '',
    receivingFacility: mshInfo.receivingFacility || '',
    timestamp: mshInfo.timestamp || '',
    version: mshInfo.version || '',
  };

  // Extract PID
  const pidSeg = segments.find(s => s.type === 'PID');
  const patient = pidSeg ? parsePID(pidSeg) : null;

  // Extract orders: group ORC/OBR with their OBX results
  const orders: HL7ParsedResult['orders'] = [];
  let currentOrder: HL7OrderInfo | null = null;
  let currentResults: HL7Result[] = [];
  let currentResult: HL7Result | null = null;
  const messageNotes: string[] = [];

  for (const seg of segments) {
    switch (seg.type) {
      case 'ORC': {
        // If we had a previous order, save it
        if (currentOrder) {
          if (currentResult) currentResults.push(currentResult);
          orders.push({ order: currentOrder, results: currentResults });
        }
        currentOrder = { ...parseORC(seg) } as HL7OrderInfo;
        currentResults = [];
        currentResult = null;
        break;
      }
      case 'OBR': {
        const obrInfo = parseOBR(seg);
        if (currentOrder) {
          // Merge OBR info into current order
          Object.assign(currentOrder, obrInfo);
        } else {
          // OBR without ORC — create order from OBR
          currentOrder = { ...obrInfo } as HL7OrderInfo;
          currentResults = [];
          currentResult = null;
        }
        break;
      }
      case 'SPM': {
        if (currentOrder) {
          Object.assign(currentOrder, parseSPM(seg));
        }
        break;
      }
      case 'OBX': {
        if (currentResult) currentResults.push(currentResult);
        currentResult = parseOBX(seg);
        break;
      }
      case 'NTE': {
        const noteText = decodeHL7Escapes(getField(seg, 3));
        if (currentResult) {
          currentResult.comments.push(noteText);
        } else if (currentOrder) {
          // Order-level note
          messageNotes.push(noteText);
        } else {
          messageNotes.push(noteText);
        }
        break;
      }
    }
  }

  // Save last order/result
  if (currentResult) currentResults.push(currentResult);
  if (currentOrder) {
    orders.push({ order: currentOrder, results: currentResults });
  }

  return { message, patient, orders, notes: messageNotes };
}

export function validateHL7ClinicalMessage(parsed: HL7ParsedResult): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const messageType = parsed.message.messageType.trim().toUpperCase();

  if (!parsed.message.segments.some((segment) => segment.type === 'MSH')) {
    errors.push('HL7 message is missing MSH');
  }

  if (!messageType.startsWith('ORU^R01')) {
    errors.push(`Unsupported HL7 message type: ${parsed.message.messageType || 'missing'}`);
  }

  if (messageType.startsWith('ORU^R01') && !parsed.message.messageControlId.trim()) {
    errors.push('HL7 message is missing MSH-10 message control id');
  }

  const observationCount = parsed.orders.reduce((total, order) => total + order.results.length, 0);
  if (messageType.startsWith('ORU^R01') && observationCount === 0) {
    errors.push('HL7 ORU message contains no observations');
  }

  return { valid: errors.length === 0, errors };
}

// ─── HL7 Abnormal Flag Mapper ───────────────────────────────────────────────

export function mapHL7AbnormalFlag(flag: string): 'normal' | 'abnormal' | 'high' | 'low' | 'critical' | 'pending' {
  switch (flag.toUpperCase().trim()) {
    case 'N': return 'normal';
    case 'A': return 'abnormal';
    case 'H': return 'high';
    case 'L': return 'low';
    case 'HH':
    case 'LL': return 'critical';
    case 'AA': return 'abnormal';
    default: return 'pending';
  }
}

// ─── HL7 Result Status Mapper ───────────────────────────────────────────────

export function mapHL7ResultStatus(status: string): 'preliminary' | 'final' | 'corrected' | 'cancelled' | 'unrecognized' {
  switch (status.toUpperCase().trim()) {
    case 'P': return 'preliminary';
    case 'F': return 'final';
    case 'C': return 'corrected';
    case 'X':
    case 'D': return 'cancelled';
    default: return 'unrecognized';
  }
}

// ─── HL7v2 Message Generator (for outbound orders — ORM^O01) ───────────────

export function generateHL7Order(params: {
  sendingApp: string;
  sendingFacility: string;
  receivingApp: string;
  receivingFacility: string;
  controlId: string;
  patient: {
    id: string;
    lastName: string;
    firstName: string;
    dob: string; // YYYYMMDD
    sex: string; // M/F
    address?: string;
    phone?: string;
  };
  order: {
    orderId: string;
    orderDate: string; // YYYYMMDDHHmmss
    priority: string;
    providerNpi?: string;
    providerLastName?: string;
    providerFirstName?: string;
    clinicalHistory?: string;
    diagnosis?: { code: string; text: string };
  };
  tests: Array<{
    sequence: number;
    code: string;
    name: string;
    specimenType?: string;
    collectionDate?: string;
  }>;
}): string {
  const d = '\r';
  const now = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

  let msg = '';

  // MSH — Message Header
  msg += `MSH|^~\\&|${params.sendingApp}|${params.sendingFacility}|${params.receivingApp}|${params.receivingFacility}|${now}||ORM^O01|${params.controlId}|P|2.3${d}`;

  // PID — Patient Identification
  const p = params.patient;
  msg += `PID|||${p.id}||${p.lastName}^${p.firstName}||${p.dob}|${p.sex}|||${p.address || ''}|||${p.phone || ''}${d}`;

  // ORC — Common Order
  const o = params.order;
  const provider = o.providerNpi ? `${o.providerNpi}^${o.providerLastName || ''}^${o.providerFirstName || ''}` : '';
  msg += `ORC|NW|${o.orderId}|||||||${o.orderDate}|||${provider}${d}`;

  // OBR + DG1 for each test
  for (const test of params.tests) {
    msg += `OBR|${test.sequence}|${o.orderId}||${test.code}^${test.name}|||${test.collectionDate || ''}||||||||${o.priority}${d}`;
  }

  // DG1 — Diagnosis (if provided)
  if (o.diagnosis) {
    msg += `DG1|1||${o.diagnosis.code}^${o.diagnosis.text}${d}`;
  }

  return msg;
}
