import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ZoomIn, ZoomOut, Download, RotateCw, ExternalLink, History, Flag, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDateTime, formatDate } from '../../lib/format';

interface DocumentVersion {
  id: string;
  url: string;
  uploadedBy: string;
  uploadedAt: string;
  reason?: string;
  fileType: string;
}

interface DocumentInfo {
  id: string;
  url: string;
  fileName: string;
  fileType: string;
  uploadedBy: string;
  uploadedAt: string;
  documentType: string;
  relatedRecordType?: string;
  relatedRecordId?: string;
  versions: DocumentVersion[];
}

interface DocumentViewerProps {
  document: DocumentInfo;
  onClose: () => void;
  onOpenRelated?: (type: string, id: string) => void;
}

export default function DocumentViewer({ document: doc, onClose, onOpenRelated }: DocumentViewerProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [currentVersionIdx, setCurrentVersionIdx] = useState(0);

  const isImage = doc.fileType.startsWith('image/');
  const isPdf = doc.fileType === 'application/pdf';
  const currentUrl = doc.versions.length > 0 ? doc.versions[currentVersionIdx]?.url ?? doc.url : doc.url;

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.25));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);
  const handleReset = () => { setZoom(1); setRotation(0); };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="font-semibold text-lg">{doc.fileName}</h2>
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span>{t('Uploaded by')} {doc.uploadedBy}</span>
              <span>•</span>
              <span>{formatDateTime(doc.uploadedAt)}</span>
              <span>•</span>
              <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">{doc.documentType}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('Close')} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-6 py-3 border-b bg-gray-50">
          <button onClick={handleZoomIn} className="p-2 hover:bg-gray-200 rounded-lg" title={t('Zoom In')}>
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={handleZoomOut} className="p-2 hover:bg-gray-200 rounded-lg" title={t('Zoom Out')}>
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs text-gray-500 font-mono">{Math.round(zoom * 100)}%</span>
          <div className="w-px h-6 bg-gray-300 mx-1" />
          <button onClick={handleRotate} className="p-2 hover:bg-gray-200 rounded-lg" title={t('Rotate')}>
            <RotateCw className="w-4 h-4" />
          </button>
          <button onClick={handleReset} className="px-2 py-1 text-xs hover:bg-gray-200 rounded-lg">
            {t('Reset')}
          </button>
          <div className="w-px h-6 bg-gray-300 mx-1" />
          <a href={currentUrl} download={doc.fileName} className="p-2 hover:bg-gray-200 rounded-lg" title={t('Download')}>
            <Download className="w-4 h-4" />
          </a>
          {doc.relatedRecordType && doc.relatedRecordId && onOpenRelated && (
            <>
              <div className="w-px h-6 bg-gray-300 mx-1" />
              <button onClick={() => onOpenRelated(doc.relatedRecordType!, doc.relatedRecordId!)} className="p-2 hover:bg-gray-200 rounded-lg flex items-center gap-1 text-sm" title={t('Open Related Record')}>
                <ExternalLink className="w-4 h-4" /> {t('Open')} {doc.relatedRecordType}
              </button>
            </>
          )}
          <div className="flex-1" />
          <button onClick={() => setShowHistory(!showHistory)} className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${showHistory ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-200'}`}>
            <History className="w-4 h-4" /> {t('History')} ({doc.versions.length})
          </button>
          <button className="px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-200 flex items-center gap-1">
            <Flag className="w-4 h-4" /> {t('Flag')}
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Document Preview */}
          <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-gray-100">
            {isImage ? (
              <img
                src={currentUrl}
                alt={doc.fileName}
                className="max-w-full max-h-full object-contain transition-transform"
                style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
              />
            ) : isPdf ? (
              <iframe
                src={currentUrl}
                className="w-full h-full border-0 rounded-lg"
                title={doc.fileName}
              />
            ) : (
              <div className="text-center text-gray-500">
                <p className="text-lg font-medium">{t('Preview not available')}</p>
                <p className="text-sm">{t('File type')}: {doc.fileType}</p>
                <a href={currentUrl} download={doc.fileName} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  <Download className="w-4 h-4" /> {t('Download')}
                </a>
              </div>
            )}
          </div>

          {/* Version History Sidebar */}
          {showHistory && (
            <div className="w-72 border-l bg-white overflow-y-auto">
              <div className="p-4">
                <h3 className="font-semibold text-sm mb-3">{t('Version History')}</h3>
                {doc.versions.length === 0 ? (
                  <p className="text-sm text-gray-500">{t('No previous versions')}</p>
                ) : (
                  <div className="space-y-3">
                    {doc.versions.map((v, i) => (
                      <button
                        key={v.id}
                        onClick={() => setCurrentVersionIdx(i)}
                        className={`w-full text-left p-3 rounded-lg border text-sm ${currentVersionIdx === i ? 'border-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}
                      >
                        <div className="font-medium">v{doc.versions.length - i}</div>
                        <div className="text-xs text-gray-500">{v.uploadedBy}</div>
                        <div className="text-xs text-gray-400">{formatDate(v.uploadedAt)}</div>
                        {v.reason && <div className="text-xs text-gray-600 mt-1 italic">"{v.reason}"</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t bg-gray-50 text-sm text-gray-500">
          <div className="flex items-center gap-4">
            <span>{t('File Type')}: {doc.fileType}</span>
            {doc.relatedRecordType && <span>{t('Related')}: {doc.relatedRecordType} #{doc.relatedRecordId}</span>}
          </div>
          <div className="flex items-center gap-2">
            {doc.versions.length > 1 && (
              <>
                <button onClick={() => setCurrentVersionIdx(Math.min(currentVersionIdx + 1, doc.versions.length - 1))} disabled={currentVersionIdx >= doc.versions.length - 1} aria-label={t('Previous version')} className="p-1 hover:bg-gray-200 rounded disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs">v{doc.versions.length - currentVersionIdx} / {doc.versions.length}</span>
                <button onClick={() => setCurrentVersionIdx(Math.max(currentVersionIdx - 1, 0))} disabled={currentVersionIdx <= 0} aria-label={t('Next version')} className="p-1 hover:bg-gray-200 rounded disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
