/**
 * AI Wellness Context Builder
 *
 * Builds a concise (<500 tokens) context string from a patient's recent
 * wellness + clinical data. Used to enrich the AI buddy system prompt
 * so Ozzy can give personalized, clinically-aware advice.
 *
 * Data sources:
 *   - Wellness: health score, streaks, goals, normalized logs
 *   - Clinical: allergies, conditions, medications, vitals, adherence
 */

export async function buildWellnessContext(
  db: any,
  patientId: number,
  uhid?: string,
): Promise<string> {
  const parts: string[] = [];

  try {
    await buildWellnessParts(db, patientId, parts);
  } catch { /* partial failure ok */ }

  try {
    if (uhid) {
      await buildClinicalParts(db, uhid, parts);
    }
  } catch { /* partial failure ok */ }

  if (parts.length === 0) return '';

  return `\n\nPatient health summary:\n${parts.join('\n')}`;
}

async function buildWellnessParts(db: any, patientId: number, parts: string[]): Promise<void> {
  const score = await db.prepare(
    'SELECT total_score, date FROM daily_health_score WHERE patient_id = ? ORDER BY date DESC LIMIT 1',
  ).bind(patientId).first() as any;

  if (score) {
    const label = scoreLabel(score.total_score);
    parts.push(`Health Score: ${score.total_score}/100 (${label}) on ${score.date}`);
  }

  const scores = await db.prepare(
    'SELECT total_score FROM daily_health_score WHERE patient_id = ? ORDER BY date DESC LIMIT 7',
  ).bind(patientId).all() as any;

  if (scores?.results?.length >= 2) {
    const first = scores.results[0].total_score;
    const last = scores.results[scores.results.length - 1].total_score;
    const diff = first - last;
    parts.push(`Score trend (7d): ${diff > 0 ? '+' : ''}${diff} points`);
  }

  const streaks = await db.prepare(
    'SELECT streak_type, current_count FROM streaks WHERE patient_id = ? AND current_count > 0',
  ).bind(patientId).all() as any;

  if (streaks?.results?.length > 0) {
    const summary = streaks.results
      .map((s: any) => `${s.streak_type}: ${s.current_count}d`)
      .join(', ');
    parts.push(`Streaks: ${summary}`);
  }

  const goals = await db.prepare(
    'SELECT goal_type, target_value, current_value, unit FROM user_goals WHERE patient_id = ? AND status = ? LIMIT 3',
  ).bind(patientId, 'active').all() as any;

  if (goals?.results?.length > 0) {
    const summary = goals.results
      .map((g: any) => `${g.goal_type}: ${g.current_value}/${g.target_value}${g.unit ? ' ' + g.unit : ''}`)
      .join(', ');
    parts.push(`Goals: ${summary}`);
  }

  const sleepRows = await db.prepare(
    'SELECT duration_min, quality_rating FROM sleep_log WHERE patient_id = ? AND duration_min IS NOT NULL ORDER BY logged_at DESC LIMIT 7',
  ).bind(patientId).all() as any;

  if (sleepRows?.results?.length > 0) {
    const avgH = sleepRows.results.reduce((s: number, r: any) => s + (r.duration_min || 0), 0) / sleepRows.results.length / 60;
    const avgQ = sleepRows.results.reduce((s: number, r: any) => s + (r.quality_rating || 0), 0) / sleepRows.results.length;
    parts.push(`Sleep avg (7d): ${avgH.toFixed(1)}h, quality ${avgQ.toFixed(1)}/5`);
  }

  const moodRows = await db.prepare(
    'SELECT mood FROM mood_log WHERE patient_id = ? ORDER BY logged_at DESC LIMIT 7',
  ).bind(patientId).all() as any;

  if (moodRows?.results?.length >= 2) {
    const counts: Record<string, number> = {};
    for (const r of moodRows.results) counts[r.mood] = (counts[r.mood] || 0) + 1;
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    parts.push(`Mood pattern: ${dominant[0]} (${dominant[1]}/${moodRows.results.length}d)`);
  }

  const activityRows = await db.prepare(
    'SELECT activity_type, duration_min FROM activity_log WHERE patient_id = ? ORDER BY logged_at DESC LIMIT 7',
  ).bind(patientId).all() as any;

  if (activityRows?.results?.length > 0) {
    const totalMin = activityRows.results.reduce((s: number, r: any) => s + (r.duration_min || 0), 0);
    const types = [...new Set(activityRows.results.map((r: any) => r.activity_type))];
    parts.push(`Activity (7d): ${totalMin}min total, types: ${types.join(', ')}`);
  }
}

async function buildClinicalParts(db: any, uhid: string, parts: string[]): Promise<void> {
  const conditions = await db.prepare(
    "SELECT name, severity, clinical_status FROM global_patient_reported_data WHERE uhid = ? AND category IN ('chronic_condition', 'current_health_issue') AND clinical_status = 'active' LIMIT 5",
  ).bind(uhid).all() as any;

  if (conditions?.results?.length > 0) {
    const summary = conditions.results
      .map((r: any) => `${r.name}${r.severity ? ` (${r.severity})` : ''}`)
      .join(', ');
    parts.push(`Active conditions: ${summary}`);
  }

  const allergies = await db.prepare(
    "SELECT name, severity FROM global_patient_reported_data WHERE uhid = ? AND category = 'allergy' AND clinical_status = 'active' LIMIT 5",
  ).bind(uhid).all() as any;

  if (allergies?.results?.length > 0) {
    const summary = allergies.results
      .map((r: any) => `${r.name}${r.severity ? ` (${r.severity})` : ''}`)
      .join(', ');
    parts.push(`Allergies: ${summary}`);
  }

  const meds = await db.prepare(
    "SELECT name FROM global_patient_reported_data WHERE uhid = ? AND category = 'current_medication' AND clinical_status = 'active' LIMIT 5",
  ).bind(uhid).all() as any;

  if (meds?.results?.length > 0) {
    const summary = meds.results.map((r: any) => r.name).join(', ');
    parts.push(`Current meds: ${summary}`);
  }

  const vitals = await db.prepare(
    'SELECT systolic, diastolic, heart_rate, blood_sugar, blood_sugar_context FROM global_patient_vitals WHERE uhid = ? ORDER BY logged_on DESC LIMIT 1',
  ).bind(uhid).first() as any;

  if (vitals) {
    const vParts: string[] = [];
    if (vitals.systolic && vitals.diastolic) vParts.push(`BP ${vitals.systolic}/${vitals.diastolic}`);
    if (vitals.heart_rate) vParts.push(`HR ${vitals.heart_rate}`);
    if (vitals.blood_sugar) vParts.push(`Sugar ${vitals.blood_sugar}${vitals.blood_sugar_context ? ` (${vitals.blood_sugar_context})` : ''}`);
    if (vParts.length > 0) parts.push(`Latest vitals: ${vParts.join(', ')}`);
  }

  const reminders = await db.prepare(
    'SELECT medicine_name, dosage, time_slot FROM global_patient_medicine_reminders WHERE uhid = ? AND is_active = 1 LIMIT 5',
  ).bind(uhid).all() as any;

  if (reminders?.results?.length > 0) {
    const summary = reminders.results
      .map((r: any) => `${r.medicine_name} ${r.dosage || ''}`.trim())
      .join(', ');
    parts.push(`Med reminders: ${summary}`);
  }

  const adherence = await db.prepare(
    "SELECT COUNT(*) as total, SUM(CASE WHEN skipped = 0 THEN 1 ELSE 0 END) as taken FROM global_patient_medicine_adherence WHERE uhid = ? AND taken_date >= date('now', '-7 days')",
  ).bind(uhid).first() as any;

  if (adherence && adherence.total > 0) {
    const pct = Math.round((adherence.taken / adherence.total) * 100);
    parts.push(`Med adherence (7d): ${pct}% (${adherence.taken}/${adherence.total})`);
  }

  const reactions = await db.prepare(
    'SELECT medication_name, reaction, severity FROM global_patient_adverse_reactions WHERE uhid = ? AND outcome_status != ? LIMIT 3',
  ).bind(uhid, 'resolved').all() as any;

  if (reactions?.results?.length > 0) {
    const summary = reactions.results
      .map((r: any) => `${r.medication_name} → ${r.reaction} (${r.severity})`)
      .join('; ');
    parts.push(`Adverse reactions: ${summary}`);
  }
}

function scoreLabel(score: number): string {
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 70) return 'fair';
  if (score >= 60) return 'needs improvement';
  return 'needs attention';
}

export { scoreLabel };
