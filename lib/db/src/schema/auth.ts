import {
  pgTable,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const refreshTokensTable = pgTable("refresh_tokens", {
  id:         text("id").primaryKey(),
  userId:     integer("user_id").notNull(),
  tokenHash:  text("token_hash").notNull(),
  expiresAt:  timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt:  timestamp("revoked_at", { withTimezone: true }),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Device / session tracking — added for session management UI
  deviceId:   text("device_id"),                // client-supplied or derived fingerprint
  userAgent:  text("user_agent"),               // browser / SDK user-agent string
  ipAddress:  text("ip_address"),               // last-seen IP (set on issue, updated on rotate)
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),  // updated on each rotate
});

export type RefreshToken    = typeof refreshTokensTable.$inferSelect;
export type NewRefreshToken = typeof refreshTokensTable.$inferInsert;
