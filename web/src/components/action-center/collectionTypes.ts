export type ReceivableAuthorityMode = 'legacy' | 'shadow' | 'canonical';

export type CollectionStatus =
  | 'new'
  | 'contact_due'
  | 'contacted'
  | 'promised'
  | 'disputed'
  | 'escalated'
  | 'write_off_requested'
  | 'closed';

export interface ReceivableSourceRef {
  sourceType: 'invoice';
  legacyBillId?: number;
  canonicalInvoicePublicId?: string;
}

export interface CollectionQueueItem {
  sourceKey: string;
  source: ReceivableSourceRef;
  invoiceNumber: string;
  patientId: number;
  patientName: string;
  patientMobile: string | null;
  currencyCode: string;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  dueMinor: number;
  issuedAtUtc: string;
  financialStatus: 'open' | 'paid' | 'cancelled' | 'reversed';
  caseId: number | null;
  collectionStatus: CollectionStatus;
  assignedTo: number | null;
  nextFollowupAtUtc: string | null;
  promiseDate: string | null;
  promiseAmountMinor: number | null;
  latestNote: string | null;
  lastContactedAtUtc: string | null;
  updatedAtUtc: string | null;
  daysOutstanding: number;
}

export interface CollectionCurrencySummary {
  currencyCode: string;
  totalDueMinor: number;
  totalInvoices: number;
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90PlusMinor: number;
  promisedAmountMinor: number;
  disputedAmountMinor: number;
}

export interface CollectionSummary {
  totalDueMinor: number | null;
  totalInvoices: number;
  currentMinor: number | null;
  days30Minor: number | null;
  days60Minor: number | null;
  days90PlusMinor: number | null;
  followupDue: number;
  promisedAmountMinor: number | null;
  disputedAmountMinor: number | null;
  currencyCode: string | null;
  amountsByCurrency: CollectionCurrencySummary[];
  supportedSourceTypes: ['invoice'];
  authorityMode: ReceivableAuthorityMode;
  shadowMismatchCount: number;
  agingCounts: {
    '0-7': number;
    '8-30': number;
    '31-60': number;
    '60+': number;
  };
}

export interface CollectionListResponse {
  data: {
    items: CollectionQueueItem[];
    summary: CollectionSummary;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

export interface CollectionDetail extends Omit<CollectionQueueItem, 'daysOutstanding'> {
  authorityMode: ReceivableAuthorityMode;
  assignedToName: string | null;
  promiseCurrencyCode: string | null;
  closedAtUtc: string | null;
  createdAtUtc: string | null;
  paymentHref: string | null;
  paymentCapability: 'available' | 'canonical_command_required';
  writeOffRequestCapability: 'available' | 'forbidden' | 'pending' | 'unavailable';
}

export interface CollectionDetailResponse {
  data: CollectionDetail;
}

export interface CollectionEvent {
  id: number;
  eventType: string;
  actorId: number | null;
  actorName: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  createdAtUtc: string;
}

export interface CollectionEventsResponse {
  data: CollectionEvent[];
}
