import { pgTable, text, serial, timestamp, boolean, numeric, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("passenger"), // passenger | driver | admin
  isActive: boolean("is_active").notNull().default(true),
  isOnline: boolean("is_online").notNull().default(false),
  currentLat: numeric("current_lat"),
  currentLng: numeric("current_lng"),
  rating: numeric("rating").notNull().default(5.0),
  ratingCount: integer("rating_count").notNull().default(0),
  /** Digital payment methods the driver accepts (nequi | daviplata | breve). All drivers accept cash. */
  acceptedPayments: text("accepted_payments").array().notNull().default(sql`'{}'`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
