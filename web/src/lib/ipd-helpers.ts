import { api } from './apiClient';
import { printAdmissionSlip } from './print/admissionSlipTemplate';
import { printDischargeSlip } from './print/dischargeSlipTemplate';

export function fmt(date: string) {
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function printHtml(title: string, body: string) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(title)}</title><style>
    body{font-family:Arial,sans-serif;padding:24px;color:#111}
    .label{border:1px solid #111;padding:12px;display:inline-block}
    .wrist{width:520px;height:96px;display:flex;align-items:center;gap:16px}
    .barcode{font-family:monospace;border:1px dashed #333;padding:8px}
    h1{font-size:18px;margin:0 0 8px}
    p{margin:3px 0;font-size:13px}
    @media print{button{display:none}}
  </style></head><body>${body}<button onclick="window.print()">Print</button></body></html>`);
  win.document.close();
  win.focus();
}

export function parseMaybeNumber(value: string) {
  return value === '' ? undefined : Number(value);
}

export async function handlePrintAdmissionSlip(a: { id: number; admission_no?: string; admission_date?: string; admission_type?: string; admit_source?: string; referral_doctor?: string; admission_reason?: string; is_emergency?: boolean | number; patient_name?: string; patient_code?: string; ward_name?: string; bed_number?: string; doctor_name?: string; provisional_diagnosis?: string }, t: (k: string, o?: Record<string, unknown>) => string) {
  try {
    const res = await api.get<{ slip: Record<string, unknown> }>(`/api/admissions/${a.id}/slip`);
    const s = res.slip;
    const sv = (v: unknown) => String(v ?? '');
    printAdmissionSlip({
      admissionNo: sv(s.admission_no ?? a.admission_no),
      admissionDate: sv(s.admission_date ?? a.admission_date),
      admissionType: sv(s.admission_type ?? a.admission_type),
      admitSource: sv(s.admit_source ?? a.admit_source),
      referralDoctor: sv(s.referral_doctor ?? a.referral_doctor),
      admissionReason: sv(s.admission_reason ?? a.admission_reason),
      isEmergency: Boolean(s.is_emergency ?? a.is_emergency),
      patient: { name: sv(s.patient_name ?? a.patient_name), patientCode: sv(s.patient_code ?? a.patient_code), gender: sv(s.gender), dateOfBirth: sv(s.date_of_birth), mobile: sv(s.mobile), bloodGroup: sv(s.blood_group), address: sv(s.address) },
      ward: sv(s.ward_name ?? a.ward_name), bed: sv(s.bed_number ?? a.bed_number), bedType: sv(s.bed_type),
      doctor: sv(s.doctor_name ?? a.doctor_name), doctorSpecialization: sv(s.doctor_specialization),
      provisionalDiagnosis: sv(s.provisional_diagnosis ?? a.provisional_diagnosis),
      guardian: { name: sv(s.care_of_name), phone: sv(s.care_of_phone), relation: sv(s.care_of_relation) },
    });
  } catch {
    throw new Error(t('printFailed', { defaultValue: 'Failed to load slip data' }));
  }
}

export async function handlePrintDischargeSlip(a: { id: number; admission_no?: string; admission_date?: string; discharge_date?: string; patient_name?: string; patient_code?: string; ward_name?: string; bed_number?: string; doctor_name?: string; provisional_diagnosis?: string }, t: (k: string, o?: Record<string, unknown>) => string) {
  try {
    const res = await api.get<{ slip: Record<string, unknown> }>(`/api/discharge/${a.id}/slip`);
    const s = res.slip;
    const sv = (v: unknown) => String(v ?? '');
    const admDate = new Date(sv(s.admission_date ?? a.admission_date));
    const disDate = new Date(sv(s.discharge_date ?? a.discharge_date ?? new Date()));
    const los = Math.max(1, Math.ceil((disDate.getTime() - admDate.getTime()) / 86400000));
    printDischargeSlip({
      admissionNo: sv(s.admission_no ?? a.admission_no),
      admissionDate: sv(s.admission_date ?? a.admission_date),
      dischargeDate: sv(s.discharge_date ?? a.discharge_date ?? new Date().toISOString()),
      lengthOfStay: los,
      dischargeCondition: sv(s.discharge_condition_name ?? s.discharge_condition ?? s.summary_discharge_type ?? s.discharge_type),
      patient: { name: sv(s.patient_name ?? a.patient_name), patientCode: sv(s.patient_code ?? a.patient_code), gender: sv(s.gender), dateOfBirth: sv(s.date_of_birth), mobile: sv(s.mobile), bloodGroup: sv(s.blood_group), address: sv(s.address) },
      ward: sv(s.ward_name ?? a.ward_name), bed: sv(s.bed_number ?? a.bed_number),
      doctor: sv(s.doctor_name ?? a.doctor_name),
      provisionalDiagnosis: sv(s.provisional_diagnosis ?? a.provisional_diagnosis),
      finalDiagnosis: sv(s.final_diagnosis),
      guardian: { name: sv(s.care_of_name), phone: sv(s.care_of_phone), relation: sv(s.care_of_relation) },
    });
  } catch {
    throw new Error(t('printFailed', { defaultValue: 'Failed to load slip data' }));
  }
}

export async function handlePrintWristband(a: { id: number; admission_no?: string; patient_name?: string; patient_code?: string; ward_name?: string; bed_number?: string }, t: (k: string, o?: Record<string, unknown>) => string) {
  try {
    const res = await api.get<{ wristband: Record<string, unknown> }>(`/api/admissions/${a.id}/wristband`);
    const w = res.wristband;
    const s = (v: unknown) => String(v ?? '');
    printHtml('IP Wristband', `
      <div class="label wrist">
        <div>
          <h1>${escapeHtml(s(w.patient_name ?? a.patient_name))}</h1>
          <p>${escapeHtml(s(w.patient_code ?? a.patient_code))} · ${escapeHtml(s(w.gender))} · Blood: ${escapeHtml(s(w.blood_group ?? '-'))}</p>
          <p>${escapeHtml(s(w.ward_name ?? a.ward_name))} / ${escapeHtml(s(w.bed_number ?? a.bed_number))} · ${escapeHtml(s(w.admission_no ?? a.admission_no))}</p>
          <p>Allergies: ${escapeHtml(s(w.allergies ?? 'NKA'))}</p>
        </div>
        <div class="barcode">${escapeHtml(s(w.barcode ?? a.admission_no))}</div>
      </div>
    `);
  } catch {
    throw new Error(t('printFailed', { defaultValue: 'Failed to load print data' }));
  }
}

export async function handlePrintSticker(a: { id: number; admission_no?: string; patient_name?: string; patient_code?: string; ward_name?: string; bed_number?: string; doctor_name?: string }, t: (k: string, o?: Record<string, unknown>) => string) {
  try {
    const res = await api.get<{ sticker: Record<string, unknown> }>(`/api/admissions/${a.id}/sticker`);
    const st = res.sticker;
    const s = (v: unknown) => String(v ?? '');
    printHtml('Admission Sticker', `
      <div class="label">
        <h1>${escapeHtml(s(st.patient_name ?? a.patient_name))}</h1>
        <p>${escapeHtml(s(st.patient_code ?? a.patient_code))} · ${escapeHtml(s(st.gender))} · ${escapeHtml(s(st.blood_group))}</p>
        <p>${escapeHtml(s(st.admission_no ?? a.admission_no))} · ${escapeHtml(s(st.ward_name ?? a.ward_name))}/${escapeHtml(s(st.bed_number ?? a.bed_number))}</p>
        <p>${escapeHtml(s(st.doctor_name ?? a.doctor_name))}</p>
      </div>
    `);
  } catch {
    throw new Error(t('printFailed', { defaultValue: 'Failed to load print data' }));
  }
}

export async function handleCertificatePrint(admissionId: string, type: 'birth' | 'death', t: (k: string, o?: Record<string, unknown>) => string) {
  if (!admissionId) throw new Error(t('toast.admissionIdRequired'));
  try {
    const res = await api.get<Record<string, Record<string, unknown>>>(`/api/admissions/${admissionId}/${type}-certificate`);
    const data = res[`${type}_certificate`] ?? res;
    const s = (v: unknown) => String(v ?? '');
    printHtml(`${type} certificate`, `
      <div class="label">
        <h1>${type === 'birth' ? 'Birth Certificate' : 'Death Certificate'}</h1>
        <p>Admission: ${escapeHtml(s(data.admission_no ?? admissionId))}</p>
        <p>Patient: ${escapeHtml(s(data.patient_name))} (${escapeHtml(s(data.patient_code))})</p>
        <p>${type === 'birth' ? 'Baby' : 'Cause'}: ${escapeHtml(s(data.baby_name ?? data.cause_of_death))}</p>
        <p>Date: ${escapeHtml(s(data.birth_date ?? data.date_of_death))} ${escapeHtml(s(data.birth_time ?? data.time_of_death))}</p>
        <p>Certificate No: ${escapeHtml(s(data.certificate_number ?? data.death_certificate_no))}</p>
      </div>
    `);
  } catch {
    throw new Error(type === 'birth' ? t('toast.failedToLoadBirthCert') : t('toast.failedToLoadDeathCert'));
  }
}
