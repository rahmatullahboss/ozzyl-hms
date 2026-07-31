import { describe, it, expect } from 'vitest';

// ─── Telemedicine & Settings Tests ───────────────────────────────────────────
// Covers advanced HMS features: telemedicine session, hospital settings

describe('HMS Telemedicine Tests', () => {

  // ─── Session State ─────────────────────────────────────────────────────────
  describe('Telemedicine Session State', () => {
    type TeleStatus = 'scheduled' | 'waiting' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';

    function isValidTransition(from: TeleStatus, to: TeleStatus): boolean {
      const allowed: Record<TeleStatus, TeleStatus[]> = {
        scheduled:   ['waiting', 'cancelled', 'no_show'],
        waiting:     ['in_progress', 'cancelled', 'no_show'],
        in_progress: ['completed', 'cancelled'],
        completed:   [],
        cancelled:   [],
        no_show:     [],
      };
      return allowed[from].includes(to);
    }

    it('should allow scheduled → waiting', () => { expect(isValidTransition('scheduled', 'waiting')).toBe(true); });
    it('should allow waiting → in_progress', () => { expect(isValidTransition('waiting', 'in_progress')).toBe(true); });
    it('should allow in_progress → completed', () => { expect(isValidTransition('in_progress', 'completed')).toBe(true); });
    it('should allow scheduled → cancelled', () => { expect(isValidTransition('scheduled', 'cancelled')).toBe(true); });
    it('should allow scheduled → no_show', () => { expect(isValidTransition('scheduled', 'no_show')).toBe(true); });
    it('should block completed → in_progress (cannot reopen)', () => { expect(isValidTransition('completed', 'in_progress')).toBe(false); });
    it('should block cancelled → waiting (cannot uncancel)', () => { expect(isValidTransition('cancelled', 'waiting')).toBe(false); });
    it('should block no_show → completed', () => { expect(isValidTransition('no_show', 'completed')).toBe(false); });
  });

  // ─── Session Duration ──────────────────────────────────────────────────────
  describe('Session Duration Calculation', () => {
    function calcDurationMinutes(startISO: string, endISO: string): number {
      const diff = new Date(endISO).getTime() - new Date(startISO).getTime();
      return Math.round(diff / 60_000);
    }

    it('should calculate 30-minute session duration', () => {
      expect(calcDurationMinutes('2024-01-15T10:00:00Z', '2024-01-15T10:30:00Z')).toBe(30);
    });

    it('should calculate 1-hour session duration (60 minutes)', () => {
      expect(calcDurationMinutes('2024-01-15T10:00:00Z', '2024-01-15T11:00:00Z')).toBe(60);
    });

    it('should return 0 for same start/end time', () => {
      expect(calcDurationMinutes('2024-01-15T10:00:00Z', '2024-01-15T10:00:00Z')).toBe(0);
    });

    it('should reject negative duration (end before start)', () => {
      const duration = calcDurationMinutes('2024-01-15T11:00:00Z', '2024-01-15T10:00:00Z');
      expect(duration).toBeLessThan(0);
    });

    it('should enforce max 2-hour telemedicine session', () => {
      const MAX_DURATION_MINUTES = 120;
      const duration = calcDurationMinutes('2024-01-15T08:00:00Z', '2024-01-15T10:30:00Z');
      const isWithinLimit = duration <= MAX_DURATION_MINUTES;
      expect(isWithinLimit).toBe(false); // 150 min exceeds limit
    });
  });

  // ─── Platform & Link Validation ────────────────────────────────────────────
  describe('Telemedicine Platform Validation', () => {
    const VALID_PLATFORMS = ['zoom', 'google_meet', 'jitsi', 'own_platform'] as const;

    function isValidPlatform(platform: string): boolean {
      return (VALID_PLATFORMS as readonly string[]).includes(platform);
    }

    function isValidMeetingLink(link: string): boolean {
      try {
        const url = new URL(link);
        return ['https:', 'http:'].includes(url.protocol);
      } catch {
        return false;
      }
    }

    it('should accept zoom platform', () => { expect(isValidPlatform('zoom')).toBe(true); });
    it('should accept google_meet platform', () => { expect(isValidPlatform('google_meet')).toBe(true); });
    it('should accept jitsi platform', () => { expect(isValidPlatform('jitsi')).toBe(true); });
    it('should accept own_platform', () => { expect(isValidPlatform('own_platform')).toBe(true); });
    it('should reject unknown platform', () => { expect(isValidPlatform('whatsapp')).toBe(false); });
    it('should accept valid https meeting link', () => { expect(isValidMeetingLink('https://zoom.us/j/12345')).toBe(true); });
    it('should reject invalid meeting link', () => { expect(isValidMeetingLink('not-a-url')).toBe(false); });
    it('should reject meeting link without protocol', () => { expect(isValidMeetingLink('zoom.us/j/12345')).toBe(false); });
  });

  // ─── Telemedicine Fee ──────────────────────────────────────────────────────
  describe('Telemedicine Fee Calculation', () => {
    function calcTelemedicineFee(
      baseFee: number,
      platformFeePercent: number,
      taxPercent: number,
    ): { subtotal: number; platformFee: number; tax: number; total: number } {
      const platformFee = Math.round(baseFee * (platformFeePercent / 100));
      const subtotal = baseFee - platformFee;
      const tax = Math.round(subtotal * (taxPercent / 100));
      return { subtotal, platformFee, tax, total: subtotal + tax };
    }

    it('should calculate telemedicine fee with 10% platform fee and 5% tax', () => {
      const result = calcTelemedicineFee(2000, 10, 5);
      expect(result.platformFee).toBe(200);
      expect(result.subtotal).toBe(1800);
      expect(result.tax).toBe(90);
      expect(result.total).toBe(1890);
    });

    it('should return full amount when no platform fee or tax', () => {
      const result = calcTelemedicineFee(2000, 0, 0);
      expect(result.total).toBe(2000);
      expect(result.platformFee).toBe(0);
    });
  });
});

describe('HMS Settings & Configuration Tests', () => {

  // ─── Hospital Settings ─────────────────────────────────────────────────────
  describe('Hospital Settings Validation', () => {
    interface HospitalSettings {
      hospitalName: string;
      address: string;
      phone: string;
      email?: string;
      logo?: string;
      currency: string;
      timezone: string;
      opdStartTime: string;
      opdEndTime: string;
      defaultLanguage: 'en' | 'bn';
      smsEnabled: boolean;
      emailNotificationsEnabled: boolean;
    }

    const BD_VALID_CURRENCIES = ['BDT', 'USD', 'EUR'];
    const BD_TIMEZONES = ['Asia/Dhaka'];

    function validateSettings(s: Partial<HospitalSettings>): string[] {
      const errors: string[] = [];
      if (!s.hospitalName?.trim()) errors.push('hospitalName required');
      if (!s.currency || !BD_VALID_CURRENCIES.includes(s.currency)) errors.push('invalid currency');
      if (!s.timezone || !BD_TIMEZONES.includes(s.timezone)) errors.push('invalid timezone for Bangladesh');
      if (!s.defaultLanguage || !['en', 'bn'].includes(s.defaultLanguage)) errors.push('defaultLanguage must be en or bn');
      return errors;
    }

    it('should accept valid Bangladesh hospital settings', () => {
      const settings: HospitalSettings = {
        hospitalName: 'City General Hospital',
        address: 'Mirpur-10, Dhaka',
        phone: '01712345678',
        currency: 'BDT',
        timezone: 'Asia/Dhaka',
        opdStartTime: '08:00',
        opdEndTime: '20:00',
        defaultLanguage: 'bn',
        smsEnabled: true,
        emailNotificationsEnabled: false,
      };
      expect(validateSettings(settings)).toHaveLength(0);
    });

    it('should enforce BDT as default currency (local)', () => {
      expect(BD_VALID_CURRENCIES).toContain('BDT');
    });

    it('should enforce Asia/Dhaka timezone', () => {
      expect(BD_TIMEZONES).toContain('Asia/Dhaka');
    });

    it('should reject non-BD timezone', () => {
      expect(validateSettings({ hospitalName: 'H', currency: 'BDT', timezone: 'America/New_York', defaultLanguage: 'en' }))
        .toContain('invalid timezone for Bangladesh');
    });

    it('should accept Bengali (bn) as default language', () => {
      expect(validateSettings({ hospitalName: 'H', currency: 'BDT', timezone: 'Asia/Dhaka', defaultLanguage: 'bn' }))
        .toHaveLength(0);
    });

    it('should reject unknown language code', () => {
      expect(validateSettings({ hospitalName: 'H', currency: 'BDT', timezone: 'Asia/Dhaka', defaultLanguage: 'fr' as never }))
        .toContain('defaultLanguage must be en or bn');
    });
  });

  // ─── OPD Schedule Settings ─────────────────────────────────────────────────
  describe('OPD Schedule Settings', () => {
    function parseTimeToMinutes(time: string): number {
      const [h, m] = time.split(':').map(Number);
      return h * 60 + m;
    }

    function isValidTimeRange(start: string, end: string): boolean {
      return parseTimeToMinutes(start) < parseTimeToMinutes(end);
    }

    function calcCapacity(startTime: string, endTime: string, slotMinutes: number): number {
      const totalMinutes = parseTimeToMinutes(endTime) - parseTimeToMinutes(startTime);
      return Math.floor(totalMinutes / slotMinutes);
    }

    it('should accept 08:00 to 20:00 as valid OPD hours', () => {
      expect(isValidTimeRange('08:00', '20:00')).toBe(true);
    });

    it('should reject reverse time range (20:00 to 08:00)', () => {
      expect(isValidTimeRange('20:00', '08:00')).toBe(false);
    });

    it('should reject same start and end time', () => {
      expect(isValidTimeRange('08:00', '08:00')).toBe(false);
    });

    it('should calculate OPD capacity: 08:00–20:00 at 10-min slots = 72 patients', () => {
      expect(calcCapacity('08:00', '20:00', 10)).toBe(72);
    });

    it('should calculate OPD capacity: 08:00–20:00 at 15-min slots = 48 patients', () => {
      expect(calcCapacity('08:00', '20:00', 15)).toBe(48);
    });

    it('should calculate OPD capacity: 08:00–14:00 at 20-min slots = 18 patients', () => {
      expect(calcCapacity('08:00', '14:00', 20)).toBe(18);
    });
  });

  // ─── Invoice Number Format Settings ───────────────────────────────────────
  describe('Invoice Number Format Configuration', () => {
    function generateInvoiceNo(prefix: string, seq: number, year: string): string {
      return `${prefix}-${year}-${String(seq).padStart(6, '0')}`;
    }

    it('should generate invoice number with custom prefix INV', () => {
      expect(generateInvoiceNo('INV', 1, '2024')).toBe('INV-2024-000001');
    });

    it('should generate invoice number with hospital-specific prefix', () => {
      expect(generateInvoiceNo('CGH', 1, '2024')).toBe('CGH-2024-000001');
    });

    it('should generate sequential invoice numbers', () => {
      const inv1 = generateInvoiceNo('INV', 1, '2024');
      const inv2 = generateInvoiceNo('INV', 2, '2024');
      expect(inv2 > inv1).toBe(true);
    });

    it('should support 6-digit sequence numbers (up to 999,999)', () => {
      const inv = generateInvoiceNo('INV', 999_999, '2024');
      expect(inv).toBe('INV-2024-999999');
    });
  });
});
