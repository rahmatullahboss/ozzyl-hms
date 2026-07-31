import BillPrint from './BillPrint';

export default function LabTestBillPrint({ role = 'hospital_admin' }: { role?: string }) {
  return <BillPrint role={role} scope="lab" />;
}
