import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import {
  closeCommandCenterInvoice,
  openCommandCenterInvoice,
  parsePositiveCommandCenterId,
} from '../../pages/admin/command-center/commandCenterUrlState';

export interface InvoiceInspectorState {
  billId: number | null;
  openInvoice: (billId: number) => void;
  closeInvoice: () => void;
}

export function useInvoiceInspectorState(): InvoiceInspectorState {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawInvoiceId = searchParams.get('invoiceId');
  const parsedInvoiceId = parsePositiveCommandCenterId(rawInvoiceId);

  useEffect(() => {
    if (rawInvoiceId === null || parsedInvoiceId !== undefined) return;
    setSearchParams(closeCommandCenterInvoice(searchParams), { replace: true });
  }, [parsedInvoiceId, rawInvoiceId, searchParams, setSearchParams]);

  const openInvoice = useCallback((billId: number) => {
    if (!Number.isInteger(billId) || billId <= 0) return;
    setSearchParams(openCommandCenterInvoice(searchParams, billId), { replace: false });
  }, [searchParams, setSearchParams]);

  const closeInvoice = useCallback(() => {
    setSearchParams(closeCommandCenterInvoice(searchParams), { replace: false });
  }, [searchParams, setSearchParams]);

  return {
    billId: parsedInvoiceId ?? null,
    openInvoice,
    closeInvoice,
  };
}
