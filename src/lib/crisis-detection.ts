/**
 * Crisis Detection
 *
 * Detects crisis keywords in user messages to the AI buddy.
 * When detected, shows emergency resources instead of normal AI response.
 *
 * Bangladesh helplines:
 *   - Kaan Pete Roi: 01779-554391 (mental health)
 *   - National Emergency: 999
 */

const CRISIS_KEYWORDS_EN = [
  'suicide', 'kill myself', 'want to die', 'end my life', 'self harm',
  'self-harm', 'cutting myself', 'hurt myself', 'no reason to live',
  'better off dead', 'can\'t go on', 'overdose',
];

const CRISIS_KEYWORDS_BN = [
  'আত্মহত্যা', 'মরে যেতে চাই', 'বেঁচে থাকতে চাই না', 'নিজেকে শেষ করতে চাই',
  'নিজেকে কাটা', 'মরে গেলে ভালো হতো', 'বাঁচতে চাই না',
];

export interface CrisisResponse {
  isCrisis: boolean;
  message_bn: string;
  message_en: string;
  helplines: Array<{ name: string; number: string; description_bn: string; description_en: string }>;
}

export function detectCrisis(text: string): CrisisResponse | null {
  const lower = text.toLowerCase().trim();

  const isEnCrisis = CRISIS_KEYWORDS_EN.some((kw) => lower.includes(kw));
  const isBnCrisis = CRISIS_KEYWORDS_BN.some((kw) => text.includes(kw));

  if (!isEnCrisis && !isBnCrisis) return null;

  return {
    isCrisis: true,
    message_bn: `🆘 আপনি একা নন। আপনার কথা গুরুত্বপূর্ণ এবং সাহায্য পাওয়া সম্ভব।

আমি একটি AI — আমি সংকটকালীন সাহায্য দিতে পারি না। অনুগ্রহ করে এখনই একজন প্রশিক্ষিত পরামর্শদাতার সাথে কথা বলুন:`,
    message_en: `🆘 You are not alone. Your feelings matter and help is available.

I'm an AI — I cannot provide crisis support. Please reach out to a trained counselor right now:`,
    helplines: [
      {
        name: 'কান পেতে রই (Kaan Pete Roi)',
        number: '01779-554391',
        description_bn: 'মানসিক স্বাস্থ্য হেল্পলাইন — বিনামূল্যে, গোপনীয়',
        description_en: 'Mental health helpline — free, confidential',
      },
      {
        name: 'জাতীয় জরুরি সেবা',
        number: '999',
        description_bn: 'জরুরি সেবা — পুলিশ, অ্যাম্বুলেন্স, ফায়ার সার্ভিস',
        description_en: 'National emergency — police, ambulance, fire',
      },
      {
        name: 'মনের খবর (Moner Khabor)',
        number: '01779-554391',
        description_bn: 'অনলাইন মানসিক স্বাস্থ্য সেবা',
        description_en: 'Online mental health support',
      },
    ],
  };
}

/**
 * Returns the crisis safety prompt to append to AI buddy system prompt.
 */
export const CRISIS_SAFETY_PROMPT = `
CRITICAL SAFETY RULE — MUST FOLLOW:
If the user expresses suicidal thoughts, self-harm, or desire to die:
1. DO NOT provide normal advice
2. Immediately respond with empathy and direct them to:
   - কান পেতে রই: 01779-554391 (মানসিক স্বাস্থ্য হেল্পলাইন)
   - জাতীয় জরুরি সেবা: 999
3. Say: "আপনি একা নন। অনুগ্রহ করে এখনই 01779-554391 নম্বরে কল করুন।"
4. Never dismiss or minimize their feelings
`;
