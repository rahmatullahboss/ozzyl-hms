import {
  BedDouble,
  CalendarDays,
  Clock3,
  FileText,
  Hash,
  Phone,
  Stethoscope,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import type { InvoiceAdmissionInfo, InvoicePatientInfo, InvoicePrintItem } from './types';
import { getInvoiceItemDisplayAmount, getInvoiceItemOriginalAmount, getInvoiceItemRefundLabel } from '../../lib/print/invoiceRefund';

interface DischargeInvoiceBodyProps {
  patient: InvoicePatientInfo;
  admission: InvoiceAdmissionInfo | null;
  items: InvoicePrintItem[];
  money: (amount: number) => string;
  formatDateTime: (date: string) => string;
  labels: {
    patientName: string;
    patientId: string;
    phone: string;
    ageGender: string;
    wardCabin: string;
    bedNo: string;
    consultant: string;
    diagnosis: string;
    admissionDate: string;
    dischargeDate: string;
    stayDuration: string;
    description: string;
    quantity: string;
    rate: string;
    amount: string;
    days: string;
    note: string;
    refundRequested: string;
    refundedPendingApproval: string;
    refunded: string;
  };
}

function empty(value?: string | number | null) {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

function titleCase(value?: string | null) {
  if (!value) return '';
  return value
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stayDuration(admissionDate?: string | null, dischargeDate?: string | null, daysLabel = 'Days') {
  if (!admissionDate || !dischargeDate) return '—';
  const start = new Date(admissionDate).getTime();
  const end = new Date(dischargeDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  const days = Math.max(1, Math.ceil((end - start) / 86_400_000));
  return `${days} ${daysLabel}`;
}

function InfoTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="discharge-info-tile">
      <Icon aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function DischargeInvoiceBody({
  patient,
  admission,
  items,
  money,
  formatDateTime,
  labels,
}: DischargeInvoiceBodyProps) {
  const wardCabin = [admission?.ward_name, titleCase(admission?.bed_type)].filter(Boolean).join(' / ');
  const diagnosis = admission?.diagnosis || admission?.final_diagnosis || admission?.provisional_diagnosis;
  const ageGender = [patient.age, patient.gender].filter(Boolean).join(' / ');

  return (
    <div className="invoice-body discharge-body">
      <section className="discharge-meta invoice-keep-together">
        <InfoTile icon={UserRound} label={labels.patientName} value={empty(patient.name)} />
        <InfoTile icon={Hash} label={labels.patientId} value={empty(patient.code || admission?.admission_no)} />
        <InfoTile icon={Phone} label={labels.phone} value={empty(patient.mobile)} />
        <InfoTile icon={UserRound} label={labels.ageGender} value={empty(ageGender)} />
        <InfoTile icon={BedDouble} label={labels.wardCabin} value={empty(wardCabin)} />
        <InfoTile icon={BedDouble} label={labels.bedNo} value={empty(admission?.bed_number)} />
        <InfoTile icon={Stethoscope} label={labels.consultant} value={empty(admission?.consultant_name)} />
        <InfoTile icon={FileText} label={labels.diagnosis} value={empty(diagnosis)} />
        <InfoTile
          icon={CalendarDays}
          label={labels.admissionDate}
          value={admission?.admission_date ? formatDateTime(admission.admission_date) : '—'}
        />
        <InfoTile
          icon={CalendarDays}
          label={labels.dischargeDate}
          value={admission?.discharge_date ? formatDateTime(admission.discharge_date) : '—'}
        />
        <InfoTile
          icon={Clock3}
          label={labels.stayDuration}
          value={stayDuration(admission?.admission_date, admission?.discharge_date, labels.days)}
        />
      </section>

      <table className="invoice-items-table discharge-items">
        <thead>
          <tr>
            <th className="invoice-col-serial">SL.</th>
            <th>{labels.description}</th>
            <th className="invoice-col-qty">{labels.quantity}</th>
            <th className="invoice-col-amount">{labels.rate}</th>
            <th className="invoice-col-amount">{labels.amount}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const quantity = Number(item.quantity ?? 0) || 0;
            const unitPrice = Number(item.unit_price ?? 0) || 0;
            const originalAmount = getInvoiceItemOriginalAmount(item);
            const netAmount = getInvoiceItemDisplayAmount(item);
            const refundLabel = getInvoiceItemRefundLabel(item, {
              requested: labels.refundRequested,
              pendingApproval: labels.refundedPendingApproval,
              refunded: labels.refunded,
            });
            return (
              <tr key={item.id} className={refundLabel ? 'invoice-item-refunded' : undefined}>
                <td>{index + 1}</td>
                <td>
                  <strong className={refundLabel ? 'invoice-item-description-refunded' : undefined}>{item.description || titleCase(item.item_category)}</strong>
                  {refundLabel ? <small className="invoice-refund-label">{refundLabel}</small> : null}
                  {item.item_category && <small>{titleCase(item.item_category)}</small>}
                </td>
                <td>{quantity}</td>
                <td>{money(unitPrice)}</td>
                <td>
                  {netAmount < originalAmount ? <small className="invoice-original-amount">{money(originalAmount)}</small> : null}
                  <strong>{money(netAmount)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="discharge-note invoice-keep-together">
        <FileText aria-hidden="true" />
        <span>{labels.note}</span>
      </div>
    </div>
  );
}
