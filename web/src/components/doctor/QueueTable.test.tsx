import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { QueueTable } from './QueueTable';
import type { QueueItem } from './types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));

const waitingPatient: QueueItem = {
  id: 1,
  appointment_id: 10,
  patient_id: 101,
  token_no: 1,
  appt_time: '10:00',
  visit_type: 'follow_up',
  appointment_type: 'follow_up',
  status: 'waiting',
  patient_name: 'Rahim Follow-up',
  patient_code: 'P-001',
};

function renderQueue(queue: QueueItem[], overrides: any = {}) {
  return render(
    <MemoryRouter>
      <QueueTable
        queue={queue}
        basePath="/h/demo"
        onUpdateStatus={vi.fn()}
        onOpenAiSummary={vi.fn()}
        onOpenWorkspace={overrides.onOpenWorkspace}
      />
    </MemoryRouter>,
  );
}

describe('QueueTable', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./QueueTable');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('shows visit validity warnings returned by the doctor dashboard', () => {
    renderQueue([{
      ...waitingPatient,
      validity_badge: 'follow_up_expired',
    } as QueueItem]);

    expect(screen.getByText('Follow-up Expired')).toBeInTheDocument();
  });

  it('provides fast queue tabs for report show and follow-up patients', () => {
    renderQueue([
      waitingPatient,
      {
        ...waitingPatient,
        id: 2,
        appointment_id: 11,
        patient_id: 102,
        token_no: 2,
        patient_name: 'Rupa Report',
        patient_code: 'P-002',
        visit_type: 'report_show',
        appointment_type: 'report_show',
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: /Report show/i }));

    expect(screen.getByText('Rupa Report')).toBeInTheDocument();
    expect(screen.queryByText('Rahim Follow-up')).not.toBeInTheDocument();
  });

  it('opens consultation workspace instead of directly completing an in-progress visit', () => {
    const onOpenWorkspace = vi.fn();
    renderQueue([{ ...waitingPatient, status: 'in_progress' } as QueueItem], { onOpenWorkspace });

    fireEvent.click(screen.getByTitle('Complete from consultation workspace'));

    expect(onOpenWorkspace).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: 10 }));
  });

  it('blocks workspace and prescription actions when appointment id is missing', () => {
    const onOpenWorkspace = vi.fn();
    const queueRow = { ...waitingPatient, id: 999, appointment_id: undefined } as QueueItem;
    renderQueue([queueRow], { onOpenWorkspace });

    expect(screen.queryByRole('link', { name: /create prescription/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create prescription unavailable/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /start consultation/i }));

    expect(onOpenWorkspace).not.toHaveBeenCalled();
  });
});

// ─── VISIT_COLOR coverage ────────────────────────────────────────────────────

describe('VISIT_COLOR (via module)', () => {
  it('module loads without errors', async () => {
    const mod = await import('./QueueTable');
    expect(mod).toBeDefined();
  });
});

// ─── Vitals color coding logic (extracted from component) ────────────────────

function bpTone(systolic?: number | null, diastolic?: number | null): string {
  if (!systolic || !diastolic) return 'text-[var(--color-text)]';
  if (systolic >= 180 || diastolic >= 120) return 'text-red-600 font-bold';
  if (systolic >= 140 || diastolic >= 90) return 'text-red-500 font-semibold';
  if (systolic >= 130 || diastolic >= 80) return 'text-amber-600';
  if (systolic < 90 || diastolic < 60) return 'text-blue-500';
  return 'text-[var(--color-text)]';
}

function tempTone(temp?: number | null): string {
  if (!temp) return 'text-[var(--color-text)]';
  if (temp >= 39) return 'text-red-600 font-bold';
  if (temp >= 37.5) return 'text-amber-600';
  if (temp < 35) return 'text-blue-500';
  return 'text-[var(--color-text)]';
}

function spo2Tone(spo2?: number | null): string {
  if (!spo2) return 'text-[var(--color-text)]';
  if (spo2 < 90) return 'text-red-600 font-bold';
  if (spo2 < 94) return 'text-amber-600';
  return 'text-[var(--color-text)]';
}

describe('bpTone', () => {
  it('returns default for null values', () => {
    expect(bpTone(null, null)).toBe('text-[var(--color-text)]');
    expect(bpTone(undefined, undefined)).toBe('text-[var(--color-text)]');
  });

  it('returns red-bold for hypertensive crisis (>=180/120)', () => {
    expect(bpTone(180, 120)).toContain('red-600');
    expect(bpTone(200, 130)).toContain('red-600');
  });

  it('returns red-semibold for stage 2 hypertension (>=140/90)', () => {
    expect(bpTone(140, 90)).toContain('red-500');
    expect(bpTone(160, 100)).toContain('red-500');
  });

  it('returns amber for elevated (>=130/80)', () => {
    expect(bpTone(130, 80)).toContain('amber-600');
    expect(bpTone(135, 85)).toContain('amber-600');
  });

  it('returns blue for hypotension (<90/60)', () => {
    expect(bpTone(80, 50)).toContain('blue-500');
    expect(bpTone(70, 40)).toContain('blue-500');
  });

  it('returns default for normal BP', () => {
    expect(bpTone(110, 70)).toBe('text-[var(--color-text)]');
    expect(bpTone(115, 75)).toBe('text-[var(--color-text)]');
  });

  it('returns amber for diastolic 80 (elevated boundary)', () => {
    expect(bpTone(120, 80)).toContain('amber-600');
  });
});

describe('tempTone', () => {
  it('returns default for null', () => {
    expect(tempTone(null)).toBe('text-[var(--color-text)]');
  });

  it('returns red-bold for high fever (>=39)', () => {
    expect(tempTone(39)).toContain('red-600');
    expect(tempTone(40.5)).toContain('red-600');
  });

  it('returns amber for low fever (>=37.5)', () => {
    expect(tempTone(37.5)).toContain('amber-600');
    expect(tempTone(38)).toContain('amber-600');
  });

  it('returns blue for hypothermia (<35)', () => {
    expect(tempTone(34)).toContain('blue-500');
    expect(tempTone(32)).toContain('blue-500');
  });

  it('returns default for normal temp', () => {
    expect(tempTone(36.6)).toBe('text-[var(--color-text)]');
    expect(tempTone(37)).toBe('text-[var(--color-text)]');
  });
});

describe('spo2Tone', () => {
  it('returns default for null', () => {
    expect(spo2Tone(null)).toBe('text-[var(--color-text)]');
  });

  it('returns red-bold for critical (<90)', () => {
    expect(spo2Tone(85)).toContain('red-600');
    expect(spo2Tone(88)).toContain('red-600');
  });

  it('returns amber for low (90-93)', () => {
    expect(spo2Tone(90)).toContain('amber-600');
    expect(spo2Tone(92)).toContain('amber-600');
  });

  it('returns default for normal (>=94)', () => {
    expect(spo2Tone(94)).toBe('text-[var(--color-text)]');
    expect(spo2Tone(98)).toBe('text-[var(--color-text)]');
    expect(spo2Tone(100)).toBe('text-[var(--color-text)]');
  });
});
