import type { ReactNode } from 'react';
import { Hash, Stethoscope, UserRound } from 'lucide-react';
import type { InvoicePatientInfo, InvoicePrintItem } from './types';
import { getInvoiceItemDisplayAmount, getInvoiceItemOriginalAmount, getInvoiceItemRefundLabel } from '../../lib/print/invoiceRefund';

interface DiagnosticMetaItem {
  key: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
}

interface DiagnosticInvoiceBodyProps {
  patient: InvoicePatientInfo;
  referredBy?: string | null;
  items: InvoicePrintItem[];
  money: (amount: number) => string;
  labels: {
    patient: string;
    patientId: string;
    ageGender: string;
    referredBy: string;
    self: string;
    testName: string;
    category: string;
    amount: string;
    refundRequested: string;
    refundedPendingApproval: string;
    refunded: string;
  };
}

export default function DiagnosticInvoiceBody({
  patient,
  referredBy,
  items,
  money,
  labels,
}: DiagnosticInvoiceBodyProps) {
  const ageGender = [patient.age, patient.gender].filter(Boolean).join(' / ');
  const safeReferredBy = referredBy?.trim() || labels.self;
  const patientMobile = patient.mobile?.trim();
  const patientNameValue = patientMobile ? (
    <span className="diagnostic-patient-value">
      <span>{patient.name || '-'}</span>
      <small>{patientMobile}</small>
    </span>
  ) : (patient.name || '-');
  const metaItems: DiagnosticMetaItem[] = [
    {
      key: 'patient-name',
      icon: <UserRound aria-hidden="true" />,
      label: labels.patient,
      value: patientNameValue,
    },
    {
      key: 'patient-id',
      icon: <Hash aria-hidden="true" />,
      label: labels.patientId,
      value: patient.code || '-',
    },
  ];
  if (ageGender) {
    metaItems.push({
      key: 'age-gender',
      icon: <UserRound aria-hidden="true" />,
      label: labels.ageGender,
      value: ageGender,
    });
  }
  metaItems.push({
    key: 'referred-by',
    icon: <Stethoscope aria-hidden="true" />,
    label: labels.referredBy,
    value: safeReferredBy,
  });

  return (
    <div className="invoice-body">
      <section className={`diagnostic-meta diagnostic-meta-count-${metaItems.length} invoice-keep-together`}>
        {metaItems.map((item) => (
          <div key={item.key}>
            {item.icon}
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </section>

      <table className="invoice-items-table diagnostic-items">
        <thead>
          <tr>
            <th className="invoice-col-serial">SL.</th>
            <th>{labels.testName}</th>
            <th className="invoice-col-category">{labels.category}</th>
            <th className="invoice-col-amount">{labels.amount}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const category = item.item_category.toLowerCase();
            const showCategory = !['test', 'lab', 'laboratory'].includes(category);
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
                </td>
                <td>{showCategory ? item.item_category : ''}</td>
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
