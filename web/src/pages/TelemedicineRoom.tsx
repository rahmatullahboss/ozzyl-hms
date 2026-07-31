import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { ChevronRight, Mic, MicOff, Video as VideoIcon, VideoOff, Phone, MessageSquare, Clock, Users } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/apiClient';

// Types
interface RoomData {
  id: string;
  sessionId?: string;
  participantSessionIds?: string[];
  doctorName?: string;
  patientName?: string;
  status: string;
  createdAt: string;
}

interface TrackDescriptor {
  location: 'local' | 'remote';
  trackName: string;
  sessionId?: string;
  mid?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function TelemedicineRoom({ role = 'hospital_admin' }: { role?: string }) {
  const { t, i18n } = useTranslation(['telemedicine', 'common']);

  const { slug = '', roomId = '' } = useParams<{ slug: string; roomId: string }>();
  const basePath = `/h/${slug}`;
  const navigate = useNavigate();

  const [room, setRoom] = useState<RoomData | null>(null);
  const [mySessionId, setMySessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{ from: string; text: string; time: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mySessionIdRef = useRef<string | null>(null);
  const subscribedPeersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    initRoom();
    return () => { cleanup(); };
  }, [roomId]);

  useEffect(() => {
    if (connected && !timerRef.current) {
      timerRef.current = setInterval(() => { setCallDuration(d => d + 1); }, 1000);
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [connected]);

  const cleanup = useCallback(() => {
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (roomPollRef.current) { clearInterval(roomPollRef.current); roomPollRef.current = null; }
    mySessionIdRef.current = null;
    subscribedPeersRef.current.clear();
  }, []);

  const subscribeToPeerTracks = useCallback(async (sessionId: string, peerSessionId: string, pc: RTCPeerConnection) => {
    const tracks: TrackDescriptor[] = [
      { location: 'remote', trackName: 'video', sessionId: peerSessionId },
      { location: 'remote', trackName: 'audio', sessionId: peerSessionId },
    ];
    const pullRes = await api.post<{ sessionDescription?: RTCSessionDescriptionInit }>(`/api/telemedicine/sessions/${sessionId}/tracks`, { tracks });
    if (!pullRes.sessionDescription) return;
    await pc.setRemoteDescription(new RTCSessionDescription(pullRes.sessionDescription));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await api.put(`/api/telemedicine/sessions/${sessionId}/renegotiate`, { sessionDescription: { sdp: answer.sdp, type: answer.type } });
  }, []);

  const syncRemoteParticipants = useCallback(async (roomData: RoomData | null, sessionId: string, pc: RTCPeerConnection | null) => {
    if (!roomData || !pc) return;
    const peerSessionIds = (roomData.participantSessionIds ?? []).filter((peerId) => (
      !!peerId && peerId !== sessionId && !subscribedPeersRef.current.has(peerId)
    ));
    for (const peerSessionId of peerSessionIds) {
      try {
        await subscribeToPeerTracks(sessionId, peerSessionId, pc);
        subscribedPeersRef.current.add(peerSessionId);
      } catch { /* Remote tracks may not exist yet */ }
    }
  }, [subscribeToPeerTracks]);

  const buildLocalTrackDescriptors = (pc: RTCPeerConnection): TrackDescriptor[] => {
    const tracks: TrackDescriptor[] = [];
    for (const transceiver of pc.getTransceivers()) {
      const kind = transceiver.sender.track?.kind;
      if (!kind || !transceiver.mid) continue;
      tracks.push({ location: 'local', trackName: kind, mid: transceiver.mid });
    }
    return tracks;
  };

  const initRoom = async () => {
    setLoading(true);
    setError(null);
    try {
      const roomRes = await api.get<{ room?: RoomData } & RoomData>(`/api/telemedicine/rooms/${roomId}`);
      const roomData: RoomData = roomRes.room ?? roomRes;
      setRoom(roomData);

      const joinRes = await api.post<{ sessionId?: string; room?: RoomData }>(`/api/telemedicine/rooms/${roomId}/join`, {});
      const { sessionId } = joinRes;
      if (!sessionId) throw new Error('Telemedicine service is not configured. Please contact your administrator.');
      const joinedRoom: RoomData = joinRes.room ?? roomData;
      setRoom(joinedRoom);
      mySessionIdRef.current = sessionId;
      setMySessionId(sessionId);

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
      pcRef.current = pc;
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) { remoteVideoRef.current.srcObject = event.streams[0]; setConnected(true); }
      };
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') setConnected(false);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const pushRes = await api.post<{ sessionDescription?: RTCSessionDescriptionInit }>(`/api/telemedicine/sessions/${sessionId}/tracks`, {
        sessionDescription: { sdp: offer.sdp, type: 'offer' },
        tracks: buildLocalTrackDescriptors(pc),
      });
      if (pushRes.sessionDescription) await pc.setRemoteDescription(new RTCSessionDescription(pushRes.sessionDescription));

      await syncRemoteParticipants(joinedRoom, sessionId, pc);
    } catch (err: unknown) {
      console.error('[Telemedicine] Init error:', err);
      const message = err instanceof Error ? err.message : 'Failed to initialize room';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!roomId || !mySessionId || !pcRef.current) return undefined;
    roomPollRef.current = setInterval(async () => {
      try {
        const roomRes = await api.get<{ room?: RoomData } & RoomData>(`/api/telemedicine/rooms/${roomId}`);
        const latestRoom: RoomData = roomRes.room ?? roomRes;
        setRoom(latestRoom);
        await syncRemoteParticipants(latestRoom, mySessionId, pcRef.current);
      } catch { /* Best-effort polling */ }
    }, 3000);
    return () => { if (roomPollRef.current) { clearInterval(roomPollRef.current); roomPollRef.current = null; } };
  }, [roomId, mySessionId, syncRemoteParticipants]);

  const toggleAudio = () => {
    if (localStreamRef.current) { localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; }); setAudioEnabled(e => !e); }
  };
  const toggleVideo = () => {
    if (localStreamRef.current) { localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = !t.enabled; }); setVideoEnabled(e => !e); }
  };
  const endCall = async () => {
    cleanup();
    try { await api.delete(`/api/telemedicine/rooms/${roomId}`); } catch { /* best effort */ }
    navigate(`${basePath}/telemedicine`);
  };
  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    setChatMessages(prev => [...prev, { 
      from: t('room.you'), 
      text: chatInput.trim(), 
      time: new Date().toLocaleTimeString(i18n.language === 'bn' ? 'bn-BD' : 'en-GB', { hour: '2-digit', minute: '2-digit' }) 
    }]);
    setChatInput('');
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('common:dashboard')}</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/telemedicine`} className="hover:underline">{t('title')}</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('room.consultation')}</span>
            </div>
            <h1 className="text-xl font-bold text-[var(--color-text)]">
              {room ? `${room.doctorName} ↔ ${room.patientName}` : t('room.connecting')}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {connected && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <Clock className="w-3 h-3" />
                <span className="font-mono font-medium">{formatDuration(callDuration)}</span>
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-96">
            <div className="text-center space-y-3">
              <div className="w-12 h-12 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-[var(--color-text-muted)]">{t('room.initializing')}</p>
            </div>
          </div>
        ) : error ? (
          <div className="card p-8 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <Phone className="w-8 h-8 text-red-500" />
            </div>
            <p className="font-semibold text-red-600">{t('room.connection_failed')}</p>
            <p className="text-sm text-[var(--color-text-muted)]">{error}</p>
            <div className="flex gap-2 justify-center">
              <button onClick={initRoom} className="btn-primary">{t('common:retry')}</button>
              <Link to={`${basePath}/telemedicine`} className="btn text-sm border border-[var(--color-border)]">{t('common:back')}</Link>
            </div>
          </div>
        ) : (
          <div className="flex gap-4">
            <div className="flex-1 space-y-3">
              <div className="relative bg-gray-900 rounded-2xl overflow-hidden aspect-video">
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
                {!connected && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center text-white space-y-3">
                      <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center mx-auto">
                        <Users className="w-10 h-10" />
                      </div>
                      <p className="text-sm opacity-75">{t('room.waiting_participant')}</p>
                    </div>
                  </div>
                )}
                <div className="absolute bottom-4 right-4 w-44 h-32 rounded-xl overflow-hidden border-2 border-white/30 shadow-xl">
                  <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                  {!videoEnabled && (
                    <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                      <VideoOff className="w-6 h-6 text-white/50" />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-center gap-3">
                <button onClick={toggleAudio} className={`w-12 h-12 rounded-full flex items-center justify-center transition ${audioEnabled ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-red-500 text-white'}`}>
                  {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>
                <button onClick={toggleVideo} className={`w-12 h-12 rounded-full flex items-center justify-center transition ${videoEnabled ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-red-500 text-white'}`}>
                  {videoEnabled ? <VideoIcon className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                </button>
                <button onClick={() => setShowChat(!showChat)} className={`w-12 h-12 rounded-full flex items-center justify-center transition ${showChat ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                  <MessageSquare className="w-5 h-5" />
                </button>
                <button onClick={endCall} className="w-14 h-12 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition">
                  <Phone className="w-5 h-5 rotate-[135deg]" />
                </button>
              </div>
            </div>

            {showChat && (
              <div className="w-72 card flex flex-col">
                <div className="px-4 py-3 border-b border-[var(--color-border)]">
                  <h3 className="font-semibold text-sm">{t('common:chat')}</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-80">
                  {chatMessages.length === 0 && (<p className="text-xs text-[var(--color-text-muted)] text-center py-4">{t('room.no_messages')}</p>)}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`text-xs ${msg.from === t('room.you') ? 'text-right' : ''}`}>
                      <div className={`inline-block px-3 py-1.5 rounded-lg max-w-[200px] ${msg.from === t('room.you') ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-100'}`}>
                        <p>{msg.text}</p>
                      </div>
                      <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{msg.time}</p>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-[var(--color-border)]">
                  <div className="flex gap-2">
                    <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChatMessage()} placeholder={t("room.placeholder_chat")} className="flex-1 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-xs" />
                    <button onClick={sendChatMessage} className="btn-primary text-xs px-3">{t('common:send')}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
