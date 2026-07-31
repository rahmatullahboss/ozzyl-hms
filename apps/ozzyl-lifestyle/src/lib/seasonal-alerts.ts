/**
 * Seasonal Health Alerts for Bangladesh
 *
 * Generates seasonal health insights based on current date and patient symptoms.
 */

import type { Insight } from './daily-insights';

interface SeasonalContext {
  month: number;
  recentSymptoms?: string[];
}

export function getSeasonalAlerts(ctx: SeasonalContext): Insight[] {
  const alerts: Insight[] = [];
  const { month, recentSymptoms = [] } = ctx;

  // Dengue season: June - October
  if (month >= 6 && month <= 10) {
    alerts.push({
      type: 'dengue_season',
      priority: 3,
      title_bn: 'ডেঙ্গু সতর্কতা',
      title_en: 'Dengue Season Alert',
      body_bn: 'ডেঙ্গু মৌসুম চলছে। মশার কামড় থেকে সাবধান থাকুন। জ্বর + শরীর ব্যথা হলে দ্রুত ডাক্তার দেখান।',
      body_en: 'Dengue season is active. Use mosquito repellent. If you get fever + body ache, see a doctor immediately.',
      icon: 'alert-triangle',
    });

    // Fever symptom during dengue season = extra warning
    const hasFever = recentSymptoms.some((s) => s.includes('fever') || s.includes('জ্বর'));
    const hasBodyAche = recentSymptoms.some((s) => s.includes('body_ache') || s.includes('ache') || s.includes('ব্যথা'));

    if (hasFever && hasBodyAche) {
      alerts.push({
        type: 'dengue_warning',
        priority: 1,
        title_bn: '⚠️ ডেঙ্গু পরীক্ষা করান',
        title_en: '⚠️ Get Dengue Test',
        body_bn: 'আপনার জ্বর + শরীর ব্যথা আছে এবং ডেঙ্গু মৌসুম চলছে। NS1 অ্যান্টিজেন পরীক্ষা করান।',
        body_en: 'You have fever + body ache during dengue season. Get an NS1 antigen test.',
        icon: 'alert-triangle',
      });
    }
  }

  // Monsoon: June - September
  if (month >= 6 && month <= 9) {
    alerts.push({
      type: 'monsoon_health',
      priority: 6,
      title_bn: 'বর্ষাকালীন স্বাস্থ্য টিপস',
      title_en: 'Monsoon Health Tips',
      body_bn: 'ফুটানো পানি পান করুন। বাইরের খাবার এড়িয়ে চলুন। হাত ধুতে ভুলবেন না।',
      body_en: 'Drink boiled water. Avoid street food. Wash hands regularly.',
      icon: 'droplets',
    });
  }

  // Winter: November - February
  if (month >= 11 || month <= 2) {
    alerts.push({
      type: 'winter_health',
      priority: 7,
      title_bn: 'শীতকালীন স্বাস্থ্য পরামর্শ',
      title_en: 'Winter Health Tips',
      body_bn: 'ভিটামিন সি সমৃদ্ধ খাবার খান। গরম পানি পান করুন। ফ্লু ভ্যাকসিন নিন।',
      body_en: 'Eat vitamin C rich foods. Drink warm water. Get a flu vaccine.',
      icon: 'thermometer',
    });
  }

  // Heat wave: March - May
  if (month >= 3 && month <= 5) {
    alerts.push({
      type: 'heat_health',
      priority: 5,
      title_bn: 'গরমে সাবধান',
      title_en: 'Heat Safety',
      body_bn: 'প্রচুর পানি পান করুন। রোদে বের হলে টুপি ও সানস্ক্রিন ব্যবহার করুন।',
      body_en: 'Stay hydrated. Wear a hat and use sunscreen when going outside.',
      icon: 'sun',
    });
  }

  return alerts;
}
