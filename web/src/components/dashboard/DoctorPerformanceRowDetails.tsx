import type { DoctorPerformanceRow } from '../../types/executiveDashboard';

const money = (value: number) => `৳${new Intl.NumberFormat('en-BD', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}).format(Number(value || 0))}`;

const count = (value: number) => new Intl.NumberFormat('en-BD', {
  maximumFractionDigits: 0,
}).format(Number(value || 0));

interface DetailItemProps {
  label: string;
  value: string;
}

function DetailItem({ label, value }: DetailItemProps) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2">
      <dt className="text-xs font-medium text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1 break-words font-data text-sm font-semibold text-[var(--color-text-primary)]">{value}</dd>
    </div>
  );
}

interface Props {
  doctor: DoctorPerformanceRow;
}

export default function DoctorPerformanceRowDetails({ doctor }: Props) {
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
      <DetailItem label="Visit collection" value={money(doctor.visitCollection)} />
      <DetailItem label="Test collection" value={money(doctor.testCollection)} />
      <DetailItem label="Discounted tests" value={count(doctor.discountedTests)} />
      <DetailItem label="Test discount" value={money(doctor.testDiscountAmount)} />
      <DetailItem label="Performer reserve" value={money(doctor.performerReserve)} />
      <DetailItem label="Test commission" value={money(doctor.testCommission)} />
      <DetailItem label="Visit commission" value={money(doctor.visitCommission)} />
      <DetailItem label="Earned commission" value={money(doctor.earnedCommission)} />
      <DetailItem label="Doctor waiver" value={money(doctor.doctorWaiver)} />
      <DetailItem label="Other commission" value={money(doctor.otherCommission)} />
    </dl>
  );
}
