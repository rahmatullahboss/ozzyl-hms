import { describe, it, expect } from 'vitest';
import {
  normalizePhonetic,
  computePairScore,
  scoreToAction,
  MATCH_WEIGHTS,
  AUTO_LINK_THRESHOLD,
  REVIEW_THRESHOLD,
  type IdentityFields,
} from '../src/lib/mpi-scoring';

// ═══════════════════════════════════════════════════════════════════════════════
// MPI Probabilistic Scoring — Unit Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('MPI Scoring', () => {
  // ─── normalizePhonetic ───────────────────────────────────────────────────

  describe('normalizePhonetic', () => {
    it('lowercases and trims input', () => {
      expect(normalizePhonetic('  RAHIM  ')).toBe(normalizePhonetic('rahim'));
    });

    it('strips diacritics', () => {
      expect(normalizePhonetic('Ràhím')).toBe(normalizePhonetic('Rahim'));
    });

    it('collapses doubled consonants', () => {
      // "Mohammed" and "Mohamed" should normalize to the same value
      expect(normalizePhonetic('Mohammed')).toBe(normalizePhonetic('Mohamed'));
    });

    it('normalizes sh → s', () => {
      // Shafiq and Safiq should be phonetically similar
      expect(normalizePhonetic('Shafiq')).toBe(normalizePhonetic('Safiq'));
    });

    it('normalizes ch → c', () => {
      expect(normalizePhonetic('Chowdhury')).toBe(normalizePhonetic('Cowdhury'));
    });

    it('normalizes th → t', () => {
      expect(normalizePhonetic('Thanvir')).toBe(normalizePhonetic('Tanvir'));
    });

    it('normalizes ph → f', () => {
      expect(normalizePhonetic('Pharuq')).toBe(normalizePhonetic('Faruq'));
    });

    it('normalizes kh → k', () => {
      expect(normalizePhonetic('Khadija')).toBe(normalizePhonetic('Kadija'));
    });

    it('normalizes gh → g', () => {
      expect(normalizePhonetic('Ghani')).toBe(normalizePhonetic('Gani'));
    });

    it('normalizes dh → d', () => {
      expect(normalizePhonetic('Dhaka')).toBe(normalizePhonetic('Daka'));
    });

    it('normalizes bh → b', () => {
      expect(normalizePhonetic('Bhuiyan')).toBe(normalizePhonetic('Buiyan'));
    });

    it('normalizes ou → u, ee → i, oo → u', () => {
      expect(normalizePhonetic('Mousin')).toBe(normalizePhonetic('Musin'));
      // With digraphs replaced BEFORE double-collapse, ee→i and oo→u fire correctly
      expect(normalizePhonetic('Neel')).toBe(normalizePhonetic('Nil'));
      expect(normalizePhonetic('Noor')).toBe(normalizePhonetic('Nur'));
    });

    it('strips trailing vowel variants (a, ah, ha)', () => {
      // "Rahima" and "Rahim" should match after stripping trailing vowel
      const a = normalizePhonetic('Rahima');
      const b = normalizePhonetic('Rahim');
      expect(a).toBe(b);
    });

    it('removes spaces, hyphens, and apostrophes', () => {
      expect(normalizePhonetic("Abdul Rahman")).toBe(normalizePhonetic('AbdulRahman'));
      expect(normalizePhonetic("Al-Amin")).toBe(normalizePhonetic('AlAmin'));
      expect(normalizePhonetic("N'golo")).toBe(normalizePhonetic('Ngolo'));
    });

    it('handles Bengali romanization variant: Shafiqul vs Safiqul', () => {
      expect(normalizePhonetic('Shafiqul')).toBe(normalizePhonetic('Safiqul'));
    });

    it('handles common Bengali name variants', () => {
      // Khandaker vs Kandaker — kh→k normalizes
      expect(normalizePhonetic('Khandaker')).toBe(normalizePhonetic('Kandaker'));
      // Choudhury: ch→c + ou→u + dh→d → "cudury"
      // So the proper comparison is Choudhury vs Cudhury (both normalize to "cudury")
      expect(normalizePhonetic('Choudhury')).toBe(normalizePhonetic('Cudhury'));
    });

    it('returns empty string for very short input after normalization', () => {
      // Single vowel gets stripped
      const result = normalizePhonetic('a');
      expect(result).toBe('');
    });

    it('handles empty string', () => {
      expect(normalizePhonetic('')).toBe('');
    });
  });

  // ─── computePairScore ────────────────────────────────────────────────────

  describe('computePairScore', () => {
    it('returns 100 (capped) for exact NID match', () => {
      const a: IdentityFields = { id: 1, national_id: '1234567890' };
      const b: IdentityFields = { id: 2, national_id: '1234567890' };
      const { score, matchDetails } = computePairScore(a, b);
      expect(score).toBe(100);
      expect(matchDetails.nid_exact).toBe(MATCH_WEIGHTS.nid_exact);
    });

    it('short-circuits on NID match — does not add other fields', () => {
      const a: IdentityFields = {
        id: 1, national_id: '1234567890',
        primary_phone: '01712345678', primary_name: 'Rahim',
        gender: 'Male', blood_group: 'O+',
      };
      const b: IdentityFields = {
        id: 2, national_id: '1234567890',
        primary_phone: '01712345678', primary_name: 'Rahim',
        gender: 'Male', blood_group: 'O+',
      };
      const { matchDetails } = computePairScore(a, b);
      // Only nid_exact should be present since it short-circuits
      expect(Object.keys(matchDetails)).toEqual(['nid_exact']);
    });

    it('returns 0 for completely different records', () => {
      const a: IdentityFields = {
        id: 1, national_id: '111', primary_name: 'Alice',
        primary_phone: '01711111111', date_of_birth: '1990-01-01',
        gender: 'Female', blood_group: 'A+',
      };
      const b: IdentityFields = {
        id: 2, national_id: '222', primary_name: 'Bob',
        primary_phone: '01822222222', date_of_birth: '1985-06-15',
        gender: 'Male', blood_group: 'B-',
      };
      const { score } = computePairScore(a, b);
      expect(score).toBe(0);
    });

    it('scores phone_exact when last 10 digits match', () => {
      const a: IdentityFields = { id: 1, primary_phone: '+8801712345678' };
      const b: IdentityFields = { id: 2, primary_phone: '01712345678' };
      const { score, matchDetails } = computePairScore(a, b);
      expect(matchDetails.phone_exact).toBe(MATCH_WEIGHTS.phone_exact);
      expect(score).toBe(40);
    });

    it('does not score phone when shorter than 10 digits', () => {
      const a: IdentityFields = { id: 1, primary_phone: '12345' };
      const b: IdentityFields = { id: 2, primary_phone: '12345' };
      const { matchDetails } = computePairScore(a, b);
      expect(matchDetails.phone_exact).toBeUndefined();
    });

    it('strips spaces and dashes from phone before comparing', () => {
      const a: IdentityFields = { id: 1, primary_phone: '017-1234-5678' };
      const b: IdentityFields = { id: 2, primary_phone: '+880 1712345678' };
      const { matchDetails } = computePairScore(a, b);
      expect(matchDetails.phone_exact).toBe(MATCH_WEIGHTS.phone_exact);
    });

    it('scores name_exact for identical names (case-insensitive)', () => {
      const a: IdentityFields = { id: 1, primary_name: 'Rahim Uddin' };
      const b: IdentityFields = { id: 2, primary_name: 'rahim uddin' };
      const { matchDetails } = computePairScore(a, b);
      expect(matchDetails.name_exact).toBe(MATCH_WEIGHTS.name_exact);
      expect(matchDetails.name_phonetic).toBeUndefined(); // exact wins, no phonetic
    });

    it('scores name_phonetic for phonetically similar names', () => {
      const a: IdentityFields = { id: 1, primary_name: 'Shafiqul Islam' };
      const b: IdentityFields = { id: 2, primary_name: 'Safiqul Islam' };
      const { matchDetails } = computePairScore(a, b);
      expect(matchDetails.name_phonetic).toBe(MATCH_WEIGHTS.name_phonetic);
      expect(matchDetails.name_exact).toBeUndefined();
    });

    it('does not score name_phonetic for short phonetic results (<= 2 chars)', () => {
      const a: IdentityFields = { id: 1, primary_name: 'Al' };
      const b: IdentityFields = { id: 2, primary_name: 'Al' };
      const { matchDetails } = computePairScore(a, b);
      // "Al" exact match → name_exact, not phonetic
      expect(matchDetails.name_exact).toBe(MATCH_WEIGHTS.name_exact);
    });

    it('scores dob_exact for matching dates', () => {
      const a: IdentityFields = { id: 1, date_of_birth: '1990-05-15' };
      const b: IdentityFields = { id: 2, date_of_birth: '1990-05-15' };
      const { matchDetails } = computePairScore(a, b);
      expect(matchDetails.dob_exact).toBe(MATCH_WEIGHTS.dob_exact);
    });

    it('does not score dob when one is null', () => {
      const a: IdentityFields = { id: 1, date_of_birth: '1990-05-15' };
      const b: IdentityFields = { id: 2, date_of_birth: null };
      const { matchDetails } = computePairScore(a, b);
      expect(matchDetails.dob_exact).toBeUndefined();
    });

    it('scores gender_match (case-insensitive)', () => {
      const a: IdentityFields = { id: 1, gender: 'Male' };
      const b: IdentityFields = { id: 2, gender: 'male' };
      const { matchDetails } = computePairScore(a, b);
      expect(matchDetails.gender_match).toBe(MATCH_WEIGHTS.gender_match);
    });

    it('scores blood_group_match', () => {
      const a: IdentityFields = { id: 1, blood_group: 'O+' };
      const b: IdentityFields = { id: 2, blood_group: 'O+' };
      const { matchDetails } = computePairScore(a, b);
      expect(matchDetails.blood_group_match).toBe(MATCH_WEIGHTS.blood_group_match);
    });

    it('caps total score at 100', () => {
      // phone(40) + name(30) + dob(25) + gender(5) + blood(5) = 105 → capped at 100
      const a: IdentityFields = {
        id: 1, primary_phone: '01712345678', primary_name: 'Rahim',
        date_of_birth: '1990-01-01', gender: 'Male', blood_group: 'O+',
      };
      const b: IdentityFields = {
        id: 2, primary_phone: '01712345678', primary_name: 'Rahim',
        date_of_birth: '1990-01-01', gender: 'Male', blood_group: 'O+',
      };
      const { score } = computePairScore(a, b);
      expect(score).toBe(100);
    });

    it('accumulates multiple non-NID fields', () => {
      // phone(40) + dob(25) + gender(5) = 70
      const a: IdentityFields = {
        id: 1, primary_phone: '01712345678',
        date_of_birth: '1990-01-01', gender: 'Male',
      };
      const b: IdentityFields = {
        id: 2, primary_phone: '01712345678',
        date_of_birth: '1990-01-01', gender: 'Male',
      };
      const { score, matchDetails } = computePairScore(a, b);
      expect(score).toBe(70);
      expect(matchDetails.phone_exact).toBe(40);
      expect(matchDetails.dob_exact).toBe(25);
      expect(matchDetails.gender_match).toBe(5);
    });

    it('handles records with only id (all optional fields missing)', () => {
      const a: IdentityFields = { id: 1 };
      const b: IdentityFields = { id: 2 };
      const { score } = computePairScore(a, b);
      expect(score).toBe(0);
    });

    it('does not match different NID values as NID match', () => {
      const a: IdentityFields = { id: 1, national_id: '111', primary_phone: '01712345678' };
      const b: IdentityFields = { id: 2, national_id: '222', primary_phone: '01712345678' };
      const { matchDetails } = computePairScore(a, b);
      expect(matchDetails.nid_exact).toBeUndefined();
      expect(matchDetails.phone_exact).toBe(MATCH_WEIGHTS.phone_exact);
    });
  });

  // ─── scoreToAction ───────────────────────────────────────────────────────

  describe('scoreToAction', () => {
    it('returns auto_link for score >= 90', () => {
      expect(scoreToAction(90)).toBe('auto_link');
      expect(scoreToAction(100)).toBe('auto_link');
      expect(scoreToAction(95)).toBe('auto_link');
    });

    it('returns review for score >= 50 and < 90', () => {
      expect(scoreToAction(50)).toBe('review');
      expect(scoreToAction(70)).toBe('review');
      expect(scoreToAction(89)).toBe('review');
    });

    it('returns ignore for score < 50', () => {
      expect(scoreToAction(0)).toBe('ignore');
      expect(scoreToAction(49)).toBe('ignore');
      expect(scoreToAction(30)).toBe('ignore');
    });

    it('thresholds match exported constants', () => {
      expect(AUTO_LINK_THRESHOLD).toBe(90);
      expect(REVIEW_THRESHOLD).toBe(50);
    });
  });

  // ─── Weight Constants ────────────────────────────────────────────────────

  describe('MATCH_WEIGHTS', () => {
    it('has expected weight values', () => {
      expect(MATCH_WEIGHTS.nid_exact).toBe(100);
      expect(MATCH_WEIGHTS.phone_exact).toBe(40);
      expect(MATCH_WEIGHTS.name_exact).toBe(30);
      expect(MATCH_WEIGHTS.name_phonetic).toBe(20);
      expect(MATCH_WEIGHTS.dob_exact).toBe(25);
      expect(MATCH_WEIGHTS.gender_match).toBe(5);
      expect(MATCH_WEIGHTS.blood_group_match).toBe(5);
    });

    it('NID weight alone >= auto_link threshold (deterministic)', () => {
      expect(MATCH_WEIGHTS.nid_exact).toBeGreaterThanOrEqual(AUTO_LINK_THRESHOLD);
    });

    it('phone + name_exact alone reaches review threshold', () => {
      expect(MATCH_WEIGHTS.phone_exact + MATCH_WEIGHTS.name_exact).toBeGreaterThanOrEqual(REVIEW_THRESHOLD);
    });

    it('demographic-only (name + dob + gender + blood) is below auto_link', () => {
      const demoScore = MATCH_WEIGHTS.name_exact + MATCH_WEIGHTS.dob_exact
        + MATCH_WEIGHTS.gender_match + MATCH_WEIGHTS.blood_group_match;
      expect(demoScore).toBeLessThan(AUTO_LINK_THRESHOLD);
    });
  });
});
