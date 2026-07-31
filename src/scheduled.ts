import { createSmsProvider, SmsTemplates } from './lib/sms';
import { sendEmail, EmailTemplates } from './lib/email';
import { dispatchLisRetractionNotifications } from './services/lis-retraction-notification-dispatch';
import type { Env } from './types';

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      dispatchLisRetractionNotifications(env.DB).catch((error) => {
        console.error('LIS retraction notification dispatch failed:', error);
      }),
    );

    if (event.cron === '0 0 * * *') {
      // Run daily jobs concurrently
      await Promise.allSettled([
        processRecurringExpenses(env),
        checkMedicineExpiry(env),
        sendAppointmentReminders(env),
      ]);
    }

    if (event.cron === '0 7 * * 1') {
      // Weekly report — every Monday at 7:00 AM UTC
      await generateWeeklyReport(env);
    }
  }
};

async function processRecurringExpenses(env: Env): Promise<void> {
  console.log('Running recurring expenses job...');

  try {
    // Get all active tenants
    const tenants = await env.DB.prepare(
      'SELECT id FROM tenants WHERE status = ?'
    ).bind('active').all<{ id: number }>();

    for (const tenant of tenants.results) {
      const tenantId = tenant.id.toString();

      // Resolve a valid system user for this tenant (first hospital_admin)
      // This replaces the old hardcoded `created_by = 1` which could reference
      // a non-existent user if the tenant's first user was deleted.
      const systemUser = await env.DB.prepare(
        `SELECT id FROM users WHERE tenant_id = ? AND role = 'hospital_admin' ORDER BY id ASC LIMIT 1`
      ).bind(tenantId).first<{ id: number }>();

      if (!systemUser) {
        console.warn(`No hospital_admin found for tenant ${tenantId} — skipping recurring expenses`);
        continue;
      }

      const systemUserId = systemUser.id;

      // Get all active recurring expenses due today or overdue
      const today = new Date().toISOString().split('T')[0];

      const recurringExpenses = await env.DB.prepare(`
        SELECT r.*, ec.name as category_name
        FROM recurring_expenses r
        LEFT JOIN expense_categories ec ON r.category_id = ec.id
        WHERE r.tenant_id = ? AND r.is_active = 1 AND r.next_run_date <= ?
      `).bind(tenantId, today).all<{
        id: number;
        amount: number;
        description: string;
        frequency: string;
        next_run_date: string;
        category_name: string;
      }>();

      for (const recurring of recurringExpenses.results) {
        try {
          // Insert expense + update next_run_date atomically
          const nextRunDate = computeNextRunDate(recurring.next_run_date, recurring.frequency);

          await env.DB.batch([
            env.DB.prepare(`
              INSERT INTO expenses (date, category, amount, description, status, tenant_id, created_by, approved_by, approved_at)
              VALUES (?, ?, ?, ?, 'approved', ?, ?, ?, datetime('now'))
            `).bind(
              today,
              recurring.category_name,
              recurring.amount,
              `Recurring: ${recurring.description || `expense #${recurring.id}`}`,
              tenantId,
              systemUserId,
              systemUserId
            ),
            env.DB.prepare(`
              UPDATE recurring_expenses SET next_run_date = ? WHERE id = ? AND tenant_id = ?
            `).bind(nextRunDate, recurring.id, tenantId),
          ]);

          console.log(`Created recurring expense for tenant ${tenantId} (next run: ${nextRunDate})`);
        } catch (expenseError) {
          console.error(`Error creating expense for recurring ${recurring.id}:`, expenseError);
        }
      }
    }

    console.log('Recurring expenses job completed');
  } catch (error) {
    console.error('Error in recurring expenses job:', error);
  }
}

/**
 * Calculate the next run date for a recurring expense.
 * Handles daily, weekly, and monthly frequencies.
 */
function computeNextRunDate(currentDate: string, frequency: string): string {
  const d = new Date(currentDate);
  if (frequency === 'daily') {
    d.setDate(d.getDate() + 1);
  } else if (frequency === 'weekly') {
    d.setDate(d.getDate() + 7);
  } else {
    // monthly (default)
    d.setMonth(d.getMonth() + 1);
  }
  return d.toISOString().split('T')[0];
}

/**
 * Daily medicine expiry alert job.
 * Queries all pharmacy stock items expiring within 30 days,
 * groups them by tenant, and notifies the hospital admin via email + SMS.
 */
async function checkMedicineExpiry(env: Env): Promise<void> {
  console.log('Running medicine expiry check...');

  try {
    const tenants = await env.DB.prepare(
      'SELECT id, name FROM tenants WHERE status = ?'
    ).bind('active').all<{ id: number; name: string }>();

    const today = new Date();
    const threshold = new Date();
    threshold.setDate(today.getDate() + 30);
    const thresholdDate = threshold.toISOString().split('T')[0];
    const todayDate = today.toISOString().split('T')[0];

    for (const tenant of tenants.results) {
      const tenantId = tenant.id.toString();

      // Find medicines expiring within the next 30 days
      const expiring = await env.DB.prepare(`
        SELECT
          p.name,
          ps.expiry_date,
          ps.quantity as stock,
          ps.batch_no
        FROM pharmacy_stock ps
        JOIN pharmacy p ON ps.medicine_id = p.id
        WHERE ps.tenant_id = ?
          AND ps.expiry_date IS NOT NULL
          AND ps.expiry_date >= ?
          AND ps.expiry_date <= ?
          AND ps.quantity > 0
        ORDER BY ps.expiry_date ASC
      `).bind(tenantId, todayDate, thresholdDate).all<{
        name: string;
        expiry_date: string;
        stock: number;
        batch_no: string;
      }>();

      if (expiring.results.length === 0) continue;

      // Get admin contact info
      const admin = await env.DB.prepare(`
        SELECT u.email, u.name, u.mobile
        FROM users u
        WHERE u.tenant_id = ? AND u.role = 'hospital_admin'
        ORDER BY u.id ASC LIMIT 1
      `).bind(tenantId).first<{ email: string; name: string; mobile?: string }>();

      if (!admin) {
        console.warn(`No admin found for tenant ${tenantId} — skipping expiry alert`);
        continue;
      }

      const medicines = expiring.results.map(m => ({
        name: m.name,
        expiryDate: m.expiry_date,
        stock: m.stock,
        batchNo: m.batch_no || '—',
      }));

      // ─── Email alert ─────────────────────────────────────────────────
      const template = EmailTemplates.medicineExpiryAlert({
        medicines,
        hospitalName: tenant.name,
      });
      const emailResult = await sendEmail(env, { to: admin.email, ...template });
      if (emailResult.success) {
        console.log(`Expiry alert email sent to admin of tenant ${tenantId} (${expiring.results.length} items)`);
      } else {
        console.error(`Failed to send expiry email for tenant ${tenantId}:`, emailResult.error);
      }

      // ─── SMS alert (if admin has mobile) ─────────────────────────────
      if (admin.mobile) {
        const sms = createSmsProvider(env);
        const message = SmsTemplates.medicineExpiry(
          medicines[0].name,
          medicines[0].expiryDate,
          medicines[0].stock
        ) + (medicines.length > 1 ? ` (+${medicines.length - 1} more)` : '');
        await sms.sendSMS(admin.mobile, message);
      }
    }

    console.log('Medicine expiry check completed');
  } catch (error) {
    console.error('Error in medicine expiry check:', error);
  }
}

/**
 * Weekly report — runs every Monday at 7 AM UTC.
 * Collects key metrics for the past 7 days and emails a summary to each tenant admin.
 */
async function generateWeeklyReport(env: Env): Promise<void> {
  console.log('Running weekly report generation...');

  try {
    const tenants = await env.DB.prepare(
      'SELECT id, name FROM tenants WHERE status = ?'
    ).bind('active').all<{ id: number; name: string }>();

    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const startDate = weekAgo.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    for (const tenant of tenants.results) {
      const tenantId = tenant.id.toString();

      const admin = await env.DB.prepare(
        `SELECT email, name FROM users WHERE tenant_id = ? AND role = 'hospital_admin' ORDER BY id ASC LIMIT 1`
      ).bind(tenantId).first<{ email: string; name: string }>();

      if (!admin) continue;

      // Gather key metrics
      const [revenue, expenses, newPatients, visits] = await Promise.all([
        env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM income WHERE tenant_id = ? AND date >= ? AND date <= ?`)
          .bind(tenantId, startDate, endDate).first<{ total: number }>(),
        env.DB.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE tenant_id = ? AND date >= ? AND date <= ? AND status = 'approved'`)
          .bind(tenantId, startDate, endDate).first<{ total: number }>(),
        env.DB.prepare(`SELECT COUNT(*) as cnt FROM patients WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?`)
          .bind(tenantId, startDate, endDate).first<{ cnt: number }>(),
        env.DB.prepare(`SELECT COUNT(*) as cnt FROM visits WHERE tenant_id = ? AND visit_date >= ? AND visit_date <= ?`)
          .bind(tenantId, startDate, endDate).first<{ cnt: number }>(),
      ]);

      const totalRevenue = revenue?.total ?? 0;
      const totalExpenses = expenses?.total ?? 0;
      const netProfit = totalRevenue - totalExpenses;

      const template = {
        subject: `📊 Weekly Report — ${tenant.name} (${startDate} → ${endDate})`,
        html: `
          <h2>Weekly Performance Summary</h2>
          <p>Period: <strong>${startDate}</strong> to <strong>${endDate}</strong></p>
          <table style="border-collapse:collapse;width:100%;max-width:500px">
            <tr><td style="padding:8px;border-bottom:1px solid #eee">💰 Revenue</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">৳${totalRevenue.toLocaleString()}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee">📉 Expenses</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">৳${totalExpenses.toLocaleString()}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee">${netProfit >= 0 ? '🟢' : '🔴'} Net Profit</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold;color:${netProfit >= 0 ? '#16a34a' : '#dc2626'}">৳${netProfit.toLocaleString()}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee">🧑‍🤝‍🧑 New Patients</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:bold">${newPatients?.cnt ?? 0}</td></tr>
            <tr><td style="padding:8px;">🏥 Total Visits</td><td style="padding:8px;text-align:right;font-weight:bold">${visits?.cnt ?? 0}</td></tr>
          </table>
          <p style="margin-top:16px;color:#666;font-size:14px">Log in to your dashboard for detailed analytics ↗</p>
        `,
      };

      const emailResult = await sendEmail(env, { to: admin.email, ...template });
      if (emailResult.success) {
        console.log(`Weekly report sent to ${admin.email} for tenant ${tenantId}`);
      } else {
        console.error(`Failed to send weekly report for tenant ${tenantId}:`, emailResult.error);
      }
    }

    console.log('Weekly report generation completed');
  } catch (error) {
    console.error('Error in weekly report generation:', error);
  }
}

/**
 * Daily appointment reminder job.
 * Queries all appointments scheduled for tomorrow (appt_date = date('now', '+1 day'))
 * with status 'scheduled', and sends a reminder email to each patient.
 */
async function sendAppointmentReminders(env: Env): Promise<void> {
  console.log('Running appointment reminders...');

  try {
    const tenants = await env.DB.prepare(
      'SELECT id, name FROM tenants WHERE status = ?'
    ).bind('active').all<{ id: number; name: string }>();

    for (const tenant of tenants.results) {
      const tenantId = tenant.id.toString();

      const appointments = await env.DB.prepare(`
        SELECT a.id, a.appt_date, a.appt_time,
               p.name as patient_name, p.email as patient_email,
               d.name as doctor_name
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id
        LEFT JOIN doctors d ON d.id = a.doctor_id
        WHERE a.tenant_id = ?
          AND a.appt_date = date('now', '+1 day')
          AND a.status = 'scheduled'
      `).bind(tenantId).all<{
        id: number;
        appt_date: string;
        appt_time: string | null;
        patient_name: string;
        patient_email: string | null;
        doctor_name: string | null;
      }>();

      if (appointments.results.length === 0) continue;

      for (const appt of appointments.results) {
        if (!appt.patient_email) continue;

        try {
          const emailContent = EmailTemplates.appointmentReminder({
            patientName: appt.patient_name,
            doctorName: appt.doctor_name || 'Doctor',
            appointmentDate: appt.appt_date,
            appointmentTime: appt.appt_time || 'To be assigned',
            hospitalName: tenant.name,
          });

          const result = await sendEmail(env, {
            to: appt.patient_email,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          });

          if (result.success) {
            console.log(`Reminder sent for appointment ${appt.id} (tenant ${tenantId})`);
          } else {
            console.error(`Failed to send reminder for appointment ${appt.id}:`, result.error);
          }
        } catch (err) {
          console.error(`Error sending reminder for appointment ${appt.id}:`, err);
        }
      }
    }

    console.log('Appointment reminders completed');
  } catch (error) {
    console.error('Error in appointment reminders:', error);
  }
}


