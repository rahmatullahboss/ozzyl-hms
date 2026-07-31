import { printHtml, formatDate } from './printUtils';

export interface DeathCertificateData {
  certificateNo?: string;
  patient: {
    name: string;
    patientCode?: string;
    gender?: string;
    dateOfBirth?: string;
    age?: number;
    address?: string;
    nationalId?: string;
  };
  admissionNo?: string;
  admissionDate?: string;
  dateOfDeath: string;
  timeOfDeath?: string;
  causeOfDeath?: string;
  secondaryCause?: string;
  mannerOfDeath?: string;
  placeOfDeath?: string;
  ward?: string;
  bed?: string;
  certifyingDoctor?: string;
  isMlc?: boolean;
  nextOfKin?: { name?: string; relation?: string; phone?: string };
  hospital?: { name: string; address?: string; phone?: string };
}

export function printDeathCertificate(data: DeathCertificateData): void {
  const html = `
    <div class="flex-between">
      <div>
        <h1>${data.hospital?.name ?? 'Hospital'}</h1>
        ${data.hospital?.address ? `<div class="text-sm">${data.hospital.address}</div>` : ''}
        ${data.hospital?.phone ? `<div class="text-sm">Phone: ${data.hospital.phone}</div>` : ''}
      </div>
      <div class="text-right">
        <h2>DEATH CERTIFICATE</h2>
        ${data.certificateNo ? `<div class="text-sm">Certificate No: <strong>${data.certificateNo}</strong></div>` : ''}
        <div class="text-xs">Date: ${formatDate(new Date().toISOString().split('T')[0])}</div>
      </div>
    </div>
    <div class="double-line"></div>

    <div style="margin-top:10px; padding:8px; border:1px solid #ccc; background:#f9f9f9; font-size:11px; text-align:center">
      This is to certify that the following person expired while under treatment at this hospital.
    </div>

    <h3 style="margin-top:14px">Deceased Information</h3>
    <div class="info-grid" style="margin-top:6px">
      <div class="info-row"><span class="info-label">Full Name:</span><span><strong>${data.patient.name}</strong></span></div>
      ${data.patient.patientCode ? `<div class="info-row"><span class="info-label">Patient ID:</span><span>${data.patient.patientCode}</span></div>` : ''}
      ${data.patient.gender ? `<div class="info-row"><span class="info-label">Gender:</span><span>${data.patient.gender}</span></div>` : ''}
      ${data.patient.dateOfBirth ? `<div class="info-row"><span class="info-label">Date of Birth:</span><span>${formatDate(data.patient.dateOfBirth)}</span></div>` : ''}
      ${data.patient.age !== undefined ? `<div class="info-row"><span class="info-label">Age:</span><span>${data.patient.age} years</span></div>` : ''}
      ${data.patient.address ? `<div class="info-row"><span class="info-label">Address:</span><span>${data.patient.address}</span></div>` : ''}
      ${data.patient.nationalId ? `<div class="info-row"><span class="info-label">National ID:</span><span>${data.patient.nationalId}</span></div>` : ''}
    </div>

    <hr />
    <h3>Death Details</h3>
    <div class="info-grid" style="margin-top:6px">
      <div class="info-row"><span class="info-label">Date of Death:</span><span><strong>${formatDate(data.dateOfDeath)}</strong></span></div>
      ${data.timeOfDeath ? `<div class="info-row"><span class="info-label">Time of Death:</span><span>${data.timeOfDeath}</span></div>` : ''}
      ${data.placeOfDeath ? `<div class="info-row"><span class="info-label">Place of Death:</span><span>${data.placeOfDeath}</span></div>` : ''}
      ${data.ward ? `<div class="info-row"><span class="info-label">Ward / Bed:</span><span>${data.ward}${data.bed ? ` — ${data.bed}` : ''}</span></div>` : ''}
      ${data.admissionNo ? `<div class="info-row"><span class="info-label">Admission No:</span><span>${data.admissionNo}</span></div>` : ''}
      ${data.admissionDate ? `<div class="info-row"><span class="info-label">Admission Date:</span><span>${formatDate(data.admissionDate)}</span></div>` : ''}
    </div>

    <hr />
    <h3>Cause of Death</h3>
    <div class="info-grid" style="margin-top:6px">
      ${data.causeOfDeath ? `<div class="info-row"><span class="info-label">Primary Cause:</span><span>${data.causeOfDeath}</span></div>` : ''}
      ${data.secondaryCause ? `<div class="info-row"><span class="info-label">Secondary Cause:</span><span>${data.secondaryCause}</span></div>` : ''}
      ${data.mannerOfDeath ? `<div class="info-row"><span class="info-label">Manner:</span><span style="text-transform:capitalize">${data.mannerOfDeath}</span></div>` : ''}
      ${data.isMlc ? `<div class="info-row"><span class="info-label">MLC Case:</span><span style="color:red; font-weight:bold">Yes</span></div>` : ''}
    </div>

    ${data.nextOfKin?.name ? `
      <hr />
      <h3>Next of Kin</h3>
      <div class="info-grid" style="margin-top:6px">
        <div class="info-row"><span class="info-label">Name:</span><span>${data.nextOfKin.name}</span></div>
        ${data.nextOfKin.relation ? `<div class="info-row"><span class="info-label">Relation:</span><span style="text-transform:capitalize">${data.nextOfKin.relation}</span></div>` : ''}
        ${data.nextOfKin.phone ? `<div class="info-row"><span class="info-label">Phone:</span><span>${data.nextOfKin.phone}</span></div>` : ''}
      </div>
    ` : ''}

    <div style="margin-top:50px; display:flex; justify-content:space-between">
      <div style="text-align:center">
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">${data.certifyingDoctor ?? 'Certifying Doctor'}</div>
        <div style="font-size:10px; color:#666; margin-top:2px">Name, Signature & Seal</div>
      </div>
      <div style="text-align:center">
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">Hospital Authority</div>
        <div style="font-size:10px; color:#666; margin-top:2px">Stamp & Signature</div>
      </div>
    </div>
  `;

  printHtml(html, `Death Certificate — ${data.patient.name}`);
}
