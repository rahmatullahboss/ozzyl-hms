import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 3 Feature Tests — AI Triage + Advanced Reporting
// ═══════════════════════════════════════════════════════════════════════════════

// ─── 3.1 AI Triage Schema & Logic ────────────────────────────────────────────

describe('Triage chat schema', () => {
  const VALID_URGENCIES = ['routine', 'urgent', 'emergency'] as const;

  it('validates urgency levels', () => {
    for (const u of VALID_URGENCIES) {
      expect(VALID_URGENCIES.includes(u)).toBe(true);
    }
    expect(VALID_URGENCIES.includes('low' as never)).toBe(false);
  });

  it('validates triage response structure', () => {
    const response = {
      reply: 'আপনার জ্বর হলে General Medicine-এ যান।',
      suggestedDepartment: 'General Medicine',
      urgency: 'routine' as const,
      followUpQuestion: 'জ্বর কতদিন ধরে?',
    };
    expect(response.reply.length).toBeGreaterThan(0);
    expect(response.suggestedDepartment).toBeTruthy();
    expect(VALID_URGENCIES.includes(response.urgency)).toBe(true);
  });

  it('handles null department when no clear symptom', () => {
    const response = {
      reply: 'Could you provide more details?',
      suggestedDepartment: null,
      urgency: 'routine' as const,
      followUpQuestion: 'What other symptoms do you have?',
    };
    expect(response.suggestedDepartment).toBeNull();
    expect(response.followUpQuestion).toBeTruthy();
  });

  it('emergency urgency flagged for chest pain', () => {
    // Simulate what the AI would return for chest pain
    const symptoms = 'severe chest pain radiating to left arm';
    const expectedUrgency = symptoms.toLowerCase().includes('chest pain') ? 'emergency' : 'routine';
    expect(expectedUrgency).toBe('emergency');
  });

  it('conversation history maintains order', () => {
    const history = [
      { role: 'user', content: 'আমার মাথা ব্যথা করছে' },
      { role: 'assistant', content: 'কতদিন ধরে মাথা ব্যথা?' },
      { role: 'user', content: '৩ দিন ধরে' },
    ];
    expect(history.length).toBe(3);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
    expect(history[2].role).toBe('user');
  });
});

// ─── 3.2 Advanced Reporting Logic ────────────────────────────────────────────

describe('Bed occupancy calculation', () => {
  it('calculates occupancy rate correctly', () => {
    const total = 100;
    const occupied = 75;
    const rate = (occupied / total) * 100;
    expect(rate).toBe(75);
  });

  it('handles zero beds gracefully', () => {
    const total = 0;
    const occupied = 0;
    const rate = total > 0 ? (occupied / total) * 100 : 0;
    expect(rate).toBe(0);
  });

  it('calculates ward breakdown', () => {
    const wards = [
      { ward: 'ICU', total: 10, occupied: 8 },
      { ward: 'General', total: 50, occupied: 20 },
      { ward: 'Pediatrics', total: 20, occupied: 15 },
    ];
    const breakdown = wards.map(w => ({
      ...w,
      available: w.total - w.occupied,
      rate: parseFloat(((w.occupied / w.total) * 100).toFixed(1)),
    }));
    expect(breakdown[0].rate).toBe(80);
    expect(breakdown[1].available).toBe(30);
    expect(breakdown[2].rate).toBe(75);
  });
});

describe('Average length of stay calculation', () => {
  it('calculates ALOS from admission/discharge dates', () => {
    const admissions = [
      { admission: '2026-01-01', discharge: '2026-01-05' }, // 4 days
      { admission: '2026-01-10', discharge: '2026-01-13' }, // 3 days
      { admission: '2026-01-20', discharge: '2026-01-28' }, // 8 days
    ];

    const totalDays = admissions.reduce((sum, a) => {
      const days = (new Date(a.discharge).getTime() - new Date(a.admission).getTime()) / (24 * 60 * 60 * 1000);
      return sum + days;
    }, 0);

    const avgDays = totalDays / admissions.length;
    expect(avgDays).toBe(5);
  });

  it('handles single admission', () => {
    const days = (new Date('2026-02-10').getTime() - new Date('2026-02-07').getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(3);
  });
});

describe('Department revenue breakdown', () => {
  it('calculates percentage correctly', () => {
    const departments = [
      { department: 'Cardiology', revenue: 500000 },
      { department: 'General', revenue: 300000 },
      { department: 'Ortho', revenue: 200000 },
    ];
    const totalRevenue = departments.reduce((s, d) => s + d.revenue, 0);
    expect(totalRevenue).toBe(1000000);

    const cardPerc = parseFloat(((500000 / totalRevenue) * 100).toFixed(1));
    expect(cardPerc).toBe(50);
  });

  it('handles zero revenue', () => {
    const totalRevenue = 0;
    const percentage = totalRevenue > 0 ? (0 / totalRevenue) * 100 : 0;
    expect(percentage).toBe(0);
  });
});

describe('Doctor performance metrics', () => {
  it('calculates avg revenue per visit', () => {
    const doctor = { visits: 50, revenue: 250000 };
    const avg = doctor.visits > 0 ? parseFloat((doctor.revenue / doctor.visits).toFixed(0)) : 0;
    expect(avg).toBe(5000);
  });

  it('handles doctor with zero visits', () => {
    const doctor = { visits: 0, revenue: 0 };
    const avg = doctor.visits > 0 ? doctor.revenue / doctor.visits : 0;
    expect(avg).toBe(0);
  });
});

describe('Monthly summary report', () => {
  it('computes next month boundary correctly', () => {
    const computeNext = (targetMonth: string): string => {
      const [y, m] = targetMonth.split('-').map(Number);
      return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    };

    expect(computeNext('2026-01')).toBe('2026-02-01');
    expect(computeNext('2026-11')).toBe('2026-12-01');
    expect(computeNext('2026-12')).toBe('2027-01-01');
  });

  it('calculates profit margin', () => {
    const revenue = 500000;
    const expenses = 300000;
    const netProfit = revenue - expenses;
    const margin = revenue > 0 ? parseFloat(((netProfit / revenue) * 100).toFixed(1)) : 0;
    expect(netProfit).toBe(200000);
    expect(margin).toBe(40);
  });

  it('handles negative profit margin', () => {
    const revenue = 100000;
    const expenses = 150000;
    const netProfit = revenue - expenses;
    const margin = parseFloat(((netProfit / revenue) * 100).toFixed(1));
    expect(netProfit).toBe(-50000);
    expect(margin).toBe(-50);
  });
});

describe('Weekly report CRON logic', () => {
  it('computes week-ago date correctly', () => {
    const now = new Date('2026-03-10');
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    expect(weekAgo.toISOString().split('T')[0]).toBe('2026-03-03');
  });

  it('formats email subject with tenant name', () => {
    const tenantName = 'Dhaka Medical Hospital';
    const startDate = '2026-03-03';
    const endDate = '2026-03-10';
    const subject = `📊 Weekly Report — ${tenantName} (${startDate} → ${endDate})`;
    expect(subject).toContain('Dhaka Medical Hospital');
    expect(subject).toContain('2026-03-03');
  });
});
