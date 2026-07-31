import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  mapHL7ResultStatus,
  parseHL7Message,
  validateHL7ClinicalMessage,
} from '../src/lib/hl7-parser';
import {
  mapASTMResultStatus,
  parseASTMMessage,
} from '../src/lib/astm-parser';

function fixture(name: string): string {
  return readFileSync(join(process.cwd(), 'test', 'fixtures', 'lis', name), 'utf8');
}

describe('de-identified LIS golden protocol corpus', () => {
  it('parses and validates a representative final HL7 ORU', () => {
    const parsed = parseHL7Message(fixture('hl7-oru-final.hl7'));

    expect(validateHL7ClinicalMessage(parsed)).toEqual({ valid: true, errors: [] });
    expect(parsed.message.messageControlId).toBe('GOLDEN-HL7-001');
    expect(parsed.orders).toHaveLength(1);
    expect(parsed.orders[0].order.specimenId).toBe('BC-GOLDEN-100');
    expect(parsed.orders[0].results.map((result) => ({
      code: result.resultCode,
      value: result.value,
      status: mapHL7ResultStatus(result.resultStatus),
    }))).toEqual([
      { code: 'HGB', value: '14.2', status: 'final' },
      { code: 'WBC', value: '8.5', status: 'final' },
    ]);
  });

  it('preserves corrected HL7 status for governed correction review', () => {
    const parsed = parseHL7Message(fixture('hl7-oru-corrected.hl7'));
    const observation = parsed.orders[0].results[0];

    expect(validateHL7ClinicalMessage(parsed).valid).toBe(true);
    expect(parsed.message.messageControlId).toBe('GOLDEN-HL7-002');
    expect(observation.value).toBe('15.1');
    expect(mapHL7ResultStatus(observation.resultStatus)).toBe('corrected');
  });

  it('parses a representative ASTM result without defaulting unknown status', () => {
    const parsed = parseASTMMessage(fixture('astm-final.astm'));
    const order = parsed.patients[0].orders[0];
    const observation = order.results[0];

    expect(order.order.specimenId).toBe('BC-GOLDEN-100');
    expect(observation.testCode).toBe('HGB');
    expect(observation.value).toBe('14.2');
    expect(mapASTMResultStatus(observation.status)).toBe('final');
    expect(mapASTMResultStatus('UNKNOWN')).toBe('unrecognized');
  });
});
