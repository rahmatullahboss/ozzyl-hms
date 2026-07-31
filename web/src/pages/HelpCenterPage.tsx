import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  Search, BookOpen, ChevronDown, ChevronUp, ArrowUp,
  AlertTriangle, Lightbulb, MapPin, ListChecks, Users,
  Rocket, Hospital, FlaskConical, Receipt, Shield,
  Star, HelpCircle, Briefcase, CalendarDays, ClipboardList,
} from 'lucide-react';

// ─── Type Definitions ────────────────────────────────────────────────────────

interface ModuleTutorial {
  key: string;
  title: string;
  where: string;
  steps: string[];
  tips: string[];
  warnings: string[];
  roles: string;
  category: string;
}

interface Category {
  key: string;
  label: string;
  icon: () => React.ReactElement;
  color: string;
}

// ─── Category Definitions ────────────────────────────────────────────────────

const CATEGORIES: Category[] = [
  { key: 'gettingStarted', label: '', icon: () => <Rocket className="w-4 h-4" />, color: 'purple' },
  { key: 'operations',     label: '', icon: () => <Hospital className="w-4 h-4" />, color: 'blue' },
  { key: 'clinical',       label: '', icon: () => <FlaskConical className="w-4 h-4" />, color: 'emerald' },
  { key: 'finance',        label: '', icon: () => <Receipt className="w-4 h-4" />, color: 'amber' },
  { key: 'admin',          label: '', icon: () => <Shield className="w-4 h-4" />, color: 'cyan' },
  { key: 'superAdmin',     label: '', icon: () => <Star className="w-4 h-4" />, color: 'rose' },
  { key: 'special',        label: '', icon: () => <HelpCircle className="w-4 h-4" />, color: 'violet' },
];

// Keys of every module and which category it belongs to
const MODULE_CATEGORY_MAP: Record<string, string> = {
  login: 'gettingStarted',
  navigation: 'gettingStarted',
  settings: 'gettingStarted',
  appointments: 'operations',
  patients: 'operations',
  emergency: 'operations',
  ot: 'operations',
  admissions: 'operations',
  beds: 'operations',
  nurseStation: 'operations',
  nursing: 'operations',
  doctorSchedule: 'operations',
  telemedicine: 'operations',
  lab: 'clinical',
  pharmacy: 'clinical',
  inventory: 'clinical',
  vitals: 'clinical',
  allergies: 'clinical',
  ePrescribing: 'clinical',
  labSettings: 'clinical',
  billing: 'finance',
  billingMaster: 'finance',
  provisionalBilling: 'finance',
  deposits: 'finance',
  creditNotes: 'finance',
  billing_handover: 'finance',
  billing_cancellation: 'finance',
  settlements: 'finance',
  accounting: 'finance',
  income: 'finance',
  expenses: 'finance',
  chartOfAccounts: 'finance',
  insurance: 'finance',
  insuranceBilling: 'finance',
  ipBilling: 'finance',
  payments: 'finance',
  commissionManagement: 'finance',
  inbox: 'admin',
  staff: 'admin',
  shareholders: 'admin',
  multiBranch: 'admin',
  reports: 'admin',
  systemAudit: 'admin',
  website: 'admin',
  aiAssistant: 'admin',
  patientPortal: 'admin',
  superAdmin: 'superAdmin',
  triageChatbot: 'special',
  roleDashboards: 'special',
};

const COLOR_STYLES: Record<string, { badge: string; accent: string; header: string }> = {
  purple:  { badge: 'badge-purple',  accent: 'border-purple-300 dark:border-purple-700',  header: 'bg-purple-50 dark:bg-purple-900/20' },
  blue:    { badge: 'badge-blue',    accent: 'border-blue-300 dark:border-blue-700',      header: 'bg-blue-50 dark:bg-blue-900/20' },
  emerald: { badge: 'badge-emerald', accent: 'border-emerald-300 dark:border-emerald-700', header: 'bg-emerald-50 dark:bg-emerald-900/20' },
  amber:   { badge: 'badge-amber',   accent: 'border-amber-300 dark:border-amber-700',    header: 'bg-amber-50 dark:bg-amber-900/20' },
  cyan:    { badge: 'badge-cyan',    accent: 'border-cyan-300 dark:border-cyan-700',      header: 'bg-cyan-50 dark:bg-cyan-900/20' },
  rose:    { badge: 'badge-rose',    accent: 'border-rose-300 dark:border-rose-700',      header: 'bg-rose-50 dark:bg-rose-900/20' },
  violet:  { badge: 'badge-violet',  accent: 'border-violet-300 dark:border-violet-700',  header: 'bg-violet-50 dark:bg-violet-900/20' },
};

// ─── Module Card ─────────────────────────────────────────────────────────────

function ModuleCard({ module, color, t, initiallyOpen = false }: { module: ModuleTutorial; color: string; t: (k: string, opts?: Record<string, unknown>) => string; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const styles = COLOR_STYLES[color] ?? COLOR_STYLES.blue;

  return (
    <div className={`border rounded-xl overflow-hidden transition-shadow duration-200 ${styles.accent} ${open ? 'shadow-card' : 'shadow-xs hover:shadow-card'}`}>
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors cursor-pointer ${styles.header} hover:brightness-95`}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          <BookOpen className={`w-4 h-4 shrink-0 ${open ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}`} />
          <span className="font-semibold text-sm text-[var(--color-text)]">{module.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-[var(--color-text-muted)] hidden sm:block">
            {open ? t('labels.collapse') : t('labels.expand')}
          </span>
          {open
            ? <ChevronUp className="w-4 h-4 text-[var(--color-text-muted)]" />
            : <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" />
          }
        </div>
      </button>

      {/* Expanded Content */}
      {open && (
        <div className="px-5 pb-5 pt-4 bg-white dark:bg-slate-900 space-y-5 border-t border-[var(--color-border)]">

          {/* Where to Find */}
          <section>
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
              <MapPin className="w-3.5 h-3.5" />
              {t('labels.whereToFind')}
            </h4>
            <p className="text-sm text-[var(--color-text)] bg-[var(--color-bg)] rounded-lg px-4 py-2.5 border border-[var(--color-border)]">
              {module.where}
            </p>
          </section>

          {/* Who can use */}
          <section>
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
              <Users className="w-3.5 h-3.5" />
              {t('labels.roles')}
            </h4>
            <p className="text-sm text-[var(--color-text-secondary)]">{module.roles}</p>
          </section>

          {/* Steps */}
          <section>
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
              <ListChecks className="w-3.5 h-3.5" />
              {t('labels.howToUse')}
            </h4>
            <ol className="space-y-2.5">
              {module.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm text-[var(--color-text)]">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-cyan-400 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Tips & Warnings */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Tips */}
            {module.tips.length > 0 && (
              <section className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">
                  <Lightbulb className="w-3.5 h-3.5" />
                  {t('labels.tips')}
                </h4>
                <ul className="space-y-1.5">
                  {module.tips.map((tip, i) => (
                    <li key={i} className="flex gap-2 text-sm text-emerald-800 dark:text-emerald-300">
                      <span className="shrink-0 mt-1">•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Warnings */}
            {module.warnings.length > 0 && (
              <section className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('labels.warnings')}
                </h4>
                <ul className="space-y-1.5">
                  {module.warnings.map((w, i) => (
                    <li key={i} className="flex gap-2 text-sm text-amber-800 dark:text-amber-300">
                      <span className="shrink-0 mt-1">⚠</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

// ─── Role Guide Types ────────────────────────────────────────────────────────

interface RoleGuide {
  key: string;
  title: string;
  dailyTasks: string[];
  weeklyTasks: string[];
  modulesUsed: string[];
  tips: string[];
  commonMistakes: string[];
}

// ─── Role Card ───────────────────────────────────────────────────────────────

function RoleCard({ role, t }: { role: RoleGuide; t: (k: string, opts?: Record<string, unknown>) => string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`border rounded-xl overflow-hidden transition-shadow duration-200 border-violet-300 dark:border-violet-700 ${open ? 'shadow-card' : 'shadow-xs hover:shadow-card'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors cursor-pointer bg-violet-50 dark:bg-violet-900/20 hover:brightness-95`}
        aria-expanded={open}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Briefcase className={`w-4 h-4 shrink-0 ${open ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]'}`} />
          <span className="font-semibold text-sm text-[var(--color-text)]">{role.title}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-[var(--color-text-muted)] hidden sm:block">
            {open ? t('labels.collapse') : t('labels.expand')}
          </span>
          {open
            ? <ChevronUp className="w-4 h-4 text-[var(--color-text-muted)]" />
            : <ChevronDown className="w-4 h-4 text-[var(--color-text-muted)]" />
          }
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-4 bg-white dark:bg-slate-900 space-y-5 border-t border-[var(--color-border)]">

          {/* Daily Tasks */}
          <section>
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
              <ClipboardList className="w-3.5 h-3.5" />
              {t('roleLabels.dailyTasks')}
            </h4>
            <ol className="space-y-2.5">
              {role.dailyTasks.map((task, i) => (
                <li key={i} className="flex gap-3 text-sm text-[var(--color-text)]">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-cyan-400 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{task}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Weekly Tasks */}
          <section>
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-3">
              <CalendarDays className="w-3.5 h-3.5" />
              {t('roleLabels.weeklyTasks')}
            </h4>
            <ol className="space-y-2.5">
              {role.weeklyTasks.map((task, i) => (
                <li key={i} className="flex gap-3 text-sm text-[var(--color-text)]">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-400 text-white text-[11px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="leading-relaxed">{task}</span>
                </li>
              ))}
            </ol>
          </section>

          {/* Modules Used */}
          <section>
            <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
              <BookOpen className="w-3.5 h-3.5" />
              {t('roleLabels.modulesUsed')}
            </h4>
            <div className="flex flex-wrap gap-2">
              {role.modulesUsed.map((mod, i) => (
                <span key={i} className="px-2.5 py-1 rounded-full text-xs font-medium bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
                  {mod}
                </span>
              ))}
            </div>
          </section>

          {/* Tips & Mistakes */}
          <div className="grid sm:grid-cols-2 gap-4">
            {/* Tips */}
            {role.tips.length > 0 && (
              <section className="bg-emerald-50 dark:bg-emerald-900/20 rounded-xl p-4 border border-emerald-200 dark:border-emerald-800">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-2">
                  <Lightbulb className="w-3.5 h-3.5" />
                  {t('roleLabels.tips')}
                </h4>
                <ul className="space-y-1.5">
                  {role.tips.map((tip, i) => (
                    <li key={i} className="flex gap-2 text-sm text-emerald-800 dark:text-emerald-300">
                      <span className="shrink-0 mt-1">•</span>
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Mistakes */}
            {role.commonMistakes.length > 0 && (
              <section className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-200 dark:border-amber-800">
                <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t('roleLabels.commonMistakes')}
                </h4>
                <ul className="space-y-1.5">
                  {role.commonMistakes.map((m, i) => (
                    <li key={i} className="flex gap-2 text-sm text-amber-800 dark:text-amber-300">
                      <span className="shrink-0 mt-1">⚠</span>
                      <span>{m}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function HelpCenterPage() {
  const { t, i18n } = useTranslation(['helpCenter', 'roleGuides']);
  const [searchParams, setSearchParams] = useSearchParams();
  const moduleParam = searchParams.get('module');

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'modules' | 'roles'>('modules');

  // If module parameter is provided, automatically filter to that module
  useEffect(() => {
    if (moduleParam && MODULE_CATEGORY_MAP[moduleParam]) {
      setActiveCategory(MODULE_CATEGORY_MAP[moduleParam]);
      // We don't set the search text to avoid hiding other things if the user wants to browse,
      // but we filter the view.
    }
  }, [moduleParam]);

  // Build module list from translation data
  const allModules: ModuleTutorial[] = useMemo(() => {
    return Object.entries(MODULE_CATEGORY_MAP).map(([key, category]) => {
      const base = `modules.${key}`;
      const title    = t(`${base}.title`,    { defaultValue: key });
      const where    = t(`${base}.where`,    { defaultValue: '' });
      const roles    = t(`${base}.roles`,    { defaultValue: '' });

      // Steps, tips, warnings come as arrays — i18next returns them as arrays
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = (i18n.getResourceBundle(i18n.language, 'helpCenter') ?? {}) as any;
      const moduleData = raw?.modules?.[key] ?? {};

      const steps    = Array.isArray(moduleData.steps)    ? moduleData.steps    : [];
      const tips     = Array.isArray(moduleData.tips)     ? moduleData.tips     : [];
      const warnings = Array.isArray(moduleData.warnings) ? moduleData.warnings : [];

      return { key, title, where, steps, tips, warnings, roles, category };
    });
  }, [t, i18n.language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter by search and category
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allModules.filter(m => {
      // If direct module link is used, only show that module if no search is active
      if (moduleParam && !q && !activeCategory && m.key !== moduleParam) return false;

      const matchSearch = !q || m.title.toLowerCase().includes(q) ||
        m.where.toLowerCase().includes(q) ||
        m.steps.some(s => s.toLowerCase().includes(q)) ||
        m.tips.some(s => s.toLowerCase().includes(q)) ||
        m.roles.toLowerCase().includes(q);
      const matchCat = !activeCategory || m.category === activeCategory;
      return matchSearch && matchCat;
    });
  }, [allModules, search, activeCategory, moduleParam]);

  // Count per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach(m => { counts[m.category] = (counts[m.category] ?? 0) + 1; });
    return counts;
  }, [filtered]);

  // Build role list from roleGuides translation data
  const allRoles: RoleGuide[] = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (i18n.getResourceBundle(i18n.language, 'roleGuides') ?? {}) as any;
    const rolesData = raw?.roles ?? {};
    return Object.entries(rolesData).map(([key, data]: [string, any]) => ({
      key,
      title: data.title ?? key,
      dailyTasks: Array.isArray(data.dailyTasks) ? data.dailyTasks : [],
      weeklyTasks: Array.isArray(data.weeklyTasks) ? data.weeklyTasks : [],
      modulesUsed: Array.isArray(data.modulesUsed) ? data.modulesUsed : [],
      tips: Array.isArray(data.tips) ? data.tips : [],
      commonMistakes: Array.isArray(data.commonMistakes) ? data.commonMistakes : [],
    }));
  }, [i18n.language]);

  const filteredRoles = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return allRoles;
    return allRoles.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.dailyTasks.some(s => s.toLowerCase().includes(q)) ||
      r.weeklyTasks.some(s => s.toLowerCase().includes(q)) ||
      r.modulesUsed.some(s => s.toLowerCase().includes(q)) ||
      r.tips.some(s => s.toLowerCase().includes(q)) ||
      r.commonMistakes.some(s => s.toLowerCase().includes(q))
    );
  }, [allRoles, search]);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">

      {/* ── Page Header ── */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--color-primary)] to-cyan-400 shadow-lg shadow-cyan-500/20 mb-2">
          <HelpCircle className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-[var(--color-text)] leading-tight">
          {t('pageTitle')}
        </h1>
        <p className="text-[var(--color-text-secondary)] text-sm max-w-2xl mx-auto">
          {t('pageSubtitle')}
        </p>
      </div>

      {/* ── Tab Switcher ── */}
      <div className="flex justify-center">
        <div className="inline-flex bg-[var(--color-bg)] border border-[var(--color-border)] rounded-full p-1 shadow-sm">
          <button
            onClick={() => { setActiveTab('modules'); setActiveCategory(null); setSearch(''); }}
            className={`px-5 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'modules'
                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
            }`}
          >
            {t('tabModules', { defaultValue: 'Modules' })}
          </button>
          <button
            onClick={() => { setActiveTab('roles'); setActiveCategory(null); setSearch(''); }}
            className={`px-5 py-2 rounded-full text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'roles'
                ? 'bg-[var(--color-primary)] text-white shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
            }`}
          >
            {t('tabRoles', { defaultValue: 'Role Guides' })}
          </button>
        </div>
      </div>

      {/* ── Search Bar ── */}
      <div className="relative max-w-2xl mx-auto">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-text-muted)]" />
        <input
          id="help-center-search"
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="form-input pl-12 w-full text-sm h-12 rounded-xl shadow-sm"
          aria-label={t('searchPlaceholder')}
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] text-xs cursor-pointer"
          >
            ✕
          </button>
        )}
      </div>

      {activeTab === 'modules' && (
        <>
          {/* ── Category Filter Chips ── */}
          <div className="flex flex-wrap gap-2 justify-center">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-4 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
            !activeCategory
              ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
              : 'bg-white dark:bg-slate-800 text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
          }`}
        >
          All ({allModules.length})
        </button>
        {CATEGORIES.map(cat => {
          const isActive = activeCategory === cat.key;
          const count = (allModules.filter(m => m.category === cat.key)).length;
          const label = t(`categories.${cat.key}`);
          const CatIcon = cat.icon;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(isActive ? null : cat.key)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                isActive
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-[var(--color-text-secondary)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]'
              }`}
              aria-pressed={isActive}
            >
              <CatIcon />
              {label} ({count})
            </button>
          );
        })}
      </div>

      {/* ── No results ── */}
      {filtered.length === 0 && (
        <div className="text-center py-16">
          <Search className="w-12 h-12 mx-auto text-[var(--color-text-muted)] opacity-30 mb-4" />
          <p className="text-[var(--color-text-muted)] text-sm">
            {t('searchNoResults')} <strong>"{search}"</strong>
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('searchHint')}</p>
        </div>
      )}

      {/* ── Module Lists by Category ── */}
      {CATEGORIES.map(cat => {
        const catModules = filtered.filter(m => m.category === cat.key);
        if (catModules.length === 0) return null;
        const count = categoryCounts[cat.key] ?? 0;
        const catStyles = COLOR_STYLES[cat.color];

        return (
          <section key={cat.key} id={`cat-${cat.key}`} className="space-y-4">
            {/* Category Header */}
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${catStyles.accent} ${catStyles.header}`}>
              <div className="flex items-center gap-2">
                {(() => { const I = cat.icon; return <I />; })()}
                <h2 className="text-base font-bold text-[var(--color-text)]">
                  {t(`categories.${cat.key}`)}
                </h2>
              </div>
              <span className="ml-auto text-xs font-semibold text-[var(--color-text-muted)] bg-white/60 dark:bg-slate-800/60 px-2.5 py-1 rounded-full">
                {count} {count === 1 ? t('countLabels.moduleOne') : t('countLabels.moduleOther')}
              </span>
            </div>

            {/* Module cards */}
            <div className="space-y-3 pl-2">
              {catModules.map(m => (
                <ModuleCard
                  key={m.key}
                  module={m}
                  color={CATEGORIES.find(c => c.key === m.category)?.color ?? 'blue'}
                  t={t}
                  initiallyOpen={m.key === moduleParam}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* ── Back to Top ── */}
      {activeTab === 'modules' && filtered.length > 5 && (
        <div className="text-center pt-4">
          <button
            onClick={scrollToTop}
            className="inline-flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)] transition-colors cursor-pointer"
          >
            <ArrowUp className="w-4 h-4" />
            {t('labels.backToTop')}
          </button>
        </div>
      )}
        </>
      )}

      {activeTab === 'roles' && (
        <div className="space-y-6">
          {/* ── Roles Header ── */}
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <h2 className="text-base font-bold text-[var(--color-text)]">
                {t('roleGuidesTitle', { defaultValue: 'Day-to-Day Role Guides' })}
              </h2>
            </div>
            <span className="ml-auto text-xs font-semibold text-[var(--color-text-muted)] bg-white/60 dark:bg-slate-800/60 px-2.5 py-1 rounded-full">
              {filteredRoles.length} {filteredRoles.length === 1 ? t('countLabels.roleOne') : t('countLabels.roleOther')}
            </span>
          </div>

          {/* ── No results ── */}
          {filteredRoles.length === 0 && (
            <div className="text-center py-16">
              <Search className="w-12 h-12 mx-auto text-[var(--color-text-muted)] opacity-30 mb-4" />
              <p className="text-[var(--color-text-muted)] text-sm">
                {t('searchNoResults')} <strong>"{search}"</strong>
              </p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('searchHint')}</p>
            </div>
          )}

          {/* ── Role cards ── */}
          <div className="space-y-3 pl-2">
            {filteredRoles.map(role => (
              <RoleCard key={role.key} role={role} t={t} />
            ))}
          </div>
        </div>
      )}

      {/* ── Footer note ── */}
      <div className="text-center py-4 border-t border-[var(--color-border)]">
        <p className="text-xs text-[var(--color-text-muted)]">
          {t('footer.prefix')} {t('footer.suffix', { year: new Date().getFullYear() })}
        </p>
      </div>
    </div>
  );
}
