/**
 * db.ts — Database configuration derived from the validated env.
 */

import { env } from "./env.js";

export const dbConfig = {
  url:       env.DATABASE_URL,
  redisUrl:  env.REDIS_URL,
} as const;
