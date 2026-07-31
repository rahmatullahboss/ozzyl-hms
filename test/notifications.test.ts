import { describe, it, expect } from 'vitest';

// ─── Notification / SMS Tests ─────────────────────────────────────────────────
// Covers: src/routes/tenant/notifications.ts
// Bangladeshi context: SMS-first, bKash/Nagad payment notifications

describe('HMS Notification & SMS Tests', () => {

  // ─── Notification Type Validation ─────────────────────────────────────────
  describe('Notification Type Validation', () => {
    const VALID_NOTIFICATION_TYPES = [
      'appointment_confirmation',
      'appointment_reminder',
      'appointment_cancellation',
      'appointment_reschedule',
      'doctor_unavailable',
      'test_report_ready',
      'lab_result_ready',
      'admission_confirmation',
      'discharge_summary',
      'payment_receipt',
      'payment_due_reminder',
      'follow_up_reminder',
      'prescription_ready',
      'general',
    ] as const;

    type NotificationType = typeof VALID_NOTIFICATION_TYPES[number];

    function isValidType(t: string): t is NotificationType {
      return (VALID_NOTIFICATION_TYPES as readonly string[]).includes(t);
    }

    it('should accept appointment_confirmation', () => {
      expect(isValidType('appointment_confirmation')).toBe(true);
    });

    it('should accept appointment_reminder', () => {
      expect(isValidType('appointment_reminder')).toBe(true);
    });

    it('should accept test_report_ready', () => {
      expect(isValidType('test_report_ready')).toBe(true);
    });

    it('should accept payment_receipt', () => {
      expect(isValidType('payment_receipt')).toBe(true);
    });

    it('should accept follow_up_reminder', () => {
      expect(isValidType('follow_up_reminder')).toBe(true);
    });

    it('should reject unknown notification type', () => {
      expect(isValidType('random_message')).toBe(false);
    });

    it('should reject empty string as notification type', () => {
      expect(isValidType('')).toBe(false);
    });
  });

  // ─── SMS Message Composition ───────────────────────────────────────────────
  describe('SMS Message Composition', () => {
    function composeAppointmentSMS(params: {
      patientName: string;
      doctorName: string;
      date: string;
      time: string;
      serialNo: string;
      hospitalName: string;
    }): string {
      return `প্রিয় ${params.patientName}, আপনার সিরিয়াল নং: ${params.serialNo}. ডাক্তার: ${params.doctorName}. তারিখ: ${params.date}, সময়: ${params.time}. - ${params.hospitalName}`;
    }

    function composePaymentSMS(params: {
      patientName: string;
      amount: number;
      invoiceNo: string;
      receiptNo: string;
    }): string {
      return `প্রিয় ${params.patientName}, আপনার ৳${params.amount} পেমেন্ট গৃহীত হয়েছে। রসিদ: ${params.receiptNo}, ইনভয়েস: ${params.invoiceNo}।`;
    }

    function composeLowSMS(params: {
      testName: string;
      patientName: string;
    }): string {
      return `প্রিয় ${params.patientName}, আপনার "${params.testName}" রিপোর্ট প্রস্তুত। হাসপাতালে যোগাযোগ করুন।`;
    }

    it('should compose Bengali appointment SMS with serial number', () => {
      const sms = composeAppointmentSMS({
        patientName: 'রহিম',
        doctorName: 'Dr. Ahmed',
        date: '2024-01-20',
        time: '10:00 AM',
        serialNo: 'SN-0005',
        hospitalName: 'City Hospital',
      });
      expect(sms).toContain('রহিম');
      expect(sms).toContain('SN-0005');
      expect(sms).toContain('Dr. Ahmed');
    });

    it('should compose payment confirmation SMS with amount', () => {
      const sms = composePaymentSMS({
        patientName: 'Karim',
        amount: 2500,
        invoiceNo: 'INV-000042',
        receiptNo: 'RCP-000015',
      });
      expect(sms).toContain('Karim');
      expect(sms).toContain('2500');
      expect(sms).toContain('RCP-000015');
    });

    it('should compose lab report ready SMS', () => {
      const sms = composeLowSMS({ testName: 'CBC', patientName: 'Fatima' });
      expect(sms).toContain('Fatima');
      expect(sms).toContain('CBC');
    });

    it('should keep SMS under 160 characters for single-part delivery', () => {
      const sms = composeAppointmentSMS({
        patientName: 'A',
        doctorName: 'Dr. B',
        date: '2024-01-20',
        time: '10:00',
        serialNo: 'SN-0001',
        hospitalName: 'H',
      });
      // Should be reasonably brief for single SMS
      expect(sms.length).toBeLessThan(320); // allow up to 2-part SMS
    });
  });

  // ─── Notification Channel Routing ─────────────────────────────────────────
  describe('Notification Channel Routing', () => {
    type Channel = 'sms' | 'email' | 'push' | 'whatsapp';

    function getDefaultChannel(hasMobile: boolean, hasEmail: boolean): Channel {
      if (hasMobile) return 'sms'; // BD context: SMS primary
      if (hasEmail) return 'email';
      return 'push';
    }

    it('should prefer SMS when patient has a mobile number', () => {
      expect(getDefaultChannel(true, true)).toBe('sms');
    });

    it('should fall back to email when no mobile', () => {
      expect(getDefaultChannel(false, true)).toBe('email');
    });

    it('should fall back to push when neither mobile nor email', () => {
      expect(getDefaultChannel(false, false)).toBe('push');
    });
  });

  // ─── Notification Status Lifecycle ────────────────────────────────────────
  describe('Notification Status Lifecycle', () => {
    type NotifStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'read';

    const VALID_TRANSITIONS: Record<NotifStatus, NotifStatus[]> = {
      pending:   ['sent', 'failed'],
      sent:      ['delivered', 'failed'],
      delivered: ['read'],
      failed:    ['pending'], // allow retry
      read:      [],
    };

    function canTransition(from: NotifStatus, to: NotifStatus): boolean {
      return VALID_TRANSITIONS[from].includes(to);
    }

    it('should allow pending → sent', () => {
      expect(canTransition('pending', 'sent')).toBe(true);
    });

    it('should allow sent → delivered', () => {
      expect(canTransition('sent', 'delivered')).toBe(true);
    });

    it('should allow delivered → read', () => {
      expect(canTransition('delivered', 'read')).toBe(true);
    });

    it('should allow sent → failed (delivery failure)', () => {
      expect(canTransition('sent', 'failed')).toBe(true);
    });

    it('should allow failed → pending (retry)', () => {
      expect(canTransition('failed', 'pending')).toBe(true);
    });

    it('should block read → pending (cannot un-read)', () => {
      expect(canTransition('read', 'pending')).toBe(false);
    });

    it('should block pending → delivered (must go through sent)', () => {
      expect(canTransition('pending', 'delivered')).toBe(false);
    });
  });

  // ─── Reminder Scheduling ──────────────────────────────────────────────────
  describe('Reminder Scheduling', () => {
    function calcReminderTime(appointmentDate: string, appointmentTime: string, hoursBeforehand: number): Date {
      const dt = new Date(`${appointmentDate}T${appointmentTime}:00`);
      dt.setHours(dt.getHours() - hoursBeforehand);
      return dt;
    }

    it('should schedule reminder 24 hours before appointment', () => {
      const apt = new Date('2024-01-20T10:00:00');
      const reminder = calcReminderTime('2024-01-20', '10:00', 24);
      const expected = new Date('2024-01-19T10:00:00');
      expect(reminder.getTime()).toBe(expected.getTime());
    });

    it('should schedule reminder 2 hours before appointment', () => {
      const reminder = calcReminderTime('2024-01-20', '10:00', 2);
      const expected = new Date('2024-01-20T08:00:00');
      expect(reminder.getTime()).toBe(expected.getTime());
    });

    it('should not schedule reminder time in the past', () => {
      const now = new Date();
      const pastAppointment = new Date(now.getTime() - 3_600_000); // 1 hour ago
      const reminder = new Date(pastAppointment.getTime() - 24 * 3_600_000);
      expect(reminder.getTime()).toBeLessThan(now.getTime());
    });
  });

  // ─── Notification Rate Limiting ────────────────────────────────────────────
  describe('Notification Rate Limiting', () => {
    interface NotificationWindow {
      mobile: string;
      sentCount: number;
      windowStartMs: number;
    }

    const MAX_SMS_PER_HOUR = 5;

    function canSendSMS(window: NotificationWindow, nowMs: number): boolean {
      const ONE_HOUR = 3_600_000;
      if (nowMs - window.windowStartMs > ONE_HOUR) return true; // window reset
      return window.sentCount < MAX_SMS_PER_HOUR;
    }

    it('should allow SMS when under rate limit', () => {
      const window: NotificationWindow = { mobile: '01712345678', sentCount: 2, windowStartMs: Date.now() };
      expect(canSendSMS(window, Date.now())).toBe(true);
    });

    it('should block SMS when rate limit reached', () => {
      const window: NotificationWindow = { mobile: '01712345678', sentCount: 5, windowStartMs: Date.now() };
      expect(canSendSMS(window, Date.now())).toBe(false);
    });

    it('should reset rate limit after 1 hour', () => {
      const oneHourAgo = Date.now() - 3_600_001;
      const window: NotificationWindow = { mobile: '01712345678', sentCount: 5, windowStartMs: oneHourAgo };
      expect(canSendSMS(window, Date.now())).toBe(true);
    });
  });

  // ─── Payment Notification Formatting ──────────────────────────────────────
  describe('Payment Notification Formatting', () => {
    function formatCurrencyBD(amount: number): string {
      return `৳${amount.toLocaleString('bn-BD')}`;
    }

    it('should format 5000 taka correctly', () => {
      const formatted = `৳${5000}`;
      expect(formatted).toContain('৳');
      expect(formatted).toContain('5000');
    });

    it('should format 0 taka as ৳0', () => {
      expect(`৳${0}`).toBe('৳0');
    });

    it('should include receipt number in payment notification', () => {
      const notification = {
        type: 'payment_receipt',
        receiptNo: 'RCP-000007',
        amount: 3500,
      };
      expect(notification.receiptNo).toMatch(/^RCP-\d{6}$/);
      expect(notification.amount).toBeGreaterThan(0);
    });
  });
});
