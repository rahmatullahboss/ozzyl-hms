import { useState } from 'react';
import { Layers, Plus, X, List, Hash, Calendar, Type, Settings, Eye, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';

interface LbfForm {
  FormId: number;
  FormName: string;
  FormTitle: string;
  Category: string;
  IsActive: boolean;
  FieldCount?: number;
}

interface LbfField {
  FieldId: number;
  FieldName: string;
  FieldLabel: string;
  FieldType: string;
  DisplayOrder: number;
  IsRequired: boolean;
}

export default function CustomFormBuilder({ role }: { role?: string }) {
  const { t } = useTranslation('forms');
  const queryClient = useQueryClient();
  const [selectedForm, setSelectedForm] = useState<LbfForm | null>(null);
  const [formFields, setFormFields] = useState<LbfField[]>([]);

  // Modals
  const [showNewForm, setShowNewForm] = useState(false);
  const [showNewField, setShowNewField] = useState(false);

  // Form Creation State
  const [newFormName, setNewFormName] = useState('');
  const [newFormTitle, setNewFormTitle] = useState('');
  const [newFormCategory, setNewFormCategory] = useState('clinical');

  // Field Creation State
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldLabel, setNewFieldLabel] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [newFieldDataType, setNewFieldDataType] = useState('string');

  const { data: formsData, isLoading: loading } = useApiQuery<{ Results?: LbfForm[] }>(
    queryKeys.lbfForms.list(),
    '/api/lbf-forms',
  );
  const forms = formsData?.Results || [];

  const loadFormFields = async (formId: number) => {
    try {
      const data = await api.get<{ Results?: { fields?: LbfField[] } }>(`/api/lbf-forms/${formId}`);
      setFormFields(data.Results?.fields || []);
    } catch {
      toast.error(t('failedToLoadFields'));
      setFormFields([]);
    }
  };

  const handleSelectForm = (form: LbfForm) => {
    setSelectedForm(form);
    loadFormFields(form.FormId);
  };

  const createFormMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/lbf-forms',
    {
      onSuccess: () => {
        toast.success(t('formCreated'));
        setShowNewForm(false);
        setNewFormName('');
        setNewFormTitle('');
        queryClient.invalidateQueries({ queryKey: queryKeys.lbfForms.all });
      },
      onError: (err) => {
        toast.error(err.message || t('failedToCreateForm'));
      },
    },
  );

  const handleCreateForm = async (e: React.FormEvent) => {
    e.preventDefault();
    createFormMutation.mutate({
      FormName: newFormName.toLowerCase().replace(/[^a-z0-9_]/g, '_'),
      FormTitle: newFormTitle,
      Category: newFormCategory,
      FormSchema: {},
    });
  };

  const createFieldMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    (variables: Record<string, unknown>) => `/api/lbf-forms/${variables._formId}/fields`,
    {
      onSuccess: () => {
        toast.success(t('fieldAdded'));
        setShowNewField(false);
        setNewFieldName('');
        setNewFieldLabel('');
        if (selectedForm) loadFormFields(selectedForm.FormId);
        queryClient.invalidateQueries({ queryKey: queryKeys.lbfForms.all });
      },
      onError: (err) => {
        toast.error(err.message || t('failedToAddField'));
      },
    },
  );

  const handleCreateField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedForm) return;
    createFieldMutation.mutate({
      _formId: selectedForm.FormId,
      FieldName: newFieldName,
      FieldLabel: newFieldLabel,
      FieldType: newFieldType,
      DataType: newFieldDataType,
      DisplayOrder: formFields.length * 10,
    });
  };

  const getFieldIcon = (type: string) => {
    switch (type) {
      case 'text': case 'textarea': return <Type className="w-4 h-4" />;
      case 'number': return <Hash className="w-4 h-4" />;
      case 'date': return <Calendar className="w-4 h-4" />;
      case 'select': case 'radio': return <List className="w-4 h-4" />;
      default: return <Layers className="w-4 h-4" />;
    }
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto h-[max(80vh,600px)] flex flex-col space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
              <Layers className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title')}</h1>
              <p className="text-sm text-[var(--color-text-muted)]">{t('subtitle')}</p>
            </div>
          </div>
          <button onClick={() => setShowNewForm(true)} className="btn btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> {t('newForm')}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 min-h-0">
          {/* Form List Sidebar */}
          <div className="lg:col-span-4 card flex flex-col overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] font-bold text-sm text-[var(--color-text)]">
              {t('formsLibrary')}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="text-center p-4 text-[var(--color-text-muted)] text-sm">{t('loading')}</div>
              ) : forms.length === 0 ? (
                <div className="text-center p-4 text-[var(--color-text-muted)] text-sm">{t('noForms')}</div>
              ) : (
                <div className="space-y-1">
                  {forms.map(form => (
                    <button
                      key={form.FormId}
                      onClick={() => handleSelectForm(form)}
                      className={`w-full text-left p-3 rounded-lg border transition-colors flex items-center justify-between group ${
                        selectedForm?.FormId === form.FormId
                          ? 'bg-purple-50 border-purple-200 text-purple-900 dark:bg-purple-900/20 dark:border-purple-800'
                          : 'bg-transparent border-transparent hover:bg-[var(--color-bg-secondary)]'
                      }`}
                    >
                      <div>
                        <div className="font-semibold text-sm">{form.FormTitle}</div>
                        <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{form.Category} • {form.FormName}</div>
                      </div>
                      <Settings className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-text-muted)]" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Form Builder / Fields */}
          <div className="lg:col-span-8 card flex flex-col overflow-hidden">
            {selectedForm ? (
              <>
                <div className="p-5 border-b border-[var(--color-border)] bg-gradient-to-r from-purple-50 to-transparent dark:from-purple-950/20 flex items-center justify-between shrink-0">
                  <div>
                    <h2 className="font-bold text-lg text-[var(--color-text)]">{selectedForm.FormTitle}</h2>
                    <p className="text-xs text-[var(--color-text-muted)] mt-1 font-mono">{selectedForm.FormName}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="btn btn-secondary flex items-center gap-2"><Eye className="w-4 h-4" /> {t('preview')}</button>
                    <button onClick={() => setShowNewField(true)} className="btn bg-purple-600 text-white hover:bg-purple-700 flex items-center gap-2">
                      <Plus className="w-4 h-4" /> {t('addField')}
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 bg-[var(--color-bg-secondary)]/30">
                  {formFields.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                      <Layers className="w-12 h-12 opacity-20 mb-4" />
                      <p className="font-medium">{t('noFields')}</p>
                      <button onClick={() => setShowNewField(true)} className="mt-4 text-purple-600 text-sm font-semibold hover:underline">
                        {t('addFirstField')}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {formFields.map((field) => (
                        <div key={field.FieldId} className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-4 shadow-sm flex items-center justify-between group">
                          <div className="flex items-center gap-4">
                            <div className="p-2 bg-[var(--color-bg-secondary)] rounded-md text-[var(--color-text-muted)]">
                              {getFieldIcon(field.FieldType)}
                            </div>
                            <div>
                              <div className="font-semibold text-sm flex items-center gap-2">
                                {field.FieldLabel}
                                {field.IsRequired && <span className="text-red-500">*</span>}
                              </div>
                              <div className="text-xs text-[var(--color-text-muted)] mt-1 font-mono">{field.FieldName} ({field.FieldType})</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button className="p-1.5 text-[var(--color-text-muted)] hover:text-purple-600 transition-colors"><Edit2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <Layers className="w-16 h-16 opacity-10 mb-4" />
                <p className="font-medium">{t('selectForm')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New Form Modal */}
      {showNewForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-[var(--color-bg-primary)] rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <h3 className="font-bold text-[var(--color-text)]">{t('createForm')}</h3>
              <button onClick={() => setShowNewForm(false)} className="btn btn-secondary p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreateForm} className="p-6 space-y-4">
              <div>
                <label className="label">{t('formTitle')}</label>
                <input required placeholder={t('formTitlePlaceholder')} value={newFormTitle} onChange={e => setNewFormTitle(e.target.value)} className="input w-full" />
              </div>
              <div>
                <label className="label flex justify-between">
                  <span>{t('systemName')}</span>
                  <span className="text-xs font-normal opacity-70">{t('systemNameHint')}</span>
                </label>
                <input required placeholder={t('systemNamePlaceholder')} value={newFormName} onChange={e => setNewFormName(e.target.value)} className="input w-full font-mono text-sm" />
              </div>
              <div>
                <label className="label">{t('category')}</label>
                <select value={newFormCategory} onChange={e => setNewFormCategory(e.target.value)} className="input w-full">
                  <option value="clinical">{t('clinical')}</option>
                  <option value="administrative">{t('administrative')}</option>
                  <option value="screening">{t('screening')}</option>
                  <option value="custom">{t('custom')}</option>
                </select>
              </div>
              <div className="pt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setShowNewForm(false)} className="btn btn-secondary">{t('cancel')}</button>
                <button type="submit" disabled={createFormMutation.isPending} className="btn btn-primary min-w-[100px]">{createFormMutation.isPending ? t('saving') : t('createFormBtn')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Field Modal */}
      {showNewField && selectedForm && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
          <div className="bg-[var(--color-bg-primary)] rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
              <h3 className="font-bold text-[var(--color-text)]">{t('addFieldTitle', { form: selectedForm.FormTitle })}</h3>
              <button onClick={() => setShowNewField(false)} className="btn btn-secondary p-1.5"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={handleCreateField} className="p-6 space-y-4">
              <div>
                <label className="label">{t('fieldLabel')}</label>
                <input required placeholder={t('fieldLabelPlaceholder')} value={newFieldLabel} onChange={e => setNewFieldLabel(e.target.value)} className="input w-full" />
              </div>
              <div>
                <label className="label">{t('fieldName')}</label>
                <input required placeholder={t('fieldNamePlaceholder')} value={newFieldName} onChange={e => setNewFieldName(e.target.value)} className="input w-full font-mono text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('uiType')}</label>
                  <select value={newFieldType} onChange={e => {
                    setNewFieldType(e.target.value);
                    if(e.target.value === 'number') setNewFieldDataType('number');
                    if(e.target.value === 'date') setNewFieldDataType('date');
                  }} className="input w-full">
                    <option value="text">{t('shortText')}</option>
                    <option value="textarea">{t('longText')}</option>
                    <option value="number">{t('number')}</option>
                    <option value="date">{t('date')}</option>
                    <option value="select">{t('dropdown')}</option>
                    <option value="checkbox">{t('checkbox')}</option>
                    <option value="radio">{t('radio')}</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('dataType')}</label>
                  <select value={newFieldDataType} onChange={e => setNewFieldDataType(e.target.value)} className="input w-full">
                    <option value="string">{t('string')}</option>
                    <option value="number">{t('number')}</option>
                    <option value="boolean">{t('boolean')}</option>
                    <option value="array">{t('array')}</option>
                    <option value="date">{t('date')}</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-2">
                <button type="button" onClick={() => setShowNewField(false)} className="btn btn-secondary">{t('cancel')}</button>
                <button type="submit" disabled={createFieldMutation.isPending} className="btn bg-purple-600 text-white hover:bg-purple-700 min-w-[100px]">{createFieldMutation.isPending ? t('saving') : t('addFieldBtn')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </DashboardLayout>
  );
}
