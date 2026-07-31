import Modal from '../shared/Modal';

export interface DoctorDailySummary {
  doctor_id: number | string;
  doctor_name: string;
  patient_count?: number;
  doctor_visit_count?: number;
  doctor_visit_amount?: number;
  test_count?: number;
  test_order_count?: number;
  test_collection_amount?: number;
  commission_amount?: number;
}

interface Props {
  doctor: DoctorDailySummary | null;
  today: string;
  onClose: () => void;
}

function formatCurrency(amount: number): string {
  const n = Number(amount || 0);
  const abs = `৳${Math.abs(n).toLocaleString()}`;
  return n < 0 ? `-${abs}` : abs;
}

export default function DoctorTodayBreakdownModal({ doctor, today, onClose }: Props) {
  if (!doctor) return null;

  const name = doctor.doctor_name ?? 'Unknown doctor';
  const patients = Number(doctor.patient_count || 0);
  const tests = Number(doctor.test_count || doctor.test_order_count || 0);
  const visitAmount = Number(doctor.doctor_visit_amount || 0);
  const testAmount = Number(doctor.test_collection_amount || 0);
  const totalCollection = visitAmount + testAmount;
  const commission = Number(doctor.commission_amount || 0);
  const netIncome = totalCollection - commission;

  return (
    <Modal title={name} onClose={onClose}>
      <p className="text-xs text-[var(--color-text-muted)] -mt-2">Today — {today}</p>

      <div className="space-y-2 text-sm">
        <Row label="Patients seen" value={patients.toString()} />
        <Row label="Tests ordered" value={tests.toString()} />
      </div>

      <div className="border-t border-[var(--color-border)] pt-3 mt-1 space-y-2 text-sm">
        <Row label="Revenue from patients" value={formatCurrency(visitAmount)} />
        <Row label="Revenue from tests" value={formatCurrency(testAmount)} />
        <Row label="Total collection" value={formatCurrency(totalCollection)} bold />
      </div>

      <div className="border-t border-[var(--color-border)] pt-3 space-y-2 text-sm">
        <Row
          label="Commission paid out"
          value={formatCurrency(commission)}
          valueClassName="text-amber-700"
        />
      </div>

      <div className="border-t border-[var(--color-border)] pt-3">
        <Row
          label="Net hospital income"
          value={formatCurrency(netIncome)}
          labelClassName="font-semibold"
          valueClassName={`font-data text-xl font-bold ${netIncome >= 0 ? 'text-emerald-700' : 'text-[var(--color-error)]'}`}
        />
      </div>
    </Modal>
  );
}

function Row({
  label,
  value,
  bold = false,
  labelClassName = '',
  valueClassName = '',
}: {
  label: string;
  value: string;
  bold?: boolean;
  labelClassName?: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-[var(--color-text-secondary)] ${labelClassName}`}>{label}</span>
      <span className={`font-data ${bold ? 'font-semibold' : ''} ${valueClassName}`}>{value}</span>
    </div>
  );
}
