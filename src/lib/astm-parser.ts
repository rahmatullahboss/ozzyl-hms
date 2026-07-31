/**
 * ASTM / LIS2-A2 Message Parser
 *
 * Parses ASTM E1381/E1394 (LIS2-A2) messages from lab analyzers.
 * Most Bangladesh hospital analyzers (Mindray, Beckman, Sysmex, Bio-Rad)
 * use ASTM protocol over serial/TCP.
 *
 * ASTM Record Types:
 *   H - Header Record
 *   P - Patient Record
 *   O - Order Record
 *   R - Result Record
 *   C - Comment Record
 *   Q - Query Record (host query mode)
 *   L - Terminator Record
 *   M - Manufacturer-specific Record
 *
 * ASTM Frame Protocol (for TCP/serial middleware):
 *   ENQ (0x05) → ACK (0x06) → STX (0x02) data ETX (0x03) → ACK → EOT (0x04)
 *
 * Field delimiter: | (pipe)
 * Component delimiter: ^ (caret)
 * Repeat delimiter: \ (backslash)
 * Escape: & (ampersand)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

// ─── Frame-level Protocol Utilities ─────────────────────────────────────────

/**
 * Calculate ASTM checksum for a frame.
 * Checksum = sum of all bytes from frame_number to ETX/ETB inclusive, mod 256,
 * encoded as 2-character uppercase hex.
 */
export function calculateASTMChecksum(frameData: string, includeTerminator: number = 0x03): string {
  let sum = 0;
  for (let i = 0; i < frameData.length; i++) {
    sum += frameData.charCodeAt(i);
  }
  sum += includeTerminator; // ETX (0x03) or ETB (0x17)
  return (sum % 256).toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Validate ASTM frame checksum.
 * Frame format: STX + frame_number + data + ETX/ETB + checksum(2) + CR + LF
 * Returns: { valid: boolean, data: string (content without frame control) }
 */
export function validateASTMFrame(frame: Uint8Array): { valid: boolean; data: string; isIntermediate: boolean } {
  // Find STX
  const stxIdx = frame.indexOf(0x02);
  if (stxIdx < 0) return { valid: false, data: '', isIntermediate: false };

  // Find ETX or ETB
  const etxIdx = frame.indexOf(0x03, stxIdx);
  const etbIdx = frame.indexOf(0x17, stxIdx);
  const endIdx = etxIdx >= 0 ? etxIdx : etbIdx;
  const isIntermediate = etbIdx >= 0 && (etxIdx < 0 || etbIdx < etxIdx);

  if (endIdx < 0) return { valid: false, data: '', isIntermediate: false };

  // Content = frame_number + data (between STX and ETX/ETB)
  const contentBytes = frame.slice(stxIdx + 1, endIdx);
  const contentStr = new TextDecoder().decode(contentBytes);
  const terminator = frame[endIdx];

  // Checksum = 2 hex chars after ETX/ETB
  if (frame.length > endIdx + 2) {
    const expectedChecksum = new TextDecoder().decode(frame.slice(endIdx + 1, endIdx + 3)).toUpperCase();
    const actualChecksum = calculateASTMChecksum(contentStr, terminator);
    if (expectedChecksum !== actualChecksum) {
      return { valid: false, data: contentStr.slice(1), isIntermediate };
    }
  }

  const data = contentStr.slice(1); // skip frame number
  return { valid: true, data, isIntermediate };
}

/**
 * Reassemble multi-frame ASTM transmission.
 * ETB (0x17) = intermediate frame, ETX (0x03) = final frame of a record.
 * Multiple frames may make up one record when data exceeds 240 chars (ASTM limit).
 */
export function reassembleASTMFrames(rawBuffer: Uint8Array): string[] {
  const records: string[] = [];
  let currentRecord = '';
  let pos = 0;

  while (pos < rawBuffer.length) {
    const byte = rawBuffer[pos];

    if (byte === 0x05) { // ENQ
      pos++;
      continue;
    }
    if (byte === 0x04) { // EOT
      pos++;
      continue;
    }
    if (byte === 0x06 || byte === 0x15) { // ACK or NAK
      pos++;
      continue;
    }
    if (byte === 0x02) { // STX — start of frame
      // Find end of frame (ETX or ETB)
      const etxIdx = rawBuffer.indexOf(0x03, pos);
      const etbIdx = rawBuffer.indexOf(0x17, pos);
      const endIdx = Math.min(
        etxIdx >= 0 ? etxIdx : Infinity,
        etbIdx >= 0 ? etbIdx : Infinity,
      );

      if (endIdx === Infinity) break; // incomplete frame

      const frameContent = new TextDecoder().decode(rawBuffer.slice(pos + 2, endIdx)); // +2 = skip STX + frame_number
      const isIntermediate = rawBuffer[endIdx] === 0x17;

      currentRecord += frameContent;

      if (!isIntermediate) {
        // ETX = final frame, record complete
        records.push(currentRecord);
        currentRecord = '';
      }
      // else ETB = intermediate frame, accumulate

      // Skip past checksum + CR + LF
      pos = endIdx + 1;
      // Skip checksum (2 bytes) + CR + optional LF
      while (pos < rawBuffer.length && (rawBuffer[pos] !== 0x02 && rawBuffer[pos] !== 0x04 && rawBuffer[pos] !== 0x05)) {
        pos++;
      }
    } else {
      pos++;
    }
  }

  return records;
}

export interface ASTMHeader {
  recordType: 'H';
  delimiter: string;
  senderId: string;
  senderName: string;
  senderAddress?: string;
  receiverId?: string;
  processingId: string;      // P=production, D=debug, T=training
  version: string;           // e.g. "LIS2-A2" or "E 1394-97"
  timestamp: string;         // YYYYMMDDHHmmss
}

export interface ASTMPatient {
  recordType: 'P';
  sequence: number;
  practicePatientId: string;
  labPatientId: string;
  patientId3?: string;       // third ID field
  patientName: string;
  lastName?: string;
  firstName?: string;
  dob?: string;
  sex?: string;
  address?: string;
  phone?: string;
  attendingPhysician?: string;
  specialField1?: string;
  specialField2?: string;
}

export interface ASTMOrder {
  recordType: 'O';
  sequence: number;
  specimenId: string;
  instrumentSpecimenId?: string;
  testId: string;            // universal test ID — format may be ^^^code
  testCode: string;          // parsed test code
  testName?: string;
  priority?: string;         // R=routine, S=stat, A=asap
  orderDateTime?: string;
  collectionDateTime?: string;
  specimenType?: string;
  reportType: string;        // F=final, P=preliminary, C=corrected, X=cancelled
}

export interface ASTMResult {
  recordType: 'R';
  sequence: number;
  testCode: string;          // universal test ID
  testName?: string;
  value: string;
  units: string;
  referenceRange: string;
  abnormalFlag: string;      // N=normal, L=low, H=high, LL=critical low, HH=critical high, A=abnormal
  status: string;            // F=final, P=preliminary, C=corrected
  operatorId?: string;
  completedDateTime?: string;
  instrumentId?: string;
  comments: string[];        // collected from C records
}

export interface ASTMComment {
  recordType: 'C';
  sequence: number;
  source: string;            // I=instrument, L=operator
  text: string;
  commentType?: string;      // G=general, I=instrument flag, P=patient, T=test
}

export interface ASTMParsedMessage {
  header: ASTMHeader;
  patients: Array<{
    patient: ASTMPatient;
    orders: Array<{
      order: ASTMOrder;
      results: ASTMResult[];
    }>;
  }>;
  queries: Array<{ startId: string; endId: string; testCode: string; requestType: string }>;
  raw: string;
}

// ─── Parser Helpers ─────────────────────────────────────────────────────────

function splitFields(record: string, delimiter = '|'): string[] {
  return record.split(delimiter);
}

function splitComponents(field: string, delimiter = '^'): string[] {
  return field.split(delimiter);
}

function parseTestId(universalTestId: string): { code: string; name: string } {
  // ASTM universal test IDs can be:
  // "^^^WBC" or "^^^WBC^Name" or "WBC" or "WBC^White Blood Cell Count"
  const parts = splitComponents(universalTestId);
  // Find the first non-empty part after any leading ^^^
  const code = parts.find(p => p.trim().length > 0) || universalTestId;
  const name = parts.length > 1 ? (parts[parts.length - 1] || '') : '';
  return { code: code.trim(), name: name.trim() };
}

// ─── Record Parsers ─────────────────────────────────────────────────────────

function parseHeader(fields: string[]): ASTMHeader {
  // H|\\^&|||sender^name^address||||||processingId|version|timestamp
  const senderParts = splitComponents(fields[4] || '');
  return {
    recordType: 'H',
    delimiter: fields[1] || '\\^&',
    senderId: senderParts[0] || '',
    senderName: senderParts[1] || '',
    senderAddress: senderParts[2],
    receiverId: fields[9] || '',
    processingId: fields[11] || 'P',
    version: fields[12] || '',
    timestamp: fields[13] || '',
  };
}

function parsePatient(fields: string[]): ASTMPatient {
  // P|seq|practiceId|labId|id3|name^last^first|||dob|sex|...
  const nameParts = splitComponents(fields[5] || '');
  return {
    recordType: 'P',
    sequence: parseInt(fields[1]) || 1,
    practicePatientId: fields[2] || '',
    labPatientId: fields[3] || '',
    patientId3: fields[4],
    patientName: fields[5] || '',
    lastName: nameParts[0],
    firstName: nameParts[1],
    dob: fields[8],
    sex: fields[9],
    address: fields[10],
    phone: fields[13],
    attendingPhysician: fields[14],
    specialField1: fields[15],
    specialField2: fields[16],
  };
}

function parseOrder(fields: string[]): ASTMOrder {
  // O|seq|specimenId|instrumentId|universalTestId|priority|orderedDT|collectedDT||||||specimenType||||reportType
  const { code, name } = parseTestId(fields[4] || '');
  return {
    recordType: 'O',
    sequence: parseInt(fields[1]) || 1,
    specimenId: fields[2] || '',
    instrumentSpecimenId: fields[3],
    testId: fields[4] || '',
    testCode: code,
    testName: name,
    priority: fields[5],
    orderDateTime: fields[6],
    collectionDateTime: fields[7],
    specimenType: fields[15],
    reportType: fields[25] || 'F',
  };
}

function parseResult(fields: string[]): ASTMResult {
  // R|seq|universalTestId|value|units|refRange|abnormalFlag||status|...|completedDT|instrumentId
  const { code, name } = parseTestId(fields[2] || '');
  return {
    recordType: 'R',
    sequence: parseInt(fields[1]) || 1,
    testCode: code,
    testName: name,
    value: fields[3] || '',
    units: fields[4] || '',
    referenceRange: fields[5] || '',
    abnormalFlag: fields[6] || '',
    status: fields[8] || '',
    operatorId: fields[10],
    completedDateTime: fields[12],
    instrumentId: fields[13],
    comments: [],
  };
}

function parseComment(fields: string[]): ASTMComment {
  return {
    recordType: 'C',
    sequence: parseInt(fields[1]) || 1,
    source: fields[2] || 'I',
    text: fields[3] || '',
    commentType: fields[4],
  };
}

/** Parse Q (query) record — host query mode for bidirectional analyzers */
function parseQuery(fields: string[]): { startId: string; endId: string; testCode: string; requestType: string } {
  // Q|seq|startId^endId|testCode|||requestType
  const idParts = splitComponents(fields[2] || '');
  return {
    startId: idParts[0] || '',
    endId: idParts[1] || idParts[0] || '',
    testCode: fields[3] || '',
    requestType: fields[6] || '',
  };
}

// ─── Main Parse Function ────────────────────────────────────────────────────

export function parseASTMMessage(raw: string): ASTMParsedMessage {
  // Strip ASTM frame control characters if present
  const cleaned = raw
    .replace(/[\x02\x03\x04\x05\x06\x15\x17]/g, '') // STX, ETX, EOT, ENQ, ACK, NAK, ETB
    .replace(/\r\n/g, '\r')
    .replace(/\n/g, '\r');

  const lines = cleaned.split('\r').filter(l => l.trim().length > 0);

  // Remove frame numbers (e.g. "1H|..." → "H|...")
  const records = lines.map(line => {
    // ASTM frames start with a frame number: "1H|...", "2P|...", etc.
    const match = line.match(/^\d+([HPORLCQM]\|.*)$/);
    return match ? match[1] : line;
  });

  let header: ASTMHeader = {
    recordType: 'H',
    delimiter: '\\^&',
    senderId: '',
    senderName: '',
    processingId: 'P',
    version: '',
    timestamp: '',
  };

  const patients: ASTMParsedMessage['patients'] = [];
  const queries: ASTMParsedMessage['queries'] = [];
  let currentPatient: ASTMPatient | null = null;
  let currentOrders: Array<{ order: ASTMOrder; results: ASTMResult[] }> = [];
  let currentOrder: ASTMOrder | null = null;
  let currentResults: ASTMResult[] = [];
  let currentResult: ASTMResult | null = null;

  for (const record of records) {
    const fields = splitFields(record);
    const recordType = fields[0];

    switch (recordType) {
      case 'H': {
        header = parseHeader(fields);
        break;
      }
      case 'P': {
        // Save previous patient if exists
        if (currentPatient) {
          if (currentResult) currentResults.push(currentResult);
          if (currentOrder) currentOrders.push({ order: currentOrder, results: currentResults });
          patients.push({ patient: currentPatient, orders: currentOrders });
        }
        currentPatient = parsePatient(fields);
        currentOrders = [];
        currentOrder = null;
        currentResults = [];
        currentResult = null;
        break;
      }
      case 'O': {
        if (currentResult) currentResults.push(currentResult);
        if (currentOrder) currentOrders.push({ order: currentOrder, results: currentResults });
        currentOrder = parseOrder(fields);
        currentResults = [];
        currentResult = null;
        break;
      }
      case 'R': {
        if (currentResult) currentResults.push(currentResult);
        currentResult = parseResult(fields);

        // If no explicit order record, create a synthetic one
        if (!currentOrder && currentPatient) {
          currentOrder = {
            recordType: 'O',
            sequence: 1,
            specimenId: currentPatient.labPatientId || currentPatient.practicePatientId || '',
            testId: '',
            testCode: '',
            priority: 'R',
            reportType: 'F',
          };
        }
        break;
      }
      case 'C': {
        const comment = parseComment(fields);
        if (currentResult) {
          currentResult.comments.push(comment.text);
        }
        break;
      }
      case 'Q': {
        // Host query record — bidirectional analyzer requesting pending orders
        queries.push(parseQuery(fields));
        break;
      }
      case 'M': {
        // Manufacturer-specific — ignore but don't break parsing
        break;
      }
      case 'L': {
        // Terminator — flush everything
        if (currentResult) currentResults.push(currentResult);
        if (currentOrder) currentOrders.push({ order: currentOrder, results: currentResults });
        if (currentPatient) {
          patients.push({ patient: currentPatient, orders: currentOrders });
        }
        currentPatient = null;
        currentOrder = null;
        currentResults = [];
        currentResult = null;
        currentOrders = [];
        break;
      }
    }
  }

  // Handle case where no L terminator was present
  if (currentPatient) {
    if (currentResult) currentResults.push(currentResult);
    if (currentOrder) currentOrders.push({ order: currentOrder, results: currentResults });
    patients.push({ patient: currentPatient, orders: currentOrders });
  }

  return { header, patients, queries, raw };
}

// ─── ASTM Abnormal Flag Mapper ──────────────────────────────────────────────

export function mapASTMAbnormalFlag(flag: string): 'normal' | 'high' | 'low' | 'critical' | 'pending' {
  switch (flag.toUpperCase().trim()) {
    case 'N':
    case '': return 'normal';
    case 'H': return 'high';
    case 'L': return 'low';
    case 'HH':
    case 'LL':
    case 'A':
    case '>':
    case '<': return 'critical';
    default: return 'pending';
  }
}

// ─── ASTM Result Status Mapper ──────────────────────────────────────────────

export function mapASTMResultStatus(status: string): 'preliminary' | 'final' | 'corrected' | 'cancelled' | 'unrecognized' {
  switch (status.toUpperCase().trim()) {
    case 'F': return 'final';
    case 'P': return 'preliminary';
    case 'C': return 'corrected';
    case 'X': return 'cancelled';
    default: return 'unrecognized';
  }
}
