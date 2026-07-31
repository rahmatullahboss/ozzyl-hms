import { useEffect, useRef, useState, useCallback, useId } from 'react';
import { Camera, CameraOff, X, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface BarcodeScannerProps {
  onScan: (value: string) => void;
  onError?: (error: string) => void;
  className?: string;
}

export default function BarcodeScanner({ onScan, onError, className }: BarcodeScannerProps) {
  const { t } = useTranslation('nursing');
  const elementId = useId();
  const scannerRef = useRef<HTMLDivElement>(null);
  const scannerInstanceRef = useRef<unknown>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const lastScannedRef = useRef<string>('');
  const lastScannedAtRef = useRef<number>(0);

  const stopScanner = useCallback(async () => {
    if (scannerInstanceRef.current) {
      try {
        const scanner = scannerInstanceRef.current as { stop: () => Promise<void> };
        await scanner.stop();
      } catch {
        // ignore stop errors
      }
      scannerInstanceRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    if (!scannerRef.current) return;
    setIsLoading(true);

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(scannerRef.current.id);
      scannerInstanceRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText: string) => {
          const now = Date.now();
          if (decodedText === lastScannedRef.current && now - lastScannedAtRef.current < 2000) {
            return;
          }
          lastScannedRef.current = decodedText;
          lastScannedAtRef.current = now;
          onScan(decodedText);
        },
        () => {
          // ignore scan failures (no code found in frame)
        },
      );

      setIsScanning(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('barcode.scanError');
      onError?.(message);
    } finally {
      setIsLoading(false);
    }
  }, [onScan, onError, t]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  const handleToggle = () => {
    if (isScanning) {
      stopScanner();
    } else {
      startScanner();
    }
  };

  return (
    <div className={className}>
      <div
        id={`barcode-scanner-${elementId}`}
        ref={scannerRef}
        className={`rounded-lg overflow-hidden bg-black ${isScanning ? 'aspect-square max-w-[300px]' : 'h-0'}`}
      />

      {!isScanning && !isLoading && (
        <div className="flex flex-col items-center gap-3 py-4">
          <Camera className="w-10 h-10 text-[var(--color-text-muted)]" />
          <p className="text-sm text-[var(--color-text-muted)]">
            {t('barcode.noCamera')}
          </p>
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <button
          onClick={handleToggle}
          disabled={isLoading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            isScanning
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'bg-emerald-500 text-white hover:bg-emerald-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
          data-testid="barcode-toggle-btn"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isScanning ? (
            <CameraOff className="w-4 h-4" />
          ) : (
            <Camera className="w-4 h-4" />
          )}
          {isLoading
            ? t('barcode.scanning')
            : isScanning
              ? t('barcode.stopScan')
              : t('barcode.startScan')}
        </button>
        {isScanning && (
          <button
            onClick={stopScanner}
            className="p-2 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)] transition-colors"
            data-testid="barcode-close-btn"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
