import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A conversation between two parties:
//   type='support' → userId ↔ admin (any admin can respond; otherUserId=null)
//   type='direct'  → userId ↔ otherUserId (e.g. passenger ↔ driver)
export const conversationsTable = pgTable("conversations", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("support"), // 'support' | 'direct'
  userId: integer("user_id").notNull(),            // conversation initiator
  otherUserId: integer("other_user_id"),           // null for support; specific user for direct
  subject: text("subject").notNull().default("Consulta"),
  status: text("status").notNull().default("open"), // 'open' | 'resolved'
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationMessagesTable = pgTable("conversation_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull(),
  senderId: integer("sender_id").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertConversationSchema = createInsertSchema(conversationsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const insertConversationMessageSchema = createInsertSchema(conversationMessagesTable).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversationsTable.$inferSelect;
export type ConversationMessage = typeof conversationMessagesTable.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type InsertConversationMessage = z.infer<typeof insertConversationMessageSchema>;
