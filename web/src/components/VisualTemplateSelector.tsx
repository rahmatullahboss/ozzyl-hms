import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Eye, Check, LayoutTemplate, Table, List, Grip } from 'lucide-react';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import toast from 'react-hot-toast';

interface Preset {
  id: number;
  preset_code: string;
  preset_name: string;
  preset_name_bn?: string;
  category: string;
  layout_type: 'table' | 'grid' | 'list' | 'freeform';
  structure_json: string;
  sample_html?: string;
  is_system: number;
}

interface VisualTemplateSelectorProps {
  selectedPresetId?: number | null;
  onSelect?: (preset: Preset | null) => void;
  categoryFilter?: string;
  allowCreate?: boolean;
}

function layoutIcon(type: string) {
  switch (type) {
    case 'table': return <Table className="w-5 h-5" />;
    case 'grid': return <Grip className="w-5 h-5" />;
    case 'list': return <List className="w-5 h-5" />;
    case 'freeform': return <FileText className="w-5 h-5" />;
    default: return <LayoutTemplate className="w-5 h-5" />;
  }
}

function layoutLabel(type: string, t: any) {
  const map: Record<string, string> = {
    table: t('layoutTable') || 'Table',
    grid: t('layoutGrid') || 'Grid',
    list: t('layoutList') || 'List',
    freeform: t('layoutFreeform') || 'Freeform',
  };
  return map[type] || type;
}

function categoryColor(cat: string) {
  const map: Record<string, string> = {
    hematology: 'bg-rose-50 text-rose-700 border-rose-200',
    biochemistry: 'bg-sky-50 text-sky-700 border-sky-200',
    microbiology: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    radiology: 'bg-violet-50 text-violet-700 border-violet-200',
    urine: 'bg-amber-50 text-amber-700 border-amber-200',
  };
  return map[cat] || 'bg-slate-50 text-slate-700 border-slate-200';
}

export default function VisualTemplateSelector({ selectedPresetId, onSelect, categoryFilter, allowCreate = true }: VisualTemplateSelectorProps) {
  const { t, i18n } = useTranslation('laboratory');
  const lang = i18n.language?.startsWith('bn') ? 'bn' : 'en';
  const queryClient = useQueryClient();
  const [previewPreset, setPreviewPreset] = useState<Preset | null>(null);
  const [search, setSearch] = useState('');

  const { data: presetsData, isLoading } = useApiQuery<{ data: Preset[] }>(
    [...queryKeys.laboratory.all, 'template-presets', categoryFilter],
    `/api/lab-monitoring/template-presets${categoryFilter ? `?category=${categoryFilter}` : ''}`,
  );

  const createFromPresetMutation = useApiMutation<any, any>('post', '/api/lab-settings/templates', {
    onSuccess: () => {
      toast.success(t('templateCreatedFromPreset'));
      queryClient.invalidateQueries({ queryKey: queryKeys.labSettings.all });
    },
    onError: (err: any) => toast.error(err.message || t('failed')),
  });

  const presets = presetsData?.data ?? [];

  const filtered = presets.filter(p => {
    const q = search.toLowerCase();
    const name = (lang === 'bn' && p.preset_name_bn ? p.preset_name_bn : p.preset_name).toLowerCase();
    return name.includes(q) || p.category.toLowerCase().includes(q);
  });

  const grouped = filtered.reduce<Record<string, Preset[]>>((acc, p) => {
    if (!acc[p.category]) acc[p.category] = [];
    acc[p.category].push(p);
    return acc;
  }, {});

  function handleUsePreset(preset: Preset) {
    if (onSelect) {
      onSelect(preset);
      return;
    }
    // Default behavior: create a template from preset
    let structure: any;
    try { structure = JSON.parse(preset.structure_json); } catch { structure = {}; }

    const headerHtml = structure.header
      ? `<div class="report-header"><h2>${structure.header.title}</h2><p>${structure.header.subtitle || ''}</p></div>`
      : '';

    const footerHtml = structure.footer
      ? `<div class="report-footer"><p>${(structure.footer.signatoryLines || []).join(' / ')}</p>${structure.footer.note ? `<small>${structure.footer.note}</small>` : ''}</div>`
      : '';

    createFromPresetMutation.mutate({
      template_name: lang === 'bn' && preset.preset_name_bn ? preset.preset_name_bn : preset.preset_name,
      template_code: preset.preset_code,
      header_html: headerHtml,
      footer_html: footerHtml,
      is_default: false,
    });
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-xl border border-[var(--color-border)] p-4 animate-pulse space-y-3">
            <div className="h-4 bg-[var(--color-bg-secondary)] rounded w-3/4" />
            <div className="h-20 bg-[var(--color-bg-secondary)] rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative max-w-sm">
        <input
          type="text"
          placeholder={t('searchTemplates') || 'Search templates...'}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-4 py-2 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>

      {/* Presets by category */}
      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-8 text-[var(--color-text-muted)] text-sm">
          {t('noTemplatesFound') || 'No templates found.'}
        </div>
      ) : (
        Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="space-y-3">
            <h4 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
              {category}
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map(preset => {
                const isSelected = selectedPresetId === preset.id;
                const displayName = lang === 'bn' && preset.preset_name_bn ? preset.preset_name_bn : preset.preset_name;
                let structure: any = {};
                try { structure = JSON.parse(preset.structure_json); } catch {}
                const sectionCount = structure.sections?.length ?? 0;
                const paramCount = structure.sections?.reduce((acc: number, s: any) => acc + (s.rows?.length ?? 0), 0) ?? 0;

                return (
                  <div
                    key={preset.id}
                    className={`relative rounded-xl border p-4 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-sky-500 bg-sky-50 shadow-sm'
                        : 'border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-primary)] hover:shadow-sm'
                    }`}
                    onClick={() => onSelect?.(preset)}
                  >
                    {isSelected && (
                      <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center">
                        <Check className="w-3.5 h-3.5" />
                      </div>
                    )}
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`p-2 rounded-lg ${categoryColor(preset.category)}`}>
                        {layoutIcon(preset.layout_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h5 className="font-semibold text-sm text-[var(--color-text)] truncate">{displayName}</h5>
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{layoutLabel(preset.layout_type, t)} · {sectionCount} {t('sections')} · {paramCount} {t('parameters')}</p>
                      </div>
                    </div>

                    {/* Mini preview */}
                    <div className="rounded-lg border border-[var(--color-border-light)] bg-[var(--color-bg-secondary)] p-2 text-xs text-[var(--color-text-muted)] space-y-1">
                      {structure.header && (
                        <div className="font-medium text-[var(--color-text)]">{structure.header.title}</div>
                      )}
                      {structure.sections?.slice(0, 2).map((sec: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-[var(--color-text-muted)]" />
                          <span className="truncate">{sec.title}</span>
                        </div>
                      ))}
                      {sectionCount > 2 && (
                        <div className="text-[10px] text-[var(--color-text-muted)]">+{sectionCount - 2} more sections</div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={e => { e.stopPropagation(); setPreviewPreset(preset); }}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />{t('preview')}
                      </button>
                      {allowCreate && (
                        <button
                          onClick={e => { e.stopPropagation(); handleUsePreset(preset); }}
                          disabled={createFromPresetMutation.isPending}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-60 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />{t('use')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      {/* Preview Modal */}
      {previewPreset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) setPreviewPreset(null); }}>
          <div
            className="bg-[var(--color-bg)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-modal-title"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <h3 id="preview-modal-title" className="font-semibold text-[var(--color-text)]">
                {lang === 'bn' && previewPreset.preset_name_bn ? previewPreset.preset_name_bn : previewPreset.preset_name}
              </h3>
              <button
                onClick={() => setPreviewPreset(null)}
                className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                aria-label={t('close')}
              >
                ✕
              </button>
            </div>
            <div className="p-6">
              <TemplatePreview structure={previewPreset.structure_json} />
            </div>
            <div className="flex gap-3 px-6 pb-6">
              <button onClick={() => setPreviewPreset(null)} className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors">
                {t('close')}
              </button>
              {allowCreate && (
                <button
                  onClick={() => { handleUsePreset(previewPreset); setPreviewPreset(null); }}
                  disabled={createFromPresetMutation.isPending}
                  className="flex-1 py-2 rounded-lg bg-[var(--color-primary)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-60 transition-colors"
                >
                  {createFromPresetMutation.isPending ? t('creating') : t('useThisTemplate')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Template Preview Renderer ─── */
function TemplatePreview({ structure }: { structure: string }) {
  let data: any = {};
  try { data = JSON.parse(structure); } catch { return <div className="text-red-500 text-sm">Invalid template structure</div>; }

  return (
    <div className="space-y-4">
      {/* Header */}
      {data.header && (
        <div className="text-center border-b border-[var(--color-border)] pb-3">
          <h2 className="text-lg font-bold text-[var(--color-text)]">{data.header.title}</h2>
          {data.header.subtitle && <p className="text-sm text-[var(--color-text-muted)]">{data.header.subtitle}</p>}
        </div>
      )}

      {/* Patient info mock */}
      {data.patientFields && (
        <div className="grid grid-cols-3 gap-2 text-xs text-[var(--color-text-secondary)] bg-[var(--color-bg-secondary)] rounded-lg p-3">
          {data.patientFields.map((field: string) => (
            <div key={field}>
              <span className="text-[var(--color-text-muted)] capitalize">{field.replace(/_/g, ' ')}:</span>
              <span className="ml-1 font-medium">...</span>
            </div>
          ))}
        </div>
      )}

      {/* Sections */}
      {data.sections?.map((section: any, idx: number) => (
        <div key={idx} className="space-y-2">
          <h4 className="text-sm font-semibold text-[var(--color-text)]">{section.title}</h4>
          <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Parameter</th>
                  <th className="text-left px-3 py-2 font-medium">Result</th>
                  <th className="text-left px-3 py-2 font-medium">Unit</th>
                  <th className="text-left px-3 py-2 font-medium">Reference Range</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border-light)]">
                {section.rows?.map((row: any, ridx: number) => (
                  <tr key={ridx}>
                    <td className="px-3 py-2 text-[var(--color-text)]">{row.param}</td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">—</td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">{row.unit}</td>
                    <td className="px-3 py-2 text-[var(--color-text-muted)]">{row.range}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Footer */}
      {data.footer && (
        <div className="border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
          {data.footer.signatoryLines && (
            <div className="flex gap-6 mt-2">
              {data.footer.signatoryLines.map((line: string, idx: number) => (
                <div key={idx} className="flex-1 text-center">
                  <div className="border-b border-[var(--color-border)] pb-1 mb-1">_________________</div>
                  <div>{line}</div>
                </div>
              ))}
            </div>
          )}
          {data.footer.note && <p className="mt-2 text-center italic">{data.footer.note}</p>}
        </div>
      )}
    </div>
  );
}
