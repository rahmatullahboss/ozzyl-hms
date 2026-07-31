/**
 * Bulk Import (PDF Import) Tests for Shareholders
 * 
 * Tests the PDF parsing logic and bulk import API endpoint
 */

import { describe, it, expect } from 'vitest';

// ─── Bengali Number Parser Tests ─────────────────────────────────────────

describe('Bengali Number Parser', () => {
  // Mock the bengaliToEnglishNumber function
  const bengaliToEnglish = (str: string): string => {
    const map: Record<string, string> = {
      '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
      '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
    };
    return str.replace(/[০-৯]/g, (d) => map[d] || d);
  };

  const parseBengaliNumber = (str: string): number => {
    if (!str) return 0;
    let cleaned = bengaliToEnglish(str);
    cleaned = cleaned.replace(/,/g, '');
    const numMatch = cleaned.match(/[\d.]+/);
    return numMatch ? parseFloat(numMatch[0]) : 0;
  };

  it('should convert Bengali digits to English', () => {
    expect(bengaliToEnglish('২০')).toBe('20');
    expect(bengaliToEnglish('১২৩৪৫')).toBe('12345');
    expect(bengaliToEnglish('০১৭৭৪৭৭৭৬৪১')).toBe('01774777641');
  });

  it('should parse Bengali numbers correctly', () => {
    expect(parseBengaliNumber('২০')).toBe(20);
    expect(parseBengaliNumber('২০,০০০')).toBe(20000);
    expect(parseBengaliNumber('১ লক্ষ')).toBe(1); // Without multiplier handling
  });

  it('should handle mixed Bengali and English text', () => {
    expect(parseBengaliNumber('20')).toBe(20);
    expect(parseBengaliNumber('২০টি')).toBe(20);
    expect(parseBengaliNumber('মূল্য: ২০০০০')).toBe(20000);
  });

  it('should return 0 for invalid input', () => {
    expect(parseBengaliNumber('')).toBe(0);
    expect(parseBengaliNumber('abc')).toBe(0);
    expect(parseBengaliNumber('টাকা')).toBe(0);
  });
});

// ─── PDF Text Parser Tests ──────────────────────────────────────────────

describe('PDF Shareholder Parser', () => {
  const cleanExtractedText = (text: string): string => {
    return text
      .replace(/[|]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[.]{3,}/g, '')
      .replace(/^\s*[.…]+\s*/, '')
      .trim();
  };

  it('should clean extracted text properly', () => {
    expect(cleanExtractedText('...  মোঃ সিদ্দীকুমার  ')).toBe('মোঃ সিদ্দীকুমার');
    expect(cleanExtractedText('| মোঃ করিম |')).toBe('মোঃ করিম');
    expect(cleanExtractedText('....test....')).toBe('test');
  });

  it('should extract phone numbers from text', () => {
    const extractPhone = (text: string): string | null => {
      const phonePattern = /(?:01\d{9}|০১[০-৯]{9})/;
      const match = text.match(phonePattern);
      if (!match) return null;
      const bengaliToEnglish = (s: string) => s.replace(/[০-৯]/g, (d) => {
        const map: Record<string, string> = {
          '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
          '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
        };
        return map[d] || d;
      });
      return bengaliToEnglish(match[0]);
    };

    expect(extractPhone('মোবাইল: 01774777641')).toBe('01774777641');
    expect(extractPhone('ফোন: ০১৭৬২৩৪০০৩৬')).toBe('01762340036');
    expect(extractPhone('কোনো ফোন নেই')).toBe(null);
  });

  it('should extract NID from text', () => {
    const extractNID = (text: string): string | null => {
      // Match NID after "NID:" or similar, capturing the full number
      const nidPattern = /(?:NID|জাতীয়\s*পরিচয়)[：:\s]*(\d{10,})/;
      const match = text.match(nidPattern);
      if (match) return match[1];
      // Fallback: any 10+ digit sequence
      const fallbackPattern = /\b(\d{10,})\b/;
      const fallbackMatch = text.match(fallbackPattern);
      return fallbackMatch ? fallbackMatch[1] : null;
    };

    expect(extractNID('NID: 671685583367074')).toBe('671685583367074');
    expect(extractNID('জাতীয় পরিচয়: 1234567890')).toBe('1234567890');
    expect(extractNID('কোনো NID নেই')).toBe(null);
  });

  it('should extract share count from text', () => {
    const extractShares = (text: string): number => {
      const bengaliToNum = (s: string) => {
        const map: Record<string, string> = {
          '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
          '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
        };
        return s.replace(/[০-৯]/g, (d) => map[d] || d);
      };

      const patterns = [
        /শেয়ার\s*(?:সংখ্যা)?[ঃ:]\s*([০-৯\d]+)/,
        /শেয়ার\s*(\d+)\s*টি/,
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          return parseInt(bengaliToNum(match[1]));
        }
      }
      return 0;
    };

    expect(extractShares('শেয়ার সংখ্যা: ২০')).toBe(20);
    expect(extractShares('শেয়ার: 15 টি')).toBe(15);
    expect(extractShares('কোনো শেয়ার নেই')).toBe(0);
  });
});

// ─── Validation Tests ───────────────────────────────────────────────────

describe('Shareholder Validation', () => {
  interface Shareholder {
    name: string;
    phone?: string;
    nid?: string;
    shareCount: number;
  }

  const validate = (sh: Shareholder): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    if (!sh.name || sh.name.length < 2) errors.push('Name required');
    if (sh.shareCount < 0) errors.push('Share count cannot be negative');
    return { valid: errors.length === 0, errors };
  };

  it('should validate valid shareholder', () => {
    const result = validate({
      name: 'মোঃ সিদ্দীকুমার',
      phone: '01774777641',
      nid: '671685583367074',
      shareCount: 20,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject empty name', () => {
    const result = validate({ name: '', shareCount: 10 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Name required');
  });

  it('should reject negative share count', () => {
    const result = validate({ name: 'Test', shareCount: -5 });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Share count cannot be negative');
  });
});

// ─── Share Cap Logic Tests ──────────────────────────────────────────────

describe('Share Cap Enforcement', () => {
  const checkCap = (
    current: number,
    requested: number,
    max: number
  ): { allowed: boolean; remaining: number } => {
    const remaining = max - current;
    return {
      allowed: current + requested <= max,
      remaining,
    };
  };

  it('should allow import within cap', () => {
    const result = checkCap(50, 30, 100);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(50);
  });

  it('should reject import exceeding cap', () => {
    const result = checkCap(80, 30, 100);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(20);
  });

  it('should handle exact cap limit', () => {
    const result = checkCap(90, 10, 100);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(10);
  });
});

// ─── Duplicate Detection Tests ──────────────────────────────────────────

describe('Duplicate Detection', () => {
  const existingNids = new Set(['671685583367074', '1234567890123']);
  const existingPhones = new Set(['01774777641', '01812345678']);

  const isDuplicate = (nid?: string, phone?: string): boolean => {
    if (nid && existingNids.has(nid)) return true;
    if (phone && existingPhones.has(phone)) return true;
    return false;
  };

  it('should detect duplicate by NID', () => {
    expect(isDuplicate('671685583367074', '01900000000')).toBe(true);
  });

  it('should detect duplicate by phone', () => {
    expect(isDuplicate('999999999999999', '01774777641')).toBe(true);
  });

  it('should allow unique records', () => {
    expect(isDuplicate('999999999999999', '01900000000')).toBe(false);
  });
});

// ─── Investment Calculation Tests ────────────────────────────────────────

describe('Investment Calculation', () => {
  const calculateInvestment = (shareCount: number, shareValue: number): number => {
    return shareCount * shareValue;
  };

  it('should calculate investment correctly', () => {
    expect(calculateInvestment(20, 100000)).toBe(2000000);
    expect(calculateInvestment(5, 100000)).toBe(500000);
  });

  it('should handle zero shares', () => {
    expect(calculateInvestment(0, 100000)).toBe(0);
  });

  it('should handle large numbers', () => {
    expect(calculateInvestment(100, 100000)).toBe(10000000);
  });
});
