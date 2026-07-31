/**
 * Help content for each HMS module page.
 * Each entry has: title, subtitle, steps (workflow), tips, and shortcut hints.
 * Supports both 'en' and 'bn' (Bangla) languages.
 */

export interface HelpStep {
  icon: string;
  title: string;
  description: string;
}

export interface HelpContent {
  title: string;
  subtitle: string;
  steps: HelpStep[];
  tips?: string[];
}

export type HelpPageKey =
  | 'pharmacy'
  | 'pharmacy_stock'
  | 'pharmacy_invoices'
  | 'pharmacy_invoice_new'
  | 'pharmacy_po'
  | 'pharmacy_grn'
  | 'pharmacy_items'
  | 'patients'
  | 'billing'
  | 'radiology'
  | 'medical_records'
  | 'lab'
  | 'opd'
  | 'ipd'
  | 'nursing'
  | 'appointments'
  | 'hr';

export const helpContent: Record<HelpPageKey, Record<'en' | 'bn', HelpContent>> = {

  // ─── PHARMACY OVERVIEW ───────────────────────────────────────────────────
  pharmacy: {
    en: {
      title: 'Pharmacy Overview',
      subtitle: 'How to manage pharmacy stock, sales & procurement',
      steps: [
        { icon: '📦', title: 'Add Items', description: 'Go to Items to add medicines with generic, category, UoM and reorder level.' },
        { icon: '🛒', title: 'Create Purchase Order', description: 'Click "Create PO" to order from a supplier. Set items, quantities and rates.' },
        { icon: '✅', title: 'Receive Stock (GRN)', description: 'When medicines arrive, go to GRN and create a Goods Receipt against the PO. This adds to your stock.' },
        { icon: '💊', title: 'Dispense via Invoice', description: 'Click "New Invoice" to sell or dispense medicines to a patient. Stock auto-deducts on save.' },
        { icon: '📊', title: 'Monitor Stock', description: 'Use the Stock page to see batch-wise inventory. Low stock and expiry alerts appear on this dashboard.' },
      ],
      tips: [
        'Low Stock alert triggers when available_qty ≤ reorder_level set on the item.',
        'Expiry alert shows batches expiring within 30 days.',
        'Use the Stock filter "কম মজুদ" to see critical items immediately.',
      ],
    },
    bn: {
      title: 'ফার্মেসি ওভারভিউ',
      subtitle: 'ওষুধ মজুদ, বিক্রয় এবং ক্রয় পরিচালনার নির্দেশিকা',
      steps: [
        { icon: '📦', title: 'আইটেম যোগ করুন', description: 'আইটেম পেজে যান এবং জেনেরিক, ক্যাটাগরি, ইউনিট এবং রিঅর্ডার লেভেল সহ ওষুধ যোগ করুন।' },
        { icon: '🛒', title: 'ক্রয় আদেশ তৈরি করুন', description: '"ক্রয় অর্ডার তৈরি করুন" বাটনে ক্লিক করে সরবরাহকারীর কাছে অর্ডার দিন।' },
        { icon: '✅', title: 'মালপত্র গ্রহণ (GRN)', description: 'ওষুধ পৌঁছালে GRN পেজে গিয়ে পণ্য রসিদ তৈরি করুন। এতে স্টক স্বয়ংক্রিয়ভাবে যোগ হবে।' },
        { icon: '💊', title: 'চালানের মাধ্যমে বিতরণ', description: '"নতুন চালান" বাটনে ক্লিক করে রোগীকে ওষুধ বিক্রি বা সরবরাহ করুন। সংরক্ষণে স্টক স্বয়ংক্রিয়ভাবে কাটা যাবে।' },
        { icon: '📊', title: 'মজুদ পর্যবেক্ষণ করুন', description: 'ব্যাচ অনুযায়ী ইনভেন্টরি দেখতে মজুদ পেজ ব্যবহার করুন। কম মজুদ ও মেয়াদ উত্তীর্ণের সতর্কতা এখানে দেখা যাবে।' },
      ],
      tips: [
        'কম মজুদ সতর্কতা তখনই দেখা যায় যখন available_qty ≤ আইটেমে সেট করা reorder_level।',
        'মেয়াদ সতর্কতায় ৩০ দিনের মধ্যে মেয়াদ শেষ হওয়া ব্যাচ দেখা যায়।',
        'জরুরি আইটেম দেখতে মজুদ ফিল্টারে "কম মজুদ" বেছে নিন।',
      ],
    },
  },

  // ─── PHARMACY STOCK ───────────────────────────────────────────────────────
  pharmacy_stock: {
    en: {
      title: 'Stock Ledger',
      subtitle: 'Batch-level inventory management (FEFO order)',
      steps: [
        { icon: '🔍', title: 'Search', description: 'Search by item name, generic name, or batch number.' },
        { icon: '⚠️', title: 'Low Stock Filter', description: 'Click "Low Stock" to only see items below their reorder level.' },
        { icon: '📅', title: 'Expiring Filter', description: 'Click "Expiring" to see batches expiring within 90 days.' },
        { icon: '🔁', title: 'Stock Adjustment', description: 'To correct stock discrepancies (damage, count error), use Stock Adjustment from the action menu.' },
        { icon: '📋', title: 'FEFO Ordering', description: 'Stock is listed First-Expire-First-Out — always use the top batch first to reduce waste.' },
      ],
      tips: [
        'Status badge shows "Low" (amber) when qty ≤ reorder level.',
        'Days shown in the expiry column count from today.',
        'Red badge = expired or ≤30d; Yellow = ≤90d; Green = OK.',
      ],
    },
    bn: {
      title: 'মজুদ খাতা',
      subtitle: 'ব্যাচ-ভিত্তিক ইনভেন্টরি ব্যবস্থাপনা (FEFO ক্রম)',
      steps: [
        { icon: '🔍', title: 'অনুসন্ধান', description: 'আইটেমের নাম, জেনেরিক নাম বা ব্যাচ নম্বর দিয়ে খুঁজুন।' },
        { icon: '⚠️', title: 'কম মজুদ ফিল্টার', description: '"কম মজুদ" বাটনে ক্লিক করলে শুধু রিঅর্ডার লেভেলের নিচে থাকা আইটেমগুলো দেখাবে।' },
        { icon: '📅', title: 'মেয়াদ ফিল্টার', description: '"মেয়াদ শেষ হচ্ছে" বাটনে ক্লিক করলে ৯০ দিনের মধ্যে মেয়াদ শেষ হওয়া ব্যাচ দেখাবে।' },
        { icon: '🔁', title: 'মজুদ সমন্বয়', description: 'ক্ষতি বা গণনা ত্রুটির কারণে মজুদ ঠিক করতে অ্যাকশন মেনু থেকে স্টক অ্যাডজাস্টমেন্ট ব্যবহার করুন।' },
        { icon: '📋', title: 'FEFO ক্রম', description: 'মজুদ First-Expire-First-Out ক্রমে সাজানো — অপচয় কমাতে সবসময় উপরেরটা আগে ব্যবহার করুন।' },
      ],
      tips: [
        'qty ≤ reorder level হলে "কম" (অ্যাম্বার) ব্যাজ দেখা যাবে।',
        'মেয়াদ কলামে আজ থেকে দিন গণনা দেখায়।',
        'লাল ব্যাজ = মেয়াদ শেষ বা ≤৩০ দিন; হলুদ = ≤৯০ দিন; সবুজ = ঠিক আছে।',
      ],
    },
  },

  // ─── PHARMACY INVOICES ───────────────────────────────────────────────────
  pharmacy_invoices: {
    en: {
      title: 'Sales Invoices',
      subtitle: 'Track all pharmacy dispensing and sales',
      steps: [
        { icon: '➕', title: 'New Invoice', description: 'Click "New Invoice" to create a new dispensing record for a patient.' },
        { icon: '🔎', title: 'Search & Filter', description: 'Filter invoices by status: Paid, Partial, Credit. Search by patient name or invoice number.' },
        { icon: '🖨️', title: 'Print Receipt', description: 'Click the print icon on any invoice row to generate a formatted receipt.' },
        { icon: '💳', title: 'Settle Credit', description: 'For credit invoices, go to Settlements to record payment.' },
      ],
      tips: [
        '"Credit" status means the medicine was given but not fully paid.',
        'Use patient billing page for IP/OT charges combined with pharmacy.',
      ],
    },
    bn: {
      title: 'বিক্রয় চালান',
      subtitle: 'সকল ফার্মেসি বিক্রয় ও সরবরাহের রেকর্ড',
      steps: [
        { icon: '➕', title: 'নতুন চালান', description: 'রোগীর জন্য নতুন বিক্রয় রেকর্ড তৈরি করতে "নতুন চালান" বাটনে ক্লিক করুন।' },
        { icon: '🔎', title: 'অনুসন্ধান ও ফিল্টার', description: 'পরিশোধিত, আংশিক, ধারের মাধ্যমে ফিল্টার করুন। রোগীর নাম বা চালান নম্বর দিয়ে খুঁজুন।' },
        { icon: '🖨️', title: 'রসিদ প্রিন্ট', description: 'যেকোনো চালানের পাশে প্রিন্ট আইকনে ক্লিক করে ফরম্যাটেড রসিদ তৈরি করুন।' },
        { icon: '💳', title: 'ধার পরিশোধ', description: 'ধার চালানের পেমেন্ট রেকর্ড করতে সেটেলমেন্ট পেজে যান।' },
      ],
      tips: [
        '"ধার" স্ট্যাটাস মানে ওষুধ দেওয়া হয়েছে কিন্তু পুরো টাকা পাওয়া যায়নি।',
        'ফার্মেসির সাথে আইপি/ওটি চার্জ একসাথে দেখতে রোগী বিলিং পেজ ব্যবহার করুন।',
      ],
    },
  },

  // ─── PHARMACY NEW INVOICE ────────────────────────────────────────────────
  pharmacy_invoice_new: {
    en: {
      title: 'New Invoice',
      subtitle: 'Step-by-step guide to dispensing medicines',
      steps: [
        { icon: '👤', title: 'Select Patient', description: 'Search for the patient by name or ID. For walk-in patients, check "Outdoor/Walk-in".' },
        { icon: '💊', title: 'Add Medicines', description: 'Search for an item by name. Select the batch, enter quantity. Price auto-fills from stock.' },
        { icon: '💰', title: 'Apply Discount', description: 'Enter a flat discount amount or percentage at the bottom of the item list.' },
        { icon: '💳', title: 'Select Payment', description: 'Choose payment mode: Cash, Card, Mobile, or Credit. Enter amount paid.' },
        { icon: '💾', title: 'Save & Print', description: 'Click Save. You can print the receipt immediately after.' },
      ],
      tips: [
        'Stock is deducted immediately on saving the invoice.',
        'If stock is insufficient, the system will warn you before saving.',
        'Credit invoices can be settled later from the Settlements page.',
      ],
    },
    bn: {
      title: 'নতুন চালান',
      subtitle: 'ওষুধ বিক্রির ধাপে ধাপে নির্দেশিকা',
      steps: [
        { icon: '👤', title: 'রোগী নির্বাচন', description: 'নাম বা আইডি দিয়ে রোগী খুঁজুন। বাইরের রোগীর জন্য "আউটডোর/ওয়াক-ইন" চেক করুন।' },
        { icon: '💊', title: 'ওষুধ যোগ করুন', description: 'নাম দিয়ে আইটেম খুঁজুন। ব্যাচ নির্বাচন করুন, পরিমাণ লিখুন। মূল্য স্বয়ংক্রিয়ভাবে পূরণ হবে।' },
        { icon: '💰', title: 'ছাড় প্রয়োগ করুন', description: 'আইটেম তালিকার নিচে ফ্ল্যাট ছাড় বা শতাংশ লিখুন।' },
        { icon: '💳', title: 'পেমেন্ট মাধ্যম নির্বাচন', description: 'নগদ, কার্ড, মোবাইল বা ধার নির্বাচন করুন। পরিশোধিত পরিমাণ লিখুন।' },
        { icon: '💾', title: 'সংরক্ষণ ও প্রিন্ট', description: 'সেভ বাটনে ক্লিক করুন। এরপর সরাসরি রসিদ প্রিন্ট করতে পারবেন।' },
      ],
      tips: [
        'চালান সংরক্ষণের সাথে সাথে মজুদ কেটে যাবে।',
        'মজুদ অপর্যাপ্ত হলে সংরক্ষণের আগে সিস্টেম সতর্ক করবে।',
        'ধার চালান পরে সেটেলমেন্ট পেজ থেকে পরিশোধ করা যাবে।',
      ],
    },
  },

  // ─── PHARMACY PO ────────────────────────────────────────────────────────
  pharmacy_po: {
    en: {
      title: 'Purchase Orders',
      subtitle: 'Manage procurement from suppliers',
      steps: [
        { icon: '➕', title: 'Create PO', description: 'Click "New Purchase Order". Select supplier, add items with quantity and rate.' },
        { icon: '📨', title: 'Send to Supplier', description: 'Once finalized, print or email the PO to the supplier using the print icon.' },
        { icon: '✅', title: 'Receive via GRN', description: 'When stock arrives, create a GRN (Goods Receipt Note) linked to this PO.' },
        { icon: '📋', title: 'Track Status', description: 'PO status: Pending → Partial → Complete. Check here to see outstanding orders.' },
      ],
      tips: [
        'A PO with "Pending" means no goods have been received yet.',
        'You can receive partial quantities across multiple GRNs.',
      ],
    },
    bn: {
      title: 'ক্রয় আদেশ',
      subtitle: 'সরবরাহকারীদের কাছ থেকে ক্রয় পরিচালনা',
      steps: [
        { icon: '➕', title: 'ক্রয় আদেশ তৈরি', description: '"নতুন ক্রয় আদেশ" বাটনে ক্লিক করুন। সরবরাহকারী নির্বাচন করুন, পরিমাণ ও দর সহ আইটেম যোগ করুন।' },
        { icon: '📨', title: 'সরবরাহকারীকে পাঠান', description: 'চূড়ান্ত হলে প্রিন্ট আইকন দিয়ে ক্রয় আদেশ প্রিন্ট বা ইমেইল করুন।' },
        { icon: '✅', title: 'GRN এর মাধ্যমে গ্রহণ', description: 'মাল পৌঁছালে এই PO এর সাথে সংযুক্ত GRN তৈরি করুন।' },
        { icon: '📋', title: 'স্ট্যাটাস ট্র্যাক', description: 'PO স্ট্যাটাস: অপেক্ষমান → আংশিক → সম্পন্ন। মুলতুবি অর্ডার দেখতে এখানে চেক করুন।' },
      ],
      tips: [
        '"অপেক্ষমান" মানে এখনো কোনো মাল গ্রহণ করা হয়নি।',
        'একাধিক GRN এর মাধ্যমে আংশিক পরিমাণ গ্রহণ করা যায়।',
      ],
    },
  },

  // ─── PHARMACY GRN ────────────────────────────────────────────────────────
  pharmacy_grn: {
    en: {
      title: 'Goods Receipt (GRN)',
      subtitle: 'Record received stock from suppliers',
      steps: [
        { icon: '🔗', title: 'Select PO', description: 'Choose the related Purchase Order. Items from the PO auto-fill.' },
        { icon: '📝', title: 'Enter Batch Details', description: 'For each item, enter batch number, expiry date, received quantity and cost price.' },
        { icon: '💲', title: 'Set Selling Price', description: 'Enter MRP and sale price. Margin is auto-calculated.' },
        { icon: '💾', title: 'Save GRN', description: 'Saving the GRN immediately adds items to pharmacy stock with the batch details.' },
      ],
      tips: [
        'Always enter a correct expiry date — it drives FEFO ordering and expiry alerts.',
        'Cost price in GRN is used for profit calculations in reports.',
        'If received qty < ordered qty, the PO status stays "Partial".',
      ],
    },
    bn: {
      title: 'পণ্য রসিদ (GRN)',
      subtitle: 'সরবরাহকারীর কাছ থেকে প্রাপ্ত মজুদ রেকর্ড করুন',
      steps: [
        { icon: '🔗', title: 'PO নির্বাচন', description: 'সংশ্লিষ্ট ক্রয় আদেশ নির্বাচন করুন। PO থেকে আইটেম স্বয়ংক্রিয়ভাবে পূরণ হবে।' },
        { icon: '📝', title: 'ব্যাচ বিবরণ লিখুন', description: 'প্রতিটি আইটেমের জন্য ব্যাচ নম্বর, মেয়াদ শেষের তারিখ, প্রাপ্ত পরিমাণ ও ক্রয় মূল্য লিখুন।' },
        { icon: '💲', title: 'বিক্রয় মূল্য নির্ধারণ', description: 'MRP ও বিক্রয় মূল্য লিখুন। মার্জিন স্বয়ংক্রিয়ভাবে হিসাব হবে।' },
        { icon: '💾', title: 'GRN সংরক্ষণ', description: 'GRN সংরক্ষণ করলে সাথে সাথে ব্যাচের বিবরণ সহ ফার্মেসি মজুদে আইটেম যোগ হয়ে যাবে।' },
      ],
      tips: [
        'সঠিক মেয়াদ শেষের তারিখ দিন — এটি FEFO ক্রম ও মেয়াদ সতর্কতা নিয়ন্ত্রণ করে।',
        'GRN এর ক্রয় মূল্য রিপোর্টে মুনাফা হিসাবে ব্যবহৃত হয়।',
        'প্রাপ্ত পরিমাণ < অর্ডার পরিমাণ হলে PO স্ট্যাটাস "আংশিক" থাকে।',
      ],
    },
  },

  // ─── PHARMACY ITEMS ──────────────────────────────────────────────────────
  pharmacy_items: {
    en: {
      title: 'Item Master',
      subtitle: 'Manage your medicine catalogue',
      steps: [
        { icon: '➕', title: 'Add Item', description: 'Click "Add Item". Fill in name, generic, category, UoM, packing type, and reorder level.' },
        { icon: '⚠️', title: 'Set Reorder Level', description: 'Reorder level is the minimum quantity. When stock drops here, a low stock alert fires.' },
        { icon: '🏷️', title: 'Set Min Stock', description: 'Min stock qty is a harder lower limit — useful for critical medicines.' },
        { icon: '✏️', title: 'Edit Item', description: 'Click the pencil icon on any row to update item details.' },
      ],
      tips: [
        'Item codes (like MED-001) help track items across POs and GRNs.',
        'Generic links to standard drug information via the Generics master.',
        'VAT % on sales is set per item here.',
      ],
    },
    bn: {
      title: 'আইটেম মাস্টার',
      subtitle: 'আপনার ওষুধের তালিকা পরিচালনা করুন',
      steps: [
        { icon: '➕', title: 'আইটেম যোগ করুন', description: '"আইটেম যোগ করুন" বাটনে ক্লিক করুন। নাম, জেনেরিক, ক্যাটাগরি, ইউনিট, প্যাকিং ধরন ও রিঅর্ডার লেভেল পূরণ করুন।' },
        { icon: '⚠️', title: 'রিঅর্ডার লেভেল নির্ধারণ', description: 'রিঅর্ডার লেভেল হলো ন্যূনতম পরিমাণ। মজুদ এখানে নামলে কম মজুদ সতর্কতা আসবে।' },
        { icon: '🏷️', title: 'ন্যূনতম মজুদ নির্ধারণ', description: 'ন্যূনতম মজুদ পরিমাণ একটি কঠোর নিম্ন সীমা — জরুরি ওষুধের জন্য উপকারী।' },
        { icon: '✏️', title: 'আইটেম সম্পাদনা', description: 'আইটেম বিবরণ আপডেট করতে যেকোনো সারির পেন্সিল আইকনে ক্লিক করুন।' },
      ],
      tips: [
        'আইটেম কোড (যেমন MED-001) PO ও GRN জুড়ে আইটেম ট্র্যাক করতে সাহায্য করে।',
        'জেনেরিক মাস্টারের মাধ্যমে মানসম্মত ওষুধ তথ্যের সাথে সংযুক্ত।',
        'বিক্রয়ে ভ্যাট % এখানে প্রতিটি আইটেমে নির্ধারণ করা হয়।',
      ],
    },
  },

  // ─── PATIENTS ────────────────────────────────────────────────────────────
  patients: {
    en: {
      title: 'Patient Registry',
      subtitle: 'Managing patient records and visits',
      steps: [
        { icon: '➕', title: 'Register Patient', description: 'Click "New Patient" to register. Fill in name, date of birth, gender, blood group and contact.' },
        { icon: '🔍', title: 'Search Patient', description: 'Search by name, patient ID or phone number. Results update instantly.' },
        { icon: '📋', title: 'View History', description: 'Click any patient row to view their full medical history, visits, and billing.' },
        { icon: '🏥', title: 'Admit to IPD', description: 'From the patient profile, click "Admit" to create an inpatient admission record.' },
      ],
      tips: ['Patient ID (e.g., P-0001) is auto-generated and unique per tenant.'],
    },
    bn: {
      title: 'রোগী নিবন্ধন',
      subtitle: 'রোগীর রেকর্ড এবং ভিজিট পরিচালনা',
      steps: [
        { icon: '➕', title: 'রোগী নিবন্ধন', description: '"নতুন রোগী" বাটনে ক্লিক করুন। নাম, জন্ম তারিখ, লিঙ্গ, রক্তের গ্রুপ ও যোগাযোগ পূরণ করুন।' },
        { icon: '🔍', title: 'রোগী অনুসন্ধান', description: 'নাম, রোগী আইডি বা ফোন নম্বর দিয়ে খুঁজুন। ফলাফল তাৎক্ষণিকভাবে আপডেট হয়।' },
        { icon: '📋', title: 'ইতিহাস দেখুন', description: 'যেকোনো রোগীর সারিতে ক্লিক করে তাদের পূর্ণ চিকিৎসা ইতিহাস, ভিজিট ও বিলিং দেখুন।' },
        { icon: '🏥', title: 'আইপিডিতে ভর্তি', description: 'রোগীর প্রোফাইল থেকে "ভর্তি" বাটনে ক্লিক করে ইনপেশেন্ট ভর্তি রেকর্ড তৈরি করুন।' },
      ],
      tips: ['রোগী আইডি (যেমন P-0001) স্বয়ংক্রিয়ভাবে তৈরি হয় এবং প্রতিটি হাসপাতালে অনন্য।'],
    },
  },

  // ─── BILLING ─────────────────────────────────────────────────────────────
  billing: {
    en: {
      title: 'Billing',
      subtitle: 'Patient billing, payments and settlements',
      steps: [
        { icon: '➕', title: 'Create Bill', description: 'Click "New Bill". Search for the patient, select services/items and quantities.' },
        { icon: '💰', title: 'Apply Discount', description: 'Enter discount percentage or flat amount. Authorized roles can apply discounts.' },
        { icon: '💳', title: 'Record Payment', description: 'Select payment mode and enter amount. Partial payment creates a credit balance.' },
        { icon: '🖨️', title: 'Print Receipt', description: 'After saving, print the patient-facing money receipt.' },
        { icon: '📊', title: 'View Reports', description: 'Go to Reports → Billing for daily/monthly collection summaries.' },
      ],
      tips: [
        'Discounts above a configured threshold require supervisor approval.',
        'Credit balance is tracked per patient for future billing.',
      ],
    },
    bn: {
      title: 'বিলিং',
      subtitle: 'রোগী বিলিং, পেমেন্ট ও সেটেলমেন্ট',
      steps: [
        { icon: '➕', title: 'বিল তৈরি', description: '"নতুন বিল" বাটনে ক্লিক করুন। রোগী খুঁজুন, সেবা/আইটেম ও পরিমাণ নির্বাচন করুন।' },
        { icon: '💰', title: 'ছাড় প্রয়োগ', description: 'ছাড়ের শতাংশ বা নির্দিষ্ট পরিমাণ লিখুন। অনুমোদিত ভূমিকারা ছাড় দিতে পারেন।' },
        { icon: '💳', title: 'পেমেন্ট রেকর্ড', description: 'পেমেন্ট মাধ্যম নির্বাচন করুন ও পরিমাণ লিখুন। আংশিক পেমেন্টে ক্রেডিট ব্যালেন্স তৈরি হয়।' },
        { icon: '🖨️', title: 'রসিদ প্রিন্ট', description: 'সংরক্ষণের পর রোগীর মানি রসিদ প্রিন্ট করুন।' },
        { icon: '📊', title: 'রিপোর্ট দেখুন', description: 'দৈনিক/মাসিক সংগ্রহের সারাংশের জন্য রিপোর্ট → বিলিং যান।' },
      ],
      tips: [
        'নির্ধারিত সীমার বেশি ছাড়ে সুপারভাইজারের অনুমোদন লাগে।',
        'ক্রেডিট ব্যালেন্স প্রতিটি রোগীর জন্য আলাদাভাবে ট্র্যাক করা হয়।',
      ],
    },
  },

  // ─── RADIOLOGY ────────────────────────────────────────────────────────────
  radiology: {
    en: {
      title: 'Radiology',
      subtitle: 'Managing imaging orders, scanning and reports',
      steps: [
        { icon: '📋', title: 'Order Test', description: 'From the patient profile or OPD, order a radiology test (X-Ray, CT, MRI, etc.).' },
        { icon: '🔬', title: 'Mark Scanned', description: 'When the scan is done, click "Mark Scanned" on the order. Enter scan details.' },
        { icon: '📝', title: 'Enter Report', description: 'Radiologist logs in and enters the interpretation report for each scan.' },
        { icon: '✅', title: 'Verify Report', description: 'Senior radiologist verifies the report. Status changes to "Verified".' },
        { icon: '🖨️', title: 'Print Report', description: 'Print or share the verified report with the referring doctor or patient.' },
      ],
      tips: [
        'PACS tab shows DICOM study links if your imaging system supports it.',
        'Cancelled orders are soft-deleted and kept for audit trail.',
      ],
    },
    bn: {
      title: 'রেডিওলজি',
      subtitle: 'ইমেজিং অর্ডার, স্ক্যান ও রিপোর্ট পরিচালনা',
      steps: [
        { icon: '📋', title: 'পরীক্ষার অর্ডার', description: 'রোগীর প্রোফাইল বা ওপিডি থেকে রেডিওলজি পরীক্ষা (এক্স-রে, সিটি, এমআরআই ইত্যাদি) অর্ডার করুন।' },
        { icon: '🔬', title: 'স্ক্যান সম্পন্ন চিহ্নিত', description: 'স্ক্যান শেষ হলে অর্ডারে "স্ক্যান সম্পন্ন" বাটনে ক্লিক করুন।' },
        { icon: '📝', title: 'রিপোর্ট লিখুন', description: 'রেডিওলজিস্ট লগ ইন করে প্রতিটি স্ক্যানের ব্যাখ্যা রিপোর্ট লিখবেন।' },
        { icon: '✅', title: 'রিপোর্ট যাচাই', description: 'সিনিয়র রেডিওলজিস্ট রিপোর্ট যাচাই করবেন। স্ট্যাটাস "যাচাইকৃত" হয়ে যাবে।' },
        { icon: '🖨️', title: 'রিপোর্ট প্রিন্ট', description: 'যাচাইকৃত রিপোর্ট প্রেরণকারী চিকিৎসক বা রোগীকে প্রিন্ট বা শেয়ার করুন।' },
      ],
      tips: [
        'আপনার ইমেজিং সিস্টেম সমর্থন করলে PACS ট্যাবে DICOM স্টাডি লিঙ্ক দেখা যাবে।',
        'বাতিল অর্ডার সফট-ডিলিট হয় এবং অডিট ট্রেলের জন্য রাখা হয়।',
      ],
    },
  },

  // ─── MEDICAL RECORDS ─────────────────────────────────────────────────────
  medical_records: {
    en: {
      title: 'Medical Records',
      subtitle: 'Surgical, birth, death and certificate management',
      steps: [
        { icon: '🔪', title: 'Operation Notes', description: 'Record surgical details: diagnosis, procedure, anesthesia type, surgeon and outcomes.' },
        { icon: '👶', title: 'Birth Records', description: 'Register newborn births with mother, delivery type, weight and certificate number.' },
        { icon: '⚰️', title: 'Death Records', description: 'Register patient deaths with cause, manner, time and death certificate details.' },
        { icon: '📄', title: 'Referred Cases', description: 'Record referred-in and referred-out cases with referral source and date.' },
        { icon: '🔎', title: 'ICD-10 Coding', description: 'Search ICD-10 codes directly during operation notes for standardized diagnosis coding.' },
      ],
      tips: [
        'Certificate numbers for births and deaths must be unique.',
        'Death certificates require time verification before issue.',
      ],
    },
    bn: {
      title: 'মেডিকেল রেকর্ড',
      subtitle: 'অস্ত্রোপচার, জন্ম, মৃত্যু ও সনদ ব্যবস্থাপনা',
      steps: [
        { icon: '🔪', title: 'অপারেশন নোট', description: 'অস্ত্রোপচারের বিবরণ: রোগ নির্ণয়, পদ্ধতি, অ্যানেস্থেসিয়ার ধরন, সার্জন ও ফলাফল রেকর্ড করুন।' },
        { icon: '👶', title: 'জন্ম রেকর্ড', description: 'মা, প্রসবের ধরন, ওজন ও সনদ নম্বর সহ নবজাতকের জন্ম নিবন্ধন করুন।' },
        { icon: '⚰️', title: 'মৃত্যু রেকর্ড', description: 'কারণ, পদ্ধতি, সময় ও মৃত্যু সনদের বিবরণ সহ রোগীর মৃত্যু নিবন্ধন করুন।' },
        { icon: '📄', title: 'রেফার কেস', description: 'রেফারেল উৎস ও তারিখ সহ রেফার-ইন এবং রেফার-আউট কেস রেকর্ড করুন।' },
        { icon: '🔎', title: 'ICD-10 কোডিং', description: 'অপারেশন নোটে সরাসরি ICD-10 কোড খুঁজুন এবং মানসম্মত রোগ নির্ণয় কোড ব্যবহার করুন।' },
      ],
      tips: [
        'জন্ম ও মৃত্যু সনদ নম্বর অবশ্যই অনন্য হতে হবে।',
        'মৃত্যু সনদ জারির আগে সময় যাচাই প্রয়োজন।',
      ],
    },
  },

  // ─── LAB ─────────────────────────────────────────────────────────────────
  lab: {
    en: {
      title: 'Laboratory',
      subtitle: 'Test orders, results and reporting',
      steps: [
        { icon: '🧪', title: 'Order Test', description: 'Create a lab test order for a patient. Select tests from the test master.' },
        { icon: '🩸', title: 'Collect Sample', description: 'Mark sample as collected. Enter collection time and collector name.' },
        { icon: '📊', title: 'Enter Results', description: 'Technician enters test values. Normal ranges auto-flag abnormal results.' },
        { icon: '✅', title: 'Verify & Report', description: 'Pathologist verifies results and releases the report.' },
        { icon: '🖨️', title: 'Print Report', description: 'Print or share the lab report with the patient or referring doctor.' },
      ],
      tips: ['Abnormal values are automatically highlighted in red/amber.'],
    },
    bn: {
      title: 'ল্যাবরেটরি',
      subtitle: 'পরীক্ষার অর্ডার, ফলাফল ও রিপোর্ট',
      steps: [
        { icon: '🧪', title: 'পরীক্ষার অর্ডার', description: 'রোগীর জন্য ল্যাব পরীক্ষার অর্ডার তৈরি করুন। পরীক্ষা মাস্টার থেকে পরীক্ষা নির্বাচন করুন।' },
        { icon: '🩸', title: 'নমুনা সংগ্রহ', description: 'নমুনা সংগৃহীত হিসেবে চিহ্নিত করুন। সংগ্রহের সময় ও সংগ্রহকারীর নাম লিখুন।' },
        { icon: '📊', title: 'ফলাফল লিখুন', description: 'টেকনিশিয়ান পরীক্ষার মান লেখেন। স্বাভাবিক পরিসর স্বয়ংক্রিয়ভাবে অস্বাভাবিক ফলাফল চিহ্নিত করে।' },
        { icon: '✅', title: 'যাচাই ও রিপোর্ট', description: 'প্যাথোলজিস্ট ফলাফল যাচাই করেন এবং রিপোর্ট প্রকাশ করেন।' },
        { icon: '🖨️', title: 'রিপোর্ট প্রিন্ট', description: 'রোগী বা প্রেরণকারী চিকিৎসককে ল্যাব রিপোর্ট প্রিন্ট বা শেয়ার করুন।' },
      ],
      tips: ['অস্বাভাবিক মান স্বয়ংক্রিয়ভাবে লাল/অ্যাম্বারে হাইলাইট হয়।'],
    },
  },

  // ─── OPD ─────────────────────────────────────────────────────────────────
  opd: {
    en: {
      title: 'OPD / Appointments',
      subtitle: 'Outpatient visits and appointment scheduling',
      steps: [
        { icon: '📅', title: 'Book Appointment', description: 'Select doctor, date and time slot. Assign the patient and confirm.' },
        { icon: '🏥', title: 'Check In', description: 'When patient arrives, check in from the appointment list.' },
        { icon: '👨‍⚕️', title: 'Doctor Consultation', description: 'Doctor views the queue, opens the patient file, records chief complaint and examination.' },
        { icon: '💊', title: 'e-Prescription', description: 'Doctor issues a digital prescription directly that can be sent to pharmacy.' },
        { icon: '💰', title: 'Billing', description: 'After consultation, generate OPD billing for consultation fee and services.' },
      ],
      tips: ['Walk-in patients can be added without a prior appointment.'],
    },
    bn: {
      title: 'ওপিডি / অ্যাপয়েন্টমেন্ট',
      subtitle: 'বহির্বিভাগ ভিজিট ও অ্যাপয়েন্টমেন্ট শিডিউলিং',
      steps: [
        { icon: '📅', title: 'অ্যাপয়েন্টমেন্ট বুক', description: 'চিকিৎসক, তারিখ ও সময় স্লট নির্বাচন করুন। রোগী নির্ধারণ করুন ও নিশ্চিত করুন।' },
        { icon: '🏥', title: 'চেক ইন', description: 'রোগী আসলে অ্যাপয়েন্টমেন্ট তালিকা থেকে চেক ইন করুন।' },
        { icon: '👨‍⚕️', title: 'চিকিৎসক পরামর্শ', description: 'চিকিৎসক সারি দেখেন, রোগীর ফাইল খোলেন, প্রধান সমস্যা ও পরীক্ষার রেকর্ড করেন।' },
        { icon: '💊', title: 'ই-প্রেসক্রিপশন', description: 'চিকিৎসক সরাসরি ডিজিটাল প্রেসক্রিপশন দেন যা ফার্মেসিতে পাঠানো যায়।' },
        { icon: '💰', title: 'বিলিং', description: 'পরামর্শের পর পরামর্শ ফি ও সেবার জন্য ওপিডি বিলিং তৈরি করুন।' },
      ],
      tips: ['ওয়াক-ইন রোগীদের আগের অ্যাপয়েন্টমেন্ট ছাড়াই যোগ করা যায়।'],
    },
  },

  // ─── IPD ─────────────────────────────────────────────────────────────────
  ipd: {
    en: {
      title: 'IPD / Admissions',
      subtitle: 'Inpatient admission, stay, and discharge',
      steps: [
        { icon: '🛏️', title: 'Admit Patient', description: 'Search the patient, select ward/bed, enter admission diagnosis and attending doctor.' },
        { icon: '📋', title: 'Daily Rounds', description: 'Nurses log vitals, medications and observations each shift.' },
        { icon: '💊', title: 'Medication Administration', description: 'Use the MAR (Medication Administration Record) to log each dose given.' },
        { icon: '🏠', title: 'Discharge', description: 'Enter discharge summary, instructions and outcome. Free up the bed automatically.' },
        { icon: '💰', title: 'Final Bill', description: 'Generate the complete IPD bill including ward charges, services and pharmacy.' },
      ],
      tips: ['Length of stay is auto-calculated from admission to discharge date.'],
    },
    bn: {
      title: 'আইপিডি / ভর্তি',
      subtitle: 'ইনপেশেন্ট ভর্তি, থাকা ও ছাড়',
      steps: [
        { icon: '🛏️', title: 'রোগী ভর্তি', description: 'রোগী খুঁজুন, ওয়ার্ড/বেড নির্বাচন করুন, ভর্তির রোগ নির্ণয় ও দায়িত্বপ্রাপ্ত চিকিৎসক লিখুন।' },
        { icon: '📋', title: 'দৈনিক রাউন্ড', description: 'নার্সরা প্রতিটি শিফটে ভাইটাল, ওষুধ ও পর্যবেক্ষণ রেকর্ড করেন।' },
        { icon: '💊', title: 'ওষুধ প্রদান', description: 'প্রতিটি ডোজ প্রদান রেকর্ড করতে MAR (মেডিকেশন অ্যাডমিনিস্ট্রেশন রেকর্ড) ব্যবহার করুন।' },
        { icon: '🏠', title: 'ছাড়', description: 'ছাড়ের সারাংশ, নির্দেশনা ও ফলাফল লিখুন। বেড স্বয়ংক্রিয়ভাবে মুক্ত হবে।' },
        { icon: '💰', title: 'চূড়ান্ত বিল', description: 'ওয়ার্ড চার্জ, সেবা ও ফার্মেসি সহ সম্পূর্ণ আইপিডি বিল তৈরি করুন।' },
      ],
      tips: ['ভর্তি থেকে ছাড়ের তারিখ পর্যন্ত থাকার সময় স্বয়ংক্রিয়ভাবে হিসাব হয়।'],
    },
  },

  // ─── NURSING ─────────────────────────────────────────────────────────────
  nursing: {
    en: {
      title: 'Nursing',
      subtitle: 'Ward management, vitals and care',
      steps: [
        { icon: '📋', title: 'View Patients', description: 'See all admitted patients in your ward. Filter by bed or doctor.' },
        { icon: '❤️', title: 'Record Vitals', description: 'Click a patient to log temperature, BP, pulse, SpO2 and weight.' },
        { icon: '💊', title: 'MAR Administration', description: 'Open the MAR to mark each scheduled medication as given, held, or refused.' },
        { icon: '📝', title: 'Nursing Notes', description: 'Write shift notes, observations, and care plan updates.' },
      ],
      tips: ['Abnormal vitals auto-alert the attending physician.'],
    },
    bn: {
      title: 'নার্সিং',
      subtitle: 'ওয়ার্ড ব্যবস্থাপনা, ভাইটাল ও পরিচর্যা',
      steps: [
        { icon: '📋', title: 'রোগীদের দেখুন', description: 'আপনার ওয়ার্ডে ভর্তি সব রোগী দেখুন। বেড বা চিকিৎসক দিয়ে ফিল্টার করুন।' },
        { icon: '❤️', title: 'ভাইটাল রেকর্ড', description: 'তাপমাত্রা, রক্তচাপ, নাড়ি, SpO2 ও ওজন রেকর্ড করতে রোগীতে ক্লিক করুন।' },
        { icon: '💊', title: 'MAR প্রদান', description: 'প্রতিটি নির্ধারিত ওষুধ দেওয়া, স্থগিত বা প্রত্যাখ্যান হিসেবে চিহ্নিত করতে MAR খুলুন।' },
        { icon: '📝', title: 'নার্সিং নোট', description: 'শিফট নোট, পর্যবেক্ষণ ও পরিচর্যা পরিকল্পনার আপডেট লিখুন।' },
      ],
      tips: ['অস্বাভাবিক ভাইটাল স্বয়ংক্রিয়ভাবে দায়িত্বপ্রাপ্ত চিকিৎসককে সতর্ক করে।'],
    },
  },

  // ─── APPOINTMENTS ────────────────────────────────────────────────────────
  appointments: {
    en: {
      title: 'Appointments',
      subtitle: 'Schedule and manage doctor appointments',
      steps: [
        { icon: '📅', title: 'New Appointment', description: 'Click "+ New" to book. Choose patient, doctor and available time slot.' },
        { icon: '🔍', title: 'Search', description: 'Filter appointments by date, doctor, or patient name.' },
        { icon: '✅', title: 'Confirm / Cancel', description: 'Update status: Scheduled, Confirmed, Completed, or Cancelled.' },
        { icon: '🔁', title: 'Reschedule', description: 'Click the edit icon to change date/time for an existing appointment.' },
      ],
      tips: ['SMS reminders can be enabled in hospital settings.'],
    },
    bn: {
      title: 'অ্যাপয়েন্টমেন্ট',
      subtitle: 'চিকিৎসকের সাক্ষাতের সময়সূচি ও ব্যবস্থাপনা',
      steps: [
        { icon: '📅', title: 'নতুন অ্যাপয়েন্টমেন্ট', description: 'বুক করতে "+ নতুন" এ ক্লিক করুন। রোগী, চিকিৎসক ও উপলব্ধ সময় স্লট নির্বাচন করুন।' },
        { icon: '🔍', title: 'অনুসন্ধান', description: 'তারিখ, চিকিৎসক বা রোগীর নাম দিয়ে অ্যাপয়েন্টমেন্ট ফিল্টার করুন।' },
        { icon: '✅', title: 'নিশ্চিত / বাতিল', description: 'স্ট্যাটাস আপডেট করুন: নির্ধারিত, নিশ্চিত, সম্পন্ন বা বাতিল।' },
        { icon: '🔁', title: 'পুনরায় নির্ধারণ', description: 'বিদ্যমান অ্যাপয়েন্টমেন্টের তারিখ/সময় পরিবর্তন করতে সম্পাদনা আইকনে ক্লিক করুন।' },
      ],
      tips: ['হাসপাতাল সেটিংসে এসএমএস রিমাইন্ডার সক্ষম করা যায়।'],
    },
  },

  // ─── HR ──────────────────────────────────────────────────────────────────
  hr: {
    en: {
      title: 'HR & Staff',
      subtitle: 'Employee management, attendance and payroll',
      steps: [
        { icon: '👤', title: 'Add Employee', description: 'Register new staff with department, designation, join date and salary details.' },
        { icon: '📅', title: 'Attendance', description: 'Mark daily attendance or import from biometric system.' },
        { icon: '💰', title: 'Payroll', description: 'Generate monthly salary with allowances, deductions and tax calculations.' },
        { icon: '📋', title: 'Leave Management', description: 'Approve or reject leave applications. Track leave balances per employee.' },
      ],
      tips: ['Payroll integrates with attendance for automatic day-count calculation.'],
    },
    bn: {
      title: 'এইচআর ও কর্মী',
      subtitle: 'কর্মী ব্যবস্থাপনা, উপস্থিতি ও বেতন',
      steps: [
        { icon: '👤', title: 'কর্মী যোগ', description: 'বিভাগ, পদবি, যোগদানের তারিখ ও বেতনের বিবরণ সহ নতুন কর্মী নিবন্ধন করুন।' },
        { icon: '📅', title: 'উপস্থিতি', description: 'দৈনিক উপস্থিতি চিহ্নিত করুন বা বায়োমেট্রিক সিস্টেম থেকে আমদানি করুন।' },
        { icon: '💰', title: 'বেতন', description: 'ভাতা, কর্তন ও কর হিসাব সহ মাসিক বেতন তৈরি করুন।' },
        { icon: '📋', title: 'ছুটি ব্যবস্থাপনা', description: 'ছুটির আবেদন অনুমোদন বা প্রত্যাখ্যান করুন। প্রতিটি কর্মীর ছুটির ব্যালেন্স ট্র্যাক করুন।' },
      ],
      tips: ['স্বয়ংক্রিয় দিনের হিসাবের জন্য বেতন উপস্থিতির সাথে সংযুক্ত।'],
    },
  },
};
