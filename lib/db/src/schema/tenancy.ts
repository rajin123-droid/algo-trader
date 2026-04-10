import {
  pgTable,
  serial,
  text,
  real,
  boolean,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const tenantsTable = pgTable("tenants", {
  id:        serial("id").primaryKey(),
  name:      text("name").notNull(),
  slug:      text("slug").notNull(),
  plan:      text("plan").notNull().default("SOLO"),
  isActive:  boolean("is_active").notNull().default(true),
  config:    text("config"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("tenants_slug_idx").on(t.slug)]);

export const subAccountsTable = pgTable("sub_accounts", {
  id:            serial("id").primaryKey(),
  userId:        integer("user_id").notNull(),
  tenantId:      integer("tenant_id"),
  name:          text("name").notNull(),
  portfolioType: text("portfolio_type").notNull().default("MAIN"),
  balance:       real("balance").notNull().default(0),
  currency:      text("currency").notNull().default("USDT"),
  isActive:      boolean("is_active").notNull().default(true),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant        = typeof tenantsTable.$inferSelect;
export type NewTenant     = typeof tenantsTable.$inferInsert;
export type SubAccount    = typeof subAccountsTable.$inferSelect;
export type NewSubAccount = typeof subAccountsTable.$inferInsert;
