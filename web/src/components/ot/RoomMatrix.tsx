import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { DoorOpen, Wrench, SprayCan, Stethoscope, Ban, Clock } from 'lucide-react';

interface OTRoom {
  id: number;
  name: string;
  room_code?: string;
  floor?: string;
  room_type: string;
  status: string;
  cleaning_duration_minutes: number;
  sterilization_duration_minutes: number;
}

const STATUS_CONFIG: Record<string, { bg: string; text: string; icon: typeof DoorOpen; label: string }> = {
  available:       { bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800',
                     text: 'text-emerald-700 dark:text-emerald-300', icon: DoorOpen, label: 'Available' },
  occupied:        { bg: 'bg-blue-50 border-blue-200 dark:bg-blue-900/20 dark:border-blue-800',
                     text: 'text-blue-700 dark:text-blue-300', icon: Stethoscope, label: 'In Operation' },
  cleaning:        { bg: 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800',
                     text: 'text-amber-700 dark:text-amber-300', icon: SprayCan, label: 'Cleaning' },
  sterilization:   { bg: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800',
                     text: 'text-yellow-700 dark:text-yellow-300', icon: SprayCan, label: 'Sterilization' },
  maintenance:     { bg: 'bg-slate-50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700',
                     text: 'text-slate-500 dark:text-slate-400', icon: Wrench, label: 'Maintenance' },
  blocked:         { bg: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800',
                     text: 'text-red-700 dark:text-red-300', icon: Ban, label: 'Blocked' },
};

function RoomCard({ room }: { room: OTRoom }) {
  const config = STATUS_CONFIG[room.status] ?? STATUS_CONFIG.available;
  const Icon = config.icon;
  return (
    <div className={`rounded-xl border p-4 transition-all hover:shadow-md ${config.bg}`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className={`font-semibold text-sm ${config.text}`}>{room.name}</h4>
        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${config.bg} ${config.text}`}>
          <Icon className="w-3 h-3" />
          {config.label}
        </span>
      </div>
      <div className="space-y-1 text-xs text-[var(--color-text-muted)]">
        {room.room_code && <p>Code: {room.room_code}</p>}
        {room.floor && <p>Floor: {room.floor}</p>}
        <p>Type: {room.room_type}</p>
        <div className="flex items-center gap-1 mt-2">
          <Clock className="w-3 h-3" />
          <span>Clean {room.cleaning_duration_minutes}m / Sterilize {room.sterilization_duration_minutes}m</span>
        </div>
      </div>
    </div>
  );
}

export default function RoomMatrix() {
  const { data, isLoading } = useApiQuery<{ rooms: OTRoom[] }>(
    queryKeys.ot.rooms(),
    '/api/ot/rooms',
  );
  const rooms = data?.rooms ?? [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
      </div>
    );
  }

  if (rooms.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">OT Rooms</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {rooms.map((room: OTRoom) => <RoomCard key={room.id} room={room} />)}
      </div>
    </div>
  );
}
