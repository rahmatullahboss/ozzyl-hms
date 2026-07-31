import { printHtml, formatDate } from './printUtils';

export interface BirthCertificateData {
  certificateNo?: string;
  baby: {
    name?: string;
    gender?: string;
    birthWeight?: number;
    birthLength?: number;
    apgarScore?: number;
  };
  mother: {
    name: string;
    patientCode?: string;
    age?: number;
    address?: string;
    nationalId?: string;
  };
  father?: {
    name?: string;
    nationalId?: string;
  };
  deliveryDate: string;
  deliveryTime?: string;
  deliveryType?: string;
  placeOfBirth?: string;
  ward?: string;
  bed?: string;
  deliveredBy?: string;
  admissionNo?: string;
  hospital?: { name: string; address?: string; phone?: string };
}

export function printBirthCertificate(data: BirthCertificateData): void {
  const html = `
    <div class="flex-between">
      <div>
        <h1>${data.hospital?.name ?? 'Hospital'}</h1>
        ${data.hospital?.address ? `<div class="text-sm">${data.hospital.address}</div>` : ''}
        ${data.hospital?.phone ? `<div class="text-sm">Phone: ${data.hospital.phone}</div>` : ''}
      </div>
      <div class="text-right">
        <h2>BIRTH CERTIFICATE</h2>
        ${data.certificateNo ? `<div class="text-sm">Certificate No: <strong>${data.certificateNo}</strong></div>` : ''}
        <div class="text-xs">Date: ${formatDate(new Date().toISOString().split('T')[0])}</div>
      </div>
    </div>
    <div class="double-line"></div>

    <div style="margin-top:10px; padding:8px; border:1px solid #ccc; background:#f9f9f9; font-size:11px; text-align:center">
      This is to certify that a live birth has taken place at this hospital as detailed below.
    </div>

    <h3 style="margin-top:14px">Baby Information</h3>
    <div class="info-grid" style="margin-top:6px">
      ${data.baby.name ? `<div class="info-row"><span class="info-label">Baby Name:</span><span><strong>${data.baby.name}</strong></span></div>` : ''}
      ${data.baby.gender ? `<div class="info-row"><span class="info-label">Gender:</span><span>${data.baby.gender}</span></div>` : ''}
      <div class="info-row"><span class="info-label">Date of Birth:</span><span><strong>${formatDate(data.deliveryDate)}</strong></span></div>
      ${data.deliveryTime ? `<div class="info-row"><span class="info-label">Time of Birth:</span><span>${data.deliveryTime}</span></div>` : ''}
      ${data.baby.birthWeight ? `<div class="info-row"><span class="info-label">Birth Weight:</span><span>${data.baby.birthWeight} g</span></div>` : ''}
      ${data.baby.birthLength ? `<div class="info-row"><span class="info-label">Birth Length:</span><span>${data.baby.birthLength} cm</span></div>` : ''}
      ${data.baby.apgarScore !== undefined ? `<div class="info-row"><span class="info-label">APGAR Score:</span><span>${data.baby.apgarScore}</span></div>` : ''}
      ${data.placeOfBirth ? `<div class="info-row"><span class="info-label">Place of Birth:</span><span>${data.placeOfBirth}</span></div>` : ''}
    </div>

    <hr />
    <h3>Mother's Information</h3>
    <div class="info-grid" style="margin-top:6px">
      <div class="info-row"><span class="info-label">Mother's Name:</span><span><strong>${data.mother.name}</strong></span></div>
      ${data.mother.patientCode ? `<div class="info-row"><span class="info-label">Patient ID:</span><span>${data.mother.patientCode}</span></div>` : ''}
      ${data.mother.age ? `<div class="info-row"><span class="info-label">Age:</span><span>${data.mother.age} years</span></div>` : ''}
      ${data.mother.address ? `<div class="info-row"><span class="info-label">Address:</span><span>${data.mother.address}</span></div>` : ''}
      ${data.mother.nationalId ? `<div class="info-row"><span class="info-label">National ID:</span><span>${data.mother.nationalId}</span></div>` : ''}
    </div>

    ${data.father?.name ? `
      <hr />
      <h3>Father's Information</h3>
      <div class="info-grid" style="margin-top:6px">
        <div class="info-row"><span class="info-label">Father's Name:</span><span>${data.father.name}</span></div>
        ${data.father.nationalId ? `<div class="info-row"><span class="info-label">National ID:</span><span>${data.father.nationalId}</span></div>` : ''}
      </div>
    ` : ''}

    <hr />
    <h3>Delivery Details</h3>
    <div class="info-grid" style="margin-top:6px">
      ${data.deliveryType ? `<div class="info-row"><span class="info-label">Delivery Type:</span><span style="text-transform:capitalize">${data.deliveryType}</span></div>` : ''}
      ${data.deliveredBy ? `<div class="info-row"><span class="info-label">Delivered By:</span><span>${data.deliveredBy}</span></div>` : ''}
      ${data.ward ? `<div class="info-row"><span class="info-label">Ward / Bed:</span><span>${data.ward}${data.bed ? ` — ${data.bed}` : ''}</span></div>` : ''}
      ${data.admissionNo ? `<div class="info-row"><span class="info-label">Admission No:</span><span>${data.admissionNo}</span></div>` : ''}
    </div>

    <div style="margin-top:50px; display:flex; justify-content:space-between">
      <div style="text-align:center">
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">${data.deliveredBy ?? 'Attending Doctor'}</div>
        <div style="font-size:10px; color:#666; margin-top:2px">Name, Signature & Seal</div>
      </div>
      <div style="text-align:center">
        <div style="border-top:1px solid #333; width:180px; padding-top:4px; font-size:11px">Hospital Authority</div>
        <div style="font-size:10px; color:#666; margin-top:2px">Stamp & Signature</div>
      </div>
    </div>
  `;

  printHtml(html, `Birth Certificate — ${data.mother.name}`);
}
