// Script to add data-i18n attributes to my-health.astro
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const filePath = join(__dirname, '../src/pages/my-health.astro');

let content = readFileSync(filePath, 'utf8');

// Define replacements: [search, replacement with data-i18n]
const replacements = [
  // Hero section
  ['Patient-first digital health account', 'data-i18n="myhealth.hero.badge">Patient-first digital health account'],
  ['আপনার সব', 'data-i18n="myhealth.hero.h1.1">আপনার সব'],
  ['হেলথ ডাটা', 'data-i18n="myhealth.hero.h1.highlight">হেলথ ডাটা'],
  ['এক জায়গায় রাখুন', 'data-i18n="myhealth.hero.h1.2">এক জায়গায় রাখুন'],
  ['Ozzyl My Health account খুললে আপনার প্রেসক্রিপশন, টেস্ট রিপোর্ট, হেলথ কার্ড, ভিজিট হিস্ট্রি, uploaded document আর self-reported health data একই patient identity-র নিচে থাকবে।', 'data-i18n="myhealth.hero.p">Ozzyl My Health account খুললে আপনার প্রেসক্রিপশন, টেস্ট রিপোর্ট, হেলথ কার্ড, ভিজিট হিস্ট্রি, uploaded document আর self-reported health data একই patient identity-র নিচে থাকবে।'],
  ['Account খুলুন বা Login করুন', 'data-i18n="myhealth.hero.cta.primary">Account খুলুন বা Login করুন'],
  ['Dashboard খুলুন', 'data-i18n="myhealth.hero.cta.secondary">Dashboard খুলুন'],
  
  // Stats
  ['Account</p>', 'data-i18n="myhealth.stat1">Account</p>'],
  ['Health Card</p>', 'data-i18n="myhealth.stat2">Health Card</p>'],
  ['Access</p>', 'data-i18n="myhealth.stat3">Access</p>'],
  ['Consent</p>', 'data-i18n="myhealth.stat4">Consent</p>'],
  
  // Health card
  ['Global Health Card', 'data-i18n="myhealth.card.title">Global Health Card'],
  ['Active', 'data-i18n="myhealth.card.status">Active'],
  
  // Sync sections
  ['What syncs', 'data-i18n="myhealth.syncs.title">What syncs'],
  ['প্রেসক্রিপশন & মেডিসিন', 'data-i18n="myhealth.syncs.rx">প্রেসক্রিপশন & মেডিসিন'],
  ['ল্যাব রিপোর্টস', 'data-i18n="myhealth.syncs.labs">ল্যাব রিপোর্টস'],
  ['What you add', 'data-i18n="myhealth.adds.title">What you add'],
  ['Vitals & lifestyle', 'data-i18n="myhealth.adds.vitals">Vitals & lifestyle'],
  ['স্ক্যান ডকুমেন্টস', 'data-i18n="myhealth.adds.docs">স্ক্যান ডকুমেন্টস'],
  
  // Bento grid
  ['এক জায়গায় সম্পূর্ণ রেকর্ড', 'data-i18n="myhealth.bento.records.title">এক জায়গায় সম্পূর্ণ রেকর্ড'],
  ['Portable Identity', 'data-i18n="myhealth.bento.portable.title">Portable Identity'],
  ['100% Consent Control', 'data-i18n="myhealth.bento.consent.title">100% Consent Control'],
  ['সঠিক রোগ নির্ণয়, দ্রুত চিকিৎসা', 'data-i18n="myhealth.bento.diagnosis.title">সঠিক রোগ নির্ণয়, দ্রুত চিকিৎসা'],
  ['স্মার্ট লাইফস্টাইল ও হেলথ গাইডেন্স', 'data-i18n="myhealth.bento.ai.title">স্মার্ট লাইফস্টাইল ও হেলথ গাইডেন্স'],
  ['Family Access', 'data-i18n="myhealth.bento.family.title">Family Access'],
  ['AI Integrated', 'data-i18n="myhealth.bento.ai.badge">AI Integrated'],
  
  // Before/After
  ['The Paradigm Shift', 'data-i18n="myhealth.shift.badge">The Paradigm Shift'],
  ['শুধু অ্যাকাউন্ট না, কেয়ার জার্নি হবে নিখুঁত', 'data-i18n="myhealth.shift.h2">শুধু অ্যাকাউন্ট না, কেয়ার জার্নি হবে নিখুঁত'],
  ['পুরোনো কাগজের ফাইল থেকে স্মার্ট ডিজিটাল হেলথ ইকোসিস্টেমে শিফট করুন।', 'data-i18n="myhealth.shift.p">পুরোনো কাগজের ফাইল থেকে স্মার্ট ডিজিটাল হেলথ ইকোসিস্টেমে শিফট করুন।'],
  ['Without My Health', 'data-i18n="myhealth.before.title">Without My Health'],
  ['With My Health Account', 'data-i18n="myhealth.after.title">With My Health Account'],
];

replacements.forEach(([search, replacement]) => {
  content = content.replace(search, replacement);
});

writeFileSync(filePath, content, 'utf8');
console.log('✅ Added data-i18n attributes to my-health.astro');
