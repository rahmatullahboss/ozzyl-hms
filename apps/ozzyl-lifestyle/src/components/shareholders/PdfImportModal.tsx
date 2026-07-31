/**
 * PDF Import Modal for Shareholder Data
 *
 * Uses bundled pdfjs-dist (no CDN dependency) for text-based PDFs.
 * Falls back to server-side Gemini OCR for scanned/image PDFs.
 */

import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, FileText, Check, X, AlertTriangle, AlertCircle, Loader2, Download, Trash2, ScanLine } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import * as pdfjsLib from 'pdfjs-dist';
import { parseShareholderPDF, validateParsedShareholder, previewParsedData, ParsedShareholder } from '../../lib/shareholderPdfParser';

// ── Point PDF.js worker to the bundled copy ──────────────────────────────────
// Vite copies pdfjs-dist workers to /assets during build via explicit glob import
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface PdfImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
}

interface ImportResult {
  row: number;
  status: 'imported' | 'skipped' | 'failed';
  message: string;
  id?: number;
  name: string;
}

type Step = 'upload' | 'preview' | 'importing' | 'result';

export default function PdfImportModal({ isOpen, onClose, onImportComplete }: PdfImportModalProps) {
  const { t } = useTranslation('shareholders');
  const [step, setStep] = useState<Step>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedShareholder[]>([]);
  const [previewRows, setPreviewRows] = useState<ReturnType<typeof previewParsedData>>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [importing, setImporting] = useState(false);
  const [isScannedPdf, setIsScannedPdf] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Extract text from a digital (non-scanned) PDF ──────────────────────────
  const extractTextFromPdf = useCallback(async (f: File): Promise<{ text: string; pageCount: number }> => {
    const arrayBuffer = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
      fullText += pageText + '\n\n';
    }

    return { text: fullText, pageCount: pdf.numPages };
  }, []);

  // ── Send scanned PDF to backend OCR.space endpoint ────────────────────────
  const handleOcrUpload = useCallback(async () => {
    if (!file) return;
    setOcrLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await axios.post<{ rawText: string; pageCount: number }>(
        '/api/shareholders/ocr-pdf',
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );

      const { rawText } = response.data;
      if (!rawText || rawText.trim().length < 10) {
        toast.error(t('shareholders.ocrTextNotFound'));
        return;
      }

      // Parse the raw OCR text using the same regex parser as digital PDFs
      const shareholders = parseShareholderPDF(rawText);
      if (shareholders.length === 0) {
        toast.error(t('shareholders.ocrDataExtractFailed'));
        return;
      }

      setParsedData(shareholders);
      setPreviewRows(previewParsedData(shareholders));
      setIsScannedPdf(false);
      setStep('preview');
      toast.success(t('shareholders.ocrSuccess', { count: shareholders.length }));
    } catch (err: any) {
      toast.error(err.response?.data?.message || t('shareholders.ocrFailed'));
    } finally {
      setOcrLoading(false);
    }
  }, [file]);

  // ── Handle file selection (click or drag-drop) ─────────────────────────────
  const processFile = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith('.pdf')) {
      toast.error(t('shareholders.pdfOnly'));
      return;
    }
    if (selectedFile.size > MAX_FILE_SIZE) {
      toast.error(t('shareholders.fileSizeExceeded', { maxSize: MAX_FILE_SIZE / 1024 / 1024 }));
      return;
    }
    if (selectedFile.size === 0) {
      toast.error(t('shareholders.fileEmpty'));
      return;
    }

    setFile(selectedFile);
    setIsScannedPdf(false);
    setImporting(true);

    try {
      const { text, pageCount } = await extractTextFromPdf(selectedFile);

      // Scanned PDF — no extractable text
      if (!text || text.trim().length < 10) {
        toast(`এই PDF এ ${pageCount}টি page আছে কিন্তু text নেই। নিচের "AI দিয়ে পড়ুন" বাটন ব্যবহার করুন।`, {
          icon: '📷',
          duration: 6000,
        });
        setIsScannedPdf(true);
        return;
      }

      const shareholders = parseShareholderPDF(text);
      if (shareholders.length === 0) {
        toast.error(t('shareholders.noShareholderDataFound'));
        return;
      }

      setParsedData(shareholders);
      setPreviewRows(previewParsedData(shareholders));
      setStep('preview');
    } catch (error) {
      console.error('PDF parsing error:', error);
      toast.error(error instanceof Error ? error.message : t('shareholders.pdfReadError'));
    } finally {
      setImporting(false);
    }
  }, [extractTextFromPdf]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  }, [processFile]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  // ── Bulk import to backend ─────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (parsedData.length === 0) return;
    setStep('importing');
    setImporting(true);

    try {
      const shareholdersToImport = parsedData.map(sh => ({
        name: sh.name,
        phone: sh.phone,
        nid: sh.nid,
        shareCount: sh.shareCount,
        type: sh.type,
        address: sh.address,
        email: sh.email,
        nomineeName: sh.nomineeName,
        nomineeContact: sh.nomineeContact,
        shareValueBdt: sh.shareValueBdt,
        investment: sh.investment,
      }));

      const response = await axios.post('/api/shareholders/bulk-import', {
        shareholders: shareholdersToImport,
        skipDuplicates,
      });

      setImportResults(response.data.results);
      setStep('result');

      const { imported, failed } = response.data.summary;
      if (imported > 0) {
        toast.success(t('shareholders.importSuccess', { count: imported }));
        onImportComplete();
      }
      if (failed > 0) toast.error(t('shareholders.importFailed', { count: failed }));
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('shareholders.importError'));
      setStep('preview');
    } finally {
      setImporting(false);
    }
  }, [parsedData, skipDuplicates, onImportComplete]);

  const handleReset = useCallback(() => {
    setFile(null);
    setParsedData([]);
    setPreviewRows([]);
    setImportResults([]);
    setIsScannedPdf(false);
    setStep('upload');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleDownloadSample = useCallback(() => {
    const sampleData = `নাম,ফোন,NID,শেয়ার,টাইপ,ঠিকানা,নমিনী\nমোঃ করিম উদ্দিন,01812345678,1234567890123,15,investor,ঢাকা,মোঃ রহিম উদ্দিন`;
    const blob = new Blob(['\ufeff' + sampleData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shareholder_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
          <div>
            <h3 className="font-semibold text-lg">PDF থেকে শেয়ারহোল্ডার ইম্পোর্ট</h3>
            <p className="text-sm text-[var(--color-text-muted)]">PDF ফরম আপলোড করে শেয়ারহোল্ডার ডাটা ইম্পোর্ট করুন</p>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5" aria-label="Close modal">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* ── Upload Step ── */}
          {step === 'upload' && (
            <div className="space-y-6">
              {/* Drop Zone */}
              <div
                className="border-2 border-dashed border-[var(--color-border)] rounded-xl p-8 text-center hover:border-[var(--color-primary)] transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                role="button"
                tabIndex={0}
                aria-label="PDF আপলোড করুন"
                onKeyDown={e => e.key === 'Enter' && fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
                {importing ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-12 h-12 text-[var(--color-primary)] animate-spin" />
                    <p className="text-[var(--color-text-muted)]">PDF পড়া হচ্ছে...</p>
                  </div>
                ) : isScannedPdf ? (
                  /* Scanned PDF detected — show OCR option */
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                      <ScanLine className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-700 dark:text-slate-200">{file?.name}</p>
                      <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                        স্ক্যান করা PDF — text extract করা সম্ভব হয়নি
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleOcrUpload(); }}
                      disabled={ocrLoading}
                      className="btn-primary flex items-center gap-2 px-6"
                    >
                      {ocrLoading ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> AI দিয়ে পড়া হচ্ছে...</>
                      ) : (
                        <><ScanLine className="w-4 h-4" /> AI দিয়ে পড়ুন (OCR)</>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); handleReset(); }}
                      className="text-sm text-[var(--color-text-muted)] hover:underline"
                    >
                      অন্য ফাইল বেছে নিন
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
                      <Upload className="w-8 h-8 text-[var(--color-primary)]" />
                    </div>
                    <div>
                      <p className="font-medium">PDF ফাইল আপলোড করুন</p>
                      <p className="text-sm text-[var(--color-text-muted)]">অথবা এখানে ড্র্যাগ করুন</p>
                    </div>
                    <p className="text-xs text-[var(--color-text-muted)]">সর্বোচ্চ ১০MB · শেয়ার ফরম সাপোর্টেড</p>
                  </div>
                )}
              </div>

              {/* Info box */}
              <div className="bg-[var(--color-surface)] rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium flex items-center gap-2">
                    <FileText className="w-4 h-4" /> সাপোর্টেড ফরম্যাট
                  </h4>
                  <button onClick={handleDownloadSample} className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1">
                    <Download className="w-4 h-4" /> Sample CSV
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium mb-1">✅ পড়তে পারে:</p>
                    <ul className="list-disc list-inside text-[var(--color-text-muted)] space-y-1">
                      <li>অংশীদারকারীর নাম (বাংলা/ইংরেজি)</li>
                      <li>মোবাইল নম্বর ও NID</li>
                      <li>শেয়ার সংখ্যা ও মূল্য</li>
                      <li>ঠিকানা ও নমিনীর তথ্য</li>
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium mb-1">📷 স্ক্যান করা PDF:</p>
                    <ul className="list-disc list-inside text-[var(--color-text-muted)] space-y-1">
                      <li>স্বয়ংক্রিয়ভাবে ধরা পড়বে</li>
                      <li>AI OCR দিয়ে পড়া যাবে</li>
                      <li>বাংলা text সাপোর্টেড</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Preview Step ── */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-[var(--color-surface)] rounded-lg p-3">
                <div className="flex items-center gap-3">
                  <FileText className="w-8 h-8 text-red-500" />
                  <div>
                    <p className="font-medium">{file?.name}</p>
                    <p className="text-sm text-[var(--color-text-muted)]">{parsedData.length} জন শেয়ারহোল্ডার পাওয়া গেছে</p>
                  </div>
                </div>
                <button onClick={handleReset} className="btn-ghost text-sm">
                  <Trash2 className="w-4 h-4" /> মুছুন
                </button>
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={e => setSkipDuplicates(e.target.checked)}
                  className="checkbox"
                />
                <span className="text-sm">ডুপ্লিকেট বাদ দিন (NID/ফোন মিলে গেলে)</span>
              </label>

              <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg">
                <table className="table-base text-sm">
                  <thead>
                    <tr className="bg-[var(--color-surface)]">
                      <th className="w-12">#</th>
                      <th>নাম</th>
                      <th>ফোন</th>
                      <th>NID</th>
                      <th className="text-right">শেয়ার</th>
                      <th>ঠিকানা</th>
                      <th>নমিনী</th>
                      <th className="w-20">স্ট্যাটাস</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-8 text-[var(--color-text-muted)]">কোনো ডাটা পাওয়া যায়নি</td></tr>
                    ) : (
                      previewRows.map(row => (
                        <tr key={row.row} className={row.status === 'error' ? 'bg-red-50 dark:bg-red-900/20' : row.status === 'warning' ? 'bg-amber-50 dark:bg-amber-900/20' : ''}>
                          <td className="text-center text-[var(--color-text-muted)]">{row.row}</td>
                          <td className="font-medium">{row.name}</td>
                          <td>{row.phone}</td>
                          <td className="font-mono text-xs">{row.nid}</td>
                          <td className="text-right font-data">{row.shares}</td>
                          <td className="max-w-[150px] truncate">{row.address}</td>
                          <td className="max-w-[120px] truncate">{row.nominee}</td>
                          <td>
                            {row.status === 'valid' && <Check className="w-5 h-5 text-emerald-500" />}
                            {row.status === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                            {row.status === 'error' && <AlertCircle className="w-5 h-5 text-red-500" />}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-3 gap-4">
                {[
                  { count: previewRows.filter(r => r.status === 'valid').length, label: 'সফল', color: 'emerald' },
                  { count: previewRows.filter(r => r.status === 'warning').length, label: 'সতর্কতা', color: 'amber' },
                  { count: previewRows.filter(r => r.status === 'error').length, label: 'ত্রুটি', color: 'red' },
                ].map(({ count, label, color }) => (
                  <div key={label} className={`p-3 bg-${color}-50 dark:bg-${color}-900/20 rounded-lg text-center`}>
                    <p className={`text-2xl font-bold text-${color}-600`}>{count}</p>
                    <p className="text-sm text-[var(--color-text-muted)]">{label}</p>
                  </div>
                ))}
              </div>

              {previewRows.some(r => r.messages.length > 0) && (
                <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4">
                  <p className="font-medium text-amber-700 dark:text-amber-300 mb-2">সতর্কতা:</p>
                  <ul className="text-sm text-amber-600 dark:text-amber-400 space-y-1">
                    {previewRows.filter(r => r.messages.length > 0).slice(0, 5).map(r => (
                      <li key={r.row}>• Row {r.row} ({r.name}): {r.messages.join(', ')}</li>
                    ))}
                    {previewRows.filter(r => r.messages.length > 0).length > 5 && (
                      <li>• ...এবং আরও {previewRows.filter(r => r.messages.length > 0).length - 5}টি</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Importing Step ── */}
          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-16 h-16 text-[var(--color-primary)] animate-spin mb-4" />
              <p className="text-lg font-medium">ইম্পোর্ট হচ্ছে...</p>
              <p className="text-sm text-[var(--color-text-muted)]">{parsedData.length} জন শেয়ারহোল্ডার</p>
            </div>
          )}

          {/* ── Result Step ── */}
          {step === 'result' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                {[
                  { count: importResults.filter(r => r.status === 'imported').length, label: 'ইম্পোর্ট হয়েছে', color: 'emerald' },
                  { count: importResults.filter(r => r.status === 'skipped').length, label: 'বাদ পড়েছে', color: 'amber' },
                  { count: importResults.filter(r => r.status === 'failed').length, label: 'ব্যর্থ', color: 'red' },
                ].map(({ count, label, color }) => (
                  <div key={label} className={`p-4 bg-${color}-50 dark:bg-${color}-900/20 rounded-lg text-center`}>
                    <p className={`text-3xl font-bold text-${color}-600`}>{count}</p>
                    <p className="text-sm text-[var(--color-text-muted)]">{label}</p>
                  </div>
                ))}
              </div>

              <div className="overflow-x-auto border border-[var(--color-border)] rounded-lg max-h-[300px]">
                <table className="table-base text-sm">
                  <thead className="sticky top-0 bg-[var(--color-surface)]">
                    <tr>
                      <th className="w-12">#</th>
                      <th>নাম</th>
                      <th>স্ট্যাটাস</th>
                      <th>বিবরণ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResults.map(result => (
                      <tr key={result.row} className={
                        result.status === 'skipped' ? 'bg-amber-50 dark:bg-amber-900/20' :
                        result.status === 'failed'  ? 'bg-red-50 dark:bg-red-900/20' : ''
                      }>
                        <td className="text-center text-[var(--color-text-muted)]">{result.row}</td>
                        <td className="font-medium">{result.name}</td>
                        <td>
                          {result.status === 'imported' && <span className="badge badge-success flex items-center gap-1 w-fit"><Check className="w-3 h-3" /> সফল</span>}
                          {result.status === 'skipped'  && <span className="badge badge-warning flex items-center gap-1 w-fit"><AlertTriangle className="w-3 h-3" /> বাদ</span>}
                          {result.status === 'failed'   && <span className="badge badge-error flex items-center gap-1 w-fit"><AlertCircle className="w-3 h-3" /> ব্যর্থ</span>}
                        </td>
                        <td className="text-sm text-[var(--color-text-muted)]">{result.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-[var(--color-border)] flex justify-end gap-3">
          {step === 'upload' && (
            <button onClick={onClose} className="btn-secondary">বন্ধ করুন</button>
          )}
          {step === 'preview' && (
            <>
              <button onClick={handleReset} className="btn-secondary">পিছনে</button>
              <button
                onClick={handleImport}
                disabled={parsedData.length === 0 || importing}
                className="btn-primary"
              >
                {importing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> ইম্পোর্ট হচ্ছে...</>
                ) : (
                  <><Upload className="w-4 h-4" /> {parsedData.length} জন ইম্পোর্ট করুন</>
                )}
              </button>
            </>
          )}
          {step === 'result' && (
            <>
              <button onClick={handleReset} className="btn-secondary">আরও আপলোড</button>
              <button onClick={onClose} className="btn-primary">সম্পন্ন</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
