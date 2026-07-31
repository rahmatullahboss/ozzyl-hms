export type InvoiceCategoryKey =
  | 'consultation'
  | 'lab'
  | 'radiology'
  | 'surgery'
  | 'pharmacy'
  | 'admission'
  | 'service'
  | 'other';

export type InvoiceLang = 'en' | 'bn';
export type InvoiceLayout = 'consultation' | 'diagnostic' | 'generic' | 'discharge';

const CONSULTATION_CATEGORIES = new Set(['doctor_visit', 'consultation', 'opd', 'visit']);
const LAB_TEST_CATEGORIES = new Set(['test', 'lab', 'laboratory', 'pathology']);
const DIAGNOSTIC_CATEGORIES = new Set([...LAB_TEST_CATEGORIES, 'radiology', 'scan', 'imaging']);

const RAW_CATEGORY_MAP: Record<string, InvoiceCategoryKey> = {
  doctor_visit: 'consultation',
  consultation: 'consultation',
  opd: 'consultation',
  visit: 'consultation',
  test: 'lab',
  lab: 'lab',
  laboratory: 'lab',
  pathology: 'lab',
  radiology: 'radiology',
  scan: 'radiology',
  imaging: 'radiology',
  operation: 'surgery',
  surgery: 'surgery',
  procedure: 'surgery',
  medicine: 'pharmacy',
  pharmacy: 'pharmacy',
  admission: 'admission',
  admission_fee: 'admission',
  bed: 'admission',
  bed_charge: 'admission',
  bed_charges: 'admission',
  package: 'admission',
  ipd: 'admission',
  doctor_round: 'service',
  service: 'service',
};

const CATEGORY_PRIORITY: InvoiceCategoryKey[] = [
  'consultation',
  'lab',
  'radiology',
  'surgery',
  'pharmacy',
  'admission',
  'service',
  'other',
];

const LABELS: Record<InvoiceCategoryKey, Record<InvoiceLang, string>> = {
  consultation: { en: 'APPOINTMENT INVOICE', bn: 'অ্যাপয়েন্টমেন্ট ইনভয়েস' },
  lab: { en: 'LABORATORY TEST', bn: 'ল্যাবরেটরি পরীক্ষা' },
  radiology: { en: 'RADIOLOGY', bn: 'রেডিওলজি' },
  surgery: { en: 'SURGERY / PROCEDURE', bn: 'সার্জারি / প্রসিডিউর' },
  pharmacy: { en: 'PHARMACY', bn: 'ফার্মেসি' },
  admission: { en: 'IPD / ADMISSION BILL', bn: 'আইপিডি / ভর্তি বিল' },
  service: { en: 'SERVICE', bn: 'সেবা' },
  other: { en: 'INVOICE', bn: 'রসিদ' },
};

export function getInvoiceBannerLabel(
  items: ReadonlyArray<{ item_category?: string | null }>,
  lang: InvoiceLang,
): string {
  const present = new Set<InvoiceCategoryKey>();
  for (const item of items) {
    const raw = (item.item_category ?? '').toString().trim().toLowerCase();
    if (!raw) continue;
    const key = RAW_CATEGORY_MAP[raw] ?? 'other';
    present.add(key);
  }

  if (present.size === 0) {
    return LABELS.other[lang];
  }

  const ordered = CATEGORY_PRIORITY.filter((k) => present.has(k));
  return ordered.map((k) => LABELS[k][lang]).join(' + ');
}

export function filterLabTestInvoiceItems<T extends { item_category?: string | null }>(
  items: ReadonlyArray<T>,
): T[] {
  return items.filter((item) => {
    const category = (item.item_category ?? '').trim().toLowerCase();
    return LAB_TEST_CATEGORIES.has(category);
  });
}

export function getInvoiceLayout(
  items: ReadonlyArray<{ item_category?: string | null }>,
): InvoiceLayout {
  const categories = items
    .map((item) => (item.item_category ?? '').trim().toLowerCase())
    .filter(Boolean);

  if (categories.length === 0) return 'generic';
  if (categories.every((category) => CONSULTATION_CATEGORIES.has(category))) return 'consultation';
  if (categories.every((category) => DIAGNOSTIC_CATEGORIES.has(category))) return 'diagnostic';
  return 'generic';
}
