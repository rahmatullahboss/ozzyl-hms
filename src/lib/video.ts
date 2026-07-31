/**
 * Video Provider — Cloudflare Realtime SFU (primary) + Jitsi fallback
 *
 * Cloudflare Realtime SFU:
 *   - Previously known as "Cloudflare Calls"
 *   - Runs on Cloudflare's global network (Dhaka PoP → lowest BD latency)
 *   - Free: 1,000 participant-minutes/day; then $0.05/1,000 min
 *   - Setup: Dashboard → Realtime SFU → Create App → get App ID + App Secret
 *
 * Jitsi (fallback):
 *   - Free, no account needed
 *   - Used when CF_REALTIME_APP_ID is not set
 *
 * API docs: https://developers.cloudflare.com/realtime/sfu/
 */

export interface VideoRoom {
  roomName:  string;
  roomUrl:   string;           // URL to send to patient/doctor
  sessionId?: string;          // Cloudflare session ID (for admin tracking)
  provider:  'cloudflare' | 'jitsi';
}

export interface VideoProvider {
  createRoom(params: { name: string; durationMin: number }): Promise<VideoRoom>;
  deleteRoom(roomName: string): Promise<void>;
}

// ─── Env interface ────────────────────────────────────────────────────────────
export interface VideoEnv {
  CF_REALTIME_APP_ID?:     string;  // from Cloudflare dashboard → Realtime SFU
  CF_REALTIME_APP_SECRET?: string;  // from Cloudflare dashboard → Realtime SFU
  CF_ACCOUNT_ID?:          string;  // your Cloudflare account ID
}

// ─── Cloudflare Realtime SFU Provider ────────────────────────────────────────
class CloudflareRealtimeProvider implements VideoProvider {
  private readonly appId:     string;
  private readonly appSecret: string;

  constructor(env: VideoEnv) {
    this.appId     = env.CF_REALTIME_APP_ID!;
    this.appSecret = env.CF_REALTIME_APP_SECRET!;
  }

  async createRoom({ name }: { name: string; durationMin: number }): Promise<VideoRoom> {
    // Create a new SFU session — this is the "room"
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/apps/${this.appId}/sessions/new`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.appSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Cloudflare Realtime session create failed (${res.status}): ${err}`);
    }

    const data = await res.json() as { sessionId: string };

    // Build a join URL — this is the URL we embed in our frontend consultation page
    // Frontend uses @cloudflare/calls-sdk to connect to this session
    const roomName = `hms-${name}-${Date.now()}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const roomUrl  = `/consultation/join?sessionId=${data.sessionId}&appId=${this.appId}`;

    return {
      roomName,
      roomUrl,
      sessionId: data.sessionId,
      provider: 'cloudflare',
    };
  }

  async deleteRoom(_roomName: string): Promise<void> {
    // Cloudflare SFU sessions auto-expire when all participants disconnect.
    // No explicit delete needed.
  }
}

// ─── Jitsi Fallback Provider ──────────────────────────────────────────────────
class JitsiProvider implements VideoProvider {
  async createRoom({ name }: { name: string }): Promise<VideoRoom> {
    const slug    = `HMS${name}${Math.random().toString(36).slice(2, 8)}`.replace(/[^A-Za-z0-9]/g, '');
    const roomUrl = `https://meet.jit.si/${slug}`;
    console.log(`[VIDEO] Using Jitsi fallback: ${roomUrl}`);
    return { roomName: slug, roomUrl, provider: 'jitsi' };
  }

  async deleteRoom(_roomName: string): Promise<void> {
    // Jitsi rooms are ephemeral — no deletion needed
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
export function createVideoProvider(env: VideoEnv): VideoProvider {
  if (env.CF_REALTIME_APP_ID && env.CF_REALTIME_APP_SECRET) {
    console.log('[VIDEO] Using Cloudflare Realtime SFU');
    return new CloudflareRealtimeProvider(env);
  }
  console.log('[VIDEO] CF_REALTIME_APP_ID not set — using Jitsi fallback');
  return new JitsiProvider();
}
