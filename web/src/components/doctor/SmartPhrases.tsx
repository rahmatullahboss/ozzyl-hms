import { useState, useCallback } from 'react';
import { Plus, Trash2, Edit2, Check, X, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

interface SmartPhrase {
  id: string;
  shortcut: string;
  title: string;
  content: string;
  category: string;
  lastUsed?: string;
}

const DEFAULT_PHRASES: SmartPhrase[] = [
  { id: '1', shortcut: '.hpi', title: 'HPI Template', content: 'Patient presents with chief complaint of [COMPLAINT]. Onset [TIMING]. Quality [QUALITY]. Radiation [RADIATION]. Associated symptoms include [SYMPTOMS]. Patient reports [AGGRAVATING] aggravates and [ALLEVIATING] alleviates symptoms.', category: 'HPI' },
  { id: '2', shortcut: '.pe', title: 'Physical Exam', content: 'Vitals stable. General appearance: [APPEARANCE]. HEENT: [HEENT_FINDINGS]. Cardiovascular: [CV_FINDINGS]. Respiratory: [RESP_FINDINGS]. Abdominal: [ABD_FINDINGS]. Extremities: [EXT_FINDINGS].', category: 'Exam' },
  { id: '3', shortcut: '.a/p', title: 'Assessment/Plan', content: 'Assessment:\n1. [DIAGNOSIS_1] - [ICD10_CODE]\n2. [DIAGNOSIS_2] - [ICD10_CODE]\n\nPlan:\n1. [TREATMENT_1]\n2. [TREATMENT_2]\n3. Follow-up in [TIMEFRAME]', category: 'Assessment' },
  { id: '4', shortcut: '.imp', title: 'Impression', content: 'Impression:\n1. [DIAGNOSIS] - [ICD10]\n2. Recommend [TREATMENT]\n3. Patient advised regarding [ADVICE]', category: 'Assessment' },
  { id: '5', shortcut: '.rx', title: 'Prescription Template', content: 'Rx:\n1. [DRUG_1] [DOSAGE] [FREQUENCY] for [DURATION]\n2. [DRUG_2] [DOSAGE] [FREQUENCY] for [DURATION]\n\nDispense: [QUANTITY]\nRefills: [NUMBER]', category: 'Prescription' },
  { id: '6', shortcut: '.f/u', title: 'Follow-up Instructions', content: 'Follow-up instructions:\n- Return to clinic in [TIMEFRAME]\n- Call if [RED_FLAGS]\n- Continue medications as prescribed\n- [ADDITIONAL_INSTRUCTIONS]', category: 'Instructions' },
  { id: '7', shortcut: '.soap', title: 'SOAP Note', content: 'S: [SUBJECTIVE - patient reports]\n\nO: [OBJECTIVE - vitals, exam findings]\n\nA: [ASSESSMENT - diagnoses]\n\nP: [PLAN - treatment, follow-up]', category: 'SOAP' },
  { id: '8', shortcut: '.preop', title: 'Pre-op Clearance', content: 'Pre-operative Clearance:\n- Clear for [PROCEDURE] under [ANESTHESIA]\n- Risk stratification: [ASA_SCORE]\n- Recommendations: [RECOMMENDATIONS]\n- Clear to proceed', category: 'Pre-op' },
];

interface SmartPhrasesProps {
  onSelectPhrase: (content: string) => void;
  currentText?: string;
}

export function SmartPhrases({ onSelectPhrase }: SmartPhrasesProps) {
  const { t } = useTranslation('dashboard');
  const [phrases, setPhrases] = useState<SmartPhrase[]>(DEFAULT_PHRASES);
  const [showManager, setShowManager] = useState(false);
  const [editingPhrase, setEditingPhrase] = useState<SmartPhrase | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const categories = ['All', ...Array.from(new Set(phrases.map(p => p.category)))];

  const filtered = phrases.filter(p => {
    if (selectedCategory !== 'All' && p.category !== selectedCategory) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.shortcut.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleExpand = useCallback((phrase: SmartPhrase) => {
    let expanded = phrase.content;
    // Replace placeholders with empty brackets for user input
    expanded = expanded.replace(/\[([^\]]+)\]/g, '[$1]');
    onSelectPhrase(expanded);
    toast.success(t('phraseInserted', { defaultValue: 'Phrase inserted' }));
  }, [onSelectPhrase]);

  const handleSavePhrase = useCallback((phrase: Partial<SmartPhrase>) => {
    if (editingPhrase) {
      setPhrases(prev => prev.map(p => p.id === editingPhrase.id ? { ...p, ...phrase, lastUsed: new Date().toISOString() } : p));
      toast.success(t('phraseUpdated', { defaultValue: 'Phrase updated' }));
    } else {
      const newPhrase: SmartPhrase = {
        id: Date.now().toString(),
        shortcut: phrase.shortcut || '',
        title: phrase.title || '',
        content: phrase.content || '',
        category: phrase.category || 'Custom',
        lastUsed: new Date().toISOString(),
      };
      setPhrases(prev => [...prev, newPhrase]);
      toast.success(t('phraseCreated', { defaultValue: 'Phrase created' }));
    }
    setEditingPhrase(null);
  }, [editingPhrase]);

  const handleDeletePhrase = useCallback((id: string) => {
    setPhrases(prev => prev.filter(p => p.id !== id));
    toast.success(t('phraseDeleted', { defaultValue: 'Phrase deleted' }));
  }, []);

  if (showManager) {
    return (
      <div className="card">
        <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="font-semibold text-[var(--color-text)] flex items-center gap-2">
            <FileText className="w-4 h-4 text-[var(--color-primary)]" />
            {t('managePhrases', { defaultValue: 'Manage SmartPhrases' })}
          </h3>
          <button onClick={() => setShowManager(false)} className="btn-ghost p-1">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <button
            onClick={() => setEditingPhrase({ id: '', shortcut: '', title: '', content: '', category: '' })}
            className="btn-primary text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> {t('newPhrase', { defaultValue: 'New Phrase' })}
          </button>

          {phrases.map(phrase => (
            <div key={phrase.id} className="p-3 bg-[var(--color-bg)] rounded-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-medium text-sm text-[var(--color-text)]">{phrase.title}</div>
                  <div className="text-xs text-[var(--color-primary)] font-mono">{phrase.shortcut}</div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-1 line-clamp-2">{phrase.content}</div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-1">{phrase.category}</div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditingPhrase(phrase)} className="btn-ghost p-1">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDeletePhrase(phrase.id)} className="btn-ghost p-1 text-red-600">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {editingPhrase !== null && (
          <PhraseEditor
            phrase={editingPhrase}
            onSave={handleSavePhrase}
            onCancel={() => setEditingPhrase(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
        <h3 className="font-semibold text-[var(--color-text)] flex items-center gap-2">
          <FileText className="w-4 h-4 text-[var(--color-primary)]" />
          {t('smartPhrases', { defaultValue: 'SmartPhrases' })}
        </h3>
        <button onClick={() => setShowManager(true)} className="text-xs text-[var(--color-primary)] hover:underline">
          {t('manage', { defaultValue: 'Manage' })}
        </button>
      </div>

      <div className="p-4 space-y-3">
        <input
          type="text"
          placeholder={t('searchPhrases', { defaultValue: 'Search phrases or type shortcut...' })}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-xs p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-primary)]"
        />

        <div className="flex gap-1 flex-wrap">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`text-xs px-2 py-1 rounded-full ${
                selectedCategory === cat
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'bg-[var(--color-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {filtered.map(phrase => (
            <div
              key={phrase.id}
              onClick={() => handleExpand(phrase)}
              className="p-2 rounded hover:bg-[var(--color-bg)] cursor-pointer border border-transparent hover:border-[var(--color-border)] transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--color-text)]">{phrase.title}</span>
                <span className="text-xs font-mono text-[var(--color-primary)]">{phrase.shortcut}</span>
              </div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-1">{phrase.content}</div>
            </div>
          ))}
        </div>

        <div className="text-xs text-[var(--color-text-muted)] border-t border-[var(--color-border)] pt-2">
          {t('phraseTip', { defaultValue: 'Click a phrase to insert it. Type .shortcut in any text field.' })}
        </div>
      </div>
    </div>
  );
}

interface PhraseEditorProps {
  phrase: Partial<SmartPhrase>;
  onSave: (phrase: Partial<SmartPhrase>) => void;
  onCancel: () => void;
}

function PhraseEditor({ phrase, onSave, onCancel }: PhraseEditorProps) {
  const { t } = useTranslation('dashboard');
  const [shortcut, setShortcut] = useState(phrase.shortcut || '');
  const [title, setTitle] = useState(phrase.title || '');
  const [content, setContent] = useState(phrase.content || '');
  const [category, setCategory] = useState(phrase.category || 'Custom');

  return (
    <div className="card mt-3">
      <div className="p-4 space-y-3">
        <div>
          <label className="text-xs text-[var(--color-text-muted)]">Shortcut</label>
          <input
            type="text"
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
            placeholder=".hpi"
            className="w-full text-sm p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-primary)]"
          />
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-muted)]">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="HPI Template"
            className="w-full text-sm p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-primary)]"
          />
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-muted)]">Category</label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="HPI"
            className="w-full text-sm p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-primary)]"
          />
        </div>
        <div>
          <label className="text-xs text-[var(--color-text-muted)]">Content (use [PLACEHOLDER] for variables)</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Patient presents with [COMPLAINT]..."
            className="w-full h-32 text-sm p-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:border-[var(--color-primary)] resize-none"
          />
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn-ghost text-xs">Cancel</button>
          <button
            onClick={() => onSave({ shortcut, title, content, category })}
            className="btn-primary text-xs flex items-center gap-1"
          >
            <Check className="w-3.5 h-3.5" /> {t('save', { defaultValue: 'Save' })}
          </button>
        </div>
      </div>
    </div>
  );
}
