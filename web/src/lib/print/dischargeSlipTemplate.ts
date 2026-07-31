import { printHtml, formatDate } from './printUtils';

export interface DischargeSlipData {
  admissionNo: string;
  admissionDate: string;
  dischargeDate: string;
  lengthOfStay: number;
  dischargeCondition?: string;
  dischargeType?: string;
  patient: {
    name: string;
    patientCode?: string;
    gender?: string;
    dateOfBirth?: string;
    mobile?: string;
    bloodGroup?: string;
    address?: string;
  };
  ward?: string;
  bed?: string;
  doctor?: string;
  provisionalDiagnosis?: string;
  finalDiagnosis?: string;
  guardian?: { name?: string; phone?: string; relation?: string };
  hospital?: { name: string; address?: string; phone?: string };
}

export function printDischargeSlip(data: DischargeSlipData): void {
  const html = `
    <div class="flex-between">
      <div>
        <h1>${data.hospital?.name ?? 'Hospital'}</h1>
        ${data.hospital?.address ? `<div class="text-sm">${data.hospital.address}</div>` : ''}
        ${data.hospital?.phone ? `<div class="text-sm">Phone: ${data.hospital.phone}</div>` : ''}
      </div>
      <div class="text-right">
        <h2>DISCHARGE SLIP</h2>
        <div class="text-sm">Admission No: <strong>${data.admissionNo}</strong></div>
        <div class="text-xs">Discharge Date: ${formatDate(data.dischargeDate?.split('T')[0])}</div>
      </div>
    </div>
    <div class="double-line"></div>

    <h3 style="margin-top:10px">Patient Information</h3>
    <div class="info-grid" style="margin-top:6px">
      <div class="info-row"><span class="info-label">Patient Name:</span><span><strong>${data.patient.name}</strong></span></div>
      ${data.patient.patientCode ? `<div class="info-row"><span class="info-label">Patient ID:</span><span>${data.patient.patientCode}</span></div>` : ''}
      ${data.patient.gender ? `<div class="info-row"><span class="info-label">Gender:</span><span>${data.patient.gender}</span></div>` : ''}
      ${data.patient.dateOfBirth ? `<div class="info-row"><span class="info-label">Date of Birth:</span><span>${formatDate(data.patient.dateOfBirth)}</span></div>` : ''}
      ${data.patient.mobile ? `<div class="info-row"><span class="info-label">Mobile:</span><span>${data.patient.mobile}</span></div>` : ''}
      ${data.patient.bloodGroup ? `<div class="info-row"><span class="info-label">Blood Group:</span><span>${data.patient.bloodGroup}</span></div>` : ''}
    </div>

    <hr />
    <h3>Admission & Discharge Details</h3>
    <div class="info-grid" style="margin-top:6px">
      <div class="info-row"><span class="info-label">Admission Date:</span><span>${formatDate(data.admissionDate?.split('T')[0])}</span></div>
      <div class="info-row"><span class="info-label">Discharge Date:</span><span>${formatDate(data.dischargeDate?.split('T')[0])}</span></div>
      <div class="info-row"><span class="info-label">Length of Stay:</span><span>${data.lengthOfStay} day(s)</span></div>
      ${data.ward ? `<div class="info-row"><span class="info-label">Ward / Bed:</span><span>${data.ward}${data.bed ? ` — ${data.bed}` : ''}</span></div>` : ''}
      ${data.doctor ? `<div class="info-row"><span class="info-label">Attending Doctor:</span><span>${data.doctor}</span></div>` : ''}
      ${data.dischargeCondition ? `<div class="info-row"><span class="info-label">Discharge Condition:</span><span>${data.dischargeCondition}</span></div>` : ''}
      ${data.dischargeType ? `<div class="info-row"><span class="info-label">Discharge Type:</span><span>${data.dischargeType}</span></div>` : ''}
    </div>

    <hr />
    <h3>Diagnosis</h3>
    <div class="info-grid" style="margin-top:6px">
      ${data.provisionalDiagnosis ? `<div class="info-row"><span class="info-label">Prov. Diagnosis:</span><span>${data.provisionalDiagnosis}</span></div>` : ''}
      ${data.finalDiagnosis ? `<div class="info-row"><span class="info-label">Final Diagnosis:</span><span>${data.finalDiagnosis}</span></div>` : ''}
    </div>

    ${data.guardian?.name ? `
      <hr />
      <h3>Guardian / Care-of Person</h3>
      <div class="info-grid" style="margin-top:6px">
        <div class="info-row"><span class="info-label">Name:</span><span>${data.guardian.name}</span></div>
        ${data.guardian.phone ? `<div class="info-row"><span class="info-label">Phone:</span><span>${data.guardian.phone}</span></div>` : ''}
        ${data.guardian.relation ? `<div class="info-row"><span class="info-label">Relation:</span><span style="text-transform:capitalize">${data.guardian.relation}</span></div>` : ''}
      </div>
    ` : ''}

    <div style="margin-top:40px; display:flex; justify-content:space-between">
      <div style="text-align:center">
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">Patient/Guardian Signature</div>
      </div>
      <div style="text-align:center">
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">Doctor's Signature</div>
      </div>
    </div>
  `;

  printHtml(html, `Discharge Slip — ${data.admissionNo}`);
}
