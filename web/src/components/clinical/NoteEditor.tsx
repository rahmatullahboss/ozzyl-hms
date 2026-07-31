import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { X, Save, FileSignature } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient';

import ProgressNote from './templates/ProgressNote';
import type { ProgressNoteData } from './templates/ProgressNote';
import HistoryPhysicalNote from './templates/HistoryPhysicalNote';
import type { HistoryPhysicalData } from './templates/HistoryPhysicalNote';
import ProcedureNote from './templates/ProcedureNote';
import type { ProcedureNoteData } from './templates/ProcedureNote';
import EmergencyNote from './templates/EmergencyNote';
import type { EmergencyNoteData } from './templates/EmergencyNote';
import FreeTextNote from './templates/FreeTextNote';
import type { FreeTextNoteData } from './templates/FreeTextNote';
import ConsultNote from './templates/ConsultNote';
import type { ConsultNoteData } from './templates/ConsultNote';

type NoteType = 'progress' | 'soap' | 'procedure' | 'consultation' | 'discharge' | 'history_physical' | 'operative' | 'referral' | 'telephone' | 'other';

interface ClinicalNote {
  id: number;
  patient_id: number;
  visit_id?: number;
  note_type: NoteType;
  title?: string;
  content?: string;
  chief_complaint?: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  follow_up?: string;
  follow_up_unit?: string;
  template_id?: number;
  performer_id?: number;
  is_signed: number;
  signed_at?: string;
  created_at: string;
  updated_at?: string;
}

interface Props {
  patientId: string;
  note?: ClinicalNote | null;
  onClose?: () => void;
}

const NOTE_TYPES: { value: NoteType; label: string }[] = [
  { value: 'progress', label: 'Progress Note' },
  { value: 'history_physical', label: 'History & Physical' },
  { value: 'procedure', label: 'Procedure Note' },
  { value: 'consultation', label: 'Consultation' },
  { value: 'other', label: 'Free Text' },
];

// Fields that map directly to database columns
interface BaseFormData {
  content: string;
  chiefComplaint: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  followUp: string;
}

const emptyBase = (): BaseFormData => ({
  content: '',
  chiefComplaint: '',
  subjective: '',
  objective: '',
  assessment: '',
  plan: '',
  followUp: '',
});

const emptyProgress = (): ProgressNoteData => ({
  subjective: '', objective: '', assessment: '', plan: '', followUp: '',
});

const emptyHP = (): HistoryPhysicalData => ({
  chiefComplaint: '', hpi: '', ros: '', subjective: '', objective: '', assessment: '', plan: '',
});

const emptyProcedure = (): ProcedureNoteData => ({
  site: '', procedureDetails: '', findings: '', complications: '', freeText: '',
});

const emptyEmergency = (): EmergencyNoteData => ({
  modeOfArrival: '', broughtBy: '', phoneNumber: '', triageTime: '', triagedBy: '',
  trauma: false, disposition: '', erCourseDescription: '',
  subjective: '', objective: '', assessment: '', plan: '',
});

const emptyFreeText = (): FreeTextNoteData => ({ content: '' });

const emptyConsult = (): ConsultNoteData => ({
  consultantName: '', reasonForConsult: '', chiefComplaint: '',
  hpi: '', ros: '', subjective: '', objective: '', assessment: '', plan: '',
});

export default function NoteEditor({ patientId, note, onClose }: Props) {
  const { t } = useTranslation(['clinical']);
  const isEditing = !!note;
  const isSigned = note?.is_signed === 1;

  const [noteType, setNoteType] = useState<NoteType>(note?.note_type || 'progress');
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);

  // Template-specific state
  const [progressData, setProgressData] = useState<ProgressNoteData>(emptyProgress());
  const [hpData, setHpData] = useState<HistoryPhysicalData>(emptyHP());
  const [procedureData, setProcedureData] = useState<ProcedureNoteData>(emptyProcedure());
  const [emergencyData, setEmergencyData] = useState<EmergencyNoteData>(emptyEmergency());
  const [freeTextData, setFreeTextData] = useState<FreeTextNoteData>(emptyFreeText());
  const [consultData, setConsultData] = useState<ConsultNoteData>(emptyConsult());

  // Populate form when editing
  useEffect(() => {
    if (!note) return;
    setNoteType(note.note_type);

    switch (note.note_type) {
      case 'progress':
      case 'soap':
        setProgressData({
          subjective: note.subjective || '',
          objective: note.objective || '',
          assessment: note.assessment || '',
          plan: note.plan || '',
          followUp: note.follow_up || '',
        });
        break;
      case 'history_physical':
        setHpData({
          chiefComplaint: note.chief_complaint || '',
          hpi: '', ros: '',
          subjective: note.subjective || '',
          objective: note.objective || '',
          assessment: note.assessment || '',
          plan: note.plan || '',
        });
        break;
      case 'procedure':
        try {
          const parsed = JSON.parse(note.content || '{}');
          setProcedureData({
            site: parsed.site || '',
            procedureDetails: parsed.procedureDetails || '',
            findings: parsed.findings || '',
            complications: parsed.complications || '',
            freeText: parsed.freeText || '',
          });
        } catch {
          setProcedureData({ ...emptyProcedure(), freeText: note.content || '' });
        }
        break;
      case 'consultation':
        try {
          const parsed = JSON.parse(note.content || '{}');
          setConsultData({
            consultantName: parsed.consultantName || '',
            reasonForConsult: parsed.reasonForConsult || '',
            chiefComplaint: note.chief_complaint || '',
            hpi: parsed.hpi || '',
            ros: parsed.ros || '',
            subjective: note.subjective || '',
            objective: note.objective || '',
            assessment: note.assessment || '',
            plan: note.plan || '',
          });
        } catch {
          setConsultData({
            ...emptyConsult(),
            chiefComplaint: note.chief_complaint || '',
            subjective: note.subjective || '',
            objective: note.objective || '',
            assessment: note.assessment || '',
            plan: note.plan || '',
          });
        }
        break;
      default:
        // For discharge, operative, referral, telephone, other - use free text
        setFreeTextData({ content: note.content || '' });
        break;
    }
  }, [note]);

  const buildPayload = () => {
    const base: Record<string, unknown> = {
      patientId: Number(patientId),
      noteType,
    };

    switch (noteType) {
      case 'progress':
      case 'soap': {
        base.content = [
          progressData.subjective && `S: ${progressData.subjective}`,
          progressData.objective && `O: ${progressData.objective}`,
          progressData.assessment && `A: ${progressData.assessment}`,
          progressData.plan && `P: ${progressData.plan}`,
        ].filter(Boolean).join('\n\n') || 'Progress note';
        base.subjective = progressData.subjective || null;
        base.objective = progressData.objective || null;
        base.assessment = progressData.assessment || null;
        base.plan = progressData.plan || null;
        base.followUp = progressData.followUp || null;
        break;
      }
      case 'history_physical': {
        base.content = [
          hpData.chiefComplaint && `CC: ${hpData.chiefComplaint}`,
          hpData.hpi && `HPI: ${hpData.hpi}`,
          hpData.ros && `ROS: ${hpData.ros}`,
          hpData.subjective && `S: ${hpData.subjective}`,
          hpData.objective && `O: ${hpData.objective}`,
          hpData.assessment && `A: ${hpData.assessment}`,
          hpData.plan && `P: ${hpData.plan}`,
        ].filter(Boolean).join('\n\n') || 'History & Physical';
        base.chiefComplaint = hpData.chiefComplaint || null;
        base.subjective = hpData.subjective || null;
        base.objective = hpData.objective || null;
        base.assessment = hpData.assessment || null;
        base.plan = hpData.plan || null;
        break;
      }
      case 'procedure': {
        base.content = JSON.stringify(procedureData);
        base.subjective = procedureData.freeText || null;
        break;
      }
      case 'consultation': {
        base.content = JSON.stringify(consultData);
        base.chiefComplaint = consultData.chiefComplaint || null;
        base.subjective = consultData.subjective || null;
        base.objective = consultData.objective || null;
        base.assessment = consultData.assessment || null;
        base.plan = consultData.plan || null;
        break;
      }
      default: {
        // Free text for discharge, operative, referral, telephone, other
        base.content = freeTextData.content || 'Clinical note';
        break;
      }
    }

    return base;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isEditing && note) {
        await apiFetch(`/api/clinical/notes/${note.id}`, { method: 'PUT', body: payload });
        toast.success(t('toast.noteUpdated', 'Note updated'));
      } else {
        await apiFetch('/api/clinical/notes', { method: 'POST', body: payload });
        toast.success(t('toast.noteCreated', 'Note created'));
      }
      onClose?.();
    } catch (err: any) {
      toast.error(err?.message || t('toast.noteSaveFailed', 'Failed to save note'));
    } finally {
      setSaving(false);
    }
  };

  const handleSign = async () => {
    if (!note) return;
    if (!confirm(t('notes.confirmSign', 'Signing will lock this note from further edits. Continue?'))) return;
    setSigning(true);
    try {
      await apiFetch(`/api/clinical/notes/${note.id}/sign`, { method: 'PUT', body: {} });
      toast.success(t('toast.noteSigned', 'Note signed'));
      onClose?.();
    } catch (err: any) {
      toast.error(err?.message || t('toast.noteSignFailed', 'Failed to sign note'));
    } finally {
      setSigning(false);
    }
  };

  const handleTypeChange = (newType: NoteType) => {
    setNoteType(newType);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {isEditing
              ? t('notes.editNote', 'Edit Clinical Note')
              : t('notes.newNote', 'New Clinical Note')}
            {isSigned && (
              <span className="ml-2 text-sm font-normal text-amber-600">
                ({t('notes.signed', 'Signed')})
              </span>
            )}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1" aria-label={t('common.close', 'Close')} title={t('common.close', 'Close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Note type selector */}
          {!isEditing && (
            <div>
              <label className="label">{t('notes.noteType', 'Note Type')}</label>
              <select
                className="input"
                value={noteType}
                onChange={e => handleTypeChange(e.target.value as NoteType)}
                disabled={isSigned}
              >
                {NOTE_TYPES.map(nt => (
                  <option key={nt.value} value={nt.value}>{nt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Template forms */}
          {(noteType === 'progress' || noteType === 'soap') && (
            <ProgressNote
              data={progressData}
              onChange={(field, value) => setProgressData(prev => ({ ...prev, [field]: value }))}
              disabled={isSigned}
            />
          )}

          {noteType === 'history_physical' && (
            <HistoryPhysicalNote
              data={hpData}
              onChange={(field, value) => setHpData(prev => ({ ...prev, [field]: value }))}
              disabled={isSigned}
            />
          )}

          {noteType === 'procedure' && (
            <ProcedureNote
              data={procedureData}
              onChange={(field, value) => setProcedureData(prev => ({ ...prev, [field]: value }))}
              disabled={isSigned}
            />
          )}

          {noteType === 'consultation' && (
            <ConsultNote
              data={consultData}
              onChange={(field, value) => setConsultData(prev => ({ ...prev, [field]: value }))}
              disabled={isSigned}
            />
          )}

          {!['progress', 'soap', 'history_physical', 'procedure', 'consultation'].includes(noteType) && (
            <FreeTextNote
              data={freeTextData}
              onChange={(field, value) => setFreeTextData(prev => ({ ...prev, [field]: value }))}
              disabled={isSigned}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose} className="btn-ghost">
            {t('common.cancel', 'Cancel')}
          </button>
          {!isSigned && (
            <>
              {isEditing && note && (
                <button onClick={handleSign} disabled={signing} className="btn-ghost text-amber-600">
                  <FileSignature className="w-4 h-4" />
                  {signing ? t('common.signing', 'Signing...') : t('notes.sign', 'Sign')}
                </button>
              )}
              <button onClick={handleSave} disabled={saving} className="btn-primary">
                <Save className="w-4 h-4" />
                {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
