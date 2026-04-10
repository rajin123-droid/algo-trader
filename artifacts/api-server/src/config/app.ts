/**
 * app.ts — Application-level configuration derived from the validated env.
 */

import { env } from "./env.js";

export const appConfig = {
  nodeEnv:    env.NODE_ENV,
  port:       Number(env.PORT),
  isDev:      env.NODE_ENV === "development",
  isProd:     env.NODE_ENV === "production",
} as const;
