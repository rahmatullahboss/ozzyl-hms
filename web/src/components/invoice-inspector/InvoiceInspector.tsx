import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type { InvoiceInspectorResponse } from '../../types/invoiceInspector';
import InvoiceInspectorHeader from './InvoiceInspectorHeader';
import InvoiceSummaryTab from './InvoiceSummaryTab';
import InvoiceItemsTab from './InvoiceItemsTab';
import InvoicePaymentsTab from './InvoicePaymentsTab';
import InvoiceDiscountTab from './InvoiceDiscountTab';
import InvoiceCompensationTab from './InvoiceCompensationTab';
import InvoiceAuditTab from './InvoiceAuditTab';

interface Props {
  billId: number;
  onClose: () => void;
}

const INSPECTOR_TABS = [
  { value: 'summary', label: 'Summary' },
  { value: 'items', label: 'Items / Tests' },
  { value: 'payments', label: 'Payments' },
  { value: 'discounts', label: 'Discount / Referral' },
  { value: 'compensation', label: 'Compensation' },
  { value: 'audit', label: 'Audit' },
] as const;

type InvoiceInspectorTab = (typeof INSPECTOR_TABS)[number]['value'];

function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

export default function InvoiceInspector({ billId, onClose }: Props) {
  const sheetRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<InvoiceInspectorTab>('summary');
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const query = useApiQuery<InvoiceInspectorResponse>(
    queryKeys.billing.invoiceInspector(billId),
    `/api/billing/${billId}/inspector`,
    { enabled: Number.isInteger(billId) && billId > 0, placeholderData: undefined },
  );

  useEffect(() => {
    setActiveTab('summary');
  }, [billId]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => !element.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [billId]);

  const invoiceNo = query.data?.summary.invoiceNo || `BILL-${billId}`;
  const status = errorStatus(query.error);

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % INSPECTOR_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = INSPECTOR_TABS.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(INSPECTOR_TABS[nextIndex].value);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  };

  const renderEvidenceTab = (data: InvoiceInspectorResponse): ReactNode => {
    switch (activeTab) {
      case 'items': return <InvoiceItemsTab items={data.items} />;
      case 'payments': return <InvoicePaymentsTab payments={data.payments} deposits={data.deposits} />;
      case 'discounts': return <InvoiceDiscountTab discounts={data.discounts} />;
      case 'compensation': return <InvoiceCompensationTab compensation={data.compensation} />;
      case 'audit': return <InvoiceAuditTab audit={data.audit} />;
      default: return <InvoiceSummaryTab data={data} />;
    }
  };

  let content: ReactNode;
  if (query.isLoading || query.isPlaceholderData) {
    content = (
      <div className="space-y-3" aria-label="Loading invoice inspector">
        <div className="skeleton h-28 rounded-xl" />
        <div className="skeleton h-48 rounded-xl" />
        <div className="skeleton h-24 rounded-xl" />
      </div>
    );
  } else if (query.isError && status === 404) {
    content = <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Invoice {billId} was not found.</div>;
  } else if (query.isError && (status === 401 || status === 403)) {
    content = <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">You do not have permission to view this invoice.</div>;
  } else if (query.isError) {
    content = (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-semibold">Unable to load invoice evidence.</p>
        <p className="mt-1">Check the connection and try again.</p>
        <button type="button" className="btn-secondary mt-3 min-h-11 gap-2" aria-label="Retry invoice inspector" onClick={() => { void query.refetch(); }}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
        </button>
      </div>
    );
  } else if (!query.data) {
    content = <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Invoice evidence is unavailable.</div>;
  } else {
    content = (
      <>
        {query.data.warnings.length > 0 ? (
          <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">Some invoice sources are partial</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">{query.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </div>
            </div>
          </div>
        ) : null}
        <div className="-mx-4 mb-4 overflow-x-auto border-y border-[var(--color-border)] px-3 sm:-mx-5" role="tablist" aria-label="Invoice evidence type">
          <div className="flex min-w-max gap-1 py-2">
            {INSPECTOR_TABS.map((tab, index) => (
              <button
                key={tab.value}
                id={`invoice-tab-${tab.value}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.value}
                aria-controls={`invoice-panel-${tab.value}`}
                tabIndex={activeTab === tab.value ? 0 : -1}
                className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${activeTab === tab.value ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}`}
                onClick={() => setActiveTab(tab.value)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div id={`invoice-panel-${activeTab}`} role="tabpanel" aria-labelledby={`invoice-tab-${activeTab}`} tabIndex={0}>
          {renderEvidenceTab(query.data)}
        </div>
      </>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-black/50 backdrop-blur-sm sm:p-4">
      <section ref={sheetRef} data-testid="invoice-inspector-sheet" role="dialog" aria-modal="true" aria-label={`Invoice inspector ${invoiceNo}`} className="flex min-h-dvh w-full max-w-none flex-col overflow-hidden bg-[var(--color-bg-card)] shadow-2xl sm:my-auto sm:h-[min(92vh,900px)] sm:min-h-0 sm:max-w-5xl sm:rounded-2xl">
        <InvoiceInspectorHeader invoiceNo={invoiceNo} status={query.data?.summary.status ?? 'loading'} actions={query.data?.actions ?? {}} closeButtonRef={closeButtonRef} onClose={onClose} />
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-5">{content}</div>
      </section>
    </div>
  );
}
