import { describe, it, expect } from 'vitest';
import { safeJsonStringify } from '../../src/lib/security';

describe('safeJsonStringify', () => {
  it('should stringify a simple object', () => {
    const obj = { name: 'Hospital' };
    expect(safeJsonStringify(obj)).toBe('{"name":"Hospital"}');
  });

  it('should escape < and > to prevent script injection', () => {
    const obj = { name: '</script><script>alert(1)</script>' };
    const result = safeJsonStringify(obj);
    expect(result).not.toContain('</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e');
  });

  it('should escape & to prevent HTML entity attacks', () => {
    const obj = { name: 'A & B' };
    expect(safeJsonStringify(obj)).toContain('A \\u0026 B');
  });

  it('should escape line separators \u2028 and \u2029', () => {
    const obj = { text: '\u2028 and \u2029' };
    const result = safeJsonStringify(obj);
    expect(result).toContain('\\u2028');
    expect(result).toContain('\\u2029');
  });
});
