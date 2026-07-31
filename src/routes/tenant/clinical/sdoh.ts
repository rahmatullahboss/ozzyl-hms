import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../../types';
import { requireTenantId, requireUserId } from '../../../lib/context-helpers';
import { getDb } from '../../../db';
import { createSDOHSchema, computeSdohScore } from '../../../schemas/clinical-assessments';

type ClinicalEnv = { Bindings: Env; Variables: Variables };
export const sdohRoutes = new Hono<ClinicalEnv>();

// ─── SDOH: list ─────────────────────────────────────────────────────────────

sdohRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patientId');
  if (!patientId || isNaN(Number(patientId))) {
    throw new HTTPException(400, { message: 'patientId query param is required' });
  }

  const { results } = await db.$client
    .prepare(
      `SELECT * FROM FormSDOH
       WHERE tenant_id = ? AND PatientId = ?
       ORDER BY CreatedAt DESC
       LIMIT 10`,
    )
    .bind(tenantId, Number(patientId))
    .all();

  return c.json({ Results: results });
});

// ─── SDOH: single ───────────────────────────────────────────────────────────

sdohRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = Number(c.req.param('id'));
  if (isNaN(id)) throw new HTTPException(400, { message: 'Invalid SDOH ID' });

  const row = await db.$client
    .prepare('SELECT * FROM FormSDOH WHERE tenant_id = ? AND SDOHId = ?')
    .bind(tenantId, id)
    .first();

  if (!row) throw new HTTPException(404, { message: 'SDOH assessment not found' });
  return c.json({ Results: row });
});

// ─── SDOH: create ───────────────────────────────────────────────────────────

sdohRoutes.post('/', zValidator('json', createSDOHSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const { score, riskLevel } = computeSdohScore(data);

  // Insert core fields into FormSDOH
  const mainResult = await db.$client
    .prepare(
      `INSERT INTO FormSDOH (
        tenant_id, PatientId, EncounterId,
        Education, Disability, Housing, HousingOtherInput,
        WorkTemporary, WorkSeasonal, WorkLooking, WorkRetired, WorkDisabled, WorkHours,
        HHSize, HHIncome,
        CareUnder5, CareOver65, CareChronicallyIll, CareDisabled, CareOther, CareOtherInput,
        DebtMedical, DebtCreditCard, DebtStudentLoan, DebtMortgage, DebtRent, DebtUtilities,
        DebtOther, DebtOtherInput,
        MoneyFood, MoneyHousing, MoneyUtilities, MoneyClothing, MoneyChildcare, MoneyMedical,
        MoneyOther, MoneyOtherInput,
        TransportMedical, TransportWork, TransportSchool, TransportFood, TransportOther,
        TransportOtherInput,
        MedicalNoInsurance, MedicalCostMedication, MedicalCostVisit, MedicalNoProvider,
        MedicalLanguageBarrier, MedicalOther, MedicalOtherInput,
        Dentist, DentistOtherInput, Social, Stress,
        StressDeath, StressDivorce, StressJobLoss, StressMoving, StressIllness,
        StressViolence, StressDisaster, StressOther, StressOtherInput,
        Safety, PartnerSafety, Female, Addiction, ArmedServices, Refugee,
        TotalScore, CreatedById, CreatedAt
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP
      )`,
    )
    .bind(
      tenantId, data.PatientId, data.EncounterId ?? null,
      data.Education ?? null, data.Disability ?? null, data.Housing ?? null, data.HousingOtherInput ?? null,
      data.WorkTemporary ?? 0, data.WorkSeasonal ?? 0, data.WorkLooking ?? 0,
      data.WorkRetired ?? 0, data.WorkDisabled ?? 0, data.WorkHours ?? null,
      data.HHSize ?? null, data.HHIncome ?? null,
      data.CareUnder5 ?? 0, data.CareOver65 ?? 0, data.CareChronicallyIll ?? 0,
      data.CareDisabled ?? 0, data.CareOther ?? 0, data.CareOtherInput ?? null,
      data.DebtMedical ?? 0, data.DebtCreditCard ?? 0, data.DebtStudentLoan ?? 0,
      data.DebtMortgage ?? 0, data.DebtRent ?? 0, data.DebtUtilities ?? 0,
      data.DebtOther ?? 0, data.DebtOtherInput ?? null,
      data.MoneyFood ?? 0, data.MoneyHousing ?? 0, data.MoneyUtilities ?? 0,
      data.MoneyClothing ?? 0, data.MoneyChildcare ?? 0, data.MoneyMedical ?? 0,
      data.MoneyOther ?? 0, data.MoneyOtherInput ?? null,
      data.TransportMedical ?? 0, data.TransportWork ?? 0, data.TransportSchool ?? 0,
      data.TransportFood ?? 0, data.TransportOther ?? 0, data.TransportOtherInput ?? null,
      data.MedicalNoInsurance ?? 0, data.MedicalCostMedication ?? 0, data.MedicalCostVisit ?? 0,
      data.MedicalNoProvider ?? 0, data.MedicalLanguageBarrier ?? 0, data.MedicalOther ?? 0,
      data.MedicalOtherInput ?? null,
      data.Dentist ?? null, data.DentistOtherInput ?? null, data.Social ?? null, data.Stress ?? null,
      data.StressDeath ?? 0, data.StressDivorce ?? 0, data.StressJobLoss ?? 0, data.StressMoving ?? 0,
      data.StressIllness ?? 0, data.StressViolence ?? 0, data.StressDisaster ?? 0,
      data.StressOther ?? 0, data.StressOtherInput ?? null,
      data.Safety ?? null, data.PartnerSafety ?? null, data.Female ?? null,
      data.Addiction ?? null, data.ArmedServices ?? null, data.Refugee ?? null,
      score, userId,
    )
    .run();

  if (!mainResult.success) throw new HTTPException(500, { message: 'Failed to create SDOH assessment' });
  const sdohId = mainResult.meta.last_row_id;

  // Insert discrimination/displacement/contact fields into FormSDOH_Extra
  await db.$client
    .prepare(
      `INSERT INTO FormSDOH_Extra (
        tenant_id, SDOHId, PatientId,
        DiscrimRace, DiscrimGender, DiscrimSexuality, DiscrimReligion,
        DiscrimAge, DiscrimDisability, DiscrimOther, DiscrimOtherInput,
        DisplaceWork, DisplaceHome, DisplaceSchool, DisplaceOther, DisplaceOtherInput,
        Contact, ContactOtherInput
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tenantId, sdohId, data.PatientId,
      data.DiscrimRace ?? 0, data.DiscrimGender ?? 0, data.DiscrimSexuality ?? 0,
      data.DiscrimReligion ?? 0, data.DiscrimAge ?? 0, data.DiscrimDisability ?? 0,
      data.DiscrimOther ?? 0, data.DiscrimOtherInput ?? null,
      data.DisplaceWork ?? 0, data.DisplaceHome ?? 0, data.DisplaceSchool ?? 0,
      data.DisplaceOther ?? 0, data.DisplaceOtherInput ?? null,
      data.Contact ?? null, data.ContactOtherInput ?? null,
    )
    .run();

  return c.json({ Results: { id: sdohId, totalScore: score } }, 201);
});
