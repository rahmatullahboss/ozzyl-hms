import { CalendarDays, Clock3, Hash, MapPin, Phone, Stethoscope, UserRound } from 'lucide-react';
import type { InvoiceAppointmentInfo, InvoicePatientInfo, InvoicePrintItem } from './types';
import { formatDoctorDisplayName } from '../../lib/doctorName';
import { getInvoiceItemDisplayAmount, getInvoiceItemOriginalAmount, getInvoiceItemRefundLabel } from '../../lib/print/invoiceRefund';

interface ConsultationInvoiceBodyProps {
  patient: InvoicePatientInfo;
  appointment: InvoiceAppointmentInfo | null;
  visitSerial: number | null;
  items: InvoicePrintItem[];
  money: (amount: number) => string;
  formatDate: (date: string) => string;
  labels: {
    billTo: string;
    appointmentDetails: string;
    followUp: string;
    patientId: string;
    ageGender: string;
    doctor: string;
    specialty: string;
    department: string;
    appointmentDate: string;
    appointmentTime: string;
    token: string;
    description: string;
    quantity: string;
    amount: string;
    refundRequested: string;
    refundedPendingApproval: string;
    refunded: string;
  };
}

function DetailRow({
  label,
  value,
  testId,
  highlight = false,
}: {
  label: string;
  value?: string | number | null;
  testId?: string;
  highlight?: boolean;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className={`invoice-detail-row${highlight ? ' invoice-token-row' : ''}`} data-testid={testId}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function ConsultationInvoiceBody({
  patient,
  appointment,
  visitSerial,
  items,
  money,
  formatDate,
  labels,
}: ConsultationInvoiceBodyProps) {
  const ageGender = [patient.age, patient.gender].filter(Boolean).join(' / ');
  const normalizedAppointmentType = appointment?.appointmentType?.toLowerCase().replace(/[-\s]/g, '_');
  const isFollowUp = ['old_patient', 'follow_up', 'followup'].includes(normalizedAppointmentType ?? '');
  const doctorDisplayName = formatDoctorDisplayName(appointment?.doctorName);

  return (
    <div className="invoice-body">
      <section className="consultation-summary invoice-keep-together">
        <div className="invoice-summary-column">
          <div className="invoice-section-title"><UserRound aria-hidden="true" /><span>{labels.billTo}</span></div>
          <h3>{patient.name}</h3>
          {patient.address && <p><MapPin aria-hidden="true" />{patient.address}</p>}
          {patient.mobile && <p><Phone aria-hidden="true" />{patient.mobile}</p>}
          {patient.code && <p><Hash aria-hidden="true" />{labels.patientId}: {patient.code}</p>}
          {ageGender && <p><UserRound aria-hidden="true" />{labels.ageGender}: {ageGender}</p>}
        </div>

        <div className="invoice-summary-column consultation-details">
          <div className="invoice-section-title">
            <CalendarDays aria-hidden="true" />
            <span>{labels.appointmentDetails}</span>
            {isFollowUp && <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-bold text-purple-700">{labels.followUp}</span>}
          </div>
          <DetailRow label={labels.doctor} value={doctorDisplayName} />
          <DetailRow label={labels.specialty} value={appointment?.specialty} />
          <DetailRow label={labels.department} value={appointment?.department} />
          <DetailRow label={labels.appointmentDate} value={appointment?.date ? formatDate(appointment.date) : null} />
          <DetailRow label={labels.appointmentTime} value={appointment?.time} />
          <DetailRow label={labels.token} value={visitSerial} testId="appointment-token" highlight />
          {!appointment?.doctorName && <Stethoscope className="invoice-summary-watermark" aria-hidden="true" />}
          {appointment?.time && <Clock3 className="invoice-summary-watermark" aria-hidden="true" />}
        </div>
      </section>

      <table className="invoice-items-table consultation-items">
        <thead>
          <tr>
            <th className="invoice-col-serial">SL.</th>
            <th>{labels.description}</th>
            <th className="invoice-col-qty">{labels.quantity}</th>
            <th className="invoice-col-amount">{labels.amount}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
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
                  <strong className={refundLabel ? 'invoice-item-description-refunded' : undefined}>{item.description || item.item_category}</strong>
                  {refundLabel ? <small className="invoice-refund-label">{refundLabel}</small> : null}
                  {doctorDisplayName && (
                    <small>{`${doctorDisplayName}${appointment?.specialty ? ` · ${appointment.specialty}` : ''}`}</small>
                  )}
                </td>
                <td>{item.quantity}</td>
                <td>
                  {netAmount < originalAmount ? <small className="invoice-original-amount">{money(originalAmount)}</small> : null}
                  <strong>{money(netAmount)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
