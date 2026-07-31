import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { ChevronRight, Mic, MicOff, Video as VideoIcon, VideoOff, Phone, MessageSquare, Clock, Users } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

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

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TelemedicineRoom({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['telemedicine', 'common']);

  const { slug = '', roomId = '' } = useParams<{ slug: string; roomId: string }>();
  const basePath = `/h/${slug}`;
  const navigate = useNavigate();

  // State
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

  // Refs
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const roomPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mySessionIdRef = useRef<string | null>(null);
  const subscribedPeersRef = useRef<Set<string>>(new Set());

  // ─── Initialize ──────────────────────────────────────────────────────────

  useEffect(() => {
    initRoom();
    return () => {
      cleanup();
    };
  }, [roomId]);

  // Duration timer
  useEffect(() => {
    if (connected && !timerRef.current) {
      timerRef.current = setInterval(() => {
        setCallDuration(d => d + 1);
      }, 1000);
    }
    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [connected]);

  const cleanup = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (roomPollRef.current) {
      clearInterval(roomPollRef.current);
      roomPollRef.current = null;
    }
    mySessionIdRef.current = null;
    subscribedPeersRef.current.clear();
  }, []);

  const subscribeToPeerTracks = useCallback(async (sessionId: string, peerSessionId: string, pc: RTCPeerConnection) => {
    const tracks: TrackDescriptor[] = [
      { location: 'remote', trackName: 'video', sessionId: peerSessionId },
      { location: 'remote', trackName: 'audio', sessionId: peerSessionId },
    ];

    const pullRes = await axios.post(`/api/telemedicine/sessions/${sessionId}/tracks`, { tracks }, { headers: authHeaders() });

    if (!pullRes.data.sessionDescription) {
      return;
    }

    await pc.setRemoteDescription(new RTCSessionDescription(pullRes.data.sessionDescription));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await axios.put(`/api/telemedicine/sessions/${sessionId}/renegotiate`, {
      sessionDescription: { sdp: answer.sdp, type: answer.type },
    }, { headers: authHeaders() });
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
      } catch {
        // Remote tracks may not exist yet; polling retries later.
      }
    }
  }, [subscribeToPeerTracks]);

  const buildLocalTrackDescriptors = (pc: RTCPeerConnection): TrackDescriptor[] => {
    const tracks: TrackDescriptor[] = [];
    for (const transceiver of pc.getTransceivers()) {
      const kind = transceiver.sender.track?.kind;
      if (!kind || !transceiver.mid) continue;
      tracks.push({
        location: 'local',
        trackName: kind,
        mid: transceiver.mid,
      });
    }
    return tracks;
  };

  const initRoom = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Get room info
      const roomRes = await axios.get(`/api/telemedicine/rooms/${roomId}`, { headers: authHeaders() });
      const roomData: RoomData = roomRes.data.room ?? roomRes.data;
      setRoom(roomData);

      // 2. Join room → get our own Cloudflare Realtime SFU session
      const joinRes = await axios.post(`/api/telemedicine/rooms/${roomId}/join`, {}, { headers: authHeaders() });
      const { sessionId } = joinRes.data;
      if (!sessionId) {
        throw new Error('Telemedicine service is not configured. Please contact your administrator.');
      }
      const joinedRoom: RoomData = joinRes.data.room ?? roomData;
      setRoom(joinedRoom);
      mySessionIdRef.current = sessionId;
      setMySessionId(sessionId);

      // 3. Get local media
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // 4. Create PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      });
      pcRef.current = pc;

      // Add local tracks
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // Handle remote tracks
      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          setConnected(true);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          setConnected(false);
        }
      };

      // 5. Create offer and push tracks to CF Calls
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const pushRes = await axios.post(`/api/telemedicine/sessions/${sessionId}/tracks`, {
        sessionDescription: { sdp: offer.sdp, type: 'offer' },
        tracks: buildLocalTrackDescriptors(pc),
      }, { headers: authHeaders() });

      if (pushRes.data.sessionDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(pushRes.data.sessionDescription));
      }

      // 6. Pull any tracks already published in the room
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
        const roomRes = await axios.get(`/api/telemedicine/rooms/${roomId}`, { headers: authHeaders() });
        const latestRoom: RoomData = roomRes.data.room ?? roomRes.data;
        setRoom(latestRoom);
        await syncRemoteParticipants(latestRoom, mySessionId, pcRef.current);
      } catch {
        // Best-effort polling.
      }
    }, 3000);

    return () => {
      if (roomPollRef.current) {
        clearInterval(roomPollRef.current);
        roomPollRef.current = null;
      }
    };
  }, [roomId, mySessionId, syncRemoteParticipants]);

  // ─── Controls ──────────────────────────────────────────────────────────────

  const toggleAudio = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
      setAudioEnabled(e => !e);
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
      setVideoEnabled(e => !e);
    }
  };

  const endCall = async () => {
    cleanup();
    try {
      await axios.delete(`/api/telemedicine/rooms/${roomId}`, { headers: authHeaders() });
    } catch { /* best effort */ }
    navigate(`${basePath}/telemedicine`);
  };

  const sendChatMessage = () => {
    if (!chatInput.trim()) return;
    setChatMessages(prev => [...prev, {
      from: 'You', text: chatInput.trim(),
      time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    }]);
    setChatInput('');
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout role={role}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/telemedicine`} className="hover:underline">Telemedicine</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">Consultation</span>
            </div>
            <h1 className="text-xl font-bold text-[var(--color-text)]">
              {room ? `${room.doctorName} ↔ ${room.patientName}` : 'Connecting...'}
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
              <p className="text-sm text-[var(--color-text-muted)]">Connecting to Cloudflare Realtime SFU...</p>
            </div>
          </div>
        ) : error ? (
          <div className="card p-8 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
              <Phone className="w-8 h-8 text-red-500" />
            </div>
            <p className="font-semibold text-red-600">Connection Failed</p>
            <p className="text-sm text-[var(--color-text-muted)]">{error}</p>
            <div className="flex gap-2 justify-center">
              <button onClick={initRoom} className="btn-primary">Retry</button>
              <Link to={`${basePath}/telemedicine`} className="btn text-sm border border-[var(--color-border)]">Back</Link>
            </div>
          </div>
        ) : (
          <div className="flex gap-4">
            {/* Video Area */}
            <div className="flex-1 space-y-3">
              {/* Remote Video (large) */}
              <div className="relative bg-gray-900 rounded-2xl overflow-hidden aspect-video">
                <video ref={remoteVideoRef} autoPlay playsInline
                  className="w-full h-full object-cover" />
                {!connected && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center text-white space-y-3">
                      <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center mx-auto">
                        <Users className="w-10 h-10" />
                      </div>
                      <p className="text-sm opacity-75">Waiting for other participant to join...</p>
                    </div>
                  </div>
                )}

                {/* Local Video (PiP) */}
                <div className="absolute bottom-4 right-4 w-44 h-32 rounded-xl overflow-hidden border-2 border-white/30 shadow-xl">
                  <video ref={localVideoRef} autoPlay playsInline muted
                    className="w-full h-full object-cover" />
                  {!videoEnabled && (
                    <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                      <VideoOff className="w-6 h-6 text-white/50" />
                    </div>
                  )}
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-3">
                <button onClick={toggleAudio}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition ${
                    audioEnabled ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-red-500 text-white'
                  }`}>
                  {audioEnabled ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                </button>
                <button onClick={toggleVideo}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition ${
                    videoEnabled ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' : 'bg-red-500 text-white'
                  }`}>
                  {videoEnabled ? <VideoIcon className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                </button>
                <button onClick={() => setShowChat(!showChat)}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition ${
                    showChat ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}>
                  <MessageSquare className="w-5 h-5" />
                </button>
                <button onClick={endCall}
                  className="w-14 h-12 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition">
                  <Phone className="w-5 h-5 rotate-[135deg]" />
                </button>
              </div>
            </div>

            {/* Chat Panel */}
            {showChat && (
              <div className="w-72 card flex flex-col">
                <div className="px-4 py-3 border-b border-[var(--color-border)]">
                  <h3 className="font-semibold text-sm">{t('chat', { defaultValue: 'Chat' })}</h3>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 max-h-80">
                  {chatMessages.length === 0 && (
                    <p className="text-xs text-[var(--color-text-muted)] text-center py-4">No messages yet</p>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`text-xs ${msg.from === 'You' ? 'text-right' : ''}`}>
                      <div className={`inline-block px-3 py-1.5 rounded-lg max-w-[200px] ${
                        msg.from === 'You' ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-100'
                      }`}>
                        <p>{msg.text}</p>
                      </div>
                      <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{msg.time}</p>
                    </div>
                  ))}
                </div>
                <div className="p-3 border-t border-[var(--color-border)]">
                  <div className="flex gap-2">
                    <input type="text" value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && sendChatMessage()}
                      placeholder={t("common.type_a_message")}
                      className="flex-1 px-3 py-1.5 border border-[var(--color-border)] rounded-lg text-xs" />
                    <button onClick={sendChatMessage} className="btn-primary text-xs px-3">Send</button>
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
