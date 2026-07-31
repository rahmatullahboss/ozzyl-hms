import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildHl7Ack,
  parseMshFields,
  resolveHl7AckDecision,
  wrapMllp,
} = require('../tools/lab-middleware/hl7-ack.cjs') as typeof import('../tools/lab-middleware/hl7-ack.cjs');

const HL7 = [
  'MSH|^~\\&|ANALYZER|LAB|HMS|OZZYL|20260709100000||ORU^R01|MSG-123|P|2.3',
  'PID|||P001||TEST^PATIENT',
  'OBR|1|LO-1|FILLER-1|CBC^Complete Blood Count',
  'OBX|1|NM|HGB^Hemoglobin||14.2|g/dL|12-16|N|||F',
].join('\r');

describe('HL7 ACK/NACK policy helper', () => {
  it('parses MSH routing fields for ACK construction', () => {
    expect(parseMshFields(HL7)).toMatchObject({
      sendingApp: 'ANALYZER',
      sendingFacility: 'LAB',
      messageControlId: 'MSG-123',
      processingId: 'P',
      version: '2.3',
    });
  });

  it('ACKs queued transient failures in practical default mode', () => {
    const decision = resolveHl7AckDecision({ ok: false, queued: true, status: 503 }, 'always_ack_after_queue');
    expect(decision).toEqual({ code: 'AA', text: 'accepted_for_retry' });

    const ack = buildHl7Ack(HL7, decision, { date: new Date('2026-07-09T10:30:00Z') });
    expect(ack).toContain('MSH|^~\\&|HMS|OZZYL|ANALYZER|LAB|20260709103000||ACK|MSG-123|P|2.3');
    expect(ack).toContain('MSA|AA|MSG-123|accepted_for_retry');
    expect(wrapMllp(ack)).toBe(`\x0b${ack}\x1c\x0d`);
  });

  it('does not ACK queued failures in strict success-only mode', () => {
    const decision = resolveHl7AckDecision({ ok: false, queued: true, status: 503 }, 'ack_only_after_api_success');
    expect(decision).toEqual({ code: 'AE', text: 'queued_but_not_acked_by_policy' });
  });

  it('rejects permanent client/config errors so operators fix them instead of retrying forever', () => {
    expect(resolveHl7AckDecision({ ok: false, queued: false, status: 401 }, 'always_ack_after_queue')).toEqual({
      code: 'AR',
      text: 'rejected_401',
    });
    expect(resolveHl7AckDecision({ ok: true }, 'ack_only_after_api_success')).toEqual({
      code: 'AA',
      text: 'accepted',
    });
  });
});
