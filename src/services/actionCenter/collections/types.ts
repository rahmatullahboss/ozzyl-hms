import type { D1Database } from '@cloudflare/workers-types';

export type ReceivableAuthorityMode = 'legacy' | 'shadow' | 'canonical';
export type RequestedReceivableAuthorityMode = ReceivableAuthorityMode | null;

export interface ReceivableSourceRef {
  sourceType: 'invoice';
  legacyBillId?: number;
  canonicalInvoicePublicId?: string;
}

export type ReceivableFinancialStatus = 'open' | 'paid' | 'cancelled' | 'reversed';

export interface ReceivableRecord {
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
  financialStatus: ReceivableFinancialStatus;
}

export interface ReceivableAuthorityResolution {
  mode: ReceivableAuthorityMode;
  requestedMode: RequestedReceivableAuthorityMode;
  canonicalSchemaAvailable: boolean;
}

export interface ReceivableAdapterInput {
  db: D1Database;
  tenantId: string;
  patientId?: number;
}

export type CollectionStatus =
  | 'new'
  | 'contact_due'
  | 'contacted'
  | 'promised'
  | 'disputed'
  | 'escalated'
  | 'write_off_requested'
  | 'closed';

export interface CollectionListQuery {
  status?: CollectionStatus | 'active' | 'all';
  assignee?: number;
  followup?: 'due' | 'upcoming' | 'none';
  ageBucket?: '0-7' | '8-30' | '31-60' | '60+';
  minAmountMinor?: number;
  maxAmountMinor?: number;
  search?: string;
  sort?: 'exposure' | 'oldest' | 'followup';
  page: number;
  limit: number;
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

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CollectionQueueRow extends ReceivableRecord {
  sourceKey: string;
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
