import { describe, expect, it } from 'vitest';
import {
  mapHL7AbnormalFlag,
  mapHL7ResultStatus,
  parseHL7Message,
  validateHL7ClinicalMessage,
} from '../src/lib/hl7-parser';
import {
  calculateASTMChecksum,
  mapASTMResultStatus,
  validateASTMFrame,
} from '../src/lib/astm-parser';
import { deriveMachineResultWorkflowState } from '../src/lib/lab-machine-capabilities';
import {
  buildLisMessageIdentity,
  classifyReplay,
  resolveLisSourceIdentity,
  selectExactCandidate,
  sha256Hex,
} from '../src/lib/lis-ingestion';

describe('LIS protocol fail-closed behavior', () => {
  it('keeps generic HL7 abnormal separate from critical', () => {
    expect(mapHL7AbnormalFlag('A')).toBe('abnormal');
    expect(mapHL7AbnormalFlag('AA')).toBe('abnormal');
  });

  it('quarantines unknown or missing HL7 result status', () => {
    expect(mapHL7ResultStatus('')).toBe('unrecognized');
    expect(mapHL7ResultStatus('Z')).toBe('unrecognized');
    expect(deriveMachineResultWorkflowState('unrecognized')).toMatchObject({
      resultStatus: 'preliminary',
      itemStatus: 'processing',
      isFinalLike: false,
      recognized: false,
    });
  });

  it('rejects an HL7 clinical message with no observations', () => {
    const parsed = parseHL7Message(
      'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260710070000||ORU^R01|EMPTY-1|P|2.3',
    );

    expect(validateHL7ClinicalMessage(parsed)).toEqual({
      valid: false,
      errors: ['HL7 ORU message contains no observations'],
    });
  });

  it('accepts a supported HL7 ORU containing an observation', () => {
    const parsed = parseHL7Message([
      'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260710070000||ORU^R01|MSG-1|P|2.3',
      'PID|||P1||PATIENT^ONE',
      'OBR|1|ORD-1||CBC^Complete Blood Count',
      'OBX|1|NM|HGB^Hemoglobin||14.2|g/dL|12-16|N|||F',
    ].join('\r'));

    expect(validateHL7ClinicalMessage(parsed)).toEqual({ valid: true, errors: [] });
  });

  it('does not allow 00 to bypass an invalid ASTM checksum', () => {
    const frameStr = '\x021H|test\x0300\r';
    const frame = new Uint8Array([...frameStr].map((char) => char.charCodeAt(0)));

    expect(validateASTMFrame(frame).valid).toBe(false);
  });

  it('quarantines unknown or missing ASTM result status', () => {
    expect(mapASTMResultStatus('')).toBe('unrecognized');
    expect(mapASTMResultStatus('Z')).toBe('unrecognized');
  });

  it('still validates a correctly checksummed ASTM frame', () => {
    const data = '1H|test';
    const checksum = calculateASTMChecksum(data, 0x03);
    const frameStr = `\x02${data}\x03${checksum}\r`;
    const frame = new Uint8Array([...frameStr].map((char) => char.charCodeAt(0)));

    expect(validateASTMFrame(frame).valid).toBe(true);
  });
});

describe('LIS ingestion identity and matching', () => {
  it('creates a deterministic SHA-256 payload hash', async () => {
    await expect(sha256Hex('same-payload')).resolves.toBe(
      '09fdea45b68cb97db5a95abfe627f12c2107262a36dedb2f3cfcd318ae210c41',
    );
  });

  it('scopes message identity to tenant, machine, protocol and source identity', () => {
    const first = buildLisMessageIdentity({
      tenantId: 'tenant-1',
      machineId: 7,
      protocol: 'hl7',
      sourceIdentity: 'ANALYZER|LAB|ORU^R01|MSG-100',
    });
    const second = buildLisMessageIdentity({
      tenantId: 'tenant-2',
      machineId: 7,
      protocol: 'hl7',
      sourceIdentity: 'ANALYZER|LAB|ORU^R01|MSG-100',
    });

    expect(first).toBe('tenant-1:7:hl7:ANALYZER|LAB|ORU^R01|MSG-100');
    expect(second).not.toBe(first);
  });

  it('uses a stable bridge delivery id as the replay identity when available', () => {
    expect(resolveLisSourceIdentity('delivery-123', 'payload-hash')).toBe('delivery-123');
    expect(resolveLisSourceIdentity('  ', 'payload-hash')).toBe('payload-hash');
    expect(resolveLisSourceIdentity(null, 'payload-hash')).toBe('payload-hash');
  });

  it('classifies same identity and same hash as a duplicate replay', () => {
    expect(classifyReplay('abc123', 'abc123')).toBe('duplicate');
  });

  it('classifies same identity and different hash as a collision', () => {
    expect(classifyReplay('abc123', 'different')).toBe('collision');
  });

  it('selects only an exactly-one candidate match', () => {
    expect(selectExactCandidate([])).toEqual({ kind: 'none' });
    expect(selectExactCandidate([{ id: 1 }])).toEqual({ kind: 'exact', candidate: { id: 1 } });
    expect(selectExactCandidate([{ id: 1 }, { id: 2 }])).toEqual({ kind: 'ambiguous' });
  });
});
