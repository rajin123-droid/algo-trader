import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16).default("algo_terminal_default_secret_32chars"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  REDIS_URL: z.string().default("redis://localhost:6379"),

  BINANCE_TESTNET: z.string().transform((v) => v === "true").default("true"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Invalid environment variables:", result.error.format());
    process.exit(1);
  }
  _env = result.data;
  return _env;
}

export { envSchema };
