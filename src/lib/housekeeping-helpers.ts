import { getTodayGMT6 } from './date-utils';

/**
 * Auto-create a post_discharge housekeeping task when a bed enters 'cleaning' status.
 * Called from all discharge paths (clinical, billing, credit, discharge planning, death, IP billing).
 */
export async function createPostDischargeCleaningTask(
  db: D1Database,
  tenantId: string,
  params: {
    bedId: number;
    admissionId: number;
    assignedTo?: string;
    assignedToId?: number;
  },
): Promise<void> {
  const bed = await db
    .prepare('SELECT bed_number, ward_name FROM beds WHERE id = ? AND tenant_id = ?')
    .bind(params.bedId, tenantId)
    .first<{ bed_number: string; ward_name: string }>();
  if (!bed) return;

  const today = getTodayGMT6();
  const datePrefix = today.replace(/-/g, '');
  const row = await db
    .prepare('SELECT COUNT(*) as cnt FROM housekeeping_tasks WHERE tenant_id = ? AND task_number LIKE ?')
    .bind(tenantId, `HK-${datePrefix}%`)
    .first<{ cnt: number }>();
  const taskNumber = `HK-${datePrefix}-${String((row?.cnt ?? 0) + 1).padStart(3, '0')}`;

  await db
    .prepare(
      `INSERT INTO housekeeping_tasks
        (tenant_id, task_number, area_name, task_type, priority, description, scheduled_date, assigned_to, assigned_to_id, bed_id, admission_id, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      tenantId,
      taskNumber,
      bed.ward_name,
      'post_discharge',
      'high',
      `Post-discharge cleaning — Bed ${bed.bed_number} (${bed.ward_name})`,
      today,
      params.assignedTo ?? null,
      params.assignedToId ?? null,
      params.bedId,
      params.admissionId,
      params.assignedToId ?? null,
    )
    .run();
}
