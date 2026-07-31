import { printHtml, formatDate } from './printUtils';

export interface AdmissionSlipData {
  admissionNo: string;
  admissionDate: string;
  admissionType: string;
  admitSource?: string;
  referralDoctor?: string;
  admissionReason?: string;
  isEmergency?: boolean;
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
  bedType?: string;
  doctor?: string;
  doctorSpecialization?: string;
  provisionalDiagnosis?: string;
  guardian?: { name?: string; phone?: string; relation?: string };
  hospital?: { name: string; address?: string; phone?: string };
}

export function printAdmissionSlip(data: AdmissionSlipData): void {
  const html = `
    <div class="flex-between">
      <div>
        <h1>${data.hospital?.name ?? 'Hospital'}</h1>
        ${data.hospital?.address ? `<div class="text-sm">${data.hospital.address}</div>` : ''}
        ${data.hospital?.phone ? `<div class="text-sm">Phone: ${data.hospital.phone}</div>` : ''}
      </div>
      <div class="text-right">
        <h2>ADMISSION SLIP</h2>
        <div class="text-sm">Admission No: <strong>${data.admissionNo}</strong></div>
        <div class="text-xs">Date: ${formatDate(data.admissionDate?.split('T')[0])}</div>
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
      ${data.patient.address ? `<div class="info-row"><span class="info-label">Address:</span><span>${data.patient.address}</span></div>` : ''}
    </div>

    <hr />
    <h3>Admission Details</h3>
    <div class="info-grid" style="margin-top:6px">
      <div class="info-row"><span class="info-label">Admission Type:</span><span style="text-transform:capitalize">${data.admissionType}</span></div>
      ${data.admitSource ? `<div class="info-row"><span class="info-label">Admit Source:</span><span style="text-transform:capitalize">${data.admitSource.replace(/_/g, ' ')}</span></div>` : ''}
      ${data.isEmergency ? `<div class="info-row"><span class="info-label">Emergency:</span><span>Yes</span></div>` : ''}
      ${data.referralDoctor ? `<div class="info-row"><span class="info-label">Referral Doctor:</span><span>${data.referralDoctor}</span></div>` : ''}
      ${data.ward ? `<div class="info-row"><span class="info-label">Ward:</span><span>${data.ward}</span></div>` : ''}
      ${data.bed ? `<div class="info-row"><span class="info-label">Bed:</span><span>${data.bed}${data.bedType ? ` (${data.bedType})` : ''}</span></div>` : ''}
      ${data.doctor ? `<div class="info-row"><span class="info-label">Attending Doctor:</span><span>${data.doctor}${data.doctorSpecialization ? ` — ${data.doctorSpecialization}` : ''}</span></div>` : ''}
      ${data.admissionReason ? `<div class="info-row"><span class="info-label">Admission Reason:</span><span>${data.admissionReason}</span></div>` : ''}
      ${data.provisionalDiagnosis ? `<div class="info-row"><span class="info-label">Prov. Diagnosis:</span><span>${data.provisionalDiagnosis}</span></div>` : ''}
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
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">Authorized Signature</div>
      </div>
    </div>
  `;

  printHtml(html, `Admission Slip — ${data.admissionNo}`);
}
