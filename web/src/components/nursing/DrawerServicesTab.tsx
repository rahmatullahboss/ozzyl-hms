import { useState } from 'react';
import { Plus, Pill, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import toast from 'react-hot-toast';
import type { BedGridItem } from './WardBedGrid';

interface DrawerServicesTabProps {
  bed: BedGridItem;
}

export default function DrawerServicesTab({ bed }: DrawerServicesTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [showPharmacyForm, setShowPharmacyForm] = useState(false);
  const [serviceForm, setServiceForm] = useState({ service_name: '', quantity: '1', unit_price: '', remarks: '' });
  const [pharmacyForm, setPharmacyForm] = useState({ medication_name: '', quantity: '1', urgency: 'routine', remarks: '' });

  const addServiceMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/billing-provisional',
    {
      onSuccess: () => {
        toast.success(t('drawer.services.added', { defaultValue: 'Service charge added' }));
        setShowServiceForm(false);
        setServiceForm({ service_name: '', quantity: '1', unit_price: '', remarks: '' });
        if (bed.admission_id) queryClient.invalidateQueries({ queryKey: queryKeys.billing.pending(bed.admission_id) });
        queryClient.invalidateQueries({ queryKey: ['ip-billing'] });
      },
      onError: () => toast.error(t('drawer.services.failed', { defaultValue: 'Failed to add service' })),
    },
  );

  const orderPharmacyMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/ward-supply/requisitions',
    {
      onSuccess: () => {
        toast.success(t('drawer.pharmacy.ordered', { defaultValue: 'Pharmacy order sent' }));
        setShowPharmacyForm(false);
        setPharmacyForm({ medication_name: '', quantity: '1', urgency: 'routine', remarks: '' });
      },
      onError: () => toast.error(t('drawer.pharmacy.failed', { defaultValue: 'Failed to send pharmacy order' })),
    },
  );

  const handleAddService = () => {
    if (!serviceForm.service_name.trim()) { toast.error(t('drawer.services.nameRequired', { defaultValue: 'Service name required' })); return; }
    const unitPrice = Number(serviceForm.unit_price);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) { toast.error(t('drawer.services.amountRequired', { defaultValue: 'Enter a valid service amount' })); return; }
    addServiceMutation.mutate({
      patient_id: bed.patient_id,
      admission_id: bed.admission_id,
      items: [{
        is_manual: true,
        source: 'nursing_drawer',
        item_category: 'nursing_service',
        item_name: serviceForm.service_name.trim(),
        department: 'Nursing',
        quantity: parseInt(serviceForm.quantity) || 1,
        unit_price: unitPrice,
        discount_percent: 0,
        ...(serviceForm.remarks ? { remarks: serviceForm.remarks } : {}),
      }],
    });
  };

  const handleOrderPharmacy = () => {
    if (!pharmacyForm.medication_name.trim()) { toast.error(t('drawer.pharmacy.medRequired', { defaultValue: 'Medication name required' })); return; }
    orderPharmacyMutation.mutate({
      patient_id: bed.patient_id,
      admission_id: bed.admission_id,
      items: [{ medication_name: pharmacyForm.medication_name.trim(), quantity: parseInt(pharmacyForm.quantity) || 1 }],
      urgency: pharmacyForm.urgency,
      remarks: pharmacyForm.remarks || undefined,
    });
  };

  return (
    <div className="space-y-4" data-testid="services-tab">
      <h3 className="text-sm font-semibold text-[var(--color-text)]">
        {t('drawer.services.title', { defaultValue: 'Services & Requisitions' })}
      </h3>

      {/* Quick Action Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setShowServiceForm(!showServiceForm)}
          className="btn-secondary justify-center py-4"
          data-testid="add-service-btn"
        >
          <Plus className="w-5 h-5" />
          <span>{t('drawer.services.addService', { defaultValue: '+ Add Service' })}</span>
        </button>
        <button
          onClick={() => setShowPharmacyForm(!showPharmacyForm)}
          className="btn-secondary justify-center py-4"
          data-testid="order-pharmacy-btn"
        >
          <Pill className="w-5 h-5" />
          <span>{t('drawer.pharmacy.orderPharmacy', { defaultValue: '💊 Order Pharmacy' })}</span>
        </button>
      </div>

      {/* Add Service Form */}
      {showServiceForm && (
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30 space-y-3" data-testid="service-form">
          <h4 className="text-sm font-medium text-[var(--color-text)]">
            {t('drawer.services.addService', { defaultValue: 'Add Service Charge' })}
          </h4>
          <div>
            <label className="label text-xs">{t('drawer.services.serviceName', { defaultValue: 'Service Name' })} *</label>
            <input
              className="input"
              value={serviceForm.service_name}
              onChange={e => setServiceForm(f => ({ ...f, service_name: e.target.value }))}
              placeholder={t('drawer.services.servicePlaceholder', { defaultValue: 'e.g., Cannulation, Dressing, Injection' })}
              data-testid="service-name-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">{t('common:quantity', { defaultValue: 'Quantity' })}</label>
              <input type="number" min="1" className="input" value={serviceForm.quantity} onChange={e => setServiceForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">{t('common:amount', { defaultValue: 'Amount' })} *</label>
              <input type="number" min="0" step="0.01" className="input" value={serviceForm.unit_price} onChange={e => setServiceForm(f => ({ ...f, unit_price: e.target.value }))} data-testid="service-amount-input" />
            </div>
          </div>
          <div>
            <label className="label text-xs">{t('common:remarks', { defaultValue: 'Remarks' })}</label>
            <input className="input" value={serviceForm.remarks} onChange={e => setServiceForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowServiceForm(false)} className="btn-secondary text-sm">{t('common:cancel')}</button>
            <button onClick={handleAddService} disabled={addServiceMutation.isPending} className="btn-primary text-sm" data-testid="submit-service-btn">
              {addServiceMutation.isPending ? t('common:saving') : t('common:add')}
            </button>
          </div>
        </div>
      )}

      {/* Pharmacy Order Form */}
      {showPharmacyForm && (
        <div className="p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30 space-y-3" data-testid="pharmacy-form">
          <h4 className="text-sm font-medium text-[var(--color-text)]">
            {t('drawer.pharmacy.emergencyOrder', { defaultValue: 'Emergency Pharmacy Order' })}
          </h4>
          <div>
            <label className="label text-xs">{t('drawer.pharmacy.medicationName', { defaultValue: 'Medication' })} *</label>
            <input
              className="input"
              value={pharmacyForm.medication_name}
              onChange={e => setPharmacyForm(f => ({ ...f, medication_name: e.target.value }))}
              placeholder={t('drawer.pharmacy.medPlaceholder', { defaultValue: 'Medicine name' })}
              data-testid="pharmacy-med-input"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-xs">{t('common:quantity', { defaultValue: 'Quantity' })}</label>
              <input type="number" min="1" className="input" value={pharmacyForm.quantity} onChange={e => setPharmacyForm(f => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div>
              <label className="label text-xs">{t('common:urgency', { defaultValue: 'Urgency' })}</label>
              <select className="input" value={pharmacyForm.urgency} onChange={e => setPharmacyForm(f => ({ ...f, urgency: e.target.value }))}>
                <option value="routine">{t('common:routine', { defaultValue: 'Routine' })}</option>
                <option value="urgent">{t('common:urgent', { defaultValue: 'Urgent' })}</option>
                <option value="stat">{t('common:stat', { defaultValue: 'STAT' })}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label text-xs">{t('common:remarks', { defaultValue: 'Remarks' })}</label>
            <input className="input" value={pharmacyForm.remarks} onChange={e => setPharmacyForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowPharmacyForm(false)} className="btn-secondary text-sm">{t('common:cancel')}</button>
            <button onClick={handleOrderPharmacy} disabled={orderPharmacyMutation.isPending} className="btn-primary text-sm" data-testid="submit-pharmacy-btn">
              <Send className="w-3 h-3" />
              {orderPharmacyMutation.isPending ? t('common:sending') : t('drawer.pharmacy.send', { defaultValue: 'Send Order' })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
