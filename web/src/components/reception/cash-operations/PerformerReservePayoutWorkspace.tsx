import UnassignedPerformerReservePanel from '../UnassignedPerformerReservePanel';

export default function PerformerReservePayoutWorkspace({
  sessionId,
  availableCash,
  dateFrom,
  dateTo,
  dateRangeError,
  onDateRangeChange,
}: {
  sessionId?: number | null;
  availableCash: number;
  dateFrom: string;
  dateTo: string;
  dateRangeError?: string | null;
  onDateRangeChange: (from: string, to: string) => void;
}) {
  return (
    <UnassignedPerformerReservePanel
      activeCounterId={sessionId}
      expectedCash={availableCash}
      enabled
      dateFrom={dateFrom}
      dateTo={dateTo}
      dateRangeError={dateRangeError}
      onDateRangeChange={onDateRangeChange}
    />
  );
}
