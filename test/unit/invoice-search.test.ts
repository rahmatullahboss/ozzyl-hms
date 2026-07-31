import { describe, it, expect } from 'vitest';
import {
  buildInvoiceSearchTerms,
  buildInvoiceSearchTermList,
  escapeLikeWildcards,
} from '../../src/lib/invoice-search';

describe('buildInvoiceSearchTerms', () => {
  it('wraps the original trimmed input in % wildcards', () => {
    const out = buildInvoiceSearchTerms('INV-000001');
    expect(out.original).toBe('%INV-000001%');
    expect(out.normalized).toBe('%INV-000001%');
  });

  it('normalises letter o and O to digit 0', () => {
    const out = buildInvoiceSearchTerms('inv-oooo12');
    expect(out.original).toBe('%inv-oooo12%');
    expect(out.normalized).toBe('%inv-000012%');
  });

  it('builds a compact invoice pattern that tolerates separator differences', () => {
    const out = buildInvoiceSearchTerms('BL-0000-14');
    expect(out.compact).toBe('%BL000014%');
    expect(out.padded).toBe('%000014%');
  });

  it('pads pure-digit inputs shorter than 6 chars to six digits', () => {
    const out = buildInvoiceSearchTerms('23');
    expect(out.padded).toBe('%000023%');
  });

  it('pads digit-only input that contains letter-o typos', () => {
    const out = buildInvoiceSearchTerms('oooo23');
    expect(out.padded).toBe('%000023%');
  });

  it('does not pad digit-only inputs with 6+ chars', () => {
    const out = buildInvoiceSearchTerms('1234567');
    expect(out.padded).toBe('%1234567%');
  });

  it('returns empty-string patterns for blank input', () => {
    const out = buildInvoiceSearchTerms('   ');
    expect(out.original).toBe('%%');
    expect(out.normalized).toBe('%%');
    expect(out.compact).toBe('%%');
    expect(out.padded).toBe('%%');
  });
  it('builds individual invoice terms for comma-separated search fragments', () => {
    const out = buildInvoiceSearchTermList('14,289,23');
    expect(out.map((term) => term.padded)).toEqual(['%1428923%', '%000014%', '%000289%', '%000023%']);
  });
});

describe('escapeLikeWildcards', () => {
  it('escapes % and _ characters', () => {
    expect(escapeLikeWildcards('50%_off')).toBe('50\\%\\_off');
  });

  it('leaves normal characters untouched', () => {
    expect(escapeLikeWildcards('INV-000001')).toBe('INV-000001');
  });
});