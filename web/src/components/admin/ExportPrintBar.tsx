import { Download, Printer, FileSpreadsheet, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ExportPrintBarProps {
  onExportExcel?: () => void;
  onExportPdf?: () => void;
  onPrint?: () => void;
  exporting?: boolean;
}

export default function ExportPrintBar({ onExportExcel, onExportPdf, onPrint, exporting }: ExportPrintBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2">
      {onExportExcel && (
        <button onClick={onExportExcel} disabled={exporting}
          className="px-3 py-2 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2 disabled:opacity-50">
          <FileSpreadsheet className="w-4 h-4" /> {t('Excel')}
        </button>
      )}
      {onExportPdf && (
        <button onClick={onExportPdf} disabled={exporting}
          className="px-3 py-2 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2 disabled:opacity-50">
          <FileText className="w-4 h-4" /> {t('PDF')}
        </button>
      )}
      {onPrint && (
        <button onClick={onPrint} disabled={exporting}
          className="px-3 py-2 bg-gray-100 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-2 disabled:opacity-50">
          <Printer className="w-4 h-4" /> {t('Print')}
        </button>
      )}
    </div>
  );
}
