import { describe, expect, it } from 'vitest';
import { sha256Hex, stableClinicalJson } from '../src/lib/clinical-signatures';

describe('clinical signature serialization', () => {
  it('sorts nested object keys, removes undefined values, and preserves array order', () => {
    const serialized = stableClinicalJson({
      z: 3,
      nested: { beta: 2, alpha: 1, omitted: undefined },
      list: [{ y: 2, x: 1 }, 'second'],
      a: 1,
    });

    expect(serialized).toBe('{"a":1,"list":[{"x":1,"y":2},"second"],"nested":{"alpha":1,"beta":2},"z":3}');
  });

  it('produces the same SHA-256 hash for clinically identical objects with different key order', async () => {
    const first = stableClinicalJson({
      appointmentId: 44,
      soap: { assessment: 'Viral fever', chiefComplaint: 'Fever' },
      prescription: { status: 'final', items: [{ dosage: '500 mg', medicine: 'Paracetamol' }] },
    });
    const second = stableClinicalJson({
      prescription: { items: [{ medicine: 'Paracetamol', dosage: '500 mg' }], status: 'final' },
      soap: { chiefComplaint: 'Fever', assessment: 'Viral fever' },
      appointmentId: 44,
    });

    expect(first).toBe(second);
    await expect(sha256Hex(first)).resolves.toBe(await sha256Hex(second));
  });
});
