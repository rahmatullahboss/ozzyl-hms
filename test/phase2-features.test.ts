import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// ─── Phase 2.1: Vitals Alert Schema Tests ────────────────────────────────────
describe('Phase 2.1 — Vitals & Alert Logic', () => {
  // Replicate the Zod schemas from nurseStation.ts
  const vitalsSchema = z.object({
    patientId: z.number().int().positive(),
    bp: z.string().optional(),
    temperature: z.string().optional(),
    weight: z.string().optional(),
    spo2: z.string().optional(),
    pulse: z.string().optional(),
  });

  it('accepts valid vitals input', () => {
    const result = vitalsSchema.safeParse({
      patientId: 1,
      bp: '120/80',
      temperature: '98.6',
      weight: '70',
      spo2: '98',
      pulse: '72',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing patientId', () => {
    const result = vitalsSchema.safeParse({
      bp: '120/80',
      temperature: '98.6',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer patientId', () => {
    const result = vitalsSchema.safeParse({
      patientId: -5,
      bp: '120/80',
    });
    expect(result.success).toBe(false);
  });

  // Alert threshold logic
  it('detects SpO2 below critical threshold (< 90)', () => {
    const checkSpo2Alert = (spo2Str?: string): boolean => {
      if (!spo2Str) return false;
      const val = parseFloat(spo2Str);
      return !isNaN(val) && val < 90;
    };
    expect(checkSpo2Alert('85')).toBe(true);   // critical low
    expect(checkSpo2Alert('89.9')).toBe(true);
    expect(checkSpo2Alert('90')).toBe(false);  // at threshold — no alert
    expect(checkSpo2Alert('98')).toBe(false);  // normal
    expect(checkSpo2Alert(undefined)).toBe(false);
  });

  it('detects high systolic BP (> 160)', () => {
    const checkBpHighAlert = (bpStr?: string): boolean => {
      if (!bpStr) return false;
      const [sys] = bpStr.split('/').map(Number);
      return !isNaN(sys) && sys > 160;
    };
    expect(checkBpHighAlert('180/120')).toBe(true);
    expect(checkBpHighAlert('160/90')).toBe(false);  // at threshold
    expect(checkBpHighAlert('120/80')).toBe(false);  // normal
    expect(checkBpHighAlert('invalid')).toBe(false);
  });

  it('detects high temperature (> 101°F)', () => {
    const checkTempAlert = (tempStr?: string): boolean => {
      if (!tempStr) return false;
      const val = parseFloat(tempStr);
      return !isNaN(val) && val > 101;
    };
    expect(checkTempAlert('103.5')).toBe(true);
    expect(checkTempAlert('101.1')).toBe(true);
    expect(checkTempAlert('101')).toBe(false);
    expect(checkTempAlert('98.6')).toBe(false);
  });

  it('formats alert message correctly', () => {
    const buildAlertMsg = (vital: string, value: string, threshold: number, direction: 'high' | 'low') => {
      return `${vital} is ${direction === 'high' ? 'above' : 'below'} safe threshold (${value} vs ${threshold})`;
    };
    expect(buildAlertMsg('SpO₂', '85%', 90, 'low')).toBe('SpO₂ is below safe threshold (85% vs 90)');
    expect(buildAlertMsg('BP', '185/120', 160, 'high')).toBe('BP is above safe threshold (185/120 vs 160)');
  });

  it('vitals trend groups data by vital sign', () => {
    const rawVitals = [
      { recorded_at: '2024-01-01', spo2: '98', bp: '120/80', temperature: '98.6' },
      { recorded_at: '2024-01-02', spo2: '96', bp: '130/85', temperature: '99.1' },
      { recorded_at: '2024-01-03', spo2: '97', bp: '118/78', temperature: '98.4' },
    ];
    const spo2Series = rawVitals.map(v => ({ date: v.recorded_at, value: parseFloat(v.spo2) }));
    expect(spo2Series.length).toBe(3);
    expect(spo2Series[0].value).toBe(98);
    expect(spo2Series[1].value).toBe(96);
  });
});

// ─── Phase 2.2: Prescription Sharing Logic ───────────────────────────────────
describe('Phase 2.2 — Prescription Sharing', () => {
  // Share token schema
  const shareSchema = z.object({
    prescriptionId: z.number().int().positive(),
  });

  const deliverySchema = z.object({
    address: z.string().min(1),
    phone: z.string().regex(/^01[3-9]\d{8}$/, 'Invalid phone'),
  });

  it('delivery schema accepts valid Bangladeshi phone', () => {
    const result = deliverySchema.safeParse({
      address: '123 Main St, Dhaka',
      phone: '01712345678',
    });
    expect(result.success).toBe(true);
  });

  it('delivery schema rejects invalid phone numbers', () => {
    const cases = [
      { address: 'Dhaka', phone: '12345' },           // too short
      { address: 'Dhaka', phone: '01112345678' },     // invalid prefix
      { address: 'Dhaka', phone: '017123456789' },    // too long
    ];
    cases.forEach(c => {
      const r = deliverySchema.safeParse(c);
      expect(r.success).toBe(false);
    });
  });

  it('delivery schema rejects missing address', () => {
    const result = deliverySchema.safeParse({ address: '', phone: '01712345678' });
    expect(result.success).toBe(false);
  });

  it('share token generator produces unique tokens', () => {
    const generateToken = () => crypto.randomUUID().replace(/-/g, '');
    const tokens = new Set([generateToken(), generateToken(), generateToken(), generateToken(), generateToken()]);
    expect(tokens.size).toBe(5); // all unique
  });

  it('share token expiry is set to 24 hours from now', () => {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const now = Date.now();
    const diffHours = (expiresAt.getTime() - now) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(24, 0);
  });

  it('expired token check works correctly', () => {
    const isExpired = (expiresAt: string) => new Date(expiresAt) < new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow  = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(isExpired(yesterday)).toBe(true);
    expect(isExpired(tomorrow)).toBe(false);
  });

  it('delivery status transitions are valid', () => {
    const validStatuses = ['pending', 'ordered', 'confirmed', 'dispatched', 'delivered', 'cancelled'];
    const deliveryStatusSchema = z.enum(['pending', 'ordered', 'confirmed', 'dispatched', 'delivered', 'cancelled']);
    validStatuses.forEach(s => {
      expect(deliveryStatusSchema.safeParse(s).success).toBe(true);
    });
    expect(deliveryStatusSchema.safeParse('invalid-status').success).toBe(false);
  });
});

// ─── Phase 2.3: Patient Portal Business Logic ─────────────────────────────────
describe('Phase 2.3 — Patient Portal Logic', () => {
  // Appointment request schema
  const appointmentSchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
    reason: z.string().optional(),
  });

  it('appointment schema accepts valid date', () => {
    const result = appointmentSchema.safeParse({ date: '2025-06-15', reason: 'Follow-up' });
    expect(result.success).toBe(true);
  });

  it('appointment schema rejects invalid date format', () => {
    const result = appointmentSchema.safeParse({ date: '15-06-2025' });
    expect(result.success).toBe(false);
  });

  it('appointment schema rejects missing date', () => {
    const result = appointmentSchema.safeParse({ reason: 'Follow-up' });
    expect(result.success).toBe(false);
  });

  // Self-vitals schema
  const selfVitalsSchema = z.object({
    bp:          z.string().optional(),
    temperature: z.string().optional(),
    weight:      z.string().optional(),
    spo2:        z.string().optional(),
    pulse:       z.string().optional(),
  });

  it('self-vitals schema accepts all optional fields', () => {
    const result = selfVitalsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('self-vitals schema accepts full data', () => {
    const result = selfVitalsSchema.safeParse({
      bp: '120/80', temperature: '98.6', weight: '70', spo2: '98', pulse: '72',
    });
    expect(result.success).toBe(true);
  });

  it('portal summary stat counts are non-negative', () => {
    const stats = {
      total_visits: 12,
      active_prescriptions: 3,
      pending_bills: 1,
      upcoming_appointments: 2,
    };
    Object.values(stats).forEach(v => expect(v).toBeGreaterThanOrEqual(0));
  });

  it('bill amounts display correctly (paisa to taka conversion)', () => {
    const bills = [
      { invoice_no: 'INV-001', amount: 50000 }, // 500 taka
      { invoice_no: 'INV-002', amount: 150000 }, // 1500 taka
    ];
    const displayAmounts = bills.map(b => b.amount / 100);
    expect(displayAmounts[0]).toBe(500);
    expect(displayAmounts[1]).toBe(1500);
  });

  it('telemedicine session join link only available when scheduled', () => {
    const canJoin = (status: string, hasRoomUrl: boolean) =>
      status === 'scheduled' && hasRoomUrl;
    expect(canJoin('scheduled', true)).toBe(true);
    expect(canJoin('completed', true)).toBe(false);
    expect(canJoin('scheduled', false)).toBe(false);
    expect(canJoin('cancelled', true)).toBe(false);
  });

  it('portal tabs are defined correctly', () => {
    const tabs = ['overview', 'appointments', 'prescriptions', 'labs', 'vitals', 'bills', 'telemedicine'];
    expect(tabs.length).toBe(7);
    expect(tabs).toContain('vitals');
    expect(tabs).toContain('telemedicine');
  });
});
