import { printHtml, formatDate, escapeHtml } from './printUtils';

export interface DischargeSummaryData {
  admissionNo: string;
  admissionDate: string;
  dischargeDate?: string;
  durationDays: number;
  patient: {
    name: string;
    patientCode?: string;
    ward?: string;
    bed?: string;
    doctor?: string;
  };
  diagnosis?: {
    provisional?: string;
    admission?: string;
    final?: string;
  };
  treatmentSummary?: string;
  investigationSummary?: string;
  medicines?: Array<{
    name: string;
    dose?: string;
    frequency?: string;
    duration?: string;
  }>;
  followUp?: {
    date?: string;
    instructions?: string;
  };
  consultants?: Array<{
    name?: string;
    role?: string;
  }>;
  hospital?: {
    name: string;
    address?: string;
    phone?: string;
  };
}

export function printDischargeSummary(data: DischargeSummaryData): void {
  const diag = data.diagnosis ?? {};

  const diagnosisRows = [
    diag.provisional && `<div class="info-row"><span class="info-label">Provisional:</span><span>${escapeHtml(diag.provisional)}</span></div>`,
    diag.admission && `<div class="info-row"><span class="info-label">Admission:</span><span>${escapeHtml(diag.admission)}</span></div>`,
    diag.final && `<div class="info-row"><span class="info-label">Final:</span><span>${escapeHtml(diag.final)}</span></div>`,
  ].filter(Boolean).join('');

  const medicinesHtml = (data.medicines ?? []).length > 0 ? `
    <hr />
    <h3>Medicines on Discharge</h3>
    <table style="margin-top:6px">
      <thead>
        <tr>
          <th>Name</th>
          <th>Dose</th>
          <th>Frequency</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${(data.medicines ?? []).map(m => `
          <tr>
            <td>${escapeHtml(m.name)}</td>
            <td>${escapeHtml(m.dose ?? '—')}</td>
            <td>${escapeHtml(m.frequency ?? '—')}</td>
            <td>${escapeHtml(m.duration ?? '—')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '';

  const followUp = data.followUp ?? {};
  const followUpHtml = (followUp.date || followUp.instructions) ? `
    <hr />
    <h3>Follow-up</h3>
    <div class="info-grid" style="margin-top:6px">
      ${followUp.date ? `<div class="info-row"><span class="info-label">Date:</span><span>${formatDate(followUp.date)}</span></div>` : ''}
      ${followUp.instructions ? `<div class="info-row"><span class="info-label">Instructions:</span><span>${escapeHtml(followUp.instructions)}</span></div>` : ''}
    </div>
  ` : '';

  const consultantsHtml = (data.consultants ?? []).length > 0 ? `
    <div style="margin-top:40px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:20px">
      ${(data.consultants ?? []).map(c => `
        <div style="text-align:center; min-width:160px">
          <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">
            ${escapeHtml(c.name ?? 'Consultant')}<br/>
            <span style="font-size:10px; color:#666; text-transform:capitalize">${escapeHtml(c.role ?? 'Consultant')}</span>
          </div>
        </div>
      `).join('')}
    </div>
  ` : `
    <div style="margin-top:40px; display:flex; justify-content:space-between">
      <div style="text-align:center">
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">Consultant Signature</div>
      </div>
      <div style="text-align:center">
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">Authorized Signature</div>
      </div>
    </div>
  `;

  const html = `
    <div class="flex-between">
      <div>
        <h1>${escapeHtml(data.hospital?.name ?? 'Hospital')}</h1>
        ${data.hospital?.address ? `<div class="text-sm">${escapeHtml(data.hospital.address)}</div>` : ''}
        ${data.hospital?.phone ? `<div class="text-sm">Phone: ${escapeHtml(data.hospital.phone)}</div>` : ''}
      </div>
      <div class="text-right">
        <h2>DISCHARGE SUMMARY</h2>
        <div class="text-sm">Admission No: <strong>${escapeHtml(data.admissionNo)}</strong></div>
      </div>
    </div>
    <div class="double-line"></div>

    <h3 style="margin-top:10px">Patient Information</h3>
    <div class="info-grid" style="margin-top:6px">
      <div class="info-row"><span class="info-label">Patient Name:</span><span><strong>${escapeHtml(data.patient.name)}</strong></span></div>
      ${data.patient.patientCode ? `<div class="info-row"><span class="info-label">Patient Code:</span><span>${escapeHtml(data.patient.patientCode)}</span></div>` : ''}
      ${data.patient.ward || data.patient.bed ? `<div class="info-row"><span class="info-label">Ward / Bed:</span><span>${escapeHtml(data.patient.ward ?? '')}${data.patient.bed ? ` — ${escapeHtml(data.patient.bed)}` : ''}</span></div>` : ''}
      ${data.patient.doctor ? `<div class="info-row"><span class="info-label">Doctor:</span><span>${escapeHtml(data.patient.doctor)}</span></div>` : ''}
      <div class="info-row"><span class="info-label">Admission Date:</span><span>${formatDate(data.admissionDate?.split('T')[0])}</span></div>
      <div class="info-row"><span class="info-label">Discharge Date:</span><span>${formatDate(data.dischargeDate?.split('T')[0])}</span></div>
      <div class="info-row"><span class="info-label">Duration:</span><span>${data.durationDays} day${data.durationDays !== 1 ? 's' : ''}</span></div>
    </div>

    ${diagnosisRows ? `<hr /><h3>Diagnosis</h3><div class="info-grid" style="margin-top:6px">${diagnosisRows}</div>` : ''}

    ${data.treatmentSummary ? `
      <hr />
      <h3>Treatment Summary</h3>
      <p style="margin-top:6px; white-space:pre-wrap">${escapeHtml(data.treatmentSummary)}</p>
    ` : ''}

    ${data.investigationSummary ? `
      <hr />
      <h3>Investigation Summary</h3>
      <p style="margin-top:6px; white-space:pre-wrap">${escapeHtml(data.investigationSummary)}</p>
    ` : ''}

    ${medicinesHtml}
    ${followUpHtml}
    ${consultantsHtml}
  `;

  printHtml(html, `Discharge Summary — ${data.admissionNo}`);
}
