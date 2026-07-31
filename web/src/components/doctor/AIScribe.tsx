import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic, Square, Trash2, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';

interface AIScribeProps {
  patientId?: number;
  initialTranscript?: string;
  onTranscriptReady: (text: string) => void;
}

type RecordingState = 'idle' | 'recording' | 'paused' | 'processing' | 'ready';

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

export function AIScribe({ initialTranscript = '', onTranscriptReady }: AIScribeProps) {
  const { t } = useTranslation('dashboard');
  const [state, setState] = useState<RecordingState>('idle');
  const [transcript, setTranscript] = useState(initialTranscript);
  const [interimText, setInterimText] = useState('');
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  // Use a ref for state-reads inside the recognition.onend handler.
  // Without this, the empty-deps useEffect captures the initial 'idle' state
  // and the auto-restart check is wrong once state changes.
  const stateRef = useRef<RecordingState>('idle');
  const userStoppedRef = useRef(false);
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    const SpeechRecognition = (window as SpeechWindow).SpeechRecognition || (window as SpeechWindow).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-GB';

    recognition.onresult = (event) => {
      let final = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      if (final) {
        setTranscript(prev => prev + final + ' ');
      }
      setInterimText(interim);
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error', event.error);
      if (event.error === 'not-allowed') {
        toast.error(t('microphonePermissionDenied', { defaultValue: 'Microphone permission denied' }));
      }
      stateRef.current = 'idle';
      setState('idle');
    };

    recognition.onend = () => {
      // Only auto-restart if the user has NOT pressed Stop and we are still
      // in the recording state. Reads from refs to avoid stale closure.
      if (!userStoppedRef.current && stateRef.current === 'recording') {
        try {
          recognition.start();
        } catch {
          stateRef.current = 'idle';
          setState('idle');
        }
      }
    };

    recognitionRef.current = recognition;
    return () => {
      userStoppedRef.current = true;
      try { recognition.stop(); } catch { /* already stopped */ }
    };
  }, []);

  const startRecording = useCallback(() => {
    userStoppedRef.current = false;
    setInterimText('');
    try {
      recognitionRef.current?.start();
      stateRef.current = 'recording';
      setState('recording');
    } catch (e) {
      console.error('Failed to start recording', e);
      toast.error(t('recordingFailed', { defaultValue: 'Failed to start recording' }));
    }
  }, []);

  const stopRecording = useCallback(() => {
    userStoppedRef.current = true;
    stateRef.current = 'idle';
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    setState('idle');
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript('');
    setInterimText('');
    setState('idle');
  }, []);

  const handleUseTranscript = useCallback(() => {
    onTranscriptReady(transcript);
    setState('ready');
    toast.success(t('transcriptReady', { defaultValue: 'Transcript ready to use' }));
  }, [transcript, onTranscriptReady]);

  const formatForMedical = useCallback(() => {
    let formatted = transcript;
    // Common medical abbreviations
    formatted = formatted.replace(/\bpatient\b/gi, 'Patient');
    formatted = formatted.replace(/\bhistory\b/gi, 'Hx');
    formatted = formatted.replace(/\bexamination\b/gi, 'Ex');
    formatted = formatted.replace(/\bdiagnosis\b/gi, 'Dx');
    formatted = formatted.replace(/\btreatment\b/gi, 'Tx');
    formatted = formatted.replace(/\bversus\b/gi, 'vs.');
    formatted = formatted.replace(/\bwithout\b/gi, 'w/o');
    formatted = formatted.replace(/\bwith\b/gi, 'w/');
    setTranscript(formatted);
    toast.success(t('formatted', { defaultValue: 'Formatted for medical notes' }));
  }, [transcript]);

  if (!isSupported) {
    return (
      <div className="card p-6 text-center">
        <Mic className="w-12 h-12 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
        <p className="text-[var(--color-text-muted)]">{t('speechNotSupported', { defaultValue: 'Speech recognition not supported in this browser' })}</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">{t('useChromeEdge', { defaultValue: 'Try Chrome or Edge for best experience' })}</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
        <h3 className="font-semibold text-[var(--color-text)] flex items-center gap-2">
          <Mic className="w-4 h-4 text-[var(--color-primary)]" />
          {t('aiScribe', { defaultValue: 'AI Scribe' })}
        </h3>
        <span className={`text-xs px-2 py-1 rounded-full ${
          state === 'recording' ? 'bg-red-100 text-red-700 animate-pulse' :
          state === 'ready' ? 'bg-green-100 text-green-700' :
          'bg-gray-100 text-gray-600'
        }`}>
          {state === 'recording' ? t('recording', { defaultValue: 'Recording...' }) :
           state === 'ready' ? t('ready', { defaultValue: 'Ready' }) :
           t('idle', { defaultValue: 'Idle' })}
        </span>
      </div>

      <div className="p-4">
        <div className="relative">
          <textarea
            value={transcript + interimText}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder={t('scribePlaceholder', { defaultValue: 'Click the microphone to start dictation...' })}
            className="w-full h-48 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none font-mono"
          />
          {state === 'recording' && (
            <div className="absolute top-3 right-3 flex items-center gap-1 text-xs text-red-600">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {t('listening', { defaultValue: 'Listening...' })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {state !== 'recording' ? (
            <button
              onClick={startRecording}
              className="btn-primary text-xs flex items-center gap-1.5"
            >
              <Mic className="w-3.5 h-3.5" />
              {t('startRecording', { defaultValue: 'Start Recording' })}
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="btn-ghost text-xs flex items-center gap-1.5 text-red-600"
            >
              <Square className="w-3.5 h-3.5" />
              {t('stop', { defaultValue: 'Stop' })}
            </button>
          )}

          <button
            onClick={formatForMedical}
            disabled={!transcript}
            className="btn-ghost text-xs flex items-center gap-1.5"
            title={t('formatMedical', { defaultValue: 'Format for medical notes' })}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t('format', { defaultValue: 'Format' })}
          </button>

          <button
            onClick={handleUseTranscript}
            disabled={!transcript || state === 'recording'}
            className="btn-primary text-xs flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {t('useTranscript', { defaultValue: 'Use Transcript' })}
          </button>

          <button
            onClick={clearTranscript}
            disabled={!transcript && !interimText}
            className="btn-ghost text-xs flex items-center gap-1.5 text-red-600 ml-auto"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('clear', { defaultValue: 'Clear' })}
          </button>
        </div>

        <div className="mt-3 text-xs text-[var(--color-text-muted)]">
          <p>{t('scribeTip', { defaultValue: 'Tip: Speak naturally. The AI will capture your clinical notes in real-time.' })}</p>
          <p className="mt-1">{t('scribeFormats', { defaultValue: 'Formats common terms: Patient→Patient, Hx→History, Dx→Diagnosis, Tx→Treatment' })}</p>
        </div>
      </div>
    </div>
  );
}
