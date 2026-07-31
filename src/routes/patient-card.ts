import { Hono } from 'hono';
import type { Env } from '../types';
import { authMiddleware } from '../middleware/auth';

const patientCardRoutes = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

patientCardRoutes.use('*', authMiddleware);

/**
 * GET /api/patient-card
 * Fetches the specific data required to render the Digital Health Card UI.
 * This combines data from global_patient_auth and global_patient_identity.
 */
patientCardRoutes.get('/', async (c) => {
  const userId = c.get('userId');

  // Query across auth and identity tables for card info
  const result: any = await c.env.DB.prepare(
    `SELECT 
       a.id as auth_id,
       a.uhid,
       a.national_id,
       i.primary_name as name,
       i.blood_group,
       i.date_of_birth,
       i.gender,
       i.profile_picture_url,
       i.verification_level
     FROM global_patient_auth a
     LEFT JOIN global_patient_identity i ON a.uhid = i.uhid
     WHERE a.id = ? AND a.is_active = 1`
  )
    .bind(userId)
    .first();

  if (!result || !result.uhid) {
    return c.json({ error: 'Patient identity incomplete' }, 403);
  }

  // Calculate age for the card display
  let age = null;
  if (result.date_of_birth) {
    const dob = new Date(result.date_of_birth);
    const diff = Date.now() - dob.getTime();
    age = Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  }

  // ─────────────────────────────────────────────────────────────────
  // FHIR Mapping Concept Note:
  // Since we are building an ecosystem, the card acts as a SMART Health Link
  // The QR code resolves to a hosted verification page.
  // ─────────────────────────────────────────────────────────────────
  const verificationUrl = `https://portal.ozzyl.com/verify/${result.uhid}`;

  return c.json({
    card: {
      uhid: result.uhid,
      name: result.name || 'Unknown',
      blood_group: result.blood_group || 'Unknown',
      age: age,
      date_of_birth: result.date_of_birth,
      gender: result.gender,
      profile_picture_url: result.profile_picture_url,
      verification_level: result.verification_level,
      // The QR code on the frontend should simply encode this verification_url
      qr_payload: verificationUrl
    }
  });
});

export default patientCardRoutes;
