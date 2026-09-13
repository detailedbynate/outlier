import { serializeError } from "./errors";

/**
 * Minimal structured logger. Emits one JSON object per line in production and
 * readable lines in development. Swappable for pino/OpenTelemetry later without
 * touching call sites.
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";
export type LogContext = Record<string, unknown>;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: Number.POSITIVE_INFINITY,
};

const SECRET_KEY_PATTERN = /(key|token|secret|password|authorization|cookie)/i;

export interface Logger {
  trace(message: string, context?: LogContext): void;
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

function resolveLevel(): LogLevel {
  // Read process.env directly: the logger must work before env validation runs.
  const raw = process.env.LOG_LEVEL;
  return raw && raw in LEVEL_WEIGHT ? (raw as LogLevel) : "info";
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_PATTERN.test(k) && typeof v === "string" ? "[REDACTED]" : redact(v, depth + 1);
  }
  return out;
}

function write(level: Exclude<LogLevel, "silent">, message: string, context: LogContext): void {
  const pretty = process.env.NODE_ENV !== "production";
  const entry = { level, time: new Date().toISOString(), msg: message, ...(redact(context) as LogContext) };
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  if (pretty) {
    const { level: _l, time, msg, ...rest } = entry;
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
    stream(`${time} ${level.toUpperCase().padEnd(5)} ${msg}${extra}`);
  } else {
    stream(JSON.stringify(entry));
  }
}

export function createLogger(bindings: LogContext = {}): Logger {
  const log =
    (level: Exclude<LogLevel, "silent">) =>
    (message: string, context: LogContext = {}) => {
      if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[resolveLevel()]) return;
      write(level, message, { ...bindings, ...context });
    };

  return {
    trace: log("trace"),
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger({ service: "yt-intelligence" });
