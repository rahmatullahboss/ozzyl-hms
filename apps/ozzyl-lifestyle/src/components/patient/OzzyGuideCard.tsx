import { useTranslation } from 'react-i18next';
import { Bot, ChevronRight } from 'lucide-react';

interface OzzyGuideCardProps {
  day: number;
  taskKey: string;
  promptKey: string;
  ctaRoute: string;
  onNavigate: (route: string) => void;
  onDismiss?: () => void;
}

const DAY_PROMPTS_EN: Record<string, string> = {
  day1: "Let's start with a quick check-in! How are you feeling today?",
  day2: "Today, let's log your first meal. What did you have for breakfast?",
  day3: "How did you sleep last night? Let's track it!",
  day4: "Time to move! Log any activity — even a short walk counts.",
  day5: "Let's try a breathing exercise. Just 2 minutes for calm.",
  day6: "Set your first health goal. What do you want to improve?",
  day7: "Your first week is done! Let's see your weekly report.",
};

const DAY_PROMPTS_BN: Record<string, string> = {
  day1: 'চলুন একটা চেক-ইন দিয়ে শুরু করি! আজ কেমন লাগছে?',
  day2: 'আজ প্রথম খাবার লগ করুন। সকালে কী খেয়েছেন?',
  day3: 'গত রাতে ঘুম কেমন হলো? চলুন ট্র্যাক করি!',
  day4: 'চলুন নড়াচড়া করি! যেকোনো অ্যাক্টিভিটি লগ করুন — হাঁটলেও চলবে।',
  day5: 'চলুন শ্বাস-প্রশ্বাসের ব্যায়াম করি। মাত্র ২ মিনিট!',
  day6: 'আপনার প্রথম স্বাস্থ্য লক্ষ্য সেট করুন। কী উন্নতি করতে চান?',
  day7: 'প্রথম সপ্তাহ শেষ! চলুন সাপ্তাহিক রিপোর্ট দেখি।',
};

export default function OzzyGuideCard({
  day,
  promptKey,
  ctaRoute,
  onNavigate,
  onDismiss,
}: OzzyGuideCardProps) {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('bn') ? 'bn' : 'en';
  const prompts = lang === 'bn' ? DAY_PROMPTS_BN : DAY_PROMPTS_EN;
  const prompt = prompts[promptKey] ?? prompts.day1;

  const dayLabel = lang === 'bn' ? `দিন ${day}/৭` : `Day ${day}/7`;
  const ctaLabel = lang === 'bn' ? 'চলুন শুরু করি' : "Let's go";

  return (
    <div className="bg-gradient-to-r from-emerald-900/40 to-emerald-800/20 border border-emerald-700/30 rounded-2xl p-4">
      <div className="flex items-start gap-3">
        {/* Ozzy Avatar */}
        <div className="w-10 h-10 shrink-0 bg-emerald-600 rounded-full flex items-center justify-center">
          <Bot className="w-5 h-5 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-emerald-400">{dayLabel}</span>
            <span className="text-xs text-slate-500">Ozzy</span>
          </div>
          <p className="text-sm text-slate-200 leading-relaxed mb-3">{prompt}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigate(ctaRoute)}
              className="flex items-center gap-1 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-semibold text-white transition-colors"
            >
              {ctaLabel}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                {lang === 'bn' ? 'পরে' : 'Later'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
