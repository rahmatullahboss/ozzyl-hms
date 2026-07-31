/**
 * PDF Parser for Shareholder Forms
 * 
 * Parses PDF text extracted from hospital shareholder registration forms
 * Supports both structured (table) and unstructured text formats
 * 
 * Compatible with: শাহ নেছার হাসপাতাল এন্ড ডায়াগনস্টিক সেন্টার format
 */

import { bengaliToEnglishNumber, parseBengaliNumber, cleanPhoneNumber, parseNID } from './bengaliNumbers';

export interface ParsedShareholder {
  name: string;
  nameEn?: string;
  phone?: string;
  phone2?: string;
  email?: string;
  nid?: string;
  shareCount: number;
  shareValueBdt?: number;
  investment?: number;
  address?: string;
  type: 'profit' | 'owner' | 'investor' | 'doctor' | 'shareholder';
  bankName?: string;
  bankAccountNo?: string;
  bankBranch?: string;
  routingNo?: string;
  nomineeName?: string;
  nomineeContact?: string;
  fatherName?: string;
  motherName?: string;
  religion?: string;
  nationality?: string;
  profession?: string;
  dateOfBirth?: string;
  birthCertificate?: string;
  passportNo?: string;
  serialNo?: string;
  annualIncome?: string;
  // _raw removed — sensitive data should not be exposed to client
}

/**
 * Parse PDF text content into shareholder data
 * @param text - Raw text extracted from PDF
 * @returns Array of parsed shareholders
 */
export function parseShareholderPDF(text: string): ParsedShareholder[] {
  // Split by form boundaries (multiple forms in one PDF)
  const forms = splitIntoForms(text);
  
  const shareholders: ParsedShareholder[] = [];
  
  for (const formText of forms) {
    const parsed = parseSingleForm(formText);
    if (parsed && parsed.name) {
      shareholders.push(parsed);
    }
  }
  
  return shareholders;
}

/**
 * Split PDF text into individual forms
 */
function splitIntoForms(text: string): string[] {
  // Try to split by common form separators
  const separators = [
    /শেয়ার গ্রহনের ফরম/g,
    /শেয়ার গ্রহনের আবেদন/g,
    /অংশীদারকারীর নাম/g,
    /বিনিয়োগ কারীর নাম/g,
  ];
  
  // If single form, return as is
  let matchCount = 0;
  for (const sep of separators) {
    const matches = text.match(sep);
    if (matches) matchCount += matches.length;
  }
  
  if (matchCount <= 1) {
    return [text];
  }
  
  // Split by form header patterns
  const formStartPattern = /(?:শেয়ার গ্রহনের ফরম|শেয়ার গ্রহনের আবেদন|বিনিয়োগ কারীর নাম)/g;
  const parts = text.split(formStartPattern);
  
  // Filter out empty parts and rejoin headers
  return parts.filter(p => p.trim().length > 50);
}

/**
 * Parse a single shareholder form
 */
function parseSingleForm(text: string): ParsedShareholder | null {
  try {
    const shareholder: ParsedShareholder = {
      name: '',
      type: 'investor',
      shareCount: 0,
      // _raw intentionally removed
    };
    
    // ── Extract Name (Bengali) ──
    // Use non-greedy match and stop at field delimiters
    const namePatterns = [
      /(?:অংশীদারকারীর|বিনিয়োগ\s*কারীর)\s*নাম[ঃ:]\s*(?:\(বাংলা(?:য়)?\))?\s*[.|…]*\s*([^\n|:]{2,100}?)(?:\s*$|\s*(?:পিতা|মাতা|নাম|ধর্ম))/,
      /নাম[ঃ:]\s*(?:\(বাংলা(?:য়)?\))?\s*[.|…]*\s*([^\n|:]{2,100}?)(?:\s*$|\s*(?:পিতা|মাতা|ধর্ম))/,
    ];
    
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        shareholder.name = cleanExtractedText(match[1]);
        break;
      }
    }
    
    // ── Extract Name (English) ──
    const nameEnPatterns = [
      /(?:অংশীদারকারীর|বিনিয়োগ\s*কারীর)\s*নাম[ঃ:]\s*(?:\(ইংরেজি(?:তে)?\))?\s*[.|…]*\s*([A-Za-z\s]+)/,
      /নাম[ঃ:]\s*(?:\(ইংরেজি(?:তে)?\))?\s*[.|…]*\s*([A-Za-z\s]+)/,
    ];
    
    for (const pattern of nameEnPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        shareholder.nameEn = match[1].trim();
        break;
      }
    }
    
    // ── Extract Phone Numbers ──
    const phonePatterns = [
      /মোবাইল\s*(?:নম্বর)?[ঃ:]\s*([^\n]+)/,
      /(?:যোগাযোগ|ফোন)[ঃ:]\s*([^\n]+)/,
      /(?:01\d{9}|০১\d{9})/g,
    ];
    
    const phones: string[] = [];
    for (const pattern of phonePatterns) {
      if (pattern.global) {
        const matches = text.match(pattern);
        if (matches) {
          phones.push(...matches.map(m => cleanPhoneNumber(m)));
        }
      } else {
        const match = text.match(pattern);
        if (match && match[1]) {
          // Extract all phone numbers from the line
          const phoneLine = match[1];
          const phoneMatches = phoneLine.match(/(?:01\d{9}|০১[০-৯]{9})/g);
          if (phoneMatches) {
            phones.push(...phoneMatches.map(p => cleanPhoneNumber(p)));
          }
        }
      }
    }
    
    // Also find phones in "অথবা" pattern (1/017..., 2/017...)
    const altPhonePattern = /(\d+)\/(01\d{9}|০১[০-৯]{9})/g;
    let altMatch;
    while ((altMatch = altPhonePattern.exec(text)) !== null) {
      phones.push(cleanPhoneNumber(altMatch[2]));
    }
    
    if (phones.length > 0) {
      shareholder.phone = phones[0];
      if (phones.length > 1) {
        shareholder.phone2 = phones[1];
      }
    }
    
    // ── Extract NID ──
    const nidPatterns = [
      /জাতীয়\s*পরিচয়\s*পত্র\s*(?:নম্বর)?\s*[([：:]\s*(\d[\d\s/]+)\s*[)\]]?/,
      /(?:NID|জাতীয় পরিচয়)\s*[：:]\s*(\d[\d\s/]+)/,
      /(\d{10}|\d{13}|\d{17})/, // Common NID lengths
    ];
    
    for (const pattern of nidPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const nid = parseNID(match[1]);
        if (nid.length >= 10) {
          shareholder.nid = nid;
          break;
        }
      }
    }
    
    // ── Extract Share Count ──
    const sharePatterns = [
      /শেয়ার\s*(?:সংখ্যা)?[ঃ:]\s*([০-৯\d]+)/,
      /শেয়ার\s*(\d+)\s*টি/,
      /(\d+)\s*(?:টি|টি)\s*শেয়ার/,
      /শেয়ার\s*নম্বর[ঃ:]\s*([০-৯\d]+)/,
    ];
    
    for (const pattern of sharePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        shareholder.shareCount = parseBengaliNumber(match[1]);
        break;
      }
    }
    
    // ── Extract Share Value ──
    const valuePatterns = [
      /মূল্য[ঃ:]\s*([০-৯,]+)\s*(?:টাকা)?/,
      /অর্থের\s*পরিমান\s*(?:কথা)?[ঃ:]\s*([০-৯,]+)/,
      /একটি\s*শেয়ারের\s*মূল্য\s*([০-৯]+)\s*(?:\(এক\))?\s*লক্ষ/,
    ];
    
    for (const pattern of valuePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const val = parseBengaliNumber(match[1].replace(/,/g, ''));
        if (val > 0) {
          shareholder.shareValueBdt = val;
          shareholder.investment = shareholder.shareCount * val;
        }
        break;
      }
    }
    
    // ── Extract Address ──
    const addressPatterns = [
      /স্থায়ী\s*ঠিকানা\s*[ঃ:]\s*([^\n]+(?:\n[^\n]+)?)/,
      /ঠিকানা[ঃ:]\s*([^\n]+)/,
      /গ্রাম\/মহল্লা[ঃ:]\s*([^\n]+)/,
    ];
    
    for (const pattern of addressPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        shareholder.address = cleanExtractedText(match[1]);
        break;
      }
    }
    
    // ── Extract Father's Name ──
    const fatherPatterns = [
      /পিতার?\s*নাম[ঃ:]\s*([^\n|]+)/,
      /পিতা[ঃ:]\s*([^\n|]+)/,
    ];
    
    for (const pattern of fatherPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        shareholder.fatherName = cleanExtractedText(match[1]);
        break;
      }
    }
    
    // ── Extract Mother's Name ──
    const motherPatterns = [
      /মাতার?\s*নাম[ঃ:]\s*([^\n|]+)/,
      /মাতা[ঃ:]\s*([^\n|]+)/,
    ];
    
    for (const pattern of motherPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        shareholder.motherName = cleanExtractedText(match[1]);
        break;
      }
    }
    
    // ── Extract Nominee ──
    const nomineePatterns = [
      /নমিনীর?\s*নাম[ঃ:]\s*(?:\(বাংলা(?:য়)?\))?\s*[.|…]*\s*([^\n]+)/,
      /নমিনী[ঃ:]\s*([^\n]+)/,
    ];
    
    for (const pattern of nomineePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        shareholder.nomineeName = cleanExtractedText(match[1]);
        break;
      }
    }
    
    // ── Extract Religion ──
    const religionMatch = text.match(/ধর্ম[ঃ:]\s*([^\n|]+)/);
    if (religionMatch) {
      shareholder.religion = cleanExtractedText(religionMatch[1]);
    }
    
    // ── Extract Nationality ──
    const nationalityMatch = text.match(/জাতীয়তা[ঃ:]\s*([^\n|]+)/);
    if (nationalityMatch) {
      shareholder.nationality = cleanExtractedText(nationalityMatch[1]);
    }
    
    // ── Extract Profession ──
    const professionMatch = text.match(/পেশা[ঃ:]\s*([^\n|]+)/);
    if (professionMatch) {
      shareholder.profession = cleanExtractedText(professionMatch[1]);
    }
    
    // ── Extract Date of Birth ──
    const dobMatch = text.match(/জন্ম\s*তারিখ[ঃ:]\s*([^\n]+)/);
    if (dobMatch) {
      shareholder.dateOfBirth = cleanExtractedText(dobMatch[1]);
    }
    
    // ── Extract Birth Certificate ──
    const birthCertMatch = text.match(/জন্ম\s*সনদ\s*(?:নম্বর)?\s*[([：:]\s*([^\n\]]+)/);
    if (birthCertMatch) {
      shareholder.birthCertificate = cleanExtractedText(birthCertMatch[1]);
    }
    
    // ── Extract Passport ──
    const passportMatch = text.match(/পাসপোর্ট\s*(?:নম্বর)?\s*[([：:]\s*([^\n\]]+)/);
    if (passportMatch) {
      shareholder.passportNo = cleanExtractedText(passportMatch[1]);
    }
    
    // ── Extract Serial Number ──
    const serialMatch = text.match(/ক্রমসংখ্যা?\s*(?:নং)?\s*[：:]\s*([^\n|]+)/);
    if (serialMatch) {
      shareholder.serialNo = cleanExtractedText(serialMatch[1]);
    }
    
    // ── Extract Annual Income ──
    const incomeMatch = text.match(/বাৎসরিক\s*আয়\s*[：:]\s*([^\n|]+)/);
    if (incomeMatch) {
      shareholder.annualIncome = cleanExtractedText(incomeMatch[1]);
    }
    
    // ── Determine Shareholder Type ──
    const typeKeywords = {
      owner: ['মালিক', 'owner'],
      investor: ['বিনিয়োগ', 'investor', 'অংশীদারকারী'],
      doctor: ['ডাক্তার', 'doctor', 'চিকিৎসক'],
      profit: ['লাভ', 'profit'],
    };
    
    const textLower = text.toLowerCase();
    for (const [type, keywords] of Object.entries(typeKeywords)) {
      if (keywords.some(kw => textLower.includes(kw.toLowerCase()))) {
        shareholder.type = type as ParsedShareholder['type'];
        break;
      }
    }
    
    return shareholder;
  } catch (error) {
    console.error('Error parsing form:', error);
    return null;
  }
}

/**
 * Clean extracted text
 */
function cleanExtractedText(text: string): string {
  return text
    .replace(/[|]/g, '') // Remove table separators
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[.]{3,}/g, '') // Remove dots
    .replace(/^\s*[.…]+\s*/, '') // Remove leading dots
    .trim();
}

/**
 * Validate parsed shareholder data
 */
export function validateParsedShareholder(shareholder: ParsedShareholder): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!shareholder.name || shareholder.name.length < 2) {
    errors.push('নাম আবশ্যক (Name is required)');
  }
  
  if (shareholder.shareCount <= 0) {
    warnings.push('শেয়ার সংখ্যা ০ (Share count is 0)');
  }
  
  if (!shareholder.phone) {
    warnings.push('মোবাইল নম্বর পাওয়া যায়নি (Mobile number not found)');
  }
  
  if (!shareholder.nid) {
    warnings.push('জাতীয় পরিচয় পত্র নম্বর পাওয়া যায়নি (NID not found)');
  }
  
  // Validate phone format
  if (shareholder.phone && !/^01[3-9]\d{8}$/.test(shareholder.phone)) {
    warnings.push(`ফোন নম্বর ফরম্যাট সঠিক নয়: ${shareholder.phone}`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Preview parsed data as table rows
 */
export function previewParsedData(shareholders: ParsedShareholder[]): Array<{
  row: number;
  name: string;
  phone: string;
  nid: string;
  shares: number;
  address: string;
  nominee: string;
  status: 'valid' | 'warning' | 'error';
  messages: string[];
}> {
  return shareholders.map((sh, index) => {
    const validation = validateParsedShareholder(sh);
    return {
      row: index + 1,
      name: sh.name,
      phone: sh.phone || '-',
      nid: sh.nid || '-',
      shares: sh.shareCount,
      address: sh.address || '-',
      nominee: sh.nomineeName || '-',
      status: validation.errors.length > 0 ? 'error' : validation.warnings.length > 0 ? 'warning' : 'valid',
      messages: [...validation.errors, ...validation.warnings],
    };
  });
}
