import {
  pgTable,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable("audit_logs", {
  id:         text("id").primaryKey(),
  userId:     text("user_id"),
  tenantId:   integer("tenant_id"),
  action:     text("action").notNull(),
  resource:   text("resource"),
  resourceId: text("resource_id"),
  payload:    text("payload"),
  ipAddress:  text("ip_address"),
  userAgent:  text("user_agent"),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog    = typeof auditLogsTable.$inferSelect;
export type NewAuditLog = typeof auditLogsTable.$inferInsert;
