import type { LucideIcon } from 'lucide-react';

interface PatientSectionIntroProps {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone?: 'cyan' | 'emerald' | 'amber' | 'slate';
}

const TONE_CLASSES: Record<NonNullable<PatientSectionIntroProps['tone']>, {
  bg: string;
  iconBg: string;
  eyebrow: string;
  accent: string;
}> = {
  cyan: {
    bg: 'from-cyan-50/80 via-white to-teal-50/60 border-cyan-100/60',
    iconBg: 'from-cyan-500 to-teal-500 shadow-cyan-500/25',
    eyebrow: 'text-cyan-600',
    accent: 'from-cyan-400 to-teal-400',
  },
  emerald: {
    bg: 'from-emerald-50/80 via-white to-teal-50/60 border-emerald-100/60',
    iconBg: 'from-emerald-500 to-teal-500 shadow-emerald-500/25',
    eyebrow: 'text-emerald-600',
    accent: 'from-emerald-400 to-teal-400',
  },
  amber: {
    bg: 'from-amber-50/80 via-white to-orange-50/60 border-amber-100/60',
    iconBg: 'from-amber-500 to-orange-500 shadow-amber-500/25',
    eyebrow: 'text-amber-600',
    accent: 'from-amber-400 to-orange-400',
  },
  slate: {
    bg: 'from-slate-50/80 via-white to-slate-100/60 border-slate-200/60',
    iconBg: 'from-slate-500 to-slate-600 shadow-slate-500/25',
    eyebrow: 'text-slate-500',
    accent: 'from-slate-400 to-slate-500',
  },
};

export function PatientSectionIntro({
  eyebrow,
  title,
  description,
  icon: Icon,
  tone = 'cyan',
}: PatientSectionIntroProps) {
  const t = TONE_CLASSES[tone];

  return (
    <section className={`animate-fade-in-up rounded-[2rem] border bg-gradient-to-r px-6 py-6 shadow-[0_8px_30px_rgba(15,23,42,0.04)] ${t.bg}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg ${t.iconBg}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <p className={`text-[11px] font-bold uppercase tracking-[0.22em] ${t.eyebrow}`}>{eyebrow}</p>
          <h2 className="mt-1.5 text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">{title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500">{description}</p>
          <div className={`mt-4 h-0.5 w-16 rounded-full bg-gradient-to-r ${t.accent} opacity-40`} />
        </div>
      </div>
    </section>
  );
}
