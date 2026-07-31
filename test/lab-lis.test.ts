import { describe, it, expect } from 'vitest';
import { parseHL7Message, mapHL7AbnormalFlag, mapHL7ResultStatus, generateHL7Order, validateHL7ClinicalMessage } from '../src/lib/hl7-parser';
import { parseASTMMessage, mapASTMAbnormalFlag, mapASTMResultStatus } from '../src/lib/astm-parser';

// ═══════════════════════════════════════════════════════════════════════════════
// HL7v2 Parser Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('HL7v2 Parser', () => {
  const sampleORU = [
    'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260420120000||ORU^R01|MSG00001|P|2.3',
    'PID|||12345||DOE^JOHN^M||19800115|M|||123 Main St',
    'ORC|RE|ORD001',
    'OBR|1|ORD001||CBC^Complete Blood Count|||20260420100000',
    'OBX|1|NM|WBC^White Blood Cell Count||8.5|10*3/uL|4.5-11.0|N|||F',
    'OBX|2|NM|RBC^Red Blood Cell Count||4.8|10*6/uL|4.5-5.5|N|||F',
    'OBX|3|NM|HGB^Hemoglobin||14.2|g/dL|12.0-16.0|N|||F',
    'OBX|4|NM|PLT^Platelet Count||250|10*3/uL|150-400|N|||F',
    'NTE|1||Normal CBC results',
  ].join('\r');

  it('should parse MSH segment correctly', () => {
    const result = parseHL7Message(sampleORU);
    expect(result.message.messageType).toBe('ORU^R01');
    expect(result.message.messageControlId).toBe('MSG00001');
    expect(result.message.sendingApp).toBe('ANALYZER');
    expect(result.message.sendingFacility).toBe('LAB');
    expect(result.message.receivingApp).toBe('HMS');
    expect(result.message.version).toBe('2.3');
  });

  it('should parse PID segment correctly', () => {
    const result = parseHL7Message(sampleORU);
    expect(result.patient).not.toBeNull();
    expect(result.patient!.patientId).toBe('12345');
    expect(result.patient!.lastName).toBe('DOE');
    expect(result.patient!.firstName).toBe('JOHN');
    expect(result.patient!.dob).toBe('19800115');
    expect(result.patient!.sex).toBe('M');
  });

  it('should parse OBX results correctly', () => {
    const result = parseHL7Message(sampleORU);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0].results).toHaveLength(4);

    const wbc = result.orders[0].results[0];
    expect(wbc.resultCode).toBe('WBC');
    expect(wbc.resultText).toBe('White Blood Cell Count');
    expect(wbc.value).toBe('8.5');
    expect(wbc.units).toBe('10*3/uL');
    expect(wbc.range).toBe('4.5-11.0');
    expect(wbc.abnormalFlag).toBe('N');
    expect(wbc.resultStatus).toBe('F');
  });

  it('should parse OBR order info', () => {
    const result = parseHL7Message(sampleORU);
    const order = result.orders[0].order;
    expect(order.placerOrderNumber).toBe('ORD001');
    expect(order.procedureCode).toBe('CBC');
    expect(order.procedureName).toBe('Complete Blood Count');
  });

  it('should collect NTE comments', () => {
    const result = parseHL7Message(sampleORU);
    // NTE after OBX goes to last result's comments
    const lastResult = result.orders[0].results[3];
    expect(lastResult.comments).toContain('Normal CBC results');
  });

  it('should handle \\n and \\r\\n line endings', () => {
    const msg = sampleORU.replace(/\r/g, '\n');
    const result = parseHL7Message(msg);
    expect(result.orders[0].results).toHaveLength(4);

    const msg2 = sampleORU.replace(/\r/g, '\r\n');
    const result2 = parseHL7Message(msg2);
    expect(result2.orders[0].results).toHaveLength(4);
  });

  it('should handle empty/missing segments gracefully', () => {
    const minimal = 'MSH|^~\\&|APP|FAC|||20260420||ORU^R01|1|P|2.3';
    const result = parseHL7Message(minimal);
    expect(result.message.messageType).toBe('ORU^R01');
    expect(result.patient).toBeNull();
    expect(result.orders).toHaveLength(0);
  });

  it('rejects an ORU result message without MSH-10 message control id', () => {
    const missingControlId = [
      'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260420120000||ORU^R01||P|2.3',
      'OBR|1|ORD001||CBC^Complete Blood Count',
      'OBX|1|NM|HGB^Hemoglobin||14.2|g/dL|12-16|N|||F',
    ].join('\r');

    const validation = validateHL7ClinicalMessage(parseHL7Message(missingControlId));

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('HL7 message is missing MSH-10 message control id');
  });

  it('should handle abnormal results', () => {
    const abnormal = [
      'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260420||ORU^R01|2|P|2.3',
      'PID|||999||SMITH^JANE',
      'OBR|1|ORD002||GLUCOSE',
      'OBX|1|NM|GLU^Glucose||350|mg/dL|70-100|HH|||F',
    ].join('\r');

    const result = parseHL7Message(abnormal);
    expect(result.orders[0].results[0].value).toBe('350');
    expect(result.orders[0].results[0].abnormalFlag).toBe('HH');
  });

  it('should parse multiple orders in one message', () => {
    const multi = [
      'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260420||ORU^R01|3|P|2.3',
      'PID|||100||ALI^KARIM',
      'ORC|RE|ORD-A',
      'OBR|1|ORD-A||CBC',
      'OBX|1|NM|WBC||7.0|10*3/uL|4.5-11.0|N|||F',
      'ORC|RE|ORD-B',
      'OBR|2|ORD-B||LFT',
      'OBX|1|NM|ALT||45|U/L|7-56|N|||F',
      'OBX|2|NM|AST||38|U/L|10-40|N|||F',
    ].join('\r');

    const result = parseHL7Message(multi);
    expect(result.orders).toHaveLength(2);
    expect(result.orders[0].results).toHaveLength(1);
    expect(result.orders[1].results).toHaveLength(2);
  });
});

describe('HL7 Abnormal Flag Mapper', () => {
  it('should map standard flags', () => {
    expect(mapHL7AbnormalFlag('N')).toBe('normal');
    expect(mapHL7AbnormalFlag('H')).toBe('high');
    expect(mapHL7AbnormalFlag('L')).toBe('low');
    expect(mapHL7AbnormalFlag('HH')).toBe('critical');
    expect(mapHL7AbnormalFlag('LL')).toBe('critical');
    expect(mapHL7AbnormalFlag('A')).toBe('abnormal');
    expect(mapHL7AbnormalFlag('AA')).toBe('abnormal');
    expect(mapHL7AbnormalFlag('')).toBe('pending');
    expect(mapHL7AbnormalFlag('X')).toBe('pending');
  });
});

describe('HL7 Result Status Mapper', () => {
  it('should map standard statuses', () => {
    expect(mapHL7ResultStatus('P')).toBe('preliminary');
    expect(mapHL7ResultStatus('F')).toBe('final');
    expect(mapHL7ResultStatus('C')).toBe('corrected');
    expect(mapHL7ResultStatus('X')).toBe('cancelled');
    expect(mapHL7ResultStatus('')).toBe('unrecognized');
  });
});

describe('HL7 Order Generation', () => {
  it('should generate valid ORM^O01 message', () => {
    const msg = generateHL7Order({
      sendingApp: 'HMS',
      sendingFacility: 'OZZYL',
      receivingApp: 'LABCORP',
      receivingFacility: 'LAB',
      controlId: 'CTRL001',
      patient: { id: '12345', lastName: 'DOE', firstName: 'JOHN', dob: '19800115', sex: 'M' },
      order: { orderId: 'ORD001', orderDate: '20260420120000', priority: 'R' },
      tests: [{ sequence: 1, code: 'CBC', name: 'Complete Blood Count' }],
    });

    expect(msg).toContain('MSH|^~\\&|HMS|OZZYL|LABCORP|LAB');
    expect(msg).toContain('ORM^O01');
    expect(msg).toContain('PID|||12345||DOE^JOHN');
    expect(msg).toContain('ORC|NW|ORD001');
    expect(msg).toContain('OBR|1|ORD001||CBC^Complete Blood Count');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ASTM LIS2-A2 Parser Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('ASTM Parser', () => {
  // Mindray BC-5000 style ASTM message
  const sampleASTM = [
    'H|\\^&|||Mindray^BC-5000^001|||||||P|LIS2-A2|20260420120000',
    'P|1|PAT-001|LAB-001||Rahman^Zisan|||19900101|M',
    'O|1|SPEC-001||^^^WBC|||20260420100000',
    'R|1|^^^WBC^White Blood Cell Count|8.5|10*3/uL|4.5-11.0|N||F',
    'R|2|^^^RBC^Red Blood Cell Count|4.8|10*6/uL|4.5-5.5|N||F',
    'R|3|^^^HGB^Hemoglobin|14.2|g/dL|12.0-16.0|N||F',
    'R|4|^^^PLT^Platelet Count|250|10*3/uL|150-400|N||F',
    'C|1|I|Normal hematology results',
    'L|1|N',
  ].join('\r');

  it('should parse ASTM header', () => {
    const result = parseASTMMessage(sampleASTM);
    expect(result.header.recordType).toBe('H');
    expect(result.header.senderName).toBe('BC-5000');
    expect(result.header.processingId).toBe('P');
    expect(result.header.version).toBe('LIS2-A2');
  });

  it('should parse patient record', () => {
    const result = parseASTMMessage(sampleASTM);
    expect(result.patients).toHaveLength(1);

    const patient = result.patients[0].patient;
    expect(patient.practicePatientId).toBe('PAT-001');
    expect(patient.labPatientId).toBe('LAB-001');
    expect(patient.lastName).toBe('Rahman');
    expect(patient.firstName).toBe('Zisan');
    expect(patient.sex).toBe('M');
  });

  it('should parse order record', () => {
    const result = parseASTMMessage(sampleASTM);
    const order = result.patients[0].orders[0].order;
    expect(order.specimenId).toBe('SPEC-001');
    expect(order.testCode).toBe('WBC');
    expect(order.reportType).toBe('F');
  });

  it('should parse result records', () => {
    const result = parseASTMMessage(sampleASTM);
    const results = result.patients[0].orders[0].results;
    expect(results).toHaveLength(4);

    expect(results[0].testCode).toBe('WBC');
    expect(results[0].value).toBe('8.5');
    expect(results[0].units).toBe('10*3/uL');
    expect(results[0].referenceRange).toBe('4.5-11.0');
    expect(results[0].abnormalFlag).toBe('N');
    expect(results[0].status).toBe('F');

    expect(results[2].testCode).toBe('HGB');
    expect(results[2].value).toBe('14.2');
  });

  it('should collect comments on result records', () => {
    const result = parseASTMMessage(sampleASTM);
    const lastResult = result.patients[0].orders[0].results[3];
    expect(lastResult.comments).toContain('Normal hematology results');
  });

  it('should handle frame numbers (e.g. "1H|...", "2P|...")', () => {
    const framedASTM = [
      '1H|\\^&|||Mindray^BC-5000',
      '2P|1|PAT-002|||Test^Patient',
      '3R|1|^^^WBC|7.2|10*3/uL|4.5-11.0|N||F',
      '4L|1|N',
    ].join('\r');

    const result = parseASTMMessage(framedASTM);
    expect(result.patients).toHaveLength(1);
    expect(result.patients[0].orders[0].results[0].testCode).toBe('WBC');
    expect(result.patients[0].orders[0].results[0].value).toBe('7.2');
  });

  it('should strip ASTM control characters', () => {
    // Simulate raw ASTM with STX/ETX/ENQ/ACK/EOT
    const raw = '\x05\x02H|\\^&|||Analyzer\x03\rP|1|PAT\rR|1|^^^GLU|120|mg/dL|70-100|H||F\rL|1\x04';
    const result = parseASTMMessage(raw);
    expect(result.patients[0].orders[0].results[0].value).toBe('120');
    expect(result.patients[0].orders[0].results[0].abnormalFlag).toBe('H');
  });

  it('should handle results without explicit order record', () => {
    const noOrder = [
      'H|\\^&|||Beckman^AU480',
      'P|1|PAT-003|||Rahim^Karim',
      'R|1|^^^ALT|45|U/L|7-56|N||F',
      'R|2|^^^AST|38|U/L|10-40|N||F',
      'L|1|N',
    ].join('\r');

    const result = parseASTMMessage(noOrder);
    expect(result.patients).toHaveLength(1);
    expect(result.patients[0].orders).toHaveLength(1);
    expect(result.patients[0].orders[0].results).toHaveLength(2);
  });

  it('should handle multiple patients in one transmission', () => {
    const multi = [
      'H|\\^&|||Sysmex^XN',
      'P|1|PAT-A|||Patient^A',
      'R|1|^^^WBC|6.0|10*3/uL|4.5-11.0|N||F',
      'P|2|PAT-B|||Patient^B',
      'R|1|^^^WBC|15.0|10*3/uL|4.5-11.0|H||F',
      'L|1|N',
    ].join('\r');

    const result = parseASTMMessage(multi);
    expect(result.patients).toHaveLength(2);
    expect(result.patients[0].patient.practicePatientId).toBe('PAT-A');
    expect(result.patients[0].orders[0].results[0].value).toBe('6.0');
    expect(result.patients[1].patient.practicePatientId).toBe('PAT-B');
    expect(result.patients[1].orders[0].results[0].value).toBe('15.0');
    expect(result.patients[1].orders[0].results[0].abnormalFlag).toBe('H');
  });

  it('should handle abnormal results', () => {
    const abnormal = [
      'H|\\^&|||Mindray',
      'P|1|PAT-X|||Critical^Patient',
      'R|1|^^^GLU|450|mg/dL|70-100|HH||F',
      'R|2|^^^K|2.5|mEq/L|3.5-5.0|LL||F',
      'L|1|N',
    ].join('\r');

    const result = parseASTMMessage(abnormal);
    const results = result.patients[0].orders[0].results;
    expect(results[0].abnormalFlag).toBe('HH');
    expect(results[1].abnormalFlag).toBe('LL');
  });
});

describe('ASTM Abnormal Flag Mapper', () => {
  it('should map ASTM flags', () => {
    expect(mapASTMAbnormalFlag('N')).toBe('normal');
    expect(mapASTMAbnormalFlag('')).toBe('normal');
    expect(mapASTMAbnormalFlag('H')).toBe('high');
    expect(mapASTMAbnormalFlag('L')).toBe('low');
    expect(mapASTMAbnormalFlag('HH')).toBe('critical');
    expect(mapASTMAbnormalFlag('LL')).toBe('critical');
    expect(mapASTMAbnormalFlag('A')).toBe('critical');
  });
});

describe('ASTM Result Status Mapper', () => {
  it('should map ASTM statuses', () => {
    expect(mapASTMResultStatus('F')).toBe('final');
    expect(mapASTMResultStatus('P')).toBe('preliminary');
    expect(mapASTMResultStatus('C')).toBe('corrected');
    expect(mapASTMResultStatus('X')).toBe('cancelled');
    expect(mapASTMResultStatus('')).toBe('unrecognized');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Zod Schema Validation Tests
// ═══════════════════════════════════════════════════════════════════════════════

import { createLabMachineSchema, machineResultSchema, hl7MessageReceiveSchema, astmMessageReceiveSchema } from '../src/schemas/labMachine';
import { createPanelSchema, bulkResultEntrySchema, createLabOrderExtendedSchema } from '../src/schemas/lab';

describe('Lab Machine Schemas', () => {
  it('should validate createLabMachineSchema', () => {
    const valid = { machine_name: 'Mindray BC-5000', machine_code: 'MINDRAY-BC5000', protocol: 'astm', connection_type: 'tcp' };
    expect(createLabMachineSchema.safeParse(valid).success).toBe(true);

    const invalid = { machine_name: '', machine_code: '' };
    expect(createLabMachineSchema.safeParse(invalid).success).toBe(false);
  });

  it('should validate machineResultSchema requires identifier', () => {
    const noId = { results: [{ testCode: 'WBC', value: '8.5' }] };
    expect(machineResultSchema.safeParse(noId).success).toBe(false);

    const withBarcode = { barcode: 'BC-001', results: [{ testCode: 'WBC', value: '8.5' }] };
    expect(machineResultSchema.safeParse(withBarcode).success).toBe(true);

    const withControlId = { controlId: 'CTRL-001', results: [{ testCode: 'HGB', value: '14.2' }] };
    expect(machineResultSchema.safeParse(withControlId).success).toBe(true);
  });

  it('should validate hl7MessageReceiveSchema', () => {
    const valid = { machineCode: 'SYSMEX', message: 'MSH|^~\\&|APP|FAC|||20260420||ORU^R01|1|P|2.3' };
    expect(hl7MessageReceiveSchema.safeParse(valid).success).toBe(true);

    const tooShort = { message: 'MSH' };
    expect(hl7MessageReceiveSchema.safeParse(tooShort).success).toBe(false);
  });

  it('should validate createPanelSchema', () => {
    const valid = { code: 'CBC', name: 'Complete Blood Count', price: 500, childTestIds: [1, 2, 3] };
    expect(createPanelSchema.safeParse(valid).success).toBe(true);

    const noChildren = { code: 'CBC', name: 'CBC', price: 500, childTestIds: [] };
    expect(createPanelSchema.safeParse(noChildren).success).toBe(false);
  });

  it('should validate bulkResultEntrySchema', () => {
    const valid = { results: [{ lab_test_id: 1, result_value: '8.5' }] };
    expect(bulkResultEntrySchema.safeParse(valid).success).toBe(true);

    const empty = { results: [] };
    expect(bulkResultEntrySchema.safeParse(empty).success).toBe(false);
  });

  it('should validate createLabOrderExtendedSchema with priority', () => {
    const valid = { patientId: 1, priority: 'stat', items: [{ labTestId: 1, discount: 0 }] };
    expect(createLabOrderExtendedSchema.safeParse(valid).success).toBe(true);

    const invalidPriority = { patientId: 1, priority: 'invalid', items: [{ labTestId: 1, discount: 0 }] };
    expect(createLabOrderExtendedSchema.safeParse(invalidPriority).success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Fix Verification Tests — HL7 Escape, ASTM Checksum, Q Records
// ═══════════════════════════════════════════════════════════════════════════════

import { decodeHL7Escapes, parseHL7DateTime } from '../src/lib/hl7-parser';
import { calculateASTMChecksum, validateASTMFrame, reassembleASTMFrames } from '../src/lib/astm-parser';

describe('HL7 Escape Sequence Decoder', () => {
  it('should decode standard escape sequences', () => {
    expect(decodeHL7Escapes('Normal text')).toBe('Normal text');
    expect(decodeHL7Escapes('Field\\F\\sep')).toBe('Field|sep');
    expect(decodeHL7Escapes('Comp\\S\\sep')).toBe('Comp^sep');
    expect(decodeHL7Escapes('Rep\\R\\sep')).toBe('Rep~sep');
    expect(decodeHL7Escapes('Sub\\T\\sep')).toBe('Sub&sep');
    expect(decodeHL7Escapes('Esc\\E\\char')).toBe('Esc\\char');
    expect(decodeHL7Escapes('Line1\\.br\\Line2')).toBe('Line1\nLine2');
  });

  it('should decode hex escape sequences', () => {
    expect(decodeHL7Escapes('\\X41\\')).toBe('A');
    expect(decodeHL7Escapes('\\X0A\\')).toBe('\n');
  });

  it('should handle multiple escapes in one string', () => {
    expect(decodeHL7Escapes('a\\F\\b\\S\\c\\R\\d')).toBe('a|b^c~d');
  });

  it('should pass through text without escapes unchanged', () => {
    expect(decodeHL7Escapes('Normal result: 14.2 g/dL')).toBe('Normal result: 14.2 g/dL');
  });
});

describe('HL7 DateTime Parser', () => {
  it('should parse full datetime', () => {
    const r = parseHL7DateTime('20260420120000');
    expect(r.datetime).toBe('2026-04-20T12:00:00');
    expect(r.timezone).toBe('');
  });

  it('should parse datetime with timezone', () => {
    const r = parseHL7DateTime('20260420120000+0600');
    expect(r.datetime).toBe('2026-04-20T12:00:00');
    expect(r.timezone).toBe('+0600');
  });

  it('should parse date-only', () => {
    const r = parseHL7DateTime('20260420');
    expect(r.datetime).toBe('2026-04-20T00:00:00');
  });

  it('should handle empty input', () => {
    const r = parseHL7DateTime('');
    expect(r.datetime).toBe('');
  });
});

describe('HL7 escape sequences in OBX values', () => {
  it('should decode escaped characters in result values', () => {
    const msg = [
      'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260420||ORU^R01|1|P|2.3',
      'PID|||1||DOE^JOHN',
      'OBR|1|ORD1||TEST',
      'OBX|1|ST|NOTE||Result with \\F\\ pipe and \\S\\ caret|||N|||F',
    ].join('\r');

    const result = parseHL7Message(msg);
    const obx = result.orders[0].results[0];
    expect(obx.value).toBe('Result with | pipe and ^ caret');
  });
});

describe('ASTM Checksum', () => {
  it('should calculate correct checksum', () => {
    // Frame content "1H|\\^&" with ETX (0x03)
    const cs = calculateASTMChecksum('1H|\\^&', 0x03);
    expect(cs).toMatch(/^[0-9A-F]{2}$/);
    expect(cs.length).toBe(2);
  });

  it('should produce consistent results', () => {
    const cs1 = calculateASTMChecksum('test', 0x03);
    const cs2 = calculateASTMChecksum('test', 0x03);
    expect(cs1).toBe(cs2);
  });

  it('should differ for different data', () => {
    const cs1 = calculateASTMChecksum('abc', 0x03);
    const cs2 = calculateASTMChecksum('xyz', 0x03);
    expect(cs1).not.toBe(cs2);
  });
});

describe('ASTM Frame Validation', () => {
  it('should validate a correct frame', () => {
    // Build a frame: STX + frame_num('1') + data('H|test') + ETX + checksum + CR
    const data = '1H|test';
    const checksum = calculateASTMChecksum(data, 0x03);
    const frameStr = '\x02' + data + '\x03' + checksum + '\r';
    const frame = new Uint8Array([...frameStr].map(c => c.charCodeAt(0)));

    const result = validateASTMFrame(frame);
    expect(result.valid).toBe(true);
    expect(result.data).toBe('H|test');
    expect(result.isIntermediate).toBe(false);
  });

  it('should detect invalid checksum', () => {
    const frameStr = '\x021H|test\x03FF\r'; // FF is wrong checksum
    const frame = new Uint8Array([...frameStr].map(c => c.charCodeAt(0)));

    const result = validateASTMFrame(frame);
    expect(result.valid).toBe(false);
  });

  it('should reject an invalid 00 checksum instead of bypassing validation', () => {
    const frameStr = '\x021H|test\x0300\r';
    const frame = new Uint8Array([...frameStr].map(c => c.charCodeAt(0)));

    const result = validateASTMFrame(frame);
    expect(result.valid).toBe(false);
  });

  it('should detect intermediate frame (ETB)', () => {
    const data = '1R|partial';
    const checksum = calculateASTMChecksum(data, 0x17); // ETB
    const frameStr = '\x02' + data + '\x17' + checksum + '\r';
    const frame = new Uint8Array([...frameStr].map(c => c.charCodeAt(0)));

    const result = validateASTMFrame(frame);
    expect(result.valid).toBe(true);
    expect(result.isIntermediate).toBe(true);
  });
});

describe('ASTM Multi-Frame Reassembly', () => {
  it('should reassemble ETB intermediate + ETX final frames', () => {
    // Frame 1: STX + '1' + 'R|1|WBC|' + ETB + checksum + CR
    const d1 = '1R|1|WBC|';
    const cs1 = calculateASTMChecksum(d1, 0x17);
    // Frame 2: STX + '2' + '8.5|units' + ETX + checksum + CR
    const d2 = '28.5|units';
    const cs2 = calculateASTMChecksum(d2, 0x03);

    const raw = '\x02' + d1 + '\x17' + cs1 + '\r' + '\x02' + d2 + '\x03' + cs2 + '\r';
    const buf = new Uint8Array([...raw].map(c => c.charCodeAt(0)));

    const records = reassembleASTMFrames(buf);
    expect(records).toHaveLength(1);
    expect(records[0]).toBe('R|1|WBC|8.5|units');
  });

  it('should handle ENQ and EOT control chars', () => {
    const d1 = '1H|test';
    const cs1 = calculateASTMChecksum(d1, 0x03);
    const raw = '\x05\x02' + d1 + '\x03' + cs1 + '\r\x04';
    const buf = new Uint8Array([...raw].map(c => c.charCodeAt(0)));

    const records = reassembleASTMFrames(buf);
    expect(records).toHaveLength(1);
    expect(records[0]).toBe('H|test');
  });
});

describe('ASTM Q Record (Host Query)', () => {
  it('should parse Q records for bidirectional communication', () => {
    const msg = [
      'H|\\^&|||Mindray^BC-5000',
      'Q|1|SPEC-001^SPEC-001|^^^ALL',
      'L|1|N',
    ].join('\r');

    const result = parseASTMMessage(msg);
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0].startId).toBe('SPEC-001');
    expect(result.queries[0].endId).toBe('SPEC-001');
  });
});
