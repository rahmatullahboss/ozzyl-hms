import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router';
import {
  Search, X, FlaskConical, Send, Save, ArrowLeft,
  ChevronRight, ToggleLeft, ToggleRight, User
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Patient {
  id: number;
  name: string;
  patient_code: string;
  date_of_birth?: string;
  gender?: string;
  mobile?: string;
}

interface CatalogTest {
  id: number;
  code: string;
  name: string;
  category?: string;
  price: number;
}

interface OrderItem {
  labTestId: number;
  testName: string;
  testCode: string;
  category: string;
  priority: 'routine' | 'urgent' | 'stat';
  instructions: string;
  price: number;
  discount: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const QUICK_TESTS = ['CBC', 'Blood Sugar', 'LFT', 'RFT', 'Urine R/E', 'Lipid Profile', 'HbA1c', 'TSH', 'ECG', 'Chest X-Ray'];
const PRIORITIES = [
  { value: 'routine', label: 'Routine', color: 'bg-gray-100 text-gray-600' },
  { value: 'urgent',  label: 'Urgent',  color: 'bg-amber-100 text-amber-700' },
  { value: 'stat',    label: 'STAT',    color: 'bg-red-100 text-red-700' },
];
const SPECIMEN_TYPES = ['Blood', 'Urine', 'Stool', 'Sputum', 'Swab', 'CSF', 'Other'];

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

function calcAge(dob?: string): string {
  if (!dob) return '?';
  const diff = Date.now() - new Date(dob).getTime();
  return `${Math.floor(diff / (365.25 * 24 * 3600 * 1000))}y`;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function LabTestOrderForm() {
  const { t } = useTranslation(['laboratory', 'common']);

  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const basePath = `/h/${slug}`;

  const patientIdParam = Number(searchParams.get('patient') ?? 0);

  // State
  const [patient,    setPatient]    = useState<Patient | null>(null);
  const [items,      setItems]      = useState<OrderItem[]>([]);
  const [catalog,    setCatalog]    = useState<CatalogTest[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<CatalogTest[]>([]);
  const [diagnosis,  setDiagnosis]  = useState('');
  const [history,    setHistory]    = useState('');
  const [fasting,    setFasting]    = useState(false);
  const [specimen,   setSpecimen]   = useState('Blood');
  const [notes,      setNotes]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [showDropdown, setShowDropdown] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click-outside to close search dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load patient
  useEffect(() => {
    if (!patientIdParam) return;
    axios.get(`/api/patients/${patientIdParam}`, { headers: authHeaders() })
      .then(r => setPatient(r.data.patient ?? r.data))
      .catch(() => toast.error(t('laboratory.failed_to_load_patient')));
  }, [patientIdParam]);

  // Load test catalog for quick tests
  useEffect(() => {
    axios.get('/api/lab?search=', { headers: authHeaders() })
      .then(r => setCatalog(r.data.tests ?? []))
      .catch(() => {});
  }, []);

  // Debounced search
  useEffect(() => {
    if (searchTerm.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(() => {
      axios.get(`/api/lab?search=${encodeURIComponent(searchTerm)}`, { headers: authHeaders() })
        .then(r => setSearchResults(r.data.tests ?? []))
        .catch(() => setSearchResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Add test from catalog
  const addTest = useCallback((test: CatalogTest) => {
    if (items.some(i => i.labTestId === test.id)) {
      toast.error(t('laboratory.test_already_added'));
      return;
    }
    setItems(prev => [...prev, {
      labTestId:    test.id,
      testName:     test.name,
      testCode:     test.code,
      category:     test.category ?? 'other',
      priority:     'routine',
      instructions: '',
      price:        test.price,
      discount:     0,
    }]);
    setSearchTerm('');
    setSearchResults([]);
    searchRef.current?.focus();
  }, [items]);

  // Add by name (for quick test buttons)
  const addByName = useCallback((name: string) => {
    const found = catalog.find(t => t.name.toLowerCase().includes(name.toLowerCase()));
    if (found) {
      addTest(found);
    } else {
      toast.error(t('laboratory.testNotFound', { name }));
    }
  }, [catalog, addTest]);

  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));

  const updateItem = <K extends keyof OrderItem>(idx: number, key: K, value: OrderItem[K]) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [key]: value } : item));
  };

  // Save
  const handleSave = async (sendToLab: boolean) => {
    if (items.length === 0) { toast.error(t('laboratory.add_at_least_one_test')); return; }
    if (!patient) { toast.error(t('laboratory.no_patient_selected')); return; }

    setSaving(true);
    try {
      const payload = {
        patientId: patient.id,
        status: sendToLab ? 'sent' : 'draft',
        diagnosis: diagnosis || undefined,
        relevantHistory: history || undefined,
        fastingRequired: fasting,
        specimenType: specimen,
        collectionNotes: notes || undefined,
        items: items.map(i => ({
          labTestId: i.labTestId,
          discount: i.discount,
          priority: i.priority,
          instructions: i.instructions || undefined,
        })),
      };
      const res = await axios.post('/api/lab/orders', payload, { headers: authHeaders() });
      if (sendToLab) {
        toast.success(t('laboratory.orderSentToLab', { orderNo: res.data.orderNo }));
      } else {
        toast.success(t('laboratory.draftSaved', { orderNo: res.data.orderNo }));
      }
      navigate(`${basePath}/tests`);
    } catch {
      toast.error(t('laboratory.failed_to_create_lab_order'));
    } finally {
      setSaving(false);
    }
  };

  // Cancel confirmation
  const handleCancel = () => {
    if (items.length > 0 || diagnosis || history || notes) {
      if (!window.confirm('You have unsaved changes. Are you sure you want to leave?')) return;
    }
    navigate(`${basePath}/tests`);
  };

  const totalCost = items.reduce((s, i) => s + (i.price - i.discount), 0);
  const todayStr = new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'long', year: 'numeric' });

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <div className="max-w-5xl mx-auto p-6 space-y-5 pb-28">

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('dashboard', { defaultValue: 'Dashboard' })}</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/tests`} className="hover:underline">Laboratory</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)]">New Lab Order</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)] flex items-center gap-2">
              <FlaskConical className="w-5 h-5 text-[var(--color-primary)]" />
              Lab Test Order
            </h1>
          </div>
          <span className="badge bg-amber-100 text-amber-700 text-sm px-3 py-1 rounded-full font-medium">Draft</span>
        </div>

        {/* ── Patient Banner ─────────────────────────────────── */}
        {patient ? (
          <div className="bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
                <User className="w-5 h-5 text-[var(--color-primary)]" />
              </div>
              <div>
                <div className="font-semibold text-[var(--color-text)]">{patient.name}</div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {patient.patient_code} · {calcAge(patient.date_of_birth)} · {patient.gender ?? '?'} {patient.mobile && `· ${patient.mobile}`}
                </div>
              </div>
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              Date: <strong className="text-[var(--color-text)]">{todayStr}</strong>
            </div>
          </div>
        ) : (
          <div className="card p-6 text-center text-[var(--color-text-muted)]">
            <p className="text-sm">No patient selected. Pass <code>?patient=ID</code> in URL.</p>
          </div>
        )}

        {/* ── Test Selection ─────────────────────────────────── */}
        <div className="card p-5">
          <h2 className="font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-[var(--color-primary)]" />
            Select Tests
          </h2>

          {/* Search */}
          <div className="relative mb-4" ref={dropdownRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              ref={searchRef}
              type="text"
              placeholder={t("laboratory.searchLabTests")}
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              className="input pl-10 w-full"
            />
            {searchResults.length > 0 && showDropdown && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-[var(--color-border)] rounded-xl shadow-lg max-h-48 overflow-auto">
                {searchResults.map(t => (
                  <button key={t.id} onClick={() => addTest(t)}
                    className="w-full text-left px-4 py-2.5 hover:bg-[var(--color-bg)] transition-colors flex items-center justify-between border-b border-[var(--color-border)] last:border-0">
                    <div>
                      <div className="text-sm font-medium text-[var(--color-text)]">{t.name}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{t.code} · {t.category}</div>
                    </div>
                    <span className="text-xs font-mono text-[var(--color-primary)]">৳{t.price}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quick Test Pills */}
          <div className="flex flex-wrap gap-2 mb-5">
            {QUICK_TESTS.map(name => (
              <button key={name} onClick={() => addByName(name)}
                className="text-xs border border-[var(--color-primary)] text-[var(--color-primary)] rounded-full px-3 py-1.5 hover:bg-[var(--color-primary)] hover:text-white transition-colors font-medium">
                + {name}
              </button>
            ))}
          </div>

          {/* Selected Tests Table */}
          {items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-bg)]">
                  <tr className="text-xs text-[var(--color-text-muted)] uppercase border-b border-[var(--color-border)]">
                    <th className="text-left px-3 py-2.5 font-medium w-8">#</th>
                    <th className="text-left px-3 py-2.5 font-medium">Test Name</th>
                    <th className="text-left px-3 py-2.5 font-medium w-24">Category</th>
                    <th className="text-left px-3 py-2.5 font-medium w-24">Priority</th>
                    <th className="text-left px-3 py-2.5 font-medium">Instructions</th>
                    <th className="text-right px-3 py-2.5 font-medium w-20">Price</th>
                    <th className="text-center px-3 py-2.5 font-medium w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {items.map((item, idx) => (
                    <tr key={item.labTestId} className={idx % 2 === 0 ? 'bg-white' : 'bg-[var(--color-bg)]'}>
                      <td className="px-3 py-2.5 text-[var(--color-text-muted)] font-mono">{idx + 1}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-[var(--color-text)]">{item.testName}</div>
                        <div className="text-xs text-[var(--color-text-muted)] font-mono">{item.testCode}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2 py-0.5 capitalize">{item.category}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          value={item.priority}
                          onChange={e => updateItem(idx, 'priority', e.target.value as 'routine' | 'urgent' | 'stat')}
                          className="input text-xs py-1 px-2 w-full">
                          {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="text"
                          placeholder={t("laboratory.specialInstructions")}
                          value={item.instructions}
                          onChange={e => updateItem(idx, 'instructions', e.target.value)}
                          className="input text-xs py-1 px-2 w-full"
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[var(--color-text)]">৳{item.price}</td>
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={() => removeItem(idx)}
                          className="text-red-400 hover:text-red-600 transition-colors p-1">
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--color-border)]">
                    <td colSpan={5} className="px-3 py-3 text-right font-semibold text-sm text-[var(--color-text)]">
                      Total ({items.length} test{items.length !== 1 ? 's' : ''})
                    </td>
                    <td className="px-3 py-3 text-right font-bold font-mono text-[var(--color-primary)] text-base">
                      ৳{totalCost}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-[var(--color-text-muted)]">
              <FlaskConical className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No tests selected. Search or click quick buttons above.</p>
            </div>
          )}
        </div>

        {/* ── Clinical Info ───────────────────────────────────── */}
        <div className="grid md:grid-cols-2 gap-5">
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-sm text-[var(--color-text)]">Clinical Information</h3>
            <div>
              <label className="label">{t('laboratory.clinical_diagnosis')}</label>
              <textarea
                value={diagnosis} onChange={e => setDiagnosis(e.target.value)}
                rows={3} className="input w-full" placeholder={t("laboratory.primaryDiagnosisPlaceholder")}
              />
            </div>
            <div>
              <label className="label">{t('laboratory.relevant_history')}</label>
              <textarea
                value={history} onChange={e => setHistory(e.target.value)}
                rows={3} className="input w-full" placeholder={t("laboratory.medicalHistoryPlaceholder")}
              />
            </div>
          </div>

          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-sm text-[var(--color-text)]">Collection Details</h3>
            <div className="flex items-center justify-between">
              <label className="label mb-0" id="fasting-label">Fasting Required?</label>
              <button onClick={() => setFasting(f => !f)}
                aria-labelledby="fasting-label"
                aria-pressed={fasting}
                aria-label={fasting ? "Set fasting required to No" : "Set fasting required to Yes"}
                className="flex items-center gap-1.5 text-sm">
                {fasting
                  ? <ToggleRight className="w-8 h-8 text-[var(--color-primary)]" aria-hidden="true" />
                  : <ToggleLeft className="w-8 h-8 text-gray-300" aria-hidden="true" />}
                <span className={fasting ? 'text-[var(--color-primary)] font-medium' : 'text-[var(--color-text-muted)]'}>
                  {fasting ? 'Yes' : 'No'}
                </span>
              </button>
            </div>
            <div>
              <label className="label">{t('laboratory.specimen_type')}</label>
              <select value={specimen} onChange={e => setSpecimen(e.target.value)} className="input w-full">
                {SPECIMEN_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="label">{t('laboratory.collection_notes')}</label>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)}
                rows={3} className="input w-full" placeholder={t("laboratory.collectionInstructionsPlaceholder")}
              />
            </div>
          </div>
        </div>

      </div>

      {/* ── Sticky Action Bar ───────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 bg-[var(--color-surface)] border-t border-[var(--color-border)] shadow-lg z-30">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
          <button onClick={handleCancel} className="btn-secondary flex items-center gap-1.5">
            <ArrowLeft className="w-4 h-4" />
            Cancel
          </button>
          <div className="flex items-center gap-3">
            <span className="text-sm text-[var(--color-text-muted)]">
              {items.length} test{items.length !== 1 ? 's' : ''} · <strong className="text-[var(--color-text)]">৳{totalCost}</strong>
            </span>
            <button
              onClick={() => handleSave(false)}
              disabled={saving || items.length === 0}
              className="btn-secondary flex items-center gap-1.5 disabled:opacity-50">
              <Save className="w-4 h-4" />
              Save Draft
            </button>
            <button
              onClick={() => handleSave(true)}
              disabled={saving || items.length === 0}
              className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
              <Send className="w-4 h-4" />
              {saving ? 'Sending...' : 'Send to Lab'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
