import {
  pgTable,
  serial,
  text,
  real,
  boolean,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const kycRecordsTable = pgTable("kyc_records", {
  id:              serial("id").primaryKey(),
  userId:          integer("user_id").notNull(),
  status:          text("status").notNull().default("PENDING"),
  level:           text("level").notNull().default("NONE"),
  documents:       text("documents"),
  rejectionReason: text("rejection_reason"),
  submittedAt:     timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt:      timestamp("reviewed_at",  { withTimezone: true }),
});

export const amlChecksTable = pgTable("aml_checks", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull(),
  tradeId:   text("trade_id"),
  tradeType: text("trade_type"),
  amount:    real("amount").notNull(),
  riskScore: real("risk_score").notNull().default(0),
  flagged:   boolean("flagged").notNull().default(false),
  reason:    text("reason"),
  factors:   text("factors"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KycRecord    = typeof kycRecordsTable.$inferSelect;
export type NewKycRecord = typeof kycRecordsTable.$inferInsert;
export type AmlCheck     = typeof amlChecksTable.$inferSelect;
export type NewAmlCheck  = typeof amlChecksTable.$inferInsert;
