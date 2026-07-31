import { useApiMutation, useQueryClient } from './useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import toast from 'react-hot-toast';

type TFunction = (key: string, opts?: Record<string, unknown>) => string;

interface AdmissionMutationsConfig {
  t: TFunction;
  basePath: string;
  navigate: (path: string) => void;
  selectedAdmission: { admission_no?: string } | null;
  setSelectedAdmission: (a: null) => void;
  isExpiredDischarge: boolean;
  setShowAdmitModal: (v: boolean) => void;
  setAdmitForm: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  setPatientSearch: (v: string) => void;
  setCustomAdmitDate: (v: boolean) => void;
  setAdmitDateValue: (v: string) => void;
  setShowDischargeModal: (v: boolean) => void;
  setShowCancelModal: (v: boolean) => void;
  setShowCancelDischargeModal: (v: boolean) => void;
  setCancelReason: (v: string) => void;
  setRemarkText: (v: string) => void;
  setQuickDepositForm: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
  setShowQuickDepositModal: (v: boolean) => void;
}

export function useAdmissionMutations(config: AdmissionMutationsConfig) {
  const { t, basePath, navigate, selectedAdmission, setSelectedAdmission, isExpiredDischarge, setShowAdmitModal, setAdmitForm, setPatientSearch, setCustomAdmitDate, setAdmitDateValue, setShowDischargeModal, setShowCancelModal, setShowCancelDischargeModal, setCancelReason, setRemarkText, setQuickDepositForm, setShowQuickDepositModal } = config;
  const queryClient = useQueryClient();

  const admitMutation = useApiMutation<{ admission_no: string }, Record<string, unknown>>(
    'post', '/api/admissions',
    {
      onSuccess: (data) => {
        toast.success(t('ipd.patientAdmitted', { admissionNo: data.admission_no }));
        setShowAdmitModal(false);
        setAdmitForm(() => ({ patient_id: 0, bed_id: 0, doctor_id: 0, care_of_name: '', care_of_phone: '', care_of_relation: '', admission_type: 'planned', admit_source: 'planned', referral_doctor: '', admission_reason: '', is_emergency: false, provisional_diagnosis: '', notes: '', department: '' }));
        setPatientSearch('');
        setCustomAdmitDate(false);
        setAdmitDateValue('');
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToAdmit')),
    },
  );

  const dischargeMutation = useApiMutation<unknown, Record<string, unknown>>(
    'put', (vars) => `/api/admissions/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('ipd.patientDischarged', { admissionNo: selectedAdmission?.admission_no }));
        setShowDischargeModal(false);
        if (isExpiredDischarge) navigate(`${basePath}/death-records`);
        setSelectedAdmission(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: () => toast.error(t('ipd.failed_to_discharge_patient')),
    },
  );

  const creditDischargeMutation = useApiMutation<unknown, { id: number; discharge_condition_id?: number; discharge_type?: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/credit-discharge`,
    {
      onSuccess: () => {
        toast.success(t('ipd.creditDischargeSuccess', { defaultValue: 'Patient discharged on credit' }));
        setShowDischargeModal(false);
        setSelectedAdmission(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: () => toast.error(t('ipd.creditDischargeFailed', { defaultValue: 'Failed to discharge on credit' })),
    },
  );

  const cancelAdmissionMutation = useApiMutation<unknown, { id: number; reason: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/cancel`,
    {
      onSuccess: () => {
        toast.success(t('admissionCancelled', { defaultValue: 'Admission cancelled' }));
        setShowCancelModal(false);
        setSelectedAdmission(null);
        setCancelReason('');
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToCancelAdmission')),
    },
  );

  const cancelDischargeMutation = useApiMutation<unknown, { id: number; reason: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/cancel-discharge`,
    {
      onSuccess: () => {
        toast.success(t('dischargeCancelled', { defaultValue: 'Discharge cancelled, patient re-admitted' }));
        setShowCancelDischargeModal(false);
        setSelectedAdmission(null);
        setCancelReason('');
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToCancelDischarge')),
    },
  );

  const provisionalDischargeMutation = useApiMutation<unknown, { id: number; note?: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/provisional-discharge`,
    {
      onSuccess: () => {
        toast.success(t('provisionalDischargeMarked', { defaultValue: 'Patient marked for provisional discharge' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToMarkProvisional')),
    },
  );

  const undoProvisionalDischargeMutation = useApiMutation<unknown, { id: number; reason: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/undo-provisional-discharge`,
    {
      onSuccess: () => {
        toast.success(t('provisionalDischargeUndone', { defaultValue: 'Provisional discharge undone' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToUndoProvisional')),
    },
  );

  const receiveTransferMutation = useApiMutation<unknown, { id: number; reason?: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/receive-transfer`,
    {
      onSuccess: () => {
        toast.success(t('transferReceived', { defaultValue: 'Transfer received' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToReceiveTransfer')),
    },
  );

  const undoTransferMutation = useApiMutation<unknown, { id: number; reason: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/undo-transfer`,
    {
      onSuccess: () => {
        toast.success(t('transferUndone', { defaultValue: 'Transfer undone' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToUndoTransfer')),
    },
  );

  const clearProvisionalMutation = useApiMutation<unknown, { id: number; reason?: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/clear-provisional`,
    {
      onSuccess: () => {
        toast.success(t('provisionalCleared', { defaultValue: 'Provisional discharge cleared' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToClearProvisional')),
    },
  );

  const billingDischargeMutation = useApiMutation<unknown, { id: number; reason?: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/billing-discharge`,
    {
      onSuccess: () => {
        toast.success(t('billingDischargeMarked', { defaultValue: 'Billing discharge marked' }));
        queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all });
      },
      onError: (err) => toast.error(err.message || t('toast.failedToMarkBillingDischarge')),
    },
  );

  const clearDueMutation = useApiMutation<unknown, { id: number; reason?: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/clear-due`,
    {
      onSuccess: () => toast.success(t('dueCleared', { defaultValue: 'Due amount cleared' })),
      onError: (err) => toast.error(err.message || t('toast.failedToClearDue')),
    },
  );

  const doctorMutation = useApiMutation<unknown, { id: number; doctor_id: number }>(
    'put', (vars) => `/api/admissions/${vars.id}/doctor`,
    { onSuccess: () => { toast.success(t('toast.doctorUpdated')); queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all }); }, onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const procedureMutation = useApiMutation<unknown, { id: number; procedure_type: string }>(
    'put', (vars) => `/api/admissions/${vars.id}/procedure`,
    { onSuccess: () => { toast.success(t('toast.procedureUpdated')); queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all }); }, onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const policeCaseMutation = useApiMutation<unknown, { id: number; is_police_case: boolean }>(
    'put', (vars) => `/api/admissions/${vars.id}/police-case`,
    { onSuccess: () => { toast.success(t('toast.policeCaseUpdated')); queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all }); }, onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const remarkMutation = useApiMutation<unknown, { id: number; remark: string }>(
    'post', (vars) => `/api/admissions/${vars.id}/remark`,
    { onSuccess: () => { toast.success(t('toast.remarkAdded')); setRemarkText(''); }, onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const birthMutation = useApiMutation<unknown, Record<string, unknown> & { id: number }>(
    'post', (vars) => `/api/admissions/${vars.id}/birth-details`,
    { onSuccess: () => toast.success(t('toast.birthDetailsRecorded')), onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const hemoMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post', '/api/admissions/hemodialysis-reports',
    { onSuccess: () => toast.success(t('toast.hemodialysisReportSaved')), onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const autoBillingMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post', '/api/admissions/adt/auto-billing-items',
    { onSuccess: () => toast.success(t('toast.autoBillingItemSaved')), onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const depositMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post', '/api/admissions/adt/deposit-settings',
    { onSuccess: () => toast.success(t('toast.depositSettingSaved')), onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const schemeMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post', '/api/admissions/adt/scheme-price-maps',
    { onSuccess: () => toast.success(t('toast.schemePriceMapSaved')), onError: (err) => toast.error(err.message || t('toast.failedToAdmit')) },
  );

  const collectDepositMutation = useApiMutation<{ receiptNo: string; balance: number }, { patient_id: number; amount: number; payment_method: string; remarks?: string }>(
    'post', '/api/deposits',
    {
      onSuccess: (data) => {
        toast.success(t('toast.depositCollected', { receiptNo: data.receiptNo }));
        queryClient.invalidateQueries({ queryKey: queryKeys.deposits.all });
        queryClient.invalidateQueries({ queryKey: ['admissions'] });
        setShowQuickDepositModal(false);
        setQuickDepositForm(() => ({ patient_id: 0, amount: '', payment_method: 'cash', remarks: '' }));
      },
      onError: (err) => toast.error(err.message || t('toast.failedToCollectDeposit')),
    },
  );

  const submitting = admitMutation.isPending || dischargeMutation.isPending || creditDischargeMutation.isPending || cancelAdmissionMutation.isPending || cancelDischargeMutation.isPending || provisionalDischargeMutation.isPending || undoProvisionalDischargeMutation.isPending || receiveTransferMutation.isPending || undoTransferMutation.isPending || clearProvisionalMutation.isPending || collectDepositMutation.isPending;

  return {
    admitMutation,
    dischargeMutation,
    creditDischargeMutation,
    cancelAdmissionMutation,
    cancelDischargeMutation,
    provisionalDischargeMutation,
    undoProvisionalDischargeMutation,
    receiveTransferMutation,
    undoTransferMutation,
    clearProvisionalMutation,
    billingDischargeMutation,
    clearDueMutation,
    doctorMutation,
    procedureMutation,
    policeCaseMutation,
    remarkMutation,
    birthMutation,
    hemoMutation,
    autoBillingMutation,
    depositMutation,
    schemeMutation,
    collectDepositMutation,
    submitting,
  };
}
