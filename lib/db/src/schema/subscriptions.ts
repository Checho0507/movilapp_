import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Plan definitions — single source of truth for prices and durations
export const SUBSCRIPTION_PLANS = {
  trial:    { label: "Prueba gratuita", days: 60, priceCop: 0 },
  daily:    { label: "Diario",          days: 1,  priceCop: 3_000 },
  weekly:   { label: "Semanal",         days: 7,  priceCop: 12_500 },
  biweekly: { label: "Quincenal",       days: 15, priceCop: 20_000 },
  monthly:  { label: "Mensual",         days: 30, priceCop: 30_000 },
} as const;

export type SubscriptionPlan = keyof typeof SUBSCRIPTION_PLANS;

export const subscriptionsTable = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  driverId: integer("driver_id")
    .notNull()
    .references(() => usersTable.id),
  // 'trial' | 'daily' | 'weekly' | 'biweekly' | 'monthly'
  plan: text("plan").notNull(),
  priceCop: integer("price_cop").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  isTrial: boolean("is_trial").notNull().default(false),
  // null when auto-generated (e.g. trial on registration)
  createdById: integer("created_by_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Subscription = typeof subscriptionsTable.$inferSelect;
export type InsertSubscription = typeof subscriptionsTable.$inferInsert;
