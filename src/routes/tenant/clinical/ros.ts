import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createROSSchema } from '../../../schemas/clinical-assessments';

type ClinicalEnv = { Bindings: Env; Variables: Variables };
export const rosRoutes = new Hono<ClinicalEnv>();

// ─── ROS: list ──────────────────────────────────────────────────────────────

rosRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare(
      `SELECT * FROM FormROS
       WHERE tenant_id = ? AND PatientId = ?
       ORDER BY CreatedAt DESC
       LIMIT 10`,
    )
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

// ─── ROS: single (merge FormROS + FormROS_Extra) ────────────────────────────

rosRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid ROS ID' });

  const row = await db.$client
    .prepare('SELECT * FROM FormROS WHERE tenant_id = ? AND ROSId = ?')
    .bind(tenantId, id)
    .first();

  if (!row) throw new HTTPException(404, { message: 'ROS assessment not found' });

  const extra = await db.$client
    .prepare('SELECT * FROM FormROS_Extra WHERE ROSId = ?')
    .bind(id)
    .first();

  return c.json({ Results: { ...row, ...(extra ?? {}) } });
});

// ─── ROS: create ────────────────────────────────────────────────────────────

rosRoutes.post('/', zValidator('json', createROSSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  // Insert core fields (constitutional through genitourinary) into FormROS
  const mainResult = await db.$client
    .prepare(
      `INSERT INTO FormROS (
        tenant_id, PatientId, EncounterId, Activity,
        WeightChange, Weakness, Fatigue, Anorexia, Fever, Chills, NightSweats,
        Insomnia, Irritability, HeatOrCold, Intolerance,
        ChangeInVision, GlaucomaHistory, EyePain, Irritation, Redness, ExcessiveTearing,
        DoubleVision, BlindSpots, Photophobia,
        HearingLoss, Discharge, Pain, Vertigo, Tinnitus,
        FrequentColds, SoreThroat, SinusProblems, PostNasalDrip, Nosebleed, Snoring, Apnea,
        BreastMass, BreastDischarge, Biopsy, AbnormalMammogram,
        Cough, Sputum, ShortnessOfBreath, Wheezing, Hemoptsyis, Asthma, COPD,
        ChestPain, Palpitation, Syncope, PND, DOE, Orthopnea, Peripheal, Edema,
        LegPainCramping, HistoryMurmur, Arrythmia, HeartProblem,
        Dysphagia, Heartburn, Bloating, Belching, Flatulence, Nausea, Vomiting,
        Hematemesis, GastroPain, FoodIntolerance, Hepatitis, Jaundice, Hematochezia,
        ChangedBowel, Diarrhea, Constipation,
        Polyuria, Polydypsia, Dysuria, Hematuria, Frequency, Urgency, Incontinence,
        RenalStones, UTIs, Hesitancy, Dribbling, Stream, Nocturia, Erections, Ejaculations,
        CreatedById, CreatedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, CURRENT_TIMESTAMP
      )`,
    )
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null, data.Activity ?? 1,
      data.WeightChange ?? 'N/A', data.Weakness ?? 'N/A', data.Fatigue ?? 'N/A',
      data.Anorexia ?? 'N/A', data.Fever ?? 'N/A', data.Chills ?? 'N/A',
      data.NightSweats ?? 'N/A', data.Insomnia ?? 'N/A', data.Irritability ?? 'N/A',
      (data as any).HeatOrCold ?? 'N/A', (data as any).Intolerance ?? 'N/A',
      (data as any).ChangeInVision ?? 'N/A', (data as any).GlaucomaHistory ?? 'N/A',
      data.EyePain ?? 'N/A', (data as any).Irritation ?? 'N/A', (data as any).Redness ?? 'N/A',
      (data as any).ExcessiveTearing ?? 'N/A', data.DoubleVision ?? 'N/A',
      (data as any).BlindSpots ?? 'N/A', (data as any).Photophobia ?? 'N/A',
      (data as any).HearingLoss ?? 'N/A', (data as any).Discharge ?? 'N/A',
      (data as any).Pain ?? 'N/A', (data as any).Vertigo ?? 'N/A', (data as any).Tinnitus ?? 'N/A',
      (data as any).FrequentColds ?? 'N/A', (data as any).SoreThroat ?? 'N/A',
      (data as any).SinusProblems ?? 'N/A', (data as any).PostNasalDrip ?? 'N/A',
      (data as any).Nosebleed ?? 'N/A', (data as any).Snoring ?? 'N/A', (data as any).Apnea ?? 'N/A',
      (data as any).BreastMass ?? 'N/A', (data as any).BreastDischarge ?? 'N/A',
      (data as any).Biopsy ?? 'N/A', (data as any).AbnormalMammogram ?? 'N/A',
      data.Cough ?? 'N/A', data.Sputum ?? 'N/A', data.ShortOfBreath ?? 'N/A',
      data.Wheezing ?? 'N/A', data.Hemoptysis ?? 'N/A', data.Asthma ?? 'N/A',
      (data as any).COPD ?? 'N/A',
      data.ChestPain ?? 'N/A', data.Palpitations ?? 'N/A', (data as any).Syncope ?? 'N/A',
      data.PND ?? 'N/A', (data as any).DOE ?? 'N/A', data.Orthopnea ?? 'N/A',
      (data as any).Peripheal ?? 'N/A', data.Edema ?? 'N/A',
      (data as any).LegPainCramping ?? 'N/A', (data as any).HistoryMurmur ?? 'N/A',
      (data as any).Arrythmia ?? 'N/A', (data as any).HeartProblem ?? 'N/A',
      (data as any).Dysphagia ?? 'N/A', data.Heartburn ?? 'N/A',
      (data as any).Bloating ?? 'N/A', (data as any).Belching ?? 'N/A',
      (data as any).Flatulence ?? 'N/A', data.NauseaVomiting ?? 'N/A',
      (data as any).Vomiting ?? 'N/A', data.Hematemesis ?? 'N/A',
      (data as any).GastroPain ?? 'N/A', (data as any).FoodIntolerance ?? 'N/A',
      data.Hepatitis ?? 'N/A', data.Jaundice ?? 'N/A', (data as any).Hematochezia ?? 'N/A',
      data.ChangeBowelHabits ?? 'N/A', data.Diarrhea ?? 'N/A', data.Constipation ?? 'N/A',
      data.Polyuria ?? 'N/A', (data as any).Polydypsia ?? 'N/A', data.Dysuria ?? 'N/A',
      data.Hematuria ?? 'N/A', data.Frequency ?? 'N/A', data.Urgency ?? 'N/A',
      data.Incontinence ?? 'N/A', (data as any).RenalStones ?? 'N/A', (data as any).UTIs ?? 'N/A',
      data.Hesitancy ?? 'N/A', (data as any).Dribbling ?? 'N/A', (data as any).Stream ?? 'N/A',
      data.Nocturia ?? 'N/A', (data as any).Erections ?? 'N/A', (data as any).Ejaculations ?? 'N/A',
      userId,
    )
    .run();

  if (!mainResult.success) throw new HTTPException(500, { message: 'Failed to create ROS assessment' });
  const rosId = mainResult.meta.last_row_id;

  // Insert reproductive, musculoskeletal, neuro, skin, psych, endocrine, hematologic into FormROS_Extra
  await db.$client
    .prepare(
      `INSERT INTO FormROS_Extra (
        tenant_id, ROSId, PatientId,
        FemaleG, FemaleP, FemaleAP, FemaleLC, Menarche, Menopause, LMP,
        MenstrualFrequency, MenstrualFlow, FemaleSymptoms, AbnormalHairGrowth, FHirsutism,
        JointPain, Swelling, MuscRedness, MuscWarm, MuscStiffness, Muscle, MuscAches, FMS, Arthritis,
        LOC, Seizures, Stroke, TIA, NeuroNumbness, NeuroWeakness, Paralysis,
        IntellectualDecline, MemoryProblems, Dementia, Headache,
        SkinCancer, Psoriasis, Acne, SkinOther, SkinDisease,
        PsychDiagnosis, PsychMedication, Depression, Anxiety, SocialDifficulties,
        ThyroidProblems, Diabetes,
        AbnormalBlood, Anemia, FHBloodProblems, BleedingProblems, Allergies, FrequentIllness,
        HIV, HAIStatus
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )`,
    )
    .bind(
      tenantId, rosId, data.PatientId,
      (data as any).FemaleG ?? 'N/A', (data as any).FemaleP ?? 'N/A',
      (data as any).FemaleAP ?? 'N/A', (data as any).FemaleLC ?? 'N/A',
      (data as any).Menarche ?? 'N/A', (data as any).Menopause ?? 'N/A', (data as any).LMP ?? 'N/A',
      (data as any).MenstrualFrequency ?? 'N/A', (data as any).MenstrualFlow ?? 'N/A',
      (data as any).FemaleSymptoms ?? 'N/A', (data as any).AbnormalHairGrowth ?? 'N/A',
      (data as any).FHirsutism ?? 'N/A',
      data.JointPain ?? 'N/A', data.Swelling ?? 'N/A', (data as any).MuscRedness ?? 'N/A',
      (data as any).MuscWarm ?? 'N/A', data.Stiffness ?? 'N/A', data.MusclePain ?? 'N/A',
      (data as any).MuscAches ?? 'N/A', (data as any).FMS ?? 'N/A', (data as any).Arthritis ?? 'N/A',
      (data as any).LOC ?? 'N/A', data.Seizures ?? 'N/A', (data as any).Stroke ?? 'N/A',
      (data as any).TIA ?? 'N/A', data.Numbness ?? 'N/A', (data as any).NeuroWeakness ?? 'N/A',
      data.Paralysis ?? 'N/A', (data as any).IntellectualDecline ?? 'N/A',
      data.MemoryLoss ?? 'N/A', (data as any).Dementia ?? 'N/A', data.Headache ?? 'N/A',
      (data as any).SkinCancer ?? 'N/A', (data as any).Psoriasis ?? 'N/A',
      (data as any).Acne ?? 'N/A', (data as any).SkinOther ?? 'N/A', (data as any).SkinDisease ?? 'N/A',
      (data as any).PsychDiagnosis ?? 'N/A', (data as any).PsychMedication ?? 'N/A',
      data.Depression ?? 'N/A', data.PsychAnxiety ?? 'N/A', (data as any).SocialDifficulties ?? 'N/A',
      (data as any).ThyroidProblems ?? 'N/A', (data as any).Diabetes ?? 'N/A',
      data.AbnormalBleeding ?? 'N/A', (data as any).Anemia ?? 'N/A',
      (data as any).FHBloodProblems ?? 'N/A', (data as any).BleedingProblems ?? 'N/A',
      data.Allergies ?? 'N/A', (data as any).FrequentIllness ?? 'N/A',
      data.HIVExposure ?? 'N/A', (data as any).HAIStatus ?? 'N/A',
    )
    .run();

  return c.json({ Results: { id: rosId } }, 201);
});
