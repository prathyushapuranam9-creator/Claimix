/**
 * Structured operational logger (JSON lines to stderr). Separate from the audit
 * log. Keys that may carry credentials or health data are redacted defensively.
 */
type Level = "debug" | "info" | "warn" | "error";

const REDACT = /pass(word)?|token|secret|cookie|authorization|session|dob|diagnos|clinical|phone|email/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, REDACT.test(k) ? "[redacted]" : redact(v, depth + 1)]),
  );
}

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(redact(ctx ?? {}) as object) });
  console.error(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => write("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
};

/** Wraps an async operation and logs its duration (performance monitoring hook). */
export async function timed<T>(name: string, fn: () => Promise<T>, ctx?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - start);
    if (ms > 500) logger.warn("slow_operation", { op: name, ms, ...ctx });
  }
}
