/**
 * Email service for Cloudflare Workers (pure fetch, no Node.js deps).
 *
 * Supported providers:
 *   - Brevo transactional email API
 *   - Resend transactional email API
 *   - Stub mode for local/dev when no API key is configured
 *
 * Brevo setup:
 *   1. Verify your sender/domain in Brevo
 *   2. wrangler secret put BREVO_API_KEY
 *   3. Set EMAIL_PROVIDER="brevo" and BREVO_FROM_EMAIL in wrangler.toml vars
 *
 * Resend fallback setup:
 *   1. wrangler secret put RESEND_API_KEY
 *   2. Set EMAIL_PROVIDER="resend" and RESEND_FROM_EMAIL in wrangler.toml vars
 */
import { formatDoctorName } from './doctor-display';

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;           // Plain-text fallback
  replyTo?: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EmailEnv {
  EMAIL_PROVIDER?: 'brevo' | 'resend' | 'stub' | string;
  BREVO_API_KEY?: string;
  BREVO_FROM_EMAIL?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
}

// ─── XSS protection for HTML email templates ───────────────────────────────
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Core send function ───────────────────────────────────────────────────────
// Supports provider selection without requiring Node SMTP packages.

type MailMode = 'brevo' | 'resend' | 'stub';

function resolveMailMode(env: EmailEnv): MailMode {
  const configured = env.EMAIL_PROVIDER?.toLowerCase();
  if (configured === 'brevo' || configured === 'resend' || configured === 'stub') return configured;
  if (env.BREVO_API_KEY) return 'brevo';
  if (env.RESEND_API_KEY) return 'resend';
  return 'stub';
}

function parseEmailAddress(value: string): { email: string; name?: string } {
  const trimmed = value.trim();
  const open = trimmed.lastIndexOf('<');
  const close = trimmed.lastIndexOf('>');
  if (open < 0 || close <= open) return { email: trimmed };
  const name = trimmed.slice(0, open).trim().replace(/^"|"$/g, '');
  const email = trimmed.slice(open + 1, close).trim();
  return { email, ...(name ? { name } : {}) };
}

function toRecipientList(to: string | string[]): Array<{ email: string }> {
  return (Array.isArray(to) ? to : [to]).map((email) => ({ email }));
}

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return await res.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function sendEmail(
  env: EmailEnv,
  payload: EmailPayload
): Promise<EmailResult> {
  const mode = resolveMailMode(env);

  if (mode === 'stub') {
    console.log(`[EMAIL STUB] To: ${payload.to} | Subject: ${payload.subject}`);
    return { success: true, messageId: `stub-${Date.now()}` };
  }

  try {
    if (mode === 'brevo') {
      const apiKey = env.BREVO_API_KEY;
      const from = env.BREVO_FROM_EMAIL || env.RESEND_FROM_EMAIL || 'Ozzyl Health <noreply@hms.app>';
      if (!apiKey) {
        console.error('[EMAIL] Brevo selected but BREVO_API_KEY is missing.');
        return { success: false, error: 'BREVO_API_KEY is missing' };
      }

      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          ['api' + '-key']: apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: parseEmailAddress(from),
          to: toRecipientList(payload.to),
          subject: payload.subject,
          htmlContent: payload.html,
          textContent: payload.text,
          replyTo: payload.replyTo ? parseEmailAddress(payload.replyTo) : undefined,
        }),
      });

      const data = await safeJson(res) as { messageId?: string; message?: string; code?: string };
      if (!res.ok) {
        console.error(`[EMAIL] Brevo error ${res.status}:`, data);
        return { success: false, error: data.message || data.code || `HTTP ${res.status}` };
      }

      return { success: true, messageId: data.messageId };
    }

    const apiKey = env.RESEND_API_KEY;
    const from = env.RESEND_FROM_EMAIL || env.BREVO_FROM_EMAIL || 'Ozzyl Health <noreply@hms.app>';
    if (!apiKey) {
      console.error('[EMAIL] Resend selected but RESEND_API_KEY is missing.');
      return { success: false, error: 'RESEND_API_KEY is missing' };
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        reply_to: payload.replyTo,
      }),
    });

    const data = await safeJson(res) as { id?: string; message?: string; name?: string };

    if (!res.ok) {
      console.error(`[EMAIL] Resend error ${res.status}:`, data);
      return { success: false, error: data.message || `HTTP ${res.status}` };
    }

    return { success: true, messageId: data.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[EMAIL] Send failed:', message);
    return { success: false, error: message };
  }
}

// ─── Email Templates ──────────────────────────────────────────────────────────

function baseLayout(content: string, hospitalName = 'HMS'): string {
  const safeHospital = escapeHtml(hospitalName);
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; background: #f4f6f9; margin: 0; padding: 0; }
    .wrapper { max-width: 600px; margin: 32px auto; }
    .card { background: #fff; border-radius: 8px; padding: 32px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .header { background: #0f766e; color: white; border-radius: 8px 8px 0 0; padding: 20px 32px; margin: -32px -32px 24px; }
    .header h1 { margin: 0; font-size: 20px; }
    .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 24px; }
    .btn { display: inline-block; background: #0f766e; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; }
    .info-row { border-bottom: 1px solid #f3f4f6; padding: 10px 0; }
    .info-row:last-child { border-bottom: none; }
    .label { color: #6b7280; font-size: 13px; }
    .value { font-weight: 600; color: #111827; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header"><h1>🏥 ${safeHospital}</h1></div>
      ${content}
    </div>
    <div class="footer">This is an automated message from ${safeHospital}. Please do not reply.</div>
  </div>
</body>
</html>`.trim();
}

export const EmailTemplates = {

  // ─── Appointment Reminder ────────────────────────────────────────────────
  appointmentReminder({
    patientName,
    doctorName,
    appointmentDate,
    appointmentTime,
    hospitalName,
  }: {
    patientName: string;
    doctorName: string;
    appointmentDate: string;
    appointmentTime: string;
    hospitalName?: string;
  }) {
    const html = baseLayout(`
      <p>Dear <strong>${escapeHtml(patientName)}</strong>,</p>
      <p>This is a reminder for your upcoming appointment:</p>
      <div style="background:#f0fdf4;border-radius:6px;padding:16px;margin:16px 0;">
        <div class="info-row"><span class="label">Doctor</span><br><span class="value">${formatDoctorName(doctorName)}</span></div>
        <div class="info-row"><span class="label">Date</span><br><span class="value">${escapeHtml(appointmentDate)}</span></div>
        <div class="info-row"><span class="label">Time</span><br><span class="value">${escapeHtml(appointmentTime)}</span></div>
      </div>
      <p>Please arrive 10–15 minutes early. If you need to reschedule, contact us as soon as possible.</p>
    `, hospitalName);

    return {
      subject: `Appointment Reminder — ${formatDoctorName(doctorName)} on ${escapeHtml(appointmentDate)}`,
      html,
      text: `Dear ${patientName}, reminder: appointment with ${formatDoctorName(doctorName)} on ${appointmentDate} at ${appointmentTime}.`,
    };
  },

  // ─── Lab Report Ready ────────────────────────────────────────────────────
  labReportReady({
    patientName,
    testName,
    completedDate,
    hospitalName,
  }: {
    patientName: string;
    testName: string;
    completedDate: string;
    hospitalName?: string;
  }) {
    const html = baseLayout(`
      <p>Dear <strong>${escapeHtml(patientName)}</strong>,</p>
      <p>Your lab report is ready for collection:</p>
      <div style="background:#eff6ff;border-radius:6px;padding:16px;margin:16px 0;">
        <div class="info-row"><span class="label">Test</span><br><span class="value">${escapeHtml(testName)}</span></div>
        <div class="info-row"><span class="label">Completed</span><br><span class="value">${escapeHtml(completedDate)}</span></div>
      </div>
      <p>Please visit the hospital to collect your report. Bring this email or your patient ID.</p>
    `, hospitalName);

    return {
      subject: `Lab Report Ready — ${escapeHtml(testName)}`,
      html,
      text: `Dear ${patientName}, your lab report for "${testName}" is ready. Please collect it from the hospital.`,
    };
  },

  // ─── Invoice / Bill ───────────────────────────────────────────────────────
  invoiceSummary({
    patientName,
    invoiceNumber,
    totalAmount,
    paidAmount,
    dueAmount,
    dueDate,
    hospitalName,
  }: {
    patientName: string;
    invoiceNumber: string;
    totalAmount: number;
    paidAmount: number;
    dueAmount: number;
    dueDate?: string;
    hospitalName?: string;
  }) {
    const html = baseLayout(`
      <p>Dear <strong>${escapeHtml(patientName)}</strong>,</p>
      <p>Please find your invoice summary below:</p>
      <div style="background:#fff7ed;border-radius:6px;padding:16px;margin:16px 0;">
        <div class="info-row"><span class="label">Invoice #</span><br><span class="value">${escapeHtml(invoiceNumber)}</span></div>
        <div class="info-row"><span class="label">Total Amount</span><br><span class="value">৳${totalAmount.toLocaleString()}</span></div>
        <div class="info-row"><span class="label">Amount Paid</span><br><span class="value" style="color:#16a34a;">৳${paidAmount.toLocaleString()}</span></div>
        <div class="info-row"><span class="label">Amount Due</span><br><span class="value" style="color:${dueAmount > 0 ? '#dc2626' : '#16a34a'};">৳${dueAmount.toLocaleString()}</span></div>
        ${dueDate ? `<div class="info-row"><span class="label">Due Date</span><br><span class="value">${escapeHtml(dueDate)}</span></div>` : ''}
      </div>
      ${dueAmount > 0 ? '<p>Please settle the outstanding amount at your earliest convenience.</p>' : '<p>Thank you — your account is fully settled.</p>'}
    `, hospitalName);

    return {
      subject: `Invoice ${escapeHtml(invoiceNumber)} — ${dueAmount > 0 ? `৳${dueAmount} Due` : 'Fully Paid'}`,
      html,
      text: `Dear ${patientName}, Invoice ${invoiceNumber}: Total ৳${totalAmount}, Paid ৳${paidAmount}, Due ৳${dueAmount}.`,
    };
  },

  // ─── New User Welcome ────────────────────────────────────────────────────
  welcomeUser({
    name,
    email,
    role,
    hospitalName,
    loginUrl,
  }: {
    name: string;
    email: string;
    role: string;
    hospitalName: string;
    loginUrl: string;
  }) {
    const html = baseLayout(`
      <p>Hello <strong>${escapeHtml(name)}</strong>,</p>
      <p>Your account has been created at <strong>${escapeHtml(hospitalName)}</strong>.</p>
      <div style="background:#f0fdf4;border-radius:6px;padding:16px;margin:16px 0;">
        <div class="info-row"><span class="label">Email</span><br><span class="value">${escapeHtml(email)}</span></div>
        <div class="info-row"><span class="label">Role</span><br><span class="value" style="text-transform:capitalize;">${escapeHtml(role.replace('_', ' '))}</span></div>
      </div>
      <p style="text-align:center;margin-top:24px;">
        <a href="${escapeHtml(loginUrl)}" class="btn">Login to Ozzyl Health</a>
      </p>
      <p style="color:#6b7280;font-size:13px;">If you did not expect this email, please ignore it.</p>
    `, hospitalName);

    return {
      subject: `Welcome to ${escapeHtml(hospitalName)} — Your Account is Ready`,
      html,
      text: `Hello ${name}, your account at ${hospitalName} is ready. Login at: ${loginUrl}`,
    };
  },

  // ─── Magic Link Login ────────────────────────────────────────────────────
  magicLink({
    patientName,
    loginUrl,
    hospitalName,
  }: {
    patientName: string;
    loginUrl: string;
    hospitalName?: string;
  }) {
    const html = baseLayout(`
      <p>Hello <strong>${escapeHtml(patientName)}</strong>,</p>
      <p>Click the button below to access your patient portal. This link expires in 15 minutes.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${escapeHtml(loginUrl)}" class="btn" style="font-size:16px;padding:14px 32px;">Login to Portal</a>
      </p>
      <p style="color:#6b7280;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="color:#6b7280;font-size:12px;word-break:break-all;">${escapeHtml(loginUrl)}</p>
      <p style="color:#6b7280;font-size:13px;">If you did not request this login link, please ignore this email.</p>
    `, hospitalName);

    return {
      subject: `Login to ${escapeHtml(hospitalName || 'Patient Portal')}`,
      html,
      text: `Hello ${patientName}, click this link to login to your patient portal: ${loginUrl} — This link expires in 15 minutes.`,
    };
  },

  // ─── Registration Verification ──────────────────────────────────────────
  verifyRegistration({
    patientName,
    verifyUrl,
    hospitalName,
  }: {
    patientName: string;
    verifyUrl: string;
    hospitalName?: string;
  }) {
    const html = baseLayout(`
      <p>Hello <strong>${escapeHtml(patientName)}</strong>,</p>
      <p>Welcome! Click the button below to verify your email and activate your patient portal account. This link expires in 15 minutes.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${escapeHtml(verifyUrl)}" class="btn" style="font-size:16px;padding:14px 32px;background:#16a34a;">Verify Email &amp; Login</a>
      </p>
      <p style="color:#6b7280;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="color:#6b7280;font-size:12px;word-break:break-all;">${escapeHtml(verifyUrl)}</p>
      <p style="color:#6b7280;font-size:13px;">If you did not create this account, please ignore this email.</p>
    `, hospitalName);

    return {
      subject: `Verify your email — ${escapeHtml(hospitalName || 'Patient Portal')}`,
      html,
      text: `Hello ${patientName}, verify your email to activate your patient portal: ${verifyUrl} — This link expires in 15 minutes.`,
    };
  },

  // ─── Password Reset ────────────────────────────────────────────────────
  passwordReset({
    patientName,
    resetUrl,
    hospitalName,
  }: {
    patientName: string;
    resetUrl: string;
    hospitalName?: string;
  }) {
    const html = baseLayout(`
      <p>Hello <strong>${escapeHtml(patientName)}</strong>,</p>
      <p>We received a request to reset your password. Click the button below to set a new password. This link expires in 1 hour.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${escapeHtml(resetUrl)}" class="btn" style="font-size:16px;padding:14px 32px;">Reset Password</a>
      </p>
      <p style="color:#6b7280;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="color:#6b7280;font-size:12px;word-break:break-all;">${escapeHtml(resetUrl)}</p>
      <p style="color:#6b7280;font-size:13px;">If you did not request a password reset, please ignore this email. Your password will not change.</p>
    `, hospitalName);

    return {
      subject: `Password Reset — ${escapeHtml(hospitalName || 'Patient Portal')}`,
      html,
      text: `Hello ${patientName}, reset your password here: ${resetUrl} — This link expires in 1 hour. If you didn't request this, ignore this email.`,
    };
  },

  // ─── Staff Invitation ──────────────────────────────────────────────────
  staffInvite({
    inviteeName,
    inviterName,
    role,
    hospitalName,
    inviteUrl,
  }: {
    inviteeName?: string;
    inviterName: string;
    role: string;
    hospitalName: string;
    inviteUrl: string;
  }) {
    const greeting = inviteeName
      ? `<p>Hello <strong>${escapeHtml(inviteeName)}</strong>,</p>`
      : `<p>Hello,</p>`;
    const html = baseLayout(`
      ${greeting}
      <p><strong>${escapeHtml(inviterName)}</strong> has invited you to join <strong>${escapeHtml(hospitalName)}</strong> as a <strong>${escapeHtml(role.replace('_', ' '))}</strong>.</p>
      <p>Click the button below to accept your invitation and create your account. This link expires in 7 days.</p>
      <p style="text-align:center;margin:28px 0;">
        <a href="${escapeHtml(inviteUrl)}" class="btn" style="font-size:16px;padding:14px 32px;">Accept Invitation</a>
      </p>
      <p style="color:#6b7280;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:</p>
      <p style="color:#6b7280;font-size:12px;word-break:break-all;">${escapeHtml(inviteUrl)}</p>
      <p style="color:#6b7280;font-size:13px;">If you did not expect this invitation, please ignore this email.</p>
    `, hospitalName);

    return {
      subject: `You've been invited to join ${escapeHtml(hospitalName)}`,
      html,
      text: `You've been invited to join ${hospitalName} as ${role.replace('_', ' ')}. Accept here: ${inviteUrl} — This link expires in 7 days.`,
    };
  },

  // ─── Appointment Cancellation ────────────────────────────────────────────
  appointmentCancellation({
    patientName,
    doctorName,
    appointmentDate,
    hospitalName,
  }: {
    patientName: string;
    doctorName: string;
    appointmentDate: string;
    hospitalName?: string;
  }) {
    const html = baseLayout(`
      <p>Dear <strong>${escapeHtml(patientName)}</strong>,</p>
      <p>Your appointment has been <strong style="color:#dc2626;">cancelled</strong>.</p>
      <div style="background:#fef2f2;border-radius:6px;padding:16px;margin:16px 0;">
        <div class="info-row"><span class="label">Doctor</span><br><span class="value">${formatDoctorName(doctorName)}</span></div>
        <div class="info-row"><span class="label">Date</span><br><span class="value">${escapeHtml(appointmentDate)}</span></div>
      </div>
      <p>If you wish to reschedule, please book a new appointment through the patient portal or contact us.</p>
    `, hospitalName);

    return {
      subject: `Appointment Cancelled — ${formatDoctorName(doctorName)} on ${escapeHtml(appointmentDate)}`,
      html,
      text: `Dear ${patientName}, your appointment with ${formatDoctorName(doctorName)} on ${appointmentDate} has been cancelled. Please rebook if needed.`,
    };
  },

  // ─── Medicine Expiry Alert (internal/staff) ───────────────────────────────
  medicineExpiryAlert({
    medicines,
    hospitalName,
  }: {
    medicines: Array<{ name: string; expiryDate: string; stock: number; batchNo: string }>;
    hospitalName?: string;
  }) {
    const rows = medicines.map(m => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #f3f4f6;">${escapeHtml(m.name)}</td>
        <td style="padding:8px;border-bottom:1px solid #f3f4f6;">${escapeHtml(m.batchNo)}</td>
        <td style="padding:8px;border-bottom:1px solid #f3f4f6;color:#dc2626;font-weight:bold;">${escapeHtml(m.expiryDate)}</td>
        <td style="padding:8px;border-bottom:1px solid #f3f4f6;">${m.stock}</td>
      </tr>`).join('');

    const html = baseLayout(`
      <p>⚠️ The following medicines are expiring within 30 days:</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#fef2f2;">
            <th style="padding:8px;text-align:left;">Medicine</th>
            <th style="padding:8px;text-align:left;">Batch</th>
            <th style="padding:8px;text-align:left;">Expiry</th>
            <th style="padding:8px;text-align:left;">Stock</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px;color:#dc2626;">Please take immediate action to dispose of or return these medicines.</p>
    `, hospitalName);

    return {
      subject: `⚠️ Medicine Expiry Alert — ${medicines.length} item(s) expiring soon`,
      html,
      text: `Medicine expiry alert: ${medicines.map(m => `${m.name} (expires ${m.expiryDate})`).join(', ')}`,
    };
  },
};
