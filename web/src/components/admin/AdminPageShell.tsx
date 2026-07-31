import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../DashboardLayout';
import Breadcrumb from './Breadcrumb';
import ExportPrintBar from './ExportPrintBar';

interface AdminPageShellProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Array<{ label: string; path?: string }>;
  actions?: ReactNode;
  summaryCards?: ReactNode;
  tabs?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
  onExportExcel?: () => void;
  onExportPdf?: () => void;
  onPrint?: () => void;
  exporting?: boolean;
}

export default function AdminPageShell({
  title, subtitle, breadcrumbs, actions, summaryCards, tabs, filters, children,
  onExportExcel, onExportPdf, onPrint, exporting,
}: AdminPageShellProps) {
  const { t } = useTranslation();

  return (
    <DashboardLayout role="hospital_admin">
      <div className="p-6 space-y-6">
        {/* Breadcrumb */}
        {breadcrumbs && breadcrumbs.length > 0 && (
          <Breadcrumb items={breadcrumbs} />
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t(title)}</h1>
            {subtitle && <p className="text-sm text-gray-500">{t(subtitle)}</p>}
          </div>
          <div className="flex items-center gap-3">
            {(onExportExcel || onExportPdf || onPrint) && (
              <ExportPrintBar onExportExcel={onExportExcel} onExportPdf={onExportPdf} onPrint={onPrint} exporting={exporting} />
            )}
            {actions}
          </div>
        </div>

        {/* Summary Cards */}
        {summaryCards && summaryCards}

        {/* Tabs */}
        {tabs && tabs}

        {/* Filters */}
        {filters && filters}

        {/* Main Content */}
        {children}
      </div>
    </DashboardLayout>
  );
}
