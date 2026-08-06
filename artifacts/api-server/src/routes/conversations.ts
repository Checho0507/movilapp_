import { Router } from "express";
import { db } from "@workspace/db";
import { conversationsTable, conversationMessagesTable, usersTable } from "@workspace/db";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { authenticate } from "../lib/auth.js";
import type { Server as IOServer } from "socket.io";

const router = Router();

let io: IOServer | null = null;
export function setIO(ioInstance: IOServer) {
  io = ioInstance;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getUser(id: number) {
  const [u] = await db
    .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  return u ?? null;
}

async function getAdminIds(): Promise<number[]> {
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.role, "admin"));
  return rows.map(r => r.id);
}

async function getLastMessage(convId: number) {
  const [msg] = await db
    .select({ content: conversationMessagesTable.content, createdAt: conversationMessagesTable.createdAt })
    .from(conversationMessagesTable)
    .where(eq(conversationMessagesTable.conversationId, convId))
    .orderBy(desc(conversationMessagesTable.createdAt))
    .limit(1);
  return msg ? { content: msg.content, createdAt: msg.createdAt.toISOString() } : null;
}

async function enrichConversation(conv: typeof conversationsTable.$inferSelect) {
  const [initiator, lastMessage] = await Promise.all([
    getUser(conv.userId),
    getLastMessage(conv.id),
  ]);
  let otherUser = null;
  if (conv.otherUserId) otherUser = await getUser(conv.otherUserId);

  return {
    id: conv.id,
    type: conv.type,
    userId: conv.userId,
    otherUserId: conv.otherUserId,
    subject: conv.subject,
    status: conv.status,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    userName: initiator?.name ?? "Usuario",
    userRole: initiator?.role ?? "passenger",
    otherUserName: otherUser?.name ?? (conv.type === "support" ? "Administración" : "Usuario"),
    otherUserRole: otherUser?.role ?? (conv.type === "support" ? "admin" : "passenger"),
    lastMessage,
  };
}

/** Emit to everyone involved in a conversation */
async function emitToParticipants(
  event: string,
  payload: unknown,
  conv: typeof conversationsTable.$inferSelect,
) {
  if (!io) return;
  io.to(`user:${conv.userId}`).emit(event, payload);
  if (conv.otherUserId) {
    io.to(`user:${conv.otherUserId}`).emit(event, payload);
  }
  // Support convs: also notify all admins
  if (conv.type === "support") {
    const adminIds = await getAdminIds();
    for (const adminId of adminIds) {
      io.to(`user:${adminId}`).emit(event, payload);
    }
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/conversations
router.get("/", authenticate, async (req, res) => {
  const user = req.user!;

  const rows = user.role === "admin"
    // Admins see everything
    ? await db
        .select()
        .from(conversationsTable)
        .orderBy(desc(conversationsTable.updatedAt))
    // Regular users see their own conversations
    : await db
        .select()
        .from(conversationsTable)
        .where(
          or(
            eq(conversationsTable.userId, user.userId),
            eq(conversationsTable.otherUserId, user.userId),
          ),
        )
        .orderBy(desc(conversationsTable.updatedAt));

  const enriched = await Promise.all(rows.map(enrichConversation));
  res.json(enriched);
});

// POST /api/conversations
router.post("/", authenticate, async (req, res) => {
  const user = req.user!;
  const { type = "support", subject = "Consulta", otherUserId } = req.body as {
    type?: string;
    subject?: string;
    otherUserId?: number;
  };

  // Return existing open support conversation instead of creating a duplicate
  if (type === "support") {
    const [existing] = await db
      .select()
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.userId, user.userId),
          eq(conversationsTable.type, "support"),
          eq(conversationsTable.status, "open"),
        ),
      )
      .limit(1);
    if (existing) {
      res.json(await enrichConversation(existing));
      return;
    }
  }

  const [conv] = await db
    .insert(conversationsTable)
    .values({
      type,
      userId: user.userId,
      otherUserId: otherUserId ?? null,
      subject,
      status: "open",
    })
    .returning();

  const enriched = await enrichConversation(conv);
  await emitToParticipants("conv:new", enriched, conv);
  res.status(201).json(enriched);
});

// GET /api/conversations/:id/messages
router.get("/:id/messages", authenticate, async (req, res) => {
  const convId = Number(req.params["id"]);
  const user = req.user!;

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Access check
  const isParticipant =
    conv.userId === user.userId ||
    conv.otherUserId === user.userId ||
    user.role === "admin";
  if (!isParticipant) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const messages = await db
    .select()
    .from(conversationMessagesTable)
    .where(eq(conversationMessagesTable.conversationId, convId))
    .orderBy(conversationMessagesTable.createdAt);

  const senderIds = [...new Set(messages.map(m => m.senderId))];
  const senders = senderIds.length > 0
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
        .from(usersTable)
        .where(inArray(usersTable.id, senderIds))
    : [];
  const senderMap = new Map(senders.map(s => [s.id, s]));

  res.json(
    messages.map(m => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      senderName: senderMap.get(m.senderId)?.name ?? "Usuario",
      senderRole: senderMap.get(m.senderId)?.role ?? "passenger",
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  );
});

// POST /api/conversations/:id/messages
router.post("/:id/messages", authenticate, async (req, res) => {
  const convId = Number(req.params["id"]);
  const user = req.user!;
  const { content } = req.body as { content: string };

  if (!content?.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  if (conv.status === "resolved") {
    res.status(400).json({ error: "This conversation is resolved" });
    return;
  }

  const isParticipant =
    conv.userId === user.userId ||
    conv.otherUserId === user.userId ||
    user.role === "admin";
  if (!isParticipant) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [msg] = await db
    .insert(conversationMessagesTable)
    .values({ conversationId: convId, senderId: user.userId, content: content.trim() })
    .returning();

  // Bump conversation updatedAt so it sorts to top
  await db
    .update(conversationsTable)
    .set({ updatedAt: new Date() })
    .where(eq(conversationsTable.id, convId));

  const sender = await getUser(user.userId);
  const formatted = {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    senderName: sender?.name ?? "Usuario",
    senderRole: sender?.role ?? "passenger",
    content: msg.content,
    createdAt: msg.createdAt.toISOString(),
  };

  await emitToParticipants("conv:message", { conversationId: convId, message: formatted }, conv);
  res.status(201).json(formatted);
});

// PATCH /api/conversations/:id  — resolve / reopen
router.patch("/:id", authenticate, async (req, res) => {
  const convId = Number(req.params["id"]);
  const user = req.user!;
  const { status } = req.body as { status: string };

  if (!["open", "resolved"].includes(status)) {
    res.status(400).json({ error: "status must be 'open' or 'resolved'" });
    return;
  }

  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, convId))
    .limit(1);

  if (!conv) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  // Only admin or participants can update
  const isParticipant =
    conv.userId === user.userId ||
    conv.otherUserId === user.userId ||
    user.role === "admin";
  if (!isParticipant) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [updated] = await db
    .update(conversationsTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(conversationsTable.id, convId))
    .returning();

  const enriched = await enrichConversation(updated);
  await emitToParticipants("conv:updated", enriched, updated);
  res.json(enriched);
});

export default router;
