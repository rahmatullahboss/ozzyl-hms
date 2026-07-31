import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, MicOff, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface VoiceNoteButtonProps {
  onTranscript: (text: string) => void;
  language?: string;
  className?: string;
}

export default function VoiceNoteButton({ onTranscript, language = 'en-GB', className = '' }: VoiceNoteButtonProps) {
  const { t } = useTranslation('nursing');
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef('');

  const isSupported = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
    };
  }, []);

  const startRecording = useCallback(() => {
    if (!isSupported) {
      setError(t('voice.notSupported'));
      return;
    }

    setError(null);
    transcriptRef.current = '';

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + ' ';
        }
      }
      if (finalTranscript) {
        transcriptRef.current = finalTranscript;
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'not-allowed') {
        setError(t('voice.permissionDenied'));
      }
      stopRecording();
    };

    recognition.onend = () => {
      if (transcriptRef.current) {
        onTranscript(transcriptRef.current.trim());
      }
      setIsRecording(false);
      setDuration(0);
      if (timerRef.current) clearInterval(timerRef.current);
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);
      setDuration(0);
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } catch {
      setError(t('voice.notSupported'));
    }
  }, [isSupported, language, onTranscript, t]);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);
  }, []);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  if (!isSupported) {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        className={`btn-ghost p-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-inset ${
          isRecording
            ? 'bg-red-100 text-red-600 animate-pulse'
            : 'hover:bg-gray-100 text-gray-500'
        }`}
        title={isRecording ? t('voice.stopRecording') : t('voice.startRecording')}
        aria-label={isRecording ? t('voice.stopRecording') : t('voice.startRecording')}
        aria-pressed={isRecording}
      >
        {isRecording ? (
          <Square className="w-4 h-4" />
        ) : (
          <Mic className="w-4 h-4" />
        )}
      </button>
      {isRecording && (
        <span className="text-xs text-red-600 font-mono animate-pulse">
          {t('voice.recording')} {formatDuration(duration)}
        </span>
      )}
      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  );
}
