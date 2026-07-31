import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useParams, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { getRoleBasePath } from '../lib/handover';
import { useApiMutation, useApiQuery } from '../hooks/useApiQuery';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../lib/queryKeys';
import { ApiClientError } from '../lib/apiClient';
import { calculateAgePartsFromDateOfBirth, estimateDateOfBirthFromAgeParts, formatAgeFromParts } from '../lib/age';
import { createPatientRegistrationAttemptTracker } from '../lib/patientRegistrationAttempt';
import { Zap } from 'lucide-react';

interface PatientPayload {
  name: string;
  fatherHusband?: string;
  address?: string;
  // Mobile is now conditional-optional. When the receptionist has no
  // number to give, `mobile` is omitted and `mobileMissingReason` plus
  // alternative contact (guardian or structured address) must be sent.
  mobile?: string;
  mobileMissingReason?: string;
  guardianName?: string;
  guardianRelation?: string;
  guardianMobile?: string;
  village?: string;
  unionName?: string;
  upazila?: string;
  district?: string;
  division?: string;
  age?: number;
  dateOfBirth?: string;
  gender?: string;
  bloodGroup?: string;
  duplicateOverrideReason?: string;
  idempotencyKey?: string;
}

interface PatientResponse {
  serial: string;
  id: number;
}

interface PatientDetail {
  id: number;
  patient_code: string;
  name: string;
  father_husband: string | null;
  address: string | null;
  mobile: string | null;
  guardian_mobile: string | null;
  age: number | null;
  gender: string | null;
  blood_group: string | null;
  date_of_birth: string | null;
}

interface PatientDetailResponse {
  patient: PatientDetail;
}

interface PossibleDuplicate {
  id?: number;
  patient_id?: number;
  identity_id?: number;
  scope?: string;
  name?: string;
  patient_code?: string;
  mobile?: string;
  mobile_masked?: string;
  date_of_birth?: string;
  gender?: string;
  match_reasons?: string[];
}

interface DuplicateWarningPayload {
  code?: string;
  message?: string;
  possibleDuplicates?: PossibleDuplicate[];
  overrideRequired?: boolean;
}

const BANGLADESH_LOCATION_SUGGESTIONS = [
  'Dhaka, Dhanmondi',
  'Dhaka, Mirpur',
  'Dhaka, Uttara',
  'Dhaka, Mohammadpur',
  'Dhaka, Jatrabari',
  'Gazipur, Tongi',
  'Narayanganj, Fatullah',
  'Chattogram, Agrabad',
  'Chattogram, Halishahar',
  'Cumilla, Kandirpar',
  'Sylhet, Zindabazar',
  'Rajshahi, Boalia',
  'Khulna, Sonadanga',
  'Barishal, Sadar',
  'Rangpur, Sadar',
  'Mymensingh, Sadar',
];

function parseAgeInput(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return undefined;
  return parsed;
}

export default function PatientForm({ role = 'hospital_admin' }: { role?: string }) {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const isEditMode = Boolean(editId);
  const base = getRoleBasePath(slug ?? '', role);
  const { t } = useTranslation(['patients', 'common']);
  const queryClient = useQueryClient();
  const registrationAttemptTrackerRef = useRef(createPatientRegistrationAttemptTracker());

  const [formData, setFormData] = useState({
    name: '',
    fatherHusband: '',
    address: '',
    mobile: '',
    mobileMissing: false,
    mobileMissingReason: '',
    guardianName: '',
    guardianRelation: '',
    guardianMobile: '',
    village: '',
    unionName: '',
    upazila: '',
    district: '',
    division: '',
    age: '',
    ageMonths: '',
    ageDays: '',
    dateOfBirth: '',
    gender: '',
    bloodGroup: '',
  });
  const [possibleDuplicates, setPossibleDuplicates] = useState<PossibleDuplicate[]>([]);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState('');
  const [quickMode, setQuickMode] = useState(false);
  const [quickRegisteredPatient, setQuickRegisteredPatient] = useState<{ id: number; serial: string } | null>(null);
  const patientSubmitLockRef = useRef(false);

  // Fetch patient data when in edit mode
  const { data: patientData, isLoading: patientLoading } = useApiQuery<PatientDetailResponse>(
    queryKeys.patients.detail(Number(editId)),
    `/api/patients/${editId}`,
    { enabled: isEditMode },
  );

  // Pre-fill form when patient data loads in edit mode
  useEffect(() => {
    if (isEditMode && patientData?.patient) {
      const p = patientData.patient;
      const ageParts = calculateAgePartsFromDateOfBirth(p.date_of_birth);
      setFormData({
        name: p.name ?? '',
        fatherHusband: p.father_husband ?? '',
        address: p.address ?? '',
        mobile: p.mobile ?? '',
        mobileMissing: !p.mobile,
        mobileMissingReason: '',
        guardianName: '',
        guardianRelation: '',
        guardianMobile: p.guardian_mobile ?? '',
        village: '',
        unionName: '',
        upazila: '',
        district: '',
        division: '',
        age: ageParts ? String(ageParts.years) : (p.age != null ? String(p.age) : ''),
        ageMonths: ageParts ? String(ageParts.months) : '',
        ageDays: ageParts ? String(ageParts.days) : '',
        dateOfBirth: p.date_of_birth ?? '',
        gender: p.gender ?? '',
        bloodGroup: p.blood_group ?? '',
      });
    }
  }, [isEditMode, patientData]);

  const createMutation = useApiMutation<PatientResponse, PatientPayload>(
    'post',
    '/api/patients',
    {
        onSuccess: (data) => {
          registrationAttemptTrackerRef.current.reset();
          queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
          setPossibleDuplicates([]);
          setDuplicateOverrideReason('');
          if (quickMode) {
            setQuickRegisteredPatient(data);
            toast.success('Patient registered. Complete full profile?');
          } else {
            toast.success(`${t('patientRegistered')} ${data.serial}`);
            navigate(`${base}/patients`);
          }
        },
      onError: (error) => {
        if (error instanceof ApiClientError && error.status === 409) {
          const payload = error.payload as DuplicateWarningPayload | null;
          if (payload?.code === 'POSSIBLE_DUPLICATE_PATIENT') {
            registrationAttemptTrackerRef.current.reset();
            setPossibleDuplicates(payload.possibleDuplicates ?? []);
            toast.error(payload.message ?? 'Possible duplicate patient found');
            return;
          }
        }
        // Preserve the key when the outcome is uncertain (transport/5xx) or
        // the same request is still processing, so a retry can replay safely.
        const isProcessingConflict = error instanceof ApiClientError
          && error.status === 409
          && error.message.includes('already being processed');
        if (error instanceof ApiClientError && error.status < 500 && !isProcessingConflict) {
          registrationAttemptTrackerRef.current.reset();
        }
        toast.error(error.message || t('registrationFailed'));
      },
      onSettled: () => {
        patientSubmitLockRef.current = false;
      },
    },
  );

  const updateMutation = useApiMutation<PatientResponse, Partial<PatientPayload>>(
    'put',
    `/api/patients/${editId}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.patients.all });
        toast.success(t('patientUpdated', { defaultValue: 'Patient updated successfully' }));
        navigate(`${base}/patients`);
      },
      onError: (error) => {
        toast.error(error.message || t('updateFailed', { defaultValue: 'Failed to update patient' }));
      },
      onSettled: () => {
        patientSubmitLockRef.current = false;
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (patientSubmitLockRef.current) return;
    // The conditional-optional mobile contract:
    //   - If the receptionist typed a number, send it and the form is done.
    //   - If the mobile field is "not available", send the reason + at
    //     least one of (named guardian, structured address) so the
    //     patient remains reachable + searchable.
    const mobileTrimmed = formData.mobile.trim();
    const sendingMobile = !formData.mobileMissing && mobileTrimmed ? mobileTrimmed : undefined;
    const sendingReason = formData.mobileMissing && !mobileTrimmed
      ? formData.mobileMissingReason || undefined
      : undefined;
    const sendingGuardian = formData.guardianName.trim() || undefined;
    const sendingGuardianRelation = formData.guardianRelation || undefined;
    const sendingGuardianMobile = formData.guardianMobile.trim() || undefined;
    const hasStructuredAddress = Boolean(
      formData.village.trim()
      && formData.unionName.trim()
      && formData.upazila.trim()
      && formData.district.trim(),
    );
    const ageYears = parseAgeInput(formData.age);
    const ageMonths = parseAgeInput(formData.ageMonths);
    const ageDays = parseAgeInput(formData.ageDays);
    const hasAgeParts = ageYears !== undefined || ageMonths !== undefined || ageDays !== undefined;
    const dateOfBirth = formData.dateOfBirth
      || (hasAgeParts ? estimateDateOfBirthFromAgeParts({ years: ageYears ?? 0, months: ageMonths ?? 0, days: ageDays ?? 0 }) ?? '' : '');

    if (!dateOfBirth && !hasAgeParts) {
      toast.error(t('ageOrDobRequired', { defaultValue: 'Age or date of birth is required' }));
      return;
    }

    const payload = {
      name: formData.name.trim(),
      fatherHusband: formData.fatherHusband.trim() || undefined,
      address: formData.address.trim() || undefined,
      mobile: sendingMobile,
      mobileMissingReason: sendingReason,
      guardianName: sendingGuardian,
      guardianRelation: sendingGuardianRelation,
      guardianMobile: sendingGuardianMobile,
      village: formData.village.trim() || undefined,
      unionName: formData.unionName.trim() || undefined,
      upazila: formData.upazila.trim() || undefined,
      district: formData.district.trim() || undefined,
      division: formData.division.trim() || undefined,
      age: ageYears,
      dateOfBirth: dateOfBirth || undefined,
      gender: formData.gender || undefined,
      bloodGroup: formData.bloodGroup || undefined,
      duplicateOverrideReason: possibleDuplicates.length > 0 ? duplicateOverrideReason.trim() : undefined,
    };

    if (isEditMode) {
      patientSubmitLockRef.current = true;
      updateMutation.mutate(payload);
    } else {
      const idempotencyKey = registrationAttemptTrackerRef.current.keyFor(payload);
      patientSubmitLockRef.current = true;
      createMutation.mutate({ ...payload, idempotencyKey });
    }
  };

  // If the user un-checks "mobile not available" we want to drop the
  // stale reason/guardian/address values so a follow-up submit doesn't
  // accidentally push them in a contradictory way.
  const mobileMissingActive = formData.mobileMissing || !formData.mobile.trim();
  const showAlternativeContact = mobileMissingActive;
  const enteredAgePreview = formatAgeFromParts({
    years: parseAgeInput(formData.age) ?? 0,
    months: parseAgeInput(formData.ageMonths) ?? 0,
    days: parseAgeInput(formData.ageDays) ?? 0,
  }, 'bn-BD');

  return (
    <DashboardLayout role={role}>
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Link to={`${base}/patients`} className="text-gray-600 hover:text-gray-800">
            ← {t('back', { ns: 'common' })}
          </Link>
          <h1 className="text-2xl font-bold">{isEditMode ? t('editPatient', { defaultValue: 'Edit Patient' }) : t('newPatient')}</h1>
          {!isEditMode && (
            <button
              type="button"
              onClick={() => {
                setQuickMode(!quickMode);
                setQuickRegisteredPatient(null);
              }}
              className={`ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                quickMode
                  ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
                  : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              {quickMode ? (
                <>
                  <Zap className="w-4 h-4" />
                  Quick Register
                </>
              ) : (
                'Full Registration'
              )}
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
          {quickRegisteredPatient && (
            <div className="rounded-lg border border-green-300 bg-green-50 p-4">
              <p className="font-semibold text-green-900">{t('quickRegistration.savedTitle')}</p>
              <Link
                to={`${base}/patients/${quickRegisteredPatient.id}`}
                className="text-sm text-green-700 hover:text-green-900 underline font-medium"
              >
                {t('quickRegistration.completeProfile')}
              </Link>
            </div>
          )}
          {isEditMode && patientLoading && (
            <div className="text-center py-8 text-gray-500">{t('loading', { ns: 'common' })}</div>
          )}
          {!isEditMode && possibleDuplicates.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
              <div>
                <p className="font-semibold text-amber-900">{t('quickRegistration.duplicateTitle')}</p>
                <p className="text-sm text-amber-800">{t('quickRegistration.duplicateHint')}</p>
              </div>
              <div className="space-y-2">
                {possibleDuplicates.slice(0, 5).map((patient, index) => {
                  const patientId = patient.patient_id || patient.id;
                  const isGlobal = patient.scope === 'global_identity';
                  const mobile = patient.mobile || patient.mobile_masked;

                  return (
                    <div
                      key={`${patientId ?? patient.identity_id ?? 'unknown'}-${index}`}
                      className="w-full text-left rounded-md bg-white border border-amber-200 p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-gray-900">
                            {patient.name ?? t('quickRegistration.unknownPatient')}
                            {isGlobal && <span className="ml-2 text-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">{t('quickRegistration.globalMatch')}</span>}
                          </div>
                          <div className="text-gray-600">
                            {[patient.patient_code, mobile, patient.gender, patient.date_of_birth].filter(Boolean).join(' | ')}
                          </div>
                          {patient.match_reasons?.length ? (
                            <div className="text-xs text-amber-700 mt-1">{patient.match_reasons.join(', ')}</div>
                          ) : null}
                        </div>
                        {patientId && !isGlobal && (
                          <div className="flex flex-col gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => navigate(`${base}/patients/${patientId}`)}
                              className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-300 rounded hover:bg-amber-100 transition-colors"
                            >
                              {t('quickRegistration.viewPatient')}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(t('quickRegistration.useExistingConfirm', { name: patient.name ?? '' }))) {
                                  navigate(`${base}/patients/${patientId}`);
                                }
                              }}
                              className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-300 rounded hover:bg-green-100 transition-colors"
                            >
                              {t('quickRegistration.selectPatient')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div>
                <label className="block text-sm font-medium text-amber-900 mb-1">{t('quickRegistration.overrideReasonLabel')}</label>
                <textarea
                  required
                  minLength={5}
                  value={duplicateOverrideReason}
                  onChange={(e) => setDuplicateOverrideReason(e.target.value)}
                  className="w-full px-4 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                  rows={3}
                  placeholder={t('quickRegistration.overrideReasonPlaceholder')}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('name', { ns: 'common' })} *</label>
              <input
                type="text"
                required
                name="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.fatherHusband')}</label>
              <input
                type="text"
                name="fatherHusband"
                value={formData.fatherHusband}
                onChange={(e) => setFormData({ ...formData, fatherHusband: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('address')}</label>
              <input
                type="text"
                name="address"
                list="patient-address-suggestions"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
              <datalist id="patient-address-suggestions">
                {BANGLADESH_LOCATION_SUGGESTIONS.map((location) => (
                  <option key={location} value={location} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('phone', { ns: 'common' })}
                {!formData.mobileMissing ? ' *' : ''}
              </label>
              <input
                type="tel"
                required={!formData.mobileMissing}
                name="mobile"
                value={formData.mobile}
                onChange={(e) => setFormData({ ...formData, mobile: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 disabled:bg-gray-100"
                disabled={formData.mobileMissing}
                placeholder={formData.mobileMissing ? t('mobileNotAvailablePlaceholder', { defaultValue: 'Will be updated later' }) : ''}
              />
              <label className="mt-1 flex items-center gap-2 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={formData.mobileMissing}
                  onChange={(e) => setFormData({
                    ...formData,
                    mobileMissing: e.target.checked,
                    mobileMissingReason: e.target.checked ? formData.mobileMissingReason : '',
                  })}
                  className="rounded"
                />
                {t('mobileNotAvailableCheckbox', { defaultValue: 'Mobile number is not available right now' })}
              </label>
            </div>

            {showAlternativeContact && (
              <div className="md:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-3">
                <div className="text-sm font-semibold text-amber-900">
                  {t('alternativeContactTitle', { defaultValue: 'Alternative contact (required when no mobile is provided)' })}
                </div>
                {!formData.mobile.trim() && (
                  <div>
                    <label className="block text-sm font-medium text-amber-900 mb-1">
                      {t('mobileMissingReasonLabel', { defaultValue: 'Reason mobile is missing' })} *
                    </label>
                    <select
                      required={!formData.mobile.trim()}
                      value={formData.mobileMissingReason}
                      onChange={(e) => setFormData({ ...formData, mobileMissingReason: e.target.value })}
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="">{t('select', { ns: 'common' })}</option>
                      <option value="no_personal_mobile">{t('reasonNoPersonalMobile', { defaultValue: 'Patient has no personal mobile' })}</option>
                      <option value="no_family_mobile">{t('reasonNoFamilyMobile', { defaultValue: 'No family member has a mobile' })}</option>
                      <option value="emergency_arrival">{t('reasonEmergencyArrival', { defaultValue: 'Patient arrived in emergency, mobile not obtainable' })}</option>
                      <option value="patient_refused">{t('reasonPatientRefused', { defaultValue: 'Patient does not want to share the number' })}</option>
                      <option value="will_update_later">{t('reasonWillUpdateLater', { defaultValue: 'Will be updated later' })}</option>
                      <option value="other">{t('reasonOther', { defaultValue: 'Other' })}</option>
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-amber-900 mb-1">
                      {t('guardianNameLabel', { defaultValue: 'Guardian name' })}
                    </label>
                    <input
                      type="text"
                      value={formData.guardianName}
                      onChange={(e) => setFormData({ ...formData, guardianName: e.target.value })}
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg"
                      placeholder={t('placeholder.guardianName', { defaultValue: 'Father / mother / spouse / etc.' })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-amber-900 mb-1">
                      {t('guardianRelationLabel', { defaultValue: 'Relation' })}
                    </label>
                    <select
                      value={formData.guardianRelation}
                      onChange={(e) => setFormData({ ...formData, guardianRelation: e.target.value })}
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg"
                    >
                      <option value="">{t('select', { ns: 'common' })}</option>
                      <option value="father">{t('relation.father', { defaultValue: 'Father' })}</option>
                      <option value="mother">{t('relation.mother', { defaultValue: 'Mother' })}</option>
                      <option value="spouse">{t('relation.spouse', { defaultValue: 'Spouse' })}</option>
                      <option value="son">{t('relation.son', { defaultValue: 'Son' })}</option>
                      <option value="daughter">{t('relation.daughter', { defaultValue: 'Daughter' })}</option>
                      <option value="sibling">{t('relation.sibling', { defaultValue: 'Sibling' })}</option>
                      <option value="grandparent">{t('relation.grandparent', { defaultValue: 'Grandparent' })}</option>
                      <option value="uncle">{t('relation.uncle', { defaultValue: 'Uncle' })}</option>
                      <option value="aunt">{t('relation.aunt', { defaultValue: 'Aunt' })}</option>
                      <option value="neighbor">{t('relation.neighbor', { defaultValue: 'Neighbour' })}</option>
                      <option value="legal_guardian">{t('relation.legalGuardian', { defaultValue: 'Legal guardian' })}</option>
                      <option value="other">{t('relation.other', { defaultValue: 'Other' })}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-amber-900 mb-1">
                      {t('fields.guardianMobile')}
                    </label>
                    <input
                      type="tel"
                      value={formData.guardianMobile}
                      onChange={(e) => setFormData({ ...formData, guardianMobile: e.target.value })}
                      className="w-full px-3 py-2 border border-amber-300 rounded-lg"
                      placeholder={t('placeholder.optionalPhone', { defaultValue: 'Optional' })}
                    />
                  </div>
                </div>
                <details className="rounded-md bg-white px-3 py-2 text-xs text-amber-800">
                  <summary className="cursor-pointer font-semibold text-amber-900">
                    {t('structuredAddressToggle', { defaultValue: 'Or supply a full structured address' })}
                  </summary>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input type="text" value={formData.village} onChange={(e) => setFormData({ ...formData, village: e.target.value })} placeholder={t('structuredAddress.village', { defaultValue: 'Village' })} className="px-3 py-2 border border-amber-200 rounded" />
                    <input type="text" value={formData.unionName} onChange={(e) => setFormData({ ...formData, unionName: e.target.value })} placeholder={t('structuredAddress.union', { defaultValue: 'Union' })} className="px-3 py-2 border border-amber-200 rounded" />
                    <input type="text" value={formData.upazila} onChange={(e) => setFormData({ ...formData, upazila: e.target.value })} placeholder={t('structuredAddress.upazila', { defaultValue: 'Upazila / thana' })} className="px-3 py-2 border border-amber-200 rounded" />
                    <input type="text" value={formData.district} onChange={(e) => setFormData({ ...formData, district: e.target.value })} placeholder={t('structuredAddress.district', { defaultValue: 'District' })} className="px-3 py-2 border border-amber-200 rounded" />
                    <input type="text" value={formData.division} onChange={(e) => setFormData({ ...formData, division: e.target.value })} placeholder={t('structuredAddress.division', { defaultValue: 'Division (optional)' })} className="px-3 py-2 border border-amber-200 rounded sm:col-span-2" />
                  </div>
                </details>
                <p className="text-xs text-amber-800">
                  {t('alternativeContactHint', { defaultValue: 'Provide at least a named guardian (name + relation) or a full structured address (village + union + upazila + district).' })}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.dateOfBirth', { defaultValue: 'Date of birth' })}</label>
              <input
                type="date"
                name="dateOfBirth"
                max={new Date().toISOString().slice(0, 10)}
                value={formData.dateOfBirth}
                onChange={(e) => {
                  const nextDateOfBirth = e.target.value;
                  const ageParts = calculateAgePartsFromDateOfBirth(nextDateOfBirth);
                  setFormData({
                    ...formData,
                    dateOfBirth: nextDateOfBirth,
                    age: ageParts ? String(ageParts.years) : formData.age,
                    ageMonths: ageParts ? String(ageParts.months) : formData.ageMonths,
                    ageDays: ageParts ? String(ageParts.days) : formData.ageDays,
                  });
                }}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('age')} * <span className="text-xs font-normal text-gray-500">(years / months / days)</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  name="ageYears"
                  min="0"
                  max="130"
                  step="1"
                  value={formData.age}
                  onChange={(e) => setFormData({ ...formData, age: e.target.value, dateOfBirth: '' })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder={t('ageYearsPlaceholder', { defaultValue: 'Years' })}
                  aria-label={t('ageYearsPlaceholder', { defaultValue: 'Years' })}
                />
                <input
                  type="number"
                  name="ageMonths"
                  min="0"
                  max="11"
                  step="1"
                  value={formData.ageMonths}
                  onChange={(e) => setFormData({ ...formData, ageMonths: e.target.value, dateOfBirth: '' })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder={t('ageMonthsPlaceholder', { defaultValue: 'Months' })}
                  aria-label={t('ageMonthsPlaceholder', { defaultValue: 'Months' })}
                />
                <input
                  type="number"
                  name="ageDays"
                  min="0"
                  max="31"
                  step="1"
                  value={formData.ageDays}
                  onChange={(e) => setFormData({ ...formData, ageDays: e.target.value, dateOfBirth: '' })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
                  placeholder={t('ageDaysPlaceholder', { defaultValue: 'Days' })}
                  aria-label={t('ageDaysPlaceholder', { defaultValue: 'Days' })}
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {t('ageInputHint', { defaultValue: 'Use 1 year 3 months as Years=1, Months=3 — do not enter 1.3.' })}
                {(formData.age || formData.ageMonths || formData.ageDays) && ` (${enteredAgePreview})`}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('gender')} *</label>
              <select
                required
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">{t('select', { ns: 'common' })}</option>
                <option value="male">{t('male')}</option>
                <option value="female">{t('female')}</option>
                <option value="other">{t('other')}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('bloodGroup')}</label>
              <select
                value={formData.bloodGroup}
                onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500"
              >
                <option value="">{t('select', { ns: 'common' })}</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-4 sm:justify-end">
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending || (isEditMode && patientLoading)}
              className="btn-primary sm:min-w-[180px] justify-center"
            >
              {createMutation.isPending || updateMutation.isPending
                ? t('loading', { ns: 'common' })
                : isEditMode
                  ? t('saveChanges', { defaultValue: 'Save Changes' })
                  : t('registerPatient')}
            </button>
            {!isEditMode && (
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="btn sm:min-w-[180px] justify-center bg-gradient-to-r from-[var(--color-primary)] to-cyan-400 text-white shadow-md shadow-cyan-500/20"
              >
                {t('common:saveAndPrint')}
              </button>
            )}
            <Link
              to={`${base}/patients`}
              className="btn-secondary sm:min-w-[120px] justify-center"
            >
              {t('cancel', { ns: 'common' })}
            </Link>
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
