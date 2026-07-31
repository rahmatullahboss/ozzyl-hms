import { useState, useEffect } from 'react';
import { Clock, Calendar } from 'lucide-react';

const DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

interface Props {
  value: string;
  onChange: (val: string) => void;
}

export function VisitingHoursSelector({ value, onChange }: Props) {
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('13:00');
  const [isManual, setIsManual] = useState(false);

  // Initialize from value if it matches our pattern
  useEffect(() => {
    if (value && !isManual) {
      // Basic check: if it contains days and times in our expected format
      // Example: "Sat, Sun, Mon 09:00 AM - 01:00 PM"
      const parts = value.split(' ');
      const daysPart = parts.slice(0, -5).join(' ').replace(/,/g, '').split(' ');
      if (daysPart.every(d => DAYS.includes(d))) {
        // Looks like our format, but let's not overcomplicate initialization for now.
        // If it's different, we'll just treat it as manual.
      }
    }
  }, []);

  const toggleDay = (day: string) => {
    setSelectedDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const formatTime = (time: string) => {
    if (!time) return '';
    const [h, m] = time.split(':');
    const hh = parseInt(h);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h12 = hh % 12 || 12;
    return `${String(h12).padStart(2, '0')}:${m} ${ampm}`;
  };

  useEffect(() => {
    if (!isManual && selectedDays.length > 0) {
      const daysStr = selectedDays.join(', ');
      const startStr = formatTime(startTime);
      const endStr = formatTime(endTime);
      onChange(`${daysStr} ${startStr} - ${endStr}`);
    }
  }, [selectedDays, startTime, endTime, isManual]);

  return (
    <div className="space-y-3 p-4 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg-alt)]">
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-semibold text-[var(--color-text-primary)] flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5 text-[var(--color-primary)]" />
          Select Days
        </label>
        <button
          type="button"
          onClick={() => setIsManual(!isManual)}
          className="text-[10px] text-[var(--color-primary)] hover:underline font-medium"
        >
          {isManual ? 'Switch to Selector' : 'Manual Entry'}
        </button>
      </div>

      {isManual ? (
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          className="input !h-10"
          placeholder="e.g. Sat-Thu 9am-1pm"
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
                  selectedDays.includes(day)
                    ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] shadow-sm'
                    : 'bg-white text-[var(--color-text-muted)] border-[var(--color-border)] hover:border-[var(--color-primary)]'
                }`}
              >
                {day}
              </button>
            ))}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="start-time" className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-bold mb-1.5 block">From</label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
                <input
                  id="start-time"
                  type="time"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  className="input pl-10 text-sm !h-10 shadow-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="end-time" className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-bold mb-1.5 block">To</label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)] pointer-events-none" />
                <input
                  id="end-time"
                  type="time"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                  className="input pl-10 text-sm !h-10 shadow-sm"
                />
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-[var(--color-border)] border-dashed">
            <div className="text-[11px] text-[var(--color-text-muted)] flex items-center gap-2">
              <span className="font-medium text-[var(--color-text-primary)]">Preview:</span>
              <span className="px-2 py-0.5 bg-[var(--color-bg)] rounded border border-[var(--color-border)]">
                {selectedDays.length > 0 
                  ? `${selectedDays.join(', ')} ${formatTime(startTime)} - ${formatTime(endTime)}` 
                  : 'Select days above...'}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
