/**
 * A connection to Discord's gateway: what makes the bot show as online and
 * hears slash commands as they're used. Built on Node's
 * own WebSocket instead of discord.js, so the bot process stays small.
 *
 * Handles the parts of the protocol a single small bot needs: identify,
 * heartbeats, resuming after a drop, and reconnecting when Discord asks.
 * https://discord.com/developers/docs/events/gateway
 */

/** Just the server itself: no privileged intents to switch on in the Developer Portal. */
export const INTENTS = { GUILDS: 1 << 0 } as const;

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

// Close codes that mean "fix the setup", where reconnecting would only fail again.
const FATAL_CLOSE = new Map([
  [4004, "the bot token was rejected"],
  [4010, "invalid shard"],
  [4011, "sharding required"],
  [4012, "invalid API version"],
  [4013, "invalid intents"],
  [4014, "intents not allowed"],
]);

interface Payload {
  op: number;
  d: unknown;
  s: number | null;
  t: string | null;
}

export interface Presence {
  status: "online" | "idle" | "dnd";
  /** Shown under the bot's name, e.g. "Watching outliers". Type 3 = Watching, 4 = custom. */
  activity?: { name: string; type: 0 | 2 | 3 | 4 | 5; state?: string };
}

export interface GatewayOptions {
  token: string;
  intents: number;
  presence: Presence;
  onDispatch: (event: string, data: unknown) => void;
  log: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void };
  /** Called when the gateway refuses the setup for good (bad token, intents not allowed). */
  onFatal: (reason: string) => void;
}

export class DiscordGateway {
  private socket: WebSocket | null = null;
  private seq: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: string | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private firstBeat: ReturnType<typeof setTimeout> | null = null;
  private acked = true;
  private stopped = false;
  private retries = 0;

  constructor(private readonly options: GatewayOptions) {}

  start(): void {
    this.stopped = false;
    this.connect(false);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close(1000, "shutting down");
  }

  /** Change what the bot shows as doing. */
  setPresence(presence: Presence): void {
    this.send(3, this.presencePayload(presence));
  }

  private presencePayload(presence: Presence) {
    return { since: null, afk: false, status: presence.status, activities: presence.activity ? [presence.activity] : [] };
  }

  private send(op: number, d: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ op, d }));
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.firstBeat) clearTimeout(this.firstBeat);
    this.heartbeat = null;
    this.firstBeat = null;
  }

  private connect(resume: boolean): void {
    const url = resume && this.resumeUrl ? `${this.resumeUrl}/?v=10&encoding=json` : GATEWAY_URL;
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      let payload: Payload;
      try {
        payload = JSON.parse(String(event.data)) as Payload;
      } catch {
        return;
      }
      this.handle(payload, resume);
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.clearTimers();
      this.socket = null;
      if (this.stopped) return;
      const fatal = FATAL_CLOSE.get(event.code);
      if (fatal) {
        this.options.onFatal(fatal);
        return;
      }
      // Codes that end the session need a fresh identify; anything else can resume.
      const canResume = this.sessionId !== null && ![4007, 4009].includes(event.code);
      if (!canResume) this.sessionId = null;
      const delay = Math.min(60_000, 1_000 * 2 ** this.retries++) + Math.random() * 1_000;
      this.options.log.info("gateway closed, reconnecting", { code: event.code, resume: canResume, inSeconds: Math.round(delay / 1000) });
      setTimeout(() => this.connect(canResume), delay);
    });
    socket.addEventListener("error", () => {
      // A close event always follows; reconnecting happens there.
    });
  }

  private handle(payload: Payload, resuming: boolean): void {
    if (payload.s !== null && payload.s !== undefined) this.seq = payload.s;
    switch (payload.op) {
      case 10: {
        // Hello: start heartbeating, then identify or resume.
        const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
        this.acked = true;
        this.firstBeat = setTimeout(() => {
          this.beat();
          this.heartbeat = setInterval(() => this.beat(), interval);
        }, interval * Math.random());
        if (resuming && this.sessionId) {
          this.send(6, { token: this.options.token, session_id: this.sessionId, seq: this.seq });
        } else {
          this.send(2, {
            token: this.options.token,
            intents: this.options.intents,
            properties: { os: process.platform, browser: "outlier", device: "outlier" },
            presence: this.presencePayload(this.options.presence),
          });
        }
        return;
      }
      case 11:
        this.acked = true;
        return;
      case 1:
        this.beat(true);
        return;
      case 7:
        // Discord wants us to reconnect and resume.
        this.socket?.close(4900, "reconnect requested");
        return;
      case 9: {
        // Invalid session: resumable or not, says d.
        if (!payload.d) {
          this.sessionId = null;
          this.seq = null;
        }
        this.socket?.close(4900, "invalid session");
        return;
      }
      case 0: {
        if (payload.t === "READY") {
          const ready = payload.d as { session_id: string; resume_gateway_url: string; user: { username: string } };
          this.sessionId = ready.session_id;
          this.resumeUrl = ready.resume_gateway_url;
          this.retries = 0;
          this.options.log.info("gateway ready", { as: ready.user.username });
        } else if (payload.t === "RESUMED") {
          this.retries = 0;
          this.options.log.info("gateway resumed");
        }
        if (payload.t) {
          try {
            this.options.onDispatch(payload.t, payload.d);
          } catch (error) {
            this.options.log.error("gateway event handler threw", { event: payload.t, error: error instanceof Error ? error.message : String(error) });
          }
        }
        return;
      }
    }
  }

  private beat(force = false): void {
    // No ack since the last beat: the connection is dead even if the socket looks open.
    if (!force && !this.acked) {
      this.options.log.warn("heartbeat not acknowledged, reconnecting");
      this.socket?.close(4900, "zombie connection");
      return;
    }
    this.acked = false;
    this.send(1, this.seq);
  }
}
