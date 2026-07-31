/**
 * pregnancy-utils.ts
 *
 * Utility functions for pregnancy tracking:
 * - Trimester calculation from LMP (last menstrual period)
 * - Due date estimation (Naegele's rule)
 * - Weekly development milestones
 * - Nutrition tips per trimester
 */

export interface PregnancyInfo {
  currentWeek: number;
  currentDay: number;
  trimester: 1 | 2 | 3;
  dueDate: string;          // ISO date
  daysUntilDue: number;
  progressPercent: number;   // 0-100
  babySize: string;
  developmentNote: string;
}

const TOTAL_PREGNANCY_DAYS = 280; // 40 weeks

/**
 * Calculates pregnancy info from the last menstrual period date.
 */
export function getPregnancyInfo(lmpDateStr: string, todayStr?: string): PregnancyInfo | null {
  const lmp = new Date(lmpDateStr);
  const today = todayStr ? new Date(todayStr) : new Date();

  if (isNaN(lmp.getTime())) return null;

  const diffMs = today.getTime() - lmp.getTime();
  const totalDays = Math.floor(diffMs / 86400000);

  if (totalDays < 0 || totalDays > TOTAL_PREGNANCY_DAYS + 14) return null;

  const currentWeek = Math.min(40, Math.floor(totalDays / 7) + 1);
  const currentDay = totalDays % 7;

  // Naegele's rule: LMP + 280 days
  const dueDate = new Date(lmp.getTime() + TOTAL_PREGNANCY_DAYS * 86400000);
  const daysUntilDue = Math.max(0, Math.ceil((dueDate.getTime() - today.getTime()) / 86400000));

  const trimester: 1 | 2 | 3 = currentWeek <= 12 ? 1 : currentWeek <= 27 ? 2 : 3;
  const progressPercent = Math.min(100, Math.round((totalDays / TOTAL_PREGNANCY_DAYS) * 100));

  const { size, note } = getWeeklyMilestone(currentWeek);

  return {
    currentWeek,
    currentDay,
    trimester,
    dueDate: dueDate.toISOString().slice(0, 10),
    daysUntilDue,
    progressPercent,
    babySize: size,
    developmentNote: note,
  };
}

interface Milestone {
  size: string;
  size_bn: string;
  note: string;
  note_bn: string;
}

function getWeeklyMilestone(week: number): Milestone {
  const milestones: Record<number, Milestone> = {
    4: {
      size: 'Poppy seed',
      size_bn: 'পোস্ত দানা',
      note: 'Implantation begins. Avoid alcohol and smoking.',
      note_bn: 'ইমপ্লান্টেশন শুরু হচ্ছে। অ্যালকোহল এবং ধূমপান এড়িয়ে চলুন।',
    },
    8: {
      size: 'Raspberry',
      size_bn: 'রাসবেরি',
      note: 'Heart is beating! All major organs forming.',
      note_bn: 'হৃৎস্পন্দন শুরু হয়েছে! সমস্ত প্রধান অঙ্গ গঠিত হচ্ছে।',
    },
    12: {
      size: 'Lime',
      size_bn: 'লেবু (লাইম)',
      note: 'First trimester complete. Risk of miscarriage drops.',
      note_bn: 'প্রথম ট্রাইমেস্টার সম্পন্ন। গর্ভপাতের ঝুঁকি কমে যায়।',
    },
    16: {
      size: 'Avocado',
      size_bn: 'অ্যাভোকাডো',
      note: 'Baby can hear sounds. Talk and sing!',
      note_bn: 'শিশু শব্দ শুনতে পায়। কথা বলুন এবং গান গাওয়ান!',
    },
    20: {
      size: 'Banana',
      size_bn: 'কলা',
      note: 'Halfway there! You may feel kicks now.',
      note_bn: 'অর্ধেক পথ সম্পন্ন! এখন বাচ্চার লাথি অনুভব করতে পারেন।',
    },
    24: {
      size: 'Corn',
      size_bn: 'ভুট্টা',
      note: 'Lungs developing. Baby responds to light.',
      note_bn: 'ফুসফুস বিকশিত হচ্ছে। শিশু আলোর প্রতি সাড়া দেয়।',
    },
    28: {
      size: 'Eggplant',
      size_bn: 'বেগুন',
      note: 'Third trimester! Baby opens eyes.',
      note_bn: 'তৃতীয় ট্রাইমেস্টার! শিশু চোখ মেলে তাকায়।',
    },
    32: {
      size: 'Coconut',
      size_bn: 'নারকেল',
      note: 'Baby practices breathing. Bones hardening.',
      note_bn: 'শিশু শ্বাস নেওয়ার প্র্যাকটিস করছে। হাড় শক্ত হচ্ছে।',
    },
    36: {
      size: 'Honeydew',
      size_bn: 'হানিনিউ তরমুজ',
      note: 'Baby is nearly full term. Head may engage.',
      note_bn: 'শিশু জন্ম নেওয়ার জন্য প্রায় প্রস্তুত। মাথা নিচে নামতে পারে।',
    },
    40: {
      size: 'Watermelon',
      size_bn: 'তরমুজ',
      note: 'Full term! Baby is ready to meet you.',
      note_bn: 'পূর্ণ মেয়াদ! আপনার সোনামণি আপনার সাথে দেখা করতে প্রস্তুত।',
    },
  };

  // Find the closest milestone at or below current week
  const milestoneWeeks = Object.keys(milestones).map(Number).sort((a, b) => a - b);
  let best = milestoneWeeks[0];
  for (const mw of milestoneWeeks) {
    if (mw <= week) best = mw;
  }

  return milestones[best] ?? {
    size: 'Growing!',
    size_bn: 'বেড়ে উঠছে!',
    note: 'Your baby is developing beautifully.',
    note_bn: 'আপনার সোনামণি খুব সুন্দরভাবে বড় হচ্ছে।',
  };
}

export interface NutritionTip {
  title: string;
  title_bn: string;
  body: string;
  body_bn: string;
  icon: string;
}

export function getPregnancyNutritionTips(trimester: 1 | 2 | 3): NutritionTip[] {
  const tips: Record<number, NutritionTip[]> = {
    1: [
      {
        title: 'Folic Acid',
        title_bn: 'ফলিক এসিড',
        body: 'Take 400mcg folic acid daily to prevent neural tube defects.',
        body_bn: 'নিউরাল টিউব ত্রুটি রোধে দৈনিক ৪০০ মাইক্রোগ্রাম ফলিক এসিড খান।',
        icon: 'pill',
      },
      {
        title: 'Stay Hydrated',
        title_bn: 'পানি পান করুন',
        body: 'Drink at least 8-10 glasses of water daily.',
        body_bn: 'প্রতিদিন কমপক্ষে ৮-১০ গ্লাস পানি পান করুন।',
        icon: 'droplets',
      },
    ],
    2: [
      {
        title: 'Iron-Rich Foods',
        title_bn: 'আয়রন সমৃদ্ধ খাবার',
        body: 'Eat spinach, red meat, and lentils for iron. Blood volume increases 50%.',
        body_bn: 'আয়রনের জন্য পালং শাক, লাল মাংস ও ডাল খান। রক্তের পরিমাণ ৫০% বাড়ে।',
        icon: 'heart',
      },
      {
        title: 'Calcium',
        title_bn: 'ক্যালসিয়াম',
        body: 'Milk, yogurt, and small fish (with bones) for baby\'s bone development.',
        body_bn: 'দুধ, দই এবং ছোট মাছ (কাঁটাসহ) শিশুর হাড় গঠনে সাহায্য করে।',
        icon: 'bone',
      },
    ],
    3: [
      {
        title: 'Omega-3 Fatty Acids',
        title_bn: 'ওমেগা-৩',
        body: 'Eat fish, walnuts, and flaxseed for baby\'s brain development.',
        body_bn: 'মাছ, আখরোট এবং তিসি শিশুর মস্তিষ্ক বিকাশে সাহায্য করে।',
        icon: 'brain',
      },
      {
        title: 'Small Frequent Meals',
        title_bn: 'অল্প অল্প করে বারবার খান',
        body: 'Eat smaller meals more often to manage heartburn and maintain energy.',
        body_bn: 'বুক জ্বালা কমাতে ও শক্তি বজায় রাখতে অল্প অল্প করে বারবার খান।',
        icon: 'utensils',
      },
    ],
  };

  return tips[trimester] ?? [];
}
