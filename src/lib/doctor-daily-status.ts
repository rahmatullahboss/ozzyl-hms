type DoctorDailyStatusColumn = {
  name: string;
  ddl: string;
};

const REQUIRED_DOCTOR_DAILY_STATUS_COLUMNS: DoctorDailyStatusColumn[] = [
  { name: 'status_type', ddl: "ALTER TABLE doctor_daily_status ADD COLUMN status_type TEXT DEFAULT 'available'" },
  { name: 'reason', ddl: 'ALTER TABLE doctor_daily_status ADD COLUMN reason TEXT' },
  { name: 'start_time', ddl: 'ALTER TABLE doctor_daily_status ADD COLUMN start_time TEXT' },
  { name: 'end_time', ddl: 'ALTER TABLE doctor_daily_status ADD COLUMN end_time TEXT' },
  { name: 'expected_arrival_time', ddl: 'ALTER TABLE doctor_daily_status ADD COLUMN expected_arrival_time TEXT' },
  { name: 'delay_minutes', ddl: 'ALTER TABLE doctor_daily_status ADD COLUMN delay_minutes INTEGER DEFAULT 0' },
  { name: 'public_message', ddl: 'ALTER TABLE doctor_daily_status ADD COLUMN public_message TEXT' },
  { name: 'reception_note', ddl: 'ALTER TABLE doctor_daily_status ADD COLUMN reception_note TEXT' },
  { name: 'source', ddl: "ALTER TABLE doctor_daily_status ADD COLUMN source TEXT DEFAULT 'admin'" },
];

export const DOCTOR_PRESENCE_STATUS_VALUES = [
  'available',
  'scheduled',
  'on_the_way',
  'delayed',
  'emergency_delay',
  'on_leave',
  'not_coming',
  'chamber_closed',
  'serial_stopped',
  'emergency_leave',
] as const;

export type DoctorPresenceStatus = typeof DOCTOR_PRESENCE_STATUS_VALUES[number];

export type DoctorDailyStatusRow = {
  id?: number;
  is_available: number;
  status_type: string | null;
  reason: string | null;
  max_serial: number | null;
  start_time?: string | null;
  end_time?: string | null;
  expected_arrival_time?: string | null;
  delay_minutes?: number | null;
  public_message?: string | null;
  reception_note?: string | null;
  source?: string | null;
};

export function isDoctorAvailableForStatus(status: DoctorPresenceStatus): boolean {
  return ['available', 'scheduled', 'on_the_way', 'delayed', 'emergency_delay'].includes(status);
}

export async function ensureDoctorDailyStatusTable(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS doctor_daily_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      doctor_id INTEGER NOT NULL,
      status_date TEXT NOT NULL,
      is_available INTEGER NOT NULL DEFAULT 1,
      status_type TEXT DEFAULT 'available',
      reason TEXT,
      max_serial INTEGER,
      start_time TEXT,
      end_time TEXT,
      expected_arrival_time TEXT,
      delay_minutes INTEGER DEFAULT 0,
      public_message TEXT,
      reception_note TEXT,
      source TEXT DEFAULT 'admin',
      updated_by INTEGER,
      created_at TEXT DEFAULT (datetime('now', '+6 hours')),
      updated_at TEXT DEFAULT (datetime('now', '+6 hours')),
      UNIQUE (tenant_id, doctor_id, status_date)
    )
  `).run();

  const tableInfo = await db.prepare('PRAGMA table_info(doctor_daily_status)').all<{ name?: string }>();
  const existingColumns = new Set((tableInfo.results ?? []).map((column) => String(column.name ?? '')));

  for (const column of REQUIRED_DOCTOR_DAILY_STATUS_COLUMNS) {
    if (existingColumns.has(column.name)) continue;
    try {
      await db.prepare(column.ddl).run();
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (!message.includes('duplicate column')) {
        throw error;
      }
    }
  }

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_doctor_daily_status_tenant_date
      ON doctor_daily_status(tenant_id, status_date)
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_doctor_daily_status_type
      ON doctor_daily_status(tenant_id, status_date, status_type)
  `).run();
}

export function hasDoctorTimelineConflict(
  existing: Pick<DoctorDailyStatusRow, 'status_type' | 'start_time' | 'end_time'> | null | undefined,
  incoming: { statusType?: string; isAvailable?: boolean; reason?: string | null },
) {
  if (!existing) return false;
  const hasTimedSchedule = Boolean(existing.start_time || existing.end_time || existing.status_type === 'scheduled');
  if (!hasTimedSchedule) return false;

  return incoming.statusType !== undefined || incoming.isAvailable !== undefined || incoming.reason !== undefined;
}
