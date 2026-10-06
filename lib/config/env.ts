import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./.storage"),
  LLM_ASSISTANT_ENABLED: z.enum(["true", "false"]).default("false"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("openrouter/auto"),
  /** Reverse proxies in front of the app that append to X-Forwarded-For (Next itself sets it when absent). */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
}).superRefine((e, ctx) => {
  if (e.NODE_ENV !== "production") return;
  // Refuse to run production with placeholder or unsupported settings.
  if (/change-me/i.test(e.SESSION_SECRET)) {
    ctx.addIssue({ code: "custom", path: ["SESSION_SECRET"], message: "replace the example value with a long random secret" });
  }
  if (e.STORAGE_DRIVER === "s3") {
    ctx.addIssue({ code: "custom", path: ["STORAGE_DRIVER"], message: "the S3 adapter is not implemented yet; use local storage on a persistent volume" });
  }
  const url = URL.parse(e.APP_URL);
  if (url && url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    ctx.addIssue({ code: "custom", path: ["APP_URL"], message: "must use https in production" });
  }
});

export type Env = z.infer<typeof schema>;

/** Validates an environment object (exported for tests; the app uses env()). */
export function parseEnv(source: Record<string, string | undefined>) {
  return schema.safeParse(source);
}

let cached: Env | undefined;

/** Validated environment. Throws with a clear message if misconfigured. */
export function env(): Env {
  if (!cached) {
    const parsed = parseEnv(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${problems}`);
    }
    cached = parsed.data;
  }
  return cached;
}
