import { useTranslation } from 'react-i18next';

export function useFmt() {
  const { i18n } = useTranslation();
  const lang = i18n.language === 'bn' ? 'bn-BD' : 'en-GB';

  const fmtCurrency = (n: number) =>
    new Intl.NumberFormat(lang, { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

  const fmtDate = (d: string) => {
    if (!d) return '—';
    try {
      return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));
    } catch { return d; }
  };

  const fmtMonth = (m: string) => {
    if (!m) return '—';
    try {
      const [y, mm] = m.split('-');
      return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(new Date(Number(y), Number(mm) - 1));
    } catch { return m; }
  };

  const fmtTime = (t: string) => {
    if (!t) return '—';
    return t.substring(0, 5);
  };

  const fmtDateTime = (dt: string) => {
    if (!dt) return '—';
    return `${fmtDate(dt)} ${fmtTime(dt)}`;
  };

  return { fmtCurrency, fmtDate, fmtMonth, fmtTime, fmtDateTime };
}
